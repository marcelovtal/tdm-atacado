import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { toMysqlDatetimeParam } from './datetime.js';
import {
  buildJobsPanelHistoryColumnsMysql,
  normalizeJobsPanelHistoryOptions,
  buildUserExecutionSeqSelectMysql,
} from './jobsPanelHistory.js';
import { LEGACY_USER_ERROR_WHERE } from '../dashboardUserErrorSql.js';
import { verifyJobExecutionsSchema } from './jobExecutionsSchema.js';

let pool = null;

function getPool() {
  if (!pool) {
    const { host, port, user, password, database, connectionLimit } = config.database.mysql;
    const connectTimeout = parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '30000', 10) || 30000;
    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit,
      enableKeepAlive: true,
      connectTimeout,
    });
  }
  return pool;
}

async function run(sql, params = []) {
  const pool = getPool();
  const [result] = await pool.query(sql, params);
  return result;
}

async function all(sql, params = []) {
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function getRow(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS job_executions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(128) NULL,
    mass_type_label VARCHAR(255) NULL,
    order_number VARCHAR(128) NULL,
    environment VARCHAR(32) NOT NULL,
    executed_at DATETIME(3) NOT NULL,
    user_code VARCHAR(128) NULL,
    status VARCHAR(32) NOT NULL,
    duration_ms INT NULL,
    error_message TEXT NULL,
    stdout LONGTEXT NULL,
    stderr LONGTEXT NULL,
    result_json LONGTEXT NULL,
    INDEX idx_job_executions_executed_at (executed_at DESC),
    INDEX idx_job_executions_order_number (order_number),
    INDEX idx_job_executions_job_id (job_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_ACL_TABLE = `
  CREATE TABLE IF NOT EXISTS access_control_users (
    vt VARCHAR(32) NOT NULL PRIMARY KEY,
    dashboard TINYINT(1) NOT NULL DEFAULT 0,
    cancel_jobs TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_MASS_TYPE_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS mass_type_settings (
    mass_type_id VARCHAR(64) NOT NULL PRIMARY KEY,
    active TINYINT(1) NOT NULL DEFAULT 1,
    active_ti TINYINT(1) NOT NULL DEFAULT 1,
    active_trg TINYINT(1) NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

export async function initMysqlDatabase() {
  await run(CREATE_TABLE);
  await run(CREATE_ACL_TABLE);
  await run(CREATE_MASS_TYPE_SETTINGS_TABLE);
  try {
    await run('ALTER TABLE job_executions ADD COLUMN result_json LONGTEXT NULL');
  } catch (err) {
    if (!String(err?.message || '').includes('Duplicate column')) {
      throw err;
    }
  }
  for (const col of ['active_ti', 'active_trg']) {
    try {
      await run(`ALTER TABLE mass_type_settings ADD COLUMN ${col} TINYINT(1) NOT NULL DEFAULT 1`);
    } catch (err) {
      if (!String(err?.message || '').includes('Duplicate column')) {
        throw err;
      }
    }
  }
  try {
    await run(
      'UPDATE mass_type_settings SET active_ti = active, active_trg = active WHERE active_ti IS NOT NULL',
    );
  } catch (_) {
    /* tabela nova ou colunas recém-criadas */
  }

  const schemaCheck = await verifyJobExecutionsSchema({
    driver: 'mysql',
    getColumns: async () => {
      const rows = await all(
        `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_executions'`,
      );
      return rows.map((r) => r.name);
    },
  });
  if (schemaCheck.ok) {
    console.log('[DB] job_executions: schema MySQL OK (status aceita user_error sem ALTER)');
  }
}

export async function saveJobExecutionMysql(row) {
  const executedAt = toMysqlDatetimeParam(row.executedAt);

  const result = await run(
    `
      INSERT INTO job_executions (
        job_id, mass_type_label, order_number, environment, executed_at,
        user_code, status, duration_ms, error_message, stdout, stderr, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.jobId,
      row.massTypeLabel,
      row.orderNumber,
      row.environment,
      executedAt,
      row.userCode,
      row.status,
      row.durationMs,
      row.errorMessage,
      row.stdout,
      row.stderr,
      row.resultJson ?? null,
    ]
  );
  return { insertId: result?.insertId ?? null, executedAt };
}

export async function listRecentJobExecutionsMysql(limit) {
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));
  return all(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message, stdout, stderr
      FROM job_executions
      ORDER BY executed_at DESC
      LIMIT ${safeLimit}
    `
  );
}

export async function listRecentJobExecutionsSummaryMysql(limit) {
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));
  return all(
    `
      SELECT id, job_id, mass_type_label, order_number, environment, executed_at,
             user_code, status, duration_ms, error_message
      FROM job_executions
      ORDER BY executed_at DESC
      LIMIT ${safeLimit}
    `
  );
}

/** Histórico para a tela Jobs — MySQL (QA/produção). Filtro 7d/30d + VT; dashboard inalterado. */
export async function listJobExecutionsForJobsPanelMysql(options = {}) {
  const { userCode, days, limit } = normalizeJobsPanelHistoryOptions(options);
  const params = [];
  let userClause = '';
  if (userCode) {
    userClause = 'AND UPPER(user_code) = UPPER(?)';
    params.push(userCode);
  }

  return all(
    `
      SELECT * FROM (
        SELECT ${buildJobsPanelHistoryColumnsMysql()},
          ${buildUserExecutionSeqSelectMysql()}
        FROM job_executions
        WHERE executed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        ${userClause}
      ) ranked
      ORDER BY executed_at DESC
      LIMIT ${limit}
    `,
    params
  );
}

export async function getUserExecutionSeqForExecutionMysql(row, days = 7) {
  if (row?.id == null) return null;
  const safeDays = days === 30 ? 30 : 7;
  const ranked = await getRow(
    `
      SELECT user_execution_seq FROM (
        SELECT id,
          ${buildUserExecutionSeqSelectMysql()}
        FROM job_executions
        WHERE executed_at >= DATE_SUB(NOW(), INTERVAL ${safeDays} DAY)
      ) ranked
      WHERE id = ?
      LIMIT 1
    `,
    [row.id]
  );
  const n = ranked?.user_execution_seq;
  return n != null ? Number(n) : null;
}

/** VTs distintos no histórico (filtro admin). */
export async function listJobExecutionOwnersForPanelMysql(options = {}) {
  const { days } = normalizeJobsPanelHistoryOptions(options);
  const rows = await all(
    `
      SELECT DISTINCT user_code
      FROM job_executions
      WHERE user_code IS NOT NULL AND TRIM(user_code) <> ''
        AND executed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      ORDER BY user_code ASC
    `
  );
  return rows.map((r) => r.user_code).filter(Boolean);
}

export async function getJobExecutionByJobIdMysql(jobId) {
  if (jobId == null || String(jobId).trim() === '') return null;
  return getRow(
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

export async function getJobExecutionByIdMysql(id) {
  return getRow(
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

export async function listAccessControlUsersMysql() {
  const rows = await all(
    `
      SELECT vt, dashboard, cancel_jobs AS cancelJobs
      FROM access_control_users
      ORDER BY vt ASC
    `
  );
  return rows.map((row) => ({
    vt: row.vt,
    dashboard: !!row.dashboard,
    cancelJobs: !!row.cancelJobs,
  }));
}

export async function replaceAccessControlUsersMysql(users) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM access_control_users');
    for (const row of users) {
      await conn.execute(
        'INSERT INTO access_control_users (vt, dashboard, cancel_jobs) VALUES (?, ?, ?)',
        [row.vt, row.dashboard ? 1 : 0, row.cancelJobs ? 1 : 0]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function listMassTypeSettingsMysql() {
  const rows = await all(
    `
      SELECT mass_type_id AS id, active, active_ti AS activeTi, active_trg AS activeTrg
      FROM mass_type_settings
      ORDER BY mass_type_id ASC
    `
  );
  return rows.map((row) => ({
    id: row.id,
    active: !!row.active,
    activeTi: row.activeTi != null ? !!row.activeTi : !!row.active,
    activeTrg: row.activeTrg != null ? !!row.activeTrg : !!row.active,
  }));
}

export async function replaceMassTypeSettingsMysql(types) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM mass_type_settings');
    for (const row of types) {
      const activeTi = row.activeTi != null ? (row.activeTi ? 1 : 0) : row.active ? 1 : 0;
      const activeTrg = row.activeTrg != null ? (row.activeTrg ? 1 : 0) : row.active ? 1 : 0;
      const activeAny = activeTi || activeTrg ? 1 : 0;
      await conn.execute(
        'INSERT INTO mass_type_settings (mass_type_id, active, active_ti, active_trg) VALUES (?, ?, ?, ?)',
        [row.id, activeAny, activeTi, activeTrg],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function userFilter(userCode) {
  if (!userCode) return { clause: '', params: [] };
  return { clause: 'AND user_code = ?', params: [userCode] };
}

export async function getDashboardAggregatesMysql(userCode = null) {
  const { clause, params } = userFilter(userCode);

  const [totalRow, avgRow, byDay, byMassType, topUsers, statusRows, criticalRow, legacyUserErrorRow] =
    await Promise.all([
    getRow(`SELECT COUNT(*) AS total FROM job_executions WHERE 1=1 ${clause}`, params),
    getRow(
      `
        SELECT AVG(duration_ms) AS avgMs, COUNT(*) AS sampleSize
        FROM (
          SELECT duration_ms FROM job_executions
          WHERE duration_ms IS NOT NULL ${clause}
          ORDER BY executed_at DESC
          LIMIT 100
        ) recent
      `,
      params
    ),
    all(
      `
        SELECT DATE_FORMAT(executed_at, '%Y-%m-%d') AS day, COUNT(*) AS count
        FROM job_executions
        WHERE executed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) ${clause}
        GROUP BY DATE_FORMAT(executed_at, '%Y-%m-%d')
        ORDER BY day ASC
      `,
      params
    ),
    all(
      `
        SELECT COALESCE(NULLIF(TRIM(mass_type_label), ''), 'Sem tipo') AS label, COUNT(*) AS count
        FROM job_executions
        WHERE 1=1 ${clause}
        GROUP BY label
        ORDER BY count DESC
      `,
      params
    ),
    userCode
      ? Promise.resolve([])
      : all(
          `
            SELECT user_code, COUNT(*) AS count
            FROM job_executions
            WHERE user_code IS NOT NULL AND TRIM(user_code) <> ''
            GROUP BY user_code
            ORDER BY count DESC
            LIMIT 10
          `
        ),
    all(
      `
        SELECT status, COUNT(*) AS count
        FROM job_executions
        WHERE 1=1 ${clause}
        GROUP BY status
      `,
      params
    ),
    getRow(
      `
        SELECT COUNT(*) AS criticalFailures
        FROM job_executions
        WHERE status = 'failed' AND error_message IS NOT NULL AND TRIM(error_message) <> '' ${clause}
      `,
      params
    ),
    getRow(
      `
        SELECT COUNT(*) AS legacyUserErrors
        FROM job_executions
        WHERE status = 'failed' ${clause}
          AND ${LEGACY_USER_ERROR_WHERE}
      `,
      params
    ),
  ]);

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
