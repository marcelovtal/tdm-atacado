const { getOfsFixture } = require('./getOfsConfig.js');
const { ensureOfsUiSession } = require('./ofsUiLogin.js');

function envTrim(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

/**
 * Sessão supervisor OFS (API interna UI — cookies + CSRF do browser).
 * Ordem: OFS_UI_COOKIE/CSRF/TRUST → cache .auth → login automático (OFS_USERNAME/PASSWORD).
 * Não commitar credenciais nem tokens.
 */
function getOfsUiConfigFromSession(session) {
  const rest = getOfsFixture() || {};
  const baseUrl = (session.base_url || envTrim('OFS_UI_BASE_URL') || rest.base_url || '').replace(/\/$/, '');
  const cookie = session.cookie;
  const csrf = session.csrf;
  const trust = session.trust;
  const user = session.user || envTrim('OFS_UI_USER') || rest.ui_username || 'VT422570';

  if (!baseUrl) {
    throw new Error('OFS UI: base_url ausente (OFS_UI_BASE_URL ou user.json → ofs.base_url).');
  }
  if (!cookie) {
    throw new Error('OFS UI: cookie ausente — defina OFS_UI_COOKIE ou OFS_USERNAME/OFS_PASSWORD para auto-login.');
  }
  if (!csrf) {
    throw new Error('OFS UI: CSRF ausente — defina OFS_UI_CSRF ou OFS_USERNAME/OFS_PASSWORD para auto-login.');
  }
  if (!trust) {
    throw new Error('OFS UI: trust ausente — defina OFS_UI_TRUST ou OFS_USERNAME/OFS_PASSWORD para auto-login.');
  }

  const dvRaw = envTrim('OFS_UI_DV');
  let dv = { c: '1404|20260610041132' };
  if (dvRaw) {
    try {
      dv = JSON.parse(dvRaw);
    } catch (err) {
      throw new Error(`OFS UI: OFS_UI_DV inválido (JSON): ${err.message}`);
    }
  }

  return {
    base_url: baseUrl,
    cookie,
    csrf,
    trust,
    user,
    window_id: envTrim('OFS_UI_WINDOW_ID') || `${Date.now()}-0000-0000`,
    bucket_pid: envTrim('OFS_BUCKET_PID') || rest.bucket_pid || '3457',
    tech_pid: envTrim('OFS_TECH_PID') || rest.tech_pid || '881',
    tech_search: envTrim('OFS_TECH_SEARCH') || rest.tech_search || 'geraldo',
    dv,
    protocol: envTrim('OFS_UI_PROTOCOL') || '7',
  };
}

/** Síncrono — só quando OFS_UI_COOKIE/CSRF/TRUST já estão no ambiente. */
function getOfsUiConfig() {
  const rest = getOfsFixture() || {};
  const session = {
    base_url: envTrim('OFS_UI_BASE_URL') || rest.base_url,
    cookie: envTrim('OFS_UI_COOKIE'),
    csrf: envTrim('OFS_UI_CSRF'),
    trust: envTrim('OFS_UI_TRUST'),
    user: envTrim('OFS_UI_USER'),
  };
  return getOfsUiConfigFromSession(session);
}

/** Assíncrono — env → cache → login automático. Preferir nos scripts OFS UI. */
async function getOfsUiConfigAsync(options = {}) {
  const session = await ensureOfsUiSession(options);
  return getOfsUiConfigFromSession(session);
}

module.exports = { getOfsUiConfig, getOfsUiConfigAsync, getOfsUiConfigFromSession };
