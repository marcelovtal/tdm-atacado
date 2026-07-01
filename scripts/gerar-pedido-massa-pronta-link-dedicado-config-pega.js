/**
 * Link Dedicado (massa pronta + Config PEGA).
 *
 * Delega a `gerar-pedido-massa-pronta-link-dedicado.js` — mesmo fluxo de pedido, subpedidos e PEGA
 * que Lead → Link Dedicado (finalizePedidoLinkDedicadoWithOptionalPega + FDL_PANEL_SNAPSHOT).
 */
process.env.INCLUDE_PEGA_LD = '1';
require('./gerar-pedido-massa-pronta-link-dedicado.js');
