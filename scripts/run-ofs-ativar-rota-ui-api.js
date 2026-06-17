/**
 * Ativa rota do técnico + cancela refeição (se existir) via API AJAX interna OFS.
 *
 * Pré-requisito antes de mover ordem para o técnico — paridade com vtal-mcp Playwright.
 *
 * Uso:
 *   ENVIRONMENT=trg
 *   OFS_TECH_PID=698
 *   OFS_TARGET_DATE=2026-06-15
 *   OFS_UI_COOKIE=...
 *   OFS_UI_CSRF=...
 *   OFS_UI_TRUST=...
 *   node scripts/run-ofs-ativar-rota-ui-api.js
 */
const { runOfsAtivarRotaUi } = require('../support/utils/ofs/runOfsAtivarRotaUi.js');

runOfsAtivarRotaUi()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
