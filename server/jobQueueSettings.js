import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getAppSettingMysql, setAppSettingMysql } from './database/mysqlStore.js';

const useMysql = config.database.driver === 'mysql';
const SETTING_KEY = 'parallel_jobs';
const MIN_PARALLEL_JOBS = 1;
const MAX_PARALLEL_JOBS = config.maxParallelJobs;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH =
  process.env.JOB_QUEUE_SETTINGS_PATH || path.join(__dirname, 'data', 'job-queue-settings.json');

let parallelJobsCache = null;
/** @type {import('bullmq').Worker | null} */
let bullWorkerRef = null;

function defaultParallelJobs() {
  const fromEnv = config.workerConcurrency;
  return clampParallelJobs(Number.isFinite(fromEnv) ? fromEnv : MIN_PARALLEL_JOBS);
}

export function clampParallelJobs(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return defaultParallelJobs();
  return Math.min(MAX_PARALLEL_JOBS, Math.max(MIN_PARALLEL_JOBS, n));
}

function readSettingsFile() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return { parallelJobs: defaultParallelJobs() };
    }
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return { parallelJobs: clampParallelJobs(data.parallelJobs) };
  } catch (err) {
    console.error('[JobQueue] Erro ao ler job-queue-settings.json:', err.message);
    return { parallelJobs: defaultParallelJobs() };
  }
}

function writeSettingsFile(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify({ parallelJobs: clampParallelJobs(settings.parallelJobs) }, null, 2),
    'utf-8',
  );
}

async function loadFromStorage() {
  if (useMysql) {
    const raw = await getAppSettingMysql(SETTING_KEY);
    if (raw != null && raw !== '') {
      return { parallelJobs: clampParallelJobs(raw) };
    }
    const initial = defaultParallelJobs();
    await setAppSettingMysql(SETTING_KEY, String(initial));
    return { parallelJobs: initial };
  }
  return readSettingsFile();
}

export function getParallelJobs() {
  return parallelJobsCache?.parallelJobs ?? defaultParallelJobs();
}

export function getParallelJobsBounds() {
  return { min: MIN_PARALLEL_JOBS, max: MAX_PARALLEL_JOBS };
}

export function registerBullWorker(worker) {
  bullWorkerRef = worker;
}

export function applyParallelJobsToWorker() {
  if (bullWorkerRef) {
    bullWorkerRef.concurrency = getParallelJobs();
  }
}

export async function refreshParallelJobsCache() {
  parallelJobsCache = await loadFromStorage();
  applyParallelJobsToWorker();
  return parallelJobsCache;
}

export async function initJobQueueSettings() {
  parallelJobsCache = await loadFromStorage();
  if (!useMysql) {
    writeSettingsFile(parallelJobsCache);
  }
  console.log(`[JobQueue] Paralelismo de jobs: ${getParallelJobs()}`);
  return parallelJobsCache;
}

export function getJobQueueSettingsForApi() {
  return {
    parallelJobs: getParallelJobs(),
    ...getParallelJobsBounds(),
    playwrightOfsSerial: true,
  };
}

export async function updateJobQueueSettings(body) {
  const parallelJobs = clampParallelJobs(body?.parallelJobs);
  parallelJobsCache = { parallelJobs };

  if (useMysql) {
    await setAppSettingMysql(SETTING_KEY, String(parallelJobs));
  } else {
    writeSettingsFile(parallelJobsCache);
  }

  applyParallelJobsToWorker();
  return getJobQueueSettingsForApi();
}
