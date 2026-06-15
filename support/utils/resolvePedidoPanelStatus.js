/** Status exibido no painel: prioriza subpedido (Em implantação) sobre pedido pai (Draft). */
function resolvePedidoPanelStatus(result = {}) {
  const sub = String(result.subOrderStatus || '').trim();
  if (sub) return sub;
  if (result.subOrderEmImplantacao === true) return 'Em implantação';
  return result.orderStatus ?? null;
}

function enrichPedidoResultForPanel(result = {}) {
  const panelStatus = resolvePedidoPanelStatus(result);
  if (panelStatus == null || panelStatus === result.orderStatus) {
    return result;
  }
  return { ...result, orderStatus: panelStatus };
}

module.exports = { resolvePedidoPanelStatus, enrichPedidoResultForPanel };
