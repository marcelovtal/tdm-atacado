import { saveJobExecution } from './database.js';

/**
 * Grava histórico no banco sem derrubar o job se o script já terminou.
 * @returns {{ ok: boolean, error?: string }}
 */
export async function persistJobExecution(row) {
  try {
    await saveJobExecution(row);
    return { ok: true };
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[DB] Falha ao gravar job_executions:', message);
    return { ok: false, error: message };
  }
}
