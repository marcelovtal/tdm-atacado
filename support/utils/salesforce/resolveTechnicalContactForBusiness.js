const { buildContactPayload } = require('./contactPayload.js');

/**
 * Resolve contato técnico (vlocity_cmt__Type__c = Technical) na Business.
 * Cria um se não existir — necessário para Vtal_Contact__c no Order (TRG).
 */
async function resolveTechnicalContactForBusiness(apiCall, accountBussinessId, options = {}) {
  if (!accountBussinessId || !apiCall) return null;

  const queryUrl = options.queryUrl || '/services/data/v62.0/query';
  const sobjectsContact = options.sobjectsContactPath || '/services/data/v62.0/sobjects/Contact';

  const techQuery = `SELECT Id FROM Contact WHERE AccountId = '${accountBussinessId}' AND IsDeleted = false AND vlocity_cmt__Type__c = 'Technical' ORDER BY CreatedDate DESC LIMIT 1`;
  const techRes = await apiCall('GET', `${queryUrl}?q=${encodeURIComponent(techQuery)}`);
  if (techRes.status === 200 && techRes.data?.records?.length) {
    return techRes.data.records[0].Id;
  }

  console.log('[E2E] Contato técnico ausente na Business — criando (vlocity_cmt__Type__c=Technical)...');
  const createRes = await apiCall('POST', sobjectsContact, buildContactPayload(accountBussinessId, 'Technical'));
  if (createRes.status === 201 && createRes.data?.id) {
    return createRes.data.id;
  }

  const anyQuery = `SELECT Id FROM Contact WHERE AccountId = '${accountBussinessId}' AND IsDeleted = false ORDER BY CreatedDate DESC LIMIT 1`;
  const anyRes = await apiCall('GET', `${queryUrl}?q=${encodeURIComponent(anyQuery)}`);
  if (anyRes.status === 200 && anyRes.data?.records?.length) {
    return anyRes.data.records[0].Id;
  }
  return null;
}

module.exports = { resolveTechnicalContactForBusiness };
