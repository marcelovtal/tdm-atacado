const { enrichPedidoComPegaOrdem } = require('./enrichPedidoComPegaOrdem.js');
const { enrichPedidoResultForPanel } = require('./resolvePedidoPanelStatus.js');
const { logPedidoGerado } = require('./logPedidoGerado.js');
const { logFlowPhase, PHASE, getRunLogPath } = require('./runFileLogger.js');

/** Enriquece com ordem OSS do PEGA (se ainda não tiver) e emite log padronizado para o painel FDL. */
async function finalizePedidoGerado(result = {}) {
  logFlowPhase(PHASE.RESUMO, 'pedido gerado / painel FDL');
  const enriched = await enrichPedidoComPegaOrdem(result);
  const forPanel = enrichPedidoResultForPanel(enriched);
  logPedidoGerado(forPanel);
  const runLog = getRunLogPath();
  if (runLog) console.log('  RunLogFile:', runLog);
  return forPanel;
}

module.exports = { finalizePedidoGerado };
