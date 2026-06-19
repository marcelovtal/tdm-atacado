import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parsePanelSnapshotFromText } = require('../support/utils/panelSnapshot.js');
const { resolvePedidoPanelStatus } = require('../support/utils/resolvePedidoPanelStatus.js');

export function extractLiveSnapshotFromProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;
  return progress.live && typeof progress.live === 'object' ? progress.live : null;
}

export function parseLiveSnapshotFromStdout(stdoutText) {
  return parsePanelSnapshotFromText(stdoutText || '');
}

export function mergeLiveFieldsIntoJobFields(base = {}, live = null) {
  if (!live || typeof live !== 'object') return base;
  const orderStatus = resolvePedidoPanelStatus({
    orderStatus: live.orderStatus ?? base.orderStatus,
    subOrderStatus: live.subOrderStatus ?? base.subOrderStatus,
    subOrderEmImplantacao: base.subOrderEmImplantacao,
  });
  return {
    ...base,
    orderId: live.orderId ?? base.orderId ?? null,
    orderNumber: live.orderNumber ?? base.orderNumber ?? null,
    orderStatus: orderStatus ?? base.orderStatus ?? null,
    subOrderStatus: live.subOrderStatus ?? base.subOrderStatus ?? null,
    accountOrganizationId: live.accountOrganizationId ?? base.accountOrganizationId ?? null,
    accountBusinessId: live.accountBusinessId ?? base.accountBusinessId ?? null,
    accountBillingId: live.accountBillingId ?? base.accountBillingId ?? null,
    contactTecnicoId: live.contactTecnicoId ?? base.contactTecnicoId ?? null,
    pegaCaseId: live.pegaCaseId ?? base.pegaCaseId ?? null,
    pegaCaseIdPontaA: live.pegaCaseIdPontaA ?? base.pegaCaseIdPontaA ?? null,
    pegaCaseIdPontaB: live.pegaCaseIdPontaB ?? base.pegaCaseIdPontaB ?? null,
    pegaCaseIdEVC: live.pegaCaseIdEVC ?? base.pegaCaseIdEVC ?? null,
    pegaOrdemServicoOs: live.pegaOrdemServicoOs ?? base.pegaOrdemServicoOs ?? null,
    pegaOrdemServicoOsPontaA: live.pegaOrdemServicoOsPontaA ?? base.pegaOrdemServicoOsPontaA ?? null,
    pegaOrdemServicoOsPontaB: live.pegaOrdemServicoOsPontaB ?? base.pegaOrdemServicoOsPontaB ?? null,
    pegaOrdemServicoOsEVC: live.pegaOrdemServicoOsEVC ?? base.pegaOrdemServicoOsEVC ?? null,
    subOrderOrderNumber: live.subOrderOrderNumber ?? base.subOrderOrderNumber ?? null,
    subOrderOrderNumberPontaA: live.subOrderOrderNumberPontaA ?? base.subOrderOrderNumberPontaA ?? null,
    subOrderOrderNumberPontaB: live.subOrderOrderNumberPontaB ?? base.subOrderOrderNumberPontaB ?? null,
    subOrderOrderNumberEVC: live.subOrderOrderNumberEVC ?? base.subOrderOrderNumberEVC ?? null,
    orderStatusPollFailed: live.orderStatusPollFailed ?? base.orderStatusPollFailed ?? false,
    orderStatusPollError: live.orderStatusPollError ?? base.orderStatusPollError ?? null,
  };
}

export function createStdoutLiveSnapshotHandler(job) {
  if (!job?.updateProgress) return null;
  return (stdoutText) => {
    const live = parseLiveSnapshotFromStdout(stdoutText);
    if (!live) return;
    job.updateProgress({ pct: 50, live }).catch(() => {});
  };
}
