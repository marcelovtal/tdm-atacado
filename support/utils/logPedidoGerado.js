/** Linhas padronizadas no stdout — parseadas em server/runScript.js para o painel FDL. */
function logPedidoGerado(result = {}) {
  console.log('\n*** PEDIDO GERADO ***');
  if (result.orderId) console.log('  OrderId:', result.orderId);
  if (result.orderNumber) console.log('  OrderNumber:', result.orderNumber);
  if (result.orderStatus) console.log('  Status:', result.orderStatus);
  if (result.subOrderEmImplantacao != null) {
    console.log(
      '  Subpedido "Em implantação":',
      result.subOrderEmImplantacao ? 'sim' : 'não (timeout ou ainda processando)',
    );
  }
  if (result.subOrderOrderNumber) {
    console.log('  SubpedidoOrderNumber:', result.subOrderOrderNumber);
  }
  if (result.subOrderOrderNumberPontaA) {
    console.log('  SubpedidoOrderNumber Ponta A:', result.subOrderOrderNumberPontaA);
  }
  if (result.subOrderOrderNumberPontaB) {
    console.log('  SubpedidoOrderNumber Ponta B:', result.subOrderOrderNumberPontaB);
  }
  if (result.subOrderOrderNumberEVC) {
    console.log('  SubpedidoOrderNumber EVC:', result.subOrderOrderNumberEVC);
  }
  if (result.pegaCaseId) console.log('  PEGA:', result.pegaCaseId);
  if (result.pegaOrdemServicoOsPontaA) console.log('  PEGA OS Ponta A:', result.pegaOrdemServicoOsPontaA);
  if (result.pegaOrdemServicoOsPontaB) console.log('  PEGA OS Ponta B:', result.pegaOrdemServicoOsPontaB);
  if (result.pegaOrdemServicoOsEVC) console.log('  PEGA OS EVC:', result.pegaOrdemServicoOsEVC);
  if (result.pegaOrdemServicoOs) console.log('  PEGA OS:', result.pegaOrdemServicoOs);
}

module.exports = { logPedidoGerado };
