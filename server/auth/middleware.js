import { config } from '../config.js';
import { bearerFromReq, getSessionFromToken, touchActiveSession } from './session.js';
import { isPlatformAdmin } from './platformAdmin.js';

export function attachAuth(req, res, next) {
  if (config.auth.mode === 'off') {
    req.user = {
      vt: 'DEV',
      permissions: { dashboard: true, cancelJobs: true, manageAccess: true },
      isPlatformAdmin: true,
    };
    return next();
  }
  const token = bearerFromReq(req);
  if (!token) {
    req.user = null;
    return next();
  }
  req.user = getSessionFromToken(token);
  req.authToken = token;
  if (req.user?.vt) touchActiveSession(req.user.vt);
  next();
}

export function requireAuth(req, res, next) {
  if (config.auth.mode === 'off') return next();
  if (!req.user?.vt) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (config.auth.mode === 'off') return next();
    if (!req.user?.vt) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!req.user.permissions?.[permission]) {
      return res.status(403).json({ error: 'Sem permissão para esta ação' });
    }
    next();
  };
}

export function requireManageAccess(req, res, next) {
  if (config.auth.mode === 'off') return next();
  if (!req.user?.vt) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  if (!isPlatformAdmin(req.user.vt)) {
    return res.status(403).json({ error: 'Acesso restrito a administradores da plataforma' });
  }
  next();
}

/** Restrito ao administrador da plataforma (ex.: cancelar jobs). */
export function requirePlatformAdmin(req, res, next) {
  if (config.auth.mode === 'off') return next();
  if (!req.user?.vt) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  if (!isPlatformAdmin(req.user.vt)) {
    return res.status(403).json({ error: 'Apenas o administrador pode executar esta ação' });
  }
  next();
}
