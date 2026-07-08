/** Scripts com automação Playwright (PEGA/OFS) — sempre 1 por vez, independente do paralelismo geral. */
export const PLAYWRIGHT_OFS_SCRIPTS = new Set([
  'gerar-pedido-massa-pronta-ip-connect-config-pega-ofs.js',
  'gerar-pedido-massa-pronta-vpn-connect-config-pega-ofs.js',
  'gerar-pedido-massa-pronta-link-dedicado-config-pega-ofs.js',
]);

export function isPlaywrightOfsScript(script) {
  if (!script) return false;
  const base = String(script).replace(/\\/g, '/').split('/').pop();
  return PLAYWRIGHT_OFS_SCRIPTS.has(base);
}
