const { extractLinkDedicadoSubpedidos } = require('../extractLinkDedicadoSubpedidos.js');

/** Status aceitos como subpedido pronto para PEGA / OM. "OS aberta" não é suficiente. */
const SUB_ORDER_IMPLANTACAO_STATUSES = ['Em implantação', 'Em implementado', 'In Implementation'];

const SUB_ORDER_SOQL_FIELDS =
  'Id, OrderNumber, Status, vtal_LXD_Produto_do_pedido__c, Vtal_Seg_PointType__c';

function isSubOrderEmImplantacao(status) {
  return SUB_ORDER_IMPLANTACAO_STATUSES.includes(String(status || '').trim());
}

function formatPendingSubOrders(subOrders) {
  const pending = (subOrders || []).filter((s) => !isSubOrderEmImplantacao(s.Status));
  const list = pending.length ? pending : subOrders || [];
  return list
    .map((s) => `${s.OrderNumber || s.Id} (${s.Vtal_Seg_PointType__c || 'N/A'}): ${s.Status || '—'}`)
    .join('; ');
}

function buildSubOrderTimeoutIntegrationError(subOrders, timeoutSec) {
  const detail = formatPendingSubOrders(subOrders);
  return (
    `[FDL_INTEGRATION_ERROR] Não foi alterado o status da ordem para "Em implantação" após ${Math.round(timeoutSec)}s. ` +
    'Erro no Salesforce ou no Pega.' +
    (detail ? ` Sub-pedidos: ${detail}.` : '')
  );
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
    fail(buildSubOrderTimeoutIntegrationError(lastSubOrders, timeoutMs / 1000));
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
  buildSubOrderTimeoutIntegrationError,
  pollSubpedidosEmImplantacao,
};
