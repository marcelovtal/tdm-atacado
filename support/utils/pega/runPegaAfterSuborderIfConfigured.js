const { getPegaFixture, getPegaDefaults } = require('../../../config/env.js');
const { getPegaAccessToken } = require('./getPegaAccessToken.js');
const {
  runPegaDesignacaoEConfiguracao,
  PEGA_TOTAL_STEPS,
  PEGA_TOTAL_STEPS_VPN,
} = require('./runPegaDesignacaoConfiguracao.js');

const PEGA_ENV_DEFAULTS = getPegaDefaults();

async function resolvePegaBearerToken(flowVariant = 'ip-connect') {
  const totalSteps = flowVariant === 'vpn' ? PEGA_TOTAL_STEPS_VPN : PEGA_TOTAL_STEPS;
  const filePega = getPegaFixture();
  const direct = (process.env.PEGA_BEARER_TOKEN || '').trim();
  if (direct) {
    console.log(`[PEGA] Passo 1/${totalSteps} — Bearer já definido (PEGA_BEARER_TOKEN).`);
    return direct;
  }
  const clientId = (process.env.PEGA_CLIENT_ID || filePega?.client_id || '').trim();
  const clientSecret = (process.env.PEGA_CLIENT_SECRET || filePega?.client_secret || '').trim();
  const tokenUrl = (process.env.PEGA_TOKEN_URL || filePega?.token_url || PEGA_ENV_DEFAULTS.token_url).trim();
  if (!clientId || !clientSecret) return null;
  console.log(`[PEGA] Passo 1/${totalSteps} — OAuth2 client_credentials →`, tokenUrl);
  return getPegaAccessToken({ tokenUrl, clientId, clientSecret });
}

/**
 * PEGA pós-subpedido (IP Connect ou VPN). ORDEMSERVICO = OrderNumber CRM do subpedido.
 * @param {string} subOrderOrderNumber
 * @param {{ flowVariant?: 'ip-connect'|'vpn' }} [options]
 */
async function runPegaAfterSuborderIfConfigured(subOrderOrderNumber, options = {}) {
  const flowVariant = options.flowVariant === 'vpn' ? 'vpn' : 'ip-connect';
  if (process.env.SKIP_PEGA === '1') {
    console.log('[PEGA] SKIP_PEGA=1 — etapa PEGA omitida.');
    return null;
  }
  const ordemOverride = (process.env.PEGA_ORDEM_SERVICO || '').trim();
  const ordemServico = ordemOverride || subOrderOrderNumber;
  if (!ordemServico) {
    console.log('[PEGA] Sem ORDEMSERVICO (subpedido sem OrderNumber e PEGA_ORDEM_SERVICO vazio).');
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

  let token;
  try {
    token = await resolvePegaBearerToken(flowVariant);
  } catch (err) {
    console.error('[PEGA] Falha ao obter access_token:', err.message);
    throw err;
  }
  if (!token) return null;

  const base = (process.env.PEGA_BASE_URL || filePega?.base_url || PEGA_ENV_DEFAULTS.base_url).replace(/\/$/, '');
  const cookie = (process.env.PEGA_COOKIE || filePega?.cookie || '').trim();
  const label = flowVariant === 'vpn' ? 'VPN' : 'IP Connect';
  console.log(`[E2E] PEGA (${label}) | ORDEMSERVICO:`, ordemServico + (ordemOverride ? ' (override)' : ''), '| base:', base);

  const pegaResult = await runPegaDesignacaoEConfiguracao({
    ordemServico,
    baseUrl: base,
    bearerToken: token,
    cookie,
    ...(flowVariant === 'vpn' ? { flowVariant: 'vpn' } : {}),
  });

  console.log(`\n*** PEGA (${label}) ***`);
  if (pegaResult?.caseId) console.log('  PEGA:', pegaResult.caseId);
  if (pegaResult?.pegaOrdemServicoOs) console.log('  PEGA OS:', pegaResult.pegaOrdemServicoOs);
  return pegaResult;
}

module.exports = { runPegaAfterSuborderIfConfigured };
