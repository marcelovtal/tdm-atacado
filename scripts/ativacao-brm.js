/**
 * Fluxo de ativação de conta até BRM (sem cotação/pedido).
 * Lead → Conversão → Accounts → Contacts → Contract MSA → BRM ativo.
 */
const { loadEnv, getTokenUrl, getUserFixture } = require('../config/env.js');
const { runLeadToContactsStep7 } = require('../support/utils/ativacaoBrmRunLeadToContacts.js');
const { buildContractMSAPayload, buildContractActivatePayload } = require('../support/utils/salesforce/contractMSAPayload.js');
const { buildContentVersionMSAPayload } = require('../support/utils/salesforce/contentVersionMSAPayload.js');
const { delay } = require('../support/utils/helpers/waitHelper.js');

const env = loadEnv();
const baseUrl = env?.urls?.salesforce?.replace(/\/$/, '') || '';
const tokenUrl = getTokenUrl(env) || (baseUrl ? `${baseUrl}/services/oauth2/token` : '');

function getUser() {
  const user = getUserFixture();
  return user.salesforce || user.dev?.salesforce || user.trg?.salesforce || {};
}

async function getToken() {
  const sf = getUser();
  const grantType = sf.grant_type || 'client_credentials';
  const baseUrl = (sf.tokenUrl || tokenUrl).replace(/\?.*$/, '');
  const params = new URLSearchParams({
    grant_type: grantType,
    client_id: sf.client_id || '',
    client_secret: sf.client_secret || '',
  });
  if (grantType === 'password') {
    params.set('username', sf.username || '');
    params.set('password', sf.password || '');
  }
  const useQueryParams = grantType === 'password';
  const url = useQueryParams ? `${baseUrl}?${params.toString()}` : baseUrl;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sf.cookie || '' };
  const reqBody = useQueryParams ? '' : params.toString();
  logCurl('POST', url, headers, reqBody || null);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: reqBody,
  });
  const resText = await res.text();
  let body;
  try {
    body = resText ? JSON.parse(resText) : null;
  } catch (_) {
    body = null;
  }
  logResponse('Token', res.status, body, resText);
  if (!res.ok) throw new Error(`Token ${res.status}: ${resText}`);
  return { accessToken: body.access_token, instanceUrl: body.instance_url };
}

async function api(instanceUrl, accessToken, method, path, body = null, cookie = '') {
  const url = path.startsWith('http') ? path : `${instanceUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const reqBody = body != null && (method === 'POST' || method === 'PATCH') ? JSON.stringify(body) : null;
  const label = `${method} ${path}`;
  logCurl(method, url, headers, reqBody);
  const res = await fetch(url, {
    method,
    headers,
    body: reqBody,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  logResponse(label, res.status, data, text);
  return { status: res.status, data, text };
}

const SOBJECTS_CONTRACT = '/services/data/v62.0/sobjects/Contract';
const SOBJECTS_CONTENT_VERSION = '/services/data/v62.0/sobjects/ContentVersion';
const SOBJECTS_CONTENT_DOCUMENT_LINK = '/services/data/v62.0/sobjects/ContentDocumentLink';
const SOBJECTS_ACCOUNT = '/services/data/v62.0/sobjects/Account';
const QUERY_URL = '/services/data/v62.0/query';
const TOOLING_EXECUTE_ANONYMOUS = '/services/data/v62.0/tooling/executeAnonymous';

const BRM_POLL_TIMEOUT_MS = 60000;
const BRM_POLL_INTERVAL_MS = 2000;

function fail(msg, res) {
  const err = new Error(msg);
  err.response = res;
  throw err;
}

function logCurl(method, url, headers = {}, body = null) {
  const h = Object.entries(headers)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
    .join(' \\\n');
  const bodyPart =
    (method === 'POST' || method === 'PATCH') && body != null
      ? ` \\\n  --data-raw '${String(body).slice(0, 2000).replace(/'/g, "'\\''")}${String(body).length > 2000 ? '...' : ''}'`
      : '';
  console.log(`[CURL] ${method} ${url}`);
  console.log(`curl '${url}' \\\n  -X ${method}${h ? ' \\\n' + h : ''}${bodyPart}`);
}

function logResponse(label, status, data, text) {
  console.log(`[RESPONSE] ${label} status: ${status}`);
  const payload = data != null ? JSON.stringify(data, null, 2) : (text || '');
  const maxLen = 4000;
  const out = payload.length > maxLen ? payload.slice(0, maxLen) + '\n... [truncado ' + (payload.length - maxLen) + ' chars]' : payload;
  if (out) console.log(`[RESPONSE] ${label} body:\n${out}`);
}

async function runLeadUntilBRM(instanceUrl, accessToken, cookie) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);

  const { out, contactTecnicoId, envName } = await runLeadToContactsStep7(apiCall, fail);
  const isTrg = String(envName || '').trim().toLowerCase() === 'trg';

  console.log('[ATIVACAO] 8. Contract MSA + ContentVersion + Link + Activate...');
  const contractRes = await apiCall('POST', SOBJECTS_CONTRACT, buildContractMSAPayload(out.AccountOrganizationId));
  if (contractRes.status !== 201) fail('Contract', contractRes);
  const contractId = contractRes.data?.id;
  if (!contractId) fail('Contract sem id', contractRes);

  const cvRes = await apiCall('POST', SOBJECTS_CONTENT_VERSION, buildContentVersionMSAPayload());
  if (cvRes.status !== 201) fail('ContentVersion', cvRes);
  const contentVersionId = cvRes.data?.id;
  if (!contentVersionId) fail('ContentVersion sem id', cvRes);

  const qDoc = `SELECT ContentDocumentId FROM ContentVersion WHERE Id='${contentVersionId}'`;
  const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qDoc)}`);
  if (qRes.status !== 200 || !qRes.data?.records?.[0]?.ContentDocumentId) fail('Query ContentDocumentId', qRes);
  const contentDocumentId = qRes.data.records[0].ContentDocumentId;

  await apiCall('POST', SOBJECTS_CONTENT_DOCUMENT_LINK, {
    ContentDocumentId: contentDocumentId,
    LinkedEntityId: contractId,
    ShareType: 'V',
  });

  await apiCall('PATCH', `${SOBJECTS_CONTRACT}/${contractId}`, buildContractActivatePayload());

  console.log('[ATIVACAO] 9. getAccount (executeAnonymous) + poll BRM...');
  const accountBillingId = out.AccountBillingId;
  if (isTrg) {
    console.log('[ATIVACAO] TRG: BRM activation/poll desativado. Pulando executeAnonymous/poll para AccountBillingId:', accountBillingId);
  } else {
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
    if (!billingBody?.vtal_LXD_BRMId__c) fail('BRM não preenchido no timeout', { status: 0, data: billingBody });

    console.log('[ATIVACAO] Aguardando 45s para conta Billing/Business ficar ativa no BRM...');
    await delay(45000);

    console.log('[ATIVACAO] Lead + BRM OK. AccountBillingId:', accountBillingId);
  }
  return {
    accountBillingId,
    accountBussinessId: out.AccountBussinessId,
    accountOrganizationId: out.AccountOrganizationId,
    contactTecnicoId,
  };
}

async function main() {
  if (!tokenUrl || !baseUrl) {
    console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
    process.exit(1);
  }
  const sf = getUser();
  if (!sf.client_id || !sf.client_secret) {
    console.error('Credenciais em user.json (dev.salesforce)');
    process.exit(1);
  }

  console.log('========== ATIVAÇÃO E2E (Lead → BRM) ==========');
  console.log('Token...');
  try {
    const { accessToken, instanceUrl } = await getToken();
    const cookie = sf.cookie || '';
    const result = await runLeadUntilBRM(instanceUrl, accessToken, cookie);
    console.log('\n*** CONTA ATIVADA NO BRM ***');
    console.log('  AccountBillingId:', result.accountBillingId);
    console.log('  AccountBusinessId:', result.accountBussinessId);
    console.log('  AccountOrganizationId:', result.accountOrganizationId);
    console.log('  ContactTecnicoId:', result.contactTecnicoId);
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

