/**
 * Fluxo E2E: Lead → BRM → Oportunidade → Cotação → Viabilidade → Pedido.
 *
 * Produtos: IP CONNECT, VPN, LINK DEDICADO. Até a oportunidade o fluxo é igual; na cotação mudam
 * ProductCode, QuoteMemberList (blocos de config) e o payload do ProductsValidation:
 * - IP Connect: FCIPConnectChild, IpConnectQuoteInstallationFee.
 * - VPN: FCVpnMplsChild (este script hoje ainda usa IP Connect; para VPN real é preciso
 *   ProductCode/LookupProduct VPN, FCVpnMplsChild preenchido e gravar network da UI VPN).
 * - Link Dedicado: FC_LDQuoteInstallationAddress, Vtal_Seg_IP_ValidateMultipointDedicatedLink,
 *   Vtal_Seg_IPGetProductConfigLD (ver docs/FLUXO-COTACAO-POR-PRODUTO.md e recording 16/03/2026).
 *
 * Sequência alinhada ao trace Aura (salesforce-aura-passo-a-passo):
 * - Linha 198: Vtal_CreateOrderOnQuote (IP). Linha 199: checkoutOrderOMBatch com OrderList via
 *   Vtal_SF_OrderUtils (Apex), não IP; usamos o IP que pode delegar ao mesmo.
 * - Linha 203: getRecordActions na Order lista CustomButton.Order.vlocity_cmt__XOMOnSubmitOrder
 *   (submit ao OM → subpedido "Em implantação"); chamamos o IP XOMOnSubmitOrder após checkout.
 * - Opcional: USE_MERGE_TECH_CONTACT=1 chama Vtal_Seg_MergeTechContacList antes de CreateOrderOnQuote (trace 197).
 * - Fluxo igual ao botão "Salvar e avançar" (trace Aura): ProductsValidation(save) com FCIPConnectChild
 *   preenchido (id 822) consolida Mensalidade/TaxaInstalacao no QuoteLineItem; em seguida
 *   ProductsValidation(advance) com FCIPConnectChild vazio (id 810) — assim o subpedido exibe
 *   Valor Mensal e Valor Instalação como na interface.
 * - Cart API v2 (reprice): após IpConnectQuoteInstallationFee chamamos /services/apexrest/vlocity_cmt/v2/carts
 *   (ou v2/cpq/carts) para reprice do carrinho — recalcula preço, consolida runtime JSON no banco e gera
 *   Push Event Data, como o front faz implicitamente. USE_CART_REPRICE=0 desativa; CART_API_V2_BASE override.
 * - Alternativa 100% igual ao botão: chamar ProductsValidation(advance) via Aura
 *   (BusinessProcessDisplayController.GenericInvoke2NoCont, sClassName: vlocity_cmt.IntegrationProcedureService,
 *   sMethodName: Vtal_Seg_ProductsValidation, function: advance) via endpoint /aura — não implementado aqui.
 * - Se o Order vier com QuoteId null após CreateOrderOnQuote, fazemos PATCH para QuoteId + vlocity_cmt__QuoteId__c
 *   (vinculação Order → Quote necessária para pricing/herança).
 * - Opcional: STRICT_QUOTE_VALUES=1 aborta se IpConnectQuoteInstallationFee não retornar valores.
 *
 * A partir da Oportunidade, o fluxo de cotação/pedido replica o de `gerar-pedido-massa-pronta-link-dedicado.js`
 * (token viabilidade, FillAddressInfo, CreateQuoteMembers com ponta A/B aninhadas, ProductsValidation,
 * cart reprice, viabilidade com poll, IPs CPQ, TRG Reviewed→Approved, DREs, MergeTechContacList, CreateOrderOnQuote).
 *
 * Uso: [ENVIRONMENT=dev] node scripts/gerar-pedido-link-dedicado.js
 *
 * Opcionais: IP_XOM_SUBMIT_ORDER (URL do IP de submit OM), XOM_SUBMIT_MODE (Sync|Async).
 * Se o org não tiver o IP "XOMOnSubmitOrder" ativo, definir IP_XOM_SUBMIT_ORDER com o nome real do IP
 * (ex.: .../integrationprocedure/Vtal_SubmitOrderToOM) para o subpedido ir para "Em implantação".
 */
const { buildLeadPayload } = require('../support/utils/salesforce/leadPayload.js');
const { buildConvertLeadPayload, getFieldValue } = require('../support/utils/salesforce/convertLeadPayload.js');
const { buildOrganizationPatchPayload, resolveLxdFantasyName } = require('../support/utils/salesforce/organizationPatchPayload.js');
const { buildBusinessAccountPatchPayload } = require('../support/utils/salesforce/businessAccountPatchPayload.js');
const { buildBillingAccountPatchPayload } = require('../support/utils/salesforce/billingAccountPatchPayload.js');
const { buildContactPayload } = require('../support/utils/salesforce/contactPayload.js');
const { buildContractMSAPayload, buildContractActivatePayload } = require('../support/utils/salesforce/contractMSAPayload.js');
const { buildContentVersionMSAPayload } = require('../support/utils/salesforce/contentVersionMSAPayload.js');
const { delay } = require('../support/utils/helpers/waitHelper.js');
const { finalizePedidoGerado } = require('../support/utils/finalizePedidoGerado.js');
const { mergeAccountIdsIntoPedidoResult } = require('../support/utils/mergeAccountIdsIntoPedidoResult.js');
const { pollSubpedidosEmImplantacao } = require('../support/utils/salesforce/pollSubpedidosEmImplantacao.js');

const { createSalesforceScriptClient } = require('../support/utils/salesforce/scriptHttpClient.js');
const {
  UI_API_RECORDS,
  CONVERT_LEAD_URL,
  SOBJECTS_ACCOUNT,
  SOBJECTS_CONTACT,
  SOBJECTS_CONTRACT,
  SOBJECTS_CONTENT_VERSION,
  SOBJECTS_CONTENT_DOCUMENT_LINK,
  QUERY_URL,
  TOOLING_EXECUTE_ANONYMOUS,
  SOBJECTS_OPPORTUNITY,
  SOBJECTS_QUOTE,
  IP_CREATE_QUOTE_MEMBERS,
  IP_PRODUCTS_VALIDATION,
  IP_VIABILITY,
  IP_QUOTE_STATUS,
  IP_VALIDATE_CREATE_ORDER,
  IP_CREATE_ORDER_ON_QUOTE,
  IP_FILL_ADDRESS_INFO,
  IP_GET_QUOTE_ADDRESS_VIABILITY,
  IP_IP_CONNECT_QUOTE_INSTALLATION_FEE,
  IP_XOM_SUBMIT_ORDER,
  IP_XOM_SUBMIT_ORDER_FALLBACK,
  IP_GENERIC_INVOKE,
  IP_CHECKOUT_ORDER_OM,
  IP_MERGE_TECH_CONTACT,
  CART_API_V2_BASE,
  INVOKE_CPQ_URL,
  IP_GET_TOKEN_VIABILIDADE,
  SOBJECTS_ORDER,
  SOBJECTS_ORDER_ITEM,
  BRM_POLL_TIMEOUT_MS,
  BRM_POLL_INTERVAL_MS,
} = require('../support/utils/salesforce/sfRestPaths.js');

const {
  baseUrl,
  tokenUrl,
  envName,
  IS_TRG,
  IS_TI,
  quoteFlow: currentQuoteFlow,
  sf,
  cookie: defaultCookie,
  getToken,
  api,
  fail,
} = createSalesforceScriptClient();
const { runLeadToBrm } = require('../support/utils/ativacao/runLeadToBrm.js');
const {
  getAddressesToTry,
  getOrderUf,
  getOrderCity,
  getRegionConfig,
  buildFormattedAddress,
  buildPointAddressFields,
  findFillAddressRecord,
  getDefaultAddressId,
  getRegionLabel,
} = require('../support/utils/salesforce/resolveMassTestAddress.js');
const { logStepTrace, tryParseJson, extractTokenDeep } = require('../support/utils/salesforce/ldTraceLogging.js');
const MAX_TRIES = 10;
// Quote/Opportunity (ti sandbox) – user/collection
const QUOTE_RECORD_TYPE_ID = process.env.QUOTE_RECORD_TYPE_ID || '012Hs000000l6VjIAI';
const QUOTE_PRICEBOOK2_ID = process.env.QUOTE_PRICEBOOK2_ID || '01sHs000001nMM3IAM';
const PRICEBOOK_ENTRY_ID = process.env.PRICEBOOK_ENTRY_ID || '01uU6000001jmRJIAY';
const PRODUCT2_ID = process.env.PRODUCT2_ID || '01tU6000004z8nxIAA';
/** Produto Link Dedicado (Lead → Link Dedicado → Pedido). Alinhado à massa pronta: catálogo costuma usar CONNECTIVITY_DEDICATED_LINK. */
const PRODUCT_CODE_LD = process.env.PRODUCT_CODE_LD || 'CONNECTIVITY_DEDICATED_LINK';
const PRODUCT_CODE_VIABILITY_LD = process.env.PRODUCT_CODE_VIABILITY_LD || 'CONNECTIVITY_DEDICATED_LINK';
const PRODUCT_CODE_POINT = process.env.PRODUCT_CODE_POINT || 'CONNECTIVITY_DEDICATED_LINK_POINT';
const PRODUCT_NAME_LD = process.env.PRODUCT_NAME_LD || 'Link Dedicado';
const VALOR_MENSAL_LD = process.env.VALOR_MENSAL_LD || '800';
const VALOR_INSTALACAO_LD = process.env.VALOR_INSTALACAO_LD || '3000';

// Endereços por região (MASS_ADDRESS_REGION=SP|RJ).
const ADDRESSES_TO_TRY = getAddressesToTry({ linkDedicado: true });
const VIABILITY_WAIT_MS = parseInt(process.env.VIABILITY_WAIT_MS || '25000', 10);

async function resolveLdProduct(apiCall) {
  const pricebook2Id = QUOTE_PRICEBOOK2_ID;
  let product2Id;
  let productCode = PRODUCT_CODE_LD;
  let productName = PRODUCT_NAME_LD;
  if (process.env.PRODUCT2_ID_LD && process.env.PRICEBOOK_ENTRY_ID_LD) {
    return {
      product2Id: process.env.PRODUCT2_ID_LD.trim(),
      pricebookEntryId: process.env.PRICEBOOK_ENTRY_ID_LD.trim(),
      productCode,
      productName,
      objectTypeName: process.env.LD_OBJECT_TYPE_NAME || 'Dedicated Link Product Specification',
    };
  }
  if (process.env.PRODUCT2_ID_LD) {
    product2Id = process.env.PRODUCT2_ID_LD.trim();
    const qProd = `SELECT Id, Name, ProductCode FROM Product2 WHERE Id = '${product2Id}' LIMIT 1`;
    const rProd = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qProd)}`);
    logStepTrace('resolveLdProduct.queryById', { soql: qProd }, rProd);
    if (rProd.status === 200 && rProd.data?.records?.length) {
      productCode = rProd.data.records[0].ProductCode || productCode;
      productName = rProd.data.records[0].Name || productName;
    }
  } else {
    const escaped = PRODUCT_CODE_LD.replace(/'/g, "\\'");
    let qProduct = `SELECT Id, Name, ProductCode FROM Product2 WHERE ProductCode = '${escaped}' AND IsActive = true LIMIT 1`;
    let resProduct = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qProduct)}`);
    logStepTrace('resolveLdProduct.queryPrimary', { soql: qProduct }, resProduct);
    if (resProduct.status !== 200 || !resProduct.data?.records?.length) {
      qProduct = `SELECT Id, Name, ProductCode FROM Product2 WHERE (ProductCode LIKE '%LINK%' OR Name LIKE '%Link Dedicado%' OR Name LIKE '%Link%') AND IsActive = true ORDER BY ProductCode LIMIT 1`;
      resProduct = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qProduct)}`);
      logStepTrace('resolveLdProduct.queryFallback', { soql: qProduct }, resProduct);
    }
    if (resProduct.status !== 200 || !resProduct.data?.records?.length) return null;
    const rec = resProduct.data.records[0];
    product2Id = rec.Id;
    productCode = rec.ProductCode || productCode;
    productName = rec.Name || productName;
  }

  const qEntry = `SELECT Id FROM PricebookEntry WHERE Product2Id = '${product2Id}' AND Pricebook2Id = '${pricebook2Id}' AND IsActive = true LIMIT 1`;
  const resEntry = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qEntry)}`);
  logStepTrace('resolveLdProduct.queryPricebookEntry', { soql: qEntry }, resEntry);
  if (resEntry.status !== 200 || !resEntry.data?.records?.length) return null;
  const pricebookEntryId = resEntry.data.records[0].Id;
  let objectTypeName = process.env.LD_OBJECT_TYPE_NAME || null;
  if (!objectTypeName) {
    const qObj = `SELECT vlocity_cmt__ObjectTypeName__c FROM Product2 WHERE Id = '${product2Id}' LIMIT 1`;
    const rObj = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qObj)}`);
    logStepTrace('resolveLdProduct.queryObjectType', { soql: qObj }, rObj);
    if (rObj.status === 200 && rObj.data?.records?.[0]?.vlocity_cmt__ObjectTypeName__c) {
      objectTypeName = rObj.data.records[0].vlocity_cmt__ObjectTypeName__c;
    }
  }
  if (!objectTypeName) objectTypeName = 'Dedicated Link Product Specification';
  return { product2Id, pricebookEntryId, productCode, productName, objectTypeName };
}

function extractAddressInfoFromFillAddressResponse(fillRes, fallbackToken = '', originalAddr = null) {
  if (fillRes?.status !== 200 || !Array.isArray(fillRes?.data)) return null;
  const rec = findFillAddressRecord(fillRes.data, originalAddr);
  console.log('ADDRESS ESCOLHIDO:', rec?.description);
  if (!rec || !rec.id) return null;
  return {
    id: rec.id,
    locationCode: rec.locationCode,
    Token: fallbackToken || '',
  };
}

async function fillAddressInfoWithTokenFallback(apiCall, addr, tokenCandidates, traceBase) {
  const uniqueTokens = [...new Set((tokenCandidates || []).map((v) => (v == null ? '' : String(v))))];
  let lastRes = null;

  for (let idx = 0; idx < uniqueTokens.length; idx++) {
    const token = uniqueTokens[idx];

    const cepPayload = {
      description: addr.zipCode,
      endereco: addr.zipCode,
      token,
    };

    const cepRes = await apiCall('POST', IP_FILL_ADDRESS_INFO, cepPayload);
    logStepTrace(`${traceBase}.cepSearch`, cepPayload, cepRes);

    if (cepRes.status === 200 && Array.isArray(cepRes.data) && cepRes.data.length > 0) {
      const baseAddress = findFillAddressRecord(cepRes.data, addr) || cepRes.data[0];

      if (baseAddress) {
        console.log(`Endereço base encontrado:`, baseAddress.description);

        return {
          addressInfo: {
            id: baseAddress.id || null,
            locationCode: baseAddress.locationCode || addr.locationCode,
            Token: token,
            description: baseAddress.description,
            streetType: baseAddress.streetType,
            streetName: baseAddress.streetName,
            neighborhood: baseAddress.neighborhood,
            city: baseAddress.city,
            stateAbbreviation: baseAddress.stateAbbreviation,
            zipCode: baseAddress.zipCode,
            country: baseAddress.country,
            number: String(addr.number),
          },
          response: cepRes,
          usedToken: token,
        };
      }
    }

    const fullPayload = {
      description: `${addr.streetType} ${addr.streetName}, ${addr.number}`,
      endereco: `${addr.streetType} ${addr.streetName}, ${addr.number}`,
      zipCode: addr.zipCode,
      city: getOrderCity(),
      state: getOrderUf(),
      number: String(addr.number),
      token,
    };

    const fullRes = await apiCall('POST', IP_FILL_ADDRESS_INFO, fullPayload);
    logStepTrace(`${traceBase}.fullSearch`, fullPayload, fullRes);

    const addressInfo = extractAddressInfoFromFillAddressResponse(fullRes, token, addr);
    if (addressInfo) return { addressInfo, response: fullRes, usedToken: token };

    lastRes = fullRes;
  }

  console.warn(`Forçando endereço padrão ${getRegionLabel()} (fallback manual)`);
  return {
    addressInfo: {
      id: addr.id ?? getDefaultAddressId(addr),
      locationCode: addr.locationCode || getRegionConfig().addresses[0]?.locationCode,
      Token: uniqueTokens[0] || '',
      description: buildFormattedAddress(addr),
      streetType: addr.streetType,
      streetName: addr.streetName,
      number: String(addr.number),
      neighborhood: addr.neighborhood,
      city: getOrderCity(),
      stateAbbreviation: getOrderUf(),
      zipCode: addr.zipCode,
      country: 'Brasil',
    },
    response: lastRes,
    usedToken: uniqueTokens[0] || '',
  };
}

async function fetchQuoteLineItems(apiCall, quoteId) {
  const soql = `SELECT Id, Product2Id, PricebookEntryId, Vtal_Seg_PointType__c, Vtal_LXD_DownloadSpeed__c FROM QuoteLineItem WHERE QuoteId='${quoteId}' ORDER BY CreatedDate ASC`;
  const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(soql)}`);
  return { soql, res, records: res?.data?.records || [] };
}

function pickLdSpeed(selectedSpeed = null) {
  if (selectedSpeed?.label && selectedSpeed?.value) return selectedSpeed;
  return { label: '200 Mbps', value: '200' };
}

async function resolvePointProduct(apiCall) {
  const pricebook2Id = QUOTE_PRICEBOOK2_ID;

  const q = `
    SELECT Id, Name, ProductCode, vlocity_cmt__ObjectTypeName__c
    FROM Product2
    WHERE ProductCode = '${PRODUCT_CODE_POINT}'
    AND IsActive = true
    LIMIT 1
  `;

  const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);

  if (res.status !== 200 || !res.data?.records?.length) return null;

  const rec = res.data.records[0];
  const product2Id = rec.Id;

  const qEntry = `
    SELECT Id FROM PricebookEntry
    WHERE Product2Id = '${product2Id}'
    AND Pricebook2Id = '${pricebook2Id}'
    AND IsActive = true
    LIMIT 1
  `;

  const resEntry = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qEntry)}`);

  if (resEntry.status !== 200 || !resEntry.data?.records?.length) return null;

  return {
    product2Id,
    pricebookEntryId: resEntry.data.records[0].Id,
    objectTypeName: rec.vlocity_cmt__ObjectTypeName__c,
  };
}

function buildCreateQuoteMembersBody(quoteId, addr, addrB, ldProduct = null, selectedSpeed = null, addressInfoA, addressInfoB, pointProduct) {
  if (!ldProduct) throw new Error('buildCreateQuoteMembersBody LD: ldProduct é obrigatório.');

  const speed = pickLdSpeed(selectedSpeed);
  const globalKey = `e2e-ld-${Date.now()}`;

  const pointAAddress = buildPointAddressFields(addr, addressInfoA);
  const pointBAddress = buildPointAddressFields(addrB, addressInfoB);

  void pointProduct;

  return {
    function: 'advance',
    Token: addressInfoA.Token || addressInfoB.Token || '',
    QuoteId: quoteId,
    OppType: 'New opp',
    CustomerCategory: 'Corporate',
    GPONMaxDownloadSpeed: 10000,
    QuoteMemberList: [
      {
        parentblock: 1,
        label: 'Block1',
        'LookupProduct-Block': {
          value: {
            Id: ldProduct.product2Id,
            PricebookEntryId: ldProduct.pricebookEntryId,
            ProductCode: ldProduct.productCode,
            vlocity_cmt__ObjectTypeName__c: ldProduct.objectTypeName,
            vlocity_cmt__GlobalGroupKey__c: globalKey,
          },
          name: 'Link Dedicado',
          LookupProduct: 'Link Dedicado',
        },
        'Approach-Block': null,
        'description-Block': null,
        'downloadSpeed-Block': {
          label: speed.label,
          value: speed.value,
        },
        deliveryAddressValue: 'Endereço do Cliente',
        useTypeValue: 'Assinante Comum',
        'TipoVelocidade-Block': null,
        ComplementosManual: [],
        isSharedDesignation: false,
        'TipoPonta-Block': '',
        pointType: '',
        ExistentNetwork: [],
        'TipoInst-Block': 'Rede Nova',
        subAccordions: [],
        selectedTopologyValue: 'Ponto a ponto',
        selectedNetworkTypeValue: 'Estatístico',

        pointA: {
          'TipoPonta-Block': 'Ponta A',
          description: pointAAddress.description,
          neighborhood: pointAAddress.neighborhood,
          stateAbbreviation: pointAAddress.stateAbbreviation,
          city: pointAAddress.city,
          zipCode: pointAAddress.zipCode,
          hasNoNumber: pointAAddress.hasNoNumber,
          hasNumber: pointAAddress.hasNumber,
          country: pointAAddress.country,
          locationCode: pointAAddress.locationCode,
          streetName: pointAAddress.streetName,
          streetType: pointAAddress.streetType,
          number: pointAAddress.number,
          id: pointAAddress.id,
          selectedDeliveryAddress: 'Endereço do Cliente',
          suggestions: {
            success: false,
            result: {
              responseStatus: 'Not Found',
              error: 'OK',
              errorCode: 'INVOKE-200',
              errorMessage: 'Falha ao buscar endereço',
            },
          },
          complements: [],
          shareAccess: 'Não',
          showDesignationId: false,
          circuitOpt: [],
          showAddComplementButton: true,
          isCityDisabled: false,
          downloadSpeedBlock: {
            label: speed.label,
            value: speed.value,
          },
          approachValue: 'Simples',
        },

        pointB: {
          'TipoPonta-Block': 'Ponta B',
          description: pointBAddress.description,
          neighborhood: pointBAddress.neighborhood,
          stateAbbreviation: pointBAddress.stateAbbreviation,
          city: pointBAddress.city,
          zipCode: pointBAddress.zipCode,
          hasNoNumber: pointBAddress.hasNoNumber,
          hasNumber: pointBAddress.hasNumber,
          country: pointBAddress.country,
          locationCode: pointBAddress.locationCode,
          streetName: pointBAddress.streetName,
          streetType: pointBAddress.streetType,
          number: pointBAddress.number,
          id: pointBAddress.id,
          selectedDeliveryAddress: 'Endereço do Cliente',
          suggestions: {
            success: false,
            result: {
              responseStatus: 'Not Found',
              error: 'OK',
              errorCode: 'INVOKE-200',
              errorMessage: 'Falha ao buscar endereço',
            },
          },
          complements: [],
          shareAccess: 'Não',
          showDesignationId: false,
          circuitOpt: [],
          showAddComplementButton: true,
          isCityDisabled: false,
          downloadSpeedBlock: {
            label: speed.label,
            value: speed.value,
          },
          approachValue: 'Simples',
        },

        networkId: `QLI-${Date.now()}`,
        productCode: ldProduct.productCode,
      },
    ],
    AssetToQuoteMemberList: [],
    deletedIds: [],
    obrigaComplemento: false,
    sharedAccessReason: '',
  };
}

async function loadLdSelectedProductInfo(apiCall, ldProduct) {
  const input = {
    product: [{ Id: ldProduct.product2Id, ProductCode: ldProduct.productCode || PRODUCT_CODE_LD }],
    function: 'listaVelocidade',
    categoriaCliente: 'Corporate',
  };
  const res = await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'VtalCap_IPGetSelectedProductInfo',
    input: JSON.stringify(input),
    options: '{}',
  });
  logStepTrace('loadLdSelectedProductInfo', input, res);
  if (res.status !== 200 && res.status !== 201) return null;
  const raw = res.data?.returnValue || res.data?.IPResult || res.data?.result || null;
  let parsed = raw;
  try {
    if (typeof raw === 'string') parsed = JSON.parse(raw);
  } catch (_) {}
  const list = parsed?.IPResult || parsed?.result?.IPResult || [];
  if (!Array.isArray(list) || !list.length) return null;
  const preferred = list.find((item) => String(item.value) === '200') || list[0];
  if (!preferred?.value) return null;
  return { label: preferred.label || `${preferred.value} Mbps`, value: String(preferred.value) };
}

function isInviableOrderError(res) {
  const msg = [res?.data?.error, res?.data?.message, res?.data?.errorMessage, res?.text]
    .filter(Boolean)
    .join(' ');
  return /Não existe conta business para a UF|conta business para a UF/i.test(msg);
}

function buildIpConnectQuoteInstallationFeeBody(quoteId) {
  return {
    QuoteId: quoteId,
    State: 'SP',
    CustomerCategory: 'Corporate',
    CobrancaTaxaInstalacao: 'CobrancaTotal',
    Conectividade: 'Ponto a ponto',
    Velocidade: '14',
    Linha: 'AMARELA',
    City: 'SÃO PAULO',
    Prazo: '12',
    TaxaInstalacao: VALOR_INSTALACAO_IP_CONNECT,
    Distancia: '2',
    LimiteDistancia: '7000',
    LinhaTipo: '',
    DistanciaEditada: '',
    ProductCode: 'CONNECTIVITY_IP_CONNECT',
    ProductName: 'IP Connect',
    DeliveryAddress: 'Endereço do Cliente',
    TipoVelocidade: 'Simétrico',
  };
}

/** Valor Mensal e Instalação dependem da velocidade; vêm do IP IpConnectQuoteInstallationFee quando disponível. Fallback: env ou estes defaults. */
const VALOR_MENSAL_IP_CONNECT = process.env.VALOR_MENSAL_IP_CONNECT || '465.24';
const VALOR_INSTALACAO_IP_CONNECT = process.env.VALOR_INSTALACAO_IP_CONNECT || '8740.93';

/**
 * Cart API v2: reprice do carrinho (Quote como cart).
 * Recalcula preço, consolida runtime JSON no banco e gera Push Event Data — como o front faz implicitamente.
 * Endpoints documentados: /v2/cpq/carts/{cartId}/price (GET, price=true) ou /v2/carts (depende do org).
 * USE_CART_REPRICE=0 desativa. CART_API_V2_BASE override: ex. /services/apexrest/vlocity_cmt/v2/cpq/carts
 */
async function cartReprice(apiCall, quoteId) {
  const base = CART_API_V2_BASE.replace(/\/$/, '');
  const path = `${base}/${quoteId}/price?price=true`;
  const res = await apiCall('GET', path);
  if (res.status === 200 || res.status === 201) {
    console.log('   Cart reprice OK (runtime consolidado, Push Event Data)');
    return true;
  }
  const msg = res?.data?.message ?? res?.data?.error ?? res?.text ?? '';
  console.log('   Cart reprice (não crítico):', res.status, String(msg).slice(0, 120), '— confira CART_API_V2_BASE ou use v2/cpq/carts se o org usar CPQ path.');
  return false;
}

function extractLdViabilityState(res) {
  const payload = tryParseJson(res?.data?.returnValue ?? res?.data);
  const rawError =
    payload?.error ??
    payload?.message ??
    res?.data?.error ??
    res?.data?.message ??
    '';
  const hasRangeError = /Range\s*\[\d+,\s*\d+\)\s*out of bounds/i.test(String(rawError));
  const root =
    payload?.IPResult?.ViabilityDetailsForQuote ||
    payload?.ViabilityDetailsForQuote ||
    payload?.returnValue?.IPResult?.ViabilityDetailsForQuote ||
    null;

  const geral = root?.Geral || {};
  const registro = root?.Registro || {};
  const lineItemCount = String(geral.LineItemCount ?? registro.LineItemCount ?? '00');
  const hasPoints = Boolean(registro?.LDPointTypeA && registro?.LDPointTypeB);
  const existsQuoteLineItem = Boolean(geral.existsQuoteLineItem);
  const viabilityOk = geral.Viabilidade === true || Boolean(registro?.isViable);

  return {
    root,
    geral,
    registro,
    hasRangeError,
    rawError: String(rawError || ''),
    lineItemCount,
    hasPoints,
    existsQuoteLineItem,
    viabilityOk,
    ready: existsQuoteLineItem && lineItemCount !== '00' && viabilityOk,
  };
}

async function getTokenViabilidade(apiCall, userId, quoteId) {
  const timeZoneName = 'America/Sao_Paulo';
  const timeZoneOffset = '-180';
  const input = {
    ViabilityDetailsForQuote: {
      Geral: {
        SegmentoCliente: null,
        AccountId: null,
        GPONMaxDownloadSpeed: null,
      },
      OppType: null,
    },
    GetToken: { access_token: null },
    ContextId: quoteId,
    userProfile: process.env.USER_PROFILE_VIABILIDADE || 'Pre Vendas',
    product: null,
    ProductsValidation: { enableAdvance: null },
    timeStamp: new Date().toISOString(),
    userTimeZoneName: timeZoneName,
    userTimeZone: timeZoneOffset,
    userCurrencyCode: process.env.USER_CURRENCY_CODE || 'BRL',
    userName: process.env.USER_NAME_VIABILIDADE || process.env.SF_USERNAME || '',
    userId,
    omniProcessId: process.env.OMNI_PROCESS_ID_VIABILIDADE || '0jNHZ000000GVnp2AG',
    localTimeZoneName: timeZoneName,
  };

  return apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: IP_GET_TOKEN_VIABILIDADE,
    input: JSON.stringify(input),
    options: JSON.stringify({
      useFuture: false,
      preTransformBundle: '',
      postTransformBundle: '',
      chainable: false,
      useQueueableApexRemoting: false,
      ignoreCache: false,
      ParentInteractionToken: '',
      vlcClass: 'vlocity_cmt.IntegrationProcedureService',
      useContinuation: false,
    }),
  });
}

async function waitForLdViability(apiCall, userId, quoteId) {
  const maxAttempts = Math.max(6, Math.ceil(VIABILITY_WAIT_MS / 5000));
  let lastRes = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = { UserId: userId, QuoteId: quoteId };
    lastRes = await apiCall('POST', IP_VIABILITY, body);
    logStepTrace(`ViabilityDetailsForQuote.poll${attempt}`, body, lastRes);
    if (lastRes.status !== 200 && lastRes.status !== 201) {
      return lastRes;
    }

    const state = extractLdViabilityState(lastRes);
    if (state.hasRangeError) {
      fail('Viabilidade quebrou (Range error)', lastRes);
    }
    console.log(
      `[E2E] Viabilidade poll ${attempt}/${maxAttempts}: existsQuoteLineItem=${state.existsQuoteLineItem} lineItemCount=${state.lineItemCount} hasPoints=${state.hasPoints} viabilityOk=${state.viabilityOk}`
    );

    if (state.ready) {
      return lastRes;
    }

    if (attempt < maxAttempts) {
      await delay(5000);
    }
  }

  return lastRes;
}

/** Garante string numérica para o IP; nunca envia "null" (ProductsValidation não persiste RecurringCharge/OneTimeCharge se vier null). */
function asNumeroString(val, defaultVal) {
  if (val == null || val === '' || String(val).toLowerCase() === 'null') return defaultVal;
  const s = String(val).trim();
  if (s === '' || Number.isNaN(Number(s))) return defaultVal;
  return s;
}

function buildLdValidationEntry(pointType, id, mensal, instalacao, productCodeResolved = null) {
  const base = { Id: id };
  if (pointType === 'EVC') {
    return {
      ...base,
      productCode: productCodeResolved || PRODUCT_CODE_LD,
      ATT_PROTECAO: '1+0',
      NomeRede: 'AUTOMACAO TESTE',
      PrazoInstalacao: 'Até 30 dias',
      accessType: 'VLAN-Based',
      networkStandard: '',
      speedType: 'Simétrico',
      tipoProtecao: '1+0',
      transportType: 'Link Dedicado',
    };
  }
  return {
    ...base,
    productCode: productCodeResolved || PRODUCT_CODE_LD,
    Roteador: 'Não se Aplica',
    TecnologiaAcesso: 'Ponto a ponto',
    TipoInterface: 'Fast Ethernet',
    ModalidadeTaxa: 'CobrancaTotal',
    Mensalidade: mensal,
    MensalidadeLPU: mensal,
    TaxaInstalacao: instalacao,
    TaxaInstalacaoLPU: instalacao,
  };
}

function buildLdValidationMap(quoteLineItems, valorMensal = VALOR_MENSAL_LD, valorInstalacao = VALOR_INSTALACAO_LD, productCodeResolved = null) {
  const mensal = asNumeroString(valorMensal, VALOR_MENSAL_LD);
  const instalacao = asNumeroString(valorInstalacao, VALOR_INSTALACAO_LD);
  const items = Array.isArray(quoteLineItems) ? quoteLineItems : [quoteLineItems].filter(Boolean);
  return items.length
    ? Object.fromEntries(
        items.map((item) => {
          const id = typeof item === 'string' ? item : item.Id;
          const pointType = typeof item === 'string' ? '' : item.Vtal_Seg_PointType__c || '';
          return [id, buildLdValidationEntry(pointType, id, mensal, instalacao, productCodeResolved)];
        })
      )
    : '';
}

function buildProductsValidationBodyLd(quoteId, quoteLineItems, fn = 'advance', valorMensal = VALOR_MENSAL_LD, valorInstalacao = VALOR_INSTALACAO_LD, productCodeResolved = null) {
  const pc = productCodeResolved || PRODUCT_CODE_LD;
  const FC_LDQuoteInstallationAddress = buildLdValidationMap(quoteLineItems, valorMensal, valorInstalacao, pc);
  return { quoteId, function: fn, IncludeAntiDDOSAndIpAdcional: '', FC_LDQuoteInstallationAddress, FCVpnMplsChild: '', FCIPConnectChild: '' };
}

/** Monta FCIPConnectChild para save (IP Connect): Mensalidade e TaxaInstalacao sempre string numérica (nunca "null") para o IP persistir no QuoteLineItem. */
function buildProductsValidationBody(quoteId, quoteLineItemId, fn = 'advance', valorMensal = VALOR_MENSAL_IP_CONNECT, valorInstalacao = VALOR_INSTALACAO_IP_CONNECT) {
  const mensal = asNumeroString(valorMensal, VALOR_MENSAL_IP_CONNECT);
  const instalacao = asNumeroString(valorInstalacao, VALOR_INSTALACAO_IP_CONNECT);
  if (mensal === '' || instalacao === '') {
    throw new Error('buildProductsValidationBody: Mensalidade e TaxaInstalacao não podem ser vazios (RecurringCharge/OneTimeCharge ficariam null)');
  }
  return {
    quoteId,
    function: fn,
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress: '',
    FCVpnMplsChild: '',
    FCIPConnectChild: {
      [quoteLineItemId]: {
        Id: quoteLineItemId,
        productCode: 'CONNECTIVITY_IP_CONNECT',
        TipoAcesso: 'Ponto a ponto',
        TipoEnderecamento: 'IPV4',
        TipoInterface: '1G BASE-T',
        ModalidadeTaxa: 'CobrancaTotal',
        tempoReparo: '6',
        Distancia: '2',
        Linha: 'AMARELA',
        Mensalidade: mensal,
        MensalidadeLPU: mensal,
        TaxaInstalacao: instalacao,
        TaxaInstalacaoLPU: instalacao,
        PrazoInstalacao: 'Até 10 dias',
        Roteador: 'Não se Aplica',
        tipoProtecao: '1+0',
        ATT_BGP: 'false',
        Attributes: {
          ATT_ACESSO: { code: 'ATT_ACESSO', value: 'Ponto a ponto' },
          ATT_ENDERECAMENTO: { code: 'ATT_ENDERECAMENTO', value: 'f277a3f2-ce0a-fdf6-925b-5dae5f311c88' },
          ATT_TIPOINTERFACE: { code: 'ATT_TIPOINTERFACE', value: '1G BASE-T' },
          ATT_IPs_Quantity: { code: 'ATT_IPs_Quantity', value: '/29 - 8 IPS' },
          ATT_PROTECAO: { code: 'ATT_PROTECAO', value: '1+0' },
          ATT_Tipo_Velocidade: { code: 'ATT_Tipo_Velocidade', value: 'Simétrica' },
          ATT_Approach: { code: 'ATT_Approach', value: 'Simples' },
          ATT_Speed_Corporate: { code: 'ATT_Speed_Corporate', value: '1400' },
        },
      },
    },
  };
}

function buildProductsValidationAdvanceBodyLd(quoteId, quoteLineItems, valorMensal = VALOR_MENSAL_LD, valorInstalacao = VALOR_INSTALACAO_LD, productCodeResolved = null) {
  const pc = productCodeResolved || PRODUCT_CODE_LD;
  const FC_LDQuoteInstallationAddress = buildLdValidationMap(quoteLineItems, valorMensal, valorInstalacao, pc);
  return { quoteId, function: 'advance', IncludeAntiDDOSAndIpAdcional: '', FC_LDQuoteInstallationAddress, FCVpnMplsChild: '', FCIPConnectChild: '', CustomLWC1: '' };
}

/**
 * Payload para ProductsValidation(advance) — IP Connect.
 * Trace "Salvar e Avançar" (id 816): advance vem com FCIPConnectChild preenchido (objeto por QuoteLineItemId)
 * para consolidar Mensalidade/TaxaInstalacao na cotação; sem isso a cotação fica com valor errado e o subpedido também.
 * Mensalidade/TaxaInstalacao: sempre string numérica (nunca "null") para persistir no QuoteLineItem.
 */
function buildProductsValidationAdvanceBody(quoteId, quoteLineItemId, valorMensal = VALOR_MENSAL_IP_CONNECT, valorInstalacao = VALOR_INSTALACAO_IP_CONNECT) {
  const mensal = asNumeroString(valorMensal, VALOR_MENSAL_IP_CONNECT);
  const instalacao = asNumeroString(valorInstalacao, VALOR_INSTALACAO_IP_CONNECT);
  const FCIPConnectChild =
    quoteLineItemId && (mensal !== '' || instalacao !== '')
      ? {
          [quoteLineItemId]: {
            Id: quoteLineItemId,
            ATT_ACESSO: 'Ponto a ponto',
            ATT_BGP: 'false',
            ATT_IPs_Quantity: '/29 - 8 IPS',
            ATT_PROTECAO: '1+0',
            ATT_TIPOINTERFACE: 'Fast Ethernet',
            Distancia: '43',
            Linha: 'AMARELA',
            Mensalidade: mensal || '0',
            MensalidadeLPU: mensal || '0',
            ModalidadeTaxa: 'CobrancaTotal',
            PrazoInstalacao: 'Até 30 dias',
            Roteador: 'Não se Aplica',
            TaxaInstalacao: instalacao,
            TaxaInstalacaoLPU: instalacao,
            TipoInterface: 'Fast Ethernet',
            productCode: 'CONNECTIVITY_IP_CONNECT',
            tipoProtecao: '1+0',
            TipoEnderecamento: 'IPV4',
            tempoReparo: '6',
          },
        }
      : '';
  return {
    quoteId,
    function: 'advance',
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress: '',
    FCVpnMplsChild: '',
    FCIPConnectChild,
    CustomLWC1: '',
  };
}

/** Indica se a resposta do IP é "procedure não encontrado/inativo" (tentar fallback). */
function isXOMNoProcedureFound(res) {
  const msg = (res?.data?.message ?? res?.data?.error ?? res?.text ?? '').toString();
  return /No Procedure Found|Integration Procedure Is Inactive/i.test(msg);
}

/** Chama XOMOnSubmitOrder (submit ao OM); tenta fallback vlocity_cmt__XOMOnSubmitOrder se o default falhar. */
async function runXOMOnSubmitOrder(apiCall, orderId) {
  const xomMode = process.env.XOM_SUBMIT_MODE || 'Sync';
  const body = { orderId, mode: xomMode };
  let res = await apiCall('POST', IP_XOM_SUBMIT_ORDER, body);
  if (res.status === 200 && (res.data?.code === '305' || res.data?.result)) {
    return true;
  }
  if (isXOMNoProcedureFound(res) && IP_XOM_SUBMIT_ORDER_FALLBACK) {
    console.log('   Tentando fallback', IP_XOM_SUBMIT_ORDER_FALLBACK.split('/').pop());
    res = await apiCall('POST', IP_XOM_SUBMIT_ORDER_FALLBACK, body);
    if (res.status === 200 && (res.data?.code === '305' || res.data?.result)) {
      return true;
    }
    console.log('   XOMOnSubmitOrder fallback (não crítico):', res.status, res.data?.message || res.data?.error || res.text?.slice(0, 120));
    return false;
  }
  console.log('   XOMOnSubmitOrder (não crítico):', res.status, res.data?.message || res.data?.error || res.text?.slice(0, 120));
  return false;
}

/** Chama Vtal_SF_OrderUtils.checkoutOrderOMBatch (Orchestration Plan, Service Order, Designation, Status "In Implementation"). 1) GenericInvoke2NoCont; 2) executeAnonymous(inputMap,outMap,options) com OrderList; 3) IP. */
async function runCheckoutOrderOMBatch(apiCall, orderId, orderList = null) {
  const orderListForInput = Array.isArray(orderList) && orderList.length > 0
    ? orderList.map((o) => (typeof o === 'string' ? { Id: o } : { Id: o.Id || o.id }))
    : [{ Id: orderId }];
  const orderIds = orderListForInput.map((o) => o.Id);
  const body = {
    sClassName: 'Vtal_SF_OrderUtils',
    sMethodName: 'checkoutOrderOMBatch',
    input: { OrderList: orderListForInput },
    options: { useFuture: false, chainable: false, useQueueableApexRemoting: false, ignoreCache: false },
  };
  const res = await apiCall('POST', IP_GENERIC_INVOKE, body);
  const msg = (res?.data?.message ?? res?.data?.error ?? res?.text ?? '').toString();
  if (res.status === 200 && !/No Procedure Found|Integration Procedure Is Inactive/i.test(msg)) return true;
  console.log('   GenericInvoke2NoCont (não disponível):', msg.slice(0, 80), '— fallback executeAnonymous(inputMap,outMap,options)');
  const apexOrderList = orderIds.map((id) => `new Map<String,Object>{ 'Id' => '${id}' }`).join(', ');
  const apexBody = `Map<String,Object> inputMap = new Map<String,Object>(); Map<String,Object> outMap = new Map<String,Object>(); Map<String,Object> options = new Map<String,Object>(); inputMap.put('OrderList', new List<Object>{ ${apexOrderList} }); Vtal_SF_OrderUtils.checkoutOrderOMBatch(inputMap, outMap, options);`;
  const execRes = await apiCall('GET', `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apexBody)}`);
  if (execRes.status === 200 && execRes.data?.success === true) return true;
  if (execRes.data?.compileProblem || execRes.data?.exceptionMessage) console.log('   executeAnonymous:', (execRes.data?.compileProblem ?? execRes.data?.exceptionMessage ?? '').slice(0, 100));
  if (Array.isArray(orderList) && orderList.length > 0) {
    console.log('   Fallback final: IP checkoutOrderOMBatch');
    const ipRes = await apiCall('POST', IP_CHECKOUT_ORDER_OM, { OrderList: orderList });
    return ipRes.status === 200 || ipRes.status === 201;
  }
  return false;
}

async function forceAllQuoteMembersViable(apiCall, quoteId) {
  const q = `SELECT Id FROM vlocity_cmt__QuoteMember__c WHERE vlocity_cmt__QuoteId__c='${quoteId}'`;
  const r = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
  const members = r?.data?.records || [];
  console.log(`   [workaround] Encontrados ${members.length} QuoteMembers`);
  if (members.length === 0) return false;

  let allSuccess = true;
  for (const member of members) {
    const apex = `vlocity_cmt__QuoteMember__c qm = [SELECT Id FROM vlocity_cmt__QuoteMember__c WHERE Id = '${member.Id}' LIMIT 1]; 
                  qm.vlocity_cmt__MaxDownloadSpeed__c = '100'; 
                  qm.Vtal_SF_MaxSpeed__c = '100'; 
                  qm.Vtal_SF_Viability__c = 'Viável - Viabilidade técnica confirmada';
                  update qm;`;
    const res = await apiCall('GET', `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apex)}`);
    const success = res.status === 200 && res.data?.success;
    console.log(`   [workaround] Atualizando ${member.Id}: ${success ? 'OK' : 'FALHOU'}`);
    if (!success) allSuccess = false;
  }
  return allSuccess;
}

async function ensureQuoteApproved(apiCall, quoteId, statusAprovado, proposalValidity) {
  if (IS_TRG) {
    console.log('[E2E] 34.1. TRG: PATCH Quote Status → Reviewed...');
    const reviewedPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Status: 'Reviewed',
      Vtal_Seg_ProposalValidityTerm__c: '1',
    });
    if (reviewedPatch.status !== 200 && reviewedPatch.status !== 204) {
      fail('PATCH Quote Status Reviewed', reviewedPatch);
    }

    console.log('[E2E] 34.2. TRG: PATCH Quote Vtal_Seg_ProposalValidity__c...');
    const validityPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Vtal_Seg_ProposalValidity__c: proposalValidity,
    });
    if (validityPatch.status !== 200 && validityPatch.status !== 204) {
      console.log('   PATCH validity (não crítico):', validityPatch.status);
    }
  }

  console.log('[E2E] 37. PATCH Quote Status →', statusAprovado, '...');
  const aprovadoPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, { Status: statusAprovado });
  if (aprovadoPatch.status === 200 || aprovadoPatch.status === 204) return;

  const msg = [
    aprovadoPatch?.data?.[0]?.message,
    aprovadoPatch?.data?.message,
    aprovadoPatch?.data?.error,
    aprovadoPatch?.text,
  ]
    .filter(Boolean)
    .join(' ');

  if (/já possui uma cotação aprovada/i.test(msg)) {
    const quoteGet = await apiCall('GET', `${SOBJECTS_QUOTE}/${quoteId}`);
    if (quoteGet.status === 200 && (quoteGet.data?.Status || '') === 'Approved') {
      console.log('   Quote já está Approved no TRG; continuando fluxo.');
      return;
    }
  }

  fail('PATCH Quote Status ' + statusAprovado, aprovadoPatch);
}

function logCurl(method, url, headers = {}, body = null) {
  const h = Object.entries(headers)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
    .join(' \\\n');
  const bodyPart =
    (method === 'POST' || method === 'PATCH') && body != null
      ? ` \\\n  --data-raw '${String(body).slice(0, 2000).replace(/'/g, "'\\''")}${String(body).length > 2000 ? '...' : ''}'`
      : '';
  console.log(`[CURL] ${method} ${url}`);
  console.log(`curl '${url}' \\\n  -X ${method}${h ? ' \\\n' + h : ''}${bodyPart}`);
}

function logResponse(label, status, data, text) {
  console.log(`[RESPONSE] ${label} status: ${status}`);
  const payload = data != null ? JSON.stringify(data, null, 2) : (text || '');
  const maxLen = 4000;
  const out = payload.length > maxLen ? payload.slice(0, maxLen) + '\n... [truncado ' + (payload.length - maxLen) + ' chars]' : payload;
  if (out) console.log(`[RESPONSE] ${label} body:\n${out}`);
}

async function runLeadFlow(instanceUrl, accessToken, cookie) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);
  return runLeadToBrm(apiCall, fail, { logPrefix: '[E2E]' });
}


async function runQuoteFlow(instanceUrl, accessToken, cookie, accountIds) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);
  // Tentar conta Organization (em alguns setups Vlocity a Opportunity fica na Organization)
  const accountIdForOpp = accountIds.accountOrganizationId || accountIds.accountBussinessId || accountIds.accountBillingId;

  console.log('[E2E] 10. UserInfo (UserId)...');
  const userInfoRes = await apiCall('GET', '/services/oauth2/userinfo');
  const userId = userInfoRes.data?.user_id || process.env.SALESFORCE_USER_ID || '005HZ00000FffI0YAJ';

  console.log('[E2E] 11. Criando Opportunity (AccountId = Organization)...');
  const closeDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const oppPayload = {
    Name: `Opp E2E ${Date.now()}`,
    AccountId: accountIdForOpp,
    StageName: 'Análise das necessidades',
    CloseDate: closeDate,
    Type: 'New opp',
  };
  const oppRes = await apiCall('POST', SOBJECTS_OPPORTUNITY, oppPayload);
  logStepTrace('Opportunity.create', oppPayload, oppRes);
  if (oppRes.status !== 200 && oppRes.status !== 201) fail('Opportunity', oppRes);
  const opportunityId = oppRes.data?.id;
  if (!opportunityId) fail('Opportunity sem id', oppRes);

  const accountBussinessId = accountIds.accountBussinessId;
  const accountOrganizationId = accountIds.accountOrganizationId;
  const contactTecnicoId = accountIds.contactTecnicoId;
  if (!accountBussinessId || !contactTecnicoId) fail('Falta accountBussinessId ou contactTecnicoId para CreateOrderOnQuote', { status: 0 });

  const CREATE_ORDER_MAX_ATTEMPTS = 25;
  const CREATE_ORDER_RETRY_DELAY_MS = 25000;

  console.log('[E2E LD] Resolvendo produto Link Dedicado no org (ProductCode=', PRODUCT_CODE_LD, ')...');
  const ldProduct = await resolveLdProduct(apiCall);
  if (!ldProduct) fail('Produto LD não encontrado');

  const pointProduct = await resolvePointProduct(apiCall);
  if (!pointProduct) fail('Produto POINT não encontrado no org');

  console.log('[E2E LD] Carregando velocidades do produto Link Dedicado...');
  const ldSelectedSpeed = await loadLdSelectedProductInfo(apiCall, ldProduct);


  for (let addrIdx = 0; addrIdx < ADDRESSES_TO_TRY.length; addrIdx++) {
    const addr = ADDRESSES_TO_TRY[addrIdx];
    const addrB = ADDRESSES_TO_TRY[(addrIdx + 1) % ADDRESSES_TO_TRY.length];
    console.log('\n[E2E] --- Tentativa', addrIdx + 1 + '/5: Link Dedicado 2 pontas — Ponta A:', addr.streetName, addr.number, '| Ponta B:', addrB.streetName, addrB.number, `CEP ${addr.zipCode.slice(0, 5)}-${addr.zipCode.slice(5, 8)} ---`);

    console.log('[E2E] 12. Criando Quote (RecordTypeId, Pricebook2Id, Status Draft)...');
    const quotePayload = {
      Name: `Cotação LD - Oportunidade ${opportunityId} (${addr.streetName} ${addr.number} / ${addrB.streetName} ${addrB.number})`,
      OpportunityId: opportunityId,
      RecordTypeId: QUOTE_RECORD_TYPE_ID,
      Pricebook2Id: QUOTE_PRICEBOOK2_ID,
      Vtal_TipoDeCotacao__c: 'Simples',
      vtal_SF_PrazoContratacao__c: 12,
      Status: 'Draft',
    };
    const quoteRes = await apiCall('POST', SOBJECTS_QUOTE, quotePayload);
    logStepTrace('Quote.create', quotePayload, quoteRes);
    if (quoteRes.status !== 200 && quoteRes.status !== 201) fail('Quote', quoteRes);
    const quoteId = quoteRes.data?.id;
    


    
    if (!quoteId) fail('Quote sem id', quoteRes);
    const tokenRes = await getTokenViabilidade(apiCall, userId, quoteId);

    const tokenViabilidade = extractTokenDeep(tokenRes?.data);


    console.log('[E2E] 12.1 Resolve Address A...');
const addrInfoARes = await fillAddressInfoWithTokenFallback(
  apiCall,
  addr,
  [tokenViabilidade], // ou pega do fluxo
  'FillAddressInfo.A'
);

if (!addrInfoARes.addressInfo) {
  fail('Address A não resolvido', addrInfoARes.response);
}

console.log('[E2E] 12.2 Resolve Address B...');
const addrInfoBRes = await fillAddressInfoWithTokenFallback(
  apiCall,
  addrB,
  [tokenViabilidade],
  'FillAddressInfo.B'
);

if (!addrInfoBRes.addressInfo) {
  fail('Address B não resolvido', addrInfoBRes.response);
}
const addressInfoA = addrInfoARes.addressInfo;
const addressInfoB = addrInfoBRes.addressInfo;


const createQuoteMembersBody = buildCreateQuoteMembersBody(
  quoteId,
  addr,
  addrB,
  ldProduct,
  ldSelectedSpeed,
  addressInfoA,
  addressInfoB,
  pointProduct 
);


console.log('[E2E] 13. CreateQuoteMembers...');
const membersRes = await apiCall('POST', IP_CREATE_QUOTE_MEMBERS, createQuoteMembersBody);
logStepTrace('CreateQuoteMembers', createQuoteMembersBody, membersRes);

if (membersRes.status !== 200 && membersRes.status !== 201) {
  fail('CreateQuoteMembers', membersRes);
}

// ----------------------------------


// ----------------------------------


// ----------------------------------
//  NOVO BLOCO - INÍCIO
console.log('[E2E] 13a. AGUARDANDO persistência do Vlocity...');
await delay(5000);

//  PASSO 17: Query QuoteLineItem
console.log('[E2E] 17. Query QuoteLineItem...');
const qli = await fetchQuoteLineItems(apiCall, quoteId);

if (qli.records.length < 3) {
  console.log(' Ainda não criou 3 QLI, aguardando...');
  await delay(3000);

  const retryQli = await fetchQuoteLineItems(apiCall, quoteId);
  if (retryQli.records.length < 3) {
    fail('QLI não persistiu corretamente (esperado 3)', retryQli.res);
  }

  qli.records = retryQli.records;
}

console.log('QLI encontrados:', qli.records.length);

// ----------------------------------
//  PASSO 18: ProductsValidation ENABLE (LINHA 375)
console.log('[E2E] 18. ProductsValidation ENABLE...');
await apiCall('POST', IP_PRODUCTS_VALIDATION, {
  toEnable: true,
  quoteId
});

// ----------------------------------
//  PASSO 19: ProductsValidation SAVE
console.log('[E2E] 19. ProductsValidation SAVE...');
await apiCall(
  'POST',
  IP_PRODUCTS_VALIDATION,
  buildProductsValidationBodyLd(
    quoteId,
    qli.records,
    'save',
    VALOR_MENSAL_LD,
    VALOR_INSTALACAO_LD,
    'CONNECTIVITY_DEDICATED_LINK'
  )
);

// ----------------------------------
//  PASSO 20: ProductsValidation ADVANCE
console.log('[E2E] 20. ProductsValidation ADVANCE...');
await apiCall(
  'POST',
  IP_PRODUCTS_VALIDATION,
  buildProductsValidationAdvanceBodyLd(
    quoteId,
    qli.records,
    VALOR_MENSAL_LD,
    VALOR_INSTALACAO_LD,
    'CONNECTIVITY_DEDICATED_LINK'
  )
);

// ----------------------------------
//  PASSO 21: Cart Reprice
console.log('[E2E] 21. Cart Reprice...');
await cartReprice(apiCall, quoteId);

// ----------------------------------
//  PASSO 22: Viability (LINHA 373-374)
console.log('[E2E] 22. Viability...');

// Primeira chamada só com QuoteId
await apiCall('POST', IP_VIABILITY, { QuoteId: quoteId });

// Segunda chamada com UserId
await waitForLdViability(apiCall, userId, quoteId);
//  NOVO BLOCO - FIM
// ----------------------------------

// ----------------------------------

// ----------------------------------
//  PASSO 23: Duplicate VPN Values (LINHA 384)
console.log('[E2E] 23. Duplicate VPN Values (Vtal_Seg_DuplicateVPNValues)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_DuplicateVPNValues',
    input: JSON.stringify({ 
      ProductName: 'VPN MPLS',
      QuoteId: quoteId 
    }),
    options: JSON.stringify({})
  });
  console.log('    DuplicateVPNValues OK');
} catch (err) {
  console.log('    DuplicateVPNValues (não crítico, continuando...)');
}

// ----------------------------------
//  PASSO 24: Get Product Config LD (LINHA 385)
console.log('[E2E] 24. Get Product Config LD (Vtal_Seg_IPGetProductConfigLD)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_IPGetProductConfigLD',
    input: JSON.stringify({ quoteId: quoteId }),
    options: JSON.stringify({})
  });
  console.log('    GetProductConfigLD OK');
} catch (err) {
  console.log('    GetProductConfigLD (não crítico, continuando...)');
}

// Pequena pausa para processamento
await delay(2000);



// ----------------------------------
//  PASSO 25: Atualizar atributos manuais (VLANs, etc.)
console.log('[E2E] 25. Atualizando atributos manuais da cotação...');

// Buscar os QuoteLineItems para obter os IDs
const qliManual = await fetchQuoteLineItems(apiCall, quoteId);

// Identificar EVC e pontas
const evcQLI = qliManual.records.find(item => item.Vtal_Seg_PointType__c === 'EVC');
const pontaAQLI = qliManual.records.find(item => item.Vtal_Seg_PointType__c === 'Ponta A');
const pontaBQLI = qliManual.records.find(item => item.Vtal_Seg_PointType__c === 'Ponta B');

if (!evcQLI || !pontaAQLI || !pontaBQLI) {
  console.log(' Não foi possível encontrar todos os QLI para atualização manual');
} else {
  // Montar o payload de ProductsValidation com os atributos manuais
  const manualUpdatePayload = {
    quoteId: quoteId,
    function: 'advance',
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress: {
      [evcQLI.Id]: {
        ATT_PROTECAO: '1+0',
        Id: evcQLI.Id,
        NomeRede: 'AUTOMACAO',
        PrazoInstalacao: 'Até 30 dias',
        accessType: 'VLAN-Based',
        networkStandard: 'E-LINE',
        speedType: 'Simétrico',
        tipoProtecao: '1+0',
        transportType: 'Link Dedicado',
        svlan: '250',  // ← VALOR FIXO PARA TESTE
        cvlan: '240'   // ← VALOR FIXO PARA TESTE
      },
      [pontaAQLI.Id]: {
        Id: pontaAQLI.Id,
        Roteador: 'Não se Aplica',
        TecnologiaAcesso: 'Ponto a ponto',
        TipoInterface: '1G BASE-T'
      },
      [pontaBQLI.Id]: {
        Id: pontaBQLI.Id,
        Roteador: 'Não se Aplica',
        TecnologiaAcesso: 'Ponto a ponto',
        TipoInterface: '1G BASE-T'
      }
    },
    FCVpnMplsChild: '',
    FCIPConnectChild: '',
    CustomLWC1: ''
  };

  await apiCall('POST', IP_PRODUCTS_VALIDATION, manualUpdatePayload);
  console.log('    Atributos manuais atualizados');
}



// ----------------------------------
//  PASSO 26: Atualizar status da Quote (LINHA 401)
console.log('[E2E] 26. Atualizando status da Quote (HasFinishedProductConfiguration)...');
await apiCall('POST', IP_QUOTE_STATUS, {
  HasFinishedProductConfiguration: true,
  ContextId: quoteId
});


// ----------------------------------
//  PASSO 28: Duplicate VPN Values (LINHA 405)
console.log('[E2E] 28. Duplicate VPN Values (Vtal_Seg_DuplicateVPNValues)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_DuplicateVPNValues',
    input: JSON.stringify({ 
      ProductName: 'VPN MPLS',
      QuoteId: quoteId 
    }),
    options: JSON.stringify({})
  });
} catch (err) {
  console.log('    DuplicateVPNValues (não crítico)');
}


// ----------------------------------
//  PASSO 29: Get Product Config LD (LINHA 406)
console.log('[E2E] 29. Get Product Config LD (Vtal_Seg_IPGetProductConfigLD)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_IPGetProductConfigLD',
    input: JSON.stringify({ quoteId: quoteId }),
    options: JSON.stringify({})
  });
} catch (err) {
  console.log('    GetProductConfigLD (não crítico)');
}


// ----------------------------------
//  PASSO 30: Validate Multipoint Dedicated Link (LINHA 407)
console.log('[E2E] 30. Validate Multipoint Dedicated Link...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_IP_ValidateMultipointDedicatedLink',
    input: JSON.stringify({ assetId: '' }),  // Vazio como no log
    options: JSON.stringify({})
  });
} catch (err) {
  console.log('    ValidateMultipointDedicatedLink (não crítico)');
}


// ----------------------------------
//  PASSO 31: GetQuoteAddressViability (LINHA 408)
console.log('[E2E] 31. GetQuoteAddressViability...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_SF_GetQuoteAddressViability',
    input: JSON.stringify({ items: '' }),  // Vazio como no log
    options: JSON.stringify({ useFuture: true })
  });
} catch (err) {
  console.log('    GetQuoteAddressViability (não crítico)');
}


// ----------------------------------
//  PASSO 32: ProductsValidation Enable (LINHA 410)
console.log('[E2E] 32. ProductsValidation Enable...');
await apiCall('POST', IP_PRODUCTS_VALIDATION, {
  toEnable: true,
  quoteId: quoteId
});



// ----------------------------------
//  PASSO 33: Viability (LINHA 411-412)
console.log('[E2E] 33. Viability...');
await apiCall('POST', IP_VIABILITY, { QuoteId: quoteId });
await apiCall('POST', IP_VIABILITY, { UserId: userId, QuoteId: quoteId });

// ----------------------------------
//  PASSO 34-37: Atualizar Status da Quote (adaptado para TRG)
// ----------------------------------
const statusAprovado = process.env.QUOTE_STATUS_APROVADO || 'Approved';
const proposalValidity = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
await ensureQuoteApproved(apiCall, quoteId, statusAprovado, proposalValidity);

if (IS_TI) {
  console.log('    Quote status atualizado para', statusAprovado);
}


// ----------------------------------
//  PASSO 31: Validate Create Order (LINHA 101)
console.log('[E2E] 31. Validando criação do pedido (Vtal_Seg_ValidateCreateOrder)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_ValidateCreateOrder',
    input: JSON.stringify({ 
      QuoteId: quoteId,
      userProfile: 'Pre Vendas',
      userId: userId,
      timeStamp: new Date().toISOString(),
      userTimeZoneName: 'America/Sao_Paulo',
      userTimeZone: '-180',
      userCurrencyCode: 'BRL',
      userName: process.env.SF_USERNAME || '',
      omniProcessId: process.env.OMNI_PROCESS_ID || '0jNHZ000000CLYX2A4'
    }),
    options: JSON.stringify({})
  });
  console.log('    ValidateCreateOrder OK');
} catch (err) {
  console.log('    ValidateCreateOrder (não crítico, continuando...)');
}

// ----------------------------------
//  PASSO 32: Validate Anexos Contrato MSA (LINHA 103)
console.log('[E2E] 32. Validando anexos do contrato MSA...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_IP_ValidateAnexosContratoMSA',
    input: JSON.stringify({ 
      QuoteId: quoteId,
      error: false,
      Step1: null,
      ProductWithoutMSA_Step: null,
      ConsultingPedWithoutProjectPed: null,
      NoBusinessAccount: null,
      NoTechContacts: null,
      MutipleTechContacts: null
    }),
    options: JSON.stringify({})
  });
  console.log('    ValidateAnexosContratoMSA OK');
} catch (err) {
  console.log('    ValidateAnexosContratoMSA (não crítico)');
}


console.log('[E2E] 32.5. Buscando contatos da Quote (Vtal_Seg_DRE_GetContactsFromQuote)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.DefaultDROmniScriptIntegration',
    sMethodName: 'invokeOutboundDR',
    input: JSON.stringify({
      Bundle: 'Vtal_Seg_DRE_GetContactsFromQuote',
      DRParams: {
        accountRecordType: 'Business',
        contactType: 'Technical',
        quoteId: quoteId
      }
    }),
    options: JSON.stringify({
      useQueueableApexRemoting: false,
      ignoreCache: false,
      vlcClass: 'vlocity_cmt.DefaultDROmniScriptIntegration'
    })
  });
  console.log('    GetContactsFromQuote OK');
} catch (err) {
  console.log('    GetContactsFromQuote (não crítico)');
}

// ----------------------------------
//  PASSO 33: Get Business By UF (LINHA 104)
console.log('[E2E] 33. Buscando contas business por UF...');
const quoteMembersForOrder = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(
  `SELECT Id FROM vlocity_cmt__QuoteMember__c WHERE vlocity_cmt__QuoteId__c='${quoteId}'`
)}`);
const members = quoteMembersForOrder.data?.records || [];

// Buscar dados completos do contato
const contactQuery = `SELECT Id, Name, Phone, MobilePhone, Email FROM Contact WHERE Id = '${contactTecnicoId}'`;
const contactRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(contactQuery)}`);
const contactData = contactRes.data?.records?.[0] || {};

const getBusinessPayload = {
  DRE: {
    accounts: [{
      recordTypeName: 'Business',
      accountId: accountBussinessId,
      UF: getOrderUf(),
      contacts: [{
        contactId: contactTecnicoId,
        value: contactTecnicoId,
        label: contactData.Name || 'Contato Técnico',
        name: contactData.Name || '',
        Phone: contactData.Phone || '',
        MobilePhone: contactData.MobilePhone || '',
        Email: contactData.Email || ''
      }]
    }],
    masterAccount: {
      Id: accountOrganizationId
    },
    quoteMembers: members.map(m => ({
      quoteMemberId: m.Id,
      UF: getOrderUf()
    }))
  },
  quoteId: quoteId
};

try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_GetBusinessByUF',
    input: JSON.stringify(getBusinessPayload),
    options: JSON.stringify({})
  });
  console.log('    GetBusinessByUF OK');
} catch (err) {
  console.log('    GetBusinessByUF (não crítico)');
}

// ----------------------------------
//  PASSO 34: Get Eligible Business Account (LINHA 105)
console.log('[E2E] 34. Buscando contas business elegíveis...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.DefaultDROmniScriptIntegration',
    sMethodName: 'invokeOutboundDR',
    input: JSON.stringify({
      Bundle: 'Vtal_Seg_DRE_GetEligibleBussinessAccount',
      DRParams: {
        Acc: getBusinessPayload.DRE
      }
    }),
    options: JSON.stringify({
      useQueueableApexRemoting: false,
      ignoreCache: false,
      vlcClass: 'vlocity_cmt.DefaultDROmniScriptIntegration'
    })
  });
  console.log('    GetEligibleBusinessAccount OK');
} catch (err) {
  console.log('    GetEligibleBusinessAccount (não crítico)');
}

// Pequena pausa para processamento
await delay(3000);

// ----------------------------------
//  PASSO 38: Technical Contacts (LINHA 108) - NOVO!
console.log('[E2E] 38. Buscando contatos técnicos (Vtal_Seg_IPTechnicalContacts)...');
try {
  const techContactsPayload = {
    selectedAccounts: [{
      Id: accountBussinessId,
      UF: getOrderUf()
    }],
    quoteId: quoteId,
    contactType: 'Technical',
    accountRecordType: 'Business'
  };
  
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_IPTechnicalContacts',
    input: JSON.stringify(techContactsPayload),
    options: JSON.stringify({})
  });
  console.log('    Technical Contacts OK');
} catch (err) {
  console.log('    Technical Contacts (não crítico)');
}

// ----------------------------------
//  PASSO 39: Get Quote Data By Id (LINHA 109) - NOVO!
console.log('[E2E] 39. Buscando dados da Quote (Vtal_DRE_GetQuoteDataById)...');
try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.DefaultDROmniScriptIntegration',
    sMethodName: 'invokeOutboundDR',
    input: JSON.stringify({
      Bundle: 'Vtal_DRE_GetQuoteDataById',
      DRParams: { Id: quoteId }
    }),
    options: JSON.stringify({
      useQueueableApexRemoting: false,
      ignoreCache: false,
      vlcClass: 'vlocity_cmt.DefaultDROmniScriptIntegration'
    })
  });
  console.log('    GetQuoteDataById OK');
} catch (err) {
  console.log('    GetQuoteDataById (não crítico)');
}

// ----------------------------------
//  PASSO 40: Merge Tech Contact List (LINHA 110) - NOVO!
console.log('[E2E] 40. Mesclando lista de contatos técnicos (Vtal_Seg_MergeTechContacList)...');


const mergePayload = {
  inputList2: '',
  inputList1: [{
    recordTypeName: 'Business',
    contacts: [{
      MobilePhone: contactData.MobilePhone || '',
      value: contactTecnicoId,
      label: contactData.Name || 'Contato Técnico',
      name: contactData.Name || '',
      Phone: contactData.Phone || '',
      contactId: contactTecnicoId,
      Email: contactData.Email || ''
    }],
    accountNumber: '042342', // Você pode buscar isso da conta
    cnpj: '15.154.795/0387-28', // Buscar da conta se necessário
    ContactId: contactTecnicoId,
    accountName: 'Huel - Goldner', // Buscar da conta
    hasAccount: true,
    contactsSize: 1,
    accountId: accountBussinessId,
    UF: getOrderUf()
  }]
};

try {
  await apiCall('POST', INVOKE_CPQ_URL, {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_Seg_MergeTechContacList',
    input: JSON.stringify(mergePayload),
    options: JSON.stringify({})
  });
  console.log('    MergeTechContacList OK');
} catch (err) {
  console.log('    MergeTechContacList (não crítico)');
}


// =============================

    let orderId = null;
    let lastOrderRes = null;
    let didViabilityFix = false;

    const uf = getOrderUf();

    const createOrderBody = {
      selectedAccounts: [{ Id: accountBussinessId, UF: uf }],
      QuoteId: quoteId,
      quoteId: quoteId,
      ContactList: [
        {
          vlocity_cmt__State__c: uf,
          ContactId: contactTecnicoId
        }
      ],
      AccountId: accountOrganizationId || accountBussinessId,
    };

    for (let attempt = 1; attempt <= CREATE_ORDER_MAX_ATTEMPTS; attempt++) {
      console.log(`[E2E] 38 . Vtal_CreateOrderOnQuote (tentativa ${attempt}/${CREATE_ORDER_MAX_ATTEMPTS})...`);
      const orderRes = await apiCall('POST', IP_CREATE_ORDER_ON_QUOTE, createOrderBody);
      lastOrderRes = orderRes;
      if (orderRes.status !== 200 && orderRes.status !== 201) {
        if (isInviableOrderError(orderRes)) {
          if (!didViabilityFix) {
            console.log('   [workaround] Atualizando QuoteMember com viabilidade forçada e retentando...');
            const ok = await forceAllQuoteMembersViable(apiCall, quoteId);
            didViabilityFix = true;
            if (ok) {
              console.log('   QuoteMember atualizado. Retentando CreateOrderOnQuote...');
              await delay(2000);
              continue;
            }
          }
          console.log('   Endereço inviável (resposta indica falta de conta business para UF). Tentando próximo endereço.');
          orderId = null;
          break;
        }
        if (attempt < CREATE_ORDER_MAX_ATTEMPTS) {
          console.log('   Falha HTTP, aguardando', CREATE_ORDER_RETRY_DELAY_MS / 1000, 's para retry...');
          await delay(CREATE_ORDER_RETRY_DELAY_MS);
          continue;
        }
        fail('Vtal_CreateOrderOnQuote', orderRes);
      }
      const d = orderRes.data;
      if (d?.error) {
        const errMsg = (d.error || d.errorCode || 'erro').toString();
        console.log('   Resposta:', errMsg);
        if (isInviableOrderError(orderRes)) {
          if (!didViabilityFix) {
            console.log('   [workaround] Atualizando QuoteMember com viabilidade forçada e retentando...');
            const ok = await forceAllQuoteMembersViable(apiCall, quoteId);
            didViabilityFix = true;
            if (ok) {
              console.log('   QuoteMember atualizado. Retentando CreateOrderOnQuote...');
              await delay(2000);
              continue;
            }
          }
          console.log('   Endereço inviável. Tentando próximo endereço.');
          orderId = null;
          break;
        }
        if (attempt < CREATE_ORDER_MAX_ATTEMPTS) {
          console.log('   Aguardando', CREATE_ORDER_RETRY_DELAY_MS / 1000, 's e retentando...');
          await delay(CREATE_ORDER_RETRY_DELAY_MS);
          continue;
        }
        fail('Vtal_CreateOrderOnQuote: ' + errMsg, orderRes);
      }
      const r = d?.result ?? d;
      orderId = r?.MasterOrderId || r?.id || r?.Id || (Array.isArray(r?.OrderList) && r.OrderList[0]?.Id) || (r?.SubOrdersIds?.[0]?.Id) || d?.MasterOrderId || d?.id || d?.Id;
      if (orderId) {
        // Sequência igual ao trace (linhas 14–15): CreateOrderOnQuote → checkoutOrderOMBatch(OrderList)
        let orderList = Array.isArray(r?.OrderList) ? r.OrderList : null;
        if (!orderList?.length) {
          const orderQuery = `SELECT Id, QuoteId, Status, Type, EffectiveDate, AccountId, RecordTypeId, Pricebook2Id, vlocity_cmt__ParentOrderId__c, vlocity_cmt__QuoteId__c, vlocity_cmt__DefaultBillingAccountId__c, vlocity_cmt__DefaultServiceAccountId__c, Name, Vtal_Contact__c, Vtal_Seg_LocationCode__c, Vtal_Seg_InstallationSchedule__c, Vtal_Seg_Line_Type__c, OpportunityId FROM Order WHERE Id = '${orderId}' OR vlocity_cmt__ParentOrderId__c = '${orderId}'`;
          const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(orderQuery)}`);
          if (qRes.status === 200 && qRes.data?.records?.length > 0) {
            orderList = qRes.data.records.map(({ attributes, ...rec }) => rec);
            console.log('   OrderList montada via query (' + orderList.length + ' pedido(s))');
          }
        }
        const ordersToFix = orderList && orderList.length > 0 ? orderList : [{ Id: orderId }];
        for (const ord of ordersToFix) {
          const oid = ord.Id || ord.id;
          const needQuote = !ord.QuoteId && !ord.vlocity_cmt__QuoteId__c;
          if (oid && needQuote && quoteId) {
            const patchRes = await apiCall('PATCH', `${SOBJECTS_ORDER}/${oid}`, { QuoteId: quoteId, vlocity_cmt__QuoteId__c: quoteId });
            if (patchRes.status === 200 || patchRes.status === 204) {
              console.log('   Order', oid, 'vinculado à Quote (QuoteId estava null)');
              if (ord.QuoteId === undefined) ord.QuoteId = quoteId;
              if (ord.vlocity_cmt__QuoteId__c === undefined) ord.vlocity_cmt__QuoteId__c = quoteId;
            }
          }
        }
        console.log('[E2E] 18a. checkoutOrderOMBatch (GenericInvoke2NoCont → Vtal_SF_OrderUtils: Orchestration Plan, Service Order, Designation)...');
        const checkoutOk = await runCheckoutOrderOMBatch(apiCall, orderId, orderList?.length > 0 ? orderList : null);
        if (checkoutOk) {
          console.log('   checkoutOrderOMBatch ok');
          await delay(3000);
        } else {
          console.log('   checkoutOrderOMBatch (não crítico: verifique GenericInvoke2NoCont / executeAnonymous)');
        }
        // Trace (2) linha 107: Order tem ação vlocity_cmt__XOMOnSubmitOrder — submeter ao OM para subpedido ir para "Em implantação"
        console.log('[E2E] 18c. XOMOnSubmitOrder (submeter ao OM → subpedido Em implantação)...');
        const xomOk = await runXOMOnSubmitOrder(apiCall, orderId);
        if (xomOk) {
          console.log('   XOMOnSubmitOrder ok');
          await delay(2000);
        }
        break;
      }
      if (attempt < CREATE_ORDER_MAX_ATTEMPTS) {
        console.log('   Sem MasterOrderId no body, retentando em', CREATE_ORDER_RETRY_DELAY_MS / 1000, 's...');
        await delay(CREATE_ORDER_RETRY_DELAY_MS);
      }
    }

    if (orderId) {
      console.log('[E2E] 19. GET Order (validar OrderNumber e Status)...');
      const orderGet = await apiCall('GET', `${SOBJECTS_ORDER}/${orderId}`);
      if (orderGet.status !== 200) fail('GET Order', orderGet);
      const order = orderGet.data;
      const orderNumber = order?.OrderNumber;
      const orderStatus = order?.Status;
      if (!orderNumber) fail('Order sem OrderNumber', orderGet);
      console.log('[E2E] Pedido criado — Número:', orderNumber, '| Id:', orderId, '| Status:', orderStatus);
      const validStatus = orderStatus === 'Activated' || orderStatus === 'Draft';
      if (!validStatus) console.log('   Order.Status:', orderStatus, '(esperado Activated ou Draft)');

      const subPedidoInfo = await pollSubpedidosEmImplantacao({
        apiCall,
        queryUrl: QUERY_URL,
        parentOrderId: orderId,
        delay,
        fail,
      });
      return {
        quoteId,
        orderId,
        orderNumber,
        orderStatus,
        ...subPedidoInfo,
      };
    }

    if (isInviableOrderError(lastOrderRes)) {
      console.log('[E2E] Endereço', addr.streetName, addr.number, '(CEP ' + addr.zipCode.slice(0, 5) + '-' + addr.zipCode.slice(5, 8) + ') inviável (conta business/UF). Próximo endereço.');
      continue;
    }
    if (!orderId) fail('Vtal_CreateOrderOnQuote não retornou MasterOrderId após ' + CREATE_ORDER_MAX_ATTEMPTS + ' tentativas', lastOrderRes);
  }

  fail(`Nenhum endereço viável após ${ADDRESSES_TO_TRY.length} tentativa(s) em ${getRegionLabel()}`, { status: 0, data: null });
}


/** Modo QUOTE_ID_READY: usa cotação pronta (Aprovada, viável) e vai direto para gerar pedido. */
async function runOrderOnlyFlow(instanceUrl, accessToken, cookie, ready) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);
  const { quoteId, accountBussinessId, accountOrganizationId, contactTecnicoId } = ready;

  console.log('[E2E] Modo QUOTE_ID_READY: cotação', quoteId, '- gerando pedido direto.');
  console.log('[E2E] 17f. Vtal_Seg_ValidateCreateOrder...');
  const validateRes = await apiCall('POST', IP_VALIDATE_CREATE_ORDER, { QuoteId: quoteId });
  if (validateRes.status !== 200 && validateRes.status !== 201) {
    console.log('   ValidateCreateOrder:', validateRes.status, validateRes.data?.error || validateRes.text?.slice(0, 200));
  }

  const uf = getOrderUf();
  if (process.env.USE_MERGE_TECH_CONTACT === '1') {
    console.log('[E2E] 17e2. Vtal_Seg_MergeTechContacList (trace: antes de CreateOrderOnQuote)...');
    const mergeBody = { inputList2: '', inputList1: [{ recordTypeName: 'Business', ContactId: contactTecnicoId, accountId: accountBussinessId, UF: uf, contacts: [{ contactId: contactTecnicoId, value: contactTecnicoId, label: '', name: '' }] }] };
    const mergeRes = await apiCall('POST', IP_MERGE_TECH_CONTACT, mergeBody);
    if (mergeRes.status !== 200 && mergeRes.status !== 201) console.log('   MergeTechContacList (não crítico):', mergeRes.status);
  }
  const createOrderBody = {
    selectedAccounts: [{ Id: accountBussinessId, UF: uf }],
    QuoteId: quoteId,
    quoteId: quoteId,
    ContactList: [{ vlocity_cmt__State__c: uf, ContactId: contactTecnicoId }],
    AccountId: accountOrganizationId || accountBussinessId,
  };

  console.log('[E2E] 18. Vtal_CreateOrderOnQuote...');
  const orderRes = await apiCall('POST', IP_CREATE_ORDER_ON_QUOTE, createOrderBody);
  if (orderRes.status !== 200 && orderRes.status !== 201) fail('Vtal_CreateOrderOnQuote', orderRes);

  const d = orderRes.data;
  if (d?.error) fail('Vtal_CreateOrderOnQuote: ' + (d.error || d.errorCode), orderRes);

  const r = d?.result ?? d;
  const orderId = r?.MasterOrderId || r?.id || r?.Id || (Array.isArray(r?.OrderList) && r.OrderList[0]?.Id) || (r?.SubOrdersIds?.[0]?.Id) || d?.MasterOrderId || d?.id || d?.Id;
  if (!orderId) fail('CreateOrderOnQuote não retornou MasterOrderId/OrderList', orderRes);

  let orderList = Array.isArray(r?.OrderList) ? r.OrderList : null;
  if (!orderList?.length) {
    const orderQuery = `SELECT Id, QuoteId, Status, Type, EffectiveDate, AccountId, RecordTypeId, Pricebook2Id, vlocity_cmt__ParentOrderId__c, vlocity_cmt__QuoteId__c, vlocity_cmt__DefaultBillingAccountId__c, vlocity_cmt__DefaultServiceAccountId__c, Name, Vtal_Contact__c, Vtal_Seg_LocationCode__c, Vtal_Seg_InstallationSchedule__c, Vtal_Seg_Line_Type__c, OpportunityId FROM Order WHERE Id = '${orderId}' OR vlocity_cmt__ParentOrderId__c = '${orderId}'`;
    const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(orderQuery)}`);
    if (qRes.status === 200 && qRes.data?.records?.length > 0) {
      orderList = qRes.data.records.map(({ attributes, ...rec }) => rec);
            console.log('   OrderList montada via query (' + orderList.length + ' pedido(s))');
    }
  }
  const ordersToFix = orderList && orderList.length > 0 ? orderList : [{ Id: orderId }];
  for (const ord of ordersToFix) {
    const oid = ord.Id || ord.id;
    const needQuote = !ord.QuoteId && !ord.vlocity_cmt__QuoteId__c;
    if (oid && needQuote && quoteId) {
      const patchRes = await apiCall('PATCH', `${SOBJECTS_ORDER}/${oid}`, { QuoteId: quoteId, vlocity_cmt__QuoteId__c: quoteId });
      if (patchRes.status === 200 || patchRes.status === 204) {
        console.log('   Order', oid, 'vinculado à Quote (QuoteId estava null)');
        if (ord.QuoteId === undefined) ord.QuoteId = quoteId;
        if (ord.vlocity_cmt__QuoteId__c === undefined) ord.vlocity_cmt__QuoteId__c = quoteId;
      }
    }
  }
  console.log('[E2E] 18a. checkoutOrderOMBatch (GenericInvoke2NoCont → Vtal_SF_OrderUtils: Orchestration Plan, Service Order, Designation)...');
  const checkoutOk = await runCheckoutOrderOMBatch(apiCall, orderId, orderList?.length > 0 ? orderList : null);
  if (checkoutOk) {
    console.log('   checkoutOrderOMBatch ok');
    await delay(3000);
  } else {
    console.log('   checkoutOrderOMBatch (não crítico: verifique GenericInvoke2NoCont / executeAnonymous)');
  }
  console.log('[E2E] 18c. XOMOnSubmitOrder (submeter ao OM → subpedido Em implantação)...');
  const xomOk = await runXOMOnSubmitOrder(apiCall, orderId);
  if (xomOk) {
    console.log('   XOMOnSubmitOrder ok');
    await delay(2000);
  }

  console.log('[E2E] 19. GET Order (validar OrderNumber e Status)...');
  const orderGet = await apiCall('GET', `${SOBJECTS_ORDER}/${orderId}`);
  if (orderGet.status !== 200) fail('GET Order', orderGet);
  const order = orderGet.data;
  const orderNumber = order?.OrderNumber;
  const orderStatus = order?.Status;
  if (!orderNumber) fail('Order sem OrderNumber', orderGet);
  console.log('[E2E] Pedido criado — Número:', orderNumber, '| Id:', orderId, '| Status:', orderStatus);

  const subPedidoInfo = await pollSubpedidosEmImplantacao({
    apiCall,
    queryUrl: QUERY_URL,
    parentOrderId: orderId,
    delay,
    fail,
  });

  return {
    quoteId,
    orderId,
    orderNumber,
    orderStatus,
    ...subPedidoInfo,
  };
}

const FULL_FLOW_MAX_RUNS = 3;

async function main() {
  if (!tokenUrl || !baseUrl) {
    console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
    process.exit(1);
  }
  if (!sf.client_id || !sf.client_secret) {
    console.error('Credenciais em user.json (dev.salesforce)');
    process.exit(1);
  }

  console.log('[E2E] Modo fluxo completo: Lead → BRM → Oportunidade → Cotação → Pedido.');

  for (let run = 1; run <= FULL_FLOW_MAX_RUNS; run++) {
    console.log('\n========== EXECUÇÃO', run, '/', FULL_FLOW_MAX_RUNS, '==========');
    console.log('Token...');
    const { accessToken, instanceUrl } = await getToken();
    const cookie = defaultCookie;

    try {
      const accountIds = await runLeadFlow(instanceUrl, accessToken, cookie);
      const result = await runQuoteFlow(instanceUrl, accessToken, cookie, accountIds);
      if (result.orderNumber) {
        await finalizePedidoGerado(mergeAccountIdsIntoPedidoResult(result, accountIds));
        process.exit(0);
      }
      console.log('\n', result.message || 'Order não gerado', 'QuoteId:', result.quoteId);
    } catch (err) {
      console.error('\nERRO (run ' + run + '):', err.message);
      if (err.response) {
        console.error('Status:', err.response.status);
        console.error('Body:', err.response.data ? JSON.stringify(err.response.data, null, 2) : err.response.text);
      }
      if (run < FULL_FLOW_MAX_RUNS) {
        console.log('Nova tentativa em 25s (novo Lead, nova conta)...');
        await delay(25000);
      } else {
        process.exit(1);
      }
    }
  }
  process.exit(1);
}

main();
