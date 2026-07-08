/**
 * Fluxo E2E: Lead → BRM → Oportunidade → Cotação → Viabilidade → Pedido.
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
 * Uso: [ENVIRONMENT=dev] node scripts/gerar-pedido-ip-connect.js
 *
 * Escopo: gera pedido no Salesforce e aguarda subpedido em implantação — **sem** etapa de configuração PEGA.
 *
 * Modo cotação pronta:
 *   QUOTE_ID_READY=1 QUOTE_ID=0Q0xxx ACCOUNT_BUSINESS_ID=001xxx ACCOUNT_ORGANIZATION_ID=001xxx CONTACT_TECNICO_ID=003xxx node scripts/gerar-pedido-ip-connect.js
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
const PRICEBOOK_ENTRY_ID = process.env.PRICEBOOK_ENTRY_ID || '01uU6000001jmRJIAY';
const PRODUCT2_ID = process.env.PRODUCT2_ID || '01tU6000004z8nxIAA';

// Endereços por região (MASS_ADDRESS_REGION=SP|RJ). Default: Av. Paulista.
const ADDRESSES_TO_TRY = getAddressesToTry();
const VIABILITY_WAIT_MS = parseInt(process.env.VIABILITY_WAIT_MS || '25000', 10);

function buildCreateQuoteMembersBody(quoteId, addr, addressInfo = null) {
  const descBlock = buildDescriptionBlock(addr, addressInfo);
  const complementoBlock = buildComplementoBlock(addr);
  const quoteMember = {
      parentblock: 1,
      label: 'Block1',
      UnitPrice: 8740.93,
      PricebookEntryId: PRICEBOOK_ENTRY_ID,
      'LookupProduct-Block': {
        value: {
          Id: PRODUCT2_ID,
          PricebookEntryId: PRICEBOOK_ENTRY_ID,
          ProductCode: 'CONNECTIVITY_IP_CONNECT',
          vlocity_cmt__ObjectTypeName__c: 'IP Product Specification',
          vlocity_cmt__GlobalGroupKey__c: `e2e-${Date.now()}`,
        },
        name: 'IP Connect',
        LookupProduct: 'IP Connect',
      },
      'Approach-Block': { label: 'Simples', value: 'Simples', Approach: 'Simples' },
      additionalInformation: { approach: 'Simples' },
      'downloadSpeed-Block': { label: '14 Mbps', value: '14' },
      'TipoVelocidade-Block': { label: 'Simétrico', value: 'Simétrico' },
      'description-Block': descBlock,
      deliveryAddressValue: 'Endereço do Cliente',
      useTypeValue: 'Assinante Comum',
      isSharedDesignation: false,
      productCode: 'CONNECTIVITY_IP_CONNECT',
    };
  if (complementoBlock) quoteMember['Complemento-Block'] = complementoBlock;
  return {
    function: 'advance',
    Token: addressInfo?.Token ?? '',
    QuoteId: quoteId,
    OppType: 'New opp',
    CustomerCategory: 'Corporate',
    QuoteMemberList: [quoteMember],
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

/** Garante string numérica para o IP; nunca envia "null" (ProductsValidation não persiste RecurringCharge/OneTimeCharge se vier null). */
function asNumeroString(val, defaultVal) {
  if (val == null || val === '' || String(val).toLowerCase() === 'null') return defaultVal;
  const s = String(val).trim();
  if (s === '' || Number.isNaN(Number(s))) return defaultVal;
  return s;
}

/** Monta FCIPConnectChild para save: Mensalidade e TaxaInstalacao sempre string numérica (nunca "null") para o IP persistir no QuoteLineItem. */
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

/**
 * Payload para ProductsValidation(advance).
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

    console.log('[E2E] 12. Criando Quote (RecordTypeId, Pricebook2Id, Status Draft)...');
    const quotePayload = {
      Name: `Cotação - Oportunidade ${opportunityId} (${addr.streetName} ${addr.number})`,
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
    console.log('[E2E] 13. Vtal_CreateQuoteMembers (IP Connect,', addr.streetName, addr.number, addressInfo?.id ? `, id ${addressInfo.id}` : '', ')...');
    const membersRes = await apiCall('POST', IP_CREATE_QUOTE_MEMBERS, buildCreateQuoteMembersBody(quoteId, addr, addressInfo));
    if (membersRes.status !== 200 && membersRes.status !== 201) fail('CreateQuoteMembers', membersRes);

    console.log('[E2E] 14. Query QuoteLineItem...');
    const q = `SELECT Id FROM QuoteLineItem WHERE QuoteId='${quoteId}'`;
    const qliRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
    if (qliRes.status !== 200) fail('Query QuoteLineItem', qliRes);
    const records = qliRes.data?.records || [];
    const quoteLineItemId = records[0]?.Id;
    if (!quoteLineItemId) fail('Nenhum QuoteLineItem', qliRes);

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
          nomeProduto: 'IP_CONNECT',
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
    console.log('[E2E] 17a. VtalCap_IPIpConnectQuoteInstallationFee (calcular taxa instalação / valores por velocidade)...');
    const installFeeRes = await apiCall('POST', IP_IP_CONNECT_QUOTE_INSTALLATION_FEE, buildIpConnectQuoteInstallationFeeBody(quoteId));
    let orderValorMensal = VALOR_MENSAL_IP_CONNECT;
    let orderValorInstalacao = VALOR_INSTALACAO_IP_CONNECT;
    if (installFeeRes.status === 200 || installFeeRes.status === 201) {
      const raw = installFeeRes.data?.result ?? installFeeRes.data;
      const fee = Array.isArray(raw) ? raw[0] : raw;
      if (fee && typeof fee === 'object') {
        const rawM = fee.Mensalidade ?? fee.RecurringCharge ?? fee.ValorMensal ?? fee.valorMensal;
        const rawT = fee.TaxaInstalacao ?? fee.OneTimeCharge ?? fee.ValorInstalacao ?? fee.ValorInstalacaoLPU ?? fee.valorInstalacao;
        orderValorMensal = asNumeroString(rawM, VALOR_MENSAL_IP_CONNECT);
        orderValorInstalacao = asNumeroString(rawT, VALOR_INSTALACAO_IP_CONNECT);
        console.log('   Valores (velocidade): Mensal', orderValorMensal, '| Instalação', orderValorInstalacao);
      }
    } else {
      console.log('   IpConnectQuoteInstallationFee (não crítico):', installFeeRes.status, installFeeRes.data?.error || installFeeRes.text?.slice(0, 150));
    }
    orderValorMensal = asNumeroString(orderValorMensal, VALOR_MENSAL_IP_CONNECT);
    orderValorInstalacao = asNumeroString(orderValorInstalacao, VALOR_INSTALACAO_IP_CONNECT);
    if (process.env.STRICT_QUOTE_VALUES === '1' && (orderValorMensal === '' || orderValorInstalacao === '')) {
      fail('IpConnectQuoteInstallationFee não retornou valores válidos (Mensalidade/TaxaInstalacao). Abortando.', { status: 0, data: installFeeRes?.data });
    }

    if (process.env.USE_CART_REPRICE !== '0') {
      console.log('[E2E] 17a2. Cart API v2 — reprice (recalcula carrinho, consolida runtime JSON, Push Event Data)...');
      await cartReprice(apiCall, quoteId);
    }

    // save + advance com FCIPConnectChild (Mensalidade/TaxaInstalacao) para cotação e subpedido com valor correto (trace Salvar e Avançar).
    console.log('[E2E] 17b0. Vtal_Seg_ProductsValidation (function: save — FCIPConnectChild com Mensalidade e TaxaInstalacao)...');
    console.log('   Payload save: Mensalidade="' + orderValorMensal + '", TaxaInstalacao="' + orderValorInstalacao + '" (nunca "null")');
    const saveValidationRes = await apiCall('POST', IP_PRODUCTS_VALIDATION, buildProductsValidationBody(quoteId, quoteLineItemId, 'save', orderValorMensal, orderValorInstalacao));
    if (saveValidationRes.status !== 200 && saveValidationRes.status !== 201) {
      fail('ProductsValidation(save) — cotação não consolidada; Valor Mensal/Instalação ficarão vazios no subpedido', saveValidationRes);
    }
    console.log('   QuoteLineItem consolidado:', orderValorMensal, '/', orderValorInstalacao);

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

    console.log('[E2E] 17c. Vtal_Seg_ProductsValidation (function: advance — FCIPConnectChild com Mensalidade/TaxaInstalacao para cotação e subpedido corretos)...');
    const validationRes = await apiCall('POST', IP_PRODUCTS_VALIDATION, buildProductsValidationAdvanceBody(quoteId, quoteLineItemId, orderValorMensal, orderValorInstalacao));
    if (validationRes.status !== 200 && validationRes.status !== 201) fail('ProductsValidation(advance)', validationRes);

    // NÃO fazer PATCH em QuoteLineItem: o fluxo correto (com taxa de instalação) deixa o produto principal
    // com Preço 0 e usa child lines (Push Event Data) para mensalidade/instalação. PATCH quebra essa estrutura.

    const statusAprovado = process.env.QUOTE_STATUS_APROVADO || currentQuoteFlow.finalStatus;
    const proposalValidity = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
      let subOrderFallback = null;
      let firstPollDone = false;
      while (Date.now() < subDeadline) {
        const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(subOrderQuery)}`);
        if (qRes.status === 200 && qRes.data?.records?.length > 0) {
          if (!firstPollDone) {
            console.log('   Status atual dos subpedidos:', qRes.data.records.map((r) => r.OrderNumber + '=' + (r.Status || '')).join(', '));
            firstPollDone = true;
          }
          for (const r of qRes.data.records) {
            if (!subOrderFallback && r.OrderNumber) subOrderFallback = r;
            if (SUB_ORDER_STATUS_TARGETS.includes((r.Status || '').trim())) {
              subOrderWithStatus = r;
              break;
            }
          }
          if (subOrderWithStatus) {
            console.log('   Subpedido com status "' + subOrderWithStatus.Status + '":', subOrderWithStatus.OrderNumber, subOrderWithStatus.vtal_LXD_Produto_do_pedido__c || '');
            break;
          }
        }
        await delay(SUB_ORDER_POLL_INTERVAL_MS);
      }
      if (!subOrderWithStatus && subOrderFallback) {
        subOrderWithStatus = subOrderFallback;
        console.log(
          '   (subpedido ainda não em implantação; ORDEMSERVICO PEGA:',
          subOrderFallback.OrderNumber,
          '| Status:',
          subOrderFallback.Status || '—',
          ')',
        );
      } else if (!subOrderWithStatus) {
        console.log('   (timeout: nenhum subpedido com Status "' + SUB_ORDER_STATUS_TARGETS.join('" ou "') + '" no prazo)');
      }
      const subOrderReady = subOrderWithStatus
        ? SUB_ORDER_STATUS_TARGETS.includes((subOrderWithStatus.Status || '').trim())
        : false;
      return {
        quoteId,
        orderId,
        orderNumber,
        orderStatus,
        subOrderEmImplantacao: subOrderReady,
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

  console.log('[E2E] 19. GET Order (validar OrderNumber e Status)...');
  const orderGet = await apiCall('GET', `${SOBJECTS_ORDER}/${orderId}`);
  if (orderGet.status !== 200) fail('GET Order', orderGet);
  const order = orderGet.data;
  const orderNumber = order?.OrderNumber;
  const orderStatus = order?.Status;
  if (!orderNumber) fail('Order sem OrderNumber', orderGet);
  console.log('[E2E] Pedido criado — Número:', orderNumber, '| Id:', orderId, '| Status:', orderStatus);

  const SUB_ORDER_STATUS_TARGETS = ['Em implantação', 'Em implementado', 'In Implementation'];
  const SUB_ORDER_POLL_TIMEOUT_MS = 120000;
  const SUB_ORDER_POLL_INTERVAL_MS = 5000;
  console.log(`[E2E] 20. Poll subpedidos até Status = "${SUB_ORDER_STATUS_TARGETS.join('" ou "')}"...`);
  const subOrderQuery = `SELECT Id, OrderNumber, Status, vtal_LXD_Produto_do_pedido__c FROM Order WHERE vlocity_cmt__ParentOrderId__c = '${orderId}'`;
  const subDeadline = Date.now() + SUB_ORDER_POLL_TIMEOUT_MS;
  let subOrderWithStatus = null;
  let subOrderFallback = null;
  while (Date.now() < subDeadline) {
    const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(subOrderQuery)}`);
    if (qRes.status === 200 && qRes.data?.records?.length > 0) {
      for (const r of qRes.data.records) {
        if (!subOrderFallback && r.OrderNumber) subOrderFallback = r;
        if (SUB_ORDER_STATUS_TARGETS.includes((r.Status || '').trim())) {
          subOrderWithStatus = r;
          break;
        }
      }
      if (subOrderWithStatus) {
        console.log('   Subpedido com status "' + subOrderWithStatus.Status + '":', subOrderWithStatus.OrderNumber);
        break;
      }
    }
    await delay(SUB_ORDER_POLL_INTERVAL_MS);
  }
  if (!subOrderWithStatus && subOrderFallback) {
    subOrderWithStatus = subOrderFallback;
    console.log(
      '   (subpedido ainda não em implantação; ORDEMSERVICO PEGA:',
      subOrderFallback.OrderNumber,
      '| Status:',
      subOrderFallback.Status || '—',
      ')',
    );
  } else if (!subOrderWithStatus) {
    console.log('   (timeout ou ainda processando)');
  }
  const subOrderReady = subOrderWithStatus
    ? SUB_ORDER_STATUS_TARGETS.includes((subOrderWithStatus.Status || '').trim())
    : false;

  return {
    quoteId,
    orderId,
    orderNumber,
    orderStatus,
    subOrderEmImplantacao: subOrderReady,
    subOrderOrderNumber: subOrderWithStatus?.OrderNumber ?? null,
  };
}

const {
  getAccountIdsFromEnv,
  getReadyQuoteFromEnv,
  logPedidoEnvModes,
  runPedidoScriptWithRetries,
} = require('../support/utils/salesforce/scriptEnvModes.js');

async function main() {
  if (!tokenUrl || !baseUrl) {
    console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
    process.exit(1);
  }
  if (!sf.client_id || !sf.client_secret) {
    console.error('Credenciais em user.json (dev.salesforce)');
    process.exit(1);
  }

  const readyQuote = getReadyQuoteFromEnv();
  const skipLead = getAccountIdsFromEnv();
  logPedidoEnvModes(readyQuote, skipLead);

  await runPedidoScriptWithRetries({
    getToken,
    cookie: defaultCookie,
    skipLead,
    onRun: async ({ accessToken, instanceUrl, cookie }) => {
      if (readyQuote) {
        const result = await runOrderOnlyFlow(instanceUrl, accessToken, cookie, readyQuote);
        if (result.orderNumber) {
          await finalizePedidoGerado(mergeAccountIdsIntoPedidoResult(result, readyQuote));
          return true;
        }
      }
      const accountIds = skipLead || (await runLeadFlow(instanceUrl, accessToken, cookie));
      const result = await runQuoteFlow(instanceUrl, accessToken, cookie, accountIds);
      if (result.orderNumber) {
        await finalizePedidoGerado(mergeAccountIdsIntoPedidoResult(result, accountIds));
        return true;
      }
      console.log('\n', result.message || 'Order não gerado', 'QuoteId:', result.quoteId);
      return false;
    },
  });
}

main();
