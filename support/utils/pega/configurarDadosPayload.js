/**
 * Corpo para PATCH .../actions/ConfigurarDados (encaminhar para ativação física).
 * Texto do Encaminhar conforme fluxo-pega / Postman.
 */
function buildConfigurarDadosBody(overrides = {}) {
  return {
    content: {
      DadoLogico: {
        Encaminhar: overrides.encaminhar || 'Sucesso ( Encaminhar para Ativ Física)',
      },
    },
  };
}

module.exports = { buildConfigurarDadosBody };
