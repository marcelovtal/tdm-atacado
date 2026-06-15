const { fetchPegaOrdemOsFromCrm } = require('./pega/fetchPegaOrdemOs.js');

async function enrichOneLeg(crm, label, fetchOptions = {}) {
  if (!crm) return null;
  const pega = await fetchPegaOrdemOsFromCrm(crm, global.fetch, fetchOptions);
  if (!pega) return null;
  if (label) {
    console.log(`[PEGA] ${label}: ${pega.pegaOrdemServicoOs || '—'}${pega.caseId ? ` | Caso: ${pega.caseId}` : ''}`);
  }
  return pega;
}

function linkDedicadoFetchOptions(ldLeg, maxTriesOverride) {
  const defaultMax =
    parseInt(String(process.env.PEGA_LINK_DEDICADO_EVC_MAX_TRIES || '24').trim(), 10) ||
    parseInt(String(process.env.PEGA_OBTER_DADOS_EMPTY_MAX_TRIES || '12').trim(), 10) ||
    24;
  return {
    linkDedicado: true,
    ldLeg,
    maxTries: maxTriesOverride ?? defaultMax,
    retryMs: parseInt(String(process.env.PEGA_OBTER_DADOS_EMPTY_RETRY_MS || '5000').trim(), 10) || 5000,
  };
}

function hasLinkDedicadoCaseIds(result = {}) {
  return !!(result.pegaCaseIdPontaA || result.pegaCaseIdPontaB || result.pegaCaseIdEVC);
}

function hasLinkDedicadoOs(result = {}) {
  return !!(result.pegaOrdemServicoOsPontaA || result.pegaOrdemServicoOsPontaB || result.pegaOrdemServicoOsEVC);
}

/** Após gerar pedido + subpedido(s) CRM, consulta PEGA (obterdadosordem) para OS-xxx (Número Pedido OSS). */
async function enrichPedidoComPegaOrdem(result = {}) {
  const hasLegSubs =
    result.subOrderOrderNumberPontaA ||
    result.subOrderOrderNumberPontaB ||
    result.subOrderOrderNumberEVC;

  if (result.pegaOrdemServicoOs && !hasLegSubs) return result;

  if (hasLegSubs) {
    const out = { ...result };

    if (hasLinkDedicadoOs(out)) {
      out.pegaOrdemServicoOs =
        out.pegaOrdemServicoOsEVC || out.pegaOrdemServicoOsPontaA || out.pegaOrdemServicoOsPontaB || out.pegaOrdemServicoOs || null;
      return out;
    }

    // Casos ATV/EVC/PNT já capturados no fluxo PEGA — evita 24×5s na EVC quando OS ainda não existe no TRG.
    const shortPoll = hasLinkDedicadoCaseIds(out);
    const maxTries = shortPoll ? 3 : linkDedicadoFetchOptions('evc').maxTries;
    if (shortPoll) {
      console.log('[PEGA] Link Dedicado — casos PEGA já conhecidos; consulta OSS rápida (3 tentativas por perna).');
    } else {
      console.log('[PEGA] Link Dedicado — consultando ordem OSS nas pernas A, B e EVC...');
    }

    const legs = [
      { crm: out.subOrderOrderNumberPontaA, ldLeg: 'pontaA', osKey: 'pegaOrdemServicoOsPontaA', caseKey: 'pegaCaseIdPontaA', label: 'Ponta A' },
      { crm: out.subOrderOrderNumberPontaB, ldLeg: 'pontaB', osKey: 'pegaOrdemServicoOsPontaB', caseKey: 'pegaCaseIdPontaB', label: 'Ponta B' },
      { crm: out.subOrderOrderNumberEVC, ldLeg: 'evc', osKey: 'pegaOrdemServicoOsEVC', caseKey: 'pegaCaseIdEVC', label: 'EVC' },
    ];

    for (const leg of legs) {
      if (!leg.crm || out[leg.osKey]) continue;
      const pega = await enrichOneLeg(leg.crm, leg.label, linkDedicadoFetchOptions(leg.ldLeg, maxTries));
      if (pega?.pegaOrdemServicoOs) out[leg.osKey] = pega.pegaOrdemServicoOs;
      if (pega?.caseId && !out[leg.caseKey]) out[leg.caseKey] = pega.caseId;
    }

    out.pegaOrdemServicoOs =
      out.pegaOrdemServicoOsEVC || out.pegaOrdemServicoOsPontaA || out.pegaOrdemServicoOsPontaB || out.pegaOrdemServicoOs || null;
    if (!out.pegaCaseId) {
      out.pegaCaseId = out.pegaCaseIdPontaA || out.pegaCaseIdEVC || out.pegaCaseIdPontaB || null;
    }
    return out;
  }

  if (!result.subOrderOrderNumber) return result;
  const pega = await enrichOneLeg(result.subOrderOrderNumber);
  if (!pega) return result;
  return {
    ...result,
    pegaOrdemServicoOs: pega.pegaOrdemServicoOs ?? null,
    pegaCaseId: pega.caseId ?? result.pegaCaseId ?? null,
  };
}

module.exports = { enrichPedidoComPegaOrdem };

