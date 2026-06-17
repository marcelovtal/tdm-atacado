const { QUERY_URL } = require('./sfRestPaths.js');

const DEFAULT_APPROVED = ['Approved', 'Aprovado', 'Aprovada'];
const SUPERSEDE_STATUSES = (process.env.QUOTE_SUPERSEDE_STATUSES || 'Denied,Draft,Rejected')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildApprovedSet(statusAprovado) {
  return new Set([statusAprovado, ...DEFAULT_APPROVED].filter(Boolean).map((s) => s.toLowerCase()));
}

function isApprovedStatus(status, approvedSet) {
  return approvedSet.has(String(status || '').trim().toLowerCase());
}

function extractErrorMessage(res) {
  return [
    res?.data?.[0]?.message,
    res?.data?.message,
    res?.data?.error,
    res?.text,
  ]
    .filter(Boolean)
    .join(' ');
}

async function fetchQuoteRecord(apiCall, quoteId, SOBJECTS_QUOTE) {
  const get = await apiCall('GET', `${SOBJECTS_QUOTE}/${quoteId}`);
  if (get.status === 200 && get.data) {
    return {
      Id: quoteId,
      Status: get.data.Status || '',
      OpportunityId: get.data.OpportunityId || null,
    };
  }
  return { Id: quoteId, Status: '', OpportunityId: null };
}

function isPreSaleStatus(status) {
  return /^pre[\s-]?sale$/i.test(String(status || '').trim());
}

async function queryAllQuotesOnOpportunity(apiCall, opportunityId) {
  const q = `SELECT Id, Status, IsSyncing FROM Quote WHERE OpportunityId = '${opportunityId}' ORDER BY CreatedDate DESC`;
  const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
  if (res.status === 200 && Array.isArray(res.data?.records)) {
    return res.data.records;
  }
  return [];
}
async function queryApprovedQuotesOnOpportunity(apiCall, opportunityId, excludeQuoteId) {
  const excludeClause = excludeQuoteId ? ` AND Id != '${excludeQuoteId}'` : '';
  const q = `SELECT Id, Status FROM Quote WHERE OpportunityId = '${opportunityId}'${excludeClause} AND (Status = 'Approved' OR Status = 'Aprovado' OR Status = 'Aprovada')`;
  const res = await apiCall('GET', `${QUERY_URL}?q=${encodeURIComponent(q)}`);
  if (res.status === 200 && Array.isArray(res.data?.records)) {
    return res.data.records;
  }
  return [];
}

async function patchQuoteStatus(apiCall, fail, SOBJECTS_QUOTE, quoteId, status, label) {
  const patch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, { Status: status });
  if (patch.status === 200 || patch.status === 204) {
    console.log(`   ${label}: Quote ${quoteId} → ${status}`);
    return true;
  }
  console.log(`   ${label} falhou (${status}):`, patch.status, extractErrorMessage(patch).slice(0, 120));
  return false;
}

/**
 * Rebaixa cotações irmãs já aprovadas na mesma oportunidade (TI: loop de endereços cria várias quotes).
 */
async function supersedeSiblingApprovedQuotes({
  apiCall,
  opportunityId,
  excludeQuoteId = null,
  SOBJECTS_QUOTE,
}) {
  if (!opportunityId) return 0;

  const siblings = await queryApprovedQuotesOnOpportunity(apiCall, opportunityId, excludeQuoteId);
  if (siblings.length === 0) return 0;

  console.log(
    `[E2E] supersede: ${siblings.length} cotação(ões) aprovada(s) na opp ${opportunityId}` +
      (excludeQuoteId ? ` (exceto ${excludeQuoteId})` : '') +
      ' — rebaixando para liberar aprovação da cotação atual...'
  );

  let cleared = 0;
  for (const rec of siblings) {
    for (const targetStatus of SUPERSEDE_STATUSES) {
      const ok = await patchQuoteStatus(apiCall, null, SOBJECTS_QUOTE, rec.Id, targetStatus, 'supersede');
      if (ok) {
        cleared += 1;
        break;
      }
    }
  }
  return cleared;
}

async function applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE }) {
  if (!IS_TI || !proposalValidity) return;
  console.log('[E2E] 17e. PATCH Quote (validade da proposta)...');
  const savePatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
    Vtal_Seg_ProposalValidity__c: proposalValidity,
  });
  if (savePatch.status !== 200 && savePatch.status !== 204) {
    console.log('   PATCH save (não crítico):', savePatch.status);
  }
}

/**
 * Aprova cotação antes de CreateOrderOnQuote (TRG: Reviewed → Approved; TI: Approved direto).
 * Em TI, ProductsValidation(advance) pode já deixar a cotação Approved — nesse caso pula o PATCH.
 * Se outra cotação da mesma opp já estiver aprovada (loop de endereços), rebaixa irmãs e tenta de novo.
 */
async function ensureQuoteApproved({
  apiCall,
  fail,
  SOBJECTS_QUOTE,
  quoteId,
  opportunityId = null,
  statusAprovado,
  proposalValidity,
  IS_TRG = false,
  IS_TI = false,
  quoteFlow = { needsReviewed: false, reviewedStatus: null },
}) {
  const approvedSet = buildApprovedSet(statusAprovado);

  let quoteRec = await fetchQuoteRecord(apiCall, quoteId, SOBJECTS_QUOTE);
  let oppId = opportunityId || quoteRec.OpportunityId;

  if (isApprovedStatus(quoteRec.Status, approvedSet)) {
    console.log('[E2E] 17d. Quote já está', quoteRec.Status, '; pulando PATCH de aprovação.');
    await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
    return;
  }

  if (IS_TI && oppId) {
    const cleared = await supersedeSiblingApprovedQuotes({
      apiCall,
      opportunityId: oppId,
      excludeQuoteId: quoteId,
      SOBJECTS_QUOTE,
    });
    if (cleared > 0) {
      quoteRec = await fetchQuoteRecord(apiCall, quoteId, SOBJECTS_QUOTE);
      if (isApprovedStatus(quoteRec.Status, approvedSet)) {
        console.log('[E2E] 17d. Quote ficou', quoteRec.Status, 'após supersede de irmãs; pulando PATCH.');
        await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
        return;
      }
    }

    // TI pós Pre sale + ProductsValidation(advance): PATCH Approved dispara falso positivo no fluxo
    // Vtal_Seg_OnQuoteStatusChange ("já possui cotação aprovada") sem haver outra quote Approved na opp.
    if (isPreSaleStatus(quoteRec.Status)) {
      const siblings = await queryApprovedQuotesOnOpportunity(apiCall, oppId, quoteId);
      if (siblings.length === 0) {
        console.log(
          '[E2E] 17d. TI: cotação em Pre sale pós-advance, sem irmã aprovada — pulando PATCH Approved (Link Dedicado não usa este caminho).'
        );
        await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
        return;
      }
    }
  }

  if (IS_TRG && quoteFlow.needsReviewed) {
    console.log('[E2E] 17d1. TRG: PATCH Quote Status → Reviewed (pré-aprovação)...');
    const reviewedPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Status: quoteFlow.reviewedStatus,
      Vtal_Seg_ProposalValidityTerm__c: '1',
    });
    if (reviewedPatch.status !== 200 && reviewedPatch.status !== 204) {
      fail('PATCH Quote Status Reviewed', reviewedPatch);
    }

    console.log('[E2E] 17d2. TRG: PATCH Quote Vtal_Seg_ProposalValidity__c...');
    const validityPatch = await apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, {
      Vtal_Seg_ProposalValidity__c: proposalValidity,
    });
    if (validityPatch.status !== 200 && validityPatch.status !== 204) {
      console.log('   PATCH validity (não crítico):', validityPatch.status);
    }
  }

  console.log(
    '[E2E] 17d3. PATCH Quote Status →',
    statusAprovado,
    `(atual: ${quoteRec.Status || '?'}) — obrigatório antes de CreateOrderOnQuote...`
  );

  async function tryApprovePatch() {
    return apiCall('PATCH', `${SOBJECTS_QUOTE}/${quoteId}`, { Status: statusAprovado });
  }

  let aprovadoPatch = await tryApprovePatch();
  if (aprovadoPatch.status === 200 || aprovadoPatch.status === 204) {
    await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
    return;
  }

  const msg = extractErrorMessage(aprovadoPatch);
  if (/já possui uma cotação aprovada/i.test(msg)) {
    quoteRec = await fetchQuoteRecord(apiCall, quoteId, SOBJECTS_QUOTE);
    if (isApprovedStatus(quoteRec.Status, approvedSet)) {
      console.log('   Quote já está', quoteRec.Status, 'após validação TI; continuando fluxo.');
      await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
      return;
    }

    if (oppId) {
      await supersedeSiblingApprovedQuotes({
        apiCall,
        opportunityId: oppId,
        excludeQuoteId: quoteId,
        SOBJECTS_QUOTE,
      });
      aprovadoPatch = await tryApprovePatch();
      if (aprovadoPatch.status === 200 || aprovadoPatch.status === 204) {
        await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
        return;
      }
      quoteRec = await fetchQuoteRecord(apiCall, quoteId, SOBJECTS_QUOTE);
      if (isApprovedStatus(quoteRec.Status, approvedSet)) {
        console.log('   Quote ficou', quoteRec.Status, 'após supersede + retry; continuando.');
        await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
        return;
      }

      if (IS_TI && isPreSaleStatus(quoteRec.Status)) {
        const siblings = await queryApprovedQuotesOnOpportunity(apiCall, oppId, quoteId);
        if (siblings.length === 0) {
          const allQuotes = await queryAllQuotesOnOpportunity(apiCall, oppId);
          console.log(
            '   TI: PATCH Approved bloqueado pelo fluxo; cotação permanece Pre sale.',
            'Quotes na opp:',
            allQuotes.map((q) => `${q.Id}:${q.Status}`).join(', ') || '(nenhuma)'
          );
          await applyProposalValidityIfTi({ apiCall, quoteId, proposalValidity, IS_TI, SOBJECTS_QUOTE });
          return;
        }
      }
    }
  }

  fail('PATCH Quote Status ' + statusAprovado + ' (cotação precisa estar Aprovado)', aprovadoPatch);
}

module.exports = { ensureQuoteApproved, supersedeSiblingApprovedQuotes };
