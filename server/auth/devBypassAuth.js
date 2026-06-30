import { config } from '../config.js';
import { createSession } from './session.js';
import { normalizeVt } from './vt.js';

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Contas fixas para desenvolvimento com perfil QA (sem LDAP corporativo).
 * Só entra em vigor com DEV_AUTH_BYPASS=1 — nunca ativar no OpenShift/produção.
 */
const DEV_BYPASS_USERS = [{ login: 'vt123456', password: '123456', vt: 'VT123456' }];

export function isDevAuthBypassEnabled() {
  return config.profile === 'qa' && envBool('DEV_AUTH_BYPASS', false);
}

/** Retorna sessão ou null (não lança erro — LDAP continua como fallback). */
export function tryAuthenticateDevBypass(username, password) {
  if (!isDevAuthBypassEnabled()) return null;

  const user = String(username || '').trim().toLowerCase();
  const pass = String(password || '');
  if (!user || !pass) return null;

  const match = DEV_BYPASS_USERS.find((u) => u.login.toLowerCase() === user && u.password === pass);
  if (!match) return null;

  const vt = normalizeVt(match.vt || match.login);
  if (!vt) return null;

  return createSession({ vt, bindUser: match.login });
}
