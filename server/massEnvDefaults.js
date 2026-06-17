import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const ROOT = config.vtalPath;

const MASSA_PRONTA_TRIPLE_TYPES = new Set([
  'massa-pronta-opp-pedido',
  'massa-pronta-opp-pedido-ip-connect-cpe',
  'massa-pronta-opp-pedido-pega',
  'massa-pronta-opp-pedido-pega-ofs',
  'massa-pronta-opp-pedido-link-dedicado',
  'massa-pronta-opp-pedido-link-dedicado-pega',
  'massa-pronta-opp-pedido-link-dedicado-pega-ofs',
  'massa-pronta-opp-pedido-vpn',
  'massa-pronta-opp-pedido-vpn-pega',
  'massa-pronta-opp-pedido-vpn-pega-ofs',
]);

const OFS_UI_MASS_TYPES = new Set([
  'massa-pronta-opp-pedido-pega-ofs',
  'massa-pronta-opp-pedido-vpn-pega-ofs',
  'massa-pronta-opp-pedido-link-dedicado-pega-ofs',
]);

function loadUserFixture() {
  const file = path.join(ROOT, 'support/fixtures/user.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function envBlock(envName) {
  const fixture = loadUserFixture();
  if (!fixture) return {};
  return fixture[envName] || {};
}

function pick(...values) {
  for (const v of values) {
    const s = v == null ? '' : String(v).trim();
    if (s) return s;
  }
  return '';
}

/** Contas massa pronta vêm só do formulário (extraEnv) — sem defaults no servidor. */
export function getMassaProntaDefaultsForApi() {
  return {
    ti: { accountOrganizationId: '', accountBusinessId: '', accountBillingId: '' },
    trg: { accountOrganizationId: '', accountBusinessId: '', accountBillingId: '' },
  };
}

function getOfsUiEnvVars(environment) {
  const block = envBlock(environment);
  const ofs = block.ofs && typeof block.ofs === 'object' ? block.ofs : {};
  const vars = {};
  const uiUser = pick(process.env.OFS_UI_USERNAME, process.env.OFS_USERNAME, ofs.ui_username);
  const uiPass = pick(process.env.OFS_UI_PASSWORD, process.env.OFS_PASSWORD, ofs.ui_password);
  if (uiUser) vars.OFS_USERNAME = uiUser;
  if (uiPass) vars.OFS_PASSWORD = uiPass;
  const techPid = pick(process.env.OFS_TECH_PID, ofs.tech_pid, '881');
  const techSearch = pick(process.env.OFS_TECH_SEARCH, ofs.tech_search, 'geraldo');
  const bucketPid = pick(process.env.OFS_BUCKET_PID, ofs.bucket_pid, '3457');
  if (techPid) vars.OFS_TECH_PID = techPid;
  if (techSearch) vars.OFS_TECH_SEARCH = techSearch;
  if (bucketPid) vars.OFS_BUCKET_PID = bucketPid;
  return vars;
}

/**
 * Variáveis injetadas automaticamente ao enfileirar job (OFS UI).
 * Contas massa pronta não entram aqui — só via extraEnv da UI ou repetir job.
 */
export function resolveMassEnvVars(massTypeId, environment) {
  const merged = {};
  if (OFS_UI_MASS_TYPES.has(massTypeId)) {
    Object.assign(merged, getOfsUiEnvVars(environment));
  }
  return merged;
}

function tripleFromExtraEnv(massTypeId, extraEnv = {}) {
  if (!MASSA_PRONTA_TRIPLE_TYPES.has(massTypeId)) return null;
  const merged = extraEnv || {};
  return {
    org: String(merged.ACCOUNT_ORGANIZATION_ID || '').trim(),
    business: String(merged.ACCOUNT_BUSINESS_ID || '').trim(),
    billing: String(merged.ACCOUNT_BILLING_ID || '').trim(),
  };
}

/** Bloqueia enfileiramento sem Organization / Business / Billing informados na UI. */
export function validateMassaProntaJob(massTypeId, environment, extraEnv = {}) {
  const triple = tripleFromExtraEnv(massTypeId, extraEnv);
  if (!triple) return null;
  const env = String(environment || 'ti').toUpperCase();
  const { org, business, billing } = triple;
  if (!org || !business || !billing) {
    return `Informe Organization, Business e Billing da massa pronta (${env}) nos campos do formulário.`;
  }
  return null;
}
