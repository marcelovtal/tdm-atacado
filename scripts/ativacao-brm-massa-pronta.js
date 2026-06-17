/**
 * Massa já pronta (MSA, contatos, etc. já existem): **só ativa a conta Billing no BRM**.
 *
 * Fluxo: `Vtal_SF_IntegrationBillAccController.getAccount(billingId)` (executeAnonymous) → poll em Account até
 * `vtal_LXD_BRMId__c` preenchido. **Não** cria contrato MSA, **não** faz PATCH em contas, **não** usa contato técnico.
 *
 * Uso:
 *   ACCOUNT_BILLING_ID=001... node scripts/ativacao-brm-massa-pronta.js
 *
 * Opcionais: `BRM_POLL_TIMEOUT_MS` (padrão 60000), `BRM_POLL_INTERVAL_MS` (padrão 2000).
 * Em TRG o poll/getAccount fica desligado (comportamento alinhado aos outros scripts).
 *
 * Fluxo com Lead + MSA + BRM: `ativacao-brm.js` ou `ativacao-brm-msa.js`.
 */
const { delay } = require('../support/utils/helpers/waitHelper.js');

const { createSalesforceScriptClient } = require('../support/utils/salesforce/scriptHttpClient.js');
const {
  SOBJECTS_ACCOUNT,
  SOBJECTS_CONTRACT,
  SOBJECTS_CONTENT_VERSION,
  SOBJECTS_CONTENT_DOCUMENT_LINK,
  QUERY_URL,
  TOOLING_EXECUTE_ANONYMOUS,
  IP_GENERIC_INVOKE,
  BRM_POLL_TIMEOUT_MS,
  BRM_POLL_INTERVAL_MS,
} = require('../support/utils/salesforce/sfRestPaths.js');

const {
  baseUrl,
  tokenUrl,
  envName,
  IS_TRG,
  sf,
  cookie: defaultCookie,
  getToken,
  api,
  fail,
} = createSalesforceScriptClient();
function getBillingIdFromEnv() {
  const id = process.env.ACCOUNT_BILLING_ID?.trim();
  return id || null;
}

/**
 * Dispara integração BRM na Billing e aguarda vtal_LXD_BRMId__c.
 * @returns {{ accountBillingId: string, brmId: string|null }}
 */
async function runBillingBrmOnly(instanceUrl, accessToken, cookie, accountBillingId) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);

  console.log('[ATIVACAO] Somente Billing no BRM (massa já pronta — sem MSA/PATCH).');
  console.log('[ATIVACAO] getAccount (executeAnonymous) + poll vtal_LXD_BRMId__c...');

  if (IS_TRG) {
    console.log(
      '[ATIVACAO] TRG: executeAnonymous/poll desativados (como nos outros fluxos). BillingId:',
      accountBillingId,
    );
    return { accountBillingId, brmId: null };
  }

  const apexBody = `try { Map<String,Object> r = Vtal_SF_IntegrationBillAccController.getAccount('${accountBillingId}'); System.debug(JSON.serialize(r)); } catch(Exception e) { System.debug(e.getMessage()); }`;
  const execRes = await apiCall('GET', `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apexBody)}`);
  if (execRes.status !== 200 || !execRes.data?.success) fail('executeAnonymous getAccount', execRes);

  const deadline = Date.now() + BRM_POLL_TIMEOUT_MS;
  let billingBody;
  while (Date.now() < deadline) {
    const billingGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${accountBillingId}`);
    if (billingGet.status !== 200) fail('GET Billing', billingGet);
    billingBody = billingGet.data;
    if (billingBody?.vtal_LXD_BRMId__c) break;
    await delay(BRM_POLL_INTERVAL_MS);
  }
  if (!billingBody?.vtal_LXD_BRMId__c) {
    fail('BRM não preenchido no timeout', { status: 0, data: billingBody });
  }

  const brmId = String(billingBody.vtal_LXD_BRMId__c).trim();
  console.log('[ATIVACAO] Aguardando 45s para estabilizar no BRM...');
  await delay(45000);
  console.log('[ATIVACAO] BRM OK. AccountBillingId:', accountBillingId, '| BRMId:', brmId);

  return { accountBillingId, brmId };
}

async function main() {
  if (!tokenUrl || !baseUrl) {
    console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
    process.exit(1);
  }
  if (!sf.client_id || !sf.client_secret) {
    console.error('Credenciais em user.json (dev.salesforce)');
    process.exit(1);
  }

  const accountBillingId = getBillingIdFromEnv();
  if (!accountBillingId) {
    console.error('[ATIVACAO] Informe ACCOUNT_BILLING_ID (Id da conta Billing).');
    console.error('    Ex.: ACCOUNT_BILLING_ID=001... node scripts/ativacao-brm-massa-pronta.js');
    process.exit(1);
  }

  console.log('========== ATIVAÇÃO BRM — só Billing (massa pronta) ==========');
  console.log('  AccountBillingId:', accountBillingId);
  console.log('Token...');
  try {
    const { accessToken, instanceUrl } = await getToken();
    const cookie = defaultCookie;
    const result = await runBillingBrmOnly(instanceUrl, accessToken, cookie, accountBillingId);
    console.log('\n*** BILLING ATIVADA NO BRM ***');
    console.log('  AccountBillingId:', result.accountBillingId);
    if (result.brmId) console.log('  BRMId:', result.brmId);
    process.exit(0);
  } catch (err) {
    console.error('\nERRO ATIVAÇÃO:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', err.response.data ? JSON.stringify(err.response.data, null, 2) : err.response.text);
    }
    process.exit(1);
  }
}

main();
