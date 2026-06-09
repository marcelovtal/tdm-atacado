/**
 * Valida OAuth2 e GET obterdadosordem no PEGA do ambiente atual (TI=QA, TRG=stg1).
 *
 * Uso:
 *   node scripts/test-pega-auth.js
 *   ENVIRONMENT=trg PEGA_DESIGNACAO=RJRJO1000001924 node scripts/test-pega-auth.js
 *   ENVIRONMENT=trg PEGA_BEARER_TOKEN=<token-postman> PEGA_DESIGNACAO=RJRJO1000001924 node scripts/test-pega-auth.js
 */
const { getEnvName, getPegaFixture, getPegaDefaults } = require('../config/env.js');
const { getPegaAccessToken } = require('../support/utils/pega/getPegaAccessToken.js');

async function main() {
  const env = getEnvName();
  const pega = getPegaFixture();
  const defaults = getPegaDefaults();

  const tokenUrl = (process.env.PEGA_TOKEN_URL || pega?.token_url || defaults.token_url).trim();
  const baseUrl = (process.env.PEGA_BASE_URL || pega?.base_url || defaults.base_url).replace(/\/$/, '');
  const clientId = (process.env.PEGA_CLIENT_ID || pega?.client_id || '').trim();
  const clientSecret = (process.env.PEGA_CLIENT_SECRET || pega?.client_secret || '').trim();
  const designacao = (process.env.PEGA_DESIGNACAO || 'RJRJO1000001924').trim();
  const ordemServico = (process.env.PEGA_ORDEM_SERVICO || process.env.ORDEMSERVICO || '').trim();

  console.log(`Ambiente: ${env}`);
  console.log(`PEGA token URL: ${tokenUrl}`);
  console.log(`PEGA base URL: ${baseUrl}`);

  let bearer = (process.env.PEGA_BEARER_TOKEN || '').trim();
  if (!bearer) {
    if (!clientId || !clientSecret) {
      console.error('Defina client_id/secret em user.json ou PEGA_CLIENT_ID / PEGA_CLIENT_SECRET');
      process.exit(1);
    }
    console.log('Obtendo access_token (OAuth2 client_credentials)...');
    bearer = await getPegaAccessToken({ tokenUrl, clientId, clientSecret });
    console.log('access_token OK (primeiros 12 chars):', `${bearer.slice(0, 12)}…`);
  } else {
    console.log('Usando PEGA_BEARER_TOKEN (validação manual Postman).');
  }

  const params = new URLSearchParams();
  if (ordemServico) params.set('ORDEMSERVICO', ordemServico);
  else params.set('DESIGNACAO', designacao);

  const url = `${baseUrl}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?${params}`;
  console.log('GET', url);

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  console.log('HTTP', res.status);
  if (!res.ok) {
    console.error(text?.slice(0, 800) || '(vazio)');
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : data?.data ?? data?.items;
  const count = Array.isArray(rows) ? rows.length : data ? 1 : 0;
  console.log(`Resposta: ${count} registro(s)`);
  if (Array.isArray(rows) && rows[0]) {
    const r = rows[0];
    console.log('  ChaveCaseOrdem:', r.ChaveCaseOrdem ?? '—');
    console.log('  CaseOrdemServico:', r.CaseOrdemServico ?? '—');
    console.log('  pyMemo:', r.pyMemo ? `${String(r.pyMemo).slice(0, 40)}…` : '—');
  }
  console.log('\nPEGA TRG/TI — autenticação e obterdadosordem OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
