/**
 * PATCH .../ValidarExecucaoTecnica/refresh (fluxo-pega.txt ~1506).
 */
function buildValidarExecucaoTecnicaRefreshBody(overrides = {}) {
  const vt = overrides.validacaoTecnica || {};
  /** IP Connect envia `OrdemServico.Ordem.EscolasConectadas`; VPN e Link Dedicado não (LD → 400 se incluir). */
  const includeOrdemEscolas =
    overrides.includeOrdemEscolas !== undefined ? overrides.includeOrdemEscolas : true;

  const content = {
    ValidacaoTecnica: {
      Encaminhar: vt.encaminhar != null ? vt.encaminhar : 'Sucesso',
      FaltaMaterial: vt.faltaMaterial != null ? vt.faltaMaterial : false,
      DocumentacaoTecnico: vt.documentacaoTecnico != null ? vt.documentacaoTecnico : false,
      DocumentacaoPedidoCliente: vt.documentacaoPedidoCliente != null ? vt.documentacaoPedidoCliente : false,
    },
  };

  if (includeOrdemEscolas) {
    content.OrdemServico = {
      Ordem: {
        EscolasConectadas: overrides.escolasConectadas != null ? overrides.escolasConectadas : false,
      },
    };
  }

  return {
    content,
    pageInstructions: [],
  };
}

module.exports = { buildValidarExecucaoTecnicaRefreshBody };
