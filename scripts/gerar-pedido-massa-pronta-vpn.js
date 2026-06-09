/**
 * Fluxo E2E: Lead → BRM → Oportunidade → Cotação → Viabilidade → Pedido VPN MPLS.
 * Sequência alinhada ao trace Aura (salesforce-aura-passo-a-passo):
 * - Linha 198: Vtal_CreateOrderOnQuote (IP). Linha 199: checkoutOrderOMBatch com OrderList via
 *   Vtal_SF_OrderUtils (Apex), não IP; usamos o IP que pode delegar ao mesmo.
 * - Linha 203: getRecordActions na Order lista CustomButton.Order.vlocity_cmt__XOMOnSubmitOrder
 *   (submit ao OM → subpedido "Em implantação"); chamamos o IP XOMOnSubmitOrder após checkout.
 * - Opcional: USE_MERGE_TECH_CONTACT=1 chama Vtal_Seg_MergeTechContacList antes de CreateOrderOnQuote (trace 197).
 * - Fluxo VPN MPLS: CreateQuoteMembers com produto VPN MPLS e ProductsValidation usando FCVpnMplsChild.
 * - Cart API v2 (reprice): **antes** de ProductsValidation(save), como gerar-pedido-ip-connect.js / gerar-pedido-vpn.js —
 *   GET /v2/cpq/carts/{quoteId}/price?price=true (ou CART_API_V2_BASE) consolida runtime e Push Event Data no carrinho.
 *   USE_CART_REPRICE=0 desativa; CART_API_V2_BASE override.
 * - Alternativa 100% igual ao botão: chamar ProductsValidation(advance) via Aura
 *   (BusinessProcessDisplayController.GenericInvoke2NoCont, sClassName: vlocity_cmt.IntegrationProcedureService,
 *   sMethodName: Vtal_Seg_ProductsValidation, function: advance) via endpoint /aura — não implementado aqui.
 * - Se o Order vier com QuoteId null após CreateOrderOnQuote, fazemos PATCH para QuoteId + vlocity_cmt__QuoteId__c
 *   (vinculação Order → Quote necessária para pricing/herança).
 * - Valores no VPN MPLS: VALOR_MENSAL_VPN / VALOR_INSTALACAO_VPN; fallback VALOR_MENSAL_LD / VALOR_INSTALACAO_LD (como link dedicado). FCVpnMplsChild: um bloco por QuoteLineItem após viabilidade + reprice.
 * - Após checkout + XOM: PATCH OrderItem (Vtal_SF_Valor_Mensal__c, Vtal_SF_ValorInstalacao__c) mestre/subpedido (SKIP_PATCH_ORDER_ITEM_VPN=1 desliga).
 *
 * Uso: [ENVIRONMENT=dev] node scripts/gerar-pedido-massa-pronta-vpn.js
 *
 * Modo massa pronta (sem Lead/BRM — só Oportunidade → Cotação → Pedido):
 *   START_FROM_QUOTE=1 ACCOUNT_ORGANIZATION_ID=001xxx ACCOUNT_BUSINESS_ID=001xxx ACCOUNT_BILLING_ID=001xxx [CONTACT_TECNICO_ID=003xxx] node scripts/gerar-pedido-massa-pronta-vpn.js
 *   Se CONTACT_TECNICO_ID não for informado, o script busca um contato da conta Business.
 *
 * Modo cotação pronta (só gerar pedido a partir de cotação já aprovada):
 *   QUOTE_ID_READY=1 QUOTE_ID=0Q0xxx ACCOUNT_BUSINESS_ID=001xxx ACCOUNT_ORGANIZATION_ID=001xxx CONTACT_TECNICO_ID=003xxx node scripts/gerar-pedido-massa-pronta-vpn.js
 *
 * Opcionais: IP_XOM_SUBMIT_ORDER (URL do IP de submit OM), XOM_SUBMIT_MODE (Sync|Async).
 * Se o org não tiver o IP "XOMOnSubmitOrder" ativo, definir IP_XOM_SUBMIT_ORDER com o nome real do IP
 * (ex.: .../integrationprocedure/Vtal_SubmitOrderToOM) para o subpedido ir para "Em implantação".
 */
const { loadEnv, getTokenUrl, getUserFixture } = require('../config/env.js');
const { buildLeadPayload } = require('../support/utils/salesforce/leadPayload.js');
const { buildConvertLeadPayload, getFieldValue } = require('../support/utils/salesforce/convertLeadPayload.js');
const { buildOrganizationPatchPayload } = require('../support/utils/salesforce/organizationPatchPayload.js');
const { buildBusinessAccountPatchPayload } = require('../support/utils/salesforce/businessAccountPatchPayload.js');
const { buildBillingAccountPatchPayload } = require('../support/utils/salesforce/billingAccountPatchPayload.js');
const { buildContactPayload } = require('../support/utils/salesforce/contactPayload.js');
const { buildContractMSAPayload, buildContractActivatePayload } = require('../support/utils/salesforce/contractMSAPayload.js');
const { buildContentVersionMSAPayload } = require('../support/utils/salesforce/contentVersionMSAPayload.js');
const { delay } = require('../support/utils/helpers/waitHelper.js');

const env = loadEnv();
const baseUrl = env?.urls?.salesforce?.replace(/\/$/, '') || '';
const tokenUrl = getTokenUrl(env) || (baseUrl ? `${baseUrl}/services/oauth2/token` : '');
const envName = String(process.env.ENVIRONMENT || process.env.ENV || 'ti').trim().toLowerCase();
const IS_TRG = envName === 'trg';
const IS_TI = envName === 'ti';

/** TRG: fluxo de status da Quote (Reviewed antes de Approved) — alinhado a `gerar-pedido-vpn.js`. */
const QUOTE_FLOW = {
  trg: { needsReviewed: true, reviewedStatus: 'Reviewed', finalStatus: 'Approved' },
  ti: { needsReviewed: false, reviewedStatus: null, finalStatus: 'Approved' },
};
const currentQuoteFlow = IS_TRG ? QUOTE_FLOW.trg : QUOTE_FLOW.ti;

function getUser() {
  const user = getUserFixture();
  return user.salesforce || user.dev?.salesforce || user.trg?.salesforce || {};
}

async function getToken() {
  const sf = getUser();
  const grantType = sf.grant_type || 'client_credentials';
  const baseUrl = (sf.tokenUrl || tokenUrl).replace(/\?.*$/, '');
  const params = new URLSearchParams({
    grant_type: grantType,
    client_id: sf.client_id || '',
    client_secret: sf.client_secret || '',
  });
  if (grantType === 'password') {
    params.set('username', sf.username || '');
    params.set('password', sf.password || '');
  }
  const useQueryParams = grantType === 'password';
  const url = useQueryParams ? `${baseUrl}?${params.toString()}` : baseUrl;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sf.cookie || '' };
  const reqBody = useQueryParams ? null : params.toString();
  logCurl('POST', url, headers, reqBody);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: useQueryParams ? '' : params.toString(),
  });
  const resText = await res.text();
  let body = null;
  try {
    body = resText ? JSON.parse(resText) : null;
  } catch (_) {
    body = null;
  }
  logResponse('Token', res.status, body, resText);
  if (!res.ok) throw new Error(`Token ${res.status}: ${resText}`);
  return { accessToken: body.access_token, instanceUrl: body.instance_url };
}

async function api(instanceUrl, accessToken, method, path, body = null, cookie = '') {
  const url = path.startsWith('http') ? path : `${instanceUrl}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  };
  if (body != null && (method === 'POST' || method === 'PATCH')) opts.body = JSON.stringify(body);
  const reqBody = opts.body ?? null;
  logCurl(method, url, opts.headers, reqBody);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  const label = `${method} ${path}`;
  logResponse(label, res.status, data, text);
  return { status: res.status, data, text };
}

const UI_API_RECORDS = '/services/data/v62.0/ui-api/records';
const CONVERT_LEAD_URL = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_LXD_CreateAccountsAndContactCon';
const SOBJECTS_ACCOUNT = '/services/data/v62.0/sobjects/Account';
const SOBJECTS_CONTACT = '/services/data/v62.0/sobjects/Contact';
const SOBJECTS_CONTRACT = '/services/data/v62.0/sobjects/Contract';
const SOBJECTS_CONTENT_VERSION = '/services/data/v62.0/sobjects/ContentVersion';
const SOBJECTS_CONTENT_DOCUMENT_LINK = '/services/data/v62.0/sobjects/ContentDocumentLink';
const QUERY_URL = '/services/data/v62.0/query';
const TOOLING_EXECUTE_ANONYMOUS = '/services/data/v62.0/tooling/executeAnonymous';
const SOBJECTS_OPPORTUNITY = '/services/data/v62.0/sobjects/Opportunity';
const SOBJECTS_QUOTE = '/services/data/v62.0/sobjects/Quote';
const IP_CREATE_QUOTE_MEMBERS = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_CreateQuoteMembers';
const IP_PRODUCTS_VALIDATION = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_ProductsValidation';
const IP_VIABILITY = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_ViabilityDetailsForQuote';
const IP_QUOTE_STATUS = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_IPQuoteStatusUpdateMassive';
const IP_VALIDATE_CREATE_ORDER = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_ValidateCreateOrder';
const IP_CREATE_ORDER_ON_QUOTE = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_CreateOrderOnQuote';
const IP_FILL_ADDRESS_INFO = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_FillAddressInfo';
const IP_GET_QUOTE_ADDRESS_VIABILITY = '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_SF_GetQuoteAddressViability';
/** IP de submit ao OM (botão na Order: vlocity_cmt__XOMOnSubmitOrder). Override: IP_XOM_SUBMIT_ORDER. */
const IP_XOM_SUBMIT_ORDER = process.env.IP_XOM_SUBMIT_ORDER || '/services/apexrest/vlocity_cmt/v1/integrationprocedure/XOMOnSubmitOrder';
/** Fallback se o org usar o IP com namespace no path. */
const IP_XOM_SUBMIT_ORDER_FALLBACK = process.env.IP_XOM_SUBMIT_ORDER_FALLBACK || '/services/apexrest/vlocity_cmt/v1/integrationprocedure/vlocity_cmt__XOMOnSubmitOrder';
/** Industries: invocar Apex direto (Vtal_SF_OrderUtils.checkoutOrderOMBatch) — gera Orchestration Plan, Service Order, Designation, vincula SubOrder. */
const IP_GENERIC_INVOKE = process.env.IP_GENERIC_INVOKE || '/services/apexrest/vlocity_cmt/v1/integrationprocedure/GenericInvoke2NoCont';
/** Fallback se org bloquear GenericInvoke2NoCont; antes usávamos IP checkoutOrderOMBatch. */
const IP_CHECKOUT_ORDER_OM = process.env.IP_CHECKOUT_ORDER_OM || '/services/apexrest/vlocity_cmt/v1/integrationprocedure/checkoutOrderOMBatch';
/** Trace linha 197: UI chama antes de CreateOrderOnQuote. Opcional (USE_MERGE_TECH_CONTACT=1). */
const IP_MERGE_TECH_CONTACT = process.env.IP_MERGE_TECH_CONTACT || '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_MergeTechContacList';
const INVOKE_CPQ_URL = process.env.INVOKE_CPQ_URL || '/services/apexrest/vlocity_cmt/v1/invoke/';
/** Cart API v2 (Industries CPQ): reprice consolida runtime JSON no banco e gera Push Event Data, como o front. Doc: v2/cpq/carts; alguns orgs usam v2/carts — override CART_API_V2_BASE. */
const CART_API_V2_BASE = process.env.CART_API_V2_BASE || '/services/apexrest/vlocity_cmt/v2/cpq/carts';
const SOBJECTS_ORDER = '/services/data/v62.0/sobjects/Order';
const SOBJECTS_ORDER_ITEM = '/services/data/v62.0/sobjects/OrderItem';

const BRM_POLL_TIMEOUT_MS = 60000;
const MAX_TRIES = 10;
// Quote/Opportunity (ti sandbox) – user/collection
const QUOTE_RECORD_TYPE_ID = process.env.QUOTE_RECORD_TYPE_ID || '012Hs000000l6VjIAI';
const QUOTE_PRICEBOOK2_ID = process.env.QUOTE_PRICEBOOK2_ID || '01sHs000001nMM3IAM';
const BRM_POLL_INTERVAL_MS = 2000;
const PRODUCT_CODE_VPN = process.env.PRODUCT_CODE_VPN || 'CONNECTIVITY_VPN_MPLS';
const PRODUCT_NAME_VPN = process.env.PRODUCT_NAME_VPN || 'VPN MPLS';
const VALOR_MENSAL_VPN = process.env.VALOR_MENSAL_VPN || process.env.VALOR_MENSAL_LD || '800';
const VALOR_INSTALACAO_VPN = process.env.VALOR_INSTALACAO_VPN || process.env.VALOR_INSTALACAO_LD || '3000';
const VPN_DEFAULT_SPEED = process.env.VPN_DEFAULT_SPEED || '100';
const VPN_DEFAULT_SPEED_LABEL = process.env.VPN_DEFAULT_SPEED_LABEL || '100 Mbps';

const ADDRESS_FOR_QUOTE = {
  streetType: 'Avenida',
  streetName: 'Paulista',
  number: 1530,
  neighborhood: 'Bela Vista',
  zipCode: '01310917',
  locationCode: '3550308',
  Latitude: '-23.5614',
  Longitude: '-46.6562',
};
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
  const num = String(addr.number);
  const city = 'São Paulo';
  const state = 'SP';
  const zipFormatted = addr.zipCode.length >= 8 ? `${addr.zipCode.slice(0, 5)}-${addr.zipCode.slice(5, 8)}` : addr.zipCode;
  const description = `${addr.streetType} ${addr.streetName} ${num}, ${addr.neighborhood} - ${city}, ${state} (${zipFormatted})`;
  const descBlock = {
    description,
    streetType: addr.streetType,
    streetName: addr.streetName,
    number: num,
    neighborhood: addr.neighborhood,
    city,
    stateAbbreviation: state,
    zipCode: addr.zipCode,
    country: 'Brasil',
    locationCode: addr.locationCode,
    Latitude: addr.Latitude,
    Longitude: addr.Longitude,
    hasNumber: true,
    hasNoNumber: false,
    id: addressInfo?.id ?? null,
  };
  return {
    function: 'advance',
    Token: addressInfo?.Token ?? '',
    QuoteId: quoteId,
    OppType: 'New opp',
    CustomerCategory: 'Corporate',
    GPONMaxDownloadSpeed: 10000,
    QuoteMemberList: [{
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
    }],
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

function fail(msg, res) {
  const err = new Error(msg);
  err.response = res;
  throw err;
}

async function ensureQuoteApproved(apiCall, quoteId, statusAprovado, proposalValidity) {
  if (IS_TRG && currentQuoteFlow.needsReviewed) {
    console.log('[E2E] 17d1. TRG: PATCH Quote Status → Reviewed (pré-aprovação)...');
    const reviewedPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Status: currentQuoteFlow.reviewedStatus,
      Vtal_Seg_ProposalValidityTerm__c: '1',
    });
    if (reviewedPatch.status !== 200 && reviewedPatch.status !== 204) {
      fail('PATCH Quote Status Reviewed', reviewedPatch);
    }

    console.log('[E2E] 17d2. TRG: PATCH Quote Vtal_Seg_ProposalValidity__c...');
    const validityPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Vtal_Seg_ProposalValidity__c: proposalValidity,
    });
    if (validityPatch.status !== 200 && validityPatch.status !== 204) {
      console.log('   PATCH validity (não crítico):', validityPatch.status);
    }
  }

  console.log('[E2E] 17d3. PATCH Quote Status →', statusAprovado, '(obrigatório antes de CreateOrderOnQuote)...');
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

  fail('PATCH Quote Status ' + statusAprovado + ' (cotação precisa estar Aprovado)', aprovadoPatch);
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
  const h = { baseUrl: instanceUrl, token: accessToken, cookie };
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);

  console.log('[E2E] 1. Criando Lead...');
  const leadBase = buildLeadPayload();
  const company = leadBase.fields.Company;
  const createPayload = /cursor/i.test(company) ? buildLeadPayload({ Company: `e2e${Date.now()}`, vtal_LXD_FantasyName__c: `e2e${Date.now()}` }) : leadBase;
  const createRes = await apiCall('POST', UI_API_RECORDS, createPayload);
  if (createRes.status !== 200 && createRes.status !== 201) fail('Create Lead', createRes);
  const leadBody = createRes.data;
  const leadId = leadBody.id;
  if (!leadId) fail('Lead sem id', createRes);

  console.log('[E2E] 2. Patch Lead Status Contacted...');
  const patchRes = await apiCall('PATCH', `${UI_API_RECORDS}/${leadId}`, { fields: { Status: 'Contacted' } });
  if (patchRes.status !== 200) fail('Patch Lead', patchRes);
  const leadAfterPatch = patchRes.data;

  console.log('[E2E] 3. Converter Lead...');
  const convertPayload = buildConvertLeadPayload(leadAfterPatch);
  const convertRes = await apiCall('POST', CONVERT_LEAD_URL, convertPayload);
  if (convertRes.status !== 200) fail('Convert Lead', convertRes);
  const out = convertRes.data?.vtal_LXD_outputclass;
  if (!out?.AccountOrganizationId || !out?.AccountBussinessId || !out?.AccountBillingId) {
    fail('Conversão sem AccountIds: ' + JSON.stringify(convertRes.data), convertRes);
  }

  console.log('[E2E] 4. PATCH Organization...');
  const orgGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${out.AccountOrganizationId}`);
  if (orgGet.status !== 200) fail('GET Org', orgGet);
  const fantasyName = orgGet.data?.vtal_LXD_FantasyName__c || '';
  await apiCall(
    'PATCH',
    `${SOBJECTS_ACCOUNT}/${out.AccountOrganizationId}`,
    buildOrganizationPatchPayload(fantasyName, {
      accountName: orgGet.data?.Name || '',
      companyFromLead: getFieldValue(leadAfterPatch, 'Company') || '',
    }),
  );

  console.log('[E2E] 5. PATCH Business...');
  const businessGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${out.AccountBussinessId}`);
  if (businessGet.status !== 200) fail('GET Business', businessGet);
  const businessBody = businessGet.data;
  const accountName = getFieldValue(leadAfterPatch, 'Company') || businessBody?.Name || '';
  const email = getFieldValue(leadAfterPatch, 'Email') || businessBody?.vlocity_cmt__BillingEmailAddress__c || '';
  await apiCall('PATCH', `${SOBJECTS_ACCOUNT}/${out.AccountBussinessId}`, buildBusinessAccountPatchPayload({ accountName, email, environment: envName }));
  console.log('[E2E] 6. PATCH Billing...');
  const accountNumber = businessBody?.Account_Number__c || '';
  const ufOfClient = businessBody?.vtal_LXD_UF_OfClient__c || 'SP';
  await apiCall('PATCH', `${SOBJECTS_ACCOUNT}/${out.AccountBillingId}`, buildBillingAccountPatchPayload({ accountNumber, ufOfClient, environment: envName }));

  console.log('[E2E] 7. Criando 2 Contatos...');
  const principalRes = await apiCall('POST', SOBJECTS_CONTACT, buildContactPayload(out.AccountBussinessId, 'Principal'));
  if (principalRes.status !== 201) fail('Contact Principal', principalRes);
  const tecnicoRes = await apiCall('POST', SOBJECTS_CONTACT, buildContactPayload(out.AccountBussinessId, 'Technical'));
  if (tecnicoRes.status !== 201) fail('Contact Técnico', tecnicoRes);
  const contactTecnicoId = tecnicoRes.data?.id;
  if (!contactTecnicoId) fail('Contact Técnico sem id', tecnicoRes);

  console.log('[E2E] 8. Contract MSA + ContentVersion + Link + Activate...');
  const contractRes = await apiCall('POST', SOBJECTS_CONTRACT, buildContractMSAPayload(out.AccountOrganizationId));
  if (contractRes.status !== 201) fail('Contract', contractRes);
  const contractId = contractRes.data?.id;
  if (!contractId) fail('Contract sem id', contractRes);

  const cvRes = await apiCall('POST', SOBJECTS_CONTENT_VERSION, buildContentVersionMSAPayload());
  if (cvRes.status !== 201) fail('ContentVersion', cvRes);
  const contentVersionId = cvRes.data?.id;
  if (!contentVersionId) fail('ContentVersion sem id', cvRes);

  const qDoc = `SELECT ContentDocumentId FROM ContentVersion WHERE Id='${contentVersionId}'`;
  const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qDoc)}`);
  if (qRes.status !== 200 || !qRes.data?.records?.[0]?.ContentDocumentId) fail('Query ContentDocumentId', qRes);
  const contentDocumentId = qRes.data.records[0].ContentDocumentId;

  await apiCall('POST', SOBJECTS_CONTENT_DOCUMENT_LINK, {
    ContentDocumentId: contentDocumentId,
    LinkedEntityId: contractId,
    ShareType: 'V',
  });

  await apiCall('PATCH', `${SOBJECTS_CONTRACT}/${contractId}`, buildContractActivatePayload());

  console.log('[E2E] 9. getAccount (executeAnonymous) + poll BRM...');
  const accountBillingId = out.AccountBillingId;
  if (IS_TRG) {
    console.log('[E2E] TRG: BRM activation/poll desativado. Pulando executeAnonymous/poll para AccountBillingId:', accountBillingId);
  } else {
    const apexBody = `try { Map<String,Object> r = Vtal_SF_IntegrationBillAccController.getAccount('${accountBillingId}'); System.debug(JSON.serialize(r)); } catch(Exception e) { System.debug(e.getMessage()); }`;
    const execRes = await apiCall('GET', `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apexBody)}`);
    if (execRes.status !== 200 || !execRes.data?.success) fail('executeAnonymous getAccount', execRes);

    const deadline = Date.now() + BRM_POLL_TIMEOUT_MS;
    let billingBody;
    while (Date.now() < deadline) {
      const billingGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${accountBillingId}`);
      if (billingGet.status !== 200) fail('GET Billing', billingGet);
      billingBody = billingGet.data;
      if (billingBody?.vtal_LXD_BRMId__c) break;
      await delay(BRM_POLL_INTERVAL_MS);
    }
    if (!billingBody?.vtal_LXD_BRMId__c) fail('BRM não preenchido no timeout', { status: 0, data: billingBody });

    console.log('[E2E] Aguardando 45s para conta Billing/Business ficar ativa no BRM...');
    await delay(45000);

    console.log('[E2E] Lead + BRM OK. AccountBillingId:', accountBillingId);
  }
  return {
    accountBillingId,
    accountBussinessId: out.AccountBussinessId,
    accountOrganizationId: out.AccountOrganizationId,
    contactTecnicoId,
  };
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

  const addr = ADDRESS_FOR_QUOTE;
  console.log('\n[E2E] --- Endereço:', addr.streetType, addr.streetName, addr.number, `CEP ${addr.zipCode.slice(0, 5)}-${addr.zipCode.slice(5, 8)} ---`);
  const vpnProduct = await resolveVpnProduct(apiCall);
  if (!vpnProduct) fail('Não foi possível resolver produto VPN MPLS (Product2/PricebookEntry)', { status: 0 });

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
    const addressId = addressInfo?.id ?? 40373338;
    const zipFmt = `${addr.zipCode.slice(0, 5)}-${addr.zipCode.slice(5, 8)}`;
    const enderecoCompleto = `${addr.streetType} ${addr.streetName} ${addr.number}, ${addr.neighborhood} - São Paulo, SP (${zipFmt})`;
    const getViabilityBody = {
      items: [{
          nomeProduto: PRODUCT_CODE_VPN,
          enderecoCompleto,
          skipGpon: false,
          enableAdvance: true,
          complements: [{ argComplemento: '', valorComplemento: '', tipoComplemento: '' }],
          UF: 'SP',
          idEnderecoExt: String(addressId),
          viability: 1,
          nFachada: String(addr.number),
          codigoLogradouro: '2706',
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
    console.log('[E2E] 17a2. Cart API v2 — reprice (antes do save; alinha IP Connect)...');
    await cartReprice(apiCall, quoteId);
  }

  const qliFetch = await fetchQuoteLineItemsForVpn(apiCall, quoteId);
  if (!qliFetch.ok) fail('Query QuoteLineItem (após viabilidade/reprice)', qliFetch.res);
  const qliRecordsForVpn = qliFetch.records;
  if (!qliRecordsForVpn.length) fail('Nenhum QuoteLineItem após viabilidade e reprice', qliFetch.res);
  console.log('   FCVpnMplsChild:', qliRecordsForVpn.length, 'QuoteLineItem(s); mensal/instalação', orderValorMensal, '/', orderValorInstalacao);

  // 6) ProductsValidation save (FCVpnMplsChild)
  console.log('[E2E] 17b0. Vtal_Seg_ProductsValidation (function: save — FCVpnMplsChild)...');
  const saveValidationRes = await apiCall(
    'POST',
    IP_PRODUCTS_VALIDATION,
    buildProductsValidationBodyVpn(quoteId, qliRecordsForVpn, 'save', orderValorMensal, orderValorInstalacao, vpnProduct.productCode),
  );
  if (saveValidationRes.status !== 200 && saveValidationRes.status !== 201) {
    fail('ProductsValidation(save)', saveValidationRes);
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

  // 7) ProductsValidation advance (FCVpnMplsChild)
  console.log('[E2E] 17c. Vtal_Seg_ProductsValidation (function: advance — FCVpnMplsChild)...');
  const validationRes = await apiCall(
    'POST',
    IP_PRODUCTS_VALIDATION,
    buildProductsValidationAdvanceBodyVpn(quoteId, qliRecordsForVpn, orderValorMensal, orderValorInstalacao, vpnProduct.productCode),
  );
  if (validationRes.status !== 200 && validationRes.status !== 201) fail('ProductsValidation(advance)', validationRes);

  if (process.env.USE_CART_REPRICE !== '0') {
    console.log('[E2E] 17c2. Cart API v2 — reprice (após save/advance; alinha Link Dedicado passo 21)...');
    await cartReprice(apiCall, quoteId);
  }

  if (process.env.SKIP_DUPLICATE_VPN_VALUES !== '1') {
    try {
      console.log('[E2E] 17c3. Vtal_Seg_DuplicateVPNValues (VPN MPLS)...');
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

    // NÃO fazer PATCH em QuoteLineItem: o fluxo correto (com taxa de instalação) deixa o produto principal
    // com Preço 0 e usa child lines (Push Event Data) para mensalidade/instalação. PATCH quebra essa estrutura.

    const proposalValidity = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const statusAprovado = process.env.QUOTE_STATUS_APROVADO || currentQuoteFlow.finalStatus;
    await ensureQuoteApproved(apiCall, quoteId, statusAprovado, proposalValidity);

    if (IS_TI) {
      console.log('[E2E] 17e. PATCH Quote (salvar cotação após aprovação)...');
      const savePatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, { Vtal_Seg_ProposalValidity__c: proposalValidity });
      if (savePatch.status !== 200 && savePatch.status !== 204) {
        console.log('   PATCH save (não crítico):', savePatch.status);
      }
    }

    console.log('[E2E] 17f. Vtal_Seg_ValidateCreateOrder...');
    const validateRes = await apiCall('POST', IP_VALIDATE_CREATE_ORDER, { QuoteId: quoteId });
    if (validateRes.status !== 200 && validateRes.status !== 201) {
      console.log('   ValidateCreateOrder:', validateRes.status, validateRes.data?.error || validateRes.text?.slice(0, 200), '(continuando)');
    }

    const uf = process.env.ORDER_UF || 'SP';
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
      return { quoteId, orderId, orderNumber, orderStatus, subOrderEmImplantacao: !!subOrderWithStatus };
    }

    if (isInviableOrderError(lastOrderRes)) {
      fail(
        'Endereço inviável para VPN MPLS: ' + addr.streetName + ' ' + addr.number + ' (CEP ' + addr.zipCode.slice(0, 5) + '-' + addr.zipCode.slice(5, 8) + ')',
        lastOrderRes,
      );
    }
    if (!orderId) fail('Vtal_CreateOrderOnQuote não retornou MasterOrderId após ' + CREATE_ORDER_MAX_ATTEMPTS + ' tentativas', lastOrderRes);
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

  const uf = process.env.ORDER_UF || 'SP';
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

  return { quoteId, orderId, orderNumber, orderStatus, subOrderEmImplantacao: !!subOrderWithStatus };
}

const FULL_FLOW_MAX_RUNS = 3;

/** Se START_FROM_QUOTE=1 e existirem ACCOUNT_ORGANIZATION_ID, ACCOUNT_BUSINESS_ID, ACCOUNT_BILLING_ID: massa já cadastrada até ativação BRM (contato técnico e primário já existem). Só executa Oportunidade → Cotação → Pedido. CONTACT_TECNICO_ID opcional; se ausente, busca um contato da conta Business. */
function getAccountIdsFromEnv() {
  if (process.env.START_FROM_QUOTE !== '1') return null;
  const accountOrganizationId = process.env.ACCOUNT_ORGANIZATION_ID?.trim();
  const accountBussinessId = process.env.ACCOUNT_BUSINESS_ID?.trim();
  const accountBillingId = process.env.ACCOUNT_BILLING_ID?.trim();
  if (!accountOrganizationId || !accountBussinessId || !accountBillingId) return null;
  const contactTecnicoId = process.env.CONTACT_TECNICO_ID?.trim() || null;
  return {
    accountBussinessId,
    accountOrganizationId,
    accountBillingId,
    contactTecnicoId,
  };
}

/** Contato técnico (Type = Technical); senão qualquer contato da conta Business. */
async function resolveContactFromBusiness(instanceUrl, accessToken, cookie, accountBussinessId) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);
  const qTech = `SELECT Id FROM Contact WHERE AccountId = '${accountBussinessId}' AND IsDeleted = false AND vlocity_cmt__Type__c = 'Technical' LIMIT 1`;
  let res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qTech)}`);
  if (res.status === 200 && res.data?.records?.length) return res.data.records[0].Id;
  const qAny = `SELECT Id FROM Contact WHERE AccountId = '${accountBussinessId}' AND IsDeleted = false LIMIT 1`;
  res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qAny)}`);
  if (res.status !== 200 || !res.data?.records?.length) return null;
  return res.data.records[0].Id;
}

/** PATCH Org/Business/Billing como runLeadFlow (necessário em TRG para OM/subpedido). */
async function patchMassaProntaAccounts(instanceUrl, accessToken, cookie, accountIds) {
  if (process.env.SKIP_MASSA_ACCOUNT_PATCH === '1') {
    console.log('[E2E] SKIP_MASSA_ACCOUNT_PATCH=1 — pulando PATCH Organization/Business/Billing.');
    return;
  }
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);
  const { accountOrganizationId, accountBussinessId, accountBillingId } = accountIds;
  if (!accountOrganizationId || !accountBussinessId || !accountBillingId) return;

  console.log('[E2E] Massa pronta: PATCH Organization / Business / Billing (alinhado ao fluxo Lead + TRG)...');
  const orgGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${accountOrganizationId}`);
  if (orgGet.status !== 200) fail('GET Org (massa pronta)', orgGet);
  const fantasyName = orgGet.data?.vtal_LXD_FantasyName__c || '';
  await apiCall(
    'PATCH',
    `${SOBJECTS_ACCOUNT}/${accountOrganizationId}`,
    buildOrganizationPatchPayload(fantasyName, {
      accountName: orgGet.data?.Name || '',
      companyFromLead: '',
    }),
  );

  const businessGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${accountBussinessId}`);
  if (businessGet.status !== 200) fail('GET Business (massa pronta)', businessGet);
  const businessBody = businessGet.data;
  const accountName = businessBody?.Name || '';
  const email =
    businessBody?.Vtal_SF_Email__c ||
    businessBody?.vlocity_cmt__BillingEmailAddress__c ||
    '';
  await apiCall(
    'PATCH',
    `${SOBJECTS_ACCOUNT}/${accountBussinessId}`,
    buildBusinessAccountPatchPayload({ accountName, email, environment: envName }),
  );

  const accountNumber = businessBody?.Account_Number__c || '';
  const ufOfClient = businessBody?.vtal_LXD_UF_OfClient__c || 'SP';
  await apiCall(
    'PATCH',
    `${SOBJECTS_ACCOUNT}/${accountBillingId}`,
    buildBillingAccountPatchPayload({ accountNumber, ufOfClient, environment: envName }),
  );
  console.log('[E2E] PATCH contas (massa pronta) concluído.');
}

/** Se QUOTE_ID_READY=1 com QUOTE_ID + account ids, pula Lead/BRM/Quote e vai direto para gerar pedido (ValidateCreateOrder, CreateOrderOnQuote, checkoutOrderOMBatch). */
function getReadyQuoteFromEnv() {
  if (process.env.QUOTE_ID_READY !== '1') return null;
  const quoteId = process.env.QUOTE_ID?.trim();
  const accountBussinessId = process.env.ACCOUNT_BUSINESS_ID?.trim();
  const accountOrganizationId = process.env.ACCOUNT_ORGANIZATION_ID?.trim();
  const contactTecnicoId = process.env.CONTACT_TECNICO_ID?.trim();
  if (!quoteId || !accountBussinessId || !accountOrganizationId || !contactTecnicoId) return null;
  return { quoteId, accountBussinessId, accountOrganizationId, contactTecnicoId };
}

async function main() {
  if (!tokenUrl || !baseUrl) {
    console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
    process.exit(1);
  }
  const sf = getUser();
  if (!sf.client_id || !sf.client_secret) {
    console.error('Credenciais em user.json (dev.salesforce)');
    process.exit(1);
  }

  const readyQuote = getReadyQuoteFromEnv();
  const skipLead = getAccountIdsFromEnv();
  if (readyQuote) {
    console.log('[E2E] Modo QUOTE_ID_READY: cotação pronta. Gerando pedido direto.');
  } else if (skipLead) {
    console.log('[E2E] Modo START_FROM_QUOTE: reutilizando massa. Só cotação pra frente.');
  }

  for (let run = 1; run <= FULL_FLOW_MAX_RUNS; run++) {
    console.log('\n========== EXECUÇÃO', run, '/', FULL_FLOW_MAX_RUNS, '==========');
    console.log('Token...');
    const { accessToken, instanceUrl } = await getToken();
    const cookie = sf.cookie || '';

    try {
      if (readyQuote) {
        const result = await runOrderOnlyFlow(instanceUrl, accessToken, cookie, readyQuote);
        if (result.orderNumber) {
          console.log('\n*** PEDIDO GERADO ***');
          console.log('  OrderId:', result.orderId);
          console.log('  OrderNumber:', result.orderNumber);
          console.log('  Status:', result.orderStatus);
          process.exit(0);
        }
      }
      let accountIds = skipLead || (await runLeadFlow(instanceUrl, accessToken, cookie));
      if (skipLead) {
        await patchMassaProntaAccounts(instanceUrl, accessToken, cookie, accountIds);
      }
      if (accountIds && accountIds.contactTecnicoId == null && accountIds.accountBussinessId) {
        console.log('[E2E] Resolvendo contato técnico na conta Business...');
        accountIds.contactTecnicoId = await resolveContactFromBusiness(instanceUrl, accessToken, cookie, accountIds.accountBussinessId);
        if (!accountIds.contactTecnicoId) {
          console.error('[E2E] Nenhum contato encontrado na conta Business. Informe CONTACT_TECNICO_ID no env.');
          process.exit(1);
        }
      }
      const result = await runQuoteFlow(instanceUrl, accessToken, cookie, accountIds);
      if (result.orderNumber) {
        console.log('\n*** PEDIDO GERADO ***');
        console.log('  OrderId:', result.orderId);
        console.log('  OrderNumber:', result.orderNumber);
        console.log('  Status:', result.orderStatus);
        console.log('  Subpedido "Em implantação":', result.subOrderEmImplantacao ? 'sim' : 'não (timeout ou ainda processando)');
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
        console.log(skipLead ? 'Nova tentativa em 25s (nova cotação)...' : 'Nova tentativa em 25s (novo Lead, nova conta)...');
        await delay(25000);
      } else {
        process.exit(1);
      }
    }
  }
  process.exit(1);
}

main();
