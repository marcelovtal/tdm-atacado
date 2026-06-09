/**
 * Executa o corpo do step BDD dentro de um step Allure e anexa os logs produzidos
 * durante o step ao relatório (Log aparece step by step, não só no fim do teste).
 */

const { step, attachment } = require('allure-js-commons');
const { ContentType } = require('allure-js-commons');
const stepLogCapture = require('./StepLogCapture.js');

/**
 * @param {string} stepName - Nome do step (ex.: "Quando eu faço uma requisição POST para autenticar")
 * @param {() => Promise<any>} body - Função async do step
 * @returns {Promise<any>} Retorno de body()
 */
async function runWithStepLog(stepName, body) {
  return step(stepName, async () => {
    stepLogCapture.startStep();
    try {
      return await body();
    } finally {
      const logs = stepLogCapture.getLogsAndClear();
      if (logs && logs.trim()) {
        const buffer = Buffer.from(logs, 'utf-8');
        await attachment('Log', buffer, ContentType.TEXT);
      }
    }
  });
}

module.exports = { runWithStepLog };
