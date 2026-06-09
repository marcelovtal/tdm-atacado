/**
 * Wrapper da page do Playwright: log automático de todas as ações + screenshot após cada ação.
 * Segue o mesmo padrão do RequestWithLog: intercepta goto, reload, fill, click, etc.,
 * registra no Logger e delega para a page/locator original. Assim os testes não precisam
 * chamar log.step manualmente. Se testInfo for null, retorna a page sem wrapper.
 */

const { Logger } = require('./Logger.js');

const ACTION_METHODS_PAGE = ['goto', 'reload'];
const ACTION_METHODS_LOCATOR = ['fill', 'type', 'press', 'click', 'dblclick', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'hover', 'tap'];

function detailForLocatorAction(method, args) {
  if (method === 'fill' || method === 'type') return args[0] != null ? String(args[0]).slice(0, 200) : '';
  if (method === 'selectOption') return args[0] != null ? String(args[0]).slice(0, 200) : '';
  if (method === 'setInputFiles') return Array.isArray(args[0]) ? args[0].join(', ') : (args[0] || '');
  if (method === 'press') return args[0] || '';
  return '';
}

function wrapLocator(innerLocator, rawPage, testInfo, log) {
  const wrap = (method) => {
    return async (...args) => {
      const detail = detailForLocatorAction(method, args);
      log.step(method, detail);
      const result = await innerLocator[method].apply(innerLocator, args);
      await captureScreenshot(rawPage, testInfo, `locator.${method}`);
      return result;
    };
  };

  const proxy = new Proxy(innerLocator, {
    get(target, prop) {
      if (ACTION_METHODS_LOCATOR.includes(prop) && typeof target[prop] === 'function') {
        return wrap(prop);
      }
      const value = target[prop];
      if (prop === 'locator' && typeof value === 'function') {
        return (selector) => wrapLocator(innerLocator.locator(selector), rawPage, testInfo, log);
      }
      if (prop === 'first' || prop === 'last' || prop === 'nth') {
        if (typeof value === 'function') {
          return (...a) => wrapLocator(value.apply(target, a), rawPage, testInfo, log);
        }
      }
      return value;
    },
  });

  return proxy;
}

async function captureScreenshot(page, testInfo, actionName) {
  if (!page || !testInfo) return;
  try {
    const buffer = await page.screenshot();
    if (buffer && testInfo.attach) {
      const name = `[auto] ${actionName}`;
      await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
    }
  } catch (_) {
    // ignore screenshot errors (e.g. page closed)
  }
}

/**
 * Cria um proxy da page: log automático (goto, reload, fill, click, etc.) + screenshot após cada ação.
 * logger opcional; se não passado, usa new Logger('Page').
 */
function wrapPageWithReport(page, testInfo, logger = null) {
  if (!testInfo) return page;

  const log = logger || new Logger('Page');

  const wrapPageMethod = (method) => {
    return async (...args) => {
      const detail = method === 'goto' && args[0] != null ? String(args[0]) : (method === 'reload' ? 'reload' : '');
      log.step(method, detail);
      const result = await page[method](...args);
      await captureScreenshot(page, testInfo, method);
      return result;
    };
  };

  return new Proxy(page, {
    get(target, prop) {
      if (prop === 'locator' && typeof target.locator === 'function') {
        return (selector) => wrapLocator(target.locator(selector), target, testInfo, log);
      }
      if (ACTION_METHODS_PAGE.includes(prop) && typeof target[prop] === 'function') {
        return wrapPageMethod(prop);
      }
      return target[prop];
    },
  });
}

module.exports = { wrapPageWithReport, wrapLocator };
