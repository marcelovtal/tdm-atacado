import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, ENVIRONMENTS } from './config.js';
import { updateMassTypeSettings, isMassTypeActive } from './massTypeSettings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKER_PATH =
  process.env.MASS_TYPE_FAILURE_TRACKER_PATH ||
  path.join(__dirname, 'data', 'mass-type-failure-tracker.json');

const AUTO_DISABLE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.MASS_TYPE_AUTO_DISABLE_THRESHOLD || '4', 10) || 4,
);

/** @type {Record<string, Record<string, { streak?: number, autoDisabled?: boolean, lastError?: string|null, disabledAt?: string|null }>>} */
let trackerCache = null;

function normalizeEnvironment(environment) {
  const env = String(environment || 'ti').trim().toLowerCase();
  return ENVIRONMENTS.includes(env) ? env : 'ti';
}

function emptyEnvState() {
  return Object.fromEntries(
    ENVIRONMENTS.map((env) => [env, { streak: 0, autoDisabled: false, lastError: null, disabledAt: null }]),
  );
}

function readTrackerFile() {
  try {
    if (!fs.existsSync(TRACKER_PATH)) {
      return {};
    }
    const data = JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf-8'));
    return data?.types && typeof data.types === 'object' ? data.types : {};
  } catch (err) {
    console.error('[MassTypeFailure] Erro ao ler tracker:', err.message);
    return {};
  }
}

function writeTrackerFile(types) {
  fs.mkdirSync(path.dirname(TRACKER_PATH), { recursive: true });
  fs.writeFileSync(TRACKER_PATH, JSON.stringify({ types }, null, 2), 'utf-8');
}

function getTrackerMap() {
  if (!trackerCache) trackerCache = readTrackerFile();
  return trackerCache;
}

function ensureTypeState(massTypeId) {
  const map = getTrackerMap();
  if (!map[massTypeId]) {
    map[massTypeId] = emptyEnvState();
  }
  for (const env of ENVIRONMENTS) {
    if (!map[massTypeId][env] || typeof map[massTypeId][env] !== 'object') {
      map[massTypeId][env] = { streak: 0, autoDisabled: false, lastError: null, disabledAt: null };
    }
    map[massTypeId][env].streak = Math.max(0, parseInt(map[massTypeId][env].streak, 10) || 0);
    map[massTypeId][env].autoDisabled = map[massTypeId][env].autoDisabled === true;
  }
  return map[massTypeId];
}

function persistTracker() {
  writeTrackerFile(getTrackerMap());
}

export function initMassTypeFailureTracker() {
  trackerCache = readTrackerFile();
  console.log(
    `[MassTypeFailure] Tracker ${TRACKER_PATH} (desativa após ${AUTO_DISABLE_THRESHOLD} falha(s) técnica(s) consecutiva(s); erros do usuário não contam)`,
  );
}

export function getMassTypeFailureDisplay(massTypeId) {
  const typeState = ensureTypeState(massTypeId);
  const streakByEnv = {};
  const autoDisabledByEnv = {};
  const autoDisableReasonByEnv = {};
  for (const env of ENVIRONMENTS) {
    const row = typeState[env];
    streakByEnv[env] = row.streak || 0;
    autoDisabledByEnv[env] = !!row.autoDisabled;
    autoDisableReasonByEnv[env] = row.autoDisabled
      ? row.lastError ||
        `${AUTO_DISABLE_THRESHOLD} falha(s) técnica(s) consecutiva(s) — aguardando correção`
      : null;
  }
  return { streakByEnv, autoDisabledByEnv, autoDisableReasonByEnv };
}

export function getAutoDisableInfo(massTypeId, environment) {
  const env = normalizeEnvironment(environment);
  const row = ensureTypeState(massTypeId)[env];
  return {
    autoDisabled: !!row.autoDisabled,
    streak: row.streak || 0,
    lastError: row.lastError || null,
    disabledAt: row.disabledAt || null,
    threshold: AUTO_DISABLE_THRESHOLD,
  };
}

export function clearMassTypeFailureState(massTypeId, environment) {
  const env = normalizeEnvironment(environment);
  const typeState = ensureTypeState(massTypeId);
  typeState[env] = { streak: 0, autoDisabled: false, lastError: null, disabledAt: null };
  persistTracker();
}

async function setMassTypeAutoDisabled(massTypeId, environment, errorMessage) {
  const env = normalizeEnvironment(environment);
  const typeState = ensureTypeState(massTypeId);
  typeState[env].autoDisabled = true;
  typeState[env].disabledAt = new Date().toISOString();
  typeState[env].lastError = String(errorMessage || '').trim().slice(0, 500) || null;
  persistTracker();

  if (isMassTypeActive(massTypeId, env)) {
    await updateMassTypeSettings({
      types: [{ id: massTypeId, environment: env, active: false }],
    });
  }

  console.warn(
    `[MassTypeFailure] Card "${massTypeId}" desativado em ${env.toUpperCase()} após ${typeState[env].streak} falha(s) técnica(s) consecutiva(s).`,
  );
}

async function reEnableAfterAutoDisable(massTypeId, environment, reason) {
  const env = normalizeEnvironment(environment);
  const typeState = ensureTypeState(massTypeId);
  if (!typeState[env].autoDisabled) {
    clearMassTypeFailureState(massTypeId, env);
    return;
  }
  clearMassTypeFailureState(massTypeId, env);
  if (!isMassTypeActive(massTypeId, env)) {
    await updateMassTypeSettings({
      types: [{ id: massTypeId, environment: env, active: true }],
    });
  }
  console.log(
    `[MassTypeFailure] Card "${massTypeId}" reativado em ${env.toUpperCase()} (${reason}).`,
  );
}

/**
 * Atualiza streak / auto-disable após execução de job.
 * @returns {Promise<{ action: string, streak?: number }|null>}
 */
export async function recordMassTypeJobOutcome({
  massTypeId,
  environment,
  status,
  errorMessage = null,
} = {}) {
  if (!massTypeId) return null;
  const env = normalizeEnvironment(environment);
  const typeState = ensureTypeState(massTypeId);
  const row = typeState[env];

  if (status === 'user_error' || status === 'cancelled') {
    return { action: 'ignored_user_or_cancelled' };
  }

  if (status === 'completed') {
    const wasAuto = row.autoDisabled;
    if (wasAuto) {
      await reEnableAfterAutoDisable(massTypeId, env, 'execução bem-sucedida');
    } else if (row.streak > 0) {
      clearMassTypeFailureState(massTypeId, env);
    }
    return { action: wasAuto ? 'reenabled_success' : 'streak_reset' };
  }

  if (status === 'failed') {
    row.streak = (row.streak || 0) + 1;
    row.lastError = String(errorMessage || '').trim().slice(0, 500) || row.lastError || null;
    persistTracker();

    if (row.streak >= AUTO_DISABLE_THRESHOLD) {
      await setMassTypeAutoDisabled(massTypeId, env, row.lastError);
      return { action: 'auto_disabled', streak: row.streak };
    }
    return { action: 'streak_increment', streak: row.streak };
  }

  return { action: 'ignored_status', status };
}

export function buildMassTypeInactiveError(massTypeId, environment) {
  const env = normalizeEnvironment(environment);
  const info = getAutoDisableInfo(massTypeId, env);
  if (info.autoDisabled) {
    return (
      `Este fluxo foi desativado automaticamente após ${info.streak || AUTO_DISABLE_THRESHOLD} falha(s) técnica(s) consecutiva(s) em ${env.toUpperCase()}. ` +
      'Corrija o problema e peça ao administrador para reativar o card.'
    );
  }
  return `Este tipo de massa está desativado no ambiente ${env.toUpperCase()}. Escolha outro fluxo ou contate o admin.`;
}
