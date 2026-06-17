const { getEnvName, pickFirst, envScopedKey } = require('../../../config/credentials.js');
const {
  OFS_HOST_BY_ENV,
  OFS_API_USERNAME_DEFAULT,
  OFS_API_PASSWORD_DEFAULT,
  OFS_RESOURCE_ID_DEFAULT,
} = require('./ofsConstants.js');

function envTrim(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

/** Defaults alinhados à collection Postman ofsvtal1.test (auth + hosts TI/TRG). */
const OFS_DEFAULTS = {
  ti: {
    base_url: OFS_HOST_BY_ENV.ti,
    username: OFS_API_USERNAME_DEFAULT,
    password: OFS_API_PASSWORD_DEFAULT,
    resource_id: OFS_RESOURCE_ID_DEFAULT,
  },
  trg: {
    base_url: OFS_HOST_BY_ENV.trg,
    username: OFS_API_USERNAME_DEFAULT,
    password: OFS_API_PASSWORD_DEFAULT,
    resource_id: OFS_RESOURCE_ID_DEFAULT,
  },
};

function loadUserFixtureFile() {
  try {
    const fs = require('fs');
    const path = require('path');
    const fullPath = path.resolve(process.cwd(), 'support/fixtures/user.json');
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function mergeOfsCredentials(fileOfs, envName) {
  const name = envName || getEnvName();
  const file = fileOfs && typeof fileOfs === 'object' ? fileOfs : {};
  const defaults = OFS_DEFAULTS[name] || OFS_DEFAULTS.ti;
  const baseUrl = pickFirst(
    envTrim('OFS_BASE_URL'),
    envScopedKey('OFS', name, 'BASE_URL'),
    file.base_url,
    defaults.base_url,
  );
  const username = pickFirst(
    envTrim('OFS_API_USERNAME'),
    envTrim('OFS_USERNAME'),
    envScopedKey('OFS', name, 'USERNAME'),
    file.username,
    defaults.username,
  );
  const password = pickFirst(
    envTrim('OFS_API_PASSWORD'),
    envTrim('OFS_PASSWORD'),
    envScopedKey('OFS', name, 'PASSWORD'),
    file.password,
    defaults.password,
  );
  const resourceId = pickFirst(
    envTrim('OFS_RESOURCE_ID'),
    envScopedKey('OFS', name, 'RESOURCE_ID'),
    file.resource_id,
    defaults.resource_id,
  );

  if (!baseUrl && !username && !password && !resourceId) return null;

  return {
    base_url: baseUrl ? String(baseUrl).replace(/\/$/, '') : '',
    username,
    password,
    resource_id: resourceId,
    ui_username: pickFirst(
      envTrim('OFS_UI_USERNAME'),
      file.ui_username,
      '',
    ),
    ui_password: pickFirst(
      envTrim('OFS_UI_PASSWORD'),
      file.ui_password,
      '',
    ),
    tech_pid: pickFirst(envTrim('OFS_TECH_PID'), file.tech_pid, '881'),
    tech_search: pickFirst(envTrim('OFS_TECH_SEARCH'), file.tech_search, 'geraldo'),
    bucket_pid: pickFirst(envTrim('OFS_BUCKET_PID'), file.bucket_pid, '3457'),
  };
}

function getOfsFixture(envName) {
  const name = envName || getEnvName();
  const fromFile = loadUserFixtureFile();
  const block = fromFile?.[name] || fromFile?.ti || fromFile?.dev || fromFile;
  const fileOfs = block?.ofs && typeof block.ofs === 'object' ? block.ofs : fromFile?.ofs;
  return mergeOfsCredentials(fileOfs, name);
}

function getOfsDefaults() {
  const name = getEnvName();
  return OFS_DEFAULTS[name] || OFS_DEFAULTS.ti;
}

module.exports = {
  getOfsFixture,
  getOfsDefaults,
  mergeOfsCredentials,
  OFS_DEFAULTS,
};
