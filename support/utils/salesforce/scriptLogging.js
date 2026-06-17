/** Logging e erros padronizados dos scripts E2E (stdout → painel FDL). */

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
  const payload = data != null ? JSON.stringify(data, null, 2) : text || '';
  const maxLen = 4000;
  const out =
    payload.length > maxLen
      ? `${payload.slice(0, maxLen)}\n... [truncado ${payload.length - maxLen} chars]`
      : payload;
  if (out) console.log(`[RESPONSE] ${label} body:\n${out}`);
}

module.exports = { fail, logCurl, logResponse };
