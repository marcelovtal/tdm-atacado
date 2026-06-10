const { getPegaFixture, getPegaDefaults } = require('../../../config/env.js');
const { getPegaAccessToken } = require('./getPegaAccessToken.js');

/** OAuth2 ou PEGA_BEARER_TOKEN — null se credenciais ausentes. */
async function resolvePegaBearerToken() {
  const filePega = getPegaFixture();
  const defaults = getPegaDefaults();
  const direct = (process.env.PEGA_BEARER_TOKEN || '').trim();
  if (direct) return direct;

  const clientId = (process.env.PEGA_CLIENT_ID || filePega?.client_id || '').trim();
  const clientSecret = (process.env.PEGA_CLIENT_SECRET || filePega?.client_secret || '').trim();
  if (!clientId || !clientSecret) return null;

  const tokenUrl = (process.env.PEGA_TOKEN_URL || filePega?.token_url || defaults.token_url).trim();
  return getPegaAccessToken({ tokenUrl, clientId, clientSecret });
}

module.exports = { resolvePegaBearerToken };
