import { toQueueReturnPayload } from './jobReturnPayload.js';

export function jobStatusFromResult(result) {
  if (result?.cancelled) return 'cancelled';
  if (result?.success) return 'completed';
  if (result?.userError) return 'user_error';
  return 'failed';
}

export function buildJobReturnPayload(result, dbSave) {
  const cancelled = !!result.cancelled;
  const scriptFailed = !result.success && !cancelled;
  const dbFailed = !dbSave.ok;

  return toQueueReturnPayload({
    success: cancelled ? true : !scriptFailed && !dbFailed,
    cancelled,
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
    error: cancelled ? null : result.error,
    userError: result.userError === true,
    userErrorCode: result.userErrorCode ?? null,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    orderStatus: result.orderStatus,
    subOrderStatus: result.subOrderStatus,
    accountBillingId: result.accountBillingId,
    accountBusinessId: result.accountBusinessId,
    accountOrganizationId: result.accountOrganizationId,
    contactTecnicoId: result.contactTecnicoId,
    pegaCaseId: result.pegaCaseId,
    pegaCaseIdPontaA: result.pegaCaseIdPontaA,
    pegaCaseIdPontaB: result.pegaCaseIdPontaB,
    pegaCaseIdEVC: result.pegaCaseIdEVC,
    pegaOrdemServicoOs: result.pegaOrdemServicoOs,
    pegaOrdemServicoOsPontaA: result.pegaOrdemServicoOsPontaA,
    pegaOrdemServicoOsPontaB: result.pegaOrdemServicoOsPontaB,
    pegaOrdemServicoOsEVC: result.pegaOrdemServicoOsEVC,
    subOrderOrderNumber: result.subOrderOrderNumber,
    subOrderOrderNumberPontaA: result.subOrderOrderNumberPontaA,
    subOrderOrderNumberPontaB: result.subOrderOrderNumberPontaB,
    subOrderOrderNumberEVC: result.subOrderOrderNumberEVC,
    orderStatusPollFailed: result.orderStatusPollFailed === true,
    orderStatusPollError: result.orderStatusPollError ?? null,
    scriptSuccess: cancelled ? false : !scriptFailed,
    dbSaveError: dbSave.error ?? null,
  });
}
