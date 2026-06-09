import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { registerJobProcess, unregisterJobProcess, wasJobCancelled } from './jobCancelRegistry.js';

export function runVtalScript(scriptName, environment, envVars = {}, options = {}) {
  const jobId = options.jobId != null ? String(options.jobId) : null;
  const scriptPath = path.join(config.vtalPath, 'scripts', scriptName);
  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: `Script não encontrado: ${scriptPath}. Verifique se foi copiado para o FDL VTAL.`,
      orderId: null,
      orderNumber: null,
      orderStatus: null,
      pegaCaseId: null,
      pegaOrdemServicoOs: null,
    });
  }

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ENVIRONMENT: environment || 'ti',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      ...envVars,
    };

    const child = spawn('node', [scriptPath], {
      cwd: config.vtalPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (jobId) registerJobProcess(jobId, child);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[SCRIPT ${scriptName}] ${text}`);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(`[SCRIPT ${scriptName} STDERR] ${text}`);
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        error: err.message,
        orderId: null,
        orderNumber: null,
        orderStatus: null,
        pegaCaseId: null,
        pegaOrdemServicoOs: null,
      });
    });

    child.on('close', (code, signal) => {
      const cancelled =
        wasJobCancelled(jobId) || signal === 'SIGTERM' || signal === 'SIGKILL';
      if (jobId) unregisterJobProcess(jobId);
      const success = !cancelled && code === 0;
      const orderId = parseOrderId(stdout);
      const orderNumber = parseOrderNumber(stdout);
      const orderStatus = parseOrderStatus(stdout);
      const accountBillingId = parseAccountBillingId(stdout);
      const accountBusinessId = parseAccountBusinessId(stdout);
      const accountOrganizationId = parseAccountOrganizationId(stdout);
      const contactTecnicoId = parseContactTecnicoId(stdout);
      const pegaCaseId = parsePegaCaseId(stdout);
      const pegaOrdemServicoOs = parsePegaOrdemServicoOs(stdout);

      resolve({
        success,
        cancelled,
        exitCode: code,
        signal: signal || null,
        stdout,
        stderr,
        error: cancelled
          ? null
          : success
            ? null
            : buildScriptFailureMessage(stderr, stdout, code),
        orderId,
        orderNumber,
        orderStatus,
        accountBillingId,
        accountBusinessId,
        accountOrganizationId,
        contactTecnicoId,
        pegaCaseId,
        pegaOrdemServicoOs,
      });
    });
  });
}

/** Mensagem exibida no front quando o script falha; stderr nem sempre vem preenchido. */
function buildScriptFailureMessage(stderr, stdout, code) {
  const err = (stderr || '').trim();
  if (err) return err;
  const lines = (stdout || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/ERRO|\[BRM\]|BRM não preenchido|Falha \(TI\)/i.test(line)) {
      return line.length > 2000 ? `${line.slice(0, 2000)}…` : line;
    }
  }
  return `Exit code ${code}`;
}

function parseOrderId(text) {
  const m = text.match(/OrderId:\s*([A-Za-z0-9]{15,18})/);
  return m ? m[1].trim() : null;
}

function parseOrderNumber(text) {
  const m = text.match(/OrderNumber:\s*(\S+)/);
  return m ? m[1].trim() : null;
}

function parseOrderStatus(text) {
  const m = text.match(/Status:\s*(\S+)/);
  return m ? m[1].trim() : null;
}

function parseAccountBillingId(text) {
  const m = text.match(/AccountBillingId:\s*([A-Za-z0-9]{15,18})/);
  return m ? m[1].trim() : null;
}

function parseAccountBusinessId(text) {
  const m = text.match(/AccountBusinessId:\s*([A-Za-z0-9]{15,18})/);
  return m ? m[1].trim() : null;
}

function parseAccountOrganizationId(text) {
  const m = text.match(/AccountOrganizationId:\s*([A-Za-z0-9]{15,18})/);
  return m ? m[1].trim() : null;
}

function parseContactTecnicoId(text) {
  const m = text.match(/ContactTecnicoId:\s*([A-Za-z0-9]{15,18})/);
  return m ? m[1].trim() : null;
}

/** Linhas emitidas pelo script PEGA (stdout pode vir prefixado com `[SCRIPT …] `). */
function parsePegaCaseId(text) {
  let m = text.match(/^\s*PEGA:\s*(A-\d+)\s*$/m);
  if (m) return m[1].trim();
  m = text.match(/PEGA:\s*(A-\d+)/);
  if (m) return m[1].trim();
  m = text.match(/PegaCaseId:\s*(A-\d+)/);
  return m ? m[1].trim() : null;
}

function parsePegaOrdemServicoOs(text) {
  const m = text.match(/PEGA OS:\s*(OS-\d+)/);
  return m ? m[1].trim() : null;
}
