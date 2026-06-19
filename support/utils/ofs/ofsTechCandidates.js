const { getEnvName } = require('../../../config/credentials.js');
const { OFS_TECH_CANDIDATES_BY_ENV, OFS_UI_DEFAULTS_BY_ENV } = require('./ofsConstants.js');

function envTrim(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

function normalizeCandidate(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const pid = String(raw.pid ?? raw.tech_pid ?? '').trim();
  const search = String(raw.search ?? raw.tech_search ?? '').trim();
  const label = String(raw.label ?? raw.name ?? '').trim();
  if (!pid && !search) return null;
  return { pid, search, label: label || search || pid };
}

function parseCandidatesFromEnv() {
  const raw = envTrim('OFS_TECH_CANDIDATES');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normalizeCandidate).filter(Boolean);
  } catch (err) {
    console.warn('[OFS] OFS_TECH_CANDIDATES inválido (JSON):', err.message || err);
    return null;
  }
}

function resolveOfsTechCandidates(cfg = {}, envName) {
  const fromEnv = parseCandidatesFromEnv();
  if (fromEnv?.length) return fromEnv;

  const fileList = Array.isArray(cfg.tech_candidates) ? cfg.tech_candidates : [];
  const fromFile = fileList.map(normalizeCandidate).filter(Boolean);
  if (fromFile.length) return fromFile;

  const name = envName || getEnvName();
  const envDefaults = OFS_TECH_CANDIDATES_BY_ENV[name];
  if (Array.isArray(envDefaults) && envDefaults.length) {
    return envDefaults.map(normalizeCandidate).filter(Boolean);
  }

  const uiDefaults = OFS_UI_DEFAULTS_BY_ENV[name] || OFS_UI_DEFAULTS_BY_ENV.ti;
  const pid = envTrim('OFS_TECH_PID') || cfg.tech_pid || uiDefaults?.tech_pid || '';
  const search = envTrim('OFS_TECH_SEARCH') || cfg.tech_search || uiDefaults?.tech_search || '';
  if (pid || search) {
    return [{ pid, search, label: search || pid }];
  }
  return [];
}

function describeTechCandidate(candidate = {}, index = 0) {
  const label = candidate.label || candidate.search || candidate.pid || `técnico #${index + 1}`;
  const pid = candidate.pid ? `pid=${candidate.pid}` : 'pid=auto';
  const search = candidate.search ? `search="${candidate.search}"` : '';
  return `${label} (${[pid, search].filter(Boolean).join(', ')})`;
}

module.exports = {
  normalizeCandidate,
  resolveOfsTechCandidates,
  describeTechCandidate,
};
