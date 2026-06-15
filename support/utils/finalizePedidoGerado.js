const { enrichPedidoComPegaOrdem } = require('./enrichPedidoComPegaOrdem.js');
const { enrichPedidoResultForPanel } = require('./resolvePedidoPanelStatus.js');
const { logPedidoGerado } = require('./logPedidoGerado.js');

/** Enriquece com ordem OSS do PEGA (se ainda não tiver) e emite log padronizado para o painel FDL. */
async function finalizePedidoGerado(result = {}) {
  const enriched = await enrichPedidoComPegaOrdem(result);
  const forPanel = enrichPedidoResultForPanel(enriched);
  logPedidoGerado(forPanel);
  return forPanel;
}

module.exports = { finalizePedidoGerado };
