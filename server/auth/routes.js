import { Router } from 'express';
import { config } from '../config.js';
import { authenticateLdap } from './ldap.js';
import { authenticateLocal } from './localAuth.js';
import { createSession, destroySession, bearerFromReq } from './session.js';
import { listAccessControl, updateAccessControl } from './accessControl.js';
import { attachAuth, requireAuth, requirePermission, requireManageAccess } from './middleware.js';
import { normalizeVt } from './vt.js';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    mode: config.auth.mode,
    ldapEnabled: config.auth.mode === 'ldap',
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
      const ldapResult = await authenticateLdap(username, password);
      const vt = ldapResult.vt || normalizeVt(username);
      if (!vt) {
        return res.status(400).json({ error: 'Não foi possível identificar o VT do usuário' });
      }
      session = createSession({ vt, bindUser: ldapResult.bindUser });
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

export { router as authRouter, attachAuth, requireAuth, requirePermission, requireManageAccess };
