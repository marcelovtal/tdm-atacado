/**
 * Erros causados por entrada/configuração do usuário (massa de outro ambiente, IDs inválidos, etc.)
 * e erros de ambiente/integração (Salesforce/Pega/OFS) — distintos de falhas técnicas do script.
 */

const SF_ACCOUNT_ID = /001[A-Za-z0-9]{12,15}/;

const INTEGRATION_ORDER_STATUS_MESSAGE =
  'Não foi alterado o status da ordem para "Em implantação". Erro no Salesforce ou no Pega.';

const PEGA_OFS_INTEGRATION_MESSAGE =
  'Erro no PEGA ou no OFS ao concluir agendamento/instalação (workzone ou integração com o OFS).';

function envErrorResult(code, message) {
  return { userError: false, envError: true, code, message };
}

/** Extrai texto após [FDL_ENV_ERROR] mesmo quando vem em "ERRO (run N): ...". */
function extractTaggedEnvErrorMessage(combined) {
  const lines = String(combined || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf('[FDL_ENV_ERROR]');
    if (idx === -1) continue;
    const message = line.slice(idx + '[FDL_ENV_ERROR]'.length).trim();
    if (message) return message;
  }
  const m = String(combined || '').match(/\[FDL_ENV_ERROR\]\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

/** Se o log já traz Status final / Sub-pedidos, usa isso em vez da mensagem genérica. */
function enrichEmImplantacaoMessage(combined, fallback = INTEGRATION_ORDER_STATUS_MESSAGE) {
  const tagged = extractTaggedEnvErrorMessage(combined);
  if (tagged) return tagged;

  const statusFinal = combined.match(/Status final(?: dos subpedidos)?:\s*([^\n.]+)/i);
  const subPedidos = combined.match(/Sub-pedidos:\s*([^\n]+)/i);
  let msg = fallback;
  if (statusFinal && !/Status final:/i.test(msg)) {
    msg += ` Status final: ${statusFinal[1].trim()}.`;
  }
  if (subPedidos && !/Sub-pedidos:/i.test(msg)) {
    msg += ` Sub-pedidos: ${subPedidos[1].trim()}`;
    if (!msg.endsWith('.')) msg += '.';
  }
  // Fallback: últimas linhas do poll "00007232 (Ponta A): OS aberta"
  if (!statusFinal && !subPedidos) {
    const rows = [...String(combined).matchAll(/^\s*-\s*(\S+)\s*\(([^)]+)\):\s*(.+)$/gm)];
    if (rows.length) {
      const detail = rows.map((r) => `${r[1]} (${r[2]}): ${r[3].trim()}`).join('; ');
      const statuses = [...new Set(rows.map((r) => r[3].trim()))];
      msg += ` Status final: ${statuses.join(', ')}. Sub-pedidos: ${detail}.`;
    }
  }
  return msg;
}

function isPegaOfsIntegrationError(combined) {
  if (/Não foi possível efetuar agendamento no OFS/i.test(combined)) return true;
  if (/Falta campo obrigatório de workzone.*envio ao OFS/i.test(combined)) return true;
  if (/workzone.*envio ao OFS/i.test(combined) && /SelecaoDePeriodo|SelecaoDoSlot|PEGA PATCH/i.test(combined)) {
    return true;
  }
  if (/SelecaoDePeriodo.*status:\s*422/i.test(combined) && /workzone|OFS|Validation fail/i.test(combined)) {
    return true;
  }
  if (
    /Validation fail/i.test(combined) &&
    /SelecaoDePeriodo|SelecaoDoSlot/i.test(combined) &&
    /PEGA PATCH|PEGA LD|PEGA VPN|\[PEGA\]/i.test(combined)
  ) {
    return true;
  }
  return false;
}

function extractAccountIdFromLogs(text) {
  const fromUrl = text.match(/sobjects\/Account\/(001[A-Za-z0-9]{12,15})/i);
  if (fromUrl) return fromUrl[1];
  const fromIds = text.match(SF_ACCOUNT_ID);
  return fromIds ? fromIds[0] : null;
}

function hasNotFoundSignal(text) {
  return (
    /Status:\s*404\b/i.test(text) ||
    /"errorCode"\s*:\s*"NOT_FOUND"/i.test(text) ||
    /\bNOT_FOUND\b/.test(text)
  );
}

function isMassaProntaContext(text, envVars = {}) {
  if (/massa pronta|START_FROM_QUOTE|Modo START_FROM_QUOTE/i.test(text)) return true;
  if (
    envVars.START_FROM_QUOTE === '1' ||
    envVars.ACCOUNT_ORGANIZATION_ID ||
    envVars.ACCOUNT_BUSINESS_ID ||
    envVars.ACCOUNT_BILLING_ID
  ) {
    return true;
  }
  return false;
}

/**
 * @returns {{ userError?: boolean, envError?: boolean, code: string, message: string } | null}
 */
export function classifyUserJobError({
  stderr = '',
  stdout = '',
  errorMessage = '',
  environment = 'ti',
  envVars = {},
} = {}) {
  const combined = `${stderr}\n${stdout}\n${errorMessage}`;
  const envUpper = String(environment || 'ti').toUpperCase();
  const massaPronta = isMassaProntaContext(combined, envVars);

  if (/^\s*\[FDL_USER_ERROR\]/m.test(combined)) {
    const line =
      combined
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('[FDL_USER_ERROR]')) || '';
    const message = line.replace(/^\[FDL_USER_ERROR\]\s*/, '').trim();
    if (message) {
      return { userError: true, code: 'FDL_USER_ERROR', message };
    }
  }

  const taggedEnvMsg = extractTaggedEnvErrorMessage(combined);
  if (taggedEnvMsg) {
    return envErrorResult('FDL_ENV_ERROR', taggedEnvMsg);
  }

  const massaAccountGet =
    massaPronta &&
    /GET (?:Org|Business|Billing) \(massa pronta\)/i.test(combined) &&
    hasNotFoundSignal(combined);

  if (massaAccountGet || (massaPronta && hasNotFoundSignal(combined) && /sobjects\/Account\//i.test(combined))) {
    const accountId = extractAccountIdFromLogs(combined);
    const idHint = accountId ? ` Conta: ${accountId}.` : '';
    return {
      userError: true,
      code: 'MASS_ACCOUNT_NOT_FOUND',
      message: `Conta da massa pronta não existe no ambiente ${envUpper}.${idHint} Use Organization/Business/Billing deste ambiente (ex.: IDs de TRG não funcionam em TI).`,
    };
  }

  const hasCrossRefError =
    /INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY/i.test(combined) ||
    /insufficient access rights on cross-reference id/i.test(combined);

  if (hasCrossRefError && (massaPronta || SF_ACCOUNT_ID.test(combined))) {
    const accountId =
      (combined.match(/cross-reference id:\s*(001[A-Za-z0-9]{12,15})/i) || [])[1] ||
      extractAccountIdFromLogs(combined);
    const idHint = accountId ? ` Conta: ${accountId}.` : '';
    return {
      userError: true,
      code: 'MASS_ACCOUNT_ENV_MISMATCH',
      message: massaPronta
        ? `Conta da massa pronta não existe no ambiente ${envUpper}.${idHint} Use Organization/Business/Billing deste ambiente — IDs de TRG não funcionam em TI (e vice-versa).`
        : `Referência de conta inválida ou inacessível no ambiente ${envUpper}.${idHint}`,
    };
  }

  if (/Nenhum contato técnico encontrado\/criado|Informe CONTACT_TECNICO_ID/i.test(combined)) {
    return {
      userError: true,
      code: 'MISSING_TECHNICAL_CONTACT',
      message:
        'Contato técnico ausente na massa pronta. Informe CONTACT_TECNICO_ID ou use massa com contatos do fluxo Lead/BRM.',
    };
  }

  if (isPegaOfsIntegrationError(combined)) {
    return envErrorResult('PEGA_OFS_INTEGRATION_ERROR', PEGA_OFS_INTEGRATION_MESSAGE);
  }

  if (/\[FDL_INTEGRATION_ERROR\]/.test(combined)) {
    return envErrorResult(
      'INTEGRATION_ERROR',
      enrichEmImplantacaoMessage(combined, INTEGRATION_ORDER_STATUS_MESSAGE),
    );
  }

  if (
    /Não foi alterado o status da ordem para ["']?Em implantação["']?/i.test(combined) ||
    /Timeout: nem todos os subpedidos|nenhum subpedido com Status "Em implantação"/i.test(combined) ||
    (/Status atual dos subpedidos:/i.test(combined) &&
      /OS aberta/i.test(combined) &&
      /PEGA LD EVC|Falha no fluxo PEGA|obterdadosordem/i.test(combined))
  ) {
    return envErrorResult(
      'SUB_ORDER_STATUS_TIMEOUT',
      enrichEmImplantacaoMessage(combined, INTEGRATION_ORDER_STATUS_MESSAGE),
    );
  }

  if (
    /PEGA LD EVC|PEGA LD:|PEGA obterdadosordem|pyMemo|ChaveCaseOrdem|Pending-AguardarConfiguracaoEVC|Falha no fluxo PEGA/i.test(
      combined,
    ) &&
    /ERRO \(run|\[PEGA\]|throw new Error/i.test(combined)
  ) {
    return envErrorResult('SF_PEGA_INTEGRATION_ERROR', INTEGRATION_ORDER_STATUS_MESSAGE);
  }

  return null;
}

/** Reclassifica histórico gravado como failed antes desta feature. */
export function resolveJobFailureDisplay({
  status,
  errorMessage,
  stderr,
  stdout,
  environment,
  userError,
  envError,
} = {}) {
  if (status === 'user_error' || userError) {
    return {
      status: 'user_error',
      error: errorMessage || null,
    };
  }
  if (status === 'env_error' || envError) {
    const combined = `${stderr || ''}\n${stdout || ''}\n${errorMessage || ''}`;
    const enriched = enrichEmImplantacaoMessage(
      combined,
      errorMessage || INTEGRATION_ORDER_STATUS_MESSAGE,
    );
    return {
      status: 'env_error',
      error: enriched,
    };
  }
  if (status === 'failed') {
    const classified = classifyUserJobError({ stderr, stdout, errorMessage, environment });
    if (classified?.userError) {
      return { status: 'user_error', error: classified.message };
    }
    if (classified?.envError) {
      return { status: 'env_error', error: classified.message };
    }
    if (classified?.message) {
      return { status: 'failed', error: classified.message };
    }
  }
  return { status: status || 'failed', error: errorMessage || null };
}
