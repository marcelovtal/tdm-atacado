import { config } from './config.js';

const MAX_BUFFER = Math.max(50, Math.min(5000, parseInt(process.env.MONITOR_BUFFER_SIZE || '500', 10) || 500));
const REDIS_MONITOR_KEY = 'fdl-vtal:monitor:events';

const buffer = [];
let sharedRedis = null;
let sharedRedisInit = null;

function useSharedRedis() {
  return !config.useMemoryQueue && process.env.USE_MEMORY_QUEUE !== '1';
}

async function getSharedRedis() {
  if (!useSharedRedis()) return null;
  if (sharedRedis) return sharedRedis;
  if (!sharedRedisInit) {
    sharedRedisInit = (async () => {
      try {
        const { createRedisClient } = await import('./redisConnection.js');
        const client = createRedisClient({ maxRetriesPerRequest: 3 });
        await client.ping();
        sharedRedis = client;
        return client;
      } catch {
        sharedRedis = null;
        return null;
      }
    })();
  }
  return sharedRedisInit;
}

function enabled() {
  const v = process.env.LOG_MONITOR;
  if (v == null || v === '') return true;
  return v === '1' || v === 'true' || v === 'yes';
}

function ts() {
  return new Date().toISOString();
}

function truncate(str, max = 280) {
  if (str == null) return null;
  const s = String(str);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (${s.length} chars)`;
}

/** Resumo seguro do payload do job (sem stdout completo). */
export function summarizeJobData(data = {}) {
  if (!data || typeof data !== 'object') return {};
  return {
    massTypeId: data.massTypeId ?? null,
    massTypeLabel: data.massTypeLabel ?? null,
    script: data.script ?? null,
    environment: data.environment ?? null,
    envVarKeys: data.envVars && typeof data.envVars === 'object' ? Object.keys(data.envVars) : [],
  };
}

async function persistShared(entry) {
  const redis = await getSharedRedis();
  if (!redis) return;
  try {
    const payload = JSON.stringify({ ...entry, source: process.env.MONITOR_PROCESS || 'app' });
    await redis.lpush(REDIS_MONITOR_KEY, payload);
    await redis.ltrim(REDIS_MONITOR_KEY, 0, MAX_BUFFER - 1);
  } catch (err) {
    console.warn('[Monitor] Falha ao gravar evento no Redis:', err.message);
  }
}

function push(channel, event, message, data = {}) {
  const entry = {
    id: `${Date.now()}-${buffer.length}`,
    at: ts(),
    channel,
    event,
    message,
    data,
    profile: config.profile,
  };

  buffer.push(entry);
  while (buffer.length > MAX_BUFFER) buffer.shift();

  void persistShared(entry);

  if (!enabled()) return entry;

  const prefix = channel === 'redis' ? '[Monitor][Redis]' : '[Monitor][DB]';
  const detail = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`${prefix} ${event} — ${message}${detail}`);

  return entry;
}

export function logRedis(event, message, data = {}) {
  return push('redis', event, message, data);
}

export function logDb(event, message, data = {}) {
  return push('db', event, message, data);
}

export function logRedisJob(event, message, jobId, jobData = {}, extra = {}) {
  return logRedis(event, message, {
    jobId: jobId != null ? String(jobId) : null,
    queue: 'fdl-vtal-mass',
    ...summarizeJobData(jobData),
    ...extra,
  });
}

export function logDbSave(row, extra = {}) {
  return logDb('save', 'Registro gravado em job_executions', {
    jobId: row.jobId ?? null,
    dbId: extra.insertId ?? extra.lastID ?? null,
    driver: extra.driver ?? config.database.driver,
    table: 'job_executions',
    massTypeLabel: row.massTypeLabel ?? null,
    orderNumber: row.orderNumber ?? null,
    environment: row.environment ?? 'ti',
    status: row.status ?? null,
    durationMs: row.durationMs ?? null,
    executedAt: row.executedAt ?? null,
    errorPreview: truncate(row.errorMessage, 200),
    stdoutBytes: row.stdout != null ? String(row.stdout).length : 0,
    stderrBytes: row.stderr != null ? String(row.stderr).length : 0,
  });
}

function filterEvents(list, { channel, since }) {
  let out = list;
  if (channel === 'redis' || channel === 'db') {
    out = out.filter((e) => e.channel === channel);
  }
  if (since) {
    const t = Date.parse(since);
    if (Number.isFinite(t)) out = out.filter((e) => Date.parse(e.at) >= t);
  }
  return out;
}

function buildStats(list) {
  const stats = {
    total: list.length,
    redis: { total: 0, byEvent: {} },
    db: { total: 0, byEvent: {} },
    lastRedisAt: null,
    lastDbAt: null,
  };
  for (const e of list) {
    const bucket = e.channel === 'redis' ? stats.redis : stats.db;
    bucket.total += 1;
    bucket.byEvent[e.event] = (bucket.byEvent[e.event] || 0) + 1;
    if (e.channel === 'redis') stats.lastRedisAt = e.at;
    if (e.channel === 'db') stats.lastDbAt = e.at;
  }
  return stats;
}

async function loadSharedEvents(limit) {
  const redis = await getSharedRedis();
  if (!redis) return [];
  try {
    const raw = await redis.lrange(REDIS_MONITOR_KEY, 0, limit - 1);
    return raw
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function getMonitorEvents({ channel = null, limit = 100, since = null } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));

  const shared = await loadSharedEvents(MAX_BUFFER);
  const merged = [...shared, ...buffer];
  merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const seen = new Set();
  const unique = [];
  for (const e of merged) {
    const key = `${e.at}|${e.channel}|${e.event}|${e.message}|${e.data?.jobId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }

  return filterEvents(unique, { channel, since }).slice(0, safeLimit);
}

export async function getMonitorStats() {
  const shared = await loadSharedEvents(MAX_BUFFER);
  const merged = [...shared, ...buffer];
  return buildStats(merged);
}

export function getRedisConnectionSummary() {
  const { redis } = config;
  if (redis.mode === 'sentinel') {
    return {
      mode: 'sentinel',
      masterName: redis.masterName,
      sentinels: redis.sentinels,
      queue: 'fdl-vtal-mass',
      monitorKey: REDIS_MONITOR_KEY,
    };
  }
  return {
    mode: 'standalone',
    host: redis.host,
    port: redis.port,
    queue: 'fdl-vtal-mass',
    monitorKey: REDIS_MONITOR_KEY,
  };
}

export function getDatabaseSummary() {
  if (config.database.driver === 'mysql') {
    const m = config.database.mysql;
    return { driver: 'mysql', host: m.host, port: m.port, database: m.database, user: m.user };
  }
  return { driver: 'sqlite', path: config.database.sqlitePath };
}
