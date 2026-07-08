import { jobStatusFromResult } from './jobOutcome.js';
import { recordMassTypeJobOutcome } from './massTypeFailureTracker.js';

/** Pós-processamento de job de massa: streak de falhas técnicas e auto-desativação do card. */
export async function afterMassTypeJobProcessed(job, result) {
  const massTypeId = job?.data?.massTypeId;
  if (!massTypeId) return null;
  const status = jobStatusFromResult(result);
  return recordMassTypeJobOutcome({
    massTypeId,
    environment: job.data?.environment || 'ti',
    status,
    errorMessage: result?.error ?? null,
  });
}
