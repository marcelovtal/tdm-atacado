/**
 * Após CreateOrderOnQuote no TRG/massa pronta, o master Order costuma vir incompleto:
 * QuoteId (campo padrão) null, DefaultBilling/Service null, Vtal_Contact__c null.
 * Sem isso checkoutOrderOMBatch não gera subpedidos A/B/EVC.
 */
async function patchLinkDedicadoMasterOrder(apiCall, orderRecord = {}, context = {}, options = {}) {
  const sobjectsOrder = options.sobjectsOrderPath || '/services/data/v62.0/sobjects/Order';
  const orderId = orderRecord.Id || orderRecord.id || context.orderId;
  if (!orderId || !apiCall) return orderRecord;

  const {
    quoteId,
    opportunityId,
    accountBillingId,
    accountBussinessId,
    contactTecnicoId,
  } = context;

  const corePatch = {};
  if (quoteId && !orderRecord.QuoteId) corePatch.QuoteId = quoteId;
  if (quoteId && !orderRecord.vlocity_cmt__QuoteId__c) corePatch.vlocity_cmt__QuoteId__c = quoteId;
  if (opportunityId && !orderRecord.OpportunityId) corePatch.OpportunityId = opportunityId;
  if (accountBillingId && !orderRecord.vlocity_cmt__DefaultBillingAccountId__c) {
    corePatch.vlocity_cmt__DefaultBillingAccountId__c = accountBillingId;
  }
  if (accountBussinessId && !orderRecord.vlocity_cmt__DefaultServiceAccountId__c) {
    corePatch.vlocity_cmt__DefaultServiceAccountId__c = accountBussinessId;
  }

  let merged = { ...orderRecord };

  if (Object.keys(corePatch).length) {
    console.log('[E2E] PATCH Order master (OM):', Object.keys(corePatch).join(', '));
    const coreRes = await apiCall('PATCH', `${sobjectsOrder}/${orderId}`, corePatch);
    if (coreRes.status === 200 || coreRes.status === 204) {
      merged = { ...merged, ...corePatch };
    } else {
      console.log(
        '   PATCH Order master (OM) falhou:',
        coreRes.status,
        coreRes.data?.message || coreRes.data?.error || coreRes.text?.slice(0, 120),
      );
    }
  }

  if (contactTecnicoId && !merged.Vtal_Contact__c) {
    const contactRes = await apiCall('PATCH', `${sobjectsOrder}/${orderId}`, {
      Vtal_Contact__c: contactTecnicoId,
    });
    if (contactRes.status === 200 || contactRes.status === 204) {
      merged.Vtal_Contact__c = contactTecnicoId;
      console.log('[E2E] PATCH Order master: Vtal_Contact__c OK');
    } else {
      console.log(
        '   PATCH Vtal_Contact__c (não crítico):',
        contactRes.status,
        contactRes.data?.message || contactRes.data?.error || contactRes.text?.slice(0, 120),
      );
    }
  }

  return merged;
}

module.exports = { patchLinkDedicadoMasterOrder };
