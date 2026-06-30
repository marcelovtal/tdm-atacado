const { buildContactPayload } = require('./contactPayload.js');
const { formatMassAccountEnvErrorMessage } = require('./assertMassaProntaAccounts.js');

async function queryContactId(apiCall, queryUrl, accountId, technicalOnly = false) {
  const typeFilter = technicalOnly ? " AND vlocity_cmt__Type__c = 'Technical'" : '';
  const soql = `SELECT Id FROM Contact WHERE AccountId = '${accountId}' AND IsDeleted = false${typeFilter} ORDER BY CreatedDate DESC LIMIT 1`;
  const res = await apiCall('GET', `${queryUrl}?q=${encodeURIComponent(soql)}`);
  if (res.status === 200 && res.data?.records?.length) {
    return res.data.records[0].Id;
  }
  return null;
}

/**
 * Resolve contato técnico (vlocity_cmt__Type__c = Technical) para massa pronta.
 * Busca na Business e, opcionalmente, Organization/Billing (fallbackAccountIds).
 * Cria na Business só se não achar em nenhuma conta — necessário em TRG (Vtal_Contact__c no Order).
 */
async function resolveTechnicalContactForBusiness(apiCall, accountBussinessId, options = {}) {
  if (!accountBussinessId || !apiCall) return null;

  const queryUrl = options.queryUrl || '/services/data/v62.0/query';
  const sobjectsContact = options.sobjectsContactPath || '/services/data/v62.0/sobjects/Contact';
  const accountIds = [
    accountBussinessId,
    ...(Array.isArray(options.fallbackAccountIds) ? options.fallbackAccountIds : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const uniqueAccountIds = [...new Set(accountIds)];

  for (const accId of uniqueAccountIds) {
    const techId = await queryContactId(apiCall, queryUrl, accId, true);
    if (techId) {
      if (accId !== accountBussinessId) {
        console.log(`[E2E] Contato técnico encontrado na conta ${accId} (fallback).`);
      }
      return techId;
    }
  }

  for (const accId of uniqueAccountIds) {
    const anyId = await queryContactId(apiCall, queryUrl, accId, false);
    if (anyId) {
      console.log(
        `[E2E] Contato (sem Type=Technical) na conta ${accId}${accId !== accountBussinessId ? ' — fallback' : ''}.`,
      );
      return anyId;
    }
  }

  if (options.skipCreate === true) return null;

  console.log('[E2E] Nenhum contato nas contas da massa — tentando criar Technical na Business...');
  const createRes = await apiCall('POST', sobjectsContact, buildContactPayload(accountBussinessId, 'Technical'));
  if (createRes.status === 201 && createRes.data?.id) {
    return createRes.data.id;
  }

  const errBody = Array.isArray(createRes.data) ? createRes.data[0] : createRes.data;
  const errCode = errBody?.errorCode || '';
  const errMsg = errBody?.message || createRes.text?.slice(0, 200) || '';
  if (/INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE/i.test(`${errCode} ${errMsg}`)) {
    const crossRefId = (String(errMsg).match(/001[A-Za-z0-9]{12,15}/i) || [])[0] || accountBussinessId;
    const env = options.environment || process.env.ENVIRONMENT || 'ti';
    console.error(formatMassAccountEnvErrorMessage('Business', crossRefId, env));
  } else if (errMsg) {
    console.warn('[E2E] CREATE Contact na Business falhou:', createRes.status, errMsg);
  }
  return null;
}

module.exports = { resolveTechnicalContactForBusiness };
