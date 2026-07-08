import { Router } from 'express';
import { config } from '../config.js';
import { authenticateLdap } from './ldap.js';
import { authenticateLocal } from './localAuth.js';
import { isDevAuthBypassEnabled, tryAuthenticateDevBypass } from './devBypassAuth.js';
import { createSession, destroySession, bearerFromReq } from './session.js';
import { listAccessControl, updateAccessControl } from './accessControl.js';
import { listMassTypeSettings, updateMassTypeSettings } from '../massTypeSettings.js';
import {
  getJobQueueSettingsForApi,
  updateJobQueueSettings,
} from '../jobQueueSettings.js';
import { attachAuth, requireAuth, requirePermission, requireManageAccess, requirePlatformAdmin } from './middleware.js';
import { normalizeVt } from './vt.js';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    mode: config.auth.mode,
    ldapEnabled: config.auth.mode === 'ldap',
    devBypassEnabled: isDevAuthBypassEnabled(),
  });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    let session;
    if (config.auth.mode === 'local') {
      session = authenticateLocal(username, password);
    } else if (config.auth.mode === 'ldap') {
      session = tryAuthenticateDevBypass(username, password);
      if (!session) {
        const ldapResult = await authenticateLdap(username, password);
        const vt = ldapResult.vt || normalizeVt(username);
        if (!vt) {
          return res.status(400).json({ error: 'Não foi possível identificar o VT do usuário' });
        }
        session = createSession({ vt, bindUser: ldapResult.bindUser });
      }
    } else {
      return res.status(500).json({ error: 'Modo de autenticação inválido' });
    }

    res.json(session);
  } catch (err) {
    console.error('[Auth] login falhou:', err.message);
    res.status(401).json({ error: err.message || 'Falha na autenticação' });
  }
});

router.post('/logout', (req, res) => {
  const token = bearerFromReq(req);
  if (token) destroySession(token);
  res.json({ ok: true });
});

router.get('/me', attachAuth, (req, res) => {
  if (!req.user?.vt) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  res.json({
    user: {
      vt: req.user.vt,
      permissions: req.user.permissions,
      isPlatformAdmin: !!req.user.isPlatformAdmin,
    },
  });
});

router.get('/access-control', attachAuth, requireAuth, requireManageAccess, (_req, res) => {
  res.json(listAccessControl());
});

router.put('/access-control', attachAuth, requireAuth, requireManageAccess, async (req, res) => {
  try {
    const data = await updateAccessControl(req.body || {});
    res.json(data);
  } catch (err) {
    console.error('[ACL] Erro ao salvar:', err.message);
    res.status(500).json({ error: err.message || 'Erro ao salvar permissões' });
  }
});

router.get('/mass-types', attachAuth, requireAuth, requireManageAccess, (_req, res) => {
  res.json({ types: listMassTypeSettings() });
});

router.put('/mass-types', attachAuth, requireAuth, requireManageAccess, async (req, res) => {
  try {
    const data = await updateMassTypeSettings(req.body || {});
    res.json(data);
  } catch (err) {
    console.error('[MassTypes] Erro ao salvar:', err.message);
    res.status(500).json({ error: err.message || 'Erro ao salvar tipos de massa' });
  }
});

router.get('/job-queue', attachAuth, requireAuth, requireManageAccess, (_req, res) => {
  res.json(getJobQueueSettingsForApi());
});

router.put('/job-queue', attachAuth, requireAuth, requireManageAccess, async (req, res) => {
  try {
    const data = await updateJobQueueSettings(req.body || {});
    res.json(data);
  } catch (err) {
    console.error('[JobQueue] Erro ao salvar:', err.message);
    res.status(500).json({ error: err.message || 'Erro ao salvar fila de jobs' });
  }
});

export {
  router as authRouter,
  attachAuth,
  requireAuth,
  requirePermission,
  requireManageAccess,
  requirePlatformAdmin,
};
