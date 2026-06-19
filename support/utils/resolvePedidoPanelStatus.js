const {
  formatOrderStatusForPanel,
  isOrderConcludedStatus,
} = require('./orderStatusLabels.js');

/** Status exibido no painel: prioriza subpedido (Em implantação) sobre pedido pai (Draft). */
function resolvePedidoPanelStatus(result = {}) {
  const sub = String(result.subOrderStatus || '').trim();
  if (sub) return formatOrderStatusForPanel(sub);
  if (result.subOrderEmImplantacao === true) return 'Em implantação';
  return formatOrderStatusForPanel(result.orderStatus);
}

function enrichPedidoResultForPanel(result = {}) {
  const panelStatus = resolvePedidoPanelStatus(result);
  const concluded = panelStatus && isOrderConcludedStatus(panelStatus);
  const next = { ...result };
  if (panelStatus != null) {
    next.orderStatus = panelStatus;
    if (next.subOrderStatus) next.subOrderStatus = formatOrderStatusForPanel(next.subOrderStatus);
  }
  if (concluded) {
    next.orderStatusPollFailed = false;
    next.orderStatusPollError = null;
  }
  return next;
}

module.exports = { resolvePedidoPanelStatus, enrichPedidoResultForPanel };
