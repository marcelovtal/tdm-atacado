import { createSession } from './session.js';
import { normalizeVt } from './vt.js';

/** Modo local: admin/admin com permissões totais; opcional VT + qualquer senha em dev. */
export function authenticateLocal(username, password) {
  const user = String(username || '').trim();
  const pass = String(password || '');

  if (user === 'admin' && pass === 'admin') {
    return createSession({ vt: 'ADMIN_LOCAL', bindUser: 'admin' });
  }

  const vt = normalizeVt(user);
  if (user.length > 0 && pass.length > 0) {
    const sessionVt = vt || user.toUpperCase();
    return createSession({ vt: sessionVt, bindUser: user });
  }

  throw new Error('Usuário ou senha inválidos (modo local: admin/admin ou qualquer VT + senha)');
}
