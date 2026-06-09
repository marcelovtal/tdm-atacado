/**
 * Monta headers para requisições API (Bearer + Content-Type; Cookie opcional).
 */
function headers(token, cookie = '') {
  const h = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (cookie) h.Cookie = cookie;
  return h;
}

module.exports = { headers };
