const { delay } = require('./helpers/waitHelper.js');
const { extractLinkDedicadoSubpedidos } = require('./extractLinkDedicadoSubpedidos.js');

const SUB_ORDER_FIELDS =
  'Id, OrderNumber, Status, vtal_LXD_Produto_do_pedido__c, Vtal_Seg_PointType__c';

async function querySubpedidos(apiCall, queryUrl, whereClause) {
  const q = `SELECT ${SUB_ORDER_FIELDS} FROM Order WHERE ${whereClause}`;
  const res = await apiCall('GET', `${queryUrl}?q=${encodeURIComponent(q)}`);
  if (res.status === 200 && res.data?.records?.length) {
    return res.data.records;
  }
  return [];
}

/**
 * Se o poll do pedido terminou sem A/B, tenta de novo antes do PEGA (OM pode demorar após checkout).
 */
async function refreshLinkDedicadoSubpedidosForPega(result = {}, apiCall, queryUrl, options = {}) {
  if (process.env.SKIP_PEGA === '1') return result;
  if (result.subOrderOrderNumberPontaA && result.subOrderOrderNumberPontaB) return result;
  if (!result.orderId || !apiCall || !queryUrl) return result;

  const timeoutMs = options.timeoutMs ?? 120000;
  const intervalMs = options.intervalMs ?? 5000;
  const logPrefix = options.logPrefix || '[E2E LD]';
  const quoteId = result.quoteId;
  const orderId = result.orderId;
  const start = Date.now();

  console.log(`${logPrefix} Subpedidos A/B ausentes — aguardando OM antes do PEGA (até ${timeoutMs / 1000}s)...`);

  while (Date.now() - start < timeoutMs) {
    let records = await querySubpedidos(
      apiCall,
      queryUrl,
      `vlocity_cmt__ParentOrderId__c = '${orderId}'`,
    );
    if (!records.length && quoteId) {
      records = await querySubpedidos(
        apiCall,
        queryUrl,
        `vlocity_cmt__QuoteId__c = '${quoteId}' AND vlocity_cmt__ParentOrderId__c != null`,
      );
    }
    if (!records.length && quoteId) {
      records = await querySubpedidos(
        apiCall,
        queryUrl,
        `QuoteId = '${quoteId}' AND vlocity_cmt__ParentOrderId__c != null`,
      );
    }

    if (records.length) {
      const extracted = extractLinkDedicadoSubpedidos(records);
      if (extracted.subOrderOrderNumberPontaA && extracted.subOrderOrderNumberPontaB) {
        console.log(
          `${logPrefix} Subpedidos OK para PEGA: A=${extracted.subOrderOrderNumberPontaA}, B=${extracted.subOrderOrderNumberPontaB}` +
            (extracted.subOrderOrderNumberEVC ? `, EVC=${extracted.subOrderOrderNumberEVC}` : ''),
        );
        return {
          ...result,
          subOrderEmImplantacao: true,
          ...extracted,
        };
      }
    }

    await delay(intervalMs);
  }

  console.log(`${logPrefix} Subpedidos A/B ainda indisponíveis após ${timeoutMs / 1000}s — PEGA pode ser omitido.`);
  return result;
}

module.exports = { refreshLinkDedicadoSubpedidosForPega };
