/** Campos exibidos no painel — persistidos em job_executions.result_json (SQLite + MySQL). */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolvePedidoPanelStatus } = require('../support/utils/resolvePedidoPanelStatus.js');
const {
  PANEL_SNAPSHOT_KEYS,
  parsePanelSnapshotFromText,
} = require('../support/utils/panelSnapshot.js');

const SNAPSHOT_KEYS = PANEL_SNAPSHOT_KEYS;

export function buildJobResultSnapshot(result = {}) {
  if (!result || typeof result !== 'object') return null;
  const snap = {};
  let hasValue = false;
  for (const key of SNAPSHOT_KEYS) {
    const val = result[key];
    if (val != null && val !== '') {
      snap[key] = val;
      hasValue = true;
    }
  }
  return hasValue ? snap : null;
}

export function serializeJobResultSnapshot(result) {
  const snap = buildJobResultSnapshot(result);
  return snap ? JSON.stringify(snap) : null;
}

export function parseJobResultSnapshot(raw) {
  if (raw == null || raw === '') return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Mescla snapshot gravado + parse do stdout (legado + FDL_PANEL_SNAPSHOT). */
export function resolveJobFieldsFromExecutionRow(row, parseStdoutFn) {
  const fromJson = parseJobResultSnapshot(row?.result_json);
  const fromStdout =
    parseStdoutFn && (row?.stdout || row?.stderr)
      ? parseStdoutFn(`${row.stdout || ''}\n${row.stderr || ''}`)
      : {};
  const fromPanelLine = parsePanelSnapshotFromText(`${row?.stdout || ''}\n${row?.stderr || ''}`);
  const merged = { ...fromStdout, ...fromJson, ...(fromPanelLine || {}) };
  const orderStatus = resolvePedidoPanelStatus({
    orderStatus: merged.orderStatus,
    subOrderStatus: merged.subOrderStatus,
    subOrderEmImplantacao: fromStdout.subOrderEmImplantacao ?? merged.subOrderEmImplantacao,
  });

  return {
    orderId: merged.orderId ?? null,
    orderNumber: merged.orderNumber ?? row?.order_number ?? null,
    orderStatus: orderStatus ?? null,
    accountOrganizationId: merged.accountOrganizationId ?? null,
    accountBusinessId: merged.accountBusinessId ?? null,
    accountBillingId: merged.accountBillingId ?? null,
    contactTecnicoId: merged.contactTecnicoId ?? null,
    pegaCaseId: merged.pegaCaseId ?? null,
    pegaCaseIdPontaA: merged.pegaCaseIdPontaA ?? null,
    pegaCaseIdPontaB: merged.pegaCaseIdPontaB ?? null,
    pegaCaseIdEVC: merged.pegaCaseIdEVC ?? null,
    pegaOrdemServicoOs: merged.pegaOrdemServicoOs ?? null,
    pegaOrdemServicoOsPontaA: merged.pegaOrdemServicoOsPontaA ?? null,
    pegaOrdemServicoOsPontaB: merged.pegaOrdemServicoOsPontaB ?? null,
    pegaOrdemServicoOsEVC: merged.pegaOrdemServicoOsEVC ?? null,
    subOrderOrderNumber: merged.subOrderOrderNumber ?? null,
    subOrderOrderNumberPontaA: merged.subOrderOrderNumberPontaA ?? null,
    subOrderOrderNumberPontaB: merged.subOrderOrderNumberPontaB ?? null,
    subOrderOrderNumberEVC: merged.subOrderOrderNumberEVC ?? null,
    orderStatusPollFailed: merged.orderStatusPollFailed === true,
    orderStatusPollError: merged.orderStatusPollError ?? null,
  };
}
