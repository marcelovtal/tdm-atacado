/**
 * Helper de espera para testes.
 * - delay(ms): espera fixa (ms em milissegundos). delay(0) ou delay() = sem espera (resolve na próxima tick).
 * - immediate(): sem espera; retorna Promise já resolvida (útil para API consistente).
 * - waitFor(condition, options): espera até condition() retornar true (polling), com timeout.
 *
 * Exemplos:
 *   await waitHelper.delay(1000);       // espera 1s
 *   await waitHelper.delay(0);          // sem espera
 *   await waitHelper.immediate();       // sem espera
 *   await waitHelper.waitFor(() => el.isVisible(), { timeoutMs: 5000, intervalMs: 200 });
 */
function delay(ms = 0) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function immediate() {
  return Promise.resolve();
}

/**
 * Espera até condition() retornar valor truthy ou lançar.
 * @param {() => boolean | Promise<boolean>} condition
 * @param {{ timeoutMs?: number, intervalMs?: number }} options
 */
async function waitFor(condition, options = {}) {
  const { timeoutMs = 5000, intervalMs = 200 } = options;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const result = await Promise.resolve(condition());
      if (result) return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
    }
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: timeout após ${timeoutMs}ms`);
    }
    await delay(intervalMs);
  }
}

module.exports = { delay, immediate, waitFor };

