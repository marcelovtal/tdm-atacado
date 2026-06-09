const stepLogCapture = require('./StepLogCapture.js');

/**
 * Classe de log para exibir todos os steps nos testes.
 * Quando StepLogCapture está ativo (dentro de runWithStepLog), as linhas também vão para o relatório Allure (anexo por step).
 */
class Logger {
  constructor(suiteName = 'Test') {
    this.suiteName = suiteName;
    this.steps = [];
  }

  step(stepName, detail = '') {
    const msg = detail ? `[${this.suiteName}] ${stepName}: ${detail}` : `[${this.suiteName}] ${stepName}`;
    this.steps.push({ step: stepName, detail, time: new Date().toISOString() });
    if (stepLogCapture.isCapturing()) {
      stepLogCapture.append(msg);
    }
    // Sempre imprime no console para ver payload/response no terminal (além do Allure)
    // eslint-disable-next-line no-console
    console.log(msg);
    return msg;
  }

  getSteps() {
    return this.steps;
  }

  clear() {
    this.steps = [];
  }
}

// Singleton por suite opcional; em BDD cada step file pode criar new Logger('FeatureName')
module.exports = { Logger };
