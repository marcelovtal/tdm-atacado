import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { config } from './config.js';
import { logDb, logDbSave } from './monitor.js';
import {
  initMysqlDatabase,
  saveJobExecutionMysql,
  listRecentJobExecutionsMysql,
  listRecentJobExecutionsSummaryMysql,
  getJobExecutionByJobIdMysql,
  getJobExecutionByIdMysql,
  getDashboardAggregatesMysql,
} from './database/mysqlStore.js';

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

  for (const col of ['mass_type_label', 'error_message', 'stdout', 'stderr']) {
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
        user_code, status, duration_ms, error_message, stdout, stderr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.jobId,
      payload.massTypeLabel,
      payload.orderNumber,
      payload.environment,
      payload.executedAt,
      payload.userCode,
      payload.status,
      payload.durationMs,
      payload.errorMessage,
      payload.stdout,
      payload.stderr,
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
      ORDER BY datetime(executed_at) DESC
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
      ORDER BY datetime(executed_at) DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

export async function getJobExecutionByJobId(jobId) {
  if (!initialized) await initDatabase();
  if (useMysql) return getJobExecutionByJobIdMysql(jobId);
  if (jobId == null || String(jobId).trim() === '') return null;
  return get(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message, stdout, stderr
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
             user_code, status, duration_ms, error_message, stdout, stderr
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
        ORDER BY datetime(executed_at) DESC
        LIMIT 100
      )
    `,
    params
  );

  const byDay = await all(
    `
      SELECT date(executed_at) AS day, COUNT(*) AS count
      FROM job_executions
      WHERE datetime(executed_at) >= datetime('now', '-6 days') ${clause}
      GROUP BY date(executed_at)
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
      LIMIT 12
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
  };
}

export async function getDashboardAggregates(userCode = null) {
  if (!initialized) await initDatabase();
  if (useMysql) return getDashboardAggregatesMysql(userCode);
  return getDashboardAggregatesSqlite(userCode);
}
