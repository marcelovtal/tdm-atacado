const { finalizePedidoGerado } = require('./finalizePedidoGerado.js');
const { mergePegaSingleLegIntoPedido } = require('./mergePegaSingleLegIntoPedido.js');
const { runPegaAfterSuborderIfConfigured } = require('./pega/runPegaAfterSuborderIfConfigured.js');

/** Finaliza pedido IP Connect / VPN: PEGA opcional + enrich OSS + log para o painel. */
async function finalizePedidoWithOptionalPega(result = {}, options = {}) {
  const pegaResult = await runPegaAfterSuborderIfConfigured(result.subOrderOrderNumber, options);
  return finalizePedidoGerado(mergePegaSingleLegIntoPedido(result, pegaResult));
}

module.exports = { finalizePedidoWithOptionalPega };
