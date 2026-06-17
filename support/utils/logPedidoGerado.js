/** Linhas padronizadas no stdout — parseadas em server/runScript.js para o painel FDL. */
const {
  PANEL_SNAPSHOT_PREFIX,
  buildPanelSnapshotPayload,
} = require('./panelSnapshot.js');

function logPedidoGerado(result = {}) {
  console.log('\n*** PEDIDO GERADO ***');
  if (result.accountOrganizationId) {
    console.log('  AccountOrganizationId:', result.accountOrganizationId);
  }
  if (result.accountBusinessId) {
    console.log('  AccountBusinessId:', result.accountBusinessId);
  }
  if (result.accountBillingId) {
    console.log('  AccountBillingId:', result.accountBillingId);
  }
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

  const hasLdLegs =
    result.subOrderOrderNumberPontaA ||
    result.subOrderOrderNumberPontaB ||
    result.subOrderOrderNumberEVC;
  const hasLdPega =
    hasLdLegs ||
    result.pegaOrdemServicoOsPontaA ||
    result.pegaOrdemServicoOsPontaB ||
    result.pegaOrdemServicoOsEVC ||
    result.pegaCaseIdPontaA ||
    result.pegaCaseIdPontaB ||
    result.pegaCaseIdEVC;

  if (hasLdPega) {
    if (result.pegaOrdemServicoOsPontaA) console.log('  PEGA OS Ponta A:', result.pegaOrdemServicoOsPontaA);
    else if (result.pegaCaseIdPontaA) console.log('  PEGA Caso Ponta A:', result.pegaCaseIdPontaA);
    if (result.pegaOrdemServicoOsPontaB) console.log('  PEGA OS Ponta B:', result.pegaOrdemServicoOsPontaB);
    else if (result.pegaCaseIdPontaB) console.log('  PEGA Caso Ponta B:', result.pegaCaseIdPontaB);
    if (result.pegaOrdemServicoOsEVC) console.log('  PEGA OS EVC:', result.pegaOrdemServicoOsEVC);
    else if (result.pegaCaseIdEVC) console.log('  PEGA Caso EVC:', result.pegaCaseIdEVC);
  } else if (result.pegaCaseId) {
    console.log('  PEGA:', result.pegaCaseId);
  }

  if (result.pegaOrdemServicoOs) console.log('  PEGA OS:', result.pegaOrdemServicoOs);
  if (result.ofsActivityId) console.log('  OFS ActivityId:', result.ofsActivityId);
  if (result.ofsActivityIdPontaA) console.log('  OFS ActivityId Ponta A:', result.ofsActivityIdPontaA);
  if (result.ofsActivityIdPontaB) console.log('  OFS ActivityId Ponta B:', result.ofsActivityIdPontaB);
  if (result.ofsActivityStatus) console.log('  OFS Status:', result.ofsActivityStatus);
  if (result.ofsActivityStatusPontaA) console.log('  OFS Status Ponta A:', result.ofsActivityStatusPontaA);
  if (result.ofsActivityStatusPontaB) console.log('  OFS Status Ponta B:', result.ofsActivityStatusPontaB);
  if (result.ofsInstalacaoConcluidaPontaA != null) {
    console.log('  OFS Instalação concluída Ponta A:', result.ofsInstalacaoConcluidaPontaA ? 'sim' : 'não');
  }
  if (result.ofsInstalacaoConcluidaPontaB != null) {
    console.log('  OFS Instalação concluída Ponta B:', result.ofsInstalacaoConcluidaPontaB ? 'sim' : 'não');
  }
  if (result.ofsInstalacaoConcluida != null) {
    console.log('  OFS Instalação concluída:', result.ofsInstalacaoConcluida ? 'sim' : 'não');
  }

  const panelSnapshot = buildPanelSnapshotPayload(result);
  if (panelSnapshot) {
    console.log(`${PANEL_SNAPSHOT_PREFIX}${JSON.stringify(panelSnapshot)}`);
  }
}

module.exports = { logPedidoGerado };

