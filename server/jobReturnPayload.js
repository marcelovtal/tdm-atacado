/**
 * Logs completos ficam apenas no banco (saveJobExecution) e no terminal do worker/API.
 * Não envia stdout/stderr ao Redis nem à API de detalhe do job.
 */
export function toQueueReturnPayload(result) {
  if (!result || typeof result !== 'object') return result;
  const { stdout: _out, stderr: _err, ...rest } = result;
  return { ...rest, _logsInDb: !result.dbSaveError };
}
