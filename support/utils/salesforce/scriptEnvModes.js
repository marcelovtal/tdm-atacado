/**
 * Modos de entrada via env (QUOTE_ID_READY, START_FROM_QUOTE) e retry do main().
 */
const { delay } = require('../helpers/waitHelper.js');

const FULL_FLOW_MAX_RUNS = parseInt(process.env.FULL_FLOW_MAX_RUNS || '3', 10) || 3;

/**
 * Erros de ambiente (SF/Pega/OFS) — não adianta retry do fluxo completo.
 */
function isNonRetryableEnvError(err) {
  const msg = String(err?.message || err || '');
  if (!msg) return false;
  if (/\[FDL_ENV_ERROR\]|\[FDL_INTEGRATION_ERROR\]/i.test(msg)) return true;
  if (/Não foi alterado o status da ordem para ["']?Em implantação["']?/i.test(msg)) return true;
  if (/nenhum subpedido com Status ["']?Em implantação["']?/i.test(msg)) return true;
  if (/Erro no PEGA ou no OFS ao concluir agendamento/i.test(msg)) return true;
  // PEGA/OFS — retry do fluxo completo não resolve (workzone / agendamento)
  if (/Não foi possível efetuar agendamento no OFS/i.test(msg)) return true;
  if (/Falta campo obrigatório de workzone.*envio ao OFS/i.test(msg)) return true;
  if (/PEGA SelecaoDoSlot|PEGA SelecaoDePeriodo/i.test(msg) && /422|Validation fail|workzone|OFS/i.test(msg)) {
    return true;
  }
  // Falha de rede no PEGA — retry do fluxo completo só gera pedido duplicado
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(msg) && /PEGA|obterdadosordem/i.test(msg)) {
    return true;
  }
  return false;
}

function getAccountIdsFromEnv() {
  if (process.env.START_FROM_QUOTE !== '1') return null;
  const accountBussinessId = process.env.ACCOUNT_BUSINESS_ID?.trim();
  const accountOrganizationId = process.env.ACCOUNT_ORGANIZATION_ID?.trim();
  const accountBillingId = process.env.ACCOUNT_BILLING_ID?.trim();
  const contactTecnicoId = process.env.CONTACT_TECNICO_ID?.trim();
  if (!accountBussinessId || !accountOrganizationId || !contactTecnicoId) return null;
  return { accountBussinessId, accountOrganizationId, accountBillingId, contactTecnicoId };
}

function getReadyQuoteFromEnv() {
  if (process.env.QUOTE_ID_READY !== '1') return null;
  const quoteId = process.env.QUOTE_ID?.trim();
  const accountBussinessId = process.env.ACCOUNT_BUSINESS_ID?.trim();
  const accountOrganizationId = process.env.ACCOUNT_ORGANIZATION_ID?.trim();
  const contactTecnicoId = process.env.CONTACT_TECNICO_ID?.trim();
  if (!quoteId || !accountBussinessId || !accountOrganizationId || !contactTecnicoId) return null;
  return { quoteId, accountBussinessId, accountOrganizationId, contactTecnicoId };
}

function logPedidoEnvModes(readyQuote, skipLead) {
  if (readyQuote) {
    console.log('[E2E] Modo QUOTE_ID_READY: cotação pronta. Gerando pedido direto.');
  } else if (skipLead) {
    console.log('[E2E] Modo START_FROM_QUOTE: reutilizando massa. Só cotação pra frente.');
  }
}

/**
 * Loop de retry usado pelos gerar-pedido-* (3 tentativas, token fresco por run).
 * @param {{ getToken: Function, cookie?: string, skipLead?: object|null, onRun: (ctx: { accessToken, instanceUrl, run }) => Promise<boolean> }} options
 * onRun retorna true para encerrar com sucesso (exit 0).
 */
async function runPedidoScriptWithRetries({ getToken, cookie = '', skipLead = null, onRun }) {
  for (let run = 1; run <= FULL_FLOW_MAX_RUNS; run++) {
    console.log('\n========== EXECUÇÃO', run, '/', FULL_FLOW_MAX_RUNS, '==========');
    console.log('Token...');
    const { accessToken, instanceUrl } = await getToken();
    try {
      const done = await onRun({ accessToken, instanceUrl, run, cookie });
      if (done) process.exit(0);
    } catch (err) {
      console.error('\nERRO (run ' + run + '):', err.message);
      if (err.response) {
        console.error('Status:', err.response.status);
        console.error(
          'Body:',
          err.response.data ? JSON.stringify(err.response.data, null, 2) : err.response.text,
        );
      }
      if (isNonRetryableEnvError(err)) {
        console.error('Erro de ambiente (Salesforce/Pega/OFS) — sem retry.');
        process.exit(1);
      }
      if (run < FULL_FLOW_MAX_RUNS) {
        console.log(
          skipLead
            ? 'Nova tentativa em 25s (nova cotação)...'
            : 'Nova tentativa em 25s (novo Lead, nova conta)...',
        );
        await delay(25000);
      } else {
        process.exit(1);
      }
    }
  }
  process.exit(1);
}

module.exports = {
  FULL_FLOW_MAX_RUNS,
  getAccountIdsFromEnv,
  getReadyQuoteFromEnv,
  logPedidoEnvModes,
  isNonRetryableEnvError,
  runPedidoScriptWithRetries,
};
