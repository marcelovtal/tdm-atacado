import { canSeeAllJobs } from './auth/platformAdmin.js';
import { normalizeVt } from './auth/vt.js';
import { countActiveSessions, touchActiveSession } from './auth/session.js';
import { getDashboardAggregates } from './database.js';

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Chave YYYY-MM-DD no fuso local (evita deslocamento UTC do toISOString). */
function localDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date).slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeDayFromRow(row) {
  const raw = row?.day;
  if (raw == null) return null;
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const day = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(raw);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return localDateKey(s);
}

function fillLast7Days(byDayRows) {
  const map = new Map();
  for (const row of byDayRows || []) {
    const key = normalizeDayFromRow(row);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + (Number(row.count) || 0));
  }
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = localDateKey(d);
    out.push({
      date: iso,
      label: `${WEEKDAY[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      count: map.get(iso) || 0,
    });
  }
  return out;
}

const CHART_COLORS = ['#38bdf8', '#14b8a6', '#f59e0b', '#a855f7', '#2563eb', '#22c55e', '#ef4444', '#ec4899'];

export async function buildDashboardStats(viewer) {
  const seeAll = canSeeAllJobs(viewer);
  const userCode = seeAll ? null : normalizeVt(viewer?.vt);

  if (viewer?.vt) touchActiveSession(viewer.vt);

  const raw = await getDashboardAggregates(userCode);

  const success = Number(raw.statusCounts?.completed) || 0;
  const failed = Number(raw.statusCounts?.failed) || 0;
  const cancelled = Number(raw.statusCounts?.cancelled) || 0;
  const total = Number(raw.total) || 0;
  const measured = success + failed;
  const successRate = measured > 0 ? Math.round((success / measured) * 100) : 0;

  const byMassType = (raw.byMassType || []).map((row, i) => ({
    label: row.label || 'Sem tipo',
    count: Number(row.count) || 0,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const topUsers = seeAll
    ? (raw.topUsers || []).map((row) => ({
        vt: normalizeVt(row.user_code) || row.user_code || '—',
        count: Number(row.count) || 0,
      }))
    : userCode
      ? [{ vt: userCode, count: total }]
      : [];

  return {
    scope: seeAll ? 'all' : 'user',
    overview: {
      avgDurationMs: raw.avgDurationMs != null ? Number(raw.avgDurationMs) : null,
      avgDurationSampleSize: Number(raw.avgDurationSampleSize) || 0,
      activeSessions: countActiveSessions(),
      totalExecutions: total,
    },
    byDay: fillLast7Days(raw.byDay),
    byMassType,
    topUsers,
    results: {
      success,
      failed,
      cancelled,
      successRate,
      avgDurationMs: raw.avgDurationMs != null ? Number(raw.avgDurationMs) : null,
      total,
      criticalFailures: Number(raw.criticalFailures) || failed,
    },
  };
}
