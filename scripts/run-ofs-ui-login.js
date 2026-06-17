/**
 * Renova sessão supervisor OFS (cookie + CSRF + trust) via login HTTP.
 *
 * Uso:
 *   ENVIRONMENT=trg
 *   OFS_USERNAME=vt422570
 *   OFS_PASSWORD=...
 *   node scripts/run-ofs-ui-login.js
 */
const { loginOfsUiSession } = require('../support/utils/ofs/ofsUiLogin.js');

loginOfsUiSession()
  .then((session) => {
    console.log(JSON.stringify({ ...session, cookie: '[redacted]' }, null, 2));
    console.log('\nSessão salva em .auth/<env>/ofs-ui-session.json');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
