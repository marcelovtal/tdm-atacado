/**
 * Mesmo padrão de gerar-pedido-massa-pronta-ip-connect-config-pega.js (logCurl / logResponse),
 * com prefixo no label para filtrar chamadas PEGA nos logs.
 */

function redactHeadersForCurl(headers = {}) {
  const o = { ...headers };
  if (o.Authorization) {
    o.Authorization = /^Bearer\s/i.test(String(o.Authorization)) ? 'Bearer <redacted>' : 'Basic <redacted>';
  }
  return o;
}

function logPegaCurl(method, url, headers = {}, body = null) {
  const h = Object.entries(redactHeadersForCurl(headers))
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
    .join(' \\\n');
  const bodyPart =
    (method === 'POST' || method === 'PATCH' || method === 'PUT') && body != null
      ? ` \\\n  --data-raw '${String(body).slice(0, 2000).replace(/'/g, "'\\''")}${String(body).length > 2000 ? '...' : ''}'`
      : '';
  console.log(`[CURL] ${method} ${url}`);
  console.log(`curl '${url}' \\\n  -X ${method}${h ? ' \\\n' + h : ''}${bodyPart}`);
}

function logPegaResponse(label, status, data, text) {
  console.log(`[RESPONSE] ${label} status: ${status}`);
  const payload = data != null ? JSON.stringify(data, null, 2) : (text || '');
  const maxLen = 4000;
  const out =
    payload.length > maxLen ? payload.slice(0, maxLen) + '\n... [truncado ' + (payload.length - maxLen) + ' chars]' : payload;
  if (out) console.log(`[RESPONSE] ${label} body:\n${out}`);
}

module.exports = { logPegaCurl, logPegaResponse, redactHeadersForCurl };
