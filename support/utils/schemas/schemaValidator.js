const { Logger } = require('../report/Logger.js');

const log = new Logger('Schema');

/**
 * Valida dados contra um schema Zod.
 * @param {import('zod').ZodSchema} schema - Schema Zod
 * @param {unknown} data - Dados a validar
 * @returns {unknown} Dados parseados e validados
 * @throws {Error} Se o schema for inválido
 */
function validateSchema(schema, data) {
  const result = schema.safeParse(data);

  if (!result.success) {
    const detail = JSON.stringify(result.error.format(), null, 2);
    log.step('Validação falhou', detail);
    throw new Error('Schema inválido');
  }

  return result.data;
}

module.exports = { validateSchema };
