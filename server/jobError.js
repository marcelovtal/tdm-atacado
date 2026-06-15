/** Estados em que o job já terminou — único momento em que erro deve ir ao painel. */
export function isTerminalJobState(state) {
  const s = String(state || '').toLowerCase();
  return s === 'failed' || s === 'completed' || s === 'cancelled';
}

export function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

/** Remove avisos Node (ex. NODE_TLS_REJECT_UNAUTHORIZED) e códigos ANSI do texto exibido ao usuário. */
export function sanitizeJobErrorMessage(msg) {
  if (msg == null || msg === '') return null;
  let s = stripAnsi(msg);
  s = s
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/NODE_TLS_REJECT_UNAUTHORIZED/i.test(line))
    .filter((line) => !/^\(node:\d+\)\s*Warning:/i.test(line))
    .join('\n')
    .trim();
  return s || null;
}

/** Evita misturar histórico SQLite de execução anterior com o mesmo job_id (ex. fila em memória reiniciada). */
export function dbExecutionMatchesJobRun(row, job) {
  if (!row || !job) return false;
  const rowTs = row.executed_at ? Date.parse(row.executed_at) : 0;
  const runStart = job.processedOn || job.timestamp || 0;
  if (!rowTs || !runStart) return false;
  return rowTs >= runStart - 2000;
}
