const { getEnvName } = require('../../../config/credentials.js');
const { getOfsFixture } = require('./getOfsConfig.js');
const { runOfsInstalacaoCompleta } = require('./runOfsInstalacaoCompleta.js');
const { runOfsInstalacaoCompletaUi } = require('./runOfsInstalacaoCompletaUi.js');
const { loadCachedSession } = require('./ofsUiLogin.js');

function envTrim(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

function useOfsUiMode() {
  return process.env.OFS_USE_REST_API !== '1';
}

function hasOfsUiAuth(envName) {
  if (envTrim('OFS_UI_COOKIE') && envTrim('OFS_UI_CSRF') && envTrim('OFS_UI_TRUST')) return true;
  if (loadCachedSession(envName || getEnvName())) return true;
  const ofs = getOfsFixture(envName) || {};
  const user = envTrim('OFS_UI_USERNAME') || envTrim('OFS_USERNAME') || ofs.ui_username || '';
  const pass = envTrim('OFS_UI_PASSWORD') || envTrim('OFS_PASSWORD') || ofs.ui_password || '';
  return Boolean(user && pass);
}

function hasOfsRestAuth(cfg) {
  return Boolean(cfg?.base_url && cfg?.username && cfg?.password);
}

function ofsInstalacaoEnabled() {
  if (process.env.SKIP_OFS === '1') return false;
  return process.env.INCLUDE_OFS_INSTALACAO === '1' || process.env.OFS_ENABLE === '1';
}

function mergeOfsIntoPedido(result = {}, ofsResult) {
  if (!ofsResult) return result;
  return {
    ...result,
    ofsActivityId: ofsResult.ofsActivityId ?? result.ofsActivityId ?? null,
    ofsActivityStatus: ofsResult.ofsActivityStatus ?? result.ofsActivityStatus ?? null,
    ofsNumeroOrdem: ofsResult.ofsNumeroOrdem ?? result.ofsNumeroOrdem ?? null,
    ofsResourceId: ofsResult.ofsResourceId ?? result.ofsResourceId ?? null,
    ofsTechPid: ofsResult.ofsTechPid ?? result.ofsTechPid ?? null,
    ofsBucketPid: ofsResult.ofsBucketPid ?? result.ofsBucketPid ?? null,
    ofsTargetDate: ofsResult.ofsTargetDate ?? result.ofsTargetDate ?? null,
    ofsInstalacaoConcluida: ofsResult.ofsInstalacaoConcluida ?? result.ofsInstalacaoConcluida ?? null,
    ofsMode: ofsResult.ofsMode ?? result.ofsMode ?? null,
    ofsAtivacao: ofsResult.ofsAtivacao ?? result.ofsAtivacao ?? null,
  };
}

function mergeOfsLegIntoPedido(result = {}, ofsResult, legKey) {
  if (!ofsResult || !legKey) return result;
  const suffix = legKey === 'A' ? 'PontaA' : legKey === 'B' ? 'PontaB' : legKey;
  return {
    ...result,
    [`ofsActivityId${suffix}`]: ofsResult.ofsActivityId ?? null,
    [`ofsActivityStatus${suffix}`]: ofsResult.ofsActivityStatus ?? null,
    [`ofsNumeroOrdem${suffix}`]: ofsResult.ofsNumeroOrdem ?? null,
    [`ofsInstalacaoConcluida${suffix}`]: ofsResult.ofsInstalacaoConcluida ?? null,
  };
}

function mergeOfsLinkDedicadoIntoPedido(result = {}, ofsLdResult) {
  if (!ofsLdResult) return result;
  const { pontaA, pontaB } = ofsLdResult;
  let merged = { ...result };
  if (pontaA) merged = mergeOfsLegIntoPedido(merged, pontaA, 'A');
  if (pontaB) merged = mergeOfsLegIntoPedido(merged, pontaB, 'B');
  const aOk = pontaA?.ofsInstalacaoConcluida === true;
  const bOk = pontaB?.ofsInstalacaoConcluida === true;
  if (pontaA && pontaB) {
    merged.ofsInstalacaoConcluida = aOk && bOk;
  } else if (pontaA || pontaB) {
    merged.ofsInstalacaoConcluida = aOk || bOk;
  }
  merged.ofsActivityId = pontaB?.ofsActivityId || pontaA?.ofsActivityId || merged.ofsActivityId || null;
  merged.ofsActivityStatus = pontaB?.ofsActivityStatus || pontaA?.ofsActivityStatus || merged.ofsActivityStatus || null;
  merged.ofsMode = pontaB?.ofsMode || pontaA?.ofsMode || merged.ofsMode || null;
  return merged;
}

/**
 * Instalação OFS para um subpedido (número CRM).
 * @param {string} numeroOrdem
 * @param {{ legLabel?: string, pularAtivacao?: boolean }} [options]
 */
async function runOfsInstalacaoForOrdem(numeroOrdem, options = {}) {
  const ordem = envTrim('OFS_ORDEM_NUMERO') || String(numeroOrdem || '').trim();
  if (!ordem) return null;

  const cfg = getOfsFixture();
  if (!cfg?.base_url) {
    console.log('[OFS] Sem OFS_BASE_URL (user.json → ofs ou env). Etapa omitida.');
    return null;
  }

  const label = options.legLabel ? `${options.legLabel}: ` : '';
  const prevOrdem = process.env.OFS_ORDEM_NUMERO;
  const prevSkip = process.env.OFS_PULAR_ATIVACAO;
  process.env.OFS_ORDEM_NUMERO = ordem;
  if (options.pularAtivacao === true) process.env.OFS_PULAR_ATIVACAO = '1';

  try {
    if (useOfsUiMode()) {
      if (!hasOfsUiAuth(getEnvName())) {
        console.log(
          '[OFS] UI: configure user.json → trg.ofs.ui_username/ui_password ou sessão em .auth/<env>/ofs-ui-session.json.',
        );
        return null;
      }
      console.log(`[E2E] OFS — ${label}ativar rota + mover + iniciar + concluir (UI AJAX)…`);
      return runOfsInstalacaoCompletaUi({
        numeroOrdem: ordem,
        subOrderOrderNumber: ordem,
      });
    }

    if (!hasOfsRestAuth(cfg)) {
      console.log('[OFS] REST: OFS_BASE_URL + OFS_USERNAME/OFS_PASSWORD ausentes. Etapa omitida.');
      return null;
    }

    console.log(`[E2E] OFS — ${label}instalação via REST API (OFS_USE_REST_API=1)…`);
    return runOfsInstalacaoCompleta({
      numeroOrdem: ordem,
      subOrderOrderNumber: ordem,
      config: cfg,
    });
  } finally {
    if (prevOrdem == null) delete process.env.OFS_ORDEM_NUMERO;
    else process.env.OFS_ORDEM_NUMERO = prevOrdem;
    if (prevSkip == null) delete process.env.OFS_PULAR_ATIVACAO;
    else process.env.OFS_PULAR_ATIVACAO = prevSkip;
  }
}

/**
 * Executa instalação OFS após PEGA quando INCLUDE_OFS_INSTALACAO=1 (IP Connect / VPN — uma ponta).
 */
async function runOfsAfterPegaIfConfigured(result = {}) {
  if (!ofsInstalacaoEnabled()) {
    if (process.env.SKIP_OFS === '1') console.log('[OFS] SKIP_OFS=1 — etapa OFS omitida.');
    return null;
  }

  const numeroOrdem =
    envTrim('OFS_ORDEM_NUMERO') || result.subOrderOrderNumber || result.ofsNumeroOrdem;
  if (!numeroOrdem) {
    console.log('[OFS] Sem número da ordem (subpedido CRM) — etapa OFS omitida.');
    return null;
  }

  return runOfsInstalacaoForOrdem(numeroOrdem);
}

/**
 * Link Dedicado: instalação OFS sequencial — Ponta A (mover → iniciar → concluir), depois Ponta B.
 */
async function runOfsLinkDedicadoAfterPegaIfConfigured(result = {}) {
  if (!ofsInstalacaoEnabled()) {
    if (process.env.SKIP_OFS === '1') console.log('[OFS] SKIP_OFS=1 — etapa OFS omitida.');
    return null;
  }

  const ordemA = envTrim('OFS_ORDEM_NUMERO_PONTA_A') || result.subOrderOrderNumberPontaA;
  const ordemB = envTrim('OFS_ORDEM_NUMERO_PONTA_B') || result.subOrderOrderNumberPontaB;

  if (!ordemA || !ordemB) {
    console.log(
      '[OFS] Link Dedicado: faltam subpedidos Ponta A e/ou Ponta B (OrderNumber). Defina OFS_ORDEM_NUMERO_PONTA_A/B se necessário.',
    );
    return null;
  }

  console.log(`[E2E] OFS Link Dedicado — sequência Ponta A (${ordemA}) → Ponta B (${ordemB})…`);

  const pontaA = await runOfsInstalacaoForOrdem(ordemA, { legLabel: 'Ponta A' });
  const pularB =
    process.env.OFS_PULAR_ATIVACAO_PONTA_B === '1' ||
    process.env.OFS_PULAR_ATIVACAO_SEGUNDA_PONTA === '1';
  const pontaB = await runOfsInstalacaoForOrdem(ordemB, {
    legLabel: 'Ponta B',
    pularAtivacao: pularB,
  });

  return { pontaA, pontaB };
}

module.exports = {
  runOfsAfterPegaIfConfigured,
  runOfsLinkDedicadoAfterPegaIfConfigured,
  runOfsInstalacaoForOrdem,
  mergeOfsIntoPedido,
  mergeOfsLinkDedicadoIntoPedido,
  useOfsUiMode,
  hasOfsUiAuth,
};
