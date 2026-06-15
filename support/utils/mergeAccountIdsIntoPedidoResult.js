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

module.exports = { mergeAccountIdsIntoPedidoResult };
