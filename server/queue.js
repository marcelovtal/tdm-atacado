import { Queue } from 'bullmq';
import { config, MASS_TYPES } from './config.js';
import { resolveMassEnvVars } from './massEnvDefaults.js';
import { normalizeVt } from './auth/vt.js';
import { createRedisClient } from './redisConnection.js';
import { createMemoryQueue } from './memoryQueue.js';
import { logRedis, getRedisConnectionSummary } from './monitor.js';
import { getParallelJobs, refreshParallelJobsCache } from './jobQueueSettings.js';

export const JOB_QUEUE_NAME = 'fdl-vtal-mass';

async function resolveMemoryQueueConcurrency() {
  await refreshParallelJobsCache();
  return getParallelJobs();
}

/**
 * Inicializa a fila: Redis se disponível, senão fila em memória (apenas perfil local).
 */
export async function initQueue(processor) {
  if (config.useMemoryQueue || process.env.USE_MEMORY_QUEUE === '1') {
    console.log('[Fila] Modo memória (USE_MEMORY_QUEUE) — Redis não necessário.');
    logRedis('memory_mode', 'Fila em memória ativa (sem Redis)', getRedisConnectionSummary());
    return {
      massQueue: createMemoryQueue(processor, resolveMemoryQueueConcurrency),
      isRedis: false,
    };
  }

  const connection = createRedisClient({
    connectTimeout: 5000,
    retryStrategy: () => null,
  });

  try {
    await Promise.race([
      connection.ping(),
      new Promise((_, reject) => {
        connection.once('error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      }),
    ]);
    const summary = getRedisConnectionSummary();
    console.log(
      `[Fila] Redis conectado (${config.redis.mode === 'sentinel' ? `Sentinel → ${config.redis.masterName}` : `${config.redis.host}:${config.redis.port}`})`
    );
    logRedis('connected', 'Conexão Redis/BullMQ estabelecida', summary);
  } catch (err) {
    logRedis('connect_failed', `Falha ao conectar Redis: ${err.message}`, getRedisConnectionSummary());
    try {
      connection.disconnect();
    } catch (_) {}
    if (config.profile === 'qa') {
      throw new Error(`Redis obrigatório no perfil QA: ${err.message}`);
    }
    console.warn('[Fila] Redis indisponível, usando fila em memória. Defina USE_MEMORY_QUEUE=1 para evitar tentativa.');
    return {
      massQueue: createMemoryQueue(processor, resolveMemoryQueueConcurrency),
      isRedis: false,
    };
  }

  const massQueue = new Queue(JOB_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });

  massQueue.on('error', (err) => {
    logRedis('queue_error', err.message, { queue: JOB_QUEUE_NAME });
  });

  return { massQueue, isRedis: true };
}

export function getJobDataSchema(massTypeId, environment, quantity = 1, extraEnv = {}, createdByVt = null) {
  const massConfig = MASS_TYPES.find((m) => m.id === massTypeId) || MASS_TYPES[0];
  return {
    massTypeId,
    massTypeLabel: massConfig.label,
    script: massConfig.script,
    environment: environment || 'ti',
    envVars: { ...resolveMassEnvVars(massTypeId, environment), ...massConfig.envVars, ...extraEnv },
    createdByVt: createdByVt ? normalizeVt(createdByVt) || null : null,
  };
}

export function createConnection() {
  if (config.useMemoryQueue || process.env.USE_MEMORY_QUEUE === '1') return null;
  return createRedisClient();
}
