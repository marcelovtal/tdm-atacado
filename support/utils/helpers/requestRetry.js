/**
 * Wrapper do request que aplica retry automático em falhas de rede ou HTTP 5xx.
 * Usado na base (bddTest) para que todo teste que chama APIs tenha retry sem alterar os steps.
 */
const { delay } = require('./waitHelper.js');

const DEFAULT_OPTIONS = {
  maxRetries: 2,        // 2 retries = até 3 tentativas no total
  retryDelayMs: 1000,
  /** Status HTTP que disparam retry (ex.: 502, 503, 504). Apenas 5xx; 4xx não retenta (erro do cliente). */
  retryableStatus: (status) => status >= 500 && status < 600,
};

function wrapRequestWithRetry(request, options = {}) {
  const { maxRetries, retryDelayMs, retryableStatus } = { ...DEFAULT_OPTIONS, ...options };

  const wrap = (method) => {
    return async (urlOrOptions, optionsOrUndefined) => {
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await request[method](urlOrOptions, optionsOrUndefined);
          const status = typeof response.status === 'function' ? response.status() : response.status;
          if (attempt < maxRetries && retryableStatus(status)) {
            await delay(retryDelayMs);
            continue;
          }
          return response;
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            await delay(retryDelayMs);
            continue;
          }
          throw lastError;
        }
      }
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

module.exports = { wrapRequestWithRetry };
