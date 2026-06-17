const { finalizePedidoGerado } = require('./finalizePedidoGerado.js');
const { runLinkDedicadoPegaPhase } = require('./finalizePedidoLinkDedicadoWithOptionalPega.js');
const {
  runOfsLinkDedicadoAfterPegaIfConfigured,
  mergeOfsLinkDedicadoIntoPedido,
} = require('./ofs/runOfsAfterPegaIfConfigured.js');

/** Finaliza pedido Link Dedicado: mesma fase PEGA do fluxo sem OFS + instalação OFS (Ponta A → Ponta B). */
async function finalizePedidoLinkDedicadoWithOptionalPegaAndOfs(result = {}) {
  const mergedAfterPega = await runLinkDedicadoPegaPhase(result);
  console.log('[E2E] PEGA Link Dedicado encerrado — iniciando OFS (Ponta A → Ponta B)…');
  const ofsResult = await runOfsLinkDedicadoAfterPegaIfConfigured(mergedAfterPega);
  return finalizePedidoGerado(mergeOfsLinkDedicadoIntoPedido(mergedAfterPega, ofsResult));
}

module.exports = { finalizePedidoLinkDedicadoWithOptionalPegaAndOfs };
