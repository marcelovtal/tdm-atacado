/**
 * Instalação OFS via API AJAX interna (dispatcher UI) — sem Playwright, sem REST Postman.
 *
 * Copie do DevTools após login supervisor no TRG:
 *   OFS_UI_COOKIE, OFS_UI_CSRF, OFS_UI_TRUST
 *
 * Uso (massa 00005858):
 *   ENVIRONMENT=trg
 *   OFS_ACTIVITY_ID=695850
 *   OFS_ORDEM_NUMERO=00005858
 *   OFS_SOURCE_DATE=2026-06-18
 *   OFS_TARGET_DATE=2026-06-15
 *   OFS_BUCKET_PID=3457
 *   OFS_TECH_PID=3521
 *   node scripts/run-ofs-instalacao-ui-api.js
 */
const { runOfsInstalacaoCompletaUi } = require('../support/utils/ofs/runOfsInstalacaoCompletaUi.js');

runOfsInstalacaoCompletaUi()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
