/**
 * Fluxo E2E: Lead → BRM → Oportunidade → Cotação → Viabilidade → Pedido VPN MPLS.
 * Alinhado a `gerar-pedido-massa-pronta-vpn.js`: produto CONNECTIVITY_VPN_MPLS (ou PRODUCT_CODE_VPN),
 * CreateQuoteMembers com `buildCreateQuoteMembersBodyVpn`, ProductsValidation com **FCVpnMplsChild** (não IP Connect).
 * - Cart API v2 (reprice): **antes** de ProductsValidation(save) (como IP Connect) e **depois** do advance (como Link Dedicado passo 21).
 * - Vtal_Seg_DuplicateVPNValues (invoke CPQ) após o segundo reprice — trace LD; SKIP_DUPLICATE_VPN_VALUES=1 pula.
 * - Payload ProductsValidation: FCIPConnectChild '' + FCVpnMplsChild preenchido (espelha IP Connect que zera FCVpn ao usar FCIP).
 *   FCVpnMplsChild: um bloco por **cada** QuoteLineItem da cotação (como LD em buildLdValidationMap), após viabilidade + reprice — evita subpedido sem valor quando há mais de uma linha.
 *   Após checkout + XOM: PATCH em OrderItem (Vtal_SF_Valor_Mensal__c, Vtal_SF_ValorInstalacao__c) no pedido mestre e subpedidos — o CreateOrderOnQuote VPN nem sempre replica esses campos como IP Connect/LD (SKIP_PATCH_ORDER_ITEM_VPN=1 desliga).
 *   Valores: VALOR_MENSAL_VPN / VALOR_INSTALACAO_VPN; se não definidos, usa VALOR_MENSAL_LD / VALOR_INSTALACAO_LD (mesmo padrão do link dedicado, ex. 800 / 3000).
 *   USE_CART_REPRICE=0 desativa ambos os reprices.
 * - Checkout / XOM: igual aos demais scripts E2E.
 *
 * Uso: [ENVIRONMENT=dev] node scripts/gerar-pedido-vpn.js
 *
 * Escopo: gera pedido no Salesforce e aguarda subpedido em implantação — **sem** etapa de configuração PEGA.
 *
 * Opcionais: IP_XOM_SUBMIT_ORDER (URL do IP de submit OM), XOM_SUBMIT_MODE (Sync|Async).
 * Se o org não tiver o IP "XOMOnSubmitOrder" ativo, definir IP_XOM_SUBMIT_ORDER com o nome real do IP
 * (ex.: .../integrationprocedure/Vtal_SubmitOrderToOM) para o subpedido ir para "Em implantação".
 */
const { finalizePedidoGerado } = require('../support/utils/finalizePedidoGerado.js');
const { mergeAccountIdsIntoPedidoResult } = require('../support/utils/mergeAccountIdsIntoPedidoResult.js');
const { delay } = require('../support/utils/helpers/waitHelper.js');

const { createSalesforceScriptClient } = require('../support/utils/salesforce/scriptHttpClient.js');
const {
  ensureQuoteApproved,
  supersedeSiblingApprovedQuotes,
} = require('../support/utils/salesforce/ensureQuoteApproved.js');
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
  buildDescriptionBlock,
  buildComplementoBlock,
  buildFormattedAddress,
  buildViabilityComplements,
  getDefaultAddressId,
  getRegionLabel,
} = require('../support/utils/salesforce/resolveMassTestAddress.js');
const MAX_TRIES = 10;
// Quote/Opportunity (ti sandbox) – user/collection
const QUOTE_RECORD_TYPE_ID = process.env.QUOTE_RECORD_TYPE_ID || '012Hs000000l6VjIAI';
const QUOTE_PRICEBOOK2_ID = process.env.QUOTE_PRICEBOOK2_ID || '01sHs000001nMM3IAM';
const PRODUCT_CODE_VPN = process.env.PRODUCT_CODE_VPN || 'CONNECTIVITY_VPN_MPLS';
const PRODUCT_NAME_VPN = process.env.PRODUCT_NAME_VPN || 'VPN MPLS';
const VALOR_MENSAL_VPN = process.env.VALOR_MENSAL_VPN || process.env.VALOR_MENSAL_LD || '800';
const VALOR_INSTALACAO_VPN = process.env.VALOR_INSTALACAO_VPN || process.env.VALOR_INSTALACAO_LD || '3000';
const VPN_DEFAULT_SPEED = process.env.VPN_DEFAULT_SPEED || '100';
const VPN_DEFAULT_SPEED_LABEL = process.env.VPN_DEFAULT_SPEED_LABEL || '100 Mbps';

// Endereços por região (MASS_ADDRESS_REGION=SP|RJ). Default: Av. Paulista.
const ADDRESSES_TO_TRY = getAddressesToTry();
const VIABILITY_WAIT_MS = parseInt(process.env.VIABILITY_WAIT_MS || '25000', 10);

async function resolveVpnProduct(apiCall) {
  const pricebook2Id = QUOTE_PRICEBOOK2_ID;
  let product2Id = process.env.PRODUCT2_ID_VPN?.trim() || '';
  let productCode = PRODUCT_CODE_VPN;
  let productName = PRODUCT_NAME_VPN;
  let objectTypeName = process.env.VPN_OBJECT_TYPE_NAME || '';

  if (!product2Id) {
    const escaped = PRODUCT_CODE_VPN.replace(/'/g, "\\'");
    const qProduct = `SELECT Id, Name, ProductCode, vlocity_cmt__ObjectTypeName__c FROM Product2 WHERE ProductCode = '${escaped}' AND IsActive = true LIMIT 1`;
    const resProduct = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qProduct)}`);
    if (resProduct.status !== 200 || !resProduct.data?.records?.length) return null;
    const rec = resProduct.data.records[0];
    product2Id = rec.Id;
    productCode = rec.ProductCode || productCode;
    productName = rec.Name || productName;
    objectTypeName = rec.vlocity_cmt__ObjectTypeName__c || objectTypeName;
  } else {
    const qById = `SELECT Id, Name, ProductCode, vlocity_cmt__ObjectTypeName__c FROM Product2 WHERE Id = '${product2Id}' LIMIT 1`;
    const resById = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qById)}`);
    if (resById.status === 200 && resById.data?.records?.length) {
      const rec = resById.data.records[0];
      productCode = rec.ProductCode || productCode;
      productName = rec.Name || productName;
      objectTypeName = rec.vlocity_cmt__ObjectTypeName__c || objectTypeName;
    }
  }

  const qEntry = `SELECT Id FROM PricebookEntry WHERE Product2Id = '${product2Id}' AND Pricebook2Id = '${pricebook2Id}' AND IsActive = true LIMIT 1`;
  const resEntry = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qEntry)}`);
  if (resEntry.status !== 200 || !resEntry.data?.records?.length) return null;
  if (!objectTypeName) objectTypeName = 'IP Product Specification';

  return {
    product2Id,
    pricebookEntryId: resEntry.data.records[0].Id,
    productCode,
    productName,
    objectTypeName,
  };
}

function buildCreateQuoteMembersBodyVpn(quoteId, addr, addressInfo = null, vpnProduct) {
  const descBlock = buildDescriptionBlock(addr, addressInfo);
  const complementoBlock = buildComplementoBlock(addr);
  const quoteMember = {
      parentblock: 1,
      label: 'Block1',
      UnitPrice: Number(VALOR_INSTALACAO_VPN),
      PricebookEntryId: vpnProduct.pricebookEntryId,
      'LookupProduct-Block': {
        value: {
          Id: vpnProduct.product2Id,
          PricebookEntryId: vpnProduct.pricebookEntryId,
          ProductCode: vpnProduct.productCode,
          vlocity_cmt__ObjectTypeName__c: vpnProduct.objectTypeName,
          vlocity_cmt__GlobalGroupKey__c: `e2e-${Date.now()}`,
          AttributeDefaultValues: {
            ATT_PRODUCT_CODE_SOV: 'VPN_MPLS',
          },
        },
        name: vpnProduct.productName,
        LookupProduct: vpnProduct.productName,
      },
      'Approach-Block': { label: 'Simples', value: 'Simples', Approach: 'Simples' },
      'downloadSpeed-Block': { label: VPN_DEFAULT_SPEED_LABEL, value: VPN_DEFAULT_SPEED },
      'TipoVelocidade-Block': { label: 'Simétrico', value: 'Simétrico' },
      'description-Block': descBlock,
      deliveryAddressValue: 'Endereço do Cliente',
      useTypeValue: 'Assinante Comum',
      ComplementosManual: [],
      isSharedDesignation: false,
      'TipoPonta-Block': 'Concentradora',
      pointType: 'Concentradora',
      ExistentNetwork: [],
      'TipoInst-Block': 'Rede Nova',
      subAccordions: [],
      selectedTopologyValue: '',
      selectedNetworkTypeValue: '',
      networkId: `QLI-${Date.now()}`,
      productCode: vpnProduct.productCode,
    };
  if (complementoBlock) quoteMember['Complemento-Block'] = complementoBlock;
  return {
    function: 'advance',
    Token: addressInfo?.Token ?? '',
    QuoteId: quoteId,
    OppType: 'New opp',
    CustomerCategory: 'Corporate',
    GPONMaxDownloadSpeed: 10000,
    QuoteMemberList: [quoteMember],
    AssetToQuoteMemberList: [],
    deletedIds: [],
    obrigaComplemento: false,
    sharedAccessReason: '',
  };
}

function isInviableOrderError(res) {
  const msg = [res?.data?.error, res?.data?.message, res?.data?.errorMessage, res?.text]
    .filter(Boolean)
    .join(' ');
  return /Não existe conta business para a UF|conta business para a UF/i.test(msg);
}

/** Atualiza QuoteMember com viabilidade forçada via executeAnonymous (workaround quando viabilidade async falha). */
async function updateQuoteMemberViability(apiCall, quoteId, quoteMemberId) {
  let qmId = quoteMemberId;
  if (!qmId) {
    const q = `SELECT Id FROM vlocity_cmt__QuoteMember__c WHERE vlocity_cmt__QuoteId__c='${quoteId}' LIMIT 1`;
    const r = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
    qmId = r?.data?.records?.[0]?.Id || null;
  }
  if (!qmId) return false;
  const apex = `vlocity_cmt__QuoteMember__c qm = [SELECT Id FROM vlocity_cmt__QuoteMember__c WHERE Id = '${qmId}' LIMIT 1]; qm.vlocity_cmt__MaxDownloadSpeed__c = '100'; qm.Vtal_SF_MaxSpeed__c = '100'; qm.Vtal_SF_Viability__c = 'Viável - Viabilidade técnica confirmada'; update qm;`;
  const res = await apiCall('GET', `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apex)}`);
  return res.status === 200 && res.data?.success;
}

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

/** Garante string numérica para o IP; nunca envia "null" (ProductsValidation não persiste RecurringCharge/OneTimeCharge se vier null). */
function asNumeroString(val, defaultVal) {
  if (val == null || val === '' || String(val).toLowerCase() === 'null') return defaultVal;
  const s = String(val).trim();
  if (s === '' || Number.isNaN(Number(s))) return defaultVal;
  return s;
}

/** Monta FCVpnMplsChild com uma entrada por QuoteLineItem (padrão buildLdValidationMap no link dedicado). */
function buildVpnMplsChildMap(quoteLineItems, valorMensal, valorInstalacao, productCodeResolved, advance = false) {
  const mensal = asNumeroString(valorMensal, VALOR_MENSAL_VPN);
  const instalacao = asNumeroString(valorInstalacao, VALOR_INSTALACAO_VPN);
  const items = Array.isArray(quoteLineItems) ? quoteLineItems : [quoteLineItems].filter(Boolean);
  const normalized = items
    .map((item) => (typeof item === 'string' ? { Id: item } : item))
    .filter((item) => item && item.Id);
  if (!normalized.length) return '';
  const o = {};
  for (const item of normalized) {
    const id = item.Id;
    const m = advance ? (mensal || '0') : mensal;
    const inst = instalacao;
    const entry = {
      Id: id,
      productCode: productCodeResolved,
      Mensalidade: m,
      MensalidadeLPU: m,
      TaxaInstalacao: inst,
      TaxaInstalacaoLPU: inst,
    };
    if (advance) entry.PrazoInstalacao = 'Até 30 dias';
    o[id] = entry;
  }
  return o;
}

async function fetchQuoteLineItemsForVpn(apiCall, quoteId) {
  const q = `SELECT Id FROM QuoteLineItem WHERE QuoteId='${quoteId}' ORDER BY CreatedDate`;
  const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
  if (res.status !== 200) return { ok: false, records: [], res };
  return { ok: true, records: res.data?.records || [], res };
}

/** Replica na Order os valores de mensal/instalação da cotação (campos da lista relacionada de produtos do pedido). */
async function patchOrderItemsVpnFinancialValues(apiCall, masterOrderId, valorMensal, valorInstalacao) {
  if (process.env.SKIP_PATCH_ORDER_ITEM_VPN === '1') return;
  const mensalStr = asNumeroString(valorMensal, VALOR_MENSAL_VPN);
  const instStr = asNumeroString(valorInstalacao, VALOR_INSTALACAO_VPN);
  if (mensalStr === '' || instStr === '') return;
  const mensalNum = Number(mensalStr);
  const instNum = Number(instStr);
  if (Number.isNaN(mensalNum) || Number.isNaN(instNum)) return;
  const oiQuery = `SELECT Id FROM OrderItem WHERE OrderId IN (SELECT Id FROM Order WHERE Id = '${masterOrderId}' OR vlocity_cmt__ParentOrderId__c = '${masterOrderId}')`;
  let oiRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(oiQuery)}`);
  if (oiRes.status !== 200 || !oiRes.data?.records?.length) {
    await delay(2500);
    oiRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(oiQuery)}`);
  }
  if (oiRes.status !== 200 || !oiRes.data?.records?.length) {
    console.log('   patchOrderItemsVpnFinancialValues: nenhum OrderItem (mestre/subpedido) ainda — pulando PATCH');
    return;
  }
  const payload = {
    Vtal_SF_Valor_Mensal__c: mensalNum,
    Vtal_SF_ValorInstalacao__c: instNum,
  };
  console.log('[E2E] 18b. PATCH OrderItem(s) — Vtal_SF_Valor_Mensal__c / Vtal_SF_ValorInstalacao__c (subpedido)...');
  for (const oi of oiRes.data.records) {
    const pr = await apiCall('PATCH', `${SOBJECTS_ORDER_ITEM}/${oi.Id}`, payload);
    if (pr.status === 200 || pr.status === 204) {
      console.log('   OrderItem', oi.Id, 'OK');
    } else {
      console.log('   PATCH OrderItem', oi.Id, '(não crítico):', pr.status, pr.text?.slice(0, 160));
    }
  }
}

function buildProductsValidationBodyVpn(quoteId, quoteLineItems, fn = 'advance', valorMensal = VALOR_MENSAL_VPN, valorInstalacao = VALOR_INSTALACAO_VPN, productCodeResolved = PRODUCT_CODE_VPN) {
  const mensal = asNumeroString(valorMensal, VALOR_MENSAL_VPN);
  const instalacao = asNumeroString(valorInstalacao, VALOR_INSTALACAO_VPN);
  if (mensal === '' || instalacao === '') {
    throw new Error('buildProductsValidationBodyVpn: Mensalidade e TaxaInstalacao não podem ser vazios');
  }
  const FCVpnMplsChild = buildVpnMplsChildMap(quoteLineItems, valorMensal, valorInstalacao, productCodeResolved, false);
  return {
    quoteId,
    function: fn,
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress: '',
    FCIPConnectChild: '',
    FCVpnMplsChild: FCVpnMplsChild || '',
  };
}

function buildProductsValidationAdvanceBodyVpn(quoteId, quoteLineItems, valorMensal = VALOR_MENSAL_VPN, valorInstalacao = VALOR_INSTALACAO_VPN, productCodeResolved = PRODUCT_CODE_VPN) {
  const mensal = asNumeroString(valorMensal, VALOR_MENSAL_VPN);
  const instalacao = asNumeroString(valorInstalacao, VALOR_INSTALACAO_VPN);
  const FCVpnMplsChild =
    mensal !== '' || instalacao !== ''
      ? buildVpnMplsChildMap(quoteLineItems, valorMensal, valorInstalacao, productCodeResolved, true)
      : '';
  return {
    quoteId,
    function: 'advance',
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress: '',
    FCIPConnectChild: '',
    FCVpnMplsChild: FCVpnMplsChild || '',
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
  if (oppRes.status !== 200 && oppRes.status !== 201) fail('Opportunity', oppRes);
  const opportunityId = oppRes.data?.id;
  if (!opportunityId) fail('Opportunity sem id', oppRes);

  const accountBussinessId = accountIds.accountBussinessId;
  const accountOrganizationId = accountIds.accountOrganizationId;
  const contactTecnicoId = accountIds.contactTecnicoId;
  if (!accountBussinessId || !contactTecnicoId) fail('Falta accountBussinessId ou contactTecnicoId para CreateOrderOnQuote', { status: 0 });

  const CREATE_ORDER_MAX_ATTEMPTS = 25;
  const CREATE_ORDER_RETRY_DELAY_MS = 25000;

  for (let addrIdx = 0; addrIdx < ADDRESSES_TO_TRY.length; addrIdx++) {
    const addr = ADDRESSES_TO_TRY[addrIdx];
    console.log('\n[E2E] --- Tentativa', addrIdx + 1 + '/5:', addr.streetType, addr.streetName, addr.number, `CEP ${addr.zipCode.slice(0, 5)}-${addr.zipCode.slice(5, 8)} ---`);

    if (addrIdx > 0 && IS_TI) {
      await supersedeSiblingApprovedQuotes({
        apiCall,
        opportunityId,
        SOBJECTS_QUOTE,
      });
    }

    const vpnProduct = await resolveVpnProduct(apiCall);
    if (!vpnProduct) {
      fail('Não foi possível resolver produto VPN MPLS (Product2/PricebookEntry). Defina PRODUCT2_ID_VPN ou confira PRODUCT_CODE_VPN no catálogo.', { status: 0 });
    }

    console.log('[E2E] 12. Criando Quote (RecordTypeId, Pricebook2Id, Status Draft)...');
    const quotePayload = {
      Name: `Cotação VPN MPLS - Oportunidade ${opportunityId} (${addr.streetName} ${addr.number})`,
      OpportunityId: opportunityId,
      RecordTypeId: QUOTE_RECORD_TYPE_ID,
      Pricebook2Id: QUOTE_PRICEBOOK2_ID,
      Vtal_TipoDeCotacao__c: 'Simples',
      vtal_SF_PrazoContratacao__c: 12,
      Status: 'Draft',
    };
    const quoteRes = await apiCall('POST', SOBJECTS_QUOTE, quotePayload);
    if (quoteRes.status !== 200 && quoteRes.status !== 201) fail('Quote', quoteRes);
    const quoteId = quoteRes.data?.id;
    if (!quoteId) fail('Quote sem id', quoteRes);

    let addressInfo = null;
    try {
      console.log('[E2E] 12b. Vtal_FillAddressInfo (buscar id/Token para CEP', addr.zipCode, ')...');
      const fillInput = {
        description: addr.zipCode,
        endereco: addr.zipCode,
        token: '',
      };
      const fillRes = await apiCall('POST', IP_FILL_ADDRESS_INFO, fillInput);
      if (fillRes.status === 200 && fillRes.data?.result) {
        const result = fillRes.data.result;
        const records = result?.records ?? result?.data ?? (Array.isArray(result) ? result : []);
        const rec = Array.isArray(records) && records.length > 0 ? records[0] : result;
        if (rec?.id != null) {
          addressInfo = { id: rec.id, Token: result?.Token ?? rec?.Token ?? fillRes.data?.Token ?? '' };
          console.log('   Address id:', addressInfo.id, addressInfo.Token ? '(Token obtido)' : '');
        }
      }
    } catch (_) {}
    console.log('[E2E] 13. Vtal_CreateQuoteMembers (VPN MPLS,', addr.streetName, addr.number, addressInfo?.id ? `, id ${addressInfo.id}` : '', ')...');
    const membersRes = await apiCall('POST', IP_CREATE_QUOTE_MEMBERS, buildCreateQuoteMembersBodyVpn(quoteId, addr, addressInfo, vpnProduct));
    if (membersRes.status !== 200 && membersRes.status !== 201) fail('CreateQuoteMembers', membersRes);

    console.log('[E2E] 14. Query QuoteLineItem...');
    const q = `SELECT Id FROM QuoteLineItem WHERE QuoteId='${quoteId}'`;
    const qliRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
    if (qliRes.status !== 200) fail('Query QuoteLineItem', qliRes);
    const records = qliRes.data?.records || [];
    if (!records.length) fail('Nenhum QuoteLineItem', qliRes);

    console.log('[E2E] 15. Vtal_Seg_IPQuoteStatusUpdateMassive (finalizar endereço antes da viabilidade)...');
    const statusRes = await apiCall('POST', IP_QUOTE_STATUS, { HasFinishedAddressRegistration: true, ContextId: quoteId });
    if (statusRes.status !== 200 && statusRes.status !== 201) fail('IPQuoteStatusUpdateMassive', statusRes);

    console.log('[E2E] 16. Vtal_Seg_IPQuoteStatusUpdateMassive OK');

    const qmRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(`SELECT Id FROM vlocity_cmt__QuoteMember__c WHERE vlocity_cmt__QuoteId__c='${quoteId}' LIMIT 1`)}`);
    const quoteMemberId = qmRes.status === 200 && qmRes.data?.records?.[0]?.Id ? qmRes.data.records[0].Id : null;
    if (quoteMemberId) {
      console.log('[E2E] 16b. Vtal_SF_GetQuoteAddressViability (pré-viabilidade com endereço)...');
      const addressId = addressInfo?.id ?? getDefaultAddressId(addr);
      const enderecoCompleto = buildFormattedAddress(addr);
      const getViabilityBody = {
        items: [{
          nomeProduto: vpnProduct.productCode || PRODUCT_CODE_VPN,
          enderecoCompleto,
          skipGpon: false,
          enableAdvance: true,
          complements: buildViabilityComplements(addr),
          UF: getOrderUf(),
          idEnderecoExt: String(addressId),
          viability: 1,
          nFachada: String(addr.number),
          codigoLogradouro: addr.codigoLogradouro || '2706',
          codigoLocalidade: addr.locationCode,
          isLatLong: false,
          codigoBairro: addr.neighborhood.toUpperCase().replace(/\s+/g, ' '),
          sfSearchResultId: quoteMemberId,
          velocidadeRequerida: 14336,
          isnovaoi: '0',
        }],
      };
      const viabilityPreRes = await apiCall('POST', IP_GET_QUOTE_ADDRESS_VIABILITY, getViabilityBody);
      if (viabilityPreRes.status !== 200 && viabilityPreRes.status !== 201) {
        console.log('   GetQuoteAddressViability:', viabilityPreRes.status, viabilityPreRes.data?.error || viabilityPreRes.text?.slice(0, 200));
      }
    }

    console.log('[E2E] 17. Vtal_ViabilityDetailsForQuote (viabilidade async)...');
    const viabilityRes = await apiCall('POST', IP_VIABILITY, { UserId: userId, QuoteId: quoteId, Debug: true });
    if (viabilityRes.status !== 200 && viabilityRes.status !== 201) fail('ViabilityDetailsForQuote', viabilityRes);

    console.log('[E2E] Aguardando', VIABILITY_WAIT_MS / 1000, 's para viabilidade async concluir...');
    await delay(VIABILITY_WAIT_MS);

    const todayStr = new Date().toISOString().slice(0, 10);
    let orderValorMensal = asNumeroString(VALOR_MENSAL_VPN, VALOR_MENSAL_VPN);
    let orderValorInstalacao = asNumeroString(VALOR_INSTALACAO_VPN, VALOR_INSTALACAO_VPN);
    if (process.env.STRICT_QUOTE_VALUES === '1' && (orderValorMensal === '' || orderValorInstalacao === '')) {
      fail('VALOR_MENSAL_VPN / VALOR_INSTALACAO_VPN inválidos. Abortando.', { status: 0 });
    }

    if (process.env.USE_CART_REPRICE !== '0') {
      console.log('[E2E] 17a2. Cart API v2 — reprice (antes do save; alinha IP Connect: runtime + preço no carrinho)...');
      await cartReprice(apiCall, quoteId);
    }

    const qliFetch = await fetchQuoteLineItemsForVpn(apiCall, quoteId);
    if (!qliFetch.ok) fail('Query QuoteLineItem (após viabilidade/reprice)', qliFetch.res);
    const qliRecordsForVpn = qliFetch.records;
    if (!qliRecordsForVpn.length) fail('Nenhum QuoteLineItem após viabilidade e reprice', qliFetch.res);
    console.log('   FCVpnMplsChild:', qliRecordsForVpn.length, 'QuoteLineItem(s); mensal/instalação', orderValorMensal, '/', orderValorInstalacao);

    console.log('[E2E] 17b0. Vtal_Seg_ProductsValidation (function: save — FCVpnMplsChild)...');
    const saveValidationRes = await apiCall(
      'POST',
      IP_PRODUCTS_VALIDATION,
      buildProductsValidationBodyVpn(quoteId, qliRecordsForVpn, 'save', orderValorMensal, orderValorInstalacao, vpnProduct.productCode),
    );
    if (saveValidationRes.status !== 200 && saveValidationRes.status !== 201) {
      fail('ProductsValidation(save) VPN', saveValidationRes);
    }

    console.log('[E2E] 17b. PATCH Quote Status Draft → Pre sale...');
    const preSalePatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Status: 'Pre sale',
      Vtal_Seg_PreSaleTerm__c: todayStr,
      Vtal_Seg_PreSaleRequested__c: true,
      Vtal_Seg_HasFinishedProductConfiguration__c: false,
    });
    if (preSalePatch.status !== 200 && preSalePatch.status !== 204) {
      console.log('   PATCH Pre sale:', preSalePatch.status, preSalePatch.data?.message || preSalePatch.text?.slice(0, 150));
    }

    console.log('[E2E] 17c. Vtal_Seg_ProductsValidation (function: advance — FCVpnMplsChild)...');
    const validationRes = await apiCall(
      'POST',
      IP_PRODUCTS_VALIDATION,
      buildProductsValidationAdvanceBodyVpn(quoteId, qliRecordsForVpn, orderValorMensal, orderValorInstalacao, vpnProduct.productCode),
    );
    if (validationRes.status !== 200 && validationRes.status !== 201) fail('ProductsValidation(advance) VPN', validationRes);

    if (process.env.USE_CART_REPRICE !== '0') {
      console.log('[E2E] 17c2. Cart API v2 — reprice (após save/advance; alinha Link Dedicado passo 21 — consolida preço no carrinho)...');
      await cartReprice(apiCall, quoteId);
    }

    if (process.env.SKIP_DUPLICATE_VPN_VALUES !== '1') {
      try {
        console.log('[E2E] 17c3. Vtal_Seg_DuplicateVPNValues (trace LD — subpedido/preço VPN MPLS)...');
        const dupRes = await apiCall('POST', INVOKE_CPQ_URL, {
          sClassName: 'vlocity_cmt.IntegrationProcedureService',
          sMethodName: 'Vtal_Seg_DuplicateVPNValues',
          input: JSON.stringify({ ProductName: PRODUCT_NAME_VPN, QuoteId: quoteId }),
          options: JSON.stringify({}),
        });
        if (dupRes.status !== 200 && dupRes.status !== 201) {
          console.log('   DuplicateVPNValues (não crítico):', dupRes.status, dupRes.data?.error || dupRes.text?.slice(0, 120));
        } else {
          console.log('   DuplicateVPNValues OK');
        }
      } catch (err) {
        console.log('   DuplicateVPNValues (não crítico):', err.message);
      }
      await delay(1500);
    }

    const proposalValidity = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const statusAprovado = process.env.QUOTE_STATUS_APROVADO || currentQuoteFlow.finalStatus;
    await ensureQuoteApproved({
      apiCall,
      fail,
      SOBJECTS_QUOTE,
      quoteId,
      opportunityId,
      statusAprovado,
      proposalValidity,
      IS_TRG,
      IS_TI,
      quoteFlow: currentQuoteFlow,
    });

    console.log('[E2E] 17f. Vtal_Seg_ValidateCreateOrder...');
    const validateRes = await apiCall('POST', IP_VALIDATE_CREATE_ORDER, { QuoteId: quoteId });
    if (validateRes.status !== 200 && validateRes.status !== 201) {
      console.log('   ValidateCreateOrder:', validateRes.status, validateRes.data?.error || validateRes.text?.slice(0, 200), '(continuando)');
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
    let orderId = null;
    let lastOrderRes = null;
    let didViabilityFix = false;
    for (let attempt = 1; attempt <= CREATE_ORDER_MAX_ATTEMPTS; attempt++) {
      console.log(`[E2E] 18. Vtal_CreateOrderOnQuote (tentativa ${attempt}/${CREATE_ORDER_MAX_ATTEMPTS})...`);
      const orderRes = await apiCall('POST', IP_CREATE_ORDER_ON_QUOTE, createOrderBody);
      lastOrderRes = orderRes;
      if (orderRes.status !== 200 && orderRes.status !== 201) {
        if (isInviableOrderError(orderRes)) {
          if (!didViabilityFix) {
            console.log('   [workaround] Atualizando QuoteMember com viabilidade forçada e retentando...');
            const ok = await updateQuoteMemberViability(apiCall, quoteId, quoteMemberId);
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
            const ok = await updateQuoteMemberViability(apiCall, quoteId, quoteMemberId);
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
        await patchOrderItemsVpnFinancialValues(apiCall, orderId, orderValorMensal, orderValorInstalacao);
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

      const SUB_ORDER_STATUS_TARGETS = ['Em implantação', 'Em implementado', 'In Implementation'];
      const SUB_ORDER_POLL_TIMEOUT_MS = 120000;
      const SUB_ORDER_POLL_INTERVAL_MS = 5000;
      console.log(`[E2E] 20. Poll subpedidos até Status = "${SUB_ORDER_STATUS_TARGETS.join('" ou "')}"...`);
      const subOrderQuery = `SELECT Id, OrderNumber, Status, vtal_LXD_Produto_do_pedido__c FROM Order WHERE vlocity_cmt__ParentOrderId__c = '${orderId}'`;
      const subDeadline = Date.now() + SUB_ORDER_POLL_TIMEOUT_MS;
      let subOrderWithStatus = null;
      let firstPollDone = false;
      while (Date.now() < subDeadline) {
        const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(subOrderQuery)}`);
        if (qRes.status === 200 && qRes.data?.records?.length > 0) {
          if (!firstPollDone) {
            console.log('   Status atual dos subpedidos:', qRes.data.records.map((r) => r.OrderNumber + '=' + (r.Status || '')).join(', '));
            firstPollDone = true;
          }
          subOrderWithStatus = qRes.data.records.find((r) => SUB_ORDER_STATUS_TARGETS.includes((r.Status || '').trim()));
          if (subOrderWithStatus) {
            console.log('   Subpedido com status "' + subOrderWithStatus.Status + '":', subOrderWithStatus.OrderNumber, subOrderWithStatus.vtal_LXD_Produto_do_pedido__c || '');
            break;
          }
        }
        await delay(SUB_ORDER_POLL_INTERVAL_MS);
      }
      if (!subOrderWithStatus) {
        console.log('   (timeout: nenhum subpedido com Status "' + SUB_ORDER_STATUS_TARGETS.join('" ou "') + '" no prazo)');
      }
      return {
        quoteId,
        orderId,
        orderNumber,
        orderStatus,
        subOrderEmImplantacao: !!subOrderWithStatus,
        subOrderOrderNumber: subOrderWithStatus?.OrderNumber ?? null,
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

  const readyMensal = asNumeroString(VALOR_MENSAL_VPN, VALOR_MENSAL_VPN);
  const readyInst = asNumeroString(VALOR_INSTALACAO_VPN, VALOR_INSTALACAO_VPN);
  await patchOrderItemsVpnFinancialValues(apiCall, orderId, readyMensal, readyInst);

  console.log('[E2E] 19. GET Order (validar OrderNumber e Status)...');
  const orderGet = await apiCall('GET', `${SOBJECTS_ORDER}/${orderId}`);
  if (orderGet.status !== 200) fail('GET Order', orderGet);
  const order = orderGet.data;
  const orderNumber = order?.OrderNumber;
  const orderStatus = order?.Status;
  if (!orderNumber) fail('Order sem OrderNumber', orderGet);
  console.log('[E2E] Pedido criado — Número:', orderNumber, '| Id:', orderId, '| Status:', orderStatus);

  const SUB_ORDER_STATUS_TARGETS = ['Em implantação', 'Em implementado', 'In Implementation'];
  const SUB_ORDER_POLL_TIMEOUT_MS = 60000;
  const SUB_ORDER_POLL_INTERVAL_MS = 5000;
  console.log(`[E2E] 20. Poll subpedidos até Status = "${SUB_ORDER_STATUS_TARGETS.join('" ou "')}"...`);
  const subOrderQuery = `SELECT Id, OrderNumber, Status, vtal_LXD_Produto_do_pedido__c FROM Order WHERE vlocity_cmt__ParentOrderId__c = '${orderId}'`;
  const subDeadline = Date.now() + SUB_ORDER_POLL_TIMEOUT_MS;
  let subOrderWithStatus = null;
  while (Date.now() < subDeadline) {
    const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(subOrderQuery)}`);
    if (qRes.status === 200 && qRes.data?.records?.length > 0) {
      subOrderWithStatus = qRes.data.records.find((r) => SUB_ORDER_STATUS_TARGETS.includes((r.Status || '').trim()));
      if (subOrderWithStatus) {
        console.log('   Subpedido com status "' + subOrderWithStatus.Status + '":', subOrderWithStatus.OrderNumber);
        break;
      }
    }
    await delay(SUB_ORDER_POLL_INTERVAL_MS);
  }
  if (!subOrderWithStatus) console.log('   (timeout ou ainda processando)');

  return {
    quoteId,
    orderId,
    orderNumber,
    orderStatus,
    subOrderEmImplantacao: !!subOrderWithStatus,
    subOrderOrderNumber: subOrderWithStatus?.OrderNumber ?? null,
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
