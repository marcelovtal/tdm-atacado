const { finalizePedidoGerado } = require('./finalizePedidoGerado.js');
const { mergePegaLinkDedicadoIntoPedido } = require('./mergePegaLinkDedicadoIntoPedido.js');
const { runPegaLinkDedicadoIfConfigured } = require('./pega/runPegaLinkDedicadoIfConfigured.js');

/** Executa só a fase PEGA (compartilhada com e sem OFS). */
async function runLinkDedicadoPegaPhase(result = {}) {
  const pegaResult = await runPegaLinkDedicadoIfConfigured(
    result.subOrderOrderNumberPontaA,
    result.subOrderOrderNumberPontaB,
    result.subOrderOrderNumberEVC,
  );
  return mergePegaLinkDedicadoIntoPedido(result, pegaResult);
}

/** Finaliza pedido Link Dedicado: PEGA opcional (3 pernas) + enrich + log para o painel. */
async function finalizePedidoLinkDedicadoWithOptionalPega(result = {}) {
  return finalizePedidoGerado(await runLinkDedicadoPegaPhase(result));
}

module.exports = {
  finalizePedidoLinkDedicadoWithOptionalPega,
  runLinkDedicadoPegaPhase,
};
