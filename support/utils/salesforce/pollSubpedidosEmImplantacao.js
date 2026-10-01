const { extractLinkDedicadoSubpedidos } = require('../extractLinkDedicadoSubpedidos.js');
const { emitPanelSnapshot } = require('../panelSnapshot.js');

/** Status aceitos como subpedido pronto para PEGA / OM. "OS aberta" não é suficiente. */
const SUB_ORDER_IMPLANTACAO_STATUSES = ['Em implantação', 'Em implementado', 'In Implementation'];

const SUB_ORDER_SOQL_FIELDS =
  'Id, OrderNumber, Status, vtal_LXD_Produto_do_pedido__c, Vtal_Seg_PointType__c';

function isSubOrderEmImplantacao(status) {
  return SUB_ORDER_IMPLANTACAO_STATUSES.includes(String(status || '').trim());
}

function pointLabelForSubOrder(sub, allSubOrders) {
  const typed = String(sub?.Vtal_Seg_PointType__c || '').trim();
  if (typed) return typed;
  const extracted = extractLinkDedicadoSubpedidos(allSubOrders || []);
  const num = String(sub?.OrderNumber || '');
  if (num && num === String(extracted.subOrderOrderNumberPontaA || '')) return 'Ponta A';
  if (num && num === String(extracted.subOrderOrderNumberPontaB || '')) return 'Ponta B';
  if (num && num === String(extracted.subOrderOrderNumberEVC || '')) return 'EVC';
  return String(sub?.vtal_LXD_Produto_do_pedido__c || '').trim() || 'N/A';
}

function formatPendingSubOrders(subOrders) {
  const pending = (subOrders || []).filter((s) => !isSubOrderEmImplantacao(s.Status));
  const list = pending.length ? pending : subOrders || [];
  return list
    .map((s) => `${s.OrderNumber || s.Id} (${pointLabelForSubOrder(s, subOrders)}): ${s.Status || '—'}`)
    .join('; ');
}

/** Status único quando todos iguais (ex.: "OS aberta"); senão lista distinta. */
function summarizeFinalStatuses(subOrders) {
  const statuses = [
    ...new Set(
      (subOrders || [])
        .map((s) => String(s.Status || '').trim())
        .filter(Boolean),
    ),
  ];
  if (!statuses.length) return '';
  return statuses.join(', ');
}

function buildPanelEnvErrorMessage(subOrders) {
  const finalStatus = summarizeFinalStatuses(subOrders);
  const detail = formatPendingSubOrders(subOrders);
  let msg =
    'Não foi alterado o status da ordem para "Em implantação". Erro no Salesforce ou no Pega.';
  if (finalStatus) msg += ` Status final: ${finalStatus}.`;
  if (detail) msg += ` Sub-pedidos: ${detail}.`;
  return msg;
}

function buildSubOrderTimeoutIntegrationError(subOrders, timeoutSec) {
  const panelMsg = buildPanelEnvErrorMessage(subOrders);
  return `[FDL_ENV_ERROR] ${panelMsg} (timeout ${Math.round(timeoutSec)}s)`;
}

/**
 * Aguarda todos os subpedidos atingirem "Em implantação". Em timeout, fail() com mensagem para o painel.
 */
async function pollSubpedidosEmImplantacao({
  apiCall,
  queryUrl,
  parentOrderId,
  delay,
  fail,
  logPrefix = '[E2E]',
  timeoutMs = 240000,
  intervalMs = 5000,
  partialSnapshot = null,
}) {
  console.log(`${logPrefix} 20. Poll subpedidos até TODOS estarem com status "Em implantação"...`);
  const subOrderQuery =
    `SELECT ${SUB_ORDER_SOQL_FIELDS} FROM Order WHERE vlocity_cmt__ParentOrderId__c='${parentOrderId}'`;
  let allReady = false;
  let lastSubOrders = [];
  const pollStart = Date.now();

  while (!allReady && Date.now() - pollStart < timeoutMs) {
    const qRes = await apiCall('GET', `${queryUrl}?q=${encodeURIComponent(subOrderQuery)}`);
    if (qRes.status === 200 && qRes.data?.records?.length > 0) {
      lastSubOrders = qRes.data.records;
      console.log('   Status atual dos subpedidos:');
      lastSubOrders.forEach((sub) => {
        console.log(
          `     - ${sub.OrderNumber} (${sub.Vtal_Seg_PointType__c || 'N/A'}): ${sub.Status || 'Draft'}`,
        );
      });
      allReady = lastSubOrders.every((sub) => isSubOrderEmImplantacao(sub.Status));
      if (allReady) {
        console.log('   TODOS os subpedidos estão em "Em implantação".');
        break;
      }
      const pendingCount = lastSubOrders.filter((s) => !isSubOrderEmImplantacao(s.Status)).length;
      console.log(`   Aguardando ${pendingCount} subpedido(s)...`);
    }
    if (!allReady) await delay(intervalMs);
  }

  if (!allReady) {
    const pollError = buildSubOrderTimeoutIntegrationError(lastSubOrders, timeoutMs / 1000);
    const panelMsg = buildPanelEnvErrorMessage(lastSubOrders);
    const finalStatus = summarizeFinalStatuses(lastSubOrders);
    const ldSub = extractLinkDedicadoSubpedidos(lastSubOrders);
    console.log(`${logPrefix} Status final dos subpedidos: ${finalStatus || '—'}`);
    if (partialSnapshot) {
      emitPanelSnapshot({
        ...partialSnapshot,
        ...ldSub,
        orderStatus: finalStatus || partialSnapshot.orderStatus || null,
        subOrderStatus: finalStatus || null,
        orderStatusPollFailed: true,
        orderStatusPollError: panelMsg,
      });
    }
    fail(pollError);
  }

  return {
    subOrders: lastSubOrders,
    subOrderEmImplantacao: true,
    ...extractLinkDedicadoSubpedidos(lastSubOrders),
  };
}

module.exports = {
  SUB_ORDER_IMPLANTACAO_STATUSES,
  isSubOrderEmImplantacao,
  summarizeFinalStatuses,
  buildPanelEnvErrorMessage,
  buildSubOrderTimeoutIntegrationError,
  pollSubpedidosEmImplantacao,
};
