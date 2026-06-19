const fs = require('fs');
const path = require('path');
const { getOfsFixture } = require('./getOfsConfig.js');
const { getEnvName } = require('../../../config/credentials.js');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const ORG_BY_HOST = {
  'ofsvtal1.test.fs.ocs.oraclecloud.com': 'ofsc-4651d6.test',
  'ofsvtal3.test.fs.ocs.oraclecloud.com': 'ofsc-7a9fa8.test',
};

function envTrim(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

function parseSetCookie(headers) {
  const jar = {};
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const list = raw.length ? raw : [headers.get('set-cookie')].filter(Boolean);
  for (const line of list) {
    const chunk = String(line).split(';')[0];
    const eq = chunk.indexOf('=');
    if (eq > 0) jar[chunk.slice(0, eq).trim()] = chunk.slice(eq + 1).trim();
  }
  return jar;
}

function mergeCookies(jar, extra = {}) {
  return { ...jar, ...extra };
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function extractHiddenInputs(html) {
  const out = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  for (const tag of html.match(re) || []) {
    const name = /name=["']([^"']+)["']/i.exec(tag)?.[1];
    const value = /value=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    if (name) out[name] = value;
  }
  return out;
}

function extractFromHtml(html) {
  const hidden = extractHiddenInputs(html);
  const csrf =
    /CSRFSecureToken\s*[:=]\s*["']([^"']+)["']/i.exec(html)?.[1] ||
    /x-ofs-csrf-secure["']\s*:\s*["']([^"']+)["']/i.exec(html)?.[1] ||
    /csrfSecureToken\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  const trust =
    /trust\s*[:=]\s*["'](\$fast\$sha256\$[^"']+)["']/i.exec(html)?.[1] ||
    hidden.trust ||
    hidden.Trust;
  const jwe =
    hidden.OFSC_LP_JWE ||
    /localStorage\.setItem\(\s*['"]OFSC_LP_JWE['"]\s*,\s*['"](eyJ[^'"]+)['"]\s*\)/i.exec(html)?.[1] ||
    /OFSC_LP_JWE["']\s*:\s*["'](eyJ[^"']+)["']/i.exec(html)?.[1] ||
    /name=["']OFSC_LP_JWE["'][^>]*value=["'](eyJ[^"']+)["']/i.exec(html)?.[1];
  const organization =
    hidden.organization ||
    /organization["']\s*:\s*["']([^"']+)["']/i.exec(html)?.[1] ||
    /name=["']organization["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1];
  const authState =
    hidden.AuthState ||
    /AuthState["']\s*:\s*["']([^"']+)["']/i.exec(html)?.[1] ||
    /name=["']AuthState["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1];
  const windowSessionId = hidden.window_session_id || hidden.windowSessionId;
  const authTicket = hidden.auth_ticket || hidden.authTicket;
  const sessionEncryptionKey = hidden.session_encryption_key || hidden.sessionEncryptionKey;
  const loginUrl = hidden.login_url || hidden.loginUrl;
  return {
    hidden,
    csrf,
    trust,
    jwe,
    organization,
    authState,
    windowSessionId,
    authTicket,
    sessionEncryptionKey,
    loginUrl,
  };
}

function resolveCredentials(options = {}) {
  const ofs = getOfsFixture() || {};
  const baseUrl = (options.baseUrl || envTrim('OFS_UI_BASE_URL') || ofs.base_url || '').replace(/\/$/, '');
  const username =
    options.username ||
    envTrim('OFS_UI_USERNAME') ||
    ofs.ui_username ||
    envTrim('OFS_USERNAME') ||
    '';
  const password =
    options.password ||
    envTrim('OFS_UI_PASSWORD') ||
    ofs.ui_password ||
    envTrim('OFS_PASSWORD') ||
    '';
  const user = options.user || envTrim('OFS_UI_USER') || username.toUpperCase();
  if (!baseUrl) throw new Error('OFS UI login: base_url ausente.');
  if (!username || !password) {
    throw new Error('OFS UI login: OFS_USERNAME/OFS_PASSWORD (ou OFS_UI_*) obrigatórios para renovar sessão.');
  }
  return { baseUrl, username, password, user };
}

function sessionCachePath(envName) {
  const name = envName || getEnvName();
  return path.resolve(process.cwd(), `.auth/${name}/ofs-ui-session.json`);
}

function loadCachedSession(envName) {
  const file = sessionCachePath(envName);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data?.cookie || !data?.csrf || !data?.trust) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function saveCachedSession(session, envName) {
  const file = sessionCachePath(envName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
}

async function fetchStep(url, { method = 'GET', cookies = {}, body, headers = {}, redirect = 'manual' } = {}) {
  const res = await fetch(url, {
    method,
    redirect,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(body != null ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(cookieHeader(cookies) ? { Cookie: cookieHeader(cookies) } : {}),
      ...headers,
    },
    body,
  });
  const text = await res.text();
  const setCookies = parseSetCookie(res.headers);
  return { res, text, setCookies };
}

function hasMaxSessionsExceeded(html) {
  return /N[uú]mero m[aá]ximo de sess[oõ]es excedido/i.test(html || '');
}

async function submitLoginPortal(baseUrl, cookies, fields) {
  const body = new URLSearchParams(fields).toString();
  const step = await fetchStep(`${baseUrl}/`, {
    method: 'POST',
    cookies,
    body,
    headers: {
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      'Cache-Control': 'max-age=0',
    },
  });
  return {
    cookies: mergeCookies(cookies, step.setCookies),
    parsed: extractFromHtml(step.text),
    html: step.text,
    res: step.res,
  };
}
async function loadLoginPortalPage(baseUrl, cookies) {
  // Bootstrap: POST vazio dispara login-portal (JWE embutido no JS da resposta).
  const bootstrapBody = new URLSearchParams({
    OFSC_LP_JWE: '',
    OFSC_NATIVE_APP: '0',
    INITIAL_METHOD: 'GET',
  }).toString();

  const step = await fetchStep(`${baseUrl}/`, {
    method: 'POST',
    cookies,
    body: bootstrapBody,
    headers: {
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      'Cache-Control': 'max-age=0',
    },
  });

  return {
    cookies: mergeCookies(cookies, step.setCookies),
    parsed: extractFromHtml(step.text),
    html: step.text,
  };
}

function buildLoginPortalFields({ authState, organization, username, password, jwe, delsession = false }) {
  const fields = {
    'from-login-portal': '1',
    AuthState: authState,
    organization,
    username,
    password,
    sso_username: '',
    OFSC_LP_JWE: jwe,
  };
  if (delsession) fields.delsession = '1';
  return fields;
}

async function loginPortalWithCredentials(baseUrl, cookies, portal, { username, password, organization }) {
  const authState =
    portal.parsed.authState ||
    (cookies.token_state ? `${cookies.token_state}:${baseUrl}/` : '');

  // Etapa username (portal em 2 passos)
  let result = await submitLoginPortal(
    baseUrl,
    cookies,
    buildLoginPortalFields({
      authState,
      organization,
      username,
      password: '',
      jwe: portal.parsed.jwe,
    }),
  );

  const authState2 = result.parsed.authState || authState;
  const jwe2 = result.parsed.jwe || portal.parsed.jwe;

  // Etapa password
  result = await submitLoginPortal(
    baseUrl,
    result.cookies,
    buildLoginPortalFields({
      authState: authState2,
      organization,
      username,
      password,
      jwe: jwe2,
    }),
  );

  if (hasMaxSessionsExceeded(result.html)) {
    console.log('[OFS-UI] login | sessões excedidas — delsession=1');
    const authState3 = result.parsed.authState || authState2;
    const jwe3 = result.parsed.jwe || jwe2;
    result = await submitLoginPortal(
      baseUrl,
      result.cookies,
      buildLoginPortalFields({
        authState: authState3,
        organization,
        username,
        password,
        jwe: jwe3,
        delsession: true,
      }),
    );
  }

  if (hasMaxSessionsExceeded(result.html)) {
    throw new Error('OFS UI login: número máximo de sessões excedido (marque delsession manualmente no browser).');
  }

  // Sucesso: HTML curto com auth_ticket ou redirect
  if (!result.parsed.authTicket && result.html.length < 5000) {
    const ticket =
      /auth_ticket["'\s:=]+([a-f0-9]{32})/i.exec(result.html)?.[1] ||
      /name=["']auth_ticket["'][^>]*value=["']([^"']+)/i.exec(result.html)?.[1];
    const ws =
      /window_session_id["'\s:=]+([a-f0-9]{64})/i.exec(result.html)?.[1] ||
      /name=["']window_session_id["'][^>]*value=["']([^"']+)/i.exec(result.html)?.[1];
    const key =
      /session_encryption_key["'\s:=]+([a-f0-9]{32})/i.exec(result.html)?.[1] ||
      /name=["']session_encryption_key["'][^>]*value=["']([^"']+)/i.exec(result.html)?.[1];
    if (ticket) result.parsed.authTicket = ticket;
    if (ws) result.parsed.windowSessionId = ws;
    if (key) result.parsed.sessionEncryptionKey = key;
  }

  return result;
}

/**
 * Login supervisor OFS (UI dispatcher) via HTTP — renova cookie, CSRF e trust.
 * Fluxo mapeado dos curls DevTools (login-portal → auth_ticket → console).
 */
async function loginOfsUiSession(options = {}) {
  const { baseUrl, username, password, user } = resolveCredentials(options);
  const host = new URL(baseUrl).host;
  const ofs = getOfsFixture() || {};
  const organization =
    options.organization ||
    envTrim('OFS_UI_ORGANIZATION') ||
    ofs.ui_organization ||
    ORG_BY_HOST[host] ||
    'ofsc-7a9fa8.test';

  let cookies = {};
  console.log(`[OFS-UI] login | ${baseUrl} | user=${username}`);

  // 1) Cookie inicial (X_OFS_LP)
  let step = await fetchStep(`${baseUrl}/`, { cookies });
  cookies = mergeCookies(cookies, step.setCookies);

  // 2) Bootstrap login-portal — página com JWE + AuthState
  const portal = await loadLoginPortalPage(baseUrl, cookies);
  cookies = portal.cookies;
  let parsed = portal.parsed;

  if (!portal.parsed.jwe) {
    throw new Error('OFS UI login: OFSC_LP_JWE não encontrado após bootstrap login-portal.');
  }

  const loginResult = await loginPortalWithCredentials(baseUrl, cookies, portal, {
    username,
    password,
    organization,
  });
  cookies = loginResult.cookies;
  parsed = loginResult.parsed;
  step = { res: loginResult.res, text: loginResult.html, setCookies: {} };

  // auth_ticket — pode vir no HTML após credenciais
  if (parsed.authTicket && parsed.windowSessionId && parsed.sessionEncryptionKey) {
    const ticketBody = new URLSearchParams({
      window_session_id: parsed.windowSessionId,
      auth_ticket: parsed.authTicket,
      session_encryption_key: parsed.sessionEncryptionKey,
      login_url: parsed.loginUrl || `${baseUrl}/`,
    }).toString();

    step = await fetchStep(`${baseUrl}/`, {
      method: 'POST',
      cookies,
      body: ticketBody,
      headers: {
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
    });
    cookies = mergeCookies(cookies, step.setCookies);
    parsed = extractFromHtml(step.text);
  }

  // 4) GET console autenticado
  step = await fetchStep(`${baseUrl}/`, {
    cookies,
    headers: { Referer: `${baseUrl}/` },
  });
  cookies = mergeCookies(cookies, step.setCookies);
  parsed = extractFromHtml(step.text);

  let csrf = parsed.csrf || step.res.headers.get('x-ofs-csrf-secure');
  let trust = parsed.trust;

  // 5) manage/get — CSRF costuma vir no header da 1ª chamada AJAX
  if (!csrf || !trust) {
    const manageUrl = `${baseUrl}/index.php?m=manage&a=get`;
    const manageRes = await fetch(manageUrl, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(cookies),
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
        'x-oa': '2',
        'x-platform': '1',
        'x-requested-with': 'XMLHttpRequest',
        ...(csrf ? { 'x-ofs-csrf-secure': csrf } : {}),
      },
      body: 'resourceTreeSelection[groupId]=0&resourceTreeSelection[rootPid]=0&resourceTreeSelection[selectedPid]=0',
    });
    csrf = csrf || manageRes.headers.get('x-ofs-csrf-secure');
    const manageText = await manageRes.text();
    const manageParsed = extractFromHtml(manageText);
    trust = trust || manageParsed.trust;
    try {
      const json = JSON.parse(manageText);
      trust = trust || json?.trust || json?.session?.trust;
      csrf = csrf || json?.csrf || json?.CSRFSecureToken;
    } catch (_) {
      /* ignore */
    }
  }

  // 6) sync inicial — trust costuma aparecer no HTML embutido ou na resposta
  if (!trust) {
    const syncProbe = await fetch(`${baseUrl}/?m=Time&a=get&itype=manage&output=ajax`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(cookies),
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
        'x-oa': '2',
        'x-platform': '1',
        'x-requested-with': 'XMLHttpRequest',
        ...(csrf ? { 'x-ofs-csrf-secure': csrf } : {}),
      },
      body: '',
    });
    csrf = csrf || syncProbe.headers.get('x-ofs-csrf-secure');
    const syncText = await syncProbe.text();
    trust = trust || extractFromHtml(syncText).trust;
    try {
      const json = JSON.parse(syncText);
      trust = trust || json?.trust;
    } catch (_) {
      /* ignore */
    }
  }

  const cookie = cookieHeader(cookies);
  if (!cookie.includes('token=')) {
    throw new Error('OFS UI login: token ausente após login — verifique credenciais.');
  }

  const session = {
    base_url: baseUrl,
    cookie,
    csrf: csrf || null,
    trust: trust || null,
    user,
    saved_at: new Date().toISOString(),
    source: 'http',
  };

  if (!csrf || !trust) {
    console.log('[OFS-UI] login HTTP parcial — cookie OK; CSRF/trust exigem Playwright ou DevTools.');
    return session;
  }

  if (options.saveCache !== false) {
    saveCachedSession(session, options.envName);
  }

  console.log('[OFS-UI] login OK — sessão renovada');
  return session;
}

/**
 * Resolve sessão UI: env vars → cache → login (Playwright ou HTTP + merge cache).
 */
async function ensureOfsUiSession(options = {}) {
  const ofs = getOfsFixture() || {};
  const baseUrl = (options.baseUrl || envTrim('OFS_UI_BASE_URL') || ofs.base_url || '').replace(/\/$/, '');

  const fromEnv = {
    base_url: baseUrl,
    cookie: envTrim('OFS_UI_COOKIE'),
    csrf: envTrim('OFS_UI_CSRF'),
    trust: envTrim('OFS_UI_TRUST'),
    user: envTrim('OFS_UI_USER') || envTrim('OFS_USERNAME') || 'VT422570',
  };

  if (fromEnv.cookie && fromEnv.csrf && fromEnv.trust && fromEnv.base_url) {
    if (options.saveCache !== false) saveCachedSession(fromEnv, options.envName);
    return fromEnv;
  }

  const cached = options.useCache !== false ? loadCachedSession(options.envName) : null;

  if (envTrim('OFS_UI_SKIP_AUTO_LOGIN') === '1') {
    if (cached?.cookie && cached?.csrf && cached?.trust) return { ...cached, base_url: cached.base_url || baseUrl };
    throw new Error(
      'OFS UI: sessão ausente (OFS_UI_COOKIE/CSRF/TRUST) e auto-login desabilitado (OFS_UI_SKIP_AUTO_LOGIN=1).',
    );
  }

  // HTTP: renova cookie; reutiliza CSRF/trust do cache se existirem
  const httpSession = await loginOfsUiSession({ ...options, saveCache: false });
  let merged = {
    base_url: baseUrl || httpSession.base_url,
    cookie: httpSession.cookie,
    csrf: fromEnv.csrf || cached?.csrf || httpSession.csrf,
    trust: fromEnv.trust || cached?.trust || httpSession.trust,
    user: httpSession.user || fromEnv.user,
    saved_at: new Date().toISOString(),
  };

  if (merged.cookie && merged.csrf && merged.trust) {
    saveCachedSession(merged, options.envName);
    return merged;
  }

  // CSRF/trust só existem no browser — Playwright com OFS_USERNAME/PASSWORD
  const skipPlaywright = envTrim('OFS_UI_SKIP_PLAYWRIGHT') === '1';
  if (!skipPlaywright) {
    try {
      const { loginOfsUiSessionViaPlaywright } = require('./ofsUiPlaywrightLogin.js');
      console.log('[OFS-UI] sessão incompleta após HTTP — tentando Playwright…');
      const pwSession = await loginOfsUiSessionViaPlaywright({ ...options, saveCache: false });
      merged = {
        base_url: baseUrl || pwSession.base_url,
        cookie: pwSession.cookie,
        csrf: pwSession.csrf,
        trust: pwSession.trust,
        user: pwSession.user || merged.user,
        saved_at: new Date().toISOString(),
        source: 'playwright',
      };
      if (merged.cookie && merged.csrf && merged.trust) {
        saveCachedSession(merged, options.envName);
        return merged;
      }
    } catch (err) {
      console.warn('[OFS-UI] Playwright login falhou:', err.message || err);
    }
  }

  if (cached?.csrf && cached?.trust && merged.cookie) {
    throw new Error(
      'OFS UI: cookie renovado, mas CSRF/trust expirados. ' +
        'Rode: node scripts/run-ofs-ui-login-playwright.js (ou copie OFS_UI_CSRF e OFS_UI_TRUST do DevTools).',
    );
  }

  throw new Error(
    'OFS UI: sessão incompleta. Defina OFS_UI_COOKIE/CSRF/TRUST ou OFS_USERNAME/OFS_PASSWORD para auto-login.',
  );
}

/** Detecta resposta de sessão expirada/inválida nas chamadas AJAX UI. */
function isOfsUiSessionExpiredResponse({ status, text, data } = {}) {
  if (status === 401 || status === 403) return true;
  const body = String(text || '');
  if (/login-portal|from-login-portal|Sua sess[aã]o|session.*expir|CSRFSecureToken|sign-in/i.test(body)) {
    return true;
  }
  if (body.startsWith('<!') || body.startsWith('<html')) return true;
  if (data && typeof data === 'object' && data.error && /session|login|csrf|auth/i.test(String(data.error))) {
    return true;
  }
  return false;
}

/**
 * Renova sessão UI (cache → HTTP → Playwright) e retorna objeto de sessão atualizado.
 */
async function renewOfsUiSession(options = {}) {
  console.log('[OFS-UI] renovando sessão…');
  return ensureOfsUiSession({ ...options, useCache: false });
}

module.exports = {
  loginOfsUiSession,
  ensureOfsUiSession,
  renewOfsUiSession,
  isOfsUiSessionExpiredResponse,
  loadCachedSession,
  saveCachedSession,
  sessionCachePath,
  extractFromHtml,
  resolveCredentials,
};
