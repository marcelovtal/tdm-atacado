const path = require('path');
const fs = require('fs');

function getEnvName() {
  return String(process.env.ENVIRONMENT || process.env.ENV || 'ti').trim().toLowerCase();
}

function loadEnv() {
  const envName = getEnvName();
  const fullPath = path.resolve(process.cwd(), 'support/environment/env.json');
  const content = fs.readFileSync(fullPath, 'utf-8');
  const all = JSON.parse(content);
  return all[envName] || all.ti || all;
}

function getUrl(env, key) {
  return env?.urls?.[key] || env?.baseUrl || '';
}

function getGoogleUrl() {
  const env = loadEnv();
  return getUrl(env, 'google') || 'https://www.google.com/';
}

function getTokenUrl(env) {
  if (env?.api?.tokenUrl) return env.api.tokenUrl;
  const base = getUrl(env, 'salesforce');
  return base ? `${base.replace(/\/$/, '')}/services/oauth2/token` : '';
}

function getUserFixture() {
  const envName = getEnvName();
  const fullPath = path.resolve(process.cwd(), 'support/fixtures/user.json');
  const content = fs.readFileSync(fullPath, 'utf-8');
  const all = JSON.parse(content);
  return all[envName] || all.ti || all;
}

/** URLs PEGA padrão por ambiente (scripts podem sobrescrever via user.json / PEGA_*). */
const PEGA_DEFAULTS = {
  ti: {
    token_url: 'https://vtal-omvtal-qa.pega.net/prweb/PRRestService/oauth2/v1/token',
    base_url: 'https://vtal-omvtal-qa.pega.net',
  },
  trg: {
    token_url: 'https://vtal-omvtal-stg1.pega.net/prweb/PRRestService/oauth2/v1/token',
    base_url: 'https://vtal-omvtal-stg1.pega.net',
  },
};

function getPegaDefaults() {
  const envName = getEnvName();
  return PEGA_DEFAULTS[envName] || PEGA_DEFAULTS.ti;
}

/**
 * Credenciais PEGA (OAuth2 + URLs) por ambiente em user.json, ex.:
 * `"dev": { "salesforce": {...}, "pega": { "token_url", "base_url", "client_id", "client_secret", "cookie" } }`
 * Fallback: bloco raiz `"pega": { ... }`. process.env PEGA_* continua tendo prioridade no script.
 */
function getPegaFixture() {
  const envName = getEnvName();
  const fullPath = path.resolve(process.cwd(), 'support/fixtures/user.json');
  let all;
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    all = JSON.parse(content);
  } catch (_) {
    return null;
  }
  const block = all[envName] || all.ti || all.dev;
  if (block && typeof block === 'object' && block.pega && typeof block.pega === 'object') {
    return block.pega;
  }
  if (all.pega && typeof all.pega === 'object') return all.pega;
  return null;
}

module.exports = {
  getEnvName,
  loadEnv,
  getUrl,
  getGoogleUrl,
  getTokenUrl,
  getUserFixture,
  getPegaFixture,
  getPegaDefaults,
  PEGA_DEFAULTS,
};

