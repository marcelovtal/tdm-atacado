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

function hasSalesforceEnvVars() {
  return Boolean(
    envTrim('SF_CONSUMER_KEY')
    || envTrim('SF_CONSUMER_SECRET')
    || envTrim('SF_USERNAME')
    || envTrim('SF_PASSWORD')
    || envTrim('SF_ACCESS_TOKEN'),
  );
}

function buildSalesforceFromEnv(envName) {
  const grantType = envTrim('SF_GRANT_TYPE') || 'client_credentials';
  const sf = {
    grant_type: grantType,
    client_id: envTrim('SF_CONSUMER_KEY'),
    client_secret: envTrim('SF_CONSUMER_SECRET'),
    username: envTrim('SF_USERNAME'),
    password: envTrim('SF_PASSWORD'),
    access_token: envTrim('SF_ACCESS_TOKEN'),
    tokenUrl: envTrim('SF_TOKEN_URL') || getTokenUrlForEnv(envName),
    cookie: envTrim('SF_COOKIE'),
  };
  return sf;
}

function buildPegaFromEnv() {
  const clientId = envTrim('PEGA_CLIENT_ID');
  const clientSecret = envTrim('PEGA_CLIENT_SECRET');
  const tokenUrl = envTrim('PEGA_TOKEN_URL');
  const baseUrl = envTrim('PEGA_BASE_URL');
  const cookie = envTrim('PEGA_COOKIE');
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

function missingSalesforceFields(sf) {
  const missing = [];
  const grantType = sf.grant_type || 'client_credentials';

  if (envTrim('SF_ACCESS_TOKEN')) {
    return missing;
  }

  if (grantType === 'password') {
    if (!sf.client_id) missing.push('SF_CONSUMER_KEY');
    if (!sf.client_secret) missing.push('SF_CONSUMER_SECRET');
    if (!sf.username) missing.push('SF_USERNAME');
    if (!sf.password) missing.push('SF_PASSWORD');
    return missing;
  }

  if (!sf.client_id) missing.push('SF_CONSUMER_KEY');
  if (!sf.client_secret) missing.push('SF_CONSUMER_SECRET');
  return missing;
}

function formatCredentialsError(missing, envName) {
  const lines = [
    `Credenciais Salesforce ausentes para o ambiente "${envName}".`,
    '',
    'Configure uma das opções:',
    '  • Arquivo local: support/fixtures/user.json (copie de support/fixtures/user.example.json)',
    '  • Variáveis de ambiente (CI/CD):',
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
  const pega = buildPegaFromEnv();
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

function getUserFixture(envName) {
  const name = envName || getEnvName();
  ensureUserFixtureFile();

  const fromFile = loadUserFixtureFile();
  if (fromFile) {
    const block = resolveEnvBlock(fromFile, name);
    if (block) return block;
  }

  const salesforce = buildSalesforceFromEnv(name);
  validateSalesforceCredentials(salesforce, name);

  const block = { salesforce };
  const pega = buildPegaFromEnv();
  if (pega) block.pega = pega;
  return block;
}

function getPegaFixture(envName) {
  const name = envName || getEnvName();
  ensureUserFixtureFile();

  const fromFile = loadUserFixtureFile();
  if (fromFile) {
    const block = resolveEnvBlock(fromFile, name);
    if (block?.pega && typeof block.pega === 'object') return block.pega;
    if (fromFile.pega && typeof fromFile.pega === 'object') return fromFile.pega;
  }

  return buildPegaFromEnv();
}

function getSalesforceCredentials(envName) {
  const block = getUserFixture(envName);
  return block.salesforce || block.dev?.salesforce || block.trg?.salesforce || {};
}

module.exports = {
  USER_FIXTURE_RELATIVE,
  getUserFixturePath,
  getEnvName,
  ensureUserFixtureFile,
  getUserFixture,
  getPegaFixture,
  getSalesforceCredentials,
  buildSalesforceFromEnv,
  validateSalesforceCredentials,
  hasSalesforceEnvVars,
};
