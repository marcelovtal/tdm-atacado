const { buildOrganizationPatchPayload } = require('./organizationPatchPayload.js');
const { buildBusinessAccountPatchPayload } = require('./businessAccountPatchPayload.js');
const { buildBillingAccountPatchPayload } = require('./billingAccountPatchPayload.js');
const { logAccountsForPanel } = require('../mergeAccountIdsIntoPedidoResult.js');

/**
 * Mesmos PATCH de Organization / Business / Billing que runLeadFlow após conversão.
 * No modo massa pronta isso não rodava — em TRG o OM pode não gerar subpedido sem contas
 * alinhadas (vlocity_cmt__BillingAccountStatus__c, vtal_LXD_ClientStatus__c, etc.).
 */
async function patchMassaProntaAccounts(apiCall, accountIds, options = {}) {
  if (process.env.SKIP_MASSA_ACCOUNT_PATCH === '1') {
    console.log('[E2E] SKIP_MASSA_ACCOUNT_PATCH=1 — pulando PATCH Organization/Business/Billing.');
    logAccountsForPanel(accountIds);
    return;
  }
  const fail = options.fail || ((msg, res) => {
    throw new Error(`${msg}${res?.status ? ` (${res.status})` : ''}`);
  });
  const environment = options.environment || process.env.ENVIRONMENT || 'dev';
  const sobjectsAccount = options.sobjectsAccountPath || '/services/data/v62.0/sobjects/Account';

  const { accountOrganizationId, accountBussinessId, accountBillingId } = accountIds || {};
  if (!accountOrganizationId || !accountBussinessId || !accountBillingId) return;

  console.log('[E2E] Massa pronta: PATCH Organization / Business / Billing (alinhado ao fluxo Lead + TRG)...');
  const orgGet = await apiCall('GET', `${sobjectsAccount}/${accountOrganizationId}`);
  if (orgGet.status !== 200) fail('GET Org (massa pronta)', orgGet);
  const fantasyName = orgGet.data?.vtal_LXD_FantasyName__c || '';
  await apiCall(
    'PATCH',
    `${sobjectsAccount}/${accountOrganizationId}`,
    buildOrganizationPatchPayload(fantasyName, {
      accountName: orgGet.data?.Name || '',
      companyFromLead: '',
    }),
  );

  const businessGet = await apiCall('GET', `${sobjectsAccount}/${accountBussinessId}`);
  if (businessGet.status !== 200) fail('GET Business (massa pronta)', businessGet);
  const businessBody = businessGet.data;
  const accountName = businessBody?.Name || '';
  const email =
    businessBody?.Vtal_SF_Email__c ||
    businessBody?.vlocity_cmt__BillingEmailAddress__c ||
    '';
  const businessPatch = buildBusinessAccountPatchPayload({ accountName, email, environment });
  await apiCall(
    'PATCH',
    `${sobjectsAccount}/${accountBussinessId}`,
    businessPatch,
  );

  const accountNumber = businessBody?.Account_Number__c || '';
  const ufOfClient = businessPatch.vtal_LXD_UF_OfClient__c || businessBody?.vtal_LXD_UF_OfClient__c || 'SP';
  await apiCall(
    'PATCH',
    `${sobjectsAccount}/${accountBillingId}`,
    buildBillingAccountPatchPayload({ accountNumber, ufOfClient, environment }),
  );
  console.log('[E2E] PATCH contas (massa pronta) concluído.');
  logAccountsForPanel(accountIds);
}

module.exports = { patchMassaProntaAccounts };
