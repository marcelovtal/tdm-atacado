import {
  getDueScheduledJobs,
  claimScheduledJob,
  completeScheduledJob,
  failScheduledJob,
  resetStuckScheduledJobs,
} from './database.js';
import { getJobDataSchema } from './queue.js';
import { resolveJobPriority } from './jobPriority.js';
import { logRedisJob } from './monitor.js';

const POLL_MS = Math.max(5000, parseInt(process.env.SCHEDULER_POLL_MS || '30000', 10) || 30000);
const STUCK_MINUTES = Math.max(1, parseInt(process.env.SCHEDULER_STUCK_MINUTES || '10', 10) || 10);
const DUE_BATCH = Math.max(1, parseInt(process.env.SCHEDULER_BATCH || '20', 10) || 20);

let timer = null;
let ticking = false;

async function triggerScheduledRow(row, queue) {
  let extraEnv = {};
  try {
    extraEnv = row.extra_env ? JSON.parse(row.extra_env) : {};
  } catch (_) {
    extraEnv = {};
  }
  let massTypes = [];
  try {
    massTypes = row.mass_types_json ? JSON.parse(row.mass_types_json) : [];
  } catch (_) {
    massTypes = [];
  }
  if (!Array.isArray(massTypes) || !massTypes.length) {
    massTypes = [{ id: row.mass_type_id, label: row.mass_type_label || row.mass_type_id }];
  }
  const qty = Math.max(1, parseInt(row.quantity, 10) || 1);
  const priority = await resolveJobPriority(row.environment, row.created_by_vt);
  const jobIds = [];
  for (const massType of massTypes) {
    const massTypeId = massType?.id || massType?.massTypeId;
    if (!massTypeId) continue;
    const data = getJobDataSchema(massTypeId, row.environment, qty, extraEnv, row.created_by_vt);
    for (let i = 0; i < qty; i++) {
      const job = await queue.add(`mass-${massTypeId}-${row.environment}`, data, {
        jobId: undefined,
        priority,
      });
      jobIds.push(String(job.id));
      logRedisJob('enqueue', `Agendamento #${row.id} enfileirou job`, job.id, data, {
        backend: 'scheduler',
        scheduledId: row.id,
        massTypeId,
        priority,
      });
    }
  }
  return jobIds;
}

async function runTick(getQueue) {
  if (ticking) return;
  ticking = true;
  try {
    await resetStuckScheduledJobs(STUCK_MINUTES);
    const due = await getDueScheduledJobs(DUE_BATCH);
    for (const row of due) {
      const claimed = await claimScheduledJob(row.id);
      if (!claimed) continue; // outra instância já pegou
      try {
        const queue = getQueue();
        if (!queue) throw new Error('Fila não inicializada');
        const jobIds = await triggerScheduledRow(row, queue);
        await completeScheduledJob(row.id, jobIds);
        console.log(`[Scheduler] Agendamento #${row.id} disparado — ${jobIds.length} job(s) na fila.`);
      } catch (err) {
        const msg = err?.message || String(err);
        await failScheduledJob(row.id, msg);
        console.error(`[Scheduler] Agendamento #${row.id} falhou ao disparar:`, msg);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Erro no ciclo de verificação:', err?.message || err);
  } finally {
    ticking = false;
  }
}

/**
 * Inicia o agendador: a cada POLL_MS verifica agendamentos vencidos (scheduled_at <= agora)
 * e os enfileira na fila existente. Roda apenas no processo da API (que detém a fila).
 * @param {{ getQueue: () => object|null }} deps
 */
export function startScheduler({ getQueue }) {
  if (process.env.SCHEDULER_ENABLED === '0') {
    console.log('[Scheduler] Desativado (SCHEDULER_ENABLED=0).');
    return;
  }
  if (timer) return;
  timer = setInterval(() => {
    runTick(getQueue).catch(() => {});
  }, POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[Scheduler] Ativo — verificando agendamentos a cada ${POLL_MS / 1000}s.`);
  runTick(getQueue).catch(() => {});
}
