/** Campos persistidos no painel FDL — espelham server/jobResultSnapshot.js */

const PANEL_SNAPSHOT_PREFIX = 'FDL_PANEL_SNAPSHOT:';

const PANEL_SNAPSHOT_KEYS = [
  'orderId',
  'orderNumber',
  'orderStatus',
  'accountOrganizationId',
  'accountBusinessId',
  'accountBillingId',
  'contactTecnicoId',
  'pegaCaseId',
  'pegaCaseIdPontaA',
  'pegaCaseIdPontaB',
  'pegaCaseIdEVC',
  'pegaOrdemServicoOs',
  'pegaOrdemServicoOsPontaA',
  'pegaOrdemServicoOsPontaB',
  'pegaOrdemServicoOsEVC',
  'subOrderOrderNumber',
  'subOrderOrderNumberPontaA',
  'subOrderOrderNumberPontaB',
  'subOrderOrderNumberEVC',
];

function buildPanelSnapshotPayload(result = {}) {
  if (!result || typeof result !== 'object') return null;
  const snap = {};
  let hasValue = false;
  for (const key of PANEL_SNAPSHOT_KEYS) {
    const val = result[key];
    if (val != null && val !== '') {
      snap[key] = val;
      hasValue = true;
    }
  }
  return hasValue ? snap : null;
}

function parsePanelSnapshotFromText(text) {
  const raw = String(text || '');
  const marker = PANEL_SNAPSHOT_PREFIX;
  const idx = raw.lastIndexOf(marker);
  if (idx < 0) return null;
  const line = raw.slice(idx + marker.length).split(/\r?\n/)[0].trim();
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  PANEL_SNAPSHOT_PREFIX,
  PANEL_SNAPSHOT_KEYS,
  buildPanelSnapshotPayload,
  parsePanelSnapshotFromText,
};
