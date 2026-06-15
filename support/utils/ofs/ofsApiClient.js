const { getOfsFixture } = require('./getOfsConfig.js');

function buildBasicAuthHeader(username, password) {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function createOfsApiClient(config = null) {
  const cfg = config || getOfsFixture();
  if (!cfg?.base_url) {
    throw new Error('OFS: base_url não configurada (OFS_BASE_URL ou user.json → ofs.base_url).');
  }
  if (!cfg.username || !cfg.password) {
    throw new Error('OFS: credenciais ausentes (OFS_USERNAME/OFS_PASSWORD ou user.json → ofs).');
  }

  const baseUrl = cfg.base_url.replace(/\/$/, '');
  const authHeader = buildBasicAuthHeader(cfg.username, cfg.password);

  async function request(method, path, body = null, options = {}) {
    const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
      Authorization: authHeader,
      Accept: 'application/json',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };
    const opts = { method, headers };
    if (body != null && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      opts.body = JSON.stringify(body);
    }
    if (options.log !== false) {
      console.log(`[OFS] ${method} ${url.replace(baseUrl, '')}`);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text || null;
    }
    return { ok: res.ok, status: res.status, data, text };
  }

  return {
    baseUrl,
    config: cfg,
    get: (path, opts) => request('GET', path, null, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
  };
}

module.exports = { createOfsApiClient, buildBasicAuthHeader };
