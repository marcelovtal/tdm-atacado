const { createOfsUiApiClient } = require('./ofsUiApiClient.js');

const { getOfsUiConfigAsync } = require('./getOfsUiConfig.js');

const { runOfsAtivarRotaUi } = require('./runOfsAtivarRotaUi.js');

const { padOrdem, todayIsoInTimeZone } = require('./runOfsInstalacaoCompleta.js');



/**

 * Instalação OFS via API interna AJAX (dispatcher UI).

 * Fluxo: ativar rota → sync(load) → assignment(move) → start → complete.

 * Resolve aid pelo número da ordem (search UI) quando OFS_ACTIVITY_ID não está definido.

 */

async function runOfsInstalacaoCompletaUi(options = {}) {

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

    '3457'

  ).trim();

  const techPid = (process.env.OFS_TECH_PID || options.techPid || cfg.tech_pid || '').trim();

  if (!techPid) {

    throw new Error('OFS UI: OFS_TECH_PID obrigatório (pid do técnico no dispatcher, ex. 881).');

  }



  const targetDate =

    (process.env.OFS_TARGET_DATE || options.targetDate || '').trim() || todayIsoInTimeZone();

  const sourceDateInitial =

    (process.env.OFS_SOURCE_DATE || options.sourceDate || searchHit?.date || '').trim() || targetDate;

  const techSearch = (process.env.OFS_TECH_SEARCH || options.techSearch || cfg.tech_search || '').trim();



  console.log(

    `[OFS-UI] instalação | aid=${aid} | ordem=${numeroOrdem || '—'} | bucket pid=${bucketPid} | técnico pid=${techPid} | origem=${sourceDateInitial} | alvo=${targetDate}`,

  );



  let ativacao = null;

  if (process.env.OFS_PULAR_ATIVACAO !== '1') {

    ativacao = await runOfsAtivarRotaUi({

      uiConfig: cfg,

      client,

      techPid,

      targetDate,

    });

  } else {

    console.log('[OFS-UI] OFS_PULAR_ATIVACAO=1 — pulando ativar rota/refeição');

  }



  let loaded;

  if (process.env.OFS_PULAR_MOVE === '1') {

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

    };

  }



  if (process.env.OFS_PULAR_MOVE !== '1') {

    await client.openAssignment({ aid, bucketPid, qid, sourceDate });

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

      techPid,

      sourceDate,

      targetDate,

      aid,

    });

  } else {

    console.log('[OFS-UI] OFS_PULAR_MOVE=1 — pulando assignment');

  }



  const onTech = await client.loadTechnicianRoute({ techPid, targetDate, aid });

  activity = onTech.activity || activity;

  qid = onTech.queue?.qid || qid;

  const aworktype = String(activity.aworktype || activity.activityType || searchHit?.aworktype || '6');



  if (process.env.OFS_PULAR_START !== '1' && !/^(started|in.?progress|em.?execu)/i.test(status)) {

    await client.startActivityMobile({ techPid, targetDate, aid, qid, aworktype });

  } else {

    console.log('[OFS-UI] pulando start');

  }



  if (process.env.OFS_PULAR_COMPLETE !== '1') {

    const afterStart = await client.loadTechnicianRoute({ techPid, targetDate, aid });

    qid = afterStart.queue?.qid || qid;

    await client.completeActivityMobile({ techPid, targetDate, aid, qid, aworktype });

  } else {

    console.log('[OFS-UI] OFS_PULAR_COMPLETE=1 — pulando complete');

  }



  const final = await client.loadTechnicianRoute({ techPid, targetDate, aid });

  const finalStatus = String(final.activity?.astatus || final.activity?.status || '—');



  console.log('\n*** OFS INSTALAÇÃO (UI AJAX) ***');

  console.log('  ActivityId:', aid);

  console.log('  Ordem:', numeroOrdem || final.activity?.appt_number);

  console.log('  Status:', finalStatus);



  return {

    ofsActivityId: aid,

    ofsNumeroOrdem: numeroOrdem || final.activity?.appt_number,

    ofsActivityStatus: finalStatus,

    ofsTechPid: techPid,

    ofsBucketPid: bucketPid,

    ofsSourceDate: sourceDate,

    ofsTargetDate: targetDate,

    ofsInstalacaoConcluida: /^(completed|complete|conclu)/i.test(finalStatus),

    ofsMode: 'ui-ajax',

    ofsAtivacao: ativacao,

  };

}



module.exports = { runOfsInstalacaoCompletaUi };


