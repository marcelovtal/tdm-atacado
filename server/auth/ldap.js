import ldap from 'ldapjs';
import { config } from '../config.js';
import { buildLdapBindUser, normalizeVt } from './vt.js';

export async function authenticateLdap(username, password) {
  const { ldap: ldapCfg } = config.auth;
  if (!password) {
    throw new Error('Senha obrigatória');
  }

  const bindUser = buildLdapBindUser(username, ldapCfg.domain);
  const vt = normalizeVt(username) || normalizeVt(bindUser);

  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url: ldapCfg.url,
      timeout: ldapCfg.timeoutMs,
      connectTimeout: ldapCfg.timeoutMs,
    });

    const onError = (err) => {
      try {
        client.unbind();
      } catch (_) {}
      reject(err);
    };

    client.on('error', onError);

    client.bind(bindUser, password, (err) => {
      try {
        client.unbind();
      } catch (_) {}
      if (err) {
        const msg = err.message || String(err);
        if (/invalid credentials/i.test(msg) || err.name === 'InvalidCredentialsError') {
          return reject(new Error('Usuário ou senha inválidos'));
        }
        return reject(new Error(`LDAP: ${msg}`));
      }
      resolve({ bindUser, vt: vt || normalizeVt(bindUser.split('\\').pop()) });
    });
  });
}
