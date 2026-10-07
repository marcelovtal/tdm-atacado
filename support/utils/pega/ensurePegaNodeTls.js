/**
 * Paridade com `server/runScript.js`: ambientes corporativos (proxy/MITM) injetam
 * certificado autoassinado na cadeia TLS do PEGA. Sem isso, `fetch` falha com
 * `SELF_SIGNED_CERT_IN_CHAIN` / `fetch failed` no CLI local (`node scripts/...`).
 *
 * Só define o default se a variável ainda não estiver setada (permite override).
 */
function ensurePegaNodeTls() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

module.exports = { ensurePegaNodeTls };
