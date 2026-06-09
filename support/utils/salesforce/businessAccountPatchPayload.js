/**
 * Payload para PATCH na conta Business (Account) após conversão do Lead.
 * AccountName e Email vêm do Lead; demais campos fixos por ambiente (TI vs TRG).
 *
 * IDs de lookup variam por sandbox — override: VTAL_SF_MUNIC_LPU_ID (e outros se necessário).
 */
const MUNIC_LPU_BY_ENV = {
  /** TI — São Paulo (código 3550308) */
  ti: 'a6UHZ0000000Tgk2AE',
  /** TRG — São Paulo (código 3550308) */
  trg: 'a6UHa00000029CwMAI',
};

function buildBusinessAccountPatchPayload({ accountName, email, environment = 'ti' }) {
  const env = String(environment || 'ti').toLowerCase();
  const isTrg = env === 'trg';
  const cfopLkp = isTrg ? 'a6WHa000001F2CDMA0' : 'a6WHZ000001AkKs2AK';
  const codigoCnae = isTrg ? 'a6SHa000000zkkHMAQ' : 'a6SHZ0000000TU72AM';
  const municLpu =
    process.env.VTAL_SF_MUNIC_LPU_ID ||
    MUNIC_LPU_BY_ENV[isTrg ? 'trg' : 'ti'] ||
    MUNIC_LPU_BY_ENV.ti;

  const displayName = (accountName && String(accountName).trim()) || '';

  /** TRG: status Vlocity + cliente ativo na conta Business. */
  const trgOnlyFields = isTrg
    ? {
        vlocity_cmt__BillingAccountStatus__c: 'Active',
        vtal_LXD_ClientStatus__c: 'Active',
      }
    : {};

  return {
    ...trgOnlyFields,
    vtal_LXD_OrganizationName__c: displayName,
    vtal_LXD_FantasyName__c: displayName,
    Vtal_SF_Email__c: email || '',
    vtal_LXD_MobilePhone__c: '11987654322',
    vtal_LXD_Tipo_Conta__c: 'Matriz',
    Vtal_Seg_Habilitado_para_interconexao__c: false,
    vtal_LXD_CustomerCategory__c: 'BiggersOperators',
    vtal_LXD_CustomerRating__c: 'Wholesale',
    vtal_LXD_CFOPLKP__c: cfopLkp,
    vtal_LXD_Codigo_CNAE__c: codigoCnae,
    vtal_LXD_SubscriberType__c: 'Comercial',
    Vtal_SF_Munic_LPU__c: municLpu,
    vtal_LXD_UF_OfClient__c: 'SP',
    Vtal_LXD_StreetType__c: 'Rua',
    Vtal_SF_Address__c: 'Antonio Fonseca',
    Vtal_LXD_StreetNumber__c: 341,
    Vtal_LXD_Neighborhood__c: 'Vila Maria',
    Vtal_LXD_CEP__c: '02112-010',
    vtal_LXD_TaxpayerOfSimplesNational__c: '1',
    vtal_LXD_Region__c: 'North',
    vtal_LXD_TaxpayerType_ICMS__c: 'ICMSTaxpayer',
    vtal_LXD_StateRegistration__c: 110042490114,
    vtal_LXD_SalesOrganization__c: 'South',
    vtal_LXD_InternationalClient__c: '0',
  };
}

module.exports = { buildBusinessAccountPatchPayload, MUNIC_LPU_BY_ENV };
