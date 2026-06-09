/**
 * OAuth2 client_credentials com autenticação do cliente em Basic Auth (Postman: "Send as Basic Auth header").
 * POST application/x-www-form-urlencoded com grant_type=client_credentials.
 */

const { logPegaCurl, logPegaResponse } = require('./pegaLogging.js');

async function getPegaAccessToken({ tokenUrl, clientId, clientSecret, fetchImpl = global.fetch }) {
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error('getPegaAccessToken: tokenUrl, clientId e clientSecret são obrigatórios');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não disponível — use Node 18+');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const reqBody = new URLSearchParams({ grant_type: 'client_credentials' }).toString();
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  logPegaCurl('POST', tokenUrl, headers, reqBody);
  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers,
    body: reqBody,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  const safeData = data && { ...data };
  if (safeData?.access_token) safeData.access_token = '<redacted>';
  logPegaResponse('PEGA POST OAuth2 token', res.status, safeData, null);
  if (!res.ok) {
    throw new Error(`PEGA token HTTP ${res.status}: ${text?.slice(0, 500) || '(vazio)'}`);
  }
  const access = data?.access_token;
  if (!access || typeof access !== 'string') {
    throw new Error(`PEGA token: resposta sem access_token. Corpo: ${text?.slice(0, 300) || '(vazio)'}`);
  }
  return access.trim();
}

module.exports = { getPegaAccessToken };
