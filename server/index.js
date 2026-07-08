import './loadEnv.js';
process.env.MONITOR_PROCESS = 'api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { initQueue, getJobDataSchema } from './queue.js';
import { config, ENVIRONMENTS, MASS_TYPES } from './config.js';
import { findMassTypeConfig, listMassTypesGrouped } from './massTypeCatalog.js';
import { getMassaProntaDefaultsForApi, validateMassaProntaJob } from './massEnvDefaults.js';
import {
  initMassTypeSettings,
  isMassTypeActive,
  getMassTypeActiveEnvironments,
  listMassTypeSettings,
} from './massTypeSettings.js';
import {
  initMassTypeFailureTracker,
  getMassTypeFailureDisplay,
  buildMassTypeInactiveError,
} from './massTypeFailureTracker.js';
import { afterMassTypeJobProcessed } from './massTypeJobOutcome.js';
import { withPlaywrightOfsGate } from './jobConcurrencyGate.js';
import { initJobQueueSettings, refreshParallelJobsCache } from './jobQueueSettings.js';
import { runVtalScript, parseScriptStdout } from './runScript.js';
import {
  createStdoutLiveSnapshotHandler,
  extractLiveSnapshotFromProgress,
  mergeLiveFieldsIntoJobFields,
} from './jobLiveSnapshot.js';
import {
  initDatabase,
  listJobExecutionsForJobsPanel,
  listJobExecutionOwnersForPanel,
  getJobExecutionById,
  getJobExecutionByJobId,
  getUserExecutionSeqForExecution,
  createScheduledJob,
  listScheduledJobs,
  getScheduledJobById,
  cancelScheduledJobById,
  createReservation,
  getReservationForDate,
  listReservations,
  getReservationById,
  deleteReservationById,
} from './database.js';
import { startScheduler } from './scheduler.js';
import { resolveJobPriority, todayDateString } from './jobPriority.js';
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
  requirePlatformAdmin,
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
import { resolveJobFailureDisplay } from './classifyUserJobError.js';

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
  const failure = resolveJobFailureDisplay({
    status: row.status || 'completed',
    errorMessage: sanitizeJobErrorMessage(row.error_message),
    stderr: row.stderr,
    stdout: row.stdout,
    environment: row.environment,
  });
  return {
    id: `hist-${row.id}`,
    displayNumber: Number.isFinite(displayNumber) ? displayNumber : null,
    massTypeId: resolveMassTypeIdByLabel(row.mass_type_label),
    massType: row.mass_type_label || 'Histórico',
    environment: row.environment,
    status: failure.status,
    progress: 100,
    timestamp: executedMs,
    processedOn: null,
    finishedOn: executedMs,
    executedAt: executedMs,
    orderId: fields.orderId,
    orderNumber: fields.orderNumber,
    orderStatus: fields.orderStatus,
    orderStatusPollFailed: fields.orderStatusPollFailed === true,
    orderStatusPollError: fields.orderStatusPollError ?? null,
    error: failure.error,
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
    if (job.returnvalue.userError) return 'user_error';
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
  await refreshParallelJobsCache();
  const { script, environment, envVars } = job.data;
  return withPlaywrightOfsGate(script, async () => {
    const startedAt = Date.now();
    if (job.updateProgress) await job.updateProgress(10);
    const result = await runVtalScript(script, environment, envVars, {
      jobId: job.id,
      onStdoutChunk: createStdoutLiveSnapshotHandler(job),
    });
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
    const payload = buildJobReturnPayload(result, dbSave);
    await afterMassTypeJobProcessed(job, result);
    return payload;
  });
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
        .map((t) => {
          const failure = getMassTypeFailureDisplay(t.id);
          return {
            ...t,
            activeEnvironments: getMassTypeActiveEnvironments(t.id),
            failureStreakByEnv: failure.streakByEnv,
            autoDisabledByEnv: failure.autoDisabledByEnv,
            autoDisableReasonByEnv: failure.autoDisableReasonByEnv,
          };
        })
        .filter((t) => {
          if (isAdmin) return true;
          if (Object.values(t.autoDisabledByEnv || {}).some(Boolean)) return true;
          return Object.values(t.activeEnvironments).some(Boolean);
        }),
    }))
    .filter((cat) => cat.types.length > 0);

  res.json({
    environments: ENVIRONMENTS.map((id) => ({ id, label: id.toUpperCase() })),
    massCategories: categories,
    massTypes: listMassTypeSettings(),
    massaProntaDefaults: getMassaProntaDefaultsForApi(),
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
        error: buildMassTypeInactiveError(massType, environment),
      });
    }
    const allowedQty = [1, 3, 5];
    const parsedQty = parseInt(quantity, 10) || 1;
    if (!allowedQty.includes(parsedQty)) {
      return res.status(400).json({ error: 'Quantidade inválida. Use: 1, 3 ou 5' });
    }
    const qty = parsedQty;

    const massaProntaError = validateMassaProntaJob(massType, environment, extraEnv);
    if (massaProntaError) {
      return res.status(400).json({ error: massaProntaError });
    }

    const data = getJobDataSchema(massType, environment, qty, extraEnv, req.user?.vt);
    const priority = await resolveJobPriority(environment, req.user?.vt);
    const jobs = [];
    for (let i = 0; i < qty; i++) {
      const job = await queue.add(`mass-${massType}-${environment}`, data, {
        jobId: undefined,
        priority,
      });
      logRedisJob('enqueue', `Job enfileirado via API: mass-${massType}-${environment}`, job.id, data, {
        backend: queueBackend,
        priority,
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
      const live = extractLiveSnapshotFromProgress(job.progress);
      const base = formatJob(job);
      const merged = mergeLiveFieldsIntoJobFields(base, live);
      return {
        ...merged,
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

/** Cancela job na fila (`waiting`) ou em execução (`active`). Restrito ao administrador da plataforma. */
app.post('/api/jobs/:id/cancel', requireAuth, requirePlatformAdmin, async (req, res) => {
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
      const failure = resolveJobFailureDisplay({
        status: row.status || 'completed',
        errorMessage: sanitizeJobErrorMessage(row.error_message),
        stderr: row.stderr,
        stdout: row.stdout,
        environment: row.environment,
      });
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
          state: failure.status,
          progress: 100,
          timestamp: executedMs,
          processedOn: null,
          finishedOn: executedMs,
          result: {
            ...fields,
            durationMs: row.duration_ms ?? null,
            error: failure.error,
            source: 'db-history',
          },
          ...fields,
          orderNumber: fields.orderNumber,
          failedReason:
            failure.status === 'failed' || failure.status === 'user_error'
              ? failure.error || 'Falha registrada no histórico.'
              : null,
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
      result.orderStatusPollFailed = rv.orderStatusPollFailed === true;
      result.orderStatusPollError = rv.orderStatusPollError ?? null;
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
          'orderStatus',
          'orderStatusPollFailed',
          'orderStatusPollError',
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
    if (
      (effectiveState === 'failed' || effectiveState === 'user_error') &&
      state === 'completed' &&
      job.returnvalue?.success === false
    ) {
      result.failedReason = getEffectiveJobError(job, state);
    }
    if (!isTerminalJobState(effectiveState)) {
      if (result.result) {
        result.result = { ...result.result, error: null };
      }
      result.error = null;
      result.failedReason = null;
      const live = extractLiveSnapshotFromProgress(job.progress);
      if (live) {
        const mergedLive = mergeLiveFieldsIntoJobFields(result, live);
        Object.assign(result, mergedLive);
        result.result = { ...(result.result || {}), ...mergedLive };
      }
    }
    res.json(stripJobLogsFromResponse(result));
  } catch (err) {
    console.error('GET /api/jobs/:id', err);
    res.status(500).json({ error: err.message || 'Erro ao obter job' });
  }
});

/* ===================== Agendamentos ===================== */

function formatScheduleRow(row) {
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
  let triggeredJobIds = [];
  try {
    triggeredJobIds = row.triggered_job_ids ? JSON.parse(row.triggered_job_ids) : [];
  } catch (_) {
    triggeredJobIds = [];
  }
  const massTypeLabels = massTypes.map((t) => t.label || t.id).filter(Boolean);
  return {
    id: row.id,
    massTypeId: row.mass_type_id,
    massType: massTypeLabels.length > 1 ? massTypeLabels.join(' · ') : massTypeLabels[0] || row.mass_type_id,
    massTypeLabel: row.mass_type_label || null,
    massTypes,
    environment: row.environment,
    quantity: Number(row.quantity) || 1,
    extraEnv,
    scheduledAt: row.scheduled_at,
    status: row.status,
    createdByVt: row.created_by_vt ? normalizeVt(row.created_by_vt) : null,
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
    triggeredJobIds,
    lastError: sanitizeJobErrorMessage(row.last_error),
  };
}

function parseScheduledAt(value) {
  if (!value) return { error: 'Informe a data e hora do agendamento.' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'Data/hora inválida.' };
  if (d.getTime() <= Date.now() + 10_000) {
    return { error: 'O horário do agendamento precisa ser no futuro.' };
  }
  return { date: d };
}

/** Cria um agendamento (dispara os jobs no horário informado). */
app.post('/api/schedules', requireAuth, async (req, res) => {
  try {
    const {
      environment = 'ti',
      massType,
      massTypes: massTypesBody,
      quantity = 1,
      extraEnv = {},
      scheduledAt,
    } = req.body || {};

    if (!ENVIRONMENTS.includes(environment)) {
      return res.status(400).json({ error: 'Ambiente inválido. Use: ti, trg' });
    }

    const rawMassTypes = Array.isArray(massTypesBody) && massTypesBody.length
      ? massTypesBody
      : massType
        ? [{ id: massType }]
        : [];
    if (!rawMassTypes.length) {
      return res.status(400).json({ error: 'Selecione ao menos um tipo de massa.' });
    }

    const resolvedMassTypes = [];
    for (const item of rawMassTypes) {
      const id = item?.id || item?.massTypeId || item;
      const massConfig = findMassTypeConfig(id);
      if (!massConfig) {
        return res.status(400).json({ error: `Tipo de massa inválido: ${id}` });
      }
      if (!isMassTypeActive(id, environment)) {
        return res.status(403).json({
          error: buildMassTypeInactiveError(id, environment),
        });
      }
      const massaProntaError = validateMassaProntaJob(id, environment, extraEnv);
      if (massaProntaError) {
        return res.status(400).json({ error: massaProntaError });
      }
      resolvedMassTypes.push({ id, label: massConfig.label });
    }

    const allowedQty = [1, 3, 5];
    const parsedQty = parseInt(quantity, 10) || 1;
    if (!allowedQty.includes(parsedQty)) {
      return res.status(400).json({ error: 'Quantidade inválida. Use: 1, 3 ou 5' });
    }
    const when = parseScheduledAt(scheduledAt);
    if (when.error) {
      return res.status(400).json({ error: when.error });
    }

    const primary = resolvedMassTypes[0];
    const combinedLabel =
      resolvedMassTypes.length > 1
        ? `${resolvedMassTypes.length} tipos: ${resolvedMassTypes.map((t) => t.label).join(', ')}`
        : primary.label;

    const { id } = await createScheduledJob({
      massTypeId: primary.id,
      massTypeLabel: combinedLabel,
      massTypes: resolvedMassTypes,
      environment,
      quantity: parsedQty,
      extraEnv: extraEnv && typeof extraEnv === 'object' ? extraEnv : {},
      scheduledAt: when.date,
      createdByVt: req.user?.vt || null,
    });

    const typeCount = resolvedMassTypes.length;
    res.status(201).json({
      id,
      message:
        typeCount > 1
          ? `Agendamento criado com ${typeCount} tipos de massa para ${when.date.toLocaleString('pt-BR')}.`
          : `Agendamento criado para ${when.date.toLocaleString('pt-BR')}.`,
    });
  } catch (err) {
    console.error('POST /api/schedules', err);
    res.status(500).json({ error: err.message || 'Erro ao criar agendamento' });
  }
});

/** Lista agendamentos (admin vê todos; usuário comum vê os próprios). */
app.get('/api/schedules', requireAuth, async (req, res) => {
  try {
    const isAdmin = isPlatformAdmin(req.user?.vt);
    const rows = await listScheduledJobs({
      userCode: normalizeVt(req.user?.vt),
      isAdmin,
      limit: 200,
    });
    res.json({
      schedules: rows.map(formatScheduleRow),
      meta: { scope: isAdmin ? 'all' : 'user', showOwnerVt: isAdmin },
    });
  } catch (err) {
    console.error('GET /api/schedules', err);
    res.status(500).json({ error: err.message || 'Erro ao listar agendamentos' });
  }
});

/** Cancela um agendamento pendente (próprio, ou qualquer um se admin). */
app.post('/api/schedules/:id/cancel', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Agendamento inválido.' });
    const row = await getScheduledJobById(id);
    if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    const isAdmin = isPlatformAdmin(req.user?.vt);
    const owner = normalizeVt(row.created_by_vt);
    if (!isAdmin && owner && owner !== normalizeVt(req.user?.vt)) {
      return res.status(403).json({ error: 'Sem permissão para cancelar este agendamento.' });
    }
    if (row.status !== 'pending') {
      return res.status(409).json({ error: `Agendamento já está "${row.status}" e não pode ser cancelado.` });
    }
    const cancelled = await cancelScheduledJobById(id);
    if (!cancelled) {
      return res.status(409).json({ error: 'Agendamento não está mais pendente.' });
    }
    res.json({ ok: true, id, message: 'Agendamento cancelado.' });
  } catch (err) {
    console.error('POST /api/schedules/:id/cancel', err);
    res.status(500).json({ error: err.message || 'Erro ao cancelar agendamento' });
  }
});

/* ===================== Reserva de ambiente (prioridade na fila) ===================== */

function formatReservationRow(row, viewerVt) {
  const vt = normalizeVt(row.vt);
  return {
    id: row.id,
    environment: row.environment,
    date: row.reserved_date,
    vt,
    createdByVt: row.created_by_vt ? normalizeVt(row.created_by_vt) : vt,
    createdAt: row.created_at,
    isMine: !!viewerVt && vt === normalizeVt(viewerVt),
  };
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

/** Cria reserva de um ambiente para uma data — o VT da reserva ganha prioridade na fila nesse dia. */
app.post('/api/reservations', requireAuth, async (req, res) => {
  try {
    const { environment, date } = req.body || {};
    if (!ENVIRONMENTS.includes(environment)) {
      return res.status(400).json({ error: 'Ambiente inválido. Use: ti, trg' });
    }
    if (!isValidDateString(date)) {
      return res.status(400).json({ error: 'Data inválida. Use o formato AAAA-MM-DD.' });
    }
    if (date < todayDateString()) {
      return res.status(400).json({ error: 'A reserva precisa ser para hoje ou uma data futura.' });
    }

    const viewerVt = normalizeVt(req.user?.vt);
    const existing = await getReservationForDate(environment, date);
    if (existing) {
      const holder = normalizeVt(existing.vt);
      if (holder === viewerVt) {
        return res.status(200).json({ id: existing.id, message: 'Você já tem essa reserva.' });
      }
      return res.status(409).json({
        error: `Ambiente ${String(environment).toUpperCase()} já está reservado por ${holder} em ${date}.`,
      });
    }

    const { id } = await createReservation({
      environment,
      reservedDate: date,
      vt: viewerVt,
      createdByVt: viewerVt,
    });
    res.status(201).json({
      id,
      message: `Reserva de ${String(environment).toUpperCase()} criada para ${date}.`,
    });
  } catch (err) {
    console.error('POST /api/reservations', err);
    res.status(500).json({ error: err.message || 'Erro ao criar reserva' });
  }
});

/** Lista reservas de hoje em diante (todos veem; cada um pode cancelar a própria, admin cancela qualquer). */
app.get('/api/reservations', requireAuth, async (req, res) => {
  try {
    const rows = await listReservations(todayDateString());
    const isAdmin = isPlatformAdmin(req.user?.vt);
    res.json({
      reservations: rows.map((r) => formatReservationRow(r, req.user?.vt)),
      meta: { isAdmin, today: todayDateString() },
    });
  } catch (err) {
    console.error('GET /api/reservations', err);
    res.status(500).json({ error: err.message || 'Erro ao listar reservas' });
  }
});

/** Cancela uma reserva (própria ou qualquer uma se admin). */
app.post('/api/reservations/:id/cancel', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Reserva inválida.' });
    const row = await getReservationById(id);
    if (!row) return res.status(404).json({ error: 'Reserva não encontrada.' });
    const isAdmin = isPlatformAdmin(req.user?.vt);
    if (!isAdmin && normalizeVt(row.vt) !== normalizeVt(req.user?.vt)) {
      return res.status(403).json({ error: 'Sem permissão para cancelar esta reserva.' });
    }
    await deleteReservationById(id);
    res.json({ ok: true, id, message: 'Reserva cancelada.' });
  } catch (err) {
    console.error('POST /api/reservations/:id/cancel', err);
    res.status(500).json({ error: err.message || 'Erro ao cancelar reserva' });
  }
});

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
}

function resolveMassTypeIdByLabel(label) {
  const needle = String(label || '').trim();
  if (!needle) return null;
  const found = MASS_TYPES.find((m) => m.label === needle);
  return found?.id ?? null;
}

function formatJob(job) {
  const state = job.getState?.() ? undefined : (job.state || 'unknown');
  const base = {
    id: job.id,
    massTypeId: job.data?.massTypeId ?? null,
    massType: job.data?.massTypeLabel,
    environment: job.data?.environment,
    status: state || job.getState?.() || 'unknown',
    progress: job.progress,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    orderId: job.returnvalue?.orderId ?? null,
    orderNumber: job.returnvalue?.orderNumber ?? null,
    orderStatus: job.returnvalue?.orderStatus ?? null,
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
    orderStatusPollFailed: job.returnvalue?.orderStatusPollFailed === true,
    orderStatusPollError: job.returnvalue?.orderStatusPollError ?? null,
    ownerVt: job.data?.createdByVt || null,
    data: job.data || null,
  };
  return mergeLiveFieldsIntoJobFields(base, extractLiveSnapshotFromProgress(job.progress));
}

initDatabase()
  .then(() => initAccessControl())
  .then(() => initMassTypeSettings())
  .then(() => initMassTypeFailureTracker())
  .then(() => initJobQueueSettings())
  .then(() => initJobCancelListener())
  .then(() => initQueue(processJob))
  .then(({ massQueue: q, isRedis }) => {
    massQueue = q;
    queueBackend = isRedis ? 'bullmq' : 'memory';
    startScheduler({ getQueue });
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
