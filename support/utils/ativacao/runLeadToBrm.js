/**
 * Lead → Contacts (1–7) → MSA (8) → BRM poll (9).
 * Usado por ativacao-brm.js e pelos gerar-pedido-* (fase de migração).
 */
const { runLeadToContactsStep7 } = require('../ativacaoBrmRunLeadToContacts.js');
const { runMsaContractStep, pollBrmActivation } = require('./runMsaAndBrm.js');
const { logAccountsForPanel } = require('../mergeAccountIdsIntoPedidoResult.js');

/**
 * @param {function} apiCall
 * @param {function} fail
 * @param {{ logPrefix?: string }} [opts] — ex.: '[E2E]' nos gerar-pedido, '[ATIVACAO]' no ativacao-brm
 */
async function runLeadToBrm(apiCall, fail, opts = {}) {
  const logPrefix = opts.logPrefix || '[ATIVACAO]';
  const { out, contactTecnicoId, envName } = await runLeadToContactsStep7(apiCall, fail, { logPrefix });
  await runMsaContractStep(apiCall, fail, out.AccountOrganizationId, { logPrefix, step: 8 });
  await pollBrmActivation(apiCall, fail, out.AccountBillingId, { envName, logPrefix, step: 9 });
  const accountIds = {
    accountBillingId: out.AccountBillingId,
    accountBussinessId: out.AccountBussinessId,
    accountOrganizationId: out.AccountOrganizationId,
    contactTecnicoId,
  };
  logAccountsForPanel(accountIds, logPrefix);
  return accountIds;
}

module.exports = { runLeadToBrm };
