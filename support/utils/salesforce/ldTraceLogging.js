/**
 * Trace/logging helpers usados nos fluxos Link Dedicado (gerar-pedido-*-link-dedicado*.js).
 */

function safePreview(value, maxLen = 4000) {
  if (value == null) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return str.length > maxLen ? `${str.slice(0, maxLen)}\n... [truncado ${str.length - maxLen} chars]` : str;
}

function logStepTrace(label, requestBody, response, extra = null) {
  console.log(`[TRACE] ${label} request:`, safePreview(requestBody));
  if (extra != null) {
    console.log(`[TRACE] ${label} extra:`, safePreview(extra));
  }
  console.log(`[TRACE] ${label} status:`, response?.status);
  if (response?.data != null) {
    console.log(`[TRACE] ${label} response(data):`, safePreview(response.data));
  } else {
    console.log(`[TRACE] ${label} response(text):`, safePreview(response?.text ?? ''));
  }
}

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function extractTokenDeep(value) {
  const parsed = tryParseJson(value);
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.Token === 'string' && parsed.Token) return parsed.Token;
  if (typeof parsed.token === 'string' && parsed.token) return parsed.token;
  if (typeof parsed.access_token === 'string' && parsed.access_token) return parsed.access_token;
  if (typeof parsed.accessToken === 'string' && parsed.accessToken) return parsed.accessToken;
  for (const key of Object.keys(parsed)) {
    const nested = parsed[key];
    if (nested && typeof nested === 'object') {
      const token = extractTokenDeep(nested);
      if (token) return token;
    } else if (typeof nested === 'string') {
      const token = extractTokenDeep(nested);
      if (token) return token;
    }
  }
  return null;
}

module.exports = {
  safePreview,
  logStepTrace,
  tryParseJson,
  extractTokenDeep,
};
