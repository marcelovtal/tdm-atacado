import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { logDb, logDbSave } from './monitor.js';
import {
  initMysqlDatabase,
  saveJobExecutionMysql,
  listRecentJobExecutionsMysql,
  listRecentJobExecutionsSummaryMysql,
  listJobExecutionsForJobsPanelMysql,
  listJobExecutionOwnersForPanelMysql,
  getJobExecutionByJobIdMysql,
  getJobExecutionByIdMysql,
  getDashboardAggregatesMysql,
  getUserExecutionSeqForExecutionMysql,
  insertScheduledJobMysql,
  listScheduledJobsMysql,
  getDueScheduledJobsMysql,
  claimScheduledJobMysql,
  completeScheduledJobMysql,
  failScheduledJobMysql,
  resetStuckScheduledJobsMysql,
  getScheduledJobByIdMysql,
  cancelScheduledJobByIdMysql,
  insertReservationMysql,
  getReservationForDateMysql,
  listReservationsMysql,
  getReservationByIdMysql,
  deleteReservationByIdMysql,
  getReservationHolderMysql,
} from './database/mysqlStore.js';
import { SQLITE_EXECUTED_AT_DT, toSqliteDatetimeParam } from './database/datetime.js';
import {
  buildJobsPanelHistoryColumnsSqlite,
  normalizeJobsPanelHistoryOptions,
  buildUserExecutionSeqSelectSqlite,
} from './database/jobsPanelHistory.js';
import { LEGACY_USER_ERROR_WHERE } from './dashboardUserErrorSql.js';
import { verifyJobExecutionsSchema } from './database/jobExecutionsSchema.js';

const useMysql = config.database.driver === 'mysql';

let db = null;
let initialized = false;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function initSqliteDatabase() {
  let sqlite3;
  try {
    ({ default: sqlite3 } = await import('sqlite3'));
  } catch (err) {
    throw new Error(
      'SQLite indisponível neste ambiente (pacote sqlite3 não instalado). Em QA/OpenShift use DATABASE_DRIVER=mysql.',
      { cause: err }
    );
  }
  const DB_PATH = config.database.sqlitePath;
  const DB_DIR = path.dirname(DB_PATH);
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new sqlite3.Database(DB_PATH);

  await run(`
    CREATE TABLE IF NOT EXISTS job_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      mass_type_label TEXT,
      order_number TEXT,
      environment TEXT NOT NULL,
      executed_at TEXT NOT NULL,
      user_code TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      error_message TEXT,
      stdout TEXT,
      stderr TEXT
    )
  `);

  for (const col of ['mass_type_label', 'error_message', 'stdout', 'stderr', 'result_json']) {
    try {
      await run(`ALTER TABLE job_executions ADD COLUMN ${col} TEXT`);
    } catch (err) {
      if (!String(err?.message || '').includes('duplicate column name')) {
        throw err;
      }
    }
  }

  await run(`CREATE INDEX IF NOT EXISTS idx_job_executions_executed_at ON job_executions(executed_at DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_job_executions_order_number ON job_executions(order_number)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_job_executions_job_id ON job_executions(job_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mass_type_id TEXT NOT NULL,
      mass_type_label TEXT,
      environment TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      extra_env TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by_vt TEXT,
      created_at TEXT NOT NULL,
      triggered_at TEXT,
      triggered_job_ids TEXT,
      last_error TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status_at ON scheduled_jobs(status, scheduled_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_created_by ON scheduled_jobs(created_by_vt)`);
  try {
    await run(`ALTER TABLE scheduled_jobs ADD COLUMN mass_types_json TEXT`);
  } catch (err) {
    if (!String(err?.message || '').includes('duplicate column name')) {
      throw err;
    }
  }

  await run(`
    CREATE TABLE IF NOT EXISTS environment_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment TEXT NOT NULL,
      reserved_date TEXT NOT NULL,
      vt TEXT NOT NULL,
      created_by_vt TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(environment, reserved_date)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_env_reservation_date ON environment_reservations(reserved_date)`);

  const schemaCheck = await verifyJobExecutionsSchema({
    driver: 'sqlite',
    getColumns: async () => {
      const rows = await all('PRAGMA table_info(job_executions)');
      return rows.map((r) => r.name);
    },
  });
  if (schemaCheck.ok) {
    console.log('[DB] job_executions: schema SQLite OK (status aceita user_error sem ALTER)');
  }
}

export async function initDatabase() {
  if (initialized) return;
  if (useMysql) {
    await initMysqlDatabase();
    console.log(
      `[DB] MySQL ${config.database.mysql.host}:${config.database.mysql.port}/${config.database.mysql.database} (datetime MySQL format v2)`
    );
    logDb('init', 'MySQL inicializado', {
      host: config.database.mysql.host,
      port: config.database.mysql.port,
      database: config.database.mysql.database,
      table: 'job_executions',
    });
  } else {
    await initSqliteDatabase();
    console.log(`[DB] SQLite ${config.database.sqlitePath}`);
    logDb('init', 'SQLite inicializado', { path: config.database.sqlitePath, table: 'job_executions' });
  }
  initialized = true;
}

export function getDatabaseDriver() {
  return useMysql ? 'mysql' : 'sqlite';
}

export async function saveJobExecution(row) {
  if (!initialized) await initDatabase();
  const payload = {
    jobId: row.jobId ?? null,
    massTypeLabel: row.massTypeLabel ?? null,
    orderNumber: row.orderNumber ?? null,
    environment: row.environment || 'ti',
    executedAt: row.executedAt ?? new Date(),
    userCode: row.userCode ?? null,
    status: row.status || 'unknown',
    durationMs: row.durationMs ?? null,
    errorMessage: row.errorMessage ?? null,
    stdout: row.stdout ?? null,
    stderr: row.stderr ?? null,
    resultJson: row.resultJson ?? null,
  };

  if (useMysql) {
    const { insertId, executedAt } = await saveJobExecutionMysql(payload);
    logDbSave({ ...payload, executedAt }, { insertId, driver: 'mysql' });
    return;
  }

  const result = await run(
    `
      INSERT INTO job_executions (
        job_id, mass_type_label, order_number, environment, executed_at,
        user_code, status, duration_ms, error_message, stdout, stderr, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.jobId,
      payload.massTypeLabel,
      payload.orderNumber,
      payload.environment,
      toSqliteDatetimeParam(payload.executedAt),
      payload.userCode,
      payload.status,
      payload.durationMs,
      payload.errorMessage,
      payload.stdout,
      payload.stderr,
      payload.resultJson,
    ]
  );
  logDbSave(payload, { lastID: result?.lastID, driver: 'sqlite' });
}

export async function listRecentJobExecutions(limit = 100) {
  if (!initialized) await initDatabase();
  if (useMysql) return listRecentJobExecutionsMysql(limit);
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));
  return all(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message, stdout, stderr
      FROM job_executions
      ORDER BY ${SQLITE_EXECUTED_AT_DT} DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

export async function listRecentJobExecutionsSummary(limit = 100) {
  if (!initialized) await initDatabase();
  if (useMysql) return listRecentJobExecutionsSummaryMysql(limit);
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));
  return all(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message
      FROM job_executions
      ORDER BY ${SQLITE_EXECUTED_AT_DT} DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

/** Histórico para a tela Jobs — SQLite (local). Filtro 7d/30d + VT; dashboard inalterado. */
export async function listJobExecutionsForJobsPanel(options = {}) {
  if (!initialized) await initDatabase();
  if (useMysql) {
    return listJobExecutionsForJobsPanelMysql(options);
  }

  const { userCode, days, limit } = normalizeJobsPanelHistoryOptions(options);
  const params = [];
  let userClause = '';
  if (userCode) {
    userClause = 'AND UPPER(user_code) = UPPER(?)';
    params.push(userCode);
  }
  params.push(limit);

  return all(
    `
      SELECT * FROM (
        SELECT ${buildJobsPanelHistoryColumnsSqlite()},
          ${buildUserExecutionSeqSelectSqlite(SQLITE_EXECUTED_AT_DT)}
        FROM job_executions
        WHERE ${SQLITE_EXECUTED_AT_DT} >= datetime('now', '-${days} days')
        ${userClause}
      ) ranked
      ORDER BY ${SQLITE_EXECUTED_AT_DT} DESC
      LIMIT ?
    `,
    params
  );
}

/** Número da execução do usuário (1ª, 2ª, …) dentro da janela de dias. */
export async function getUserExecutionSeqForExecution(row, days = 7) {
  if (!initialized) await initDatabase();
  if (!row?.id) return null;
  const safeDays = days === 30 ? 30 : 7;
  if (useMysql) {
    return getUserExecutionSeqForExecutionMysql(row, safeDays);
  }
  const ranked = await get(
    `
      SELECT user_execution_seq FROM (
        SELECT id,
          ${buildUserExecutionSeqSelectSqlite(SQLITE_EXECUTED_AT_DT)}
        FROM job_executions
        WHERE ${SQLITE_EXECUTED_AT_DT} >= datetime('now', '-${safeDays} days')
      ) ranked
      WHERE id = ?
      LIMIT 1
    `,
    [row.id]
  );
  const n = ranked?.user_execution_seq;
  return n != null ? Number(n) : null;
}

/** VTs distintos no histórico (filtro admin na tela Jobs). SQLite / MySQL. */
export async function listJobExecutionOwnersForPanel(options = {}) {
  if (!initialized) await initDatabase();
  if (useMysql) return listJobExecutionOwnersForPanelMysql(options);

  const { days } = normalizeJobsPanelHistoryOptions(options);
  const rows = await all(
    `
      SELECT DISTINCT user_code
      FROM job_executions
      WHERE user_code IS NOT NULL AND TRIM(user_code) <> ''
        AND ${SQLITE_EXECUTED_AT_DT} >= datetime('now', '-${days} days')
      ORDER BY user_code ASC
    `
  );
  return rows.map((r) => r.user_code).filter(Boolean);
}

export async function getJobExecutionByJobId(jobId) {
  if (!initialized) await initDatabase();
  if (useMysql) return getJobExecutionByJobIdMysql(jobId);
  if (jobId == null || String(jobId).trim() === '') return null;
  return get(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message, stdout, stderr, result_json
      FROM job_executions
      WHERE job_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [String(jobId)]
  );
}

export async function getJobExecutionById(id) {
  if (!initialized) await initDatabase();
  if (useMysql) return getJobExecutionByIdMysql(id);
  return get(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message, stdout, stderr, result_json
      FROM job_executions
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );
}

async function getDashboardAggregatesSqlite(userCode = null) {
  const params = [];
  let clause = '';
  if (userCode) {
    clause = 'AND user_code = ?';
    params.push(userCode);
  }

  const totalRow = await get(`SELECT COUNT(*) AS total FROM job_executions WHERE 1=1 ${clause}`, params);

  const avgRow = await get(
    `
      SELECT AVG(duration_ms) AS avgMs, COUNT(*) AS sampleSize
      FROM (
        SELECT duration_ms FROM job_executions
        WHERE duration_ms IS NOT NULL ${clause}
        ORDER BY ${SQLITE_EXECUTED_AT_DT} DESC
        LIMIT 100
      )
    `,
    params
  );

  const byDay = await all(
    `
      SELECT date(${SQLITE_EXECUTED_AT_DT}) AS day, COUNT(*) AS count
      FROM job_executions
      WHERE ${SQLITE_EXECUTED_AT_DT} >= datetime('now', '-6 days') ${clause}
      GROUP BY date(${SQLITE_EXECUTED_AT_DT})
      ORDER BY day ASC
    `,
    params
  );

  const byMassType = await all(
    `
      SELECT COALESCE(NULLIF(TRIM(mass_type_label), ''), 'Sem tipo') AS label, COUNT(*) AS count
      FROM job_executions
      WHERE 1=1 ${clause}
      GROUP BY label
      ORDER BY count DESC
    `,
    params
  );

  const topUsers = userCode
    ? []
    : await all(
        `
          SELECT user_code, COUNT(*) AS count
          FROM job_executions
          WHERE user_code IS NOT NULL AND TRIM(user_code) <> ''
          GROUP BY user_code
          ORDER BY count DESC
          LIMIT 10
        `
      );

  const statusRows = await all(
    `SELECT status, COUNT(*) AS count FROM job_executions WHERE 1=1 ${clause} GROUP BY status`,
    params
  );

  const criticalRow = await get(
    `
      SELECT COUNT(*) AS criticalFailures
      FROM job_executions
      WHERE status = 'failed' AND error_message IS NOT NULL AND TRIM(error_message) <> '' ${clause}
    `,
    params
  );

  const legacyUserErrorRow = await get(
    `
      SELECT COUNT(*) AS legacyUserErrors
      FROM job_executions
      WHERE status = 'failed' ${clause}
        AND ${LEGACY_USER_ERROR_WHERE}
    `,
    params
  );

  const statusCounts = {};
  for (const row of statusRows) {
    statusCounts[row.status] = Number(row.count) || 0;
  }

  return {
    total: Number(totalRow?.total) || 0,
    avgDurationMs: avgRow?.avgMs != null ? Math.round(Number(avgRow.avgMs)) : null,
    avgDurationSampleSize: Number(avgRow?.sampleSize) || 0,
    byDay,
    byMassType,
    topUsers,
    statusCounts,
    criticalFailures: Number(criticalRow?.criticalFailures) || 0,
    legacyUserErrors: Number(legacyUserErrorRow?.legacyUserErrors) || 0,
  };
}

export async function getDashboardAggregates(userCode = null) {
  if (!initialized) await initDatabase();
  if (useMysql) return getDashboardAggregatesMysql(userCode);
  return getDashboardAggregatesSqlite(userCode);
}

/* ===================== Agendamentos (scheduled_jobs) ===================== */

/** SQLite: scheduled_at é gravado em ISO (UTC); normaliza para comparar com datetime('now') (UTC). */
const SQLITE_SCHEDULED_AT_DT = `datetime(replace(substr(replace(scheduled_at, 'Z', ''), 1, 19), 'T', ' '))`;

export async function createScheduledJob(p) {
  if (!initialized) await initDatabase();
  const massTypes = Array.isArray(p.massTypes) && p.massTypes.length ? p.massTypes : null;
  const payload = {
    massTypeId: p.massTypeId,
    massTypeLabel: p.massTypeLabel ?? null,
    massTypesJson: massTypes ? JSON.stringify(massTypes) : null,
    environment: p.environment || 'ti',
    quantity: Math.max(1, parseInt(p.quantity, 10) || 1),
    extraEnvJson: JSON.stringify(p.extraEnv || {}),
    scheduledAt: p.scheduledAt,
    createdByVt: p.createdByVt ?? null,
  };
  if (useMysql) {
    return insertScheduledJobMysql(payload);
  }
  const result = await run(
    `
      INSERT INTO scheduled_jobs (
        mass_type_id, mass_type_label, mass_types_json, environment, quantity, extra_env,
        scheduled_at, status, created_by_vt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `,
    [
      payload.massTypeId,
      payload.massTypeLabel,
      payload.massTypesJson,
      payload.environment,
      payload.quantity,
      payload.extraEnvJson,
      toSqliteDatetimeParam(payload.scheduledAt),
      payload.createdByVt,
      toSqliteDatetimeParam(new Date()),
    ],
  );
  return { id: result?.lastID ?? null };
}

export async function listScheduledJobs(options = {}) {
  if (!initialized) await initDatabase();
  const { userCode = null, isAdmin = false, limit = 200 } = options;
  if (useMysql) return listScheduledJobsMysql({ userCode, isAdmin, limit });
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 200));
  const params = [];
  let clause = '';
  if (!isAdmin && userCode) {
    clause = 'WHERE UPPER(created_by_vt) = UPPER(?)';
    params.push(userCode);
  }
  params.push(safeLimit);
  return all(
    `SELECT * FROM scheduled_jobs ${clause} ORDER BY ${SQLITE_SCHEDULED_AT_DT} DESC LIMIT ?`,
    params,
  );
}

export async function getDueScheduledJobs(limit = 20) {
  if (!initialized) await initDatabase();
  if (useMysql) return getDueScheduledJobsMysql(limit);
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  return all(
    `
      SELECT * FROM scheduled_jobs
      WHERE status = 'pending' AND ${SQLITE_SCHEDULED_AT_DT} <= datetime('now')
      ORDER BY ${SQLITE_SCHEDULED_AT_DT} ASC
      LIMIT ?
    `,
    [safeLimit],
  );
}

export async function claimScheduledJob(id) {
  if (!initialized) await initDatabase();
  if (useMysql) return claimScheduledJobMysql(id);
  const result = await run(
    `UPDATE scheduled_jobs SET status = 'processing', triggered_at = ? WHERE id = ? AND status = 'pending'`,
    [toSqliteDatetimeParam(new Date()), id],
  );
  return (result?.changes ?? 0) === 1;
}

export async function completeScheduledJob(id, jobIds = []) {
  if (!initialized) await initDatabase();
  const jobIdsJson = JSON.stringify(Array.isArray(jobIds) ? jobIds.map(String) : []);
  if (useMysql) return completeScheduledJobMysql(id, jobIdsJson);
  await run(
    `UPDATE scheduled_jobs SET status = 'done', triggered_job_ids = ?, last_error = NULL WHERE id = ?`,
    [jobIdsJson, id],
  );
}

export async function failScheduledJob(id, errorMessage) {
  if (!initialized) await initDatabase();
  if (useMysql) return failScheduledJobMysql(id, errorMessage ?? null);
  await run(`UPDATE scheduled_jobs SET status = 'error', last_error = ? WHERE id = ?`, [
    errorMessage ?? null,
    id,
  ]);
}

export async function resetStuckScheduledJobs(minutes = 10) {
  if (!initialized) await initDatabase();
  if (useMysql) return resetStuckScheduledJobsMysql(minutes);
  const m = Math.max(1, parseInt(minutes, 10) || 10);
  await run(
    `UPDATE scheduled_jobs SET status = 'pending'
     WHERE status = 'processing' AND ${SQLITE_SCHEDULED_AT_DT.replace('scheduled_at', 'triggered_at')} < datetime('now', '-${m} minutes')`,
  );
}

export async function getScheduledJobById(id) {
  if (!initialized) await initDatabase();
  if (useMysql) return getScheduledJobByIdMysql(id);
  return get(`SELECT * FROM scheduled_jobs WHERE id = ? LIMIT 1`, [id]);
}

export async function cancelScheduledJobById(id) {
  if (!initialized) await initDatabase();
  if (useMysql) return cancelScheduledJobByIdMysql(id);
  const result = await run(
    `UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
    [id],
  );
  return (result?.changes ?? 0) === 1;
}

/* ===================== Reserva de ambiente ===================== */

export async function createReservation(p) {
  if (!initialized) await initDatabase();
  const payload = {
    environment: p.environment,
    reservedDate: p.reservedDate,
    vt: p.vt,
    createdByVt: p.createdByVt ?? p.vt,
  };
  if (useMysql) return insertReservationMysql(payload);
  const result = await run(
    `INSERT INTO environment_reservations (environment, reserved_date, vt, created_by_vt, created_at) VALUES (?, ?, ?, ?, ?)`,
    [payload.environment, payload.reservedDate, payload.vt, payload.createdByVt, toSqliteDatetimeParam(new Date())],
  );
  return { id: result?.lastID ?? null };
}

export async function getReservationForDate(environment, reservedDate) {
  if (!initialized) await initDatabase();
  if (useMysql) return getReservationForDateMysql(environment, reservedDate);
  return get(
    `SELECT id, environment, reserved_date, vt, created_by_vt, created_at
     FROM environment_reservations WHERE environment = ? AND reserved_date = ? LIMIT 1`,
    [environment, reservedDate],
  );
}

export async function listReservations(fromDate) {
  if (!initialized) await initDatabase();
  if (useMysql) return listReservationsMysql(fromDate);
  return all(
    `SELECT id, environment, reserved_date, vt, created_by_vt, created_at
     FROM environment_reservations WHERE reserved_date >= ? ORDER BY reserved_date ASC, environment ASC`,
    [fromDate],
  );
}

export async function getReservationById(id) {
  if (!initialized) await initDatabase();
  if (useMysql) return getReservationByIdMysql(id);
  return get(
    `SELECT id, environment, reserved_date, vt, created_by_vt, created_at
     FROM environment_reservations WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function deleteReservationById(id) {
  if (!initialized) await initDatabase();
  if (useMysql) return deleteReservationByIdMysql(id);
  const result = await run(`DELETE FROM environment_reservations WHERE id = ?`, [id]);
  return (result?.changes ?? 0) === 1;
}

export async function getReservationHolder(environment, reservedDate) {
  if (!initialized) await initDatabase();
  if (useMysql) return getReservationHolderMysql(environment, reservedDate);
  const row = await get(
    `SELECT vt FROM environment_reservations WHERE environment = ? AND reserved_date = ? LIMIT 1`,
    [environment, reservedDate],
  );
  return row?.vt ?? null;
}
