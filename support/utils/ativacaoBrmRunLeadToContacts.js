/**
 * Passos comuns dos scripts ativacao-brm.js e ativacao-brm-msa.js:
 * Lead → Contacted → Converter Lead → Org/Business/Billing → 2 Contatos.
 */
const { getEnvName } = require('../../config/env.js');
const { buildLeadPayload } = require('./salesforce/leadPayload.js');
const { buildConvertLeadPayload, getFieldValue } = require('./salesforce/convertLeadPayload.js');
const { buildOrganizationPatchPayload, resolveLxdFantasyName } = require('./salesforce/organizationPatchPayload.js');
const { buildBusinessAccountPatchPayload } = require('./salesforce/businessAccountPatchPayload.js');
const { buildBillingAccountPatchPayload } = require('./salesforce/billingAccountPatchPayload.js');
const { buildContactPayload } = require('./salesforce/contactPayload.js');
const {
  UI_API_RECORDS,
  CONVERT_LEAD_URL,
  SOBJECTS_ACCOUNT,
  SOBJECTS_CONTACT,
} = require('./salesforce/sfRestPaths.js');

/**
 * @param {function} apiCall - (method, path, body?) => Promise<{status,data,text}>
 * @param {function} fail - (msg, res) => never
 * @param {{ logPrefix?: string }} [opts]
 * @returns {Promise<{ out: object, leadAfterPatch: object, contactTecnicoId: string, envName: string }>}
 */
async function runLeadToContactsStep7(apiCall, fail, opts = {}) {
  const p = opts.logPrefix || '[ATIVACAO]';
  console.log(`${p} 1. Criando Lead...`);
  const leadBase = buildLeadPayload();
  const company = leadBase.fields.Company;
  const e2eStamp = Date.now();
  const createPayload = /cursor/i.test(company)
    ? buildLeadPayload({ Company: `e2e${e2eStamp}`, vtal_LXD_FantasyName__c: `e2e${e2eStamp}` })
    : leadBase;
  const createRes = await apiCall('POST', UI_API_RECORDS, createPayload);
  if (createRes.status !== 200 && createRes.status !== 201) fail('Create Lead', createRes);
  const leadBody = createRes.data;
  const leadId = leadBody.id;
  if (!leadId) fail('Lead sem id', createRes);

  console.log(`${p} 2. Patch Lead Status Contacted...`);
  const patchRes = await apiCall('PATCH', `${UI_API_RECORDS}/${leadId}`, { fields: { Status: 'Contacted' } });
  if (patchRes.status !== 200) fail('Patch Lead', patchRes);
  const leadAfterPatch = patchRes.data;

  console.log(`${p} 3. Converter Lead...`);
  const envName = getEnvName();
  const leadFantasyName = getFieldValue(leadAfterPatch, 'Company') ?? `e2e${Date.now()}`;
  const convertPayload = buildConvertLeadPayload(leadAfterPatch, { environment: envName, fantasyName: leadFantasyName });
  const convertRes = await apiCall('POST', CONVERT_LEAD_URL, convertPayload);
  if (convertRes.status !== 200) fail('Convert Lead', convertRes);
  const out = convertRes.data?.vtal_LXD_outputclass;
  if (!out?.AccountOrganizationId || !out?.AccountBussinessId || !out?.AccountBillingId) {
    fail('Conversão sem AccountIds: ' + JSON.stringify(convertRes.data), convertRes);
  }

  console.log(`${p} 4. PATCH Organization (vtal_LXD_FantasyName__c + Billing)...`);
  const orgGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${out.AccountOrganizationId}`);
  if (orgGet.status !== 200) fail('GET Org', orgGet);
  const fantasyName = orgGet.data?.vtal_LXD_FantasyName__c || '';
  const orgFantasyOpts = {
    accountName: orgGet.data?.Name || '',
    companyFromLead: getFieldValue(leadAfterPatch, 'Company') || '',
    fallback: `e2e-${Date.now()}`,
  };
  await apiCall(
    'PATCH',
    `${SOBJECTS_ACCOUNT}/${out.AccountOrganizationId}`,
    buildOrganizationPatchPayload(fantasyName, orgFantasyOpts),
  );
  const resolvedLxdFantasyForBilling = resolveLxdFantasyName(fantasyName, orgFantasyOpts);

  console.log(`${p} 5. PATCH Business...`);
  const businessGet = await apiCall('GET', `${SOBJECTS_ACCOUNT}/${out.AccountBussinessId}`);
  if (businessGet.status !== 200) fail('GET Business', businessGet);
  const businessBody = businessGet.data;
  const accountName = getFieldValue(leadAfterPatch, 'Company') || businessBody?.Name || '';
  const email = getFieldValue(leadAfterPatch, 'Email') || businessBody?.vlocity_cmt__BillingEmailAddress__c || '';
  await apiCall('PATCH', `${SOBJECTS_ACCOUNT}/${out.AccountBussinessId}`, buildBusinessAccountPatchPayload({ accountName, email, environment: envName }));

  console.log(`${p} 6. PATCH Billing...`);
  const accountNumber = businessBody?.Account_Number__c || '';
  const ufOfClient = businessBody?.vtal_LXD_UF_OfClient__c || 'SP';
  await apiCall(
    'PATCH',
    `${SOBJECTS_ACCOUNT}/${out.AccountBillingId}`,
    buildBillingAccountPatchPayload({
      accountNumber,
      ufOfClient,
      environment: envName,
      fantasyName: resolvedLxdFantasyForBilling,
    }),
  );

  console.log(`${p} 7. Criando 2 Contatos...`);
  const principalRes = await apiCall('POST', SOBJECTS_CONTACT, buildContactPayload(out.AccountBussinessId, 'Principal'));
  if (principalRes.status !== 201) fail('Contact Principal', principalRes);
  const tecnicoRes = await apiCall('POST', SOBJECTS_CONTACT, buildContactPayload(out.AccountBussinessId, 'Technical'));
  if (tecnicoRes.status !== 201) fail('Contact Técnico', tecnicoRes);
  const contactTecnicoId = tecnicoRes.data?.id;
  if (!contactTecnicoId) fail('Contact Técnico sem id', tecnicoRes);

  return { out, leadAfterPatch, contactTecnicoId, envName };
}

module.exports = { runLeadToContactsStep7 };
