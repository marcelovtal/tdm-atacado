const { getPegaFixture, getPegaDefaults } = require('../../../config/env.js');
const { getPegaAccessToken } = require('./getPegaAccessToken.js');

/** OAuth2 ou PEGA_BEARER_TOKEN — null se credenciais ausentes. */
async function resolvePegaBearerToken() {
  const pega = getPegaFixture();
  const defaults = getPegaDefaults();
  const direct = (process.env.PEGA_BEARER_TOKEN || '').trim();
  if (direct) return direct;

  const clientId = (pega?.client_id || '').trim();
  const clientSecret = (pega?.client_secret || '').trim();
  if (!clientId || !clientSecret) return null;

  const tokenUrl = (pega?.token_url || defaults.token_url || '').trim();
  return getPegaAccessToken({ tokenUrl, clientId, clientSecret });
}

module.exports = { resolvePegaBearerToken };
