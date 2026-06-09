/**
 * Payload para criação de Opportunity (sobjects/Opportunity).
 * Usado no fluxo orçamento/cotação após conversão do Lead.
 * RecordTypeId e StageName podem variar por org; ajuste ou use config.
 */
function buildOpportunityPayload(accountId, options = {}) {
  const name = options.name || `Oportunidade Teste ${Date.now()}`;
  const closeDate = options.closeDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const payload = {
    Name: name,
    AccountId: accountId,
    StageName: options.stageName || 'Análise das necessidades',
    CloseDate: closeDate,
    Type: options.type || 'New opp',
  };
  if (options.recordTypeId) payload.RecordTypeId = options.recordTypeId;
  return payload;
}

module.exports = { buildOpportunityPayload };
