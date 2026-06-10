const path = require('path');
const fs = require('fs');
const {
  getEnvName,
  getUserFixture,
  getPegaFixture,
} = require('./credentials.js');

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

