function formatMassAccountEnvErrorMessage(label, accountId, environment) {
  const envUpper = String(environment || 'ti').toUpperCase();
  const idPart = accountId ? ` (${accountId})` : '';
  return `[FDL_USER_ERROR] A conta ${label}${idPart} não existe no ambiente ${envUpper}. Use Organization, Business e Billing deste ambiente — IDs de TRG não funcionam em TI (e vice-versa).`;
}

function isAccountMissingOrInaccessible(getResponse) {
  if (!getResponse || getResponse.status === 200) return false;
  if (getResponse.status === 404) return true;
  const bodyStr = JSON.stringify(getResponse.data || getResponse.text || '');
  return /NOT_FOUND|INSUFFICIENT_ACCESS|INVALID_CROSS_REFERENCE/i.test(bodyStr);
}

/**
 * Valida Organization / Business / Billing antes do fluxo massa pronta.
 * Falha com [FDL_USER_ERROR] quando a conta não existe no ambiente selecionado.
 */
async function assertMassaProntaAccountsExist(apiCall, accountIds, options = {}) {
  const sobjectsAccount = options.sobjectsAccountPath || '/services/data/v62.0/sobjects/Account';
  const environment = options.environment || process.env.ENVIRONMENT || 'ti';
  const onError =
    options.onError ||
    ((msg) => {
      console.error(msg);
      process.exit(1);
    });

  const checks = [
    ['Organization', accountIds?.accountOrganizationId],
    ['Business', accountIds?.accountBussinessId],
    ['Billing', accountIds?.accountBillingId],
  ];

  for (const [label, id] of checks) {
    const accountId = String(id || '').trim();
    if (!accountId) continue;
    const res = await apiCall('GET', `${sobjectsAccount}/${accountId}`);
    if (isAccountMissingOrInaccessible(res)) {
      onError(formatMassAccountEnvErrorMessage(label, accountId, environment));
      return false;
    }
  }
  return true;
}

module.exports = {
  assertMassaProntaAccountsExist,
  formatMassAccountEnvErrorMessage,
  isAccountMissingOrInaccessible,
};
