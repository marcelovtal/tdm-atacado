import './loadEnv.js';
process.env.MONITOR_PROCESS = 'api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { initQueue, getJobDataSchema } from './queue.js';
import { config, ENVIRONMENTS, MASS_TYPES } from './config.js';
import { runVtalScript } from './runScript.js';
import {
  initDatabase,
  listRecentJobExecutionsSummary,
  getJobExecutionById,
  getJobExecutionByJobId,
} from './database.js';
import { persistJobExecution } from './jobPersistence.js';
import { buildJobReturnPayload, jobStatusFromResult } from './jobOutcome.js';
import {
  getMonitorEvents,
  getMonitorStats,
  getRedisConnectionSummary,
  getDatabaseSummary,
  logRedisJob,
} from './monitor.js';
import {
  authRouter,
  attachAuth,
  requireAuth,
  requirePermission,
  requireManageAccess,
} from './auth/routes.js';
import { publishJobCancel } from './jobCancelSignal.js';
import { initJobCancelListener } from './jobCancelSignal.js';
import { initAccessControl } from './auth/accessControl.js';
import { canSeeAllJobs, jobBelongsToUser } from './auth/platformAdmin.js';
import { buildDashboardStats } from './dashboardStats.js';
import { normalizeVt } from './auth/vt.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = process.env.CLIENT_DIST_PATH || path.join(serverDir, '../client/dist');

const app = express();
app.use(cors());
app.use(express.json());
app.use(attachAuth);
app.use('/api/auth', authRouter);

let massQueue = null;
let queueBackend = 'memory';

function getQueue() {
  return massQueue;
}

function stripJobLogsFromResponse(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  delete out.stdout;
  delete out.stderr;
  if (out.result && typeof out.result === 'object') {
    const r = { ...out.result };
    delete r.stdout;
    delete r.stderr;
    out.result = r;
  }
  out.logsAvailableOnServer = true;
  return out;
}

function historyRowOwnedBy(row, viewerVt) {
  if (canSeeAllJobs({ vt: viewerVt })) return true;
  const owner = normalizeVt(row.user_code);
  const viewer = normalizeVt(viewerVt);
  if (!owner) return false;
  return owner === viewer;
}

/**
 * BullMQ marca o job como "completed" quando o processador retorna sem throw,
 * mesmo se o script Node saiu com código ≠ 0 (returnvalue.success === false).
 * Para o front, tratamos isso como falha — mesmo critério do runVtalScript.
 */
function getEffectiveJobState(job, bullState) {
  if (job.returnvalue?.cancelled) return 'cancelled';
  if (bullState === 'completed' && job.returnvalue && job.returnvalue.success === false) {
    return 'failed';
  }
  return bullState;
}

function getEffectiveJobError(job, bullState) {
  if (job.returnvalue?.cancelled) return null;
  if (bullState === 'completed' && job.returnvalue && job.returnvalue.success === false) {
    if (job.returnvalue.dbSaveError) {
      return `Histórico não gravado no banco: ${job.returnvalue.dbSaveError}`;
    }
    return job.returnvalue.error || 'Script terminou com erro (código de saída ≠ 0)';
  }
  return job.returnvalue?.error ?? job.failedReason ?? null;
}

/** Processor usado pela fila em memória (e compatível com worker Redis) */
async function processJob(job) {
  const { script, environment, envVars } = job.data;
  const startedAt = Date.now();
  if (job.updateProgress) await job.updateProgress(10);
  const result = await runVtalScript(script, environment, envVars, { jobId: job.id });
  if (job.updateProgress) await job.updateProgress(100);
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
}

/** Monitoramento: eventos Redis e banco (buffer local + lista compartilhada no Redis). */
app.get('/api/monitor', requireAuth, requireManageAccess, async (req, res) => {
  try {
    const channel = req.query.channel || null;
    const limit = req.query.limit || 100;
    const since = req.query.since || null;
    const stats = await getMonitorStats();
    res.json({
      stats,
      redis: getRedisConnectionSummary(),
      database: getDatabaseSummary(),
      profile: config.profile,
      events: await getMonitorEvents({ channel, limit, since }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/monitor/redis', requireAuth, requireManageAccess, async (req, res) => {
  try {
    const stats = await getMonitorStats();
    res.json({
      connection: getRedisConnectionSummary(),
      stats: stats.redis,
      events: await getMonitorEvents({
        channel: 'redis',
        limit: req.query.limit || 100,
        since: req.query.since,
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/monitor/db', requireAuth, requireManageAccess, async (req, res) => {
  try {
    const stats = await getMonitorStats();
    res.json({
      database: getDatabaseSummary(),
      stats: stats.db,
      events: await getMonitorEvents({
        channel: 'db',
        limit: req.query.limit || 100,
        since: req.query.since,
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Lista tipos de massa e ambientes para o frontend */
app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    environments: ENVIRONMENTS.map((id) => ({ id, label: id.toUpperCase() })),
    massTypes: MASS_TYPES.map(({ id, label }) => ({ id, label })),
    quantities: [1, 5, 10],
    user: _req.user
      ? {
          vt: _req.user.vt,
          permissions: _req.user.permissions,
          isPlatformAdmin: !!_req.user.isPlatformAdmin,
        }
      : null,
  });
});

/** Estatísticas do dashboard (histórico job_executions + sessões ativas). */
app.get('/api/dashboard/stats', requireAuth, requirePermission('dashboard'), async (req, res) => {
  try {
    const stats = await buildDashboardStats(req.user);
    res.json(stats);
  } catch (err) {
    console.error('GET /api/dashboard/stats', err);
    res.status(500).json({ error: err.message || 'Erro ao carregar dashboard' });
  }
});

/** Cria um ou mais jobs (quantidade = número de execuções) */
app.post('/api/jobs', requireAuth, async (req, res) => {
  const queue = getQueue();
  if (!queue) return res.status(503).json({ error: 'Fila não inicializada' });
  try {
    const { environment = 'ti', massType = 'lead-pedido', quantity = 1, extraEnv = {} } = req.body;
    if (!ENVIRONMENTS.includes(environment)) {
      return res.status(400).json({ error: 'Ambiente inválido. Use: ti, trg' });
    }
    const massConfig = MASS_TYPES.find((m) => m.id === massType);
    if (!massConfig) {
      return res.status(400).json({ error: 'Tipo de massa inválido' });
    }
    const qty = Math.min(Math.max(1, parseInt(quantity, 10) || 1), 50);

    const data = getJobDataSchema(massType, environment, qty, extraEnv, req.user?.vt);
    const jobs = [];
    for (let i = 0; i < qty; i++) {
      const job = await queue.add(`mass-${massType}-${environment}`, data, {
        jobId: undefined,
      });
      logRedisJob('enqueue', `Job enfileirado via API: mass-${massType}-${environment}`, job.id, data, {
        backend: queueBackend,
      });
      jobs.push({
        id: job.id,
        massType: data.massTypeLabel,
        environment: data.environment,
        status: 'queued',
      });
    }
    res.status(201).json({ jobs, message: `${jobs.length} job(s) na fila` });
  } catch (err) {
    console.error('POST /api/jobs', err);
    res.status(500).json({ error: err.message || 'Erro ao enfileirar jobs' });
  }
});

/** Lista jobs (últimos da fila: waiting, active, completed, failed) */
app.get('/api/jobs', requireAuth, async (req, res) => {
  const queue = getQueue();
  if (!queue) return res.status(503).json({ error: 'Fila não inicializada' });
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getJobs(['waiting']),
      queue.getJobs(['active']),
      queue.getJobs(['completed'], 0, 99),
      queue.getJobs(['failed'], 0, 99),
    ]);
    const all = [...waiting, ...active, ...completed, ...failed];
    const withState = await Promise.all(
      all.map(async (job) => {
        const state = await job.getState();
        const effective = getEffectiveJobState(job, state);
        return {
          ...formatJob(job),
          status: effective,
          error: getEffectiveJobError(job, state),
        };
      })
    );
    const historyRows = await listRecentJobExecutionsSummary(500);
    const seeAll = canSeeAllJobs(req.user);
    const historyJobs = historyRows
      .filter((row) => historyRowOwnedBy(row, req.user.vt))
      .map((row) => ({
        id: `hist-${row.id}`,
        massType: row.mass_type_label || 'Histórico',
        environment: row.environment,
        status: row.status || 'completed',
        progress: 100,
        timestamp: row.executed_at ? Date.parse(row.executed_at) : null,
        processedOn: null,
        finishedOn: row.executed_at ? Date.parse(row.executed_at) : null,
        orderId: null,
        orderNumber: row.order_number || null,
        error: row.error_message || null,
        ownerVt: row.user_code ? normalizeVt(row.user_code) : null,
        accountBillingId: null,
        accountBusinessId: null,
        accountOrganizationId: null,
        contactTecnicoId: null,
      }));

    const merged = [...withState, ...historyJobs]
      .filter((j) => seeAll || jobBelongsToUser({ createdByVt: j.ownerVt }, req.user.vt));
    merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({ jobs: merged });
  } catch (err) {
    console.error('GET /api/jobs', err);
    res.status(500).json({ error: err.message || 'Erro ao listar jobs' });
  }
});

/** Cancela job na fila (`waiting`) ou em execução (`active`, requer permissão cancelJobs). */
app.post('/api/jobs/:id/cancel', requireAuth, requirePermission('cancelJobs'), async (req, res) => {
  const queue = getQueue();
  if (!queue) return res.status(503).json({ error: 'Fila não inicializada' });
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.startsWith('hist-')) {
      return res.status(400).json({ error: 'Job inválido ou histórico (não cancelável).' });
    }

    if (typeof queue.cancelJob === 'function') {
      const removed = await queue.cancelJob(id);
      if (removed) {
        return res.json({ ok: true, id, message: 'Job removido da fila.' });
      }
    }

    const job = await queue.getJob(id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    if (!jobBelongsToUser(job.data, req.user.vt)) {
      return res.status(403).json({ error: 'Sem permissão para cancelar este job' });
    }
    const state = await job.getState();

    if (state === 'waiting') {
      await job.remove();
      return res.json({ ok: true, id, message: 'Job removido da fila.' });
    }

    if (state === 'active') {
      await publishJobCancel(id);
      return res.json({
        ok: true,
        id,
        message: 'Cancelamento enviado ao worker (script em execução será interrompido).',
      });
    }

    return res.status(409).json({
      error: `Não é possível cancelar job com status "${state}".`,
    });
  } catch (err) {
    console.error('POST /api/jobs/:id/cancel', err);
    res.status(500).json({ error: err.message || 'Erro ao cancelar job' });
  }
});

/** Detalhe de um job (status, logs, resultado) */
app.get('/api/jobs/:id', requireAuth, async (req, res) => {
  const queue = getQueue();
  if (!queue) return res.status(503).json({ error: 'Fila não inicializada' });
  try {
    const id = req.params.id;
    if (id.startsWith('hist-')) {
      const numericId = parseInt(id.slice(5), 10);
      if (!numericId) {
        return res.status(404).json({ error: 'Job histórico não encontrado' });
      }
      const row = await getJobExecutionById(numericId);
      if (!row) {
        return res.status(404).json({ error: 'Job histórico não encontrado' });
      }
      if (!historyRowOwnedBy(row, req.user.vt)) {
        return res.status(403).json({ error: 'Sem permissão para ver este job' });
      }
      return res.json(
        stripJobLogsFromResponse({
          id,
          data: {
            massTypeLabel: row.mass_type_label || 'Histórico',
            environment: row.environment,
            createdByVt: row.user_code ? normalizeVt(row.user_code) : null,
          },
          state: row.status || 'completed',
          progress: 100,
          timestamp: row.executed_at ? Date.parse(row.executed_at) : null,
          processedOn: null,
          finishedOn: row.executed_at ? Date.parse(row.executed_at) : null,
          result: {
            orderNumber: row.order_number || null,
            durationMs: row.duration_ms ?? null,
            error: row.error_message || null,
            source: 'db-history',
          },
          orderNumber: row.order_number || null,
          failedReason: row.status === 'failed' ? (row.error_message || 'Falha registrada no histórico.') : null,
        })
      );
    }
    const job = await queue.getJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }
    if (!jobBelongsToUser(job.data, req.user.vt)) {
      return res.status(403).json({ error: 'Sem permissão para ver este job' });
    }
    const state = await job.getState();
    const effectiveState = getEffectiveJobState(job, state);
    const result = {
      id: job.id,
      data: job.data,
      state: effectiveState,
      progress: job.progress,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
    if (job.returnvalue) {
      const rv = { ...job.returnvalue };
      delete rv._logsInDb;
      result.result = rv;
      result.stdout = rv.stdout;
      result.stderr = rv.stderr;
      result.orderId = rv.orderId;
      result.orderNumber = rv.orderNumber;
      result.orderStatus = rv.orderStatus;
      result.error = rv.error;
      result.accountBillingId = rv.accountBillingId;
      result.accountBusinessId = rv.accountBusinessId;
      result.accountOrganizationId = rv.accountOrganizationId;
      result.contactTecnicoId = rv.contactTecnicoId;
      result.pegaCaseId = rv.pegaCaseId;
      result.pegaOrdemServicoOs = rv.pegaOrdemServicoOs;
      result.subOrderOrderNumber = rv.subOrderOrderNumber;
    }
    const rowByJob = await getJobExecutionByJobId(String(job.id));
    if (rowByJob && result.result) {
      if (rowByJob.order_number && !result.result.orderNumber) {
        result.result.orderNumber = rowByJob.order_number;
        result.orderNumber = rowByJob.order_number;
      }
      if (rowByJob.error_message && !result.result.error) {
        result.result.error = rowByJob.error_message;
      }
    } else if (rowByJob && !result.result) {
      result.result = {
        orderNumber: rowByJob.order_number || null,
        error: rowByJob.error_message || null,
        source: 'database',
      };
      result.orderNumber = rowByJob.order_number || null;
    }
    if (state === 'failed') {
      result.failedReason = job.failedReason;
    }
    if (effectiveState === 'failed' && state === 'completed' && job.returnvalue?.success === false) {
      result.failedReason = getEffectiveJobError(job, state);
    }
    res.json(stripJobLogsFromResponse(result));
  } catch (err) {
    console.error('GET /api/jobs/:id', err);
    res.status(500).json({ error: err.message || 'Erro ao obter job' });
  }
});

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
}

function formatJob(job) {
  const state = job.getState?.() ? undefined : (job.state || 'unknown');
  return {
    id: job.id,
    massType: job.data?.massTypeLabel,
    environment: job.data?.environment,
    status: state || job.getState?.() || 'unknown',
    progress: job.progress,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    orderId: job.returnvalue?.orderId ?? null,
    orderNumber: job.returnvalue?.orderNumber ?? null,
    error: job.returnvalue?.error ?? job.failedReason ?? null,
    accountBillingId: job.returnvalue?.accountBillingId ?? null,
    accountBusinessId: job.returnvalue?.accountBusinessId ?? null,
    accountOrganizationId: job.returnvalue?.accountOrganizationId ?? null,
    contactTecnicoId: job.returnvalue?.contactTecnicoId ?? null,
    pegaCaseId: job.returnvalue?.pegaCaseId ?? null,
    pegaOrdemServicoOs: job.returnvalue?.pegaOrdemServicoOs ?? null,
    subOrderOrderNumber: job.returnvalue?.subOrderOrderNumber ?? null,
    ownerVt: job.data?.createdByVt || null,
  };
}

initDatabase()
  .then(() => initAccessControl())
  .then(() => initJobCancelListener())
  .then(() => initQueue(processJob))
  .then(({ massQueue: q, isRedis }) => {
    massQueue = q;
    queueBackend = isRedis ? 'bullmq' : 'memory';
    app.listen(config.port, () => {
      console.log(`Gerenciamento de Dados de Teste - VTAL API rodando em http://localhost:${config.port}`);
      console.log(`Perfil: ${config.profile} | Auth: ${config.auth.mode} | VTAL path: ${config.vtalPath}`);
      if (!isRedis) console.log('Fila em memória ativa (jobs processados na API).');
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar:', err.message || err);
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED') {
      console.error(
        '[Dica] MySQL/Redis inacessível. Use hostnames (ATDMQX01.local / ATDMQX02.local), VPN ativa, e confira .env.'
      );
    }
    process.exit(1);
  });
