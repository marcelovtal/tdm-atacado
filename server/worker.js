import './loadEnv.js';
process.env.MONITOR_PROCESS = 'worker';
import { Worker } from 'bullmq';
import { createConnection, JOB_QUEUE_NAME } from './queue.js';
import { runVtalScript } from './runScript.js';
import { initDatabase } from './database.js';
import { persistJobExecution } from './jobPersistence.js';
import { buildJobReturnPayload, jobStatusFromResult } from './jobOutcome.js';

import { config } from './config.js';
import { logRedis, logRedisJob, getRedisConnectionSummary } from './monitor.js';
import { initJobCancelListener } from './jobCancelSignal.js';

if (config.useMemoryQueue || process.env.USE_MEMORY_QUEUE === '1') {
  console.log('[Worker] Fila em memória ativa — worker não é necessário. Encerrando.');
  process.exit(0);
}

const connection = createConnection();
if (!connection) {
  console.log('[Worker] Modo memória ou conexão indisponível. Encerrando.');
  process.exit(0);
}

connection.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.warn('[Worker] Redis indisponível. Rode com USE_MEMORY_QUEUE=1 para desenvolvimento sem Redis.');
  }
  console.error('[Worker] Redis:', err.message);
});

logRedis('worker_start', 'Worker BullMQ iniciado', {
  ...getRedisConnectionSummary(),
  concurrency: config.workerConcurrency,
});

const worker = new Worker(
  JOB_QUEUE_NAME,
  async (job) => {
    const { script, environment, envVars } = job.data;
    const startedAt = Date.now();
    logRedisJob('active', `Processando script ${script}`, job.id, job.data, { attempt: job.attemptsMade + 1 });
    await job.updateProgress(10);
    const result = await runVtalScript(script, environment, envVars, { jobId: job.id });
    await job.updateProgress(100);
    const dbSave = await persistJobExecution({
      jobId: String(job.id ?? ''),
      massTypeLabel: job.data?.massTypeLabel ?? null,
      orderNumber: result.orderNumber ?? null,
      environment: environment || 'ti',
      executedAt: new Date(),
      userCode: job.data?.createdByVt || null,
      status: jobStatusFromResult(result),
      durationMs: Date.now() - startedAt,
      errorMessage: result.cancelled ? null : result.error ?? null,
      stdout: result.stdout ?? null,
      stderr: result.stderr ?? null,
    });
    return buildJobReturnPayload(result, dbSave);
  },
  {
    connection,
    concurrency: config.workerConcurrency,
  }
);

worker.on('completed', (job, result) => {
  console.log(`[Worker] Job ${job.id} completed. Order: ${result?.orderNumber || 'N/A'}`);
  logRedisJob('completed', 'Job concluído no Redis', job.id, job.data, {
    success: result?.success,
    orderNumber: result?.orderNumber ?? null,
    durationMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  });
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  logRedisJob('failed', err.message, job?.id, job?.data, {
    attempts: job?.attemptsMade,
    failedReason: job?.failedReason,
  });
});

worker.on('error', (err) => {
  console.error('[Worker] Error:', err);
  logRedis('worker_error', err.message);
});

worker.on('stalled', (jobId) => {
  logRedis('stalled', 'Job travado detectado pelo worker', { jobId: String(jobId) });
});

initDatabase()
  .then(() => initJobCancelListener())
  .then(() => {
    console.log(
      `[Worker] FDL VTAL worker started. Concurrency: ${config.workerConcurrency} (DB datetime MySQL format v2)`
    );
  })
  .catch((err) => {
    console.error('[Worker] Falha ao inicializar banco:', err.message);
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED') {
      console.error('[Dica] Use MYSQL_HOST=ATDMQX01.local no .env (mesmo host do teste Python).');
    }
    process.exit(1);
  });
