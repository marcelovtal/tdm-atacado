const { delay } = require('../helpers/waitHelper.js');
const { createOfsApiClient } = require('./ofsApiClient.js');
const { getOfsFixture } = require('./getOfsConfig.js');
const { OFSC_CORE_V1 } = require('./ofsConstants.js');

const CORE = OFSC_CORE_V1;

function padOrdem(numeroOrdem) {
  const raw = String(numeroOrdem || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw.padStart(8, '0');
  return raw;
}

function todayIsoInTimeZone(tz = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nowDateTimeInTimeZone(tz = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function normalizeActivitiesList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.activities)) return data.activities;
  return [];
}

function activityMatchesOrdem(activity, ordem) {
  if (!activity || !ordem) return false;
  const targets = new Set([ordem, padOrdem(ordem), String(ordem).replace(/^0+/, '')].filter(Boolean));
  const fields = [
    activity.apptNumber,
    activity.XA_NUMERO_OS_CRM,
    activity.customerNumber,
    activity.activityId != null ? String(activity.activityId) : null,
  ];
  return fields.some((f) => f != null && targets.has(String(f).trim()));
}

function pickBestActivity(activities, ordem) {
  const matches = activities.filter((a) => activityMatchesOrdem(a, ordem));
  if (!matches.length) return null;
  const rank = (s) => {
    const st = String(s || '').toLowerCase();
    if (st === 'completed') return 0;
    if (st === 'started') return 1;
    if (st === 'pending') return 2;
    return 3;
  };
  return matches.sort((a, b) => rank(a.status) - rank(b.status))[0];
}

function clampDateWindow(dateFrom, dateTo, maxDays = 31) {
  const from = new Date(`${dateFrom}T12:00:00`);
  const to = new Date(`${dateTo}T12:00:00`);
  const spanMs = to.getTime() - from.getTime();
  const maxMs = Math.max(1, maxDays) * 24 * 60 * 60 * 1000;
  if (spanMs <= maxMs) return { dateFrom, dateTo };
  const clampedTo = new Date(from.getTime() + maxMs);
  return { dateFrom, dateTo: clampedTo.toISOString().slice(0, 10) };
}

function resolveSearchResources(options = {}, cfg = {}, resourceId = '') {
  const fromEnv = (process.env.OFS_SEARCH_RESOURCES || '').trim();
  if (fromEnv) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(options.searchResources) && options.searchResources.length) {
    return options.searchResources;
  }
  const list = ['vtal'];
  const rid = (resourceId || cfg?.resource_id || '').trim();
  if (rid && !list.includes(rid)) list.push(rid);
  return list;
}

async function findActivityByNumeroOrdem(client, numeroOrdem, options = {}) {
  const ordem = padOrdem(numeroOrdem);
  const today = options.today || todayIsoInTimeZone();
  const maxDays = Math.max(
    7,
    parseInt(String(process.env.OFS_SEARCH_MAX_DAYS || options.maxSearchDays || '31').trim(), 10) || 31,
  );
  const rawFrom = options.dateFrom || addDaysIso(today, -14);
  const rawTo = options.dateTo || addDaysIso(today, 45);
  const { dateFrom, dateTo } = clampDateWindow(rawFrom, rawTo, maxDays);
  const resourcesList = resolveSearchResources(options, options.config, options.resourceId);
  const queries = [
    `apptNumber=='${ordem}'`,
    `XA_NUMERO_OS_CRM=='${ordem}'`,
    `apptNumber=='${String(numeroOrdem).trim()}'`,
  ];

  for (const resources of resourcesList) {
    for (const q of queries) {
      const params = new URLSearchParams({
        resources,
        dateFrom,
        dateTo,
        q,
        limit: '20',
      });
      const res = await client.get(`${CORE}/activities?${params.toString()}`);
      if (!res.ok) continue;
      const list = normalizeActivitiesList(res.data);
      const hit = pickBestActivity(list, ordem);
      if (hit) return hit;
    }
  }

  for (const resources of resourcesList) {
    const broadParams = new URLSearchParams({ resources, dateFrom, dateTo, limit: '200' });
    const broad = await client.get(`${CORE}/activities?${broadParams.toString()}`);
    if (!broad.ok) continue;
    const list = normalizeActivitiesList(broad.data);
    const hit = pickBestActivity(list, ordem);
    if (hit) return hit;
  }
  return null;
}

async function pollActivityByNumeroOrdem(client, numeroOrdem, options = {}) {
  const maxTries = Math.max(
    1,
    parseInt(String(process.env.OFS_ACTIVITY_POLL_MAX_TRIES || options.maxTries || '24').trim(), 10) || 24,
  );
  const retryMs = Math.max(
    1000,
    parseInt(String(process.env.OFS_ACTIVITY_POLL_MS || options.retryMs || '10000').trim(), 10) || 10000,
  );
  for (let i = 1; i <= maxTries; i += 1) {
    const activity = await findActivityByNumeroOrdem(client, numeroOrdem, {
      ...options,
      today: options.today,
      config: options.config,
      resourceId: options.resourceId,
    });
    if (activity) {
      console.log(`[OFS] atividade encontrada (tentativa ${i}/${maxTries}): id=${activity.activityId} status=${activity.status}`);
      return activity;
    }
    if (i < maxTries) {
      console.log(`[OFS] atividade para ordem ${padOrdem(numeroOrdem)} ainda não disponível (${i}/${maxTries}) — aguardando ${retryMs}ms`);
      await delay(retryMs);
    }
  }
  return null;
}

async function getActivityById(client, activityId) {
  const res = await client.get(`${CORE}/activities/${activityId}`);
  if (!res.ok) {
    const hint =
      res.status === 404
        ? ' — atividade inexistente ou usuário REST sem escopo (ordens Link Dedicado/SEREDE podem exigir OFS_ACTIVITY_ID da UI e/ou outras credenciais)'
        : '';
    throw new Error(
      `OFS GET activity ${activityId}: HTTP ${res.status}${hint} ${String(res.text).slice(0, 200)}`,
    );
  }
  return res.data;
}

async function activateResourceRoute(client, resourceId, dateIso) {
  if (process.env.OFS_PULAR_ATIVACAO === '1') {
    console.log('[OFS] OFS_PULAR_ATIVACAO=1 — pulando bulkUpdateWorkSchedules');
    return { skipped: true };
  }
  const body = [
    {
      resourceId,
      workSchedules: [
        {
          startDate: dateIso,
          endDate: dateIso,
          recordType: 'working',
          shiftType: 'regular',
          workTimeStart: process.env.OFS_WORK_TIME_START || '08:00:00',
          workTimeEnd: process.env.OFS_WORK_TIME_END || '20:00:00',
          recurrence: {
            dayFrom: dateIso,
            dayTo: dateIso,
            recurEvery: 1,
            recurrenceType: 'daily',
          },
        },
      ],
    },
  ];
  const res = await client.post(`${CORE}/resources/custom-actions/bulkUpdateWorkSchedules`, body);
  if (!res.ok) {
    console.log('[OFS] bulkUpdateWorkSchedules (não crítico):', res.status, String(res.text).slice(0, 180));
    return { ok: false, status: res.status };
  }
  console.log('[OFS] rota do técnico ativada (bulkUpdateWorkSchedules) para', resourceId, dateIso);
  return { ok: true };
}

async function moveActivityToResource(client, activityId, resourceId, dateIso) {
  /** Collection Postman "GetActivity Copy 2" — move custom-action. */
  const body = {
    resourceId,
    setDate: { date: dateIso },
    position: { positionInRoute: parseInt(String(process.env.OFS_POSITION_IN_ROUTE || '1').trim(), 10) || 1 },
  };
  const res = await client.post(`${CORE}/activities/${activityId}/custom-actions/move`, body);
  if (!res.ok) {
    throw new Error(`OFS move activity ${activityId}: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
  }
  console.log('[OFS] atividade movida para', resourceId, 'em', dateIso);
  return res.data;
}

async function rescheduleActivityToday(client, activityId, resourceId, dateIso) {
  /** Collection Postman "GetActivity Copy" — PATCH date/startTime/endTime/resourceId. */
  const startHour = process.env.OFS_START_HOUR || '10';
  const endHour = process.env.OFS_END_HOUR || '14';
  const startTime = `${dateIso} ${String(startHour).padStart(2, '0')}:00:00`;
  const endTime = `${dateIso} ${String(endHour).padStart(2, '0')}:00:00`;
  const body = { date: dateIso, startTime, endTime, resourceId };
  const res = await client.patch(`${CORE}/activities/${activityId}`, body);
  if (!res.ok) {
    console.log('[OFS] PATCH reagendamento (não crítico):', res.status, String(res.text).slice(0, 180));
    return false;
  }
  console.log('[OFS] atividade reagendada para', dateIso);
  return true;
}

function parseOptionalJsonEnv(name) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${name} inválido (JSON): ${err.message}`);
  }
}

async function startActivity(client, activityId) {
  const customBody = parseOptionalJsonEnv('OFS_START_BODY_JSON');
  const body =
    customBody ||
    ({
      startTime: nowDateTimeInTimeZone(),
    });
  const res = await client.post(`${CORE}/activities/${activityId}/custom-actions/start`, body);
  if (!res.ok) {
    throw new Error(`OFS start activity ${activityId}: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
  }
  console.log('[OFS] atividade iniciada (start)');
  return res.data;
}

async function completeActivity(client, activityId) {
  const customBody = parseOptionalJsonEnv('OFS_COMPLETE_BODY_JSON');
  const res = await client.post(`${CORE}/activities/${activityId}/custom-actions/complete`, customBody || {});
  if (!res.ok) {
    throw new Error(`OFS complete activity ${activityId}: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
  }
  console.log('[OFS] atividade concluída (complete)');
  return res.data;
}

function isCompletedStatus(status) {
  return /^(completed|complete|conclu)/i.test(String(status || '').trim());
}

function isStartedStatus(status) {
  return /^(started|in.?progress|em.?execu)/i.test(String(status || '').trim());
}

/**
 * Instalação OFS via API (paridade com vtal-mcp OFSPage.ativarRotaTecnico):
 * poll atividade → ativar rota técnico → mover/reagendar → start → complete.
 */
async function runOfsInstalacaoCompleta(options = {}) {
  const cfg = options.config || getOfsFixture();
  const client = options.client || createOfsApiClient(cfg);

  const numeroOrdemRaw =
    (process.env.OFS_ORDEM_NUMERO || '').trim() ||
    options.numeroOrdem ||
    options.subOrderOrderNumber ||
    '';
  const numeroOrdem = padOrdem(numeroOrdemRaw);
  if (!numeroOrdem) {
    throw new Error('OFS: número da ordem ausente (subpedido CRM ou OFS_ORDEM_NUMERO).');
  }

  const resourceId =
    (process.env.OFS_RESOURCE_ID || '').trim() || cfg?.resource_id || options.resourceId || '';
  if (!resourceId) {
    throw new Error('OFS: OFS_RESOURCE_ID ausente (ID do técnico no OFS, ex. TEC_TESTE_01).');
  }

  const today = todayIsoInTimeZone();
  const targetDate = (process.env.OFS_TARGET_DATE || options.targetDate || '').trim() || today;
  console.log(
    `[OFS] instalação via API | ordem=${numeroOrdem} | técnico=${resourceId} | dataAlvo=${targetDate}`,
  );

  const activityIdEnv = (process.env.OFS_ACTIVITY_ID || options.activityId || '').trim();
  let activity;
  if (activityIdEnv) {
    console.log(`[OFS] OFS_ACTIVITY_ID=${activityIdEnv} — pulando busca por apptNumber`);
    activity = await getActivityById(client, activityIdEnv);
  } else {
    activity = await pollActivityByNumeroOrdem(client, numeroOrdem, {
      today,
      config: cfg,
      resourceId,
    });
  }
  if (!activity?.activityId) {
    throw new Error(
      `OFS: atividade não encontrada para ordem ${numeroOrdem} (REST qa@ pode não enxergar bucket SEREDE/LD — informe OFS_ACTIVITY_ID da UI ou credencial com escopo).`,
    );
  }

  let activityId = activity.activityId;
  let status = String(activity.status || '').toLowerCase();

  if (isCompletedStatus(status)) {
    console.log('[OFS] atividade já concluída — nada a fazer');
    return {
      ofsActivityId: activityId,
      ofsActivityStatus: activity.status,
      ofsNumeroOrdem: numeroOrdem,
      ofsResourceId: resourceId,
      ofsInstalacaoConcluida: true,
      ofsJaConcluida: true,
    };
  }

  await activateResourceRoute(client, resourceId, targetDate);

  activity = await getActivityById(client, activityId);
  status = String(activity.status || '').toLowerCase();
  const activityDate = activity.date || targetDate;

  if (activityDate !== targetDate || String(activity.resourceId || '') !== resourceId) {
    await rescheduleActivityToday(client, activityId, resourceId, targetDate);
    await moveActivityToResource(client, activityId, resourceId, targetDate);
  } else {
    console.log('[OFS] atividade já atribuída ao técnico na data alvo');
  }

  activity = await getActivityById(client, activityId);
  status = String(activity.status || '').toLowerCase();

  if (!isStartedStatus(status) && !isCompletedStatus(status)) {
    await startActivity(client, activityId);
    activity = await getActivityById(client, activityId);
    status = String(activity.status || '').toLowerCase();
  } else if (isStartedStatus(status)) {
    console.log('[OFS] atividade já iniciada — pulando start');
  }

  if (!isCompletedStatus(status)) {
    await completeActivity(client, activityId);
    activity = await getActivityById(client, activityId);
    status = activity.status;
  }

  const concluida = isCompletedStatus(status);
  if (!concluida) {
    throw new Error(`OFS: status final inesperado após complete: ${status || '—'}`);
  }

  console.log('\n*** OFS INSTALAÇÃO ***');
  console.log('  OFS ActivityId:', activityId);
  console.log('  OFS Status:', status);
  console.log('  OFS Ordem:', numeroOrdem);

  return {
    ofsActivityId: activityId,
    ofsActivityStatus: status,
    ofsNumeroOrdem: numeroOrdem,
    ofsResourceId: resourceId,
    ofsInstalacaoConcluida: true,
    ofsJaConcluida: false,
  };
}

module.exports = {
  runOfsInstalacaoCompleta,
  findActivityByNumeroOrdem,
  pollActivityByNumeroOrdem,
  padOrdem,
  todayIsoInTimeZone,
  nowDateTimeInTimeZone,
};
