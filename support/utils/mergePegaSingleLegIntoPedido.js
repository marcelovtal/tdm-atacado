/** Mescla retorno de runPegaDesignacaoEConfiguracao (IP Connect / VPN) no result do pedido. */
function mergePegaSingleLegIntoPedido(result = {}, pegaResult) {
  if (!pegaResult) return result;
  return {
    ...result,
    pegaCaseId: pegaResult.caseId ?? result.pegaCaseId ?? null,
    pegaOrdemServicoOs: pegaResult.pegaOrdemServicoOs ?? result.pegaOrdemServicoOs ?? null,
  };
}

module.exports = { mergePegaSingleLegIntoPedido };
