/**
 * Mapeia valores da API Salesforce (Order.Status) para rótulos exibidos no painel FDL.
 * Ex.: API "Activated" → UI "Concluída".
 */

const API_TO_DISPLAY = {
  Activated: 'Concluída',
  'In Implementation': 'Em implantação',
  Draft: 'Rascunho',
};

const CONCLUDED_VALUES = [
  'Activated',
  'Concluída',
  'Concluido',
  'Concluído',
  'Completed',
  'Complete',
];

const IMPLANTACAO_VALUES = [
  'Em implantação',
  'Em implementado',
  'In Implementation',
];

function normalizeStatus(status) {
  return String(status || '').trim();
}

function matchesStatusList(status, list) {
  const s = normalizeStatus(status).toLowerCase();
  return list.some((item) => item.toLowerCase() === s);
}

function isOrderConcludedStatus(status) {
  return matchesStatusList(status, CONCLUDED_VALUES);
}

function isOrderImplantacaoStatus(status) {
  return matchesStatusList(status, IMPLANTACAO_VALUES);
}

/** Rótulo amigável para o painel (prioriza displayValue sobre value da API). */
function formatOrderStatusForPanel(status) {
  const raw = normalizeStatus(status);
  if (!raw) return null;
  if (API_TO_DISPLAY[raw]) return API_TO_DISPLAY[raw];
  const mappedKey = Object.keys(API_TO_DISPLAY).find((k) => k.toLowerCase() === raw.toLowerCase());
  if (mappedKey) return API_TO_DISPLAY[mappedKey];
  if (isOrderConcludedStatus(raw)) return 'Concluída';
  return raw;
}

function resolvePanelStatusFromSfRecords(records = []) {
  const statuses = records.map((r) => normalizeStatus(r.Status)).filter(Boolean);
  if (!statuses.length) return null;
  if (statuses.every(isOrderConcludedStatus)) return 'Concluída';
  const implantacao = statuses.find(isOrderImplantacaoStatus);
  if (implantacao) return formatOrderStatusForPanel(implantacao);
  return formatOrderStatusForPanel(statuses[0]);
}

module.exports = {
  API_TO_DISPLAY,
  normalizeStatus,
  isOrderConcludedStatus,
  isOrderImplantacaoStatus,
  formatOrderStatusForPanel,
  resolvePanelStatusFromSfRecords,
};
