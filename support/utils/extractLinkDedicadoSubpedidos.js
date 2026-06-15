function normalizePointType(raw, productHint = '') {
  const s = String(raw || productHint || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!s) return '';
  if (s.includes('evc')) return 'evc';
  if (s.includes('ponta a') || s.includes('pontaa') || s === 'a' || s.endsWith(' ponta a')) return 'ponta_a';
  if (s.includes('ponta b') || s.includes('pontab') || s === 'b' || s.endsWith(' ponta b')) return 'ponta_b';
  return s;
}

/** Extrai OrderNumber dos subpedidos Link Dedicado (Ponta A / B / EVC) a partir do poll Salesforce. */
function extractLinkDedicadoSubpedidos(subOrders = []) {
  const out = {
    subOrderOrderNumberPontaA: null,
    subOrderOrderNumberPontaB: null,
    subOrderOrderNumberEVC: null,
  };

  for (const sub of subOrders) {
    const t = normalizePointType(sub.Vtal_Seg_PointType__c, sub.vtal_LXD_Produto_do_pedido__c);
    const num = sub.OrderNumber ?? null;
    if (!num) continue;
    if (t === 'ponta_a') out.subOrderOrderNumberPontaA = num;
    else if (t === 'ponta_b') out.subOrderOrderNumberPontaB = num;
    else if (t === 'evc') out.subOrderOrderNumberEVC = num;
  }

  // Fallback TRG: 3 subpedidos sem PointType reconhecido → ordem numérica A, B, EVC
  const sorted = subOrders
    .filter((s) => s?.OrderNumber)
    .slice()
    .sort((a, b) => String(a.OrderNumber).localeCompare(String(b.OrderNumber), undefined, { numeric: true }));
  if (sorted.length >= 3) {
    out.subOrderOrderNumberPontaA = out.subOrderOrderNumberPontaA || sorted[0].OrderNumber;
    out.subOrderOrderNumberPontaB = out.subOrderOrderNumberPontaB || sorted[1].OrderNumber;
    out.subOrderOrderNumberEVC = out.subOrderOrderNumberEVC || sorted[2].OrderNumber;
  } else if (sorted.length === 2) {
    out.subOrderOrderNumberPontaA = out.subOrderOrderNumberPontaA || sorted[0].OrderNumber;
    out.subOrderOrderNumberPontaB = out.subOrderOrderNumberPontaB || sorted[1].OrderNumber;
  } else if (sorted.length === 1) {
    out.subOrderOrderNumberEVC = out.subOrderOrderNumberEVC || sorted[0].OrderNumber;
  }

  if (subOrders.length && !out.subOrderOrderNumberPontaA && !out.subOrderOrderNumberPontaB && !out.subOrderOrderNumberEVC) {
    console.log(
      '[Link Dedicado] PointType não reconhecido nos subpedidos:',
      subOrders.map((s) => `${s.OrderNumber}:${s.Vtal_Seg_PointType__c || '?'}`).join(', '),
    );
  }

  return out;
}

module.exports = { extractLinkDedicadoSubpedidos };
