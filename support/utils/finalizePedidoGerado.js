const { enrichPedidoComPegaOrdem } = require('./enrichPedidoComPegaOrdem.js');
const { logPedidoGerado } = require('./logPedidoGerado.js');

/** Enriquece com ordem OSS do PEGA (se ainda não tiver) e emite log padronizado para o painel FDL. */
async function finalizePedidoGerado(result = {}) {
  const enriched = await enrichPedidoComPegaOrdem(result);
  logPedidoGerado(enriched);
  return enriched;
}

module.exports = { finalizePedidoGerado };
