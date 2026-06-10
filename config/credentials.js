const path = require('path');
const fs = require('fs');

const USER_FIXTURE_RELATIVE = 'support/fixtures/user.json';

function getProjectRoot() {
  return process.cwd();
}

function getUserFixturePath() {
  return path.resolve(getProjectRoot(), USER_FIXTURE_RELATIVE);
}

function getEnvName() {
  return String(process.env.ENVIRONMENT || process.env.ENV || 'ti').trim().toLowerCase();
}

function readEnvJson() {
  const fullPath = path.resolve(getProjectRoot(), 'support/environment/env.json');
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content);
}

function getTokenUrlForEnv(envName) {
  const all = readEnvJson();
  const env = all[envName] || all.ti || all;
  if (env?.api?.tokenUrl) return env.api.tokenUrl;
  const base = env?.urls?.salesforce;
  return base ? `${String(base).replace(/\/$/, '')}/services/oauth2/token` : '';
}

function envTrim(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

/** Primeiro valor não vazio: env tem prioridade sobre user.json (OpenShift Secret / .env). */
function pickFirst(...candidates) {
  for (const c of candidates) {
    const s = c == null ? '' : String(c).trim();
    if (s) return s;
  }
  return '';
}

/** Ex.: envScopedKey('SF', 'ti', 'CLIENT_ID') → SF_TI_CLIENT_ID (Secret OpenShift). */
function envScopedKey(system, envName, field) {
  const env = String(envName || 'ti').trim().toUpperCase();
  return envTrim(`${system}_${env}_${field}`);
}

function hasSalesforceEnvVars() {
  return Boolean(
    envTrim('SF_CONSUMER_KEY')
    || envTrim('SF_CONSUMER_SECRET')
    || envTrim('SF_TI_CLIENT_ID')
    || envTrim('SF_TI_CLIENT_SECRET')
    || envTrim('SF_TRG_CLIENT_ID')
    || envTrim('SF_TRG_CLIENT_SECRET')
    || envTrim('SF_USERNAME')
    || envTrim('SF_PASSWORD')
    || envTrim('SF_ACCESS_TOKEN'),
  );
}

function hasPegaEnvVars(envName) {
  const name = envName || getEnvName();
  return Boolean(
    envTrim('PEGA_CLIENT_ID')
    || envTrim('PEGA_CLIENT_SECRET')
    || envTrim('PEGA_BEARER_TOKEN')
    || envScopedKey('PEGA', name, 'CLIENT_ID')
    || envScopedKey('PEGA', name, 'CLIENT_SECRET'),
  );
}

function mergeSalesforceCredentials(fileSf, envName) {
  const name = envName || getEnvName();
  const file = fileSf && typeof fileSf === 'object' ? fileSf : {};
  return {
    grant_type: pickFirst(envTrim('SF_GRANT_TYPE'), file.grant_type) || 'client_credentials',
    client_id: pickFirst(
      envScopedKey('SF', name, 'CLIENT_ID'),
      envTrim('SF_CONSUMER_KEY'),
      file.client_id,
    ),
    client_secret: pickFirst(
      envScopedKey('SF', name, 'CLIENT_SECRET'),
      envTrim('SF_CONSUMER_SECRET'),
      file.client_secret,
    ),
    username: pickFirst(envTrim('SF_USERNAME'), file.username),
    password: pickFirst(envTrim('SF_PASSWORD'), file.password),
    access_token: pickFirst(envTrim('SF_ACCESS_TOKEN'), file.access_token),
    tokenUrl: pickFirst(envTrim('SF_TOKEN_URL'), file.tokenUrl, getTokenUrlForEnv(name)),
    cookie: pickFirst(envTrim('SF_COOKIE'), file.cookie),
  };
}

function mergePegaCredentials(filePega, envName) {
  const name = envName || getEnvName();
  const file = filePega && typeof filePega === 'object' ? filePega : {};
  const clientId = pickFirst(
    envScopedKey('PEGA', name, 'CLIENT_ID'),
    envTrim('PEGA_CLIENT_ID'),
    file.client_id,
  );
  const clientSecret = pickFirst(
    envScopedKey('PEGA', name, 'CLIENT_SECRET'),
    envTrim('PEGA_CLIENT_SECRET'),
    file.client_secret,
  );
  const tokenUrl = pickFirst(envTrim('PEGA_TOKEN_URL'), file.token_url);
  const baseUrl = pickFirst(envTrim('PEGA_BASE_URL'), file.base_url);
  const cookie = pickFirst(envTrim('PEGA_COOKIE'), file.cookie);
  const bearer = envTrim('PEGA_BEARER_TOKEN');

  if (!clientId && !clientSecret && !tokenUrl && !baseUrl && !bearer) {
    return null;
  }

  return {
    token_url: tokenUrl,
    base_url: baseUrl,
    client_id: clientId,
    client_secret: clientSecret,
    cookie,
  };
}

function buildSalesforceFromEnv(envName) {
  return mergeSalesforceCredentials(null, envName);
}

function buildPegaFromEnv(envName) {
  return mergePegaCredentials(null, envName);
}

function missingSalesforceFields(sf) {
  const missing = [];
  const grantType = sf.grant_type || 'client_credentials';

  if (envTrim('SF_ACCESS_TOKEN') || sf.access_token) {
    return missing;
  }

  if (grantType === 'password') {
    if (!sf.client_id) missing.push('SF_CONSUMER_KEY ou SF_<ENV>_CLIENT_ID');
    if (!sf.client_secret) missing.push('SF_CONSUMER_SECRET ou SF_<ENV>_CLIENT_SECRET');
    if (!sf.username) missing.push('SF_USERNAME');
    if (!sf.password) missing.push('SF_PASSWORD');
    return missing;
  }

  if (!sf.client_id) missing.push('SF_CONSUMER_KEY ou SF_<ENV>_CLIENT_ID');
  if (!sf.client_secret) missing.push('SF_CONSUMER_SECRET ou SF_<ENV>_CLIENT_SECRET');
  return missing;
}

function formatCredentialsError(missing, envName) {
  const lines = [
    `Credenciais Salesforce ausentes para o ambiente "${envName}".`,
    '',
    'Configure uma das opções:',
    '  • Arquivo local: support/fixtures/user.json (copie de support/fixtures/user.example.json)',
    '  • Variáveis de ambiente (OpenShift Secret tdm-qa-secrets / CI):',
    `      - SF_${String(envName).toUpperCase()}_CLIENT_ID / SF_${String(envName).toUpperCase()}_CLIENT_SECRET`,
    '      - ou SF_CONSUMER_KEY / SF_CONSUMER_SECRET',
  ];
  for (const key of missing) {
    lines.push(`      - ${key}`);
  }
  lines.push('');
  lines.push('Ou defina SF_ACCESS_TOKEN para usar um token já emitido.');
  return lines.join('\n');
}

function validateSalesforceCredentials(sf, envName) {
  const missing = missingSalesforceFields(sf);
  if (missing.length > 0) {
    throw new Error(formatCredentialsError(missing, envName));
  }
}

function loadUserFixtureFile() {
  const fullPath = getUserFixturePath();
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content);
}

function buildFixtureDocumentFromEnv(envName) {
  const salesforce = buildSalesforceFromEnv(envName);
  validateSalesforceCredentials(salesforce, envName);

  const block = { salesforce };
  const pega = buildPegaFromEnv(envName);
  if (pega) block.pega = pega;

  return { [envName]: block };
}

/**
 * Cria support/fixtures/user.json a partir das variáveis de ambiente quando o arquivo
 * não existe (ex.: esteira CI). O arquivo fica no .gitignore e não deve ser versionado.
 */
function ensureUserFixtureFile() {
  const fullPath = getUserFixturePath();
  if (fs.existsSync(fullPath)) return false;
  if (!hasSalesforceEnvVars()) return false;

  const envName = getEnvName();
  const doc = buildFixtureDocumentFromEnv(envName);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return true;
}

function resolveEnvBlock(all, envName) {
  if (!all || typeof all !== 'object') return null;
  return all[envName] || all.ti || all.dev || all;
}

/**
 * Credenciais do ambiente ativo: process.env.* tem prioridade; user.json é fallback.
 * Compatível com support/fixtures/user.json (ti / dev / trg) e Secret OpenShift tdm-qa-secrets.
 */
function getUserFixture(envName) {
  const name = envName || getEnvName();
  ensureUserFixtureFile();

  const fromFile = loadUserFixtureFile();
  const fileBlock = fromFile ? resolveEnvBlock(fromFile, name) : null;
  const salesforce = mergeSalesforceCredentials(fileBlock?.salesforce, name);
  validateSalesforceCredentials(salesforce, name);

  const block = { salesforce };
  const pega = mergePegaCredentials(fileBlock?.pega, name);
  if (pega) block.pega = pega;
  return block;
}

function getPegaFixture(envName) {
  const name = envName || getEnvName();
  ensureUserFixtureFile();

  const fromFile = loadUserFixtureFile();
  const fileBlock = fromFile ? resolveEnvBlock(fromFile, name) : null;
  if (fromFile && !fileBlock?.pega && fromFile.pega && typeof fromFile.pega === 'object') {
    return mergePegaCredentials(fromFile.pega, name);
  }
  return mergePegaCredentials(fileBlock?.pega, name);
}

function getSalesforceCredentials(envName) {
  const block = getUserFixture(envName);
  return block.salesforce || {};
}

module.exports = {
  USER_FIXTURE_RELATIVE,
  getUserFixturePath,
  getEnvName,
  pickFirst,
  envScopedKey,
  ensureUserFixtureFile,
  getUserFixture,
  getPegaFixture,
  getSalesforceCredentials,
  mergeSalesforceCredentials,
  mergePegaCredentials,
  buildSalesforceFromEnv,
  buildPegaFromEnv,
  validateSalesforceCredentials,
  hasSalesforceEnvVars,
  hasPegaEnvVars,
};
