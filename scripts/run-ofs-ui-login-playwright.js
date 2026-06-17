/**
 * Login OFS via Playwright — captura cookie + CSRF + trust e salva em .auth/<env>/ofs-ui-session.json
 */
const { loginOfsUiSessionViaPlaywright } = require('../support/utils/ofs/ofsUiPlaywrightLogin.js');

loginOfsUiSessionViaPlaywright()
  .then((s) => {
    console.log(JSON.stringify({ ...s, cookie: '[redacted]' }, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
