/**
 * Payload para criação de Quote (sobjects/Quote).
 * Vinculada à Opportunity; usada no fluxo orçamento/cotação.
 * RecordTypeId e Pricebook2Id (ti): 012Hs000000l6VjIAI, 01sHs000001nMM3IAM.
 */
const DEFAULT_QUOTE_RECORD_TYPE_ID = process.env.QUOTE_RECORD_TYPE_ID || '012Hs000000l6VjIAI';
const DEFAULT_QUOTE_PRICEBOOK2_ID = process.env.QUOTE_PRICEBOOK2_ID || '01sHs000001nMM3IAM';

function buildQuotePayload(opportunityId, options = {}) {
  const name = options.name || `Cotação - Oportunidade ${opportunityId}`;
  const payload = {
    Name: name,
    OpportunityId: opportunityId,
    RecordTypeId: options.recordTypeId || DEFAULT_QUOTE_RECORD_TYPE_ID,
    Pricebook2Id: options.pricebook2Id || DEFAULT_QUOTE_PRICEBOOK2_ID,
    Vtal_TipoDeCotacao__c: options.vtalTipoDeCotacao ?? 'Simples',
    vtal_SF_PrazoContratacao__c: options.vtalPrazoContratacao ?? 12,
    Status: options.status || 'Draft',
  };
  return payload;
}

module.exports = { buildQuotePayload };
