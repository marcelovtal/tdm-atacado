import { toQueueReturnPayload } from './jobReturnPayload.js';

export function jobStatusFromResult(result) {
  if (result?.cancelled) return 'cancelled';
  return result?.success ? 'completed' : 'failed';
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
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    orderStatus: result.orderStatus,
    accountBillingId: result.accountBillingId,
    accountBusinessId: result.accountBusinessId,
    accountOrganizationId: result.accountOrganizationId,
    contactTecnicoId: result.contactTecnicoId,
    pegaCaseId: result.pegaCaseId,
    pegaOrdemServicoOs: result.pegaOrdemServicoOs,
    scriptSuccess: cancelled ? false : !scriptFailed,
    dbSaveError: dbSave.error ?? null,
  });
}
