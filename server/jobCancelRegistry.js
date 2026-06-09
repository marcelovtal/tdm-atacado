/** Processos de script ativos por jobId (mesmo processo do worker/API). */
const activeByJobId = new Map();
/** Jobs para os quais foi solicitado cancelamento (SIGTERM no Windows nem sempre preenche signal). */
const cancelledJobIds = new Set();

export function registerJobProcess(jobId, child) {
  if (jobId == null) return;
  activeByJobId.set(String(jobId), child);
}

export function unregisterJobProcess(jobId) {
  if (jobId == null) return;
  activeByJobId.delete(String(jobId));
  cancelledJobIds.delete(String(jobId));
}

export function markJobCancelled(jobId) {
  if (jobId == null) return;
  cancelledJobIds.add(String(jobId));
}

export function wasJobCancelled(jobId) {
  if (jobId == null) return false;
  return cancelledJobIds.has(String(jobId));
}

export function abortJobProcess(jobId) {
  const id = String(jobId);
  markJobCancelled(id);
  const child = activeByJobId.get(id);
  if (!child) return false;
  try {
    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch (_) {}
    }, 5000);
    return true;
  } catch {
    return false;
  }
}
