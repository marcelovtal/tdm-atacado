const { resolveCredentials, saveCachedSession } = require('./ofsUiLogin.js');
const { OfsLoginPage } = require('./ofsLoginPage.js');

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (_) {
    throw new Error(
      'Playwright não encontrado. Rode npm install na raiz do fdl-vtal e, se necessário, npx playwright install chromium.',
    );
  }
}

/**
 * Login supervisor OFS via Playwright — captura cookie + CSRF + trust da rede AJAX.
 */
async function loginOfsUiSessionViaPlaywright(options = {}) {
  const { baseUrl, username, password, user } = resolveCredentials(options);
  const { chromium } = resolvePlaywright();

  process.env.OFS_BASE_URL = baseUrl;
  process.env.OFS_USERNAME = username;
  process.env.OFS_PASSWORD = password;

  const captured = { csrf: null, trust: null };
  const browser = await chromium.launch({ headless: options.headless ?? process.env.HEADLESS !== '0' });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('sync') && !url.includes('manage')) return;
    const csrf = req.headers()['x-ofs-csrf-secure'];
    if (csrf) captured.csrf = csrf;
    const body = req.postData() || '';
    const m = body.match(/name="trust"\r\n\r\n(\$fast\$sha256\$[^\r\n]+)/);
    if (m) captured.trust = m[1];
  });

  const ofs = new OfsLoginPage(page, { baseUrl, username, password });
  console.log(`[OFS-UI] Playwright login | ${baseUrl} | ${username}`);
  await ofs.goto();
  await ofs.login();
  await ofs.aguardarTelaPrincipal();

  for (let i = 0; i < 45 && (!captured.csrf || !captured.trust); i += 1) {
    await page.waitForTimeout(2_000);
  }

  const cookies = await context.cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  await browser.close();

  if (!cookie.includes('token=')) throw new Error('OFS UI Playwright: token ausente.');
  if (!captured.csrf || !captured.trust) {
    throw new Error('OFS UI Playwright: CSRF/trust não capturados na rede.');
  }

  const session = {
    base_url: baseUrl,
    cookie,
    csrf: captured.csrf,
    trust: captured.trust,
    user,
    saved_at: new Date().toISOString(),
    source: 'playwright',
  };

  if (options.saveCache !== false) {
    saveCachedSession(session, options.envName);
  }

  console.log('[OFS-UI] Playwright login OK');
  return session;
}

module.exports = { loginOfsUiSessionViaPlaywright };
