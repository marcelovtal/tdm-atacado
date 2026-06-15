/** Extrai campo do retorno de runPegaLinkDedicadoDuasPontas (perna + validação + agendamento). */

function pickField(field, ...nodes) {

  for (const n of nodes) {

    if (!n || typeof n !== 'object') continue;

    const val = n[field];

    if (val != null && String(val).trim()) return val;

  }

  return null;

}



function mergePegaLinkDedicadoIntoPedido(result = {}, pegaResult) {

  if (!pegaResult) return result;



  const pontaAOs = pickField(

    'pegaOrdemServicoOs',

    pegaResult.pontaA?.agendamento,

    pegaResult.pontaA?.validacao,

    pegaResult.pontaA,

  );

  const pontaBOs = pickField(

    'pegaOrdemServicoOs',

    pegaResult.pontaB?.agendamento,

    pegaResult.pontaB?.validacao,

    pegaResult.pontaB,

  );

  const evcOs = pickField('pegaOrdemServicoOs', pegaResult.evc);



  const pontaACase = pickField(

    'caseId',

    pegaResult.pontaA?.agendamento,

    pegaResult.pontaA?.validacao,

    pegaResult.pontaA,

  );

  const pontaBCase = pickField(

    'caseId',

    pegaResult.pontaB?.agendamento,

    pegaResult.pontaB?.validacao,

    pegaResult.pontaB,

  );

  const evcCase = pickField('caseId', pegaResult.evc);



  const primaryOs = evcOs || pontaAOs || pontaBOs || result.pegaOrdemServicoOs || null;



  return {

    ...result,

    pegaCaseId: pontaACase ?? evcCase ?? result.pegaCaseId ?? null,

    pegaCaseIdPontaA: pontaACase,

    pegaCaseIdPontaB: pontaBCase,

    pegaCaseIdEVC: evcCase,

    pegaOrdemServicoOsPontaA: pontaAOs,

    pegaOrdemServicoOsPontaB: pontaBOs,

    pegaOrdemServicoOsEVC: evcOs,

    pegaOrdemServicoOs: primaryOs,

  };

}



module.exports = { mergePegaLinkDedicadoIntoPedido };


