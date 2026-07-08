import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, ENVIRONMENTS } from './config.js';
import {
  listMassTypeSettingsMysql,
  replaceMassTypeSettingsMysql,
} from './database/mysqlStore.js';
import { listMassTypeDefinitions } from './massTypeCatalog.js';
import {
  clearMassTypeFailureState,
  getMassTypeFailureDisplay,
} from './massTypeFailureTracker.js';

const useMysql = config.database.driver === 'mysql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH =
  process.env.MASS_TYPE_SETTINGS_PATH || path.join(__dirname, 'data', 'mass-type-settings.json');

/** Cache em memória — atualizado no init e a cada PUT. */
let activeByIdCache = null;

function defaultEnvironmentsActive() {
  return Object.fromEntries(ENVIRONMENTS.map((env) => [env, true]));
}

function readSettingsFile() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ types: {} }, null, 2), 'utf-8');
      return {};
    }
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return data.types && typeof data.types === 'object' ? data.types : {};
  } catch (err) {
    console.error('[MassTypes] Erro ao ler mass-type-settings.json:', err.message);
    return {};
  }
}

function writeSettingsFile(typesMap) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ types: typesMap }, null, 2), 'utf-8');
}

/** Compatível com formato antigo `{ active: bool }` e novo `{ environments: { ti, trg } }`. */
function normalizeTypeSettings(val) {
  if (val?.environments && typeof val.environments === 'object') {
    const environments = defaultEnvironmentsActive();
    for (const env of ENVIRONMENTS) {
      if (val.environments[env] !== undefined) {
        environments[env] = val.environments[env] !== false;
      }
    }
    return { environments };
  }
  if (val && val.active === false) {
    return { environments: Object.fromEntries(ENVIRONMENTS.map((env) => [env, false])) };
  }
  return { environments: defaultEnvironmentsActive() };
}

function rowsToMap(rows) {
  const map = {};
  for (const row of rows) {
    if (!row?.id) continue;
    const environments = defaultEnvironmentsActive();
    if (row.activeTi !== undefined) environments.ti = !!row.activeTi;
    if (row.activeTrg !== undefined) environments.trg = !!row.activeTrg;
    for (const env of ENVIRONMENTS) {
      const key = `active${env.charAt(0).toUpperCase()}${env.slice(1)}`;
      if (row[key] !== undefined) environments[env] = !!row[key];
    }
    if (row.active === false || row.active === 0) {
      for (const env of ENVIRONMENTS) environments[env] = false;
    }
    map[row.id] = { environments };
  }
  return map;
}

function mapToRows(map) {
  return Object.entries(map).map(([id, val]) => {
    const normalized = normalizeTypeSettings(val);
    const row = { id };
    for (const env of ENVIRONMENTS) {
      row[`active${env.charAt(0).toUpperCase()}${env.slice(1)}`] = !!normalized.environments[env];
    }
    row.active = ENVIRONMENTS.some((env) => normalized.environments[env]);
    return row;
  });
}

function getActiveMap() {
  if (activeByIdCache) return activeByIdCache;
  activeByIdCache = readSettingsFile();
  return activeByIdCache;
}

function setActiveCache(map) {
  activeByIdCache = map;
}

function defaultActiveMap() {
  const map = {};
  for (const t of listMassTypeDefinitions()) {
    map[t.id] = { environments: defaultEnvironmentsActive() };
  }
  return map;
}

function mergeWithDefaults(overrides = {}) {
  const merged = defaultActiveMap();
  for (const [id, val] of Object.entries(overrides)) {
    if (!merged[id]) continue;
    merged[id] = normalizeTypeSettings(val);
  }
  return merged;
}

function normalizeEnvironment(environment) {
  const env = String(environment || 'ti').trim().toLowerCase();
  return ENVIRONMENTS.includes(env) ? env : 'ti';
}

/** Chamar após initDatabase() — carrega do MySQL ou JSON. */
export async function initMassTypeSettings() {
  if (useMysql) {
    let rows = await listMassTypeSettingsMysql();
    if (!rows.length) {
      const seed = mergeWithDefaults(readSettingsFile());
      const seedRows = mapToRows(seed);
      if (seedRows.length) {
        await replaceMassTypeSettingsMysql(seedRows);
        rows = await listMassTypeSettingsMysql();
        console.log(`[MassTypes] Configurações iniciais importadas do JSON (${rows.length} tipo(s))`);
      }
    }
    setActiveCache(mergeWithDefaults(rowsToMap(rows)));
    console.log(`[MassTypes] MySQL mass_type_settings (${rows.length} registro(s))`);
    return;
  }
  setActiveCache(mergeWithDefaults(readSettingsFile()));
  console.log(`[MassTypes] Arquivo ${SETTINGS_PATH}`);
}

export function isMassTypeActive(id, environment = 'ti') {
  const env = normalizeEnvironment(environment);
  const map = getActiveMap();
  const settings = normalizeTypeSettings(map[id]);
  return settings.environments[env] !== false;
}

export function getMassTypeActiveEnvironments(id) {
  const map = getActiveMap();
  return { ...normalizeTypeSettings(map[id]).environments };
}

export function listMassTypeSettings() {
  const map = getActiveMap();
  return listMassTypeDefinitions().map((t) => {
    const environments = getMassTypeActiveEnvironments(t.id);
    const failure = getMassTypeFailureDisplay(t.id);
    return {
      id: t.id,
      label: t.label,
      script: t.script,
      activeEnvironments: environments,
      active: ENVIRONMENTS.some((env) => environments[env]),
      failureStreakByEnv: failure.streakByEnv,
      autoDisabledByEnv: failure.autoDisabledByEnv,
      autoDisableReasonByEnv: failure.autoDisableReasonByEnv,
    };
  });
}

function applyTypeUpdate(next, row) {
  const id = String(row?.id || '').trim();
  if (!next[id]) return;

  const current = normalizeTypeSettings(next[id]);

  if (row.activeEnvironments && typeof row.activeEnvironments === 'object') {
    const environments = { ...current.environments };
    for (const env of ENVIRONMENTS) {
      if (row.activeEnvironments[env] !== undefined) {
        const enabled = row.activeEnvironments[env] !== false;
        environments[env] = enabled;
        if (enabled) clearMassTypeFailureState(id, env);
      }
    }
    next[id] = { environments };
    return;
  }

  if (row.environment != null && row.active !== undefined) {
    const env = normalizeEnvironment(row.environment);
    next[id] = {
      environments: {
        ...current.environments,
        [env]: row.active !== false,
      },
    };
    if (row.active !== false) {
      clearMassTypeFailureState(id, env);
    }
    return;
  }

  if (row.active !== undefined) {
    const active = row.active !== false;
    next[id] = {
      environments: Object.fromEntries(ENVIRONMENTS.map((env) => [env, active])),
    };
    if (active && row.environment != null) {
      clearMassTypeFailureState(id, normalizeEnvironment(row.environment));
    } else if (active) {
      for (const env of ENVIRONMENTS) clearMassTypeFailureState(id, env);
    }
  }
}

export async function updateMassTypeSettings({ types = [] } = {}) {
  const current = getActiveMap();
  const next = mergeWithDefaults(current);
  for (const row of types) {
    applyTypeUpdate(next, row);
  }

  const rows = mapToRows(next);
  if (useMysql) {
    await replaceMassTypeSettingsMysql(rows);
  } else {
    writeSettingsFile(next);
  }
  setActiveCache(next);
  return { types: listMassTypeSettings() };
}
