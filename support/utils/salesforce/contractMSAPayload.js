/**
 * Payload para criação e ativação do Contrato MSA (sobjects/Contract).
 * AccountId = AccountOrganizationId. Datas = data atual (YYYY-MM-DD).
 */
const RECORD_TYPE_ID = '012U60000006twJIAQ';

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Payload para POST Contract (criar MSA em Draft).
 * @param {string} accountOrganizationId
 * @param {string} [dateStr] - opcional, default hoje em YYYY-MM-DD
 */
function buildContractMSAPayload(accountOrganizationId, dateStr = todayISO()) {
  return {
    AccountId: accountOrganizationId,
    StartDate: dateStr,
    ContractTerm: 36,
    Status: 'Draft',
    RecordTypeId: RECORD_TYPE_ID,
    CustomerSignedDate: dateStr,
    CompanySignedDate: dateStr,
    checkAnexoAntiDDoS__c: true,
    checkAnexoCFTTOffice__c: true,
    checkAnexoIPConnect__c: true,
    checkAnexoLinkDedicado__c: true,
    checkAnexoVPN__c: true,
    indiceReajusteContratual__c: 'IST',
    tipoContratoMSA__c: 'Exploração Industrial',
    CondicoesReajuste__c: '12 meses após a assinatura do Contrato'
  };
}

/**
 * Payload para PATCH Contract (ativar).
 * @param {string} [dateStr] - opcional, default hoje
 */
function buildContractActivatePayload(dateStr = todayISO()) {
  return {
    CustomerSignedDate: dateStr,
    Status: 'Activated',
  };
}

module.exports = { buildContractMSAPayload, buildContractActivatePayload, todayISO };
