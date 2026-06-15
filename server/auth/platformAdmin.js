import { config, PLATFORM_ADMIN_VT } from '../config.js';
import { normalizeVt } from './vt.js';

/** Administrador da plataforma: somente VT422570 (Admin + todos os jobs). */
export function isPlatformAdmin(vt) {
  return normalizeVt(vt) === PLATFORM_ADMIN_VT;
}

export function getPlatformAdminVts() {
  return [...config.auth.platformAdmins];
}

export function canSeeAllJobs(user) {
  if (config.auth.mode === 'local') return true;
  return isPlatformAdmin(user?.vt);
}

export function jobBelongsToUser(jobData, viewerVt) {
  if (isPlatformAdmin(viewerVt)) return true;
  const owner = normalizeVt(jobData?.createdByVt || jobData?.ownerVt || jobData?.userCode);
  const viewer = normalizeVt(viewerVt);
  if (!owner || !viewer) return false;
  return owner === viewer;
}
