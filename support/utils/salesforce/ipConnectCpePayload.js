/**

 * Payload do child CPE em ProductsValidation (FCIPConnectChild[`{qliId}.Child.CPE`]).

 * Trace: cpe.har / cpe2.har — CPE child enviado UMA vez (advance antes da viabilidade);
 * save/advance posteriores e pós-viabilidade NÃO reenviam CPE (evita duplicar linhas).

 */

const VLOCITY_NULL = '{$Vlocity.NULL}';



const DEFAULT_CPE = {

  porte: 'P',

  equipamento: 'Vtal',

  tipoEquipamento: 'Roteador',

  produto: 'CONNECTIVITY_CPE',

  downloadSpeed: '200 Mbps',

  mensalidade: '77.63',

  taxaInstalacao: '300',

  valorManutencao: '52',

};



/** Product2 CPE porte P — TI: 01tHZ00000Gy7AIYAZ | TRG: 01tHa000009yFwfIAE */

const CPE_PRODUCT2_ID_TI = '01tHZ00000Gy7AIYAZ';

const CPE_PRODUCT2_ID_TRG = '01tHa000009yFwfIAE';



const IP_GET_PRICE_CPE =

  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_GetPriceCPE';



function isTruthyEnvFlag(value) {
  return value === '1' || value === 'true' || String(value || '').toLowerCase() === 'yes';
}

function isIpConnectCpeEnabled() {
  return (
    isTruthyEnvFlag(process.env.INCLUDE_IP_CONNECT_CPE)
    || isTruthyEnvFlag(process.env.INCLUDE_VPN_CPE)
    || isTruthyEnvFlag(process.env.INCLUDE_LD_CPE)
  );
}



function resolveCpeProduct2Id() {

  const direct = String(process.env.CPE_PRODUCT2_ID || '').trim();

  if (direct) return direct;

  const env = String(process.env.ENVIRONMENT || process.env.ENV || 'ti').trim().toLowerCase();

  if (env === 'trg') return CPE_PRODUCT2_ID_TRG;

  const tiOverride = String(process.env.CPE_PRODUCT2_ID_TI || '').trim();

  return tiOverride || CPE_PRODUCT2_ID_TI;

}



function resolveCpeOptionsFromEnv(overrides = {}) {

  const product2Id = overrides.product2Id ?? resolveCpeProduct2Id();

  return {

    porte: process.env.CPE_PORTE || DEFAULT_CPE.porte,

    equipamento: process.env.CPE_EQUIPAMENTO || DEFAULT_CPE.equipamento,

    tipoEquipamento: process.env.CPE_TIPO_EQUIPAMENTO || DEFAULT_CPE.tipoEquipamento,

    downloadSpeed: process.env.CPE_DOWNLOAD_SPEED || DEFAULT_CPE.downloadSpeed,

    mensalidade: process.env.CPE_MENSALIDADE || DEFAULT_CPE.mensalidade,

    taxaInstalacao: process.env.CPE_TAXA_INSTALACAO || DEFAULT_CPE.taxaInstalacao,

    valorManutencao: process.env.CPE_VALOR_MANUTENCAO || DEFAULT_CPE.valorManutencao,

    product2Id,

    ...overrides,

  };

}



function buildCpeChildEntry(quoteLineItemId, options = {}) {

  const opts = resolveCpeOptionsFromEnv(options);

  const cpeKey = `${quoteLineItemId}.Child.CPE`;

  const entry = {

    Equipamento: opts.equipamento,

    ParentQuoteLineItem: quoteLineItemId,

    Porte: opts.porte,

    Produto: DEFAULT_CPE.produto,

    TipoEquipamento: opts.tipoEquipamento,

    ATT_CAPACIDADE_BANDA: VLOCITY_NULL,

    ATT_EOL: VLOCITY_NULL,

    ATT_EOS: VLOCITY_NULL,

    ATT_ID_SKU: VLOCITY_NULL,

    ATT_SUPORTA_SD_WAN: VLOCITY_NULL,

    ATT_SUPORTA_VOZ: VLOCITY_NULL,

    DownloadSpeed: opts.downloadSpeed,

    Marca: VLOCITY_NULL,

    Mensalidade: String(opts.mensalidade),

    Modelo: VLOCITY_NULL,

    TaxaInstalacao: String(opts.taxaInstalacao),

    ValorManutencao: String(opts.valorManutencao),

  };

  if (opts.pontaLabel) {
    entry.Ponta = opts.pontaLabel;
  }

  if (opts.product2Id) {

    entry.Product2Id = opts.product2Id;

  }

  return { key: cpeKey, entry };

}



function attachCpeToFcIpConnectChild(fcIpConnectChild, quoteLineItemId, options = {}) {

  if (!fcIpConnectChild || !quoteLineItemId) return fcIpConnectChild;

  const { key, entry } = buildCpeChildEntry(quoteLineItemId, options);

  fcIpConnectChild[key] = entry;

  return fcIpConnectChild;

}



/** Parent QLI + CPE child — trace cpe2.har entry 87 (advance ANTES da viabilidade). */

function buildProductsValidationCpeAdvanceBody(

  quoteId,

  quoteLineItemId,

  valorMensal,

  valorInstalacao,

  cpeOptions = null,

) {

  const mensal = String(valorMensal ?? '');

  const instalacao = String(valorInstalacao ?? '');

  const FCIPConnectChild = {

    [quoteLineItemId]: {

      Id: quoteLineItemId,

      ATT_ACESSO: 'Ponto a ponto',

      ATT_BGP: 'false',

      ATT_IPs_Quantity: '/29 - 8 IPS',

      ATT_PROTECAO: '1+0',

      ATT_TIPOINTERFACE: '1G BASE-T',

      Distancia: '-1',

      Linha: 'VERMELHA',

      Mensalidade: mensal,

      MensalidadeLPU: mensal,

      ModalidadeTaxa: 'CobrancaTotal',

      PrazoInstalacao: 'Até 10 dias',

      Roteador: 'Não se Aplica',

      TaxaInstalacao: instalacao,

      TaxaInstalacaoLPU: instalacao === '' ? 'null' : instalacao,

      TipoInterface: '1G BASE-T',

      productCode: 'CONNECTIVITY_IP_CONNECT',

      tipoProtecao: '1+0',

      TecnologiaAcesso: 'Ponto a ponto',

      tempoReparo: '6',

      TipoEnderecamento: 'IPV4',

    },

  };

  attachCpeToFcIpConnectChild(FCIPConnectChild, quoteLineItemId, cpeOptions || resolveCpeOptionsFromEnv());

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

/** Parent VPN QLI + CPE child — advance ANTES da viabilidade (1 CPE no primeiro QLI). */
function buildProductsValidationCpeAdvanceBodyVpn(
  quoteId,
  quoteLineItemId,
  valorMensal,
  valorInstalacao,
  productCodeResolved,
  cpeOptions = null,
) {
  const mensal = String(valorMensal ?? '');
  const instalacao = String(valorInstalacao ?? '');
  const FCVpnMplsChild = {
    [quoteLineItemId]: {
      Id: quoteLineItemId,
      productCode: productCodeResolved || 'CONNECTIVITY_VPN_MPLS',
      Mensalidade: mensal,
      MensalidadeLPU: mensal,
      TaxaInstalacao: instalacao,
      TaxaInstalacaoLPU: instalacao,
      PrazoInstalacao: 'Até 30 dias',
    },
  };
  attachCpeToFcIpConnectChild(FCVpnMplsChild, quoteLineItemId, cpeOptions || resolveCpeOptionsFromEnv());
  return {
    quoteId,
    function: 'advance',
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress: '',
    FCIPConnectChild: '',
    FCVpnMplsChild,
    CustomLWC1: '',
  };
}

/** Parent ponta LD + CPE child — advance ANTES da viabilidade (1 CPE em Ponta A ou B). */
function buildProductsValidationCpeAdvanceBodyLd(
  quoteId,
  quoteLineItemId,
  valorMensal,
  valorInstalacao,
  productCodeResolved,
  cpeOptions = null,
) {
  const mensal = String(valorMensal ?? '');
  const instalacao = String(valorInstalacao ?? '');
  const FC_LDQuoteInstallationAddress = {
    [quoteLineItemId]: {
      Id: quoteLineItemId,
      productCode: productCodeResolved || 'CONNECTIVITY_DEDICATED_LINK_POINT',
      Roteador: 'Não se Aplica',
      TecnologiaAcesso: 'Ponto a ponto',
      TipoInterface: 'Fast Ethernet',
      ModalidadeTaxa: 'CobrancaTotal',
      Mensalidade: mensal,
      MensalidadeLPU: mensal,
      TaxaInstalacao: instalacao,
      TaxaInstalacaoLPU: instalacao,
    },
  };
  attachCpeToFcIpConnectChild(FC_LDQuoteInstallationAddress, quoteLineItemId, {
    ...(cpeOptions || resolveCpeOptionsFromEnv()),
    pontaLabel: (cpeOptions && cpeOptions.pontaLabel) || undefined,
  });
  return {
    quoteId,
    function: 'advance',
    IncludeAntiDDOSAndIpAdcional: '',
    FC_LDQuoteInstallationAddress,
    FCVpnMplsChild: '',
    FCIPConnectChild: '',
    CustomLWC1: '',
  };
}

/** Advance pós-viabilidade — trace cpe2.har entry 638 (sem CPE no payload). */

function buildProductsValidationViabilityAdvanceBody(

  quoteId,

  quoteLineItemId,

  qliFields = {},

  valorMensal,

  valorInstalacao,

) {

  const mensal = String(valorMensal ?? qliFields.Mensalidade ?? '');

  const instalacao = String(valorInstalacao ?? qliFields.TaxaInstalacao ?? '');

  return {

    quoteId,

    function: 'advance',

    IncludeAntiDDOSAndIpAdcional: '',

    FC_LDQuoteInstallationAddress: '',

    FCVpnMplsChild: '',

    FCIPConnectChild: {

      [quoteLineItemId]: {

        Id: quoteLineItemId,

        VtalCap_Id_QuerySOV__c: qliFields.VtalCap_Id_QuerySOV__c ?? '',

        VtalCap_Speed_P2P__c: qliFields.VtalCap_Speed_P2P__c ?? '200',

        Vtal_SF_Viability__c: qliFields.Vtal_SF_Viability__c ?? 'Viável P2P',

        Vtal_Seg_LineDistance__c: qliFields.Vtal_Seg_LineDistance__c ?? '50',

        Vtal_Seg_Line__c: qliFields.Vtal_Seg_Line__c ?? 'VERDE',

        ATT_ACESSO: 'Ponto a ponto',

        ATT_BGP: 'false',

        ATT_IPs_Quantity: '/29 - 8 IPS',

        ATT_PROTECAO: '1+0',

        ATT_TIPOINTERFACE: '1G BASE-T',

        Distancia: '-1',

        Linha: 'VERMELHA',

        Mensalidade: mensal,

        MensalidadeLPU: mensal,

        ModalidadeTaxa: 'CobrancaTotal',

        PrazoInstalacao: 'Até 10 dias',

        Roteador: 'Não se Aplica',

        TaxaInstalacao: instalacao,

        TaxaInstalacaoLPU: instalacao === '' ? 'null' : instalacao,

        TipoInterface: '1G BASE-T',

        productCode: 'CONNECTIVITY_IP_CONNECT',

        tipoProtecao: '1+0',

        TipoEnderecamento: 'IPV4',

      },

    },

    CustomLWC1: '',

  };

}



async function fetchQuoteLineItemViabilityFields(apiCall, quoteLineItemId, queryUrl) {

  const soql = [

    'SELECT Id, VtalCap_Id_QuerySOV__c, VtalCap_Speed_P2P__c, Vtal_SF_Viability__c,',

    'Vtal_Seg_LineDistance__c, Vtal_Seg_Line__c',

    'FROM QuoteLineItem',

    `WHERE Id='${quoteLineItemId}'`,

    'LIMIT 1',

  ].join(' ');

  const res = await apiCall('GET', `${queryUrl}?q=${encodeURIComponent(soql)}`);

  if (res.status !== 200) return {};

  return res.data?.records?.[0] || {};

}



/** Consulta preços do CPE por porte (opcional; fallback nos defaults do HAR). */

async function fetchCpePriceFromIp(apiCall, porte = 'P', product2Id = null) {

  try {

    const body = { Porte: porte };

    const pid = product2Id || resolveCpeProduct2Id();

    if (pid) body.Product2Id = pid;

    const res = await apiCall('POST', IP_GET_PRICE_CPE, body);

    if (res.status !== 200 && res.status !== 201) return null;

    const raw = res.data?.result ?? res.data;

    const fee = Array.isArray(raw) ? raw[0] : raw;

    if (!fee || typeof fee !== 'object') return null;

    const out = {};

    const m = fee.Mensalidade ?? fee.RecurringCharge ?? fee.valorMensal;

    const t = fee.TaxaInstalacao ?? fee.OneTimeCharge ?? fee.valorInstalacao;

    const v = fee.ValorManutencao ?? fee.valorManutencao;

    const d = fee.DownloadSpeed ?? fee.downloadSpeed;

    if (m != null && m !== '') out.mensalidade = String(m);

    if (t != null && t !== '') out.taxaInstalacao = String(t);

    if (v != null && v !== '') out.valorManutencao = String(v);

    if (d != null && d !== '') out.downloadSpeed = String(d);

    return Object.keys(out).length ? out : null;

  } catch {

    return null;

  }

}



module.exports = {

  VLOCITY_NULL,

  DEFAULT_CPE,

  CPE_PRODUCT2_ID_TI,

  CPE_PRODUCT2_ID_TRG,

  IP_GET_PRICE_CPE,

  isIpConnectCpeEnabled,

  resolveCpeProduct2Id,

  resolveCpeOptionsFromEnv,

  buildCpeChildEntry,

  attachCpeToFcIpConnectChild,

  buildProductsValidationCpeAdvanceBody,

  buildProductsValidationCpeAdvanceBodyVpn,

  buildProductsValidationCpeAdvanceBodyLd,

  buildProductsValidationViabilityAdvanceBody,

  fetchQuoteLineItemViabilityFields,

  fetchCpePriceFromIp,

};


