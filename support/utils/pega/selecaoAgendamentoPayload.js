/**
 * Corpos para AGENDAMENTO_FLOW (fluxo-pega.txt ~7427, ~12897, ~13877).
 */

/** Próximo dia útil (seg–sex) em horário local + janela de 7 dias. Evita slot em fim de semana (OFS/Sala Eficiência). */
function defaultPeriodoDatas() {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  // avança pelo menos 1 dia e até cair em dia útil
  for (let i = 0; i < 10; i++) {
    start.setDate(start.getDate() + 1);
    const dow = start.getDay(); // 0=dom, 6=sáb
    if (dow !== 0 && dow !== 6) break;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  end.setHours(21, 0, 0, 0);
  return { DataInicio: start.toISOString(), DataFim: end.toISOString() };
}

/** PATCH .../SelecaoDePeriodo?viewType=form */
function buildSelecaoDePeriodoBody(overrides = {}) {
  const p = overrides.periodo || {};
  const d = defaultPeriodoDatas();
  return {
    content: {
      Agendamento: {
        DataInicio: p.dataInicio != null ? p.dataInicio : d.DataInicio,
        DataFim: p.dataFim != null ? p.dataFim : d.DataFim,
      },
    },
    pageInstructions: [],
  };
}

function buildAgendamentoBaseContent(overrides = {}) {
  const a = overrides.agendamento || {};
  return {
    Conclusao: a.conclusao != null ? a.conclusao : 'Confirmar Agendamento',
    VisitaDentroDoPeriodo: a.visitaDentroDoPeriodo != null ? a.visitaDentroDoPeriodo : false,
    VisitaConjunta: a.visitaConjunta != null ? a.visitaConjunta : false,
    Informacoes: a.informacoes != null ? a.informacoes : '',
  };
}

/**
 * PATCH .../SelecaoDoSlot/refresh — pageInstructions com EmbedListUUID__ por linha (fluxo-pega ~12918).
 */
function buildSelecaoDoSlotRefreshBody(slots, overrides = {}) {
  const list = Array.isArray(slots) ? slots : [];
  const pageInstructions = list.map((slot, idx) => ({
    content: { EmbedListUUID__: slot.EmbedListUUID__ },
    target: '.Agendamento.Slots',
    listIndex: idx + 1,
    instruction: 'UPDATE',
  }));
  return {
    content: {
      Agendamento: buildAgendamentoBaseContent(overrides),
    },
    pageInstructions,
  };
}

/**
 * PATCH .../SelecaoDoSlot?viewType=form — confirma slot (fluxo-pega ~13908).
 * @param {number} slotsCount quantidade de linhas na lista (ex.: 8)
 * @param {number} selectedListIndex índice 1-based do slot (fluxo usa 1)
 */
function buildSelecaoDoSlotConfirmBody(slotsCount, selectedListIndex, overrides = {}) {
  const n = Math.max(0, Number(slotsCount) || 0);
  const sel = Math.max(1, Number(selectedListIndex) || 1);
  const pageInstructions = [];
  for (let i = 1; i <= n; i++) {
    pageInstructions.push({
      content: {},
      target: '.Agendamento.Slots',
      listIndex: i,
      instruction: 'UPDATE',
    });
  }
  pageInstructions.push({
    content: { Selecao: true },
    target: '.Agendamento.Slots',
    listIndex: sel,
    instruction: 'UPDATE',
  });
  return {
    content: {
      Agendamento: buildAgendamentoBaseContent(overrides),
    },
    pageInstructions,
  };
}

/** Slots em respostas GET/PATCH (Constellation API). */
function extractAgendamentoSlotsFromApiJson(json) {
  const d = json?.data;
  const content = d?.caseInfo?.content ?? d?.data?.caseInfo?.content;
  const slots = content?.Agendamento?.Slots;
  return Array.isArray(slots) ? slots : null;
}

/** Slots no item retornado por obterdadosordem (array de casos). */
function extractAgendamentoSlotsFromObterDadosItem(item) {
  const slots = item?.Agendamento?.Slots;
  return Array.isArray(slots) ? slots : null;
}

module.exports = {
  defaultPeriodoDatas,
  buildSelecaoDePeriodoBody,
  buildSelecaoDoSlotRefreshBody,
  buildSelecaoDoSlotConfirmBody,
  extractAgendamentoSlotsFromApiJson,
  extractAgendamentoSlotsFromObterDadosItem,
};
