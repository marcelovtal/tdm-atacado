const { getPegaFixture, getPegaDefaults } = require('../../../config/env.js');
const { getPegaAccessToken } = require('./getPegaAccessToken.js');
const { runPegaLinkDedicadoDuasPontas, PEGA_TOTAL_STEPS } = require('./runPegaDesignacaoConfiguracao.js');

function getNodeFetch() {
  return global.fetch;
}

/** Token: PEGA_BEARER_TOKEN, ou OAuth2 (env sobrescreve user.json). */
async function resolvePegaBearerTokenForLd() {
  const filePega = getPegaFixture();
  const defaults = getPegaDefaults();
  const direct = (process.env.PEGA_BEARER_TOKEN || '').trim();
  if (direct) {
    console.log(
      `[PEGA] Passo 1/${PEGA_TOTAL_STEPS} — Bearer já definido (PEGA_BEARER_TOKEN). OAuth2 não será chamado.`,
    );
    return direct;
  }
  const clientId = (process.env.PEGA_CLIENT_ID || filePega?.client_id || '').trim();
  const clientSecret = (process.env.PEGA_CLIENT_SECRET || filePega?.client_secret || '').trim();
  const tokenUrl = (process.env.PEGA_TOKEN_URL || filePega?.token_url || defaults.token_url).trim();
  if (!clientId || !clientSecret) return null;
  console.log(`[PEGA] Passo 1/${PEGA_TOTAL_STEPS} — OAuth2 client_credentials →`, tokenUrl);
  return getPegaAccessToken({
    tokenUrl,
    clientId,
    clientSecret,
    fetchImpl: getNodeFetch(),
  });
}

/**
 * PEGA Link Dedicado: ORDEMSERVICO = OrderNumber CRM dos subpedidos Ponta A, Ponta B e (opcional) EVC.
 */
async function runPegaLinkDedicadoIfConfigured(
  subOrderOrderNumberPontaA,
  subOrderOrderNumberPontaB,
  subOrderOrderNumberEVC,
) {
  if (process.env.SKIP_PEGA === '1') {
    console.log('[PEGA] SKIP_PEGA=1 — etapa PEGA omitida.');
    return null;
  }

  const overrideA = (process.env.PEGA_ORDEM_SERVICO_PONTA_A || '').trim();
  const overrideB = (process.env.PEGA_ORDEM_SERVICO_PONTA_B || '').trim();
  const overrideEvc = (process.env.PEGA_ORDEM_SERVICO_EVC || '').trim();
  const ordemA = overrideA || subOrderOrderNumberPontaA;
  const ordemB = overrideB || subOrderOrderNumberPontaB;
  const ordemEvc = overrideEvc || subOrderOrderNumberEVC || '';

  if (!ordemA || !ordemB) {
    console.log(
      '[PEGA] Sem ORDEMSERVICO para Ponta A e Ponta B (subpedidos sem OrderNumber). Defina PEGA_ORDEM_SERVICO_PONTA_A e PEGA_ORDEM_SERVICO_PONTA_B se necessário.',
    );
    return null;
  }

  const filePega = getPegaFixture();
  const hasPegaCred =
    String(process.env.PEGA_BEARER_TOKEN || '').trim() ||
    (String(process.env.PEGA_CLIENT_ID || filePega?.client_id || '').trim() &&
      String(process.env.PEGA_CLIENT_SECRET || filePega?.client_secret || '').trim());
  if (!hasPegaCred) {
    console.log(
      '[PEGA] Sem credenciais PEGA: user.json → pega ou PEGA_BEARER_TOKEN / PEGA_CLIENT_ID+SECRET. Ou SKIP_PEGA=1.',
    );
    return null;
  }

  const base = (process.env.PEGA_BASE_URL || filePega?.base_url || getPegaDefaults().base_url).replace(/\/$/, '');
  const cookie = (process.env.PEGA_COOKIE || filePega?.cookie || '').trim();
  const evcPart = ordemEvc
    ? ` + EVC (${ordemEvc}${overrideEvc ? ' override' : ''})`
    : ' (EVC omitido — sem subpedido / PEGA_ORDEM_SERVICO_EVC)';

  console.log(
    `[E2E] PEGA Link Dedicado — Ponta A (${ordemA}${overrideA ? ' override' : ''}) + Ponta B (${ordemB}${overrideB ? ' override' : ''})${evcPart} | base:`,
    base,
  );

  let pegaResult;
  try {
    pegaResult = await runPegaLinkDedicadoDuasPontas({
      ordemServicoPontaA: ordemA,
      ordemServicoPontaB: ordemB,
      ordemServicoEVC: ordemEvc || undefined,
      baseUrl: base,
      cookie,
      fetchImpl: getNodeFetch(),
      getPegaBearerToken: resolvePegaBearerTokenForLd,
    });
  } catch (err) {
    console.error('[PEGA] Falha no fluxo PEGA (token ou API):', err.message);
    throw err;
  }

  console.log(
    '\n*** PEGA Link Dedicado (A+ConfigRede → B Designar/Config → Validação A/B → EVC ConfigurarEvc → Agend. A → Agend. B) ***',
  );
  if (pegaResult.pontaA?.caseId) console.log('  Ponta A caseId:', pegaResult.pontaA.caseId);
  if (pegaResult.pontaA?.pegaOrdemServicoOs) console.log('  Ponta A OS:', pegaResult.pontaA.pegaOrdemServicoOs);
  if (pegaResult.pontaB?.pegaOrdemServicoOs) console.log('  Ponta B OS:', pegaResult.pontaB.pegaOrdemServicoOs);
  if (pegaResult.evc?.caseId) console.log('  EVC caseId:', pegaResult.evc.caseId);
  if (pegaResult.evc?.pegaOrdemServicoOs) console.log('  EVC OS:', pegaResult.evc.pegaOrdemServicoOs);

  return pegaResult;
}

module.exports = { runPegaLinkDedicadoIfConfigured };
