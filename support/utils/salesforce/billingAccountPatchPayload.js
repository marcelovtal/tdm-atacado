/**
 * Payload para PATCH na conta Billing (Account) após conversão do Lead.
 * AccountNumber e vtal_LXD_UF_OfClient__c vêm da conta Business (consultada previamente).
 *
 * vtal_LXD_FantasyName__c: alinhar ao mesmo “nome fantasia” da Organization (LD); se null, o
 * CreateOrderOnQuote / decomposição de pedido pode falhar.
 *
 * Em TRG: status de faturamento e cliente precisam Active para o fluxo seguir.
 */
function buildBillingAccountPatchPayload({ accountNumber, ufOfClient, environment = 'ti', fantasyName = '' }) {
  const env = String(environment || 'ti').toLowerCase();
  const isTrg = env === 'trg';

  const base = {
    AccountNumber: accountNumber || '',
    vtal_LXD_UF_OfClient__c: ufOfClient || '',
  };
  const fn = fantasyName && String(fantasyName).trim();
  if (fn) {
    base.vtal_LXD_FantasyName__c = fn;
  }

  if (!isTrg) {
    return base;
  }

  return {
    ...base,
    vlocity_cmt__BillingAccountStatus__c: 'Active',
    vtal_LXD_ClientStatus__c: 'Active',
  };
}

module.exports = { buildBillingAccountPatchPayload };
