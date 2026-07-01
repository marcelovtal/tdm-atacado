import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { config } from './config.js';
import { registerJobProcess, unregisterJobProcess, wasJobCancelled } from './jobCancelRegistry.js';
import { sanitizeJobErrorMessage } from './jobError.js';
import { classifyUserJobError } from './classifyUserJobError.js';

const require = createRequire(import.meta.url);
const { resolvePedidoPanelStatus } = require('../support/utils/resolvePedidoPanelStatus.js');
const { parsePanelSnapshotFromText } = require('../support/utils/panelSnapshot.js');

function parseLabeledField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`${escaped}:\\s*(\\S+)`, 'i'));
  return m ? m[1].trim() : null;
}

function parseOfsInstalacaoConcluida(text) {
  const m = text.match(/OFS Instalação concluída:\s*(sim|não|nao)/i);
  if (!m) return null;
  return /^sim$/i.test(m[1].trim());
}

const PEGA_CASE_ID_RE = '(?:A|ATV|PNT|EVC)-\\d+';

/** Linhas `[PEGA] Ponta A: OS-… | Caso: ATV-…` emitidas por enrichPedidoComPegaOrdem. */
function parsePegaEnrichLegFields(text) {
  const out = {};
  const legs = [
    { label: 'Ponta A', osKey: 'pegaOrdemServicoOsPontaA', caseKey: 'pegaCaseIdPontaA' },
    { label: 'Ponta B', osKey: 'pegaOrdemServicoOsPontaB', caseKey: 'pegaCaseIdPontaB' },
    { label: 'EVC', osKey: 'pegaOrdemServicoOsEVC', caseKey: 'pegaCaseIdEVC' },
  ];
  for (const { label, osKey, caseKey } of legs) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(
      new RegExp(
        `\\[PEGA\\]\\s+${esc}:\\s*(?:(OS-\\d+)(?:\\s*\\|\\s*Caso:\\s*(${PEGA_CASE_ID_RE}))?|(?:[^|\\n]*\\|\\s*)?Caso:\\s*(${PEGA_CASE_ID_RE}))`,
        'i',
      ),
    );
    if (!m) continue;
    const os = m[1] ? m[1].trim().toUpperCase() : null;
    const caseId = (m[2] || m[3] || '').trim() || null;
    if (os) out[osKey] = os;
    if (caseId) out[caseKey] = caseId;
  }
  return out;
}

/** Bloco `*** PEGA Link Dedicado ***` — `Ponta A caseId:` antes do `logPedidoGerado`. */
function parsePegaLdConsoleLegFields(text) {
  const out = {};
  const legs = [
    { label: 'Ponta A', caseKey: 'pegaCaseIdPontaA', osKey: 'pegaOrdemServicoOsPontaA' },
    { label: 'Ponta B', caseKey: 'pegaCaseIdPontaB', osKey: 'pegaOrdemServicoOsPontaB' },
    { label: 'EVC', caseKey: 'pegaCaseIdEVC', osKey: 'pegaOrdemServicoOsEVC' },
  ];
  for (const { label, caseKey, osKey } of legs) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const caseM = text.match(new RegExp(`${esc} caseId:\\s*(${PEGA_CASE_ID_RE})`, 'i'));
    if (caseM) out[caseKey] = caseM[1].trim();
    const osM = text.match(new RegExp(`${esc} OS:\\s*(OS-\\d+)`, 'i'));
    if (osM) out[osKey] = osM[1].trim().toUpperCase();
  }
  return out;
}

/** Parse stdout/stderr do script — reutilizado na fila e no histórico do banco. */
export function parseScriptStdout(text) {
  const enrichLegs = parsePegaEnrichLegFields(text);
  const ldConsoleLegs = parsePegaLdConsoleLegFields(text);
  const panelSnapshot = parsePanelSnapshotFromText(text) || {};
  const pegaOrdemServicoOsPontaA =
    panelSnapshot.pegaOrdemServicoOsPontaA ||
    parseLabeledField(text, 'PEGA OS Ponta A') ||
    ldConsoleLegs.pegaOrdemServicoOsPontaA ||
    enrichLegs.pegaOrdemServicoOsPontaA ||
    null;
  const pegaOrdemServicoOsPontaB =
    panelSnapshot.pegaOrdemServicoOsPontaB ||
    parseLabeledField(text, 'PEGA OS Ponta B') ||
    ldConsoleLegs.pegaOrdemServicoOsPontaB ||
    enrichLegs.pegaOrdemServicoOsPontaB ||
    null;
  const pegaOrdemServicoOsEVC =
    panelSnapshot.pegaOrdemServicoOsEVC ||
    parseLabeledField(text, 'PEGA OS EVC') ||
    ldConsoleLegs.pegaOrdemServicoOsEVC ||
    enrichLegs.pegaOrdemServicoOsEVC ||
    null;
  const pegaCaseIdPontaA =
    panelSnapshot.pegaCaseIdPontaA ||
    parseLabeledField(text, 'PEGA Caso Ponta A') ||
    parseLabeledField(text, 'Ponta A caseId') ||
    ldConsoleLegs.pegaCaseIdPontaA ||
    enrichLegs.pegaCaseIdPontaA ||
    null;
  const pegaCaseIdPontaB =
    panelSnapshot.pegaCaseIdPontaB ||
    parseLabeledField(text, 'PEGA Caso Ponta B') ||
    parseLabeledField(text, 'Ponta B caseId') ||
    ldConsoleLegs.pegaCaseIdPontaB ||
    enrichLegs.pegaCaseIdPontaB ||
    null;
  const pegaCaseIdEVC =
    panelSnapshot.pegaCaseIdEVC ||
    parseLabeledField(text, 'PEGA Caso EVC') ||
    parseLabeledField(text, 'EVC caseId') ||
    ldConsoleLegs.pegaCaseIdEVC ||
    enrichLegs.pegaCaseIdEVC ||
    null;
  const pegaOrdemServicoOs =
    parsePegaOrdemServicoOs(text) ||
    pegaOrdemServicoOsEVC ||
    pegaOrdemServicoOsPontaA ||
    pegaOrdemServicoOsPontaB ||
    null;

  const subOrderEmImplantacao = parseSubOrderEmImplantacao(text);
  const rawOrderStatus = parseOrderStatus(text);
  const subOrderStatus = parseSubOrderStatus(text);

  return {
    orderId: panelSnapshot.orderId || parseOrderId(text),
    orderNumber: panelSnapshot.orderNumber || parseOrderNumber(text),
    orderStatus: resolvePedidoPanelStatus({
      orderStatus: panelSnapshot.orderStatus || rawOrderStatus,
      subOrderStatus: panelSnapshot.subOrderStatus || subOrderStatus,
      subOrderEmImplantacao,
    }),
    subOrderStatus: panelSnapshot.subOrderStatus || subOrderStatus,
    subOrderEmImplantacao,
    accountBillingId: panelSnapshot.accountBillingId || parseAccountBillingId(text),
    accountBusinessId: panelSnapshot.accountBusinessId || parseAccountBusinessId(text),
    accountOrganizationId: panelSnapshot.accountOrganizationId || parseAccountOrganizationId(text),
    contactTecnicoId: panelSnapshot.contactTecnicoId || parseContactTecnicoId(text),
    pegaCaseId: parsePegaCaseId(text) || pegaCaseIdPontaA || pegaCaseIdEVC || pegaCaseIdPontaB || null,
    pegaCaseIdPontaA,
    pegaCaseIdPontaB,
    pegaCaseIdEVC,
    subOrderOrderNumber: parseSubpedidoOrderNumber(text),
    pegaOrdemServicoOs,
    pegaOrdemServicoOsPontaA,
    pegaOrdemServicoOsPontaB,
    pegaOrdemServicoOsEVC,
    subOrderOrderNumberPontaA:
      panelSnapshot.subOrderOrderNumberPontaA ||
      parseLabeledField(text, 'SubpedidoOrderNumber Ponta A'),
    subOrderOrderNumberPontaB:
      panelSnapshot.subOrderOrderNumberPontaB ||
      parseLabeledField(text, 'SubpedidoOrderNumber Ponta B'),
    subOrderOrderNumberEVC:
      panelSnapshot.subOrderOrderNumberEVC ||
      parseLabeledField(text, 'SubpedidoOrderNumber EVC'),
    ofsActivityId: parseLabeledField(text, 'OFS ActivityId'),
    ofsActivityStatus: parseLabeledField(text, 'OFS Status'),
    ofsInstalacaoConcluida: parseOfsInstalacaoConcluida(text),
    orderStatusPollFailed: panelSnapshot.orderStatusPollFailed === true || parseOrderStatusPollFailed(text),
    orderStatusPollError: panelSnapshot.orderStatusPollError || parseOrderStatusPollError(text),
  };
}

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
      pegaOrdemServicoOsPontaA: null,
      pegaOrdemServicoOsPontaB: null,
      pegaOrdemServicoOsEVC: null,
      subOrderOrderNumber: null,
      subOrderOrderNumberPontaA: null,
      subOrderOrderNumberPontaB: null,
      subOrderOrderNumberEVC: null,
    });
  }

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ENVIRONMENT: environment || 'ti',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_NO_WARNINGS: '1',
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
      if (options.onStdoutChunk) {
        try {
          options.onStdoutChunk(stdout);
        } catch (_) {
          /* best-effort live snapshot */
        }
      }
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
        pegaOrdemServicoOsPontaA: null,
        pegaOrdemServicoOsPontaB: null,
        pegaOrdemServicoOsEVC: null,
        subOrderOrderNumber: null,
        subOrderOrderNumberPontaA: null,
        subOrderOrderNumberPontaB: null,
        subOrderOrderNumberEVC: null,
      });
    });

    child.on('close', (code, signal) => {
      const cancelled =
        wasJobCancelled(jobId) || signal === 'SIGTERM' || signal === 'SIGKILL';
      if (jobId) unregisterJobProcess(jobId);
      const success = !cancelled && code === 0;
      const parsed = parseScriptStdout(`${stdout}\n${stderr}`);

      let error = cancelled
        ? null
        : success
          ? null
          : buildScriptFailureMessage(stderr, stdout, code);
      let userError = false;
      let userErrorCode = null;
      if (!cancelled && !success) {
        const classified = classifyUserJobError({
          stderr,
          stdout,
          environment,
          envVars,
        });
        if (classified?.message) {
          error = classified.message;
          if (classified.userError) {
            userError = true;
            userErrorCode = classified.code;
          }
        }
      }

      resolve({
        success,
        cancelled,
        exitCode: code,
        signal: signal || null,
        stdout,
        stderr,
        error,
        userError,
        userErrorCode,
        ...parsed,
      });
    });
  });
}

/** Mensagem exibida no front quando o script falha; stderr nem sempre vem preenchido. */
function buildScriptFailureMessage(stderr, stdout, code) {
  const combined = `${stderr || ''}\n${stdout || ''}`;
  const errRuns = combined
    .split(/(?=ERRO \(run \d+\):)/)
    .map((s) => s.trim())
    .filter((s) => /^ERRO \(run \d+\):/.test(s));
  if (errRuns.length) {
    const last = sanitizeJobErrorMessage(
      errRuns[errRuns.length - 1]
        .replace(/\nStatus:\s*0\s*\nBody:\s*undefined\s*/g, '\n')
        .trim(),
    );
    if (last) return last.length > 2500 ? `${last.slice(0, 2500)}…` : last;
  }

  const err = sanitizeJobErrorMessage((stderr || '').trim());
  if (err) return err.length > 2500 ? `${err.slice(0, 2500)}…` : err;
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

function extractPedidoGeradoBlock(text) {
  const m = text.match(/\*\*\* PEDIDO GERADO \*\*\*([\s\S]*?)(?=\n\*\*\*|\n={5,}|$)/);
  return m ? m[1] : null;
}

function parseOrderStatus(text) {
  const block = extractPedidoGeradoBlock(text);
  const src = block || text;
  const m = src.match(/^\s+Status:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function parseSubOrderStatus(text) {
  const panelSnapshot = parsePanelSnapshotFromText(text);
  if (panelSnapshot?.subOrderStatus) return String(panelSnapshot.subOrderStatus).trim();
  const block = extractPedidoGeradoBlock(text);
  const src = block || text;
  const m = src.match(/^\s+SubOrderStatus:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function parseSubOrderEmImplantacao(text) {
  const block = extractPedidoGeradoBlock(text);
  const src = block || text;
  const m = src.match(/Subpedido "Em implantação":\s*(sim|não|nao)/i);
  if (!m) return null;
  return /^sim$/i.test(m[1].trim());
}

function parseOrderStatusPollFailed(text) {
  const block = extractPedidoGeradoBlock(text);
  const src = block || text;
  return /^\s+ERRO status ordem:/m.test(src) || /\[E2E\] ERRO:.*status da ordem não foi alterado/i.test(text);
}

function parseOrderStatusPollError(text) {
  const block = extractPedidoGeradoBlock(text);
  const src = block || text;
  const fromBlock = src.match(/^\s+ERRO status ordem:\s*(.+)$/m);
  if (fromBlock) return fromBlock[1].trim();
  const fromLog = text.match(/\[E2E\] ERRO:\s*(.+)$/m);
  return fromLog ? fromLog[1].trim() : null;
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
  let m = text.match(new RegExp(`^\\s*PEGA:\\s*(${PEGA_CASE_ID_RE})\\s*$`, 'm'));
  if (m) return m[1].trim();
  m = text.match(new RegExp(`PEGA:\\s*(${PEGA_CASE_ID_RE})`));
  if (m) return m[1].trim();
  m = text.match(new RegExp(`PegaCaseId:\\s*(${PEGA_CASE_ID_RE})`));
  return m ? m[1].trim() : null;
}

function parsePegaOrdemServicoOs(text) {
  let m = text.match(/PEGA OS:\s*(OS-\d+)/i);
  if (m) return m[1].trim().toUpperCase();
  m = text.match(/PegaOrdemServicoOs:\s*(OS-\d+)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

function parseSubpedidoOrderNumber(text) {
  let m = text.match(/SubpedidoOrderNumber:\s*(\S+)/i);
  if (m) return m[1].trim();
  m = text.match(/Subpedido OrderNumber \(PEGA ORDEMSERVICO\):\s*(\S+)/i);
  return m ? m[1].trim() : null;
}
