const { finalizePedidoGerado } = require('./finalizePedidoGerado.js');
const { mergePegaSingleLegIntoPedido } = require('./mergePegaSingleLegIntoPedido.js');
const { runPegaAfterSuborderIfConfigured } = require('./pega/runPegaAfterSuborderIfConfigured.js');
const { runOfsAfterPegaIfConfigured, mergeOfsIntoPedido } = require('./ofs/runOfsAfterPegaIfConfigured.js');

/** Finaliza pedido IP Connect: PEGA + OFS (opcional) + enrich OSS + log painel. */
async function finalizePedidoWithOptionalPegaAndOfs(result = {}, options = {}) {
  const pegaResult = await runPegaAfterSuborderIfConfigured(result.subOrderOrderNumber, options);
  let merged = mergePegaSingleLegIntoPedido(result, pegaResult);
  const ofsResult = await runOfsAfterPegaIfConfigured(merged);
  merged = mergeOfsIntoPedido(merged, ofsResult);
  return finalizePedidoGerado(merged);
}

module.exports = { finalizePedidoWithOptionalPegaAndOfs };
