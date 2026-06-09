/**
 * Wrapper do request do Playwright que loga automaticamente:
 * - endpoint (method + URL)
 * - payload enviado
 * - response (status + body)
 * - curl completo
 */

const { Logger } = require('./Logger.js');

function buildCurl(method, url, options = {}) {
  const headers = options.headers || {};
  const data = options.data;
  const parts = ['curl', '-X', method.toUpperCase(), `'${url}'`];
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      parts.push('-H', `'${key}: ${value}'`);
    }
  }
  if (data !== undefined && data !== null && data !== '') {
    const escaped = typeof data === 'string' ? data.replace(/'/g, "'\\''") : JSON.stringify(data).replace(/'/g, "'\\''");
    parts.push('-d', `'${escaped}'`);
  }
  return parts.join(' ');
}

function safeStringify(obj, maxLen = 2000) {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    if (maxLen <= 0) return s;
    return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
  } catch (_) {
    return String(obj);
  }
}

// Limite maior para response body (Account/Contact etc. podem ser grandes); payload mantém 2000
const RESPONSE_BODY_MAX_LEN = 0; // 0 = sem limite (response inteiro no log)

function wrapRequestWithLog(request, logger = null) {
  const log = logger || new Logger('Request');

  const wrap = (method) => {
    return async (urlOrOptions, optionsOrUndefined) => {
      const methodUpper = method.toUpperCase();
      let finalUrl;
      let requestOptions = {};
      if (typeof urlOrOptions === 'string') {
        finalUrl = urlOrOptions;
        requestOptions = (optionsOrUndefined && typeof optionsOrUndefined === 'object') ? { ...optionsOrUndefined } : {};
        requestOptions.url = finalUrl;
      } else if (urlOrOptions && typeof urlOrOptions === 'object') {
        requestOptions = { ...urlOrOptions };
        finalUrl = requestOptions.url || urlOrOptions.url;
      } else {
        finalUrl = '';
      }

      log.step('Endpoint', `${methodUpper} ${finalUrl}`);
      if (requestOptions.data !== undefined) {
        log.step('Payload enviado', safeStringify(requestOptions.data));
      }
      if (requestOptions.headers && Object.keys(requestOptions.headers).length) {
        log.step('Headers', safeStringify(requestOptions.headers));
      }

      const curl = buildCurl(methodUpper, finalUrl, requestOptions);
      log.step('cURL', curl);

      const response = await request[method](urlOrOptions, optionsOrUndefined);

      let bodyBuffer;
      let bodyStr = '';
      let bodyJson = null;
      try {
        bodyBuffer = await response.body();
        bodyStr = (bodyBuffer && bodyBuffer.length) ? bodyBuffer.toString('utf-8') : '';
        const contentType = (response.headers() && response.headers()['content-type']) || '';
        if (contentType.includes('json') && bodyStr) {
          try {
            bodyJson = JSON.parse(bodyStr);
          } catch (_) {}
        }
        const bodyPreview = bodyJson !== null
          ? safeStringify(bodyJson, RESPONSE_BODY_MAX_LEN)
          : safeStringify(bodyStr, RESPONSE_BODY_MAX_LEN);
        log.step('Response status', String(response.status()));
        log.step('Response body', bodyPreview);
      } catch (e) {
        log.step('Response status', String(response.status()));
        log.step('Response body', '(não foi possível ler o body)');
      }

      // Wrapper para o caller poder chamar .json()/.text() sem consumir de novo
      const _bodyStr = bodyStr;
      const _bodyJson = bodyJson;
      const _bodyBuffer = bodyBuffer;
      return {
        status: () => response.status(),
        headers: () => response.headers(),
        ok: () => response.ok(),
        url: () => response.url(),
        json: () => Promise.resolve(_bodyJson !== null ? _bodyJson : (_bodyStr ? JSON.parse(_bodyStr) : {})),
        text: () => Promise.resolve(_bodyStr),
        body: () => Promise.resolve(_bodyBuffer || Buffer.alloc(0)),
      };
    };
  };

  const proxy = new Proxy(request, {
    get(target, prop) {
      if (['post', 'get', 'put', 'delete', 'patch'].includes(prop) && typeof target[prop] === 'function') {
        return wrap(prop);
      }
      return target[prop];
    },
  });

  return proxy;
}

module.exports = { wrapRequestWithLog, buildCurl };
