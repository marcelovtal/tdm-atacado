/** Extrai OrderNumber dos subpedidos Link Dedicado (Ponta A / B / EVC) a partir do poll Salesforce. */
function extractLinkDedicadoSubpedidos(subOrders = []) {
  const pontaA = subOrders.find((r) => (r.Vtal_Seg_PointType__c || '').trim() === 'Ponta A');
  const pontaB = subOrders.find((r) => (r.Vtal_Seg_PointType__c || '').trim() === 'Ponta B');
  const evc = subOrders.find((r) => (r.Vtal_Seg_PointType__c || '').trim() === 'EVC');
  return {
    subOrderOrderNumberPontaA: pontaA?.OrderNumber ?? null,
    subOrderOrderNumberPontaB: pontaB?.OrderNumber ?? null,
    subOrderOrderNumberEVC: evc?.OrderNumber ?? null,
  };
}

module.exports = { extractLinkDedicadoSubpedidos };
