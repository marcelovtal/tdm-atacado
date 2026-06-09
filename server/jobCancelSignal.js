import { config } from './config.js';
import { abortJobProcess } from './jobCancelRegistry.js';

const CHANNEL = 'fdl-vtal:job-cancel';
let subscriber = null;
let publisher = null;

export async function initJobCancelListener() {
  if (config.useMemoryQueue || process.env.USE_MEMORY_QUEUE === '1') return;
  try {
    const { createRedisClient } = await import('./redisConnection.js');
    subscriber = createRedisClient({ maxRetriesPerRequest: null });
    await subscriber.subscribe(CHANNEL);
    subscriber.on('message', (_ch, jobId) => {
      if (jobId) {
        console.log(`[Cancel] Sinal recebido para job ${jobId}`);
        abortJobProcess(jobId);
      }
    });
    console.log('[Cancel] Escutando canal Redis para cancelamento de jobs ativos');
  } catch (err) {
    console.warn('[Cancel] Não foi possível subscrever cancelamentos:', err.message);
  }
}

export async function publishJobCancel(jobId) {
  if (config.useMemoryQueue || process.env.USE_MEMORY_QUEUE === '1') {
    abortJobProcess(jobId);
    return true;
  }
  try {
    const { createRedisClient } = await import('./redisConnection.js');
    if (!publisher) publisher = createRedisClient({ maxRetriesPerRequest: null });
    await publisher.publish(CHANNEL, String(jobId));
    return true;
  } catch (err) {
    console.warn('[Cancel] Falha ao publicar cancelamento:', err.message);
    return false;
  }
}
