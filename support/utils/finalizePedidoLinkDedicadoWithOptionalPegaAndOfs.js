const { finalizePedidoGerado } = require('./finalizePedidoGerado.js');
const { runLinkDedicadoPegaPhase } = require('./finalizePedidoLinkDedicadoWithOptionalPega.js');
const {
  runOfsLinkDedicadoAfterPegaIfConfigured,
  mergeOfsLinkDedicadoIntoPedido,
} = require('./ofs/runOfsAfterPegaIfConfigured.js');
const { pollSubOrderStatusAfterOfs } = require('./salesforce/pollSubOrderStatusAfterOfs.js');

/** Finaliza pedido Link Dedicado: PEGA + OFS (Ponta A → Ponta B) + poll status SF + log painel. */
async function finalizePedidoLinkDedicadoWithOptionalPegaAndOfs(result = {}) {
  const mergedAfterPega = await runLinkDedicadoPegaPhase(result);
  console.log('[E2E] PEGA Link Dedicado encerrado — iniciando OFS (Ponta A → Ponta B)…');
  const ofsResult = await runOfsLinkDedicadoAfterPegaIfConfigured(mergedAfterPega);
  let merged = mergeOfsLinkDedicadoIntoPedido(mergedAfterPega, ofsResult);
  merged = await pollSubOrderStatusAfterOfs(merged);
  return finalizePedidoGerado(merged);
}

module.exports = { finalizePedidoLinkDedicadoWithOptionalPegaAndOfs };
