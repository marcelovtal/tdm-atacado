/**
 * Igual a `ativacao-brm.js` até o passo 7 (módulo `ativacaoBrmRunLeadToContacts.js`).
 * Passo 8+: Contract → anexo mínimo (validação org) → Ativar → DRE + IP Omni (PDF MSA) → BRM.
 *
 * PDF: OMNI_PROCESS_ID_MSA, SF_USER_ID. Omni (ContextId/Id) usa 15 chars como o Lightning (NavEventManager).
 * MSA_OMNI_USE_18_CHAR=1 força Id 18 no Omni se a org exigir.
 * MSA_DISABLE_ALT_ID_RETRY=1 desliga retentativa automática (15↔18) após falha/sem PDF.
 * MSA_PDF_POLL_MS, MSA_REQUIRE_PDF=1, USE_LEGACY_MSA_ATTACHMENT=1 (sem Omni).
 */
const { randomUUID } = require('crypto');
const { runLeadToContactsStep7 } = require('../support/utils/ativacaoBrmRunLeadToContacts.js');
const { buildContractMSAPayload, buildContractActivatePayload } = require('../support/utils/salesforce/contractMSAPayload.js');
const { buildContentVersionMSAPayload } = require('../support/utils/salesforce/contentVersionMSAPayload.js');
const { delay } = require('../support/utils/helpers/waitHelper.js');

const { createSalesforceScriptClient } = require('../support/utils/salesforce/scriptHttpClient.js');
const {
  SOBJECTS_ACCOUNT,
  SOBJECTS_CONTRACT,
  SOBJECTS_CONTENT_VERSION,
  SOBJECTS_CONTENT_DOCUMENT_LINK,
  QUERY_URL,
  TOOLING_EXECUTE_ANONYMOUS,
  IP_GENERIC_INVOKE,
  BRM_POLL_TIMEOUT_MS,
  BRM_POLL_INTERVAL_MS,
} = require('../support/utils/salesforce/sfRestPaths.js');

const {
  baseUrl,
  tokenUrl,
  envName,
  IS_TRG,
  sf,
  cookie: defaultCookie,
  getToken,
  api,
  fail,
} = createSalesforceScriptClient();
/** OmniScript Vtal_OS_MSAToPDF — Id do processo (ajuste por org se necessário). */
const OMNI_PROCESS_ID_MSA = process.env.OMNI_PROCESS_ID_MSA || '0jNHZ000000GWIT2A4';

/** Id Salesforce em 15 caracteres (DRParams do DRE costuma usar 15). */
function toContractId15(id) {
  if (!id || typeof id !== 'string') return id;
  return id.length === 18 ? id.slice(0, 15) : id;
}

/** Desembrulha result/Result do Vlocity (string JSON, array, IPResult). */
function unwrapVlocityPayload(raw, depth = 0) {
  if (depth > 10 || raw == null) return raw;
  if (typeof raw === 'string') {
    try {
      return unwrapVlocityPayload(JSON.parse(raw), depth + 1);
    } catch {
      return raw;
    }
  }
  if (Array.isArray(raw) && raw.length) return unwrapVlocityPayload(raw[0], depth + 1);
  if (typeof raw === 'object') {
    if (raw.IPResult != null) return unwrapVlocityPayload(raw.IPResult, depth + 1);
    if (raw.result != null) return unwrapVlocityPayload(raw.result, depth + 1);
    if (raw.Result != null) return unwrapVlocityPayload(raw.Result, depth + 1);
  }
  return raw;
}

/** true se o corpo do IP indica falha (HTTP 200 com erro embutido é comum no Vlocity). */
function integrationProcedureResponseIndicatesFailure(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.error || data.errors?.length) return true;
  let raw = unwrapVlocityPayload(data.result ?? data.Result ?? data);
  if (raw == null) return false;
  if (typeof raw === 'object') {
    if (raw.success === false) return true;
    if (raw.error != null || raw.errorCode != null || raw.faultcode != null) return true;
  }
  return false;
}

/** Extrai o objeto DRE_TemplateMSA da resposta do invokeOutboundDR (formatos variam por org). */
function extractDreTemplateMsa(ipRes) {
  const d = ipRes?.data;
  if (!d) return null;
  let raw = unwrapVlocityPayload(d.result ?? d.Result ?? d);
  if (raw?.DRE_TemplateMSA && typeof raw.DRE_TemplateMSA === 'object') return raw.DRE_TemplateMSA;
  if (raw?.result?.DRE_TemplateMSA) return raw.result.DRE_TemplateMSA;
  if (raw?.data?.DRE_TemplateMSA) return raw.data.DRE_TemplateMSA;
  if (raw?.ContactName != null && raw?.ContractNumber != null) return raw;
  return null;
}

/** Alguns IPs retornam ContentDocumentId no JSON (evita depender só do SOQL assíncrono). */
function tryExtractContentDocumentIdFromIpResponse(ipRes) {
  const walk = (obj, depth) => {
    if (depth > 12 || obj == null) return null;
    if (typeof obj === 'string') {
      try {
        return walk(JSON.parse(obj), depth + 1);
      } catch {
        return null;
      }
    }
    if (typeof obj !== 'object') return null;
    const cid = obj.ContentDocumentId;
    if (typeof cid === 'string' && /^[a-zA-Z0-9]{15,18}$/.test(cid)) return cid;
    for (const v of Object.values(obj)) {
      const found = walk(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(ipRes?.data, 0);
}

async function resolveUserIdForMsa(apiCall, sf) {
  const fromEnv = process.env.SF_USER_ID?.trim();
  if (fromEnv) return fromEnv;
  const un = sf.username || process.env.SF_USERNAME;
  if (!un) return null;
  const escaped = un.replace(/'/g, "\\'");
  const q = `SELECT Id FROM User WHERE Username = '${escaped}' LIMIT 1`;
  const r = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
  if (r.status === 200 && r.data?.records?.[0]?.Id) return r.data.records[0].Id;
  return null;
}

/**
 * Gera o PDF MSA como no Lightning: DRE template + IP Vtal_IP_CreateContractMSA.
 * @param {{ forceUse18CharForOmni?: boolean }} [opts] — sobrescreve MSA_OMNI_USE_18_CHAR para ContextId/Id do Omni.
 * @returns {{ ok: boolean, pdfIpRes?: object, dreRes?: object }}
 */
async function runMsaPdfViaIntegrationProcedure(apiCall, contractId, sf, opts = {}) {
  const id15 = toContractId15(contractId);
  const rawId = String(contractId || '').trim();
  const id18 = rawId.length >= 18 ? rawId.slice(0, 18) : rawId;
  const userId = await resolveUserIdForMsa(apiCall, sf);
  const userName = sf.username || process.env.SF_USER_NAME || 'api.integration';
  if (!userId && !process.env.SF_USER_ID) {
    console.log('   Aviso: userId não resolvido (defina SF_USER_ID no env se o PDF Omni falhar).');
  }

  console.log('[ATIVACAO] 8b. DRE Vtal_DRE_TemplateMSA (invokeOutboundDR, após contrato Ativado)...');
  const dreBody = {
    sClassName: 'vlocity_cmt.DefaultDROmniScriptIntegration',
    sMethodName: 'invokeOutboundDR',
    input: JSON.stringify({
      Bundle: 'Vtal_DRE_TemplateMSA',
      DRParams: { Id: id15 },
    }),
    options: JSON.stringify({
      useQueueableApexRemoting: false,
      ignoreCache: true,
      vlcClass: 'vlocity_cmt.DefaultDROmniScriptIntegration',
    }),
  };
  const dreRes = await apiCall('POST', IP_GENERIC_INVOKE, dreBody);
  const dreHttpOk = dreRes.status === 200 || dreRes.status === 201;
  const drePayloadErr = dreRes.data?.error || dreRes.data?.errors?.[0];
  const dreInnerFail = integrationProcedureResponseIndicatesFailure(dreRes.data);
  if (!dreHttpOk || drePayloadErr || dreInnerFail) {
    console.log(
      '   DRE Vtal_DRE_TemplateMSA falhou:',
      dreRes.status,
      drePayloadErr || (dreInnerFail ? '(erro no corpo result/IPResult)' : '') || dreRes.text?.slice(0, 200),
    );
    return { ok: false, dreRes };
  }

  const dreMsa = extractDreTemplateMsa(dreRes);
  if (!dreMsa || typeof dreMsa !== 'object') {
    console.log('   DRE retornou OK mas não foi possível extrair DRE_TemplateMSA (veja resposta acima).');
    return { ok: false, dreRes };
  }

  const now = new Date();
  /** Lightning (getResolvedIntegrationUrl / c__ContextId) usa Id 15 no Omni; REST devolve 18 no POST Contract. */
  const use18ForOmni =
    opts.forceUse18CharForOmni !== undefined
      ? opts.forceUse18CharForOmni
      : process.env.MSA_OMNI_USE_18_CHAR === '1';
  const idOmni = use18ForOmni ? (id18.length >= 18 ? id18 : id15) : id15;
  /** Mesmo campo do Omni (-180 = GMT-3, como no HAR do Lightning). */
  const userTimeZone =
    process.env.MSA_USER_TIMEZONE_OFFSET != null && process.env.MSA_USER_TIMEZONE_OFFSET !== ''
      ? String(process.env.MSA_USER_TIMEZONE_OFFSET)
      : String(-now.getTimezoneOffset());
  const ipInput = {
    target: 'c:vtal_OSMSAToPDFEnglish',
    tabIcon: 'custom:custom18',
    tabLabel: 'Vtal_OS_MSAToPDF',
    ContextId: idOmni,
    userProfile: process.env.MSA_USER_PROFILE || 'Pre Vendas',
    timeStamp: now.toISOString(),
    userTimeZoneName: process.env.MSA_USER_TIMEZONE || 'America/Sao_Paulo',
    userTimeZone,
    userCurrencyCode: 'BRL',
    userName,
    ...(userId ? { userId } : {}),
    omniProcessId: OMNI_PROCESS_ID_MSA,
    localTimeZoneName: process.env.MSA_USER_TIMEZONE || 'America/Sao_Paulo',
    DRE_TemplateMSA: dreMsa,
    nomeDoc: dreMsa.nomeDoc,
    Id: idOmni,
  };

  console.log(
    '[ATIVACAO] 8c. IP Vtal_IP_CreateContractMSA (geração PDF / anexo — mesmo fluxo do botão Lightning)... Omni ContextId/Id:',
    idOmni.length,
    'chars',
  );
  const parentToken = process.env.MSA_PARENT_INTERACTION_TOKEN?.trim() || randomUUID();
  const pdfBody = {
    sClassName: 'vlocity_cmt.IntegrationProcedureService',
    sMethodName: 'Vtal_IP_CreateContractMSA',
    input: JSON.stringify(ipInput),
    options: JSON.stringify({
      useFuture: false,
      preTransformBundle: '',
      postTransformBundle: '',
      chainable: false,
      useQueueableApexRemoting: false,
      ignoreCache: false,
      ParentInteractionToken: parentToken,
      vlcClass: 'vlocity_cmt.IntegrationProcedureService',
      useContinuation: false,
    }),
  };
  const pdfIpRes = await apiCall('POST', IP_GENERIC_INVOKE, pdfBody);
  const httpOk = pdfIpRes.status === 200 || pdfIpRes.status === 201;
  const payloadErr = pdfIpRes.data?.error || pdfIpRes.data?.errors?.[0];
  const docHint = tryExtractContentDocumentIdFromIpResponse(pdfIpRes);
  const innerFail = integrationProcedureResponseIndicatesFailure(pdfIpRes.data);
  const ok = httpOk && !payloadErr && (!innerFail || !!docHint);
  if (!ok) {
    const unwrapped = unwrapVlocityPayload(pdfIpRes.data);
    const errSnippet =
      unwrapped && typeof unwrapped === 'object'
        ? JSON.stringify(unwrapped).slice(0, 1200)
        : String(pdfIpRes.text || '').slice(0, 1200);
    console.log(
      '   Vtal_IP_CreateContractMSA:',
      pdfIpRes.status,
      payloadErr ||
        (innerFail
          ? '(corpo com success:false — retentativa automática 15↔18 pode ajudar; ou MSA_OMNI_USE_18_CHAR=1)'
          : '') ||
        pdfIpRes.data?.message ||
        pdfIpRes.text?.slice(0, 300),
    );
    if (errSnippet) console.log('   IP payload (trecho):', errSnippet);
  } else if (docHint && innerFail) {
    console.log('   Vtal_IP_CreateContractMSA: ContentDocumentId na resposta — tratando como sucesso apesar de flags no payload.');
  }
  return { ok, pdfIpRes, dreRes };
}

function rowLooksLikePdf(row) {
  const ext = (row.FileExtension || '').toLowerCase();
  if (ext === 'pdf') return true;
  const t = row.Title || '';
  return /\.pdf$/i.test(String(t).trim());
}

/** ContentVersion mais recente .pdf ligado ao Contrato e/ou à Account (Org). */
async function pollMsaPdfOnContractOrOrg(apiCall, contractId, accountOrganizationId, maxMs) {
  const esc = (id) => String(id || '').replace(/'/g, "\\'");
  const deadline = Date.now() + maxMs;
  const pollMs = Math.max(1000, parseInt(process.env.MSA_PDF_POLL_INTERVAL_MS || '3000', 10) || 3000);
  const q = `SELECT Id, Title, FileExtension, CreatedDate FROM ContentVersion WHERE IsLatest = true AND ContentDocumentId IN (SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId IN ('${esc(contractId)}','${esc(accountOrganizationId)}')) ORDER BY CreatedDate DESC LIMIT 15`;
  let loggedNonPdfSample = false;
  while (Date.now() < deadline) {
    const r = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
    if (r.status === 200 && Array.isArray(r.data?.records)) {
      const pdf = r.data.records.find(rowLooksLikePdf);
      if (pdf) {
        console.log('   PDF encontrado (Contrato ou Org):', pdf.Title, '|', pdf.Id);
        return pdf;
      }
      if (!loggedNonPdfSample && r.data.records.length) {
        const sample = r.data.records.slice(0, 3).map((row) => `${row.Title || '?'} (${row.FileExtension || 'sem ext'})`);
        console.log('   Anexos recentes (aguardando .pdf):', sample.join('; '));
        loggedNonPdfSample = true;
      }
    }
    await delay(pollMs);
  }
  console.log(
    '   (timeout: nenhum .pdf na lista de anexos do Contrato nem da Org — ajuste OMNI_PROCESS_ID_MSA / SF_USER_ID ou aumente MSA_PDF_POLL_MS)',
  );
  return null;
}

/** Se o IP devolveu ContentDocumentId, confirma o PDF sem esperar o poll genérico. */
async function fetchContentVersionIfPdf(apiCall, contentDocumentId) {
  if (!contentDocumentId) return null;
  const esc = String(contentDocumentId).replace(/'/g, "\\'");
  const q = `SELECT Id, Title, FileExtension FROM ContentVersion WHERE IsLatest = true AND ContentDocumentId = '${esc}' LIMIT 1`;
  const r = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
  if (r.status === 200 && r.data?.records?.[0] && rowLooksLikePdf(r.data.records[0])) return r.data.records[0];
  return null;
}

/** Anexo mínimo no contrato (ex.: MSA.txt) — obrigatório antes de Status=Activated na org TI. */
async function attachMsaPlaceholderToContract(apiCall, contractId) {
  const cvRes = await apiCall('POST', SOBJECTS_CONTENT_VERSION, buildContentVersionMSAPayload());
  if (cvRes.status !== 201) fail('ContentVersion (anexo pré-ativação)', cvRes);
  const contentVersionId = cvRes.data?.id;
  if (!contentVersionId) fail('ContentVersion sem id', cvRes);
  const qDoc = `SELECT ContentDocumentId FROM ContentVersion WHERE Id='${contentVersionId}'`;
  const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qDoc)}`);
  if (qRes.status !== 200 || !qRes.data?.records?.[0]?.ContentDocumentId) fail('Query ContentDocumentId', qRes);
  const contentDocumentId = qRes.data.records[0].ContentDocumentId;
  const linkRes = await apiCall('POST', SOBJECTS_CONTENT_DOCUMENT_LINK, {
    ContentDocumentId: contentDocumentId,
    LinkedEntityId: contractId,
    ShareType: 'V',
  });
  if (linkRes.status !== 201) fail('ContentDocumentLink (anexo → contrato)', linkRes);
}

function logCurl(method, url, headers = {}, body = null) {
  const h = Object.entries(headers)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
    .join(' \\\n');
  const bodyPart =
    (method === 'POST' || method === 'PATCH') && body != null
      ? ` \\\n  --data-raw '${String(body).slice(0, 2000).replace(/'/g, "'\\''")}${String(body).length > 2000 ? '...' : ''}'`
      : '';
  console.log(`[CURL] ${method} ${url}`);
  console.log(`curl '${url}' \\\n  -X ${method}${h ? ' \\\n' + h : ''}${bodyPart}`);
}

function logResponse(label, status, data, text) {
  console.log(`[RESPONSE] ${label} status: ${status}`);
  const payload = data != null ? JSON.stringify(data, null, 2) : (text || '');
  const maxLen = 4000;
  const out = payload.length > maxLen ? payload.slice(0, maxLen) + '\n... [truncado ' + (payload.length - maxLen) + ' chars]' : payload;
  if (out) console.log(`[RESPONSE] ${label} body:\n${out}`);
}

async function runLeadUntilBRM(instanceUrl, accessToken, cookie) {
  const apiCall = (method, path, body) => api(instanceUrl, accessToken, method, path, body, cookie);

  const { out, contactTecnicoId, envName } = await runLeadToContactsStep7(apiCall, fail);
  const IS_TRG = String(envName || '').trim().toLowerCase() === 'trg';

  console.log('[ATIVACAO] 8. Contract MSA: Draft → anexo (validação org) → Ativar → PDF Omni ou só legado...');
  const contractRes = await apiCall('POST', SOBJECTS_CONTRACT, buildContractMSAPayload(out.AccountOrganizationId));
  if (contractRes.status !== 201) fail('Contract', contractRes);
  const contractId = contractRes.data?.id;
  if (!contractId) fail('Contract sem id', contractRes);

  console.log(
    '[ATIVACAO] 8a. Anexo mínimo no contrato (ContentVersion + link) — ex.: "Não é possível ativar sem anexar o documento..."',
  );
  await attachMsaPlaceholderToContract(apiCall, contractId);

  console.log('[ATIVACAO] 8b. PATCH Contract Status = Activated (+ CustomerSignedDate no payload)...');
  const activateRes = await apiCall('PATCH', `${SOBJECTS_CONTRACT}/${contractId}`, buildContractActivatePayload());
  if (activateRes.status !== 200 && activateRes.status !== 204) fail('PATCH Contract Activate', activateRes);

  const sfUser = sf;

  if (process.env.USE_LEGACY_MSA_ATTACHMENT === '1') {
    console.log('[ATIVACAO] 8c. Modo USE_LEGACY_MSA_ATTACHMENT=1: anexo já aplicado em 8a; Omni PDF não será chamado.');
  } else {
    const pollMs = Math.max(30000, parseInt(process.env.MSA_PDF_POLL_MS || '180000', 10) || 180000);
    const firstUsed18 = process.env.MSA_OMNI_USE_18_CHAR === '1';

    async function pdfRowAfterIpAttempt(ipPdf) {
      let row = null;
      if (ipPdf.ok && ipPdf.pdfIpRes) {
        const fromIp = tryExtractContentDocumentIdFromIpResponse(ipPdf.pdfIpRes);
        if (fromIp) {
          row = await fetchContentVersionIfPdf(apiCall, fromIp);
          if (row) console.log('[ATIVACAO] 8e. PDF referenciado na resposta do IP:', row.Title, '|', row.Id);
        }
      }
      return row;
    }

    let ipPdf = await runMsaPdfViaIntegrationProcedure(apiCall, contractId, sfUser);
    let pdfRow = await pdfRowAfterIpAttempt(ipPdf);
    if (ipPdf.ok && !pdfRow) {
      console.log('[ATIVACAO] 8e. Aguardando PDF nos anexos (Contrato + Account Org, até', Math.round(pollMs / 1000), 's)...');
      pdfRow = await pollMsaPdfOnContractOrOrg(apiCall, contractId, out.AccountOrganizationId, pollMs);
    }

    if ((!pdfRow || !ipPdf.ok) && process.env.MSA_DISABLE_ALT_ID_RETRY !== '1') {
      console.log(
        '[ATIVACAO] 8d. Retentativa DRE+IP (Omni ContextId/Id em',
        firstUsed18 ? '15' : '18',
        'chars — oposto ao primeiro env)...',
      );
      ipPdf = await runMsaPdfViaIntegrationProcedure(apiCall, contractId, sfUser, {
        forceUse18CharForOmni: !firstUsed18,
      });
      pdfRow = (await pdfRowAfterIpAttempt(ipPdf)) || pdfRow;
      if (ipPdf.ok && !pdfRow) {
        pdfRow = await pollMsaPdfOnContractOrOrg(apiCall, contractId, out.AccountOrganizationId, pollMs);
      }
    }

    if (ipPdf.ok && !pdfRow) {
      console.log(
        '   ATENÇÃO: IP pareceu OK mas nenhum .pdf nos anexos (Contrato/Org). Confira OMNI_PROCESS_ID_MSA (Tooling/Setup), SF_USER_ID e aumente MSA_PDF_POLL_MS.',
      );
    }
    if (process.env.MSA_REQUIRE_PDF === '1' && ipPdf.ok && !pdfRow) {
      fail('MSA_REQUIRE_PDF=1: nenhum PDF detectado após Vtal_IP_CreateContractMSA + poll', { status: 0, data: ipPdf.pdfIpRes?.data });
    }
    if (!ipPdf.ok) {
      console.log(
        '[ATIVACAO] 8f. IP MSA falhou — contrato já está ativado com anexo placeholder de 8a (sem segundo upload).',
      );
    }
  }

  console.log('[ATIVACAO] 9. getAccount (executeAnonymous) + poll BRM...');
  const accountBillingId = out.AccountBillingId;
  if (IS_TRG) {
    console.log('[ATIVACAO] TRG: BRM activation/poll desativado. Pulando executeAnonymous/poll para AccountBillingId:', accountBillingId);
  } else {
    const apexBody = `try { Map<String,Object> r = Vtal_SF_IntegrationBillAccController.getAccount('${accountBillingId}'); System.debug(JSON.serialize(r)); } catch(Exception e) { System.debug(e.getMessage()); }`;
    const execRes = await apiCall('GET', `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apexBody)}`);
    if (execRes.status !== 200 || !execRes.data?.success) fail('executeAnonymous getAccount', execRes);

    const deadline = Date.now() + BRM_POLL_TIMEOUT_MS;
    let billingBody;
    while (Date.now() < deadline) {
      const billingGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${accountBillingId}`);
      if (billingGet.status !== 200) fail('GET Billing', billingGet);
      billingBody = billingGet.data;
      if (billingBody?.vtal_LXD_BRMId__c) break;
      await delay(BRM_POLL_INTERVAL_MS);
    }
    if (!billingBody?.vtal_LXD_BRMId__c) fail('BRM não preenchido no timeout', { status: 0, data: billingBody });

    console.log('[ATIVACAO] Aguardando 45s para conta Billing/Business ficar ativa no BRM...');
    await delay(45000);
    console.log('[ATIVACAO] Lead + BRM OK. AccountBillingId:', accountBillingId);
  }
  return {
    accountBillingId,
    accountBussinessId: out.AccountBussinessId,
    accountOrganizationId: out.AccountOrganizationId,
    contactTecnicoId,
    contractId,
  };
}

async function main() {
  if (!tokenUrl || !baseUrl) {
    console.error('Configure env (ENVIRONMENT=dev). Ver support/environment/env.json');
    process.exit(1);
  }
  sf;
  if (!sf.client_id || !sf.client_secret) {
    console.error('Credenciais em user.json (dev.salesforce)');
    process.exit(1);
  }

  console.log('========== ATIVAÇÃO E2E (Lead → BRM) ==========');
  console.log('Token...');
  try {
    const { accessToken, instanceUrl } = await getToken();
    const cookie = sf.cookie || '';
    const result = await runLeadUntilBRM(instanceUrl, accessToken, cookie);
    console.log('\n*** CONTA ATIVADA NO BRM ***');
    console.log('  AccountBillingId:', result.accountBillingId);
    console.log('  AccountBusinessId:', result.accountBussinessId);
    console.log('  AccountOrganizationId:', result.accountOrganizationId);
    console.log('  ContactTecnicoId:', result.contactTecnicoId);
    console.log('  ContractId (MSA):', result.contractId);
    process.exit(0);
  } catch (err) {
    console.error('\nERRO ATIVAÇÃO:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', err.response.data ? JSON.stringify(err.response.data, null, 2) : err.response.text);
    }
    process.exit(1);
  }
}

main();

