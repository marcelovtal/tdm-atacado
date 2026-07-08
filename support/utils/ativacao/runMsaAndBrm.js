/**
 * Passos 8–9 compartilhados: Contract MSA + poll BRM na conta Billing.
 */
const { buildContractMSAPayload, buildContractActivatePayload } = require('../salesforce/contractMSAPayload.js');
const { buildContentVersionMSAPayload } = require('../salesforce/contentVersionMSAPayload.js');
const { delay } = require('../helpers/waitHelper.js');
const {
  SOBJECTS_CONTRACT,
  SOBJECTS_CONTENT_VERSION,
  SOBJECTS_CONTENT_DOCUMENT_LINK,
  SOBJECTS_ACCOUNT,
  QUERY_URL,
  TOOLING_EXECUTE_ANONYMOUS,
  BRM_POLL_TIMEOUT_MS,
  BRM_POLL_INTERVAL_MS,
} = require('../salesforce/sfRestPaths.js');
const { isTrgEnv } = require('../salesforce/scriptHttpClient.js');

/**
 * @param {function} apiCall
 * @param {function} fail
 * @param {string} accountOrganizationId
 * @param {{ logPrefix?: string, step?: number }} [opts]
 */
async function runMsaContractStep(apiCall, fail, accountOrganizationId, opts = {}) {
  const logPrefix = opts.logPrefix || '[ATIVACAO]';
  const step = opts.step ?? 8;
  console.log(`${logPrefix} ${step}. Contract MSA + ContentVersion + Link + Activate...`);
  const contractRes = await apiCall('POST', SOBJECTS_CONTRACT, buildContractMSAPayload(accountOrganizationId));
  if (contractRes.status !== 201) fail('Contract', contractRes);
  const contractId = contractRes.data?.id;
  if (!contractId) fail('Contract sem id', contractRes);

  const cvRes = await apiCall('POST', SOBJECTS_CONTENT_VERSION, buildContentVersionMSAPayload());
  if (cvRes.status !== 201) fail('ContentVersion', cvRes);
  const contentVersionId = cvRes.data?.id;
  if (!contentVersionId) fail('ContentVersion sem id', cvRes);

  const qDoc = `SELECT ContentDocumentId FROM ContentVersion WHERE Id='${contentVersionId}'`;
  const qRes = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(qDoc)}`);
  if (qRes.status !== 200 || !qRes.data?.records?.[0]?.ContentDocumentId) {
    fail('Query ContentDocumentId', qRes);
  }
  const contentDocumentId = qRes.data.records[0].ContentDocumentId;

  await apiCall('POST', SOBJECTS_CONTENT_DOCUMENT_LINK, {
    ContentDocumentId: contentDocumentId,
    LinkedEntityId: contractId,
    ShareType: 'V',
  });

  await apiCall('PATCH', `${SOBJECTS_CONTRACT}/${contractId}`, buildContractActivatePayload());
}

/**
 * @param {function} apiCall
 * @param {function} fail
 * @param {string} accountBillingId
 * @param {{ envName?: string, logPrefix?: string, step?: number }} [opts]
 */
async function pollBrmActivation(apiCall, fail, accountBillingId, opts = {}) {
  const logPrefix = opts.logPrefix || '[ATIVACAO]';
  const step = opts.step ?? 9;
  const envName = opts.envName;

  console.log(`${logPrefix} ${step}. getAccount (executeAnonymous) + poll BRM...`);
  if (isTrgEnv(envName)) {
    console.log(
      `${logPrefix} TRG: BRM activation/poll desativado. Pulando executeAnonymous/poll para AccountBillingId:`,
      accountBillingId,
    );
    return;
  }

  const apexBody = `try { Map<String,Object> r = Vtal_SF_IntegrationBillAccController.getAccount('${accountBillingId}'); System.debug(JSON.serialize(r)); } catch(Exception e) { System.debug(e.getMessage()); }`;
  const execRes = await apiCall(
    'GET',
    `${TOOLING_EXECUTE_ANONYMOUS}/?anonymousBody=${encodeURIComponent(apexBody)}`,
  );
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
  if (!billingBody?.vtal_LXD_BRMId__c) {
    console.error(
      `[BRM] Falha: vtal_LXD_BRMId__c não retornado após ${Math.round(BRM_POLL_TIMEOUT_MS / 1000)}s.`,
    );
    fail('BRM não preenchido no timeout', { status: 0, data: billingBody });
  }

  console.log(`${logPrefix} Aguardando 45s para conta Billing/Business ficar ativa no BRM...`);
  await delay(45000);
  console.log(`${logPrefix} Lead + BRM OK. AccountBillingId:`, accountBillingId);
  console.log(`${logPrefix} AccountBillingId:`, accountBillingId);
}

module.exports = { runMsaContractStep, pollBrmActivation };
