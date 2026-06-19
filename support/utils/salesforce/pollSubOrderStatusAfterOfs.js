const { createSalesforceScriptClient } = require('./scriptHttpClient.js');
const { QUERY_URL } = require('./sfRestPaths.js');
const { delay } = require('../helpers/waitHelper.js');
const { emitPanelSnapshot } = require('../panelSnapshot.js');
const {
  normalizeStatus,
  isOrderConcludedStatus,
  resolvePanelStatusFromSfRecords,
} = require('../orderStatusLabels.js');

const ORDER_STATUS_POLL_ERROR =
  'O status da ordem não foi alterado para "Concluída" no Salesforce dentro do tempo esperado.';

function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function collectSubOrderNumbers(result = {}) {
  const nums = [];
  for (const key of [
    'subOrderOrderNumber',
    'subOrderOrderNumberPontaA',
    'subOrderOrderNumberPontaB',
    'subOrderOrderNumberEVC',
  ]) {
    const v = result[key];
    if (v != null && String(v).trim()) nums.push(String(v).trim());
  }
  return [...new Set(nums)];
}

function shouldPollAfterOfs(result = {}) {
  if (process.env.SKIP_OFS_POST_STATUS_POLL === '1') return false;
  if (process.env.INCLUDE_OFS_INSTALACAO !== '1' && process.env.OFS_ENABLE !== '1') return false;
  if (process.env.SKIP_OFS === '1') return false;
  if (result.ofsInstalacaoConcluida !== true) return false;
  return collectSubOrderNumbers(result).length > 0 || Boolean(result.orderId);
}

async function querySubOrders(apiCall, result) {
  const numbers = collectSubOrderNumbers(result);
  if (numbers.length) {
    const inList = numbers.map((n) => `'${String(n).replace(/'/g, "\\'")}'`).join(',');
    const q = `SELECT Id, OrderNumber, Status FROM Order WHERE OrderNumber IN (${inList})`;
    const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
    if (res.status === 200 && res.data?.records?.length) return res.data.records;
  }
  if (result.orderId) {
    const q = `SELECT Id, OrderNumber, Status FROM Order WHERE vlocity_cmt__ParentOrderId__c = '${String(result.orderId).replace(/'/g, "\\'")}'`;
    const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
    if (res.status === 200 && res.data?.records?.length) return res.data.records;
  }
  return [];
}

/**
 * Após OFS concluído, consulta Salesforce até o subpedido refletir conclusão (API: Activated → painel: Concluída).
 */
async function pollSubOrderStatusAfterOfs(result = {}) {
  if (!shouldPollAfterOfs(result)) return result;

  const intervalMs = envInt('OFS_SF_STATUS_POLL_MS', 10_000);
  const maxMs = envInt('OFS_SF_STATUS_POLL_MAX_MS', 300_000);
  const sf = createSalesforceScriptClient();

  let apiCall;
  try {
    const { accessToken, instanceUrl } = await sf.getToken();
    apiCall = sf.apiCall(instanceUrl, accessToken, sf.cookie);
  } catch (err) {
    console.warn('[E2E] Poll status pós-OFS: falha ao autenticar Salesforce —', err.message || err);
    return result;
  }

  console.log(
    `[E2E] Pós-OFS — aguardando status concluído no Salesforce (Activated/Concluída; a cada ${intervalMs / 1000}s, máx ${maxMs / 1000}s)...`,
  );

  let merged = { ...result };
  emitPanelSnapshot(merged);

  const deadline = Date.now() + maxMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const records = await querySubOrders(apiCall, merged);
      if (records.length) {
        const rawStatuses = records.map((r) => normalizeStatus(r.Status)).filter(Boolean);
        const panelStatus = resolvePanelStatusFromSfRecords(records);
        const detail = records
          .map((r) => `${r.OrderNumber}=${normalizeStatus(r.Status) || '?'}`)
          .join(', ');
        console.log(`[E2E] Poll status Salesforce #${attempt}: ${detail}`);

        if (panelStatus) {
          const concluida = rawStatuses.length > 0 && rawStatuses.every(isOrderConcludedStatus);
          merged = {
            ...merged,
            subOrderStatus: panelStatus,
            subOrderEmImplantacao: concluida ? false : merged.subOrderEmImplantacao,
            orderStatusPollFailed: false,
            orderStatusPollError: null,
          };
          emitPanelSnapshot(merged);
          if (concluida) {
            console.log(
              `[E2E] Subpedido(s) concluído(s) no Salesforce (${detail}) — painel: "${panelStatus}".`,
            );
            return merged;
          }
        }
      } else {
        console.log(`[E2E] Poll status Salesforce #${attempt}: subpedido ainda não encontrado na consulta.`);
      }
    } catch (err) {
      console.warn(`[E2E] Poll status Salesforce #${attempt} falhou:`, err.message || err);
    }

    await delay(intervalMs);
  }

  console.log('[E2E] Timeout aguardando status concluído no Salesforce — mantendo último status conhecido.');
  merged = {
    ...merged,
    orderStatusPollFailed: true,
    orderStatusPollError: ORDER_STATUS_POLL_ERROR,
  };
  console.log(`[E2E] ERRO: ${ORDER_STATUS_POLL_ERROR}`);
  emitPanelSnapshot(merged);
  return merged;
}

module.exports = {
  pollSubOrderStatusAfterOfs,
  shouldPollAfterOfs,
  isConcluidaStatus: isOrderConcludedStatus,
  resolvePanelStatusFromRecords: resolvePanelStatusFromSfRecords,
  ORDER_STATUS_POLL_ERROR,
};
