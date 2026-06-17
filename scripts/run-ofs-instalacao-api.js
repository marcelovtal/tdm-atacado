/**
 * Instalação OFS somente via REST API (sem Playwright).
 *
 * Uso:
 *   ENVIRONMENT=trg OFS_ORDEM_NUMERO=00005856 node scripts/run-ofs-instalacao-api.js
 *
 * Quando a busca por apptNumber não retorna (comum em Link Dedicado / bucket SEREDE):
 *   OFS_ACTIVITY_ID=<aid da URL na UI OFS>
 *
 * Reagendar para data específica (ex. mover 18 → 15):
 *   OFS_TARGET_DATE=2026-06-15
 *
 * Ver também: support/utils/ofs/runOfsInstalacaoCompleta.js
 */
const { runOfsInstalacaoCompleta } = require('../support/utils/ofs/runOfsInstalacaoCompleta.js');

runOfsInstalacaoCompleta()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
