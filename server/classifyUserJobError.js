/**
 * Erros causados por entrada/configuração do usuário (massa de outro ambiente, IDs inválidos, etc.).
 * Distinguídos de falhas técnicas do script/integração.
 */

const SF_ACCOUNT_ID = /001[A-Za-z0-9]{12,15}/;

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
 * @returns {{ userError: true, code: string, message: string } | null}
 */
export function classifyUserJobError({ stderr = '', stdout = '', environment = 'ti', envVars = {} } = {}) {
  const combined = `${stderr}\n${stdout}`;
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

  if (/Nenhum contato técnico encontrado\/criado|Informe CONTACT_TECNICO_ID/i.test(combined)) {
    return {
      userError: true,
      code: 'MISSING_TECHNICAL_CONTACT',
      message:
        'Contato técnico ausente na massa pronta. Informe CONTACT_TECNICO_ID ou use massa com contatos do fluxo Lead/BRM.',
    };
  }

  if (/INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY/i.test(combined) && /Contact/i.test(combined)) {
    return {
      userError: true,
      code: 'CONTACT_CREATE_DENIED',
      message:
        'Não foi possível criar contato na conta Business. Informe CONTACT_TECNICO_ID de um contato existente neste ambiente.',
    };
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
} = {}) {
  if (status === 'user_error' || userError) {
    return {
      status: 'user_error',
      error: errorMessage || null,
    };
  }
  if (status === 'failed') {
    const classified = classifyUserJobError({ stderr, stdout, environment });
    if (classified?.userError) {
      return { status: 'user_error', error: classified.message };
    }
  }
  return { status: status || 'failed', error: errorMessage || null };
}
