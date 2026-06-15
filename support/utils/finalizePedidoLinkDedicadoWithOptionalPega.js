const { finalizePedidoGerado } = require('./finalizePedidoGerado.js');
const { mergePegaLinkDedicadoIntoPedido } = require('./mergePegaLinkDedicadoIntoPedido.js');
const { runPegaLinkDedicadoIfConfigured } = require('./pega/runPegaLinkDedicadoIfConfigured.js');

/** Finaliza pedido Link Dedicado: PEGA opcional (3 pernas) + enrich + log para o painel. */
async function finalizePedidoLinkDedicadoWithOptionalPega(result = {}) {
  const pegaResult = await runPegaLinkDedicadoIfConfigured(
    result.subOrderOrderNumberPontaA,
    result.subOrderOrderNumberPontaB,
    result.subOrderOrderNumberEVC,
  );
  return finalizePedidoGerado(mergePegaLinkDedicadoIntoPedido(result, pegaResult));
}

module.exports = { finalizePedidoLinkDedicadoWithOptionalPega };
