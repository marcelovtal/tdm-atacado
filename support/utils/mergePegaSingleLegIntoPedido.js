/** Mescla retorno de runPegaDesignacaoEConfiguracao (IP Connect / VPN) no result do pedido. */
function mergePegaSingleLegIntoPedido(result = {}, pegaResult) {
  if (!pegaResult) return result;
  const pegaStatusWork =
    pegaResult.pyStatusWorkAfterAgendamento ||
    pegaResult.pyStatusWorkAfterValidacao ||
    pegaResult.pyStatusWork ||
    null;
  return {
    ...result,
    pegaCaseId: pegaResult.caseId ?? result.pegaCaseId ?? null,
    pegaOrdemServicoOs: pegaResult.pegaOrdemServicoOs ?? result.pegaOrdemServicoOs ?? null,
    pegaStatusWork: pegaStatusWork ?? result.pegaStatusWork ?? null,
  };
}

module.exports = { mergePegaSingleLegIntoPedido };
