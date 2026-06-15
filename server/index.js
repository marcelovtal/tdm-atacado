import './loadEnv.js';
process.env.MONITOR_PROCESS = 'api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { initQueue, getJobDataSchema } from './queue.js';
import { config, ENVIRONMENTS } from './config.js';
import { findMassTypeConfig, listMassTypesGrouped } from './massTypeCatalog.js';
import {
  initMassTypeSettings,
  isMassTypeActive,
  getMassTypeActiveEnvironments,
  listMassTypeSettings,
} from './massTypeSettings.js';
import { runVtalScript, parseScriptStdout } from './runScript.js';
import {
  initDatabase,
  listJobExecutionsForJobsPanel,
  listJobExecutionOwnersForPanel,
  getJobExecutionById,
  getJobExecutionByJobId,
  getUserExecutionSeqForExecution,
} from './database.js';
import { parseExecutedAtMs } from './database/jobsPanelHistory.js';
import { persistJobExecution } from './jobPersistence.js';
import { serializeJobResultSnapshot, resolveJobFieldsFromExecutionRow } from './jobResultSnapshot.js';
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
import { isPlatformAdmin, jobBelongsToUser } from './auth/platformAdmin.js';
import { buildDashboardStats } from './dashboardStats.js';
import { normalizeVt } from './auth/vt.js';
import {
  isTerminalJobState,
  sanitizeJobErrorMessage,
  dbExecutionMatchesJobRun,
} from './jobError.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = process.env.CLIENT_DIST_PATH || path.join(serverDir, '../client/dist');

const app = express();
app.use(cors());
app.use(express.json());
app.use(attachAuth);
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});
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
  if (isPlatformAdmin(viewerVt)) return true;
  const owner = normalizeVt(row.user_code);
  const viewer = normalizeVt(viewerVt);
  if (!owner) return false;
  return owner === viewer;
}

function formatHistoryJobRow(row) {
  const fields = resolveJobFieldsFromExecutionRow(row, parseScriptStdout);
  const executedMs = parseExecutedAtMs(row.executed_at);
  const displayNumber =
    row.user_execution_seq != null ? Number(row.user_execution_seq) : null;
  return {
    id: `hist-${row.id}`,
    displayNumber: Number.isFinite(displayNumber) ? displayNumber : null,
    massType: row.mass_type_label || 'Histórico',
    environment: row.environment,
    status: row.status || 'completed',
    progress: 100,
    timestamp: executedMs,
    processedOn: null,
    finishedOn: executedMs,
    executedAt: executedMs,
    orderId: fields.orderId,
    orderNumber: fields.orderNumber,
    error: sanitizeJobErrorMessage(row.error_message) || null,
    ownerVt: row.user_code ? normalizeVt(row.user_code) : null,
    accountBillingId: fields.accountBillingId,
    accountBusinessId: fields.accountBusinessId,
    accountOrganizationId: fields.accountOrganizationId,
    contactTecnicoId: fields.contactTecnicoId,
    pegaCaseId: fields.pegaCaseId,
    pegaCaseIdPontaA: fields.pegaCaseIdPontaA,
    pegaCaseIdPontaB: fields.pegaCaseIdPontaB,
    pegaCaseIdEVC: fields.pegaCaseIdEVC,
    pegaOrdemServicoOs: fields.pegaOrdemServicoOs,
    pegaOrdemServicoOsPontaA: fields.pegaOrdemServicoOsPontaA,
    pegaOrdemServicoOsPontaB: fields.pegaOrdemServicoOsPontaB,
    pegaOrdemServicoOsEVC: fields.pegaOrdemServicoOsEVC,
    subOrderOrderNumber: fields.subOrderOrderNumber,
    subOrderOrderNumberPontaA: fields.subOrderOrderNumberPontaA,
    subOrderOrderNumberPontaB: fields.subOrderOrderNumberPontaB,
    subOrderOrderNumberEVC: fields.subOrderOrderNumberEVC,
    source: 'db-history',
  };
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
  const effective = getEffectiveJobState(job, bullState);
  if (!isTerminalJobState(effective)) return null;
  if (job.returnvalue?.cancelled) return null;
  if (bullState === 'failed') {
    return sanitizeJobErrorMessage(job.failedReason) || 'Job falhou na fila.';
  }
  if (bullState === 'completed' && job.returnvalue && job.returnvalue.success === false) {
    if (job.returnvalue.dbSaveError) {
      return sanitizeJobErrorMessage(`Histórico não gravado no banco: ${job.returnvalue.dbSaveError}`);
    }
    return (
      sanitizeJobErrorMessage(job.returnvalue.error) ||
      'Script terminou com erro (código de saída ≠ 0)'
    );
  }
  return null;
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
    errorMessage: result.cancelled ? null : sanitizeJobErrorMessage(result.error),
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? null,
    resultJson: serializeJobResultSnapshot(result),
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
app.get('/api/config', requireAuth, (req, res) => {
  const isAdmin = !!req.user?.isPlatformAdmin;
  const categories = listMassTypesGrouped()
    .map((cat) => ({
      ...cat,
      types: cat.types
        .map((t) => ({
          ...t,
          activeEnvironments: getMassTypeActiveEnvironments(t.id),
        }))
        .filter((t) => {
          if (isAdmin) return true;
          return Object.values(t.activeEnvironments).some(Boolean);
        }),
    }))
    .filter((cat) => cat.types.length > 0);

  res.json({
    environments: ENVIRONMENTS.map((id) => ({ id, label: id.toUpperCase() })),
    massCategories: categories,
    massTypes: listMassTypeSettings(),
    quantities: [1, 3, 5],
    user: req.user
      ? {
          vt: req.user.vt,
          permissions: req.user.permissions,
          isPlatformAdmin: isAdmin,
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
    const massConfig = findMassTypeConfig(massType);
    if (!massConfig) {
      return res.status(400).json({ error: 'Tipo de massa inválido' });
    }
    if (!isMassTypeActive(massType, environment)) {
      return res.status(403).json({
        error: `Este tipo de massa está desativado no ambiente ${String(environment).toUpperCase()}. Escolha outro fluxo ou contate o admin.`,
      });
    }
    const allowedQty = [1, 3, 5];
    const parsedQty = parseInt(quantity, 10) || 1;
    if (!allowedQty.includes(parsedQty)) {
      return res.status(400).json({ error: 'Quantidade inválida. Use: 1, 3 ou 5' });
    }
    const qty = parsedQty;

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

/** Lista jobs: fila (waiting/active + concluídos recentes na fila) + histórico no banco. */
app.get('/api/jobs', requireAuth, async (req, res) => {
  const queue = getQueue();
  if (!queue) return res.status(503).json({ error: 'Fila não inicializada' });
  try {
    const isAdmin = isPlatformAdmin(req.user?.vt);
    const historyDays = isAdmin ? config.jobsHistory.daysAdmin : config.jobsHistory.daysUser;
    const ownerFilterRaw = String(req.query.ownerVt || '').trim();
    const ownerFilter = isAdmin && ownerFilterRaw ? normalizeVt(ownerFilterRaw) : null;

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getJobs(['waiting']),
      queue.getJobs(['active']),
      queue.getJobs(['completed'], 0, 99),
      queue.getJobs(['failed'], 0, 99),
    ]);

    const inFlightRaw = [...waiting, ...active];
    const terminalRaw = [...completed, ...failed];

    const mapQueueJob = async (job) => {
      const state = await job.getState();
      const effective = getEffectiveJobState(job, state);
      return {
        ...formatJob(job),
        status: effective,
        error: getEffectiveJobError(job, state),
        source: 'queue',
      };
    };

    let inFlight = await Promise.all(inFlightRaw.map(mapQueueJob));
    let terminal = await Promise.all(terminalRaw.map(mapQueueJob));

    const matchesOwner = (j) => {
      if (!ownerFilter) return true;
      return normalizeVt(j.ownerVt) === ownerFilter;
    };
    inFlight = inFlight.filter(matchesOwner);
    terminal = terminal.filter(matchesOwner);

    const historyUserCode = isAdmin ? ownerFilter : normalizeVt(req.user.vt);
    const historyRows = await listJobExecutionsForJobsPanel({
      userCode: historyUserCode,
      days: historyDays,
      limit: config.jobsHistory.listLimit,
    });

    /** Jobs já gravados no banco — preferir histórico (persistente) em vez da fila em memória/Redis. */
    const persistedQueueJobIds = new Set(
      historyRows
        .map((row) => (row.job_id != null ? String(row.job_id).trim() : ''))
        .filter(Boolean),
    );
    terminal = terminal.filter((j) => !persistedQueueJobIds.has(String(j.id)));

    const historyJobs = historyRows
      .filter((row) => historyRowOwnedBy(row, req.user.vt))
      .map(formatHistoryJobRow);

    const merged = [...inFlight, ...terminal, ...historyJobs]
      .filter((j) => isAdmin || jobBelongsToUser({ createdByVt: j.ownerVt }, req.user.vt));
    merged.sort((a, b) => (b.finishedOn || b.timestamp || 0) - (a.finishedOn || a.timestamp || 0));

    const historyOwners = isAdmin
      ? (await listJobExecutionOwnersForPanel({ days: historyDays }))
          .map((vt) => normalizeVt(vt))
          .filter(Boolean)
      : [];

    res.json({
      jobs: merged,
      meta: {
        scope: isAdmin ? 'all' : 'user',
        historyDays,
        /** Seção "Histórico" paginada — apenas admin; usuário comum vê só fila + executados. */
        showHistoryPanel: isAdmin,
        showOwnerVt: isAdmin,
        canFilterByUser: isAdmin,
        historyOwners,
        ownerFilter: ownerFilter || null,
      },
    });
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
      const isAdmin = isPlatformAdmin(req.user?.vt);
      const historyDays = isAdmin ? config.jobsHistory.daysAdmin : config.jobsHistory.daysUser;
      const displayNumber = await getUserExecutionSeqForExecution(row, historyDays);
      const fields = resolveJobFieldsFromExecutionRow(row, parseScriptStdout);
      const executedMs = parseExecutedAtMs(row.executed_at);
      return res.json(
        stripJobLogsFromResponse({
          id,
          displayNumber,
          ownerVt: row.user_code ? normalizeVt(row.user_code) : null,
          data: {
            massTypeLabel: row.mass_type_label || 'Histórico',
            environment: row.environment,
            createdByVt: row.user_code ? normalizeVt(row.user_code) : null,
          },
          state: row.status || 'completed',
          progress: 100,
          timestamp: executedMs,
          processedOn: null,
          finishedOn: executedMs,
          result: {
            ...fields,
            durationMs: row.duration_ms ?? null,
            error: sanitizeJobErrorMessage(row.error_message) || null,
            source: 'db-history',
          },
          ...fields,
          orderNumber: fields.orderNumber,
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
      result.error = sanitizeJobErrorMessage(rv.error);
      result.accountBillingId = rv.accountBillingId;
      result.accountBusinessId = rv.accountBusinessId;
      result.accountOrganizationId = rv.accountOrganizationId;
      result.contactTecnicoId = rv.contactTecnicoId;
      result.pegaCaseId = rv.pegaCaseId;
      result.pegaCaseIdPontaA = rv.pegaCaseIdPontaA;
      result.pegaCaseIdPontaB = rv.pegaCaseIdPontaB;
      result.pegaCaseIdEVC = rv.pegaCaseIdEVC;
      result.pegaOrdemServicoOs = rv.pegaOrdemServicoOs;
      result.pegaOrdemServicoOsPontaA = rv.pegaOrdemServicoOsPontaA;
      result.pegaOrdemServicoOsPontaB = rv.pegaOrdemServicoOsPontaB;
      result.pegaOrdemServicoOsEVC = rv.pegaOrdemServicoOsEVC;
      result.subOrderOrderNumber = rv.subOrderOrderNumber;
      result.subOrderOrderNumberPontaA = rv.subOrderOrderNumberPontaA;
      result.subOrderOrderNumberPontaB = rv.subOrderOrderNumberPontaB;
      result.subOrderOrderNumberEVC = rv.subOrderOrderNumberEVC;
    }
    const rowByJob =
      isTerminalJobState(effectiveState) ? await getJobExecutionByJobId(String(job.id)) : null;
    if (rowByJob && dbExecutionMatchesJobRun(rowByJob, job)) {
      const dbFields = resolveJobFieldsFromExecutionRow(rowByJob, parseScriptStdout);
      if (result.result) {
        if (dbFields.orderNumber && !result.result.orderNumber) {
          result.result.orderNumber = dbFields.orderNumber;
          result.orderNumber = dbFields.orderNumber;
        }
        if (rowByJob.error_message && !result.result.error) {
          result.result.error = sanitizeJobErrorMessage(rowByJob.error_message);
        }
        for (const key of [
          'orderId',
          'accountBillingId',
          'accountBusinessId',
          'accountOrganizationId',
          'contactTecnicoId',
          'pegaCaseId',
          'pegaCaseIdPontaA',
          'pegaCaseIdPontaB',
          'pegaCaseIdEVC',
          'pegaOrdemServicoOs',
          'pegaOrdemServicoOsPontaA',
          'pegaOrdemServicoOsPontaB',
          'pegaOrdemServicoOsEVC',
        ]) {
          if (dbFields[key] && !result.result[key]) {
            result.result[key] = dbFields[key];
            result[key] = dbFields[key];
          }
        }
      } else {
        result.result = {
          ...dbFields,
          error: sanitizeJobErrorMessage(rowByJob.error_message),
          source: 'database',
        };
        Object.assign(result, dbFields);
      }
    }
    if (state === 'failed') {
      result.failedReason = sanitizeJobErrorMessage(job.failedReason);
    }
    if (effectiveState === 'failed' && state === 'completed' && job.returnvalue?.success === false) {
      result.failedReason = getEffectiveJobError(job, state);
    }
    if (!isTerminalJobState(effectiveState)) {
      if (result.result) {
        result.result = { ...result.result, error: null };
      }
      result.error = null;
      result.failedReason = null;
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
    error: null,
    accountBillingId: job.returnvalue?.accountBillingId ?? null,
    accountBusinessId: job.returnvalue?.accountBusinessId ?? null,
    accountOrganizationId: job.returnvalue?.accountOrganizationId ?? null,
    contactTecnicoId: job.returnvalue?.contactTecnicoId ?? null,
    pegaCaseId: job.returnvalue?.pegaCaseId ?? null,
    pegaCaseIdPontaA: job.returnvalue?.pegaCaseIdPontaA ?? null,
    pegaCaseIdPontaB: job.returnvalue?.pegaCaseIdPontaB ?? null,
    pegaCaseIdEVC: job.returnvalue?.pegaCaseIdEVC ?? null,
    pegaOrdemServicoOs: job.returnvalue?.pegaOrdemServicoOs ?? null,
    pegaOrdemServicoOsPontaA: job.returnvalue?.pegaOrdemServicoOsPontaA ?? null,
    pegaOrdemServicoOsPontaB: job.returnvalue?.pegaOrdemServicoOsPontaB ?? null,
    pegaOrdemServicoOsEVC: job.returnvalue?.pegaOrdemServicoOsEVC ?? null,
    subOrderOrderNumber: job.returnvalue?.subOrderOrderNumber ?? null,
    subOrderOrderNumberPontaA: job.returnvalue?.subOrderOrderNumberPontaA ?? null,
    subOrderOrderNumberPontaB: job.returnvalue?.subOrderOrderNumberPontaB ?? null,
    subOrderOrderNumberEVC: job.returnvalue?.subOrderOrderNumberEVC ?? null,
    ownerVt: job.data?.createdByVt || null,
  };
}

initDatabase()
  .then(() => initAccessControl())
  .then(() => initMassTypeSettings())
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
