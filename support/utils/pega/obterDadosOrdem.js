/**
 * Resposta do GET /prweb/api/APIOrdemDeServico/v1/obterdadosordem — array de casos.
 * IP Connect / VPN: item cuja ChaveCaseOrdem contém "A-".
 * Link Dedicado: várias linhas (ATV, PNT, EVC); escolher com matchOrdemServico + ldLeg (ver pickLinkDedicadoItem).
 */

function pickActivationCase(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.find((i) => i.ChaveCaseOrdem && String(i.ChaveCaseOrdem).includes('A-')) || rows[0];
}

/** Resposta Link Dedicado: há vários itens com ProdutoView / ServicoView Link Dedicado */
function isLinkDedicadoObterDadosArray(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some(
    (i) =>
      i &&
      (String(i.ProdutoView || '').includes('Link Dedicado') ||
        String(i.ServicoView || '').includes('Link Dedicado')),
  );
}

function pickLinkDedicadoActivationCase(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const atvs = rows.filter(rowIsAtvCase);
  const ready = atvs.find((i) => i.pyMemo);
  if (ready) return ready;
  if (atvs.length === 1) return atvs[0];
  return (
    atvs.find((i) => i.pzInsKey && String(i.pzInsKey).includes('ATV-')) ||
    atvs.find((i) => i.pyID && String(i.pyID).includes('ATV-')) ||
    null
  );
}

function findAtvFromPntCoveredKeys(rows, pntRow) {
  const keys = pntRow?.pxCoveredInsKeys;
  if (!Array.isArray(keys) || !keys.length) return null;
  const atvKey = keys.find((k) => String(k).includes('ATV-'));
  if (!atvKey) return null;
  const keyTrim = String(atvKey).trim();
  return (
    rows.find((i) => rowIsAtvCase(i) && String(i.pzInsKey ?? '').trim() === keyTrim) ||
    rows.find((i) => rowIsAtvCase(i) && String(i.pzInsKey ?? '').includes(String(atvKey).match(/ATV-\d+/)?.[0] || '')) ||
    null
  );
}

function rowIsAtvCase(i) {
  if (!i) return false;
  return (
    (i.pzInsKey && String(i.pzInsKey).includes('ATV-')) || (i.pyID && String(i.pyID).includes('ATV-'))
  );
}

/**
 * Escolhe a linha certa quando obterdadosordem devolve vários casos (ATV + PNT + …) para Link Dedicado.
 * @param {'pontaA'|'pontaB'|'evc'|''} [leg] — desambigua quando ExtracaoBIX.OrdemServicoCRM se repete entre linhas
 */
function pickLinkDedicadoItem(rows, matchOrdemServico, leg = '') {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const t = matchOrdemServico != null ? String(matchOrdemServico).trim() : '';
  const L = String(leg || '').trim().toLowerCase();

  /**
   * EVC: linha com PontaView EVC (não usar byOrd — outras linhas repetem OrdemServicoCRM / OS).
   */
  if (t && L === 'evc') {
    const evcRow = rows.find((i) => String(i.PontaView ?? '').trim() === 'EVC');
    if (evcRow) return evcRow;
    const byEx = rows.find(
      (i) =>
        String(i.PontaView ?? '').trim() === 'EVC' &&
        String(i?.ExtracaoBIX?.OrdemServicoCRM ?? '').trim() === t,
    );
    if (byEx) return byEx;
    return null;
  }
  /**
   * Ponta B + ORDEMSERVICO do subpedido B: no trace (fluxo link dedicado) CONFIGURACAODEREDE e
   * AGENDAMENTO_FLOW aparecem no ATV cuja OS / EVC.OrdemPontaB bate com t. Fallback: PNT Ponta B.
   */
  if (t && L === 'pontab') {
    const atvOrdMatch = (i) =>
      rowIsAtvCase(i) &&
      (String(i?.EVC?.OrdemPontaB ?? '').trim() === t ||
        String(i?.OrdemServico?.Ordem?.OrdemServico ?? '').trim() === t);
    const atvReady = rows.find((i) => atvOrdMatch(i) && i.pyMemo);
    if (atvReady) return atvReady;
    const atvPending = rows.find(atvOrdMatch);
    if (atvPending) return atvPending;

    const pntForB = rows.find(
      (i) =>
        !rowIsAtvCase(i) &&
        (String(i?.EVC?.OrdemPontaB ?? '').trim() === t ||
          String(i?.PontaView ?? '').trim() === 'Ponta B'),
    );
    if (pntForB) {
      const atvFromCover = findAtvFromPntCoveredKeys(rows, pntForB);
      if (atvFromCover) return atvFromCover;
    }

    const atvs = rows.filter(rowIsAtvCase);
    if (atvs.length === 1) return atvs[0];

    const notAtv = (i) => !rowIsAtvCase(i);
    const byOs = rows.find(
      (i) =>
        notAtv(i) &&
        String(i.PontaView ?? '').trim() === 'Ponta B' &&
        String(i?.OrdemServico?.Ordem?.OrdemServico ?? '').trim() === t,
    );
    if (byOs) return byOs;
    const byEvcB = rows.find(
      (i) =>
        notAtv(i) &&
        String(i.PontaView ?? '').trim() === 'Ponta B' &&
        String(i?.EVC?.OrdemPontaB ?? '').trim() === t,
    );
    if (byEvcB) return byEvcB;
    const pb = rows.find((i) => notAtv(i) && String(i.PontaView ?? '').trim() === 'Ponta B');
    if (pb) return pb;
    return null;
  }
  /**
   * Ponta A + ORDEMSERVICO da ponta A: só o caso ATV tem ASSIGN…!DESIGNACAOECONFIGURACAO_FLOW.
   * Postman: find(ATV) primeiro. Se cair em byOrd, volta PNT com mesma OS → 404 Assignment not found.
   */
  if (t && L === 'pontaa') {
    const ordMatchesAtv = (i) =>
      rowIsAtvCase(i) &&
      (String(i?.OrdemServico?.Ordem?.OrdemServico ?? '').trim() === t ||
        String(i?.EVC?.OrdemPontaA ?? '').trim() === t ||
        String(i?.ContratoCrmView ?? '').trim() === t);
    const atvForOrd = rows.find(ordMatchesAtv);
    if (atvForOrd) return atvForOrd;

    const atvPontaA = rows.find(
      (i) =>
        rowIsAtvCase(i) &&
        String(i.PontaView ?? '').trim() === 'Ponta A' &&
        String(i?.OrdemServico?.Ordem?.OrdemServico ?? '').trim() === t,
    );
    if (atvPontaA) return atvPontaA;

    const atvs = rows.filter(rowIsAtvCase);
    if (atvs.length === 1) return atvs[0];
    if (atvs.length > 1) {
      const hit = atvs.find(
        (i) =>
          String(i?.OrdemServico?.Ordem?.OrdemServico ?? '').trim() === t ||
          String(i?.EVC?.OrdemPontaA ?? '').trim() === t,
      );
      if (hit) return hit;
    }

    return null;
  }

  if (t) {
    const byOrd = rows.find((i) => String(i?.OrdemServico?.Ordem?.OrdemServico ?? '').trim() === t);
    if (byOrd) return byOrd;
    const evcOnly = rows.filter((i) => String(i.PontaView ?? '').trim() === 'EVC');
    if (evcOnly.length === 1) return evcOnly[0];
    const byEx = rows.find((i) => String(i?.ExtracaoBIX?.OrdemServicoCRM ?? '').trim() === t);
    if (byEx) return byEx;
  }

  return pickLinkDedicadoActivationCase(rows) || rows.find((i) => i.pyMemo) || rows[0];
}

function extractCaseIdFromChave(chaveCaseOrdem) {
  const m = String(chaveCaseOrdem || '').match(/A-\d+/);
  return m ? m[0] : null;
}

/** CaseID exibível: ATV- / PNT- / EVC- a partir de pyID ou pzInsKey (Link Dedicado). */
function extractLdCaseId(item) {
  if (!item || typeof item !== 'object') return null;
  const py = item.pyID && String(item.pyID).match(/(ATV|PNT|EVC)-\d+/);
  if (py) return py[0];
  const pk = item.pzInsKey && String(item.pzInsKey).match(/(ATV|PNT|EVC)-\d+/);
  return pk ? pk[0] : null;
}

/**
 * @param {unknown} json
 * @param {{
 *   linkDedicado?: boolean,
 *   matchOrdemServico?: string,
 *   ldLeg?: string
 * }} [opts] — Link Dedicado: matchOrdemServico + ldLeg ('pontaA'|'pontaB'|'evc') alinham à linha correta do array
 */
function parseObterDadosOrdemResponse(json, opts = {}) {
  const forceLd = opts.linkDedicado === true;
  const isLd = forceLd || isLinkDedicadoObterDadosArray(json);
  const matchOs = opts.matchOrdemServico != null ? String(opts.matchOrdemServico).trim() : '';
  const ldLeg = opts.ldLeg != null ? String(opts.ldLeg).trim() : '';

  let item;
  if (isLd) {
    item = pickLinkDedicadoItem(json, matchOs, ldLeg);
  } else {
    item = pickActivationCase(json);
  }
  if (!item) return null;
  const pyMemo = item.pyMemo;
  const chaveCaseOrdem =
    isLd && item.pzInsKey ? String(item.pzInsKey).trim() : item.ChaveCaseOrdem;
  const caseId = isLd ? extractLdCaseId(item) : extractCaseIdFromChave(chaveCaseOrdem);
  return { item, pyMemo, chaveCaseOrdem, caseId, linkDedicado: isLd };
}

/** Ex.: CaseOrdemServico "OS-128329" ou pxCoverInsKey "VTAL-FULFILLM-WORK OS-128335". */
function extractOrdemServicoOsFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const raw = item.CaseOrdemServico;
  if (raw != null && String(raw).trim()) {
    const m = String(raw).trim().match(/^OS-(\d+)$/i);
    if (m) return `OS-${m[1]}`;
  }
  const cov = item.pxCoverInsKey;
  if (cov && typeof cov === 'string') {
    const m2 = cov.match(/(OS-\d+)/i);
    if (m2) return m2[1].toUpperCase();
  }
  const nested = item?.OrdemServico?.Ordem?.OrdemServico;
  if (nested != null && String(nested).trim()) {
    const m3 = String(nested).trim().match(/^OS-(\d+)$/i);
    if (m3) return `OS-${m3[1]}`;
  }
  return null;
}

/** Varre linhas do obterdadosordem LD (prioriza EVC quando indicado). */
function extractOrdemServicoOsFromLinkDedicadoRows(rows, preferredLeg = 'evc') {
  if (!Array.isArray(rows) || !rows.length) return null;
  const list =
    preferredLeg === 'evc'
      ? [
          ...rows.filter((r) => String(r?.PontaView || '').trim().toUpperCase() === 'EVC'),
          ...rows.filter((r) => String(r?.PontaView || '').trim().toUpperCase() !== 'EVC'),
        ]
      : rows;
  for (const row of list) {
    const os = extractOrdemServicoOsFromItem(row);
    if (os) return os;
  }
  return null;
}

module.exports = {
  pickActivationCase,
  pickLinkDedicadoActivationCase,
  pickLinkDedicadoItem,
  isLinkDedicadoObterDadosArray,
  extractCaseIdFromChave,
  extractLdCaseId,
  parseObterDadosOrdemResponse,
  extractOrdemServicoOsFromItem,
  extractOrdemServicoOsFromLinkDedicadoRows,
};
