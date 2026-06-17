/**
 * Fluxo de ativação de conta até BRM (sem cotação/pedido).
 * Lead → Conversão → Accounts → Contacts → Contract MSA → BRM ativo.
 */
const { createSalesforceScriptClient } = require('../support/utils/salesforce/scriptHttpClient.js');
const { runLeadToBrm } = require('../support/utils/ativacao/runLeadToBrm.js');

const client = createSalesforceScriptClient();
const { getToken, api, cookie, fail, assertCredentials } = client;

async function runLeadUntilBRM(instanceUrl, accessToken, cookieHeader) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookieHeader);
  return runLeadToBrm(apiCall, fail, { logPrefix: '[ATIVACAO]' });
}

async function main() {
  assertCredentials();
  console.log('========== ATIVAÇÃO E2E (Lead → BRM) ==========');
  console.log('Token...');
  try {
    const { accessToken, instanceUrl } = await getToken();
    const result = await runLeadUntilBRM(instanceUrl, accessToken, cookie);
    console.log('\n*** CONTA ATIVADA NO BRM ***');
    console.log('  AccountBillingId:', result.accountBillingId);
    console.log('  AccountBusinessId:', result.accountBussinessId);
    console.log('  AccountOrganizationId:', result.accountOrganizationId);
    console.log('  ContactTecnicoId:', result.contactTecnicoId);
    process.exit(0);
  } catch (err) {
    console.error('\nERRO:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', err.response.data ? JSON.stringify(err.response.data, null, 2) : err.response.text);
    }
    process.exit(1);
  }
}

main();
