import crypto from 'crypto';
import { config } from '../config.js';
import { getPermissionsForVt } from './accessControl.js';
import { isPlatformAdmin } from './platformAdmin.js';
import { normalizeVt } from './vt.js';

const sessions = new Map();
/** VT → último request autenticado (ms). Conta sessões mesmo após restart da API (token HMAC). */
const activeByVt = new Map();
const ACTIVE_SESSION_WINDOW_MS = 30 * 60 * 1000;

function touchActiveSession(vt) {
  const id = normalizeVt(vt);
  if (!id) return;
  activeByVt.set(id, Date.now());
}

function pruneInactiveSessions() {
  const now = Date.now();
  for (const [vt, lastSeen] of activeByVt.entries()) {
    if (now - lastSeen > ACTIVE_SESSION_WINDOW_MS) activeByVt.delete(vt);
  }
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.auth.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.auth.sessionSecret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSession({ vt, bindUser = null }) {
  const id = normalizeVt(vt);
  const permissions = getPermissionsForVt(id);
  const exp = Date.now() + config.auth.sessionTtlMs;
  const payload = {
    vt: id,
    bindUser,
    permissions,
    isPlatformAdmin: isPlatformAdmin(id),
    exp,
  };
  const token = sign(payload);
  sessions.set(token, payload);
  touchActiveSession(id);
  return { token, user: publicUser(payload) };
}

export function getSessionFromToken(token) {
  const mem = sessions.get(token);
  if (mem && (!mem.exp || Date.now() <= mem.exp)) {
    const vt = mem.vt;
    touchActiveSession(vt);
    return {
      ...mem,
      permissions: getPermissionsForVt(vt),
      isPlatformAdmin: isPlatformAdmin(vt),
    };
  }
  const payload = verify(token);
  if (!payload?.vt) return null;
  const vt = payload.vt;
  sessions.set(token, payload);
  touchActiveSession(vt);
  return {
    ...payload,
    permissions: getPermissionsForVt(vt),
    isPlatformAdmin: isPlatformAdmin(vt),
  };
}

export function destroySession(token) {
  sessions.delete(token);
}

/** VTs distintos com atividade nos últimos 30 min nesta instância da API. */
export function countActiveSessions() {
  pruneInactiveSessions();
  const vts = new Set(activeByVt.keys());
  const now = Date.now();
  for (const payload of sessions.values()) {
    if (payload.exp && now > payload.exp) continue;
    if (payload.vt) vts.add(normalizeVt(payload.vt));
  }
  return vts.size;
}

export { touchActiveSession };

function publicUser(payload) {
  return {
    vt: payload.vt,
    permissions: payload.permissions,
    isPlatformAdmin: !!payload.isPlatformAdmin,
  };
}

export function bearerFromReq(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}
