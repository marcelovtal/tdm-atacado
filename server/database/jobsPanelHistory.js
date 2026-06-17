/**
 * Parâmetros compartilhados da listagem de histórico na tela Jobs.
 * Usado por SQLite (local) e MySQL (QA/produção) — não afeta getDashboardAggregates.
 */

export const USER_EXECUTION_PARTITION = `COALESCE(NULLIF(TRIM(user_code), ''), '__anonymous__')`;

/** Sequência 1-based por VT no período (ORDER BY executed_at ASC). */
export function buildUserExecutionSeqSelectSqlite(executedAtDtExpr) {
  return `ROW_NUMBER() OVER (
    PARTITION BY ${USER_EXECUTION_PARTITION}
    ORDER BY ${executedAtDtExpr} ASC, id ASC
  ) AS user_execution_seq`;
}

export function buildUserExecutionSeqSelectMysql() {
  return `ROW_NUMBER() OVER (
    PARTITION BY ${USER_EXECUTION_PARTITION}
    ORDER BY executed_at ASC, id ASC
  ) AS user_execution_seq`;
}

export const JOBS_PANEL_HISTORY_COLUMNS = `
  id, job_id, mass_type_label, order_number, environment, executed_at,
  user_code, status, duration_ms, error_message, result_json
`.trim();

/** Últimos ~16KB do log — suficiente para FDL_PANEL_SNAPSHOT e *** PEDIDO GERADO ***. */
export function buildJobsPanelHistoryColumnsSqlite() {
  return `${JOBS_PANEL_HISTORY_COLUMNS}, substr(COALESCE(stdout, '') || char(10) || COALESCE(stderr, ''), -16384) AS stdout`;
}

export function buildJobsPanelHistoryColumnsMysql() {
  return `${JOBS_PANEL_HISTORY_COLUMNS}, RIGHT(CONCAT(IFNULL(stdout, ''), CHAR(10), IFNULL(stderr, '')), 16384) AS stdout`;
}

/** Aceita só 7 ou 30 dias (usuário normal vs admin). */
export function normalizeJobsPanelHistoryOptions({ userCode = null, days = 7, limit = 500 } = {}) {
  return {
    userCode: userCode ? String(userCode).trim() : null,
    days: days === 30 ? 30 : 7,
    limit: Math.max(1, Math.min(1000, parseInt(limit, 10) || 500)),
  };
}

/** Converte executed_at do banco (ISO, DATETIME ou epoch ms legado) para timestamp ms. */
export function parseExecutedAtMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{12,}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}
