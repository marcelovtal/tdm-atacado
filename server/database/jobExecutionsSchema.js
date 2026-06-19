/**
 * Schema canônico de job_executions — SQLite (local) e MySQL (produção/QA).
 * Alterações de coluna devem ser aplicadas nos dois drivers (database.js + mysqlStore.js).
 */

/** Valores gravados em job_executions.status */
export const JOB_EXECUTION_STATUSES = [
  'completed',
  'failed',
  'user_error',
  'cancelled',
  'unknown',
];

export const JOB_EXECUTIONS_COLUMNS = [
  { name: 'id', sqlite: 'INTEGER PK', mysql: 'INT AUTO_INCREMENT PK' },
  { name: 'job_id', sqlite: 'TEXT', mysql: 'VARCHAR(128)' },
  { name: 'mass_type_label', sqlite: 'TEXT', mysql: 'VARCHAR(255)' },
  { name: 'order_number', sqlite: 'TEXT', mysql: 'VARCHAR(128)' },
  { name: 'environment', sqlite: 'TEXT NOT NULL', mysql: 'VARCHAR(32) NOT NULL' },
  { name: 'executed_at', sqlite: 'TEXT NOT NULL', mysql: 'DATETIME(3) NOT NULL' },
  { name: 'user_code', sqlite: 'TEXT', mysql: 'VARCHAR(128)' },
  { name: 'status', sqlite: 'TEXT NOT NULL', mysql: 'VARCHAR(32) NOT NULL' },
  { name: 'duration_ms', sqlite: 'INTEGER', mysql: 'INT' },
  { name: 'error_message', sqlite: 'TEXT', mysql: 'TEXT' },
  { name: 'stdout', sqlite: 'TEXT', mysql: 'LONGTEXT' },
  { name: 'stderr', sqlite: 'TEXT', mysql: 'LONGTEXT' },
  { name: 'result_json', sqlite: 'TEXT', mysql: 'LONGTEXT' },
];

const REQUIRED_COLUMN_NAMES = JOB_EXECUTIONS_COLUMNS.map((c) => c.name).filter((n) => n !== 'id');

/** SQL manual para conferir MySQL em produção (sem migration obrigatória para user_error). */
export const MYSQL_VERIFY_QUERIES = `
-- Colunas esperadas
SHOW COLUMNS FROM job_executions;

-- Distribuição de status (inclui user_error após deploy do código novo)
SELECT status, COUNT(*) AS total FROM job_executions GROUP BY status ORDER BY total DESC;

-- Jobs antigos failed que o dashboard reclassifica como erro do usuário
SELECT COUNT(*) AS legacy_user_errors
FROM job_executions
WHERE status = 'failed'
  AND (
    error_message LIKE '%Conta da massa pronta%não existe%'
    OR error_message LIKE '%GET Org (massa pronta)%'
  );
`.trim();

export async function verifyJobExecutionsSchema({ driver, getColumns }) {
  const existing = new Set(await getColumns());
  const missing = REQUIRED_COLUMN_NAMES.filter((col) => !existing.has(col));
  if (missing.length) {
    console.warn(
      `[DB] job_executions incompleta (${driver}): faltam colunas ${missing.join(', ')}. Reinicie a API para rodar ALTER automático ou aplique manualmente.`,
    );
    return { ok: false, missing };
  }
  return { ok: true, missing: [] };
}
