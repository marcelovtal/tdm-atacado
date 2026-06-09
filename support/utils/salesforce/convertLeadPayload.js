/**
 * Monta o payload para a API de conversão de Lead (etapa 4).
 * Extrai os dados do response da criação/atualização do Lead (ui-api/records).
 */
function getFieldValue(response, fieldName) {
  const field = response.fields?.[fieldName];
  if (!field) return null;
  return field.value ?? null;
}

/**
 * Extrai do response do Lead (ui-api/records) os dados necessários para o payload de conversão.
 * @param {Object} leadResponseBody - JSON do response do POST ou PATCH do Lead
 * @param {Object} options - { environment?: 'ti'|'trg', fantasyName?: string }
 * @returns {Object} Payload para POST Vtal_LXD_CreateAccountsAndContactCon
 */
function buildConvertLeadPayload(leadResponseBody, options = {}) {
  const { environment = 'ti', fantasyName } = options;
  const leadId = leadResponseBody.id || null;
  const company = getFieldValue(leadResponseBody, 'Company') ?? null;
  const firstName = getFieldValue(leadResponseBody, 'FirstName') ?? '';
  const lastName = getFieldValue(leadResponseBody, 'LastName') ?? '';
  const contactName = `${firstName} ${lastName}`.trim() || null;

  const isTrg = environment === 'trg';
  const ownerId = isTrg ? '005Ha000008dxIAIAY' : (getFieldValue(leadResponseBody, 'OwnerId') ?? (leadResponseBody.fields?.Owner?.value?.id) ?? '');
  const ownerName = isTrg ? 'API USER Automação Testes' : ((leadResponseBody.fields?.Owner?.value?.fields?.Name?.value) ?? (leadResponseBody.fields?.Owner?.displayValue) ?? '');

  const vtalFantasyName = fantasyName ?? company ?? `e2e${Date.now()}`;

  if (!leadId) {
    throw new Error('LeadId não encontrado no response do Lead');
  }

  return {
    SelectOpportunity: false,
    OwnerName: ownerName || '',
    OwnerId: ownerId || '',
    OpportunityName: '',
    LeadId: leadId,
    ContactName: contactName || '',
    AccountName: company || '',
    vtal_LXD_LeadSegment__c: 'BiggersOperators',
    vtal_LXD_FantasyName__c: vtalFantasyName,
  };
}

module.exports = { buildConvertLeadPayload, getFieldValue };
