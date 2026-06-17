/**
 * Cliente HTTP + OAuth compartilhado pelos scripts E2E Salesforce.
 * Substitui getToken/api/fail/logCurl duplicados no topo de cada script.
 */
const { loadEnv, getTokenUrl, getUserFixture } = require('../../../config/env.js');
const { fail, logCurl, logResponse } = require('./scriptLogging.js');

function getEnvName() {
  return process.env.ENVIRONMENT || process.env.ENV || 'ti';
}

function isTrgEnv(envName = getEnvName()) {
  return String(envName).trim().toLowerCase() === 'trg';
}

function isTiEnv(envName = getEnvName()) {
  return String(envName).trim().toLowerCase() === 'ti';
}

function getQuoteStatusFlow(envName = getEnvName()) {
  const trg = isTrgEnv(envName);
  return trg
    ? { needsReviewed: true, reviewedStatus: 'Reviewed', finalStatus: 'Approved' }
    : { needsReviewed: false, reviewedStatus: null, finalStatus: 'Approved' };
}

function getSalesforceUser() {
  const user = getUserFixture();
  return user.salesforce || user.dev?.salesforce || user.trg?.salesforce || {};
}

function createSalesforceScriptClient() {
  const env = loadEnv();
  const baseUrl = env?.urls?.salesforce?.replace(/\/$/, '') || '';
  const tokenUrl = getTokenUrl(env) || (baseUrl ? `${baseUrl}/services/oauth2/token` : '');
  const envName = getEnvName();
  const sf = getSalesforceUser();

  async function getToken() {
    const grantType = sf.grant_type || 'client_credentials';
    const authBase = (sf.tokenUrl || tokenUrl).replace(/\?.*$/, '');
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
    const url = useQueryParams ? `${authBase}?${params.toString()}` : authBase;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sf.cookie || '' };
    const reqBody = useQueryParams ? null : params.toString();
    logCurl('POST', url, headers, reqBody);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: useQueryParams ? '' : params.toString(),
    });
    const resText = await res.text();
    let body = null;
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
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    if (body != null && (method === 'POST' || method === 'PATCH')) {
      opts.body = JSON.stringify(body);
    }
    const reqBody = opts.body ?? null;
    logCurl(method, url, opts.headers, reqBody);
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {}
    const label = `${method} ${path}`;
    logResponse(label, res.status, data, text);
    return { status: res.status, data, text };
  }

  function apiCall(instanceUrl, accessToken, cookie = '') {
    return (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);
  }

  function assertCredentials() {
    if (!tokenUrl || !baseUrl) {
      console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
      process.exit(1);
    }
    if (!sf.client_id || !sf.client_secret) {
      console.error('Credenciais em user.json (dev.salesforce / trg.salesforce)');
      process.exit(1);
    }
  }

  return {
    env,
    baseUrl,
    tokenUrl,
    envName,
    IS_TRG: isTrgEnv(envName),
    IS_TI: isTiEnv(envName),
    quoteFlow: getQuoteStatusFlow(envName),
    sf,
    cookie: sf.cookie || '',
    getToken,
    api,
    apiCall,
    fail,
    logCurl,
    logResponse,
    assertCredentials,
  };
}

module.exports = {
  createSalesforceScriptClient,
  getEnvName,
  isTrgEnv,
  isTiEnv,
  getQuoteStatusFlow,
  getSalesforceUser,
};
