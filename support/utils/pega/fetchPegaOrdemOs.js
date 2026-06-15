const { getPegaFixture, getPegaDefaults } = require('../../../config/env.js');
const {
  parseObterDadosOrdemResponse,
  extractOrdemServicoOsFromItem,
  isLinkDedicadoObterDadosArray,
} = require('./obterDadosOrdem.js');
const { resolvePegaBearerToken } = require('./resolvePegaBearerToken.js');
const { delay } = require('../helpers/waitHelper.js');

function buildParseOpts(ordemServico, options = {}) {
  const parseOpts = {};
  const ldLeg = options.ldLeg != null ? String(options.ldLeg).trim() : '';
  if (options.linkDedicado || ldLeg) {
    parseOpts.linkDedicado = true;
    parseOpts.matchOrdemServico = ordemServico;
    if (ldLeg) parseOpts.ldLeg = ldLeg;
  }
  return parseOpts;
}

function extractOsFromObterDados(data, ordemServico, options = {}) {
  const parseOpts = buildParseOpts(ordemServico, options);
  let parseOptsFinal = parseOpts;
  if (!parseOpts.linkDedicado && isLinkDedicadoObterDadosArray(data)) {
    parseOptsFinal = {
      linkDedicado: true,
      matchOrdemServico: ordemServico,
      ldLeg: options.ldLeg || 'evc',
    };
  }
  const parsed = parseObterDadosOrdemResponse(data, parseOptsFinal);
  let pegaOrdemServicoOs = extractOrdemServicoOsFromItem(parsed?.item);
  if (!pegaOrdemServicoOs && parseOptsFinal.linkDedicado && String(parseOptsFinal.ldLeg).toLowerCase() === 'evc') {
    const evcRow = data.find((i) => String(i?.PontaView ?? '').trim() === 'EVC');
    if (evcRow) pegaOrdemServicoOs = extractOrdemServicoOsFromItem(evcRow);
  }
  return { pegaOrdemServicoOs, caseId: parsed?.caseId || null };
}

/**
 * Consulta leve ao PEGA: GET obterdadosordem com ORDEMSERVICO = número do subpedido CRM.
 * Retorna CaseOrdemServico (ex. OS-154002) — "Número Pedido OSS" no PEGA.
 *
 * @param {string} ordemServicoCrm
 * @param {typeof fetch} [fetchImpl]
 * @param {{
 *   linkDedicado?: boolean,
 *   ldLeg?: 'pontaA'|'pontaB'|'evc'|string,
 *   maxTries?: number,
 *   retryMs?: number,
 * }} [options]
 */
async function fetchPegaOrdemOsFromCrm(ordemServicoCrm, fetchImpl = global.fetch, options = {}) {
  if (!ordemServicoCrm) return null;
  if (process.env.SKIP_PEGA === '1') return null;
  if (typeof fetchImpl !== 'function') return null;

  const override = (process.env.PEGA_ORDEM_SERVICO || '').trim();
  const ordemServico = override || String(ordemServicoCrm).trim();

  let token;
  try {
    token = await resolvePegaBearerToken();
  } catch (err) {
    console.log('[PEGA] OAuth falhou ao consultar ordem OSS:', err.message);
    return null;
  }
  if (!token) {
    console.log(
      '[PEGA] Sem credenciais — ordem OSS não consultada (user.json → pega ou PEGA_CLIENT_ID/PEGA_CLIENT_SECRET).',
    );
    return null;
  }

  const filePega = getPegaFixture();
  const defaults = getPegaDefaults();
  const base = (process.env.PEGA_BASE_URL || filePega?.base_url || defaults.base_url).replace(/\/$/, '');
  const cookie = (process.env.PEGA_COOKIE || filePega?.cookie || '').trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };

  const defaultMaxTries = parseInt(String(process.env.PEGA_OBTER_DADOS_EMPTY_MAX_TRIES || '12').trim(), 10) || 12;
  const defaultRetryMs = parseInt(String(process.env.PEGA_OBTER_DADOS_EMPTY_RETRY_MS || '5000').trim(), 10) || 5000;
  const maxTries = Math.max(1, options.maxTries ?? defaultMaxTries);
  const retryMs = Math.max(0, options.retryMs ?? defaultRetryMs);

  const legHint = options.ldLeg ? ` [LD ${options.ldLeg}]` : '';
  console.log(`[PEGA] Consultando ordem OSS (obterdadosordem)${legHint} — subpedido CRM ${ordemServico}...`);

  for (let i = 1; i <= maxTries; i++) {
    const url = `${base}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(ordemServico)}`;
    const res = await fetchImpl(url, { method: 'GET', headers });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      console.log(`[PEGA] obterdadosordem HTTP ${res.status} (${i}/${maxTries})`);
      if (i < maxTries) await delay(retryMs);
      continue;
    }

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`[PEGA] obterdadosordem [] — caso ainda não no PEGA (${i}/${maxTries})`);
      if (i < maxTries) await delay(retryMs);
      continue;
    }

    const { pegaOrdemServicoOs, caseId } = extractOsFromObterDados(data, ordemServico, options);

    if (pegaOrdemServicoOs) {
      console.log(`[PEGA] Ordem OSS: ${pegaOrdemServicoOs}${caseId ? ` | Caso: ${caseId}` : ''}`);
      return { pegaOrdemServicoOs, caseId };
    }

    console.log(`[PEGA] obterdadosordem sem CaseOrdemServico OS-* (${i}/${maxTries})`);
    if (i < maxTries) await delay(retryMs);
  }

  console.log('[PEGA] Ordem OSS não disponível no prazo (obterdadosordem).');
  return null;
}

module.exports = { fetchPegaOrdemOsFromCrm, extractOsFromObterDados };
