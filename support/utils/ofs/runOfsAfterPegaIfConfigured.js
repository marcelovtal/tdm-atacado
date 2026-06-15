const { runOfsInstalacaoCompleta } = require('./runOfsInstalacaoCompleta.js');
const { getOfsFixture } = require('./getOfsConfig.js');

function mergeOfsIntoPedido(result = {}, ofsResult) {
  if (!ofsResult) return result;
  return {
    ...result,
    ofsActivityId: ofsResult.ofsActivityId ?? result.ofsActivityId ?? null,
    ofsActivityStatus: ofsResult.ofsActivityStatus ?? result.ofsActivityStatus ?? null,
    ofsNumeroOrdem: ofsResult.ofsNumeroOrdem ?? result.ofsNumeroOrdem ?? null,
    ofsResourceId: ofsResult.ofsResourceId ?? result.ofsResourceId ?? null,
    ofsInstalacaoConcluida: ofsResult.ofsInstalacaoConcluida ?? result.ofsInstalacaoConcluida ?? null,
  };
}

/**
 * Executa instalação OFS após PEGA quando INCLUDE_OFS_INSTALACAO=1 (ou SKIP_OFS≠1 com credenciais).
 * Número da ordem OFS = subpedido CRM (OrderNumber), igual ao vtal-mcp (ordemServicoId).
 */
async function runOfsAfterPegaIfConfigured(result = {}) {
  if (process.env.SKIP_OFS === '1') {
    console.log('[OFS] SKIP_OFS=1 — etapa OFS omitida.');
    return null;
  }
  if (process.env.INCLUDE_OFS_INSTALACAO !== '1' && process.env.OFS_ENABLE !== '1') {
    return null;
  }

  const cfg = getOfsFixture();
  const hasCred = cfg?.base_url && cfg?.username && cfg?.password;
  if (!hasCred) {
    console.log(
      '[OFS] Sem credenciais: OFS_BASE_URL + OFS_USERNAME/OFS_PASSWORD (ou user.json → ofs). Etapa omitida.',
    );
    return null;
  }

  const numeroOrdem =
    (process.env.OFS_ORDEM_NUMERO || '').trim() || result.subOrderOrderNumber || result.ofsNumeroOrdem;
  if (!numeroOrdem) {
    console.log('[OFS] Sem número da ordem (subpedido CRM) — etapa OFS omitida.');
    return null;
  }

  console.log('[E2E] OFS — instalação em campo via API…');
  const ofsResult = await runOfsInstalacaoCompleta({
    numeroOrdem,
    subOrderOrderNumber: result.subOrderOrderNumber,
    config: cfg,
  });
  return ofsResult;
}

module.exports = { runOfsAfterPegaIfConfigured, mergeOfsIntoPedido };
