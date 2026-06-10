const { fetchPegaOrdemOsFromCrm } = require('./pega/fetchPegaOrdemOs.js');

async function enrichOneLeg(crm, label) {
  if (!crm) return null;
  const pega = await fetchPegaOrdemOsFromCrm(crm);
  if (!pega) return null;
  if (label) {
    console.log(`[PEGA] ${label}: ${pega.pegaOrdemServicoOs || '—'}${pega.caseId ? ` | Caso: ${pega.caseId}` : ''}`);
  }
  return pega;
}

/** Após gerar pedido + subpedido(s) CRM, consulta PEGA (obterdadosordem) para OS-xxx (Número Pedido OSS). */
async function enrichPedidoComPegaOrdem(result = {}) {
  if (result.pegaOrdemServicoOs) return result;

  const out = { ...result };

  if (result.subOrderOrderNumberPontaA || result.subOrderOrderNumberPontaB || result.subOrderOrderNumberEVC) {
    const legs = [
      ['subOrderOrderNumberPontaA', 'pegaOrdemServicoOsPontaA', 'Ponta A'],
      ['subOrderOrderNumberPontaB', 'pegaOrdemServicoOsPontaB', 'Ponta B'],
      ['subOrderOrderNumberEVC', 'pegaOrdemServicoOsEVC', 'EVC'],
    ];
    for (const [subKey, osKey, label] of legs) {
      const pega = await enrichOneLeg(result[subKey], label);
      if (pega?.pegaOrdemServicoOs) out[osKey] = pega.pegaOrdemServicoOs;
      if (pega?.caseId && !out.pegaCaseId) out.pegaCaseId = pega.caseId;
    }
    out.pegaOrdemServicoOs =
      out.pegaOrdemServicoOsPontaA || out.pegaOrdemServicoOsPontaB || out.pegaOrdemServicoOsEVC || null;
    return out;
  }

  if (!result.subOrderOrderNumber) return result;
  const pega = await enrichOneLeg(result.subOrderOrderNumber);
  if (!pega) return result;
  return {
    ...out,
    pegaOrdemServicoOs: pega.pegaOrdemServicoOs ?? null,
    pegaCaseId: pega.caseId ?? out.pegaCaseId ?? null,
  };
}

module.exports = { enrichPedidoComPegaOrdem };
