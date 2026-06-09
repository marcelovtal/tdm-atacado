/**
 * Contexto compartilhado entre steps de Salesforce (token, instance_url e última resposta do token).
 * Preenchido após autenticação; usado na criação de Lead, validação de schema e outras APIs.
 */
let accessToken = null;
let instanceUrl = null;
let lastTokenResponse = null;

function setToken(token, url) {
  accessToken = token;
  instanceUrl = url || null;
}

function setLastTokenResponse(body) {
  lastTokenResponse = body;
}

function getLastTokenResponse() {
  return lastTokenResponse;
}

function getToken() {
  return accessToken;
}

function getInstanceUrl() {
  return instanceUrl;
}

function clear() {
  accessToken = null;
  instanceUrl = null;
  lastTokenResponse = null;
}

module.exports = { setToken, setLastTokenResponse, getLastTokenResponse, getToken, getInstanceUrl, clear };
