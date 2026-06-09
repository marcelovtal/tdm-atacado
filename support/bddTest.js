/**
 * Test BDD usando playwright-bdd com wrappers automáticos:
 * - Page: log + screenshot após cada ação (PageWithReport)
 * - Request: log (RequestWithLog) + retry automático em falha de rede ou HTTP 5xx (requestRetry)
 * - Steps: cada Given/When/Then roda dentro de um step Allure e os logs ficam anexados ao step (runWithStepLog)
 *
 * PARÂMETROS DE CONTEXTO (parametrizado aqui na base):
 * - token: true = contexto com autenticação Salesforce; false = não chama a API de token.
 *   Padrão: true para features/api/ e features/schema/, false para features/web/.
 *   Override: test.use({ token: true }) ou test.use({ token: false }); ou env TOKEN=true; ou projects no config.
 *
 * Onde o teste recebe o parâmetro:
 * - O spec gerado (ex.: google.feature.spec.js) fica: test('...', async ({ Given, When, Then, page, request, googlePage, salesforceToken, token }) => { ... }).
 * - Nos steps você pode receber token: Given('...', async ({ token }) => { ... }) quando precisar do valor no step.
 */
const { test: bddBaseTest, createBdd } = require('playwright-bdd');
const { wrapPageWithReport } = require('./utils/report/PageWithReport.js');
const { wrapRequestWithLog } = require('./utils/report/RequestWithLog.js');
const { wrapRequestWithRetry } = require('./utils/helpers/requestRetry.js');
const { runWithStepLog } = require('./utils/report/runWithStepLog.js');
const { GooglePage } = require('../pages/GooglePage.js');
const { loadEnv, getTokenUrl, getUserFixture } = require('../config/env.js');
const { setToken, setLastTokenResponse, getToken, getInstanceUrl } = require('./context/salesforceContext.js');

const KEYWORDS = { Given: 'Dado', When: 'Quando', Then: 'Então', And: 'E', But: 'Mas' };

// bddgen exige lista explícita de fixtures (sem rest). Incluindo token para o teste receber o parâmetro de contexto.
function wrapStepWithLog(stepFn, keyword) {
  return (stepText, handler) => {
    const stepName = `${KEYWORDS[keyword] || keyword} ${stepText}`;
    return stepFn(stepText, async ({ page, request, googlePage, salesforceToken, token }, ...args) => {
      return runWithStepLog(stepName, () => handler({ page, request, googlePage, salesforceToken, token }, ...args));
    });
  };
}

const test = bddBaseTest.extend({
  /**
   * Parâmetro de contexto: token=true usa o contexto com autenticação Salesforce; token=false não chama a API.
   * Pode ser definido na base (padrão por path) ou sobrescrito com test.use({ token: true/false }).
   */
  token: [async ({}, use, testInfo) => {
    const path = (testInfo.file || '').replace(/\\/g, '/');
    const needToken = /\/api\//.test(path) || /\/schema\//.test(path);
    await use(needToken);
  }, { scope: 'test' }],

  /** Page com log automático e screenshot após cada ação. */
  page: [async ({ page }, use, testInfo) => {
    const wrapped = wrapPageWithReport(page, testInfo);
    await use(wrapped);
  }, { scope: 'test' }],

  /** Request com log (endpoint, payload, response, curl) e retry em 5xx/rede. */
  request: [async ({ request }, use) => {
    const withLog = wrapRequestWithLog(request);
    const withRetry = wrapRequestWithRetry(withLog);
    await use(withRetry);
  }, { scope: 'test' }],

  /** Page object do Google (usa a page já wrapped). */
  googlePage: [async ({ page }, use) => {
    await use(new GooglePage(page));
  }, { scope: 'test' }],

  /** Objeto { accessToken, instanceUrl } quando token=true; vazio quando token=false. */
  salesforceToken: [async ({ request, token }, use) => {
    if (!token) {
      await use({});
      return;
    }
    const env = loadEnv();
    const url = getTokenUrl(env);
    if (!url) throw new Error('URL do token não configurada em env (api.tokenUrl ou urls.salesforce).');
    const user = getUserFixture();
    const sf = user.salesforce || {};
    const formData = new URLSearchParams();
    formData.append('grant_type', sf.grant_type || 'client_credentials');
    formData.append('client_id', sf.client_id || '');
    formData.append('client_secret', sf.client_secret || '');
    const response = await request.post(url, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sf.cookie || '',
      },
      data: formData.toString(),
    });
    const body = await response.json();
    setLastTokenResponse(body);
    if (body.access_token && body.instance_url) {
      setToken(body.access_token, body.instance_url);
    }
    await use({ accessToken: getToken(), instanceUrl: getInstanceUrl() });
  }, { scope: 'test' }],
});

const bdd = createBdd(test);
const Given = wrapStepWithLog(bdd.Given, 'Given');
const When = wrapStepWithLog(bdd.When, 'When');
const Then = wrapStepWithLog(bdd.Then, 'Then');
const And = wrapStepWithLog(bdd.And, 'And');
const But = wrapStepWithLog(bdd.But, 'But');

module.exports = { test, Given, When, Then, And, But };
