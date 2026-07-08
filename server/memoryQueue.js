import { logRedisJob } from './monitor.js';

/**
 * Fila em memória para desenvolvimento sem Redis.
 * USE_MEMORY_QUEUE=1 ou Redis indisponível: jobs são processados no próprio processo da API.
 */
let jobIdCounter = 0;
const jobs = new Map();

function createMemoryJob(id, name, data, priority = 100) {
  const job = {
    id: String(id),
    name,
    data,
    priority,
    timestamp: Date.now(),
    processedOn: null,
    finishedOn: null,
    returnvalue: null,
    failedReason: null,
    progress: 0,
    state: 'waiting',
    getState: () => Promise.resolve(job.state),
    updateProgress: async (p) => {
      job.progress = p;
    },
  };
  return job;
}

/**
 * Cria uma fila em memória que processa jobs com o processor ao adicionar.
 * @param {(job: object) => Promise<object>} processor - função que processa o job e retorna o resultado
 * @param {() => number | Promise<number>} [resolveMaxConcurrency] - limite de jobs simultâneos
 */
export function createMemoryQueue(processor, resolveMaxConcurrency) {
  const pendingJobIds = [];
  let activeCount = 0;
  const getMaxConcurrency =
    resolveMaxConcurrency ||
    (() => 1);

  /** Próximo job: menor `priority` primeiro (1 = reserva); empate mantém ordem de chegada (FIFO). */
  function shiftNextByPriority() {
    if (!pendingJobIds.length) return null;
    let bestIdx = 0;
    let bestPriority = jobs.get(pendingJobIds[0])?.priority ?? 100;
    for (let i = 1; i < pendingJobIds.length; i++) {
      const p = jobs.get(pendingJobIds[i])?.priority ?? 100;
      if (p < bestPriority) {
        bestPriority = p;
        bestIdx = i;
      }
    }
    return pendingJobIds.splice(bestIdx, 1)[0];
  }

  async function runJob(job) {
    try {
      job.state = 'active';
      job.processedOn = Date.now();
      job.progress = 10;
      logRedisJob('active', 'Job em processamento (fila memória)', job.id, job.data);
      const result = await processor(job);
      job.progress = 100;
      job.returnvalue = result;
      job.state = 'completed';
      job.finishedOn = Date.now();
      logRedisJob('completed', 'Job concluído (fila memória)', job.id, job.data, {
        success: result?.success,
        orderNumber: result?.orderNumber ?? null,
      });
    } catch (err) {
      job.state = 'failed';
      job.failedReason = err?.message || String(err);
      job.finishedOn = Date.now();
      job.returnvalue = null;
      logRedisJob('failed', `Job falhou (fila memória): ${job.failedReason}`, job.id, job.data);
    } finally {
      activeCount--;
      setImmediate(pump);
    }
  }

  async function pump() {
    let max = await getMaxConcurrency();
    if (!Number.isFinite(max) || max < 1) max = 1;

    while (activeCount < max) {
      const nextJobId = shiftNextByPriority();
      if (!nextJobId) return;

      const job = jobs.get(nextJobId);
      if (!job) continue;

      activeCount++;
      runJob(job);
    }
  }

  return {
    async add(name, data, opts = {}) {
      const id = ++jobIdCounter;
      const priority = Number.isFinite(opts.priority) ? opts.priority : 100;
      const job = createMemoryJob(id, name, data, priority);
      jobs.set(job.id, job);
      pendingJobIds.push(job.id);
      logRedisJob('enqueue', `Job enfileirado: ${name}`, job.id, data, { backend: 'memory', priority });
      setImmediate(pump);
      return { id: job.id };
    },

    async getJob(id) {
      return jobs.get(String(id)) || null;
    },

    async getJobs(types, start = 0, end = 99) {
      const list = Array.from(jobs.values()).filter((j) => types.includes(j.state));
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return list.slice(start, end + 1);
    },

    /** Remove job ainda em `waiting` da fila (não interrompe execução já iniciada). */
    async cancelJob(id) {
      const sid = String(id);
      const job = jobs.get(sid);
      if (!job || job.state !== 'waiting') return false;
      const pIdx = pendingJobIds.indexOf(sid);
      if (pIdx >= 0) pendingJobIds.splice(pIdx, 1);
      jobs.delete(sid);
      return true;
    },
  };
}
