/**
 * Tee de console → arquivo por execução.
 *
 * Layout:
 *   logs/YYYY-MM-DD/<script>-HHmmss-pid[-jobId].log
 *
 * Opt-out: SKIP_RUN_FILE_LOG=1
 * Prefixo máquina (painel/fila): FDL_RUN_LOG:<caminho absoluto>
 */
const fs = require('fs');
const path = require('path');

const RUN_LOG_PREFIX = 'FDL_RUN_LOG:';

const PHASE = {
  SALESFORCE: 'SALESFORCE',
  PEGA: 'PEGA',
  OFS: 'OFS',
  RESUMO: 'RESUMO',
};

let installed = false;
let logPath = '';
let currentPhase = '';
const orig = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stampParts(d = new Date()) {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return {
    dateFolder: `${y}-${mo}-${day}`,
    time: `${h}${mi}${s}`,
    iso: d.toISOString(),
  };
}

function resolveProjectRoot() {
  return process.cwd();
}

function resolveScriptBaseName() {
  const fromEnv = String(process.env.FDL_SCRIPT_NAME || '').trim();
  if (fromEnv) return path.basename(fromEnv, '.js');
  const entry = process.argv[1] ? path.basename(process.argv[1], '.js') : 'script';
  return entry || 'script';
}

function formatArgs(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message || String(a);
      try {
        return JSON.stringify(a, null, 2);
      } catch (_) {
        return String(a);
      }
    })
    .join(' ');
}

function writeRaw(line) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
  } catch (_) {
    /* best-effort */
  }
}

function tee(method, args) {
  const line = formatArgs(args);
  writeRaw(`[${new Date().toISOString()}] ${line}`);
  orig[method](...args);
}

function buildLogFilePath(options = {}) {
  const root = options.root || resolveProjectRoot();
  const { dateFolder, time } = stampParts();
  const script = String(options.scriptName || resolveScriptBaseName())
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'script';
  const jobId = String(options.jobId || process.env.FDL_JOB_ID || '').trim();
  const pid = process.pid;
  const name = jobId
    ? `${script}-${time}-pid${pid}-job${jobId}.log`
    : `${script}-${time}-pid${pid}.log`;
  const dir = path.join(root, 'logs', dateFolder);
  return { dir, filePath: path.join(dir, name), dateFolder, script };
}

/**
 * Instala tee uma vez por processo. Idempotente.
 * @returns {{ logPath: string, dateFolder: string } | null}
 */
function installRunFileLogger(options = {}) {
  if (process.env.SKIP_RUN_FILE_LOG === '1') return null;
  if (installed) return { logPath, dateFolder: path.basename(path.dirname(logPath)) };

  const built = buildLogFilePath(options);
  try {
    fs.mkdirSync(built.dir, { recursive: true });
    fs.writeFileSync(built.filePath, '', 'utf8');
  } catch (err) {
    orig.error('[RUN-LOG] não foi possível criar arquivo de log:', err.message);
    return null;
  }

  logPath = built.filePath;
  installed = true;

  console.log = (...args) => tee('log', args);
  console.info = (...args) => tee('info', args);
  console.warn = (...args) => tee('warn', args);
  console.error = (...args) => tee('error', args);

  const envName = process.env.ENVIRONMENT || process.env.ENV || 'ti';
  const header = [
    '================================================================================',
    `FDL RUN LOG — início ${stampParts().iso}`,
    `Script: ${built.script}`,
    `Arquivo: ${logPath}`,
    `PID: ${process.pid}`,
    `ENV: ${envName}`,
    `cwd: ${process.cwd()}`,
    `argv: ${process.argv.join(' ')}`,
    `INCLUDE_OFS_INSTALACAO: ${process.env.INCLUDE_OFS_INSTALACAO || ''}`,
    `SKIP_PEGA: ${process.env.SKIP_PEGA || ''}`,
    `SKIP_OFS: ${process.env.SKIP_OFS || ''}`,
    `ACCOUNT_ORGANIZATION_ID: ${process.env.ACCOUNT_ORGANIZATION_ID || ''}`,
    `ACCOUNT_BUSINESS_ID: ${process.env.ACCOUNT_BUSINESS_ID || ''}`,
    `ACCOUNT_BILLING_ID: ${process.env.ACCOUNT_BILLING_ID || ''}`,
    '================================================================================',
  ].join('\n');
  writeRaw(header);

  // Emite no stdout (já com tee) para a fila/CLI descobrirem o arquivo
  console.log(`${RUN_LOG_PREFIX}${logPath}`);

  process.once('exit', (code) => {
    finishRunFileLogger({ exitCode: code });
  });
  process.once('SIGINT', () => {
    finishRunFileLogger({ exitCode: 130, note: 'SIGINT' });
  });

  return { logPath, dateFolder: built.dateFolder };
}

function logFlowPhase(phase, detail = '') {
  const name = String(phase || '').toUpperCase() || 'FASE';
  const detailStr = detail ? ` — ${detail}` : '';
  const bar = '==========';
  if (currentPhase && currentPhase !== name) {
    console.log(`\n${bar} FIM FASE: ${currentPhase} ${bar}`);
  }
  currentPhase = name;
  console.log(`\n${bar} FASE: ${name}${detailStr} ${bar}\n`);
}

function getRunLogPath() {
  return logPath || '';
}

function finishRunFileLogger(options = {}) {
  if (!logPath || !installed) return;
  const note = options.note ? ` (${options.note})` : '';
  const code =
    options.exitCode != null ? options.exitCode : process.exitCode != null ? process.exitCode : 0;
  if (currentPhase) {
    writeRaw(`========== FIM FASE: ${currentPhase} ==========`);
    currentPhase = '';
  }
  writeRaw(
    [
      '================================================================================',
      `FDL RUN LOG — fim ${stampParts().iso}${note}`,
      `exitCode: ${code}`,
      `Arquivo: ${logPath}`,
      '================================================================================',
    ].join('\n'),
  );
  // marca fechado sem apagar path (getRunLogPath ainda útil)
  installed = false;
}

module.exports = {
  RUN_LOG_PREFIX,
  PHASE,
  installRunFileLogger,
  logFlowPhase,
  getRunLogPath,
  finishRunFileLogger,
  buildLogFilePath,
};
