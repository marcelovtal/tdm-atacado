const { createOfsUiApiClient } = require('./ofsUiApiClient.js');
const { getOfsUiConfigAsync } = require('./getOfsUiConfig.js');
const { runOfsAtivarRotaUi } = require('./runOfsAtivarRotaUi.js');
const { padOrdem, todayIsoInTimeZone } = require('./runOfsInstalacaoCompleta.js');
const { resolveOfsTechCandidates, describeTechCandidate } = require('./ofsTechCandidates.js');

function extractProviderPid(data, searchKw) {
  const needle = String(searchKw || '')
    .trim()
    .toLowerCase();
  if (!needle) return null;

  function walk(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    const label = [node.name, node.label, node.title, node.text, node.caption]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const pid = node.pid ?? node.id ?? node.provider_id ?? node.providerId;
    if (pid != null && label && label.includes(needle)) return String(pid);
    for (const val of Object.values(node)) {
      const found = walk(val);
      if (found) return found;
    }
    return null;
  }

  return walk(data);
}

async function resolveTechPidForCandidate(client, candidate, ctx) {
  const explicit = String(candidate.pid || '').trim();
  if (explicit) return explicit;
  const search = String(candidate.search || '').trim();
  if (!search) return '';
  const providers = await client.listProvidersForMove({
    bucketPid: ctx.bucketPid,
    sourceDate: ctx.sourceDate,
    targetDate: ctx.targetDate,
    aid: ctx.aid,
    searchKw: search,
  });
  return extractProviderPid(providers, search) || '';
}

/**
 * Instalação OFS via API interna AJAX (dispatcher UI).
 * Fluxo: ativar rota → sync(load) → assignment(move) → start → complete.
 */
async function runOfsInstalacaoCompletaUiOnce(options = {}) {
  const cfg = options.uiConfig || (await getOfsUiConfigAsync(options));
  const client = options.client || createOfsUiApiClient(cfg);

  const numeroOrdem = padOrdem(
    (process.env.OFS_ORDEM_NUMERO || '').trim() ||
      options.numeroOrdem ||
      options.subOrderOrderNumber ||
      '',
  );

  let aid = (process.env.OFS_ACTIVITY_ID || options.activityId || '').trim();
  let searchHit = options.searchHit || null;

  if (!aid) {
    if (!numeroOrdem) {
      throw new Error('OFS UI: informe OFS_ACTIVITY_ID ou número da ordem (subpedido CRM).');
    }
    searchHit = await client.pollActivityByApptNumber(numeroOrdem, options);
    if (!searchHit?.aid) {
      throw new Error(`OFS UI: atividade não encontrada para ordem ${numeroOrdem} (search dispatcher).`);
    }
    aid = String(searchHit.aid);
  }

  const bucketPid = (
    process.env.OFS_BUCKET_PID ||
    options.bucketPid ||
    (searchHit?.pid != null ? String(searchHit.pid) : '') ||
    cfg.bucket_pid ||
    ''
  ).trim();

  const techPid = String(options.techPid || process.env.OFS_TECH_PID || cfg.tech_pid || '').trim();
  const techSearch = String(
    options.techSearch || process.env.OFS_TECH_SEARCH || cfg.tech_search || '',
  ).trim();

  if (!techPid && !techSearch) {
    throw new Error('OFS UI: técnico sem pid/search configurado.');
  }

  const targetDate =
    (process.env.OFS_TARGET_DATE || options.targetDate || '').trim() || todayIsoInTimeZone();
  const sourceDateInitial =
    (process.env.OFS_SOURCE_DATE || options.sourceDate || searchHit?.date || '').trim() || targetDate;

  let loaded;
  if (process.env.OFS_PULAR_MOVE === '1') {
    if (!techPid) {
      throw new Error('OFS UI: OFS_PULAR_MOVE=1 exige OFS_TECH_PID explícito.');
    }
    loaded = await client.loadTechnicianRoute({ techPid, targetDate, aid });
    if (!loaded.activity) {
      throw new Error(`OFS UI: atividade ${aid} não encontrada na rota do técnico ${techPid} em ${targetDate}.`);
    }
  } else {
    loaded = await client.loadActivityByAid(aid, {
      bucketPid,
      date: sourceDateInitial,
    });
  }

  let activity = loaded.activity;
  let sourceDate =
    (process.env.OFS_SOURCE_DATE || options.sourceDate || '').trim() ||
    activity.activity_start_time?.slice(0, 10) ||
    loaded.queue?.date ||
    sourceDateInitial;
  let qid = loaded.queue?.qid || activity.qid;

  let resolvedTechPid = techPid;
  if (!resolvedTechPid && techSearch && process.env.OFS_PULAR_MOVE !== '1') {
    await client.openAssignment({ aid, bucketPid, qid, sourceDate });
    resolvedTechPid = await resolveTechPidForCandidate(
      client,
      { search: techSearch },
      { bucketPid, sourceDate, targetDate, aid },
    );
  }
  if (!resolvedTechPid) {
    throw new Error(
      `OFS UI: não foi possível resolver pid do técnico (search="${techSearch || '—'}").`,
    );
  }

  console.log(
    `[OFS-UI] instalação | aid=${aid} | ordem=${numeroOrdem || '—'} | bucket pid=${bucketPid || '—'} | técnico pid=${resolvedTechPid} | origem=${sourceDate} | alvo=${targetDate}`,
  );

  let ativacao = null;
  if (process.env.OFS_PULAR_ATIVACAO !== '1') {
    ativacao = await runOfsAtivarRotaUi({
      uiConfig: cfg,
      client,
      techPid: resolvedTechPid,
      targetDate,
    });
  } else {
    console.log('[OFS-UI] OFS_PULAR_ATIVACAO=1 — pulando ativar rota/refeição');
  }

  const status = String(activity.astatus || activity.status || '').toLowerCase();
  if (/^(completed|complete|conclu)/i.test(status)) {
    console.log('[OFS-UI] atividade já concluída');
    return {
      ofsActivityId: aid,
      ofsNumeroOrdem: numeroOrdem || activity.appt_number,
      ofsActivityStatus: status,
      ofsInstalacaoConcluida: true,
      ofsJaConcluida: true,
      ofsMode: 'ui-ajax',
      ofsTechPid: resolvedTechPid,
    };
  }

  if (process.env.OFS_PULAR_MOVE !== '1') {
    if (!techSearch) {
      await client.openAssignment({ aid, bucketPid, qid, sourceDate });
    }
    if (techSearch) {
      await client.listProvidersForMove({
        bucketPid,
        sourceDate,
        targetDate,
        aid,
        searchKw: techSearch,
      });
    }
    await client.moveActivityToTechnician({
      bucketPid,
      techPid: resolvedTechPid,
      sourceDate,
      targetDate,
      aid,
    });
  } else {
    console.log('[OFS-UI] OFS_PULAR_MOVE=1 — pulando assignment');
  }

  const onTech = await client.loadTechnicianRoute({ techPid: resolvedTechPid, targetDate, aid });
  activity = onTech.activity || activity;
  qid = onTech.queue?.qid || qid;
  const aworktype = String(activity.aworktype || activity.activityType || searchHit?.aworktype || '6');

  if (process.env.OFS_PULAR_START !== '1' && !/^(started|in.?progress|em.?execu)/i.test(status)) {
    await client.startActivityMobile({ techPid: resolvedTechPid, targetDate, aid, qid, aworktype });
  } else {
    console.log('[OFS-UI] pulando start');
  }

  if (process.env.OFS_PULAR_COMPLETE !== '1') {
    const afterStart = await client.loadTechnicianRoute({ techPid: resolvedTechPid, targetDate, aid });
    qid = afterStart.queue?.qid || qid;
    await client.completeActivityMobile({ techPid: resolvedTechPid, targetDate, aid, qid, aworktype });
  } else {
    console.log('[OFS-UI] OFS_PULAR_COMPLETE=1 — pulando complete');
  }

  const final = await client.loadTechnicianRoute({ techPid: resolvedTechPid, targetDate, aid });
  const finalStatus = String(final.activity?.astatus || final.activity?.status || '—');

  console.log('\n*** OFS INSTALAÇÃO (UI AJAX) ***');
  console.log('  ActivityId:', aid);
  console.log('  Ordem:', numeroOrdem || final.activity?.appt_number);
  console.log('  Técnico pid:', resolvedTechPid);
  console.log('  Status:', finalStatus);

  return {
    ofsActivityId: aid,
    ofsNumeroOrdem: numeroOrdem || final.activity?.appt_number,
    ofsActivityStatus: finalStatus,
    ofsTechPid: resolvedTechPid,
    ofsBucketPid: bucketPid,
    ofsSourceDate: sourceDate,
    ofsTargetDate: targetDate,
    ofsInstalacaoConcluida: /^(completed|complete|conclu)/i.test(finalStatus),
    ofsMode: 'ui-ajax',
    ofsAtivacao: ativacao,
  };
}

async function runOfsInstalacaoCompletaUi(options = {}) {
  const cfg = options.uiConfig || (await getOfsUiConfigAsync(options));
  const client = options.client || createOfsUiApiClient(cfg);
  const candidates = resolveOfsTechCandidates(cfg);
  if (!candidates.length) {
    throw new Error('OFS UI: nenhum técnico configurado (tech_candidates / OFS_TECH_PID).');
  }

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const label = describeTechCandidate(candidate, i);
    if (i > 0) {
      console.log(`[OFS-UI] tentando técnico alternativo: ${label}`);
    }
    try {
      return await runOfsInstalacaoCompletaUiOnce({
        ...options,
        uiConfig: cfg,
        client,
        techPid: candidate.pid,
        techSearch: candidate.search,
      });
    } catch (err) {
      lastError = err;
      console.warn(`[OFS-UI] falha com ${label}: ${err.message || err}`);
      if (i < candidates.length - 1) {
        console.log('[OFS-UI] tentando próximo técnico da lista…');
      }
    }
  }

  throw lastError || new Error('OFS UI: todos os técnicos configurados falharam.');
}

module.exports = { runOfsInstalacaoCompletaUi, runOfsInstalacaoCompletaUiOnce };
