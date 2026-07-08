const { emitPanelSnapshot } = require('./panelSnapshot.js');

/** Anexa IDs de conta do Lead/BRM ao resultado do pedido (stdout → painel FDL). */
function mergeAccountIdsIntoPedidoResult(result = {}, accountIds = {}) {
  if (!accountIds || typeof accountIds !== 'object') return { ...result };
  return {
    ...result,
    accountOrganizationId:
      accountIds.accountOrganizationId ?? result.accountOrganizationId ?? null,
    accountBusinessId:
      accountIds.accountBussinessId ??
      accountIds.accountBusinessId ??
      result.accountBusinessId ??
      null,
    accountBillingId: accountIds.accountBillingId ?? result.accountBillingId ?? null,
    contactTecnicoId: accountIds.contactTecnicoId ?? result.contactTecnicoId ?? null,
  };
}

/** Log parseável + snapshot parcial para o painel (contas após BRM ou massa pronta). */
function logAccountsForPanel(accountIds = {}, logPrefix = '[E2E]') {
  const merged = mergeAccountIdsIntoPedidoResult({}, accountIds);
  if (merged.accountOrganizationId) {
    console.log(`${logPrefix} AccountOrganizationId:`, merged.accountOrganizationId);
  }
  if (merged.accountBusinessId) {
    console.log(`${logPrefix} AccountBusinessId:`, merged.accountBusinessId);
  }
  if (merged.accountBillingId) {
    console.log(`${logPrefix} AccountBillingId:`, merged.accountBillingId);
  }
  if (merged.contactTecnicoId) {
    console.log(`${logPrefix} ContactTecnicoId:`, merged.contactTecnicoId);
  }
  emitPanelSnapshot(merged);
  return merged;
}

function buildPollPartialSnapshot(orderFields = {}, accountIds = {}) {
  return mergeAccountIdsIntoPedidoResult(orderFields, accountIds);
}

module.exports = {
  mergeAccountIdsIntoPedidoResult,
  logAccountsForPanel,
  buildPollPartialSnapshot,
};
