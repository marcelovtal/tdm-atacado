/**
 * PATCH .../CONFIGURACAOEVC_FLOW/actions/ConfigurarEvc (Link Dedicado — fluxo completo de link dedicado.txt).
 * Corpo padrão alinhado ao Postman; ajuste fino via env ou overrides.
 */

function defaultPageInstructions() {
  const detalhes = (process.env.PEGA_EVC_DETALHES || 'TESTE').trim();
  return [
    { target: '.DadoLogico.Acesso', content: {}, listIndex: 1, instruction: 'INSERT' },
    {
      content: { Rede: 'Acesso', Tipo: 'Determinística', IdPonta: 'AB', Detalhes: detalhes },
      target: '.DadoLogico.Acesso(1).Facilidade',
      listIndex: 1,
      instruction: 'UPDATE',
    },
    {
      content: {
        Id: (process.env.PEGA_EVC_PONTA_ID || 'B').trim(),
        Uf: (process.env.PEGA_EVC_UF || 'PR').trim(),
        Localidade: (process.env.PEGA_EVC_LOCALIDADE || 'CTA').trim(),
        Estacao: (process.env.PEGA_EVC_ESTACAO || 'WMTB').trim(),
      },
      target: '.DadoLogico.Acesso(1).Facilidade(1).Ponta',
      listIndex: 1,
      instruction: 'UPDATE',
    },
  ];
}

function buildConfigurarEvcBody(overrides = {}) {
  const raw = (process.env.PEGA_EVC_PAGE_INSTRUCTIONS_JSON || '').trim();
  let pageInstructions = overrides.pageInstructions;
  if (!pageInstructions && raw) {
    try {
      pageInstructions = JSON.parse(raw);
    } catch (_) {
      pageInstructions = null;
    }
  }
  if (!pageInstructions) {
    pageInstructions = defaultPageInstructions();
  }

  const d = overrides.dadoLogico || {};
  return {
    content: {
      DadoLogico: {
        Encaminhar: d.encaminhar != null ? d.encaminhar : 'Configurado com Sucesso',
        InformacoesComplementares:
          d.informacoesComplementares != null ? d.informacoesComplementares : '',
        JumperSelecionado: d.jumperSelecionado === true,
      },
    },
    pageInstructions,
  };
}

module.exports = { buildConfigurarEvcBody, defaultPageInstructions };
