const { getOfsUiConfig } = require('./getOfsUiConfig.js');
const { isOfsUiSessionExpiredResponse, renewOfsUiSession } = require('./ofsUiLogin.js');
const { nowDateTimeInTimeZone } = require('./runOfsInstalacaoCompleta.js');

function buildMultipartBody(fields, boundary = `----OfsUi${Date.now()}`) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    const v = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${v}\r\n`);
  }
  parts.push(`--${boundary}--\r\n`);
  return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
}

function toUrlEncoded(data) {
  return new URLSearchParams(data).toString();
}

function applySessionToConfig(cfg, session) {
  if (session.cookie) cfg.cookie = session.cookie;
  if (session.csrf) cfg.csrf = session.csrf;
  if (session.trust) cfg.trust = session.trust;
  if (session.user) cfg.user = session.user;
}

function createOfsUiApiClient(config = null, clientOptions = {}) {
  const cfg = config || getOfsUiConfig();
  const baseUrl = cfg.base_url.replace(/\/$/, '');
  let dv = { ...(cfg.dv || {}) };
  const autoRenew = clientOptions.autoRenewSession !== false;
  let renewInFlight = null;

  function headers(extra = {}) {
    return {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Cookie: cfg.cookie,
      'x-oa': '2',
      'x-platform': '1',
      'x-requested-with': 'XMLHttpRequest',
      'x-ofs-csrf-secure': cfg.csrf,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      ...extra,
    };
  }

  function absorbDv(data) {
    if (data?.delta?.version && typeof data.delta.version === 'object') {
      dv = { ...data.delta.version };
    }
  }

  async function renewSessionOnce() {
    if (!autoRenew) return false;
    if (envTrim('OFS_UI_SKIP_AUTO_LOGIN') === '1') return false;
    if (!renewInFlight) {
      renewInFlight = renewOfsUiSession()
        .then((session) => {
          applySessionToConfig(cfg, session);
          console.log('[OFS-UI] sessão renovada — retentando requisição');
          return true;
        })
        .catch((err) => {
          console.warn('[OFS-UI] falha ao renovar sessão:', err.message || err);
          return false;
        })
        .finally(() => {
          renewInFlight = null;
        });
    }
    return renewInFlight;
  }

  function envTrim(name) {
    const v = process.env[name];
    return v == null ? '' : String(v).trim();
  }

  async function request(method, url, { body, contentType, log = true, _retried = false } = {}) {
    if (log) console.log(`[OFS-UI] ${method} ${url.replace(baseUrl, '')}`);
    const res = await fetch(url, {
      method,
      headers: headers(body != null ? { 'Content-Type': contentType } : {}),
      body,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }

    const expired = isOfsUiSessionExpiredResponse({ status: res.status, text, data });
    if (!_retried && expired) {
      const renewed = await renewSessionOnce();
      if (renewed) {
        return request(method, url, { body, contentType, log, _retried: true });
      }
    }

    if (res.ok && data && typeof data === 'object') absorbDv(data);
    return { ok: res.ok, status: res.status, data, text };
  }

  async function syncWrite(extraFields = {}) {
    const fields = {
      __protocol: cfg.protocol,
      dv: extraFields.dv != null ? extraFields.dv : JSON.stringify(dv),
      pid: String(extraFields.pid ?? '0'),
      u: cfg.user,
      f: 'json',
      pids: extraFields.pids ?? '[]',
      aids: extraFields.aids ?? '[]',
      restriction: String(extraFields.restriction ?? '0'),
      qid: extraFields.qid != null ? String(extraFields.qid) : 'undefined',
      fakeIds: extraFields.fakeIds ?? '{}',
      trust: cfg.trust,
      fakeIdsClean: String(extraFields.fakeIdsClean ?? '0'),
      dispatcher: String(extraFields.dispatcher ?? '1'),
      skip_delta: String(extraFields.skip_delta ?? '0'),
    };
    if (extraFields.dq != null) {
      fields.dq = String(extraFields.dq);
      fields.date = String(extraFields.date ?? extraFields.dq);
    }
    for (const [k, v] of Object.entries(extraFields)) {
      if (!(k in fields)) fields[k] = v == null ? '' : String(v);
    }

    const { body, contentType } = buildMultipartBody(fields);
    const url = `${baseUrl}/?m=sync&a=write&ajax=1&window_id=${encodeURIComponent(cfg.window_id)}`;
    return request('POST', url, { body, contentType });
  }

  async function assignmentUrlEncoded(params) {
    const url = `${baseUrl}/index.php?m=activity&a=assignment`;
    return request('POST', url, {
      body: toUrlEncoded(params),
      contentType: 'application/x-www-form-urlencoded',
    });
  }

  async function assignmentPacked(packed) {
    return assignmentUrlEncoded({ _ajax_json_packed_data: JSON.stringify(packed) });
  }

  function commonAssignmentContext({ pid, qid, dq, aids }) {
    return {
      __protocol: cfg.protocol,
      dv: JSON.stringify(dv),
      pid: String(pid),
      u: cfg.user,
      f: 'json',
      pids: '[]',
      aids: JSON.stringify((aids || []).map(String)),
      restriction: '0',
      qid: qid != null ? String(qid) : 'undefined',
      fakeIds: '{}',
      trust: cfg.trust,
      fakeIdsClean: '0',
      dq,
      date: dq,
    };
  }

  async function loadActivityByAid(aid, { bucketPid, date }) {
    const res = await syncWrite({
      pid: String(bucketPid),
      requestedAid: String(aid),
      requestedDate: date,
      dq: date,
      skip_delta: '0',
    });
    if (!res.ok) {
      throw new Error(`OFS UI sync load activity ${aid}: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    const activity = res.data?.delta?.Activity?.[String(aid)] || res.data?.delta?.Activity?.[aid];
    if (!activity) {
      throw new Error(`OFS UI: atividade ${aid} não retornou no delta (sessão expirada ou aid inválido).`);
    }
    const queue = res.data?.delta?.Queue;
    return { activity, queue, response: res.data, dv: { ...dv } };
  }

  async function openAssignment({ aid, bucketPid, qid, sourceDate }) {
    const params = {
      aid: String(aid),
      search_all: '0',
      search_kw: '',
      target_date: sourceDate,
      target_pid: '',
      skip_delta: '0',
      ...commonAssignmentContext({ pid: bucketPid, qid, dq: sourceDate, aids: [aid] }),
      'limitActivitiesByPool[notscheduled]': '5',
    };
    const res = await assignmentUrlEncoded(params);
    if (!res.ok) {
      throw new Error(`OFS UI assignment open: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    return res.data;
  }

  async function listProvidersForMove({ bucketPid, sourceDate, targetDate, aid, searchKw = '' }) {
    const packed = {
      pid: parseInt(String(bucketPid), 10),
      listType: 'providers',
      target_date: targetDate,
      get_data: true,
      search_all: 1,
      search_kw: searchKw,
      aid: { [String(aid)]: { pid: parseInt(String(bucketPid), 10), date: sourceDate } },
    };
    if (targetDate !== sourceDate) packed.get_optimals = 1;
    const res = await assignmentPacked(packed);
    if (!res.ok) {
      throw new Error(`OFS UI list providers: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    return res.data;
  }

  async function moveActivityToTechnician({ bucketPid, techPid, sourceDate, targetDate, aid, prev = 0 }) {
    const packed = {
      pid: parseInt(String(bucketPid), 10),
      listType: 'providers',
      target_date: targetDate,
      get_data: false,
      form_submitted: true,
      target_pid: parseInt(String(techPid), 10),
      moving_activities: [
        {
          aid: parseInt(String(aid), 10),
          prev: parseInt(String(prev), 10),
          date: sourceDate,
          pid: parseInt(String(bucketPid), 10),
        },
      ],
    };
    const res = await assignmentPacked(packed);
    if (!res.ok || res.data?.result !== 'success') {
      throw new Error(
        `OFS UI move aid=${aid} → pid=${techPid}: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 240)}`,
      );
    }
    console.log(`[OFS-UI] atividade ${aid} movida para pid ${techPid} em ${targetDate}`);
    return res.data;
  }

  async function loadTechnicianRoute({ techPid, targetDate, aid }) {
    const res = await syncWrite({
      pid: String(techPid),
      requestedAid: String(aid),
      requestedDate: targetDate,
      dq: targetDate,
      skip_delta: '0',
    });
    if (!res.ok) {
      throw new Error(`OFS UI sync tech route: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    const activity = res.data?.delta?.Activity?.[String(aid)];
    const queue = res.data?.delta?.Queue;
    return { activity, queue, response: res.data };
  }

  function listActivitiesFromDelta(data) {
    const raw = data?.delta?.Activity;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw).map(([k, v]) => ({ ...v, aid: v.aid ?? k }));
  }

  function buildQueueTimestamps() {
    const nowLocal = nowDateTimeInTimeZone();
    const timestampUTC = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date())
      .reduce((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    const utcStr = `${timestampUTC.year}-${timestampUTC.month}-${timestampUTC.day} ${timestampUTC.hour}:${timestampUTC.minute}:${timestampUTC.second}`;
    return { nowLocal, utcStr };
  }

  function findMealActivity(activities = []) {
    return activities.find((a) => {
      const st = String(a.astatus || a.status || '').toLowerCase();
      if (/cancel|complete|conclu/i.test(st)) return false;
      if (String(a.aworktype) === (process.env.OFS_UI_MEAL_WORKTYPE || '2')) return true;
      const label = [a.atype, a.activityType, a.activityTypeLabel, a.appt_number, a.title].join(' ');
      return /refei/i.test(label);
    });
  }

  async function loadTechnicianDay({ techPid, targetDate }) {
    const res = await syncWrite({
      pid: String(techPid),
      requestedAid: '',
      requestedDate: targetDate,
      dq: targetDate,
      skip_delta: '0',
    });
    if (!res.ok) {
      throw new Error(`OFS UI sync tech day: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    const activities = listActivitiesFromDelta(res.data);
    const queue = res.data?.delta?.Queue;
    return { activities, queue, response: res.data };
  }

  async function searchActivityByApptNumber(apptNumber) {
    const ordem = String(apptNumber || '').trim();
    if (!ordem) return null;
    const body = new URLSearchParams({
      from: '',
      size: '60',
      'searchFields[164]': 'true',
      'searchFields[170]': 'false',
      'searchFields[640]': 'true',
      'searchFields[cname]': 'true',
      'searchFields[appt_number]': 'true',
      'searchFields[caddress]': 'false',
      searchValue: ordem,
      searchDate: 'at_all',
      skip_delta: '0',
      __protocol: cfg.protocol || '7',
      dv: JSON.stringify(dv),
      pid: '0',
      u: cfg.user,
      f: 'json',
      pids: '[]',
      aids: '[]',
      restriction: '0',
      fakeIds: '{}',
      trust: cfg.trust,
      fakeIdsClean: '0',
      'limitActivitiesByPool[notscheduled]': '5',
    }).toString();
    const url = `${baseUrl}/index.php?m=search&a=search`;
    const res = await request('POST', url, {
      body,
      contentType: 'application/x-www-form-urlencoded',
      log: true,
    });
    if (!res.ok) {
      throw new Error(`OFS UI search: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    const data = res.data;
    const block = Array.isArray(data) ? data.find((x) => x.key === 'appt_number') : null;
    return block?.value?.rows?.[0] || null;
  }

  async function pollActivityByApptNumber(apptNumber, options = {}) {
    const { delay } = require('../helpers/waitHelper.js');
    const maxTries = Math.max(
      1,
      parseInt(String(process.env.OFS_ACTIVITY_POLL_MAX_TRIES || options.maxTries || '24').trim(), 10) || 24,
    );
    const retryMs = Math.max(
      1000,
      parseInt(String(process.env.OFS_ACTIVITY_POLL_MS || options.retryMs || '10000').trim(), 10) || 10000,
    );
    for (let i = 1; i <= maxTries; i += 1) {
      const hit = await searchActivityByApptNumber(apptNumber);
      if (hit?.aid) {
        console.log(
          `[OFS-UI] atividade encontrada (tentativa ${i}/${maxTries}): aid=${hit.aid} pid=${hit.pid} date=${hit.date}`,
        );
        return hit;
      }
      if (i < maxTries) {
        console.log(
          `[OFS-UI] ordem ${apptNumber} ainda não no OFS (${i}/${maxTries}) — aguardando ${retryMs}ms`,
        );
        await delay(retryMs);
      }
    }
    return null;
  }

  async function enqueueQueueAction({
    techPid,
    targetDate,
    aids,
    qid,
    actionName,
    actionCode,
    queueAId,
    queueData,
    requestedAid = '',
    skipDelta = '0',
  }) {
    const res = await syncWrite({
      pid: String(techPid),
      aids: JSON.stringify((aids || []).map(String)),
      qid: qid != null ? String(qid) : 'undefined',
      dq: targetDate,
      date: targetDate,
      requestedAid: requestedAid != null ? String(requestedAid) : '',
      requestedDate: targetDate,
      skip_delta: String(skipDelta),
      dv: JSON.stringify(dv),
      'queue[0][t]': 'main',
      'queue[0][s]': String(actionCode),
      'queue[0][an]': actionName,
      'queue[0][rId]': `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      'queue[0][aId]': String(queueAId),
      'queue[0][re]': '[]',
      'queue[0][d]': JSON.stringify(queueData),
    });

    if (!res.ok) {
      throw new Error(`OFS UI ${actionName}: HTTP ${res.status} ${String(res.text).slice(0, 240)}`);
    }
    const queueErr = res.data?.sync?.queue?.find?.((q) => q && q.code != null && q.code !== 0);
    if (queueErr?.message) {
      throw new Error(`OFS UI ${actionName}: ${queueErr.message}`);
    }
    console.log(`[OFS-UI] ação ${actionName} enfileirada (aids=${JSON.stringify(aids)})`);
    return res.data;
  }

  async function prepareTechnicianActivity({ techPid, targetDate, aid, qid }) {
    await syncWrite({
      pid: String(techPid),
      requestedAid: String(aid),
      requestedDate: targetDate,
      dq: targetDate,
      skip_delta: '0',
    });
    await syncWrite({
      pid: String(techPid),
      aids: JSON.stringify([String(aid)]),
      qid: String(qid),
      dq: targetDate,
      date: targetDate,
      requestedAid: String(aid),
      requestedDate: targetDate,
      skip_delta: '0',
    });
  }

  async function enqueueMobileAction({
    techPid,
    targetDate,
    aid,
    qid,
    actionName,
    actionCode,
    aworktype = '6',
    queueAId = process.env.OFS_UI_QUEUE_AID || '7',
    queuePayloadExtra = {},
  }) {
    const { nowLocal, utcStr } = buildQueueTimestamps();
    const queueData = {
      items: {
        __protocol: '3.0',
        set_action_time: queuePayloadExtra.set_action_time || nowLocal,
        aid: String(aid),
        aworktype: String(aworktype),
        temporary_aid: String(aid),
        ...queuePayloadExtra.itemsExtra,
      },
      date: targetDate,
      timestamp: nowLocal,
      timestampUTC: queuePayloadExtra.timestampUTC || utcStr,
      tabId: null,
      ownerItemPid: parseInt(String(techPid), 10),
      ...queuePayloadExtra.queueRootExtra,
    };

    return enqueueQueueAction({
      techPid,
      targetDate,
      aids: [aid],
      qid,
      actionName,
      actionCode,
      queueAId,
      queueData,
      requestedAid: aid,
      skipDelta: '0',
    });
  }

  async function activateTechnicianRoute({ techPid, targetDate }) {
    const queuePlaceholder = process.env.OFS_UI_QUEUE_PLACEHOLDER_AID || '-1465';
    const loaded = await loadTechnicianDay({ techPid, targetDate });
    const { nowLocal, utcStr } = buildQueueTimestamps();
    const queueData = {
      items: { set_action_time: nowLocal },
      queueDate: targetDate,
      timestamp: nowLocal,
      timestampUTC: utcStr,
      tabId: null,
      ownerItemPid: parseInt(String(techPid), 10),
    };

    try {
      const activateData = await enqueueQueueAction({
        techPid,
        targetDate,
        aids: [queuePlaceholder],
        qid: '0',
        actionName: process.env.OFS_UI_ACTIVATE_ACTION_NAME || 'mobile_activate_queue',
        actionCode: process.env.OFS_UI_ACTIVATE_ACTION_CODE || '253',
        queueAId: process.env.OFS_UI_ACTIVATE_QUEUE_AID || '9',
        queueData,
        requestedAid: '',
      });
      const newQid =
        activateData?.delta?.Queue?.qid ??
        activateData?.sync?.queue?.find?.((q) => q?.qid != null)?.qid ??
        loaded.queue?.qid ??
        '0';
      const after = await syncWrite({
        pid: String(techPid),
        aids: JSON.stringify([queuePlaceholder]),
        qid: String(newQid),
        dq: targetDate,
        date: targetDate,
        requestedAid: '',
        requestedDate: targetDate,
        skip_delta: '1',
      });
      const queue = after.data?.delta?.Queue || activateData?.delta?.Queue || loaded.queue;
      console.log('[OFS-UI] rota do técnico ativada');
      return { ativada: true, mensagem: 'Rota ativada', queue };
    } catch (err) {
      if (/já|already|ativad|was activated/i.test(String(err.message))) {
        console.log('[OFS-UI] rota já estava ativa');
        return { ativada: false, mensagem: 'Rota já estava ativa', queue: loaded.queue };
      }
      throw err;
    }
  }

  async function cancelMealIfExists({ techPid, targetDate }) {
    const loaded = await loadTechnicianDay({ techPid, targetDate });
    const meal = findMealActivity(loaded.activities);
    if (!meal) {
      console.log('[OFS-UI] sem tarefa Refeição na rota');
      return { cancelada: false, mensagem: 'Sem tarefa Refeição no técnico' };
    }

    const aid = String(meal.aid);
    let qid = loaded.queue?.qid;
    const templateId = String(meal.a_templateid || process.env.OFS_UI_MEAL_TEMPLATE_ID || '1465');
    const aworktype = String(meal.aworktype || process.env.OFS_UI_MEAL_WORKTYPE || '2');

    await syncWrite({
      pid: String(techPid),
      requestedAid: aid,
      requestedDate: targetDate,
      dq: targetDate,
      skip_delta: '0',
    });
    await prepareTechnicianActivity({ techPid, targetDate, aid, qid });

    const { nowLocal, utcStr } = buildQueueTimestamps();
    await enqueueQueueAction({
      techPid,
      targetDate,
      aids: [aid],
      qid,
      actionName: process.env.OFS_UI_CANCEL_ACTION_NAME || 'mobile_cancel_activity',
      actionCode: process.env.OFS_UI_CANCEL_ACTION_CODE || '309',
      queueAId: process.env.OFS_UI_CANCEL_QUEUE_AID || '10',
      queueData: {
        items: { __protocol: '3.0', aid, aworktype, temporary_aid: aid },
        date: targetDate,
        a_templateid: templateId,
        timestamp: nowLocal,
        timestampUTC: utcStr,
        tabId: null,
        ownerItemPid: parseInt(String(techPid), 10),
      },
      requestedAid: aid,
    });
    const refreshed = await refreshTechnicianActivity({ techPid, targetDate, aid, qid });
    qid = refreshed.data?.delta?.Queue?.qid || qid;
    console.log(`[OFS-UI] refeição aid=${aid} cancelada`);
    return { cancelada: true, aid, mensagem: 'Refeição cancelada', qid };
  }

  /** Ativar rota + cancelar refeição (pré-requisito antes de mover ordem para o técnico). */
  async function prepareTechnicianRouteForWork({ techPid, targetDate }) {
    const rota = await activateTechnicianRoute({ techPid, targetDate });
    const refeicao = await cancelMealIfExists({ techPid, targetDate });
    return { rota, refeicao };
  }

  async function refreshTechnicianActivity({ techPid, targetDate, aid, qid }) {
    return syncWrite({
      pid: String(techPid),
      aids: JSON.stringify([String(aid)]),
      qid: String(qid),
      dq: targetDate,
      date: targetDate,
      requestedAid: String(aid),
      requestedDate: targetDate,
      skip_delta: '1',
    });
  }

  async function startActivityMobile({ techPid, targetDate, aid, qid, aworktype }) {
    await prepareTechnicianActivity({ techPid, targetDate, aid, qid });
    const data = await enqueueMobileAction({
      techPid,
      targetDate,
      aid,
      qid,
      actionName: 'mobile_start_activity',
      actionCode: process.env.OFS_UI_START_ACTION_CODE || '324',
      aworktype,
      queueAId: process.env.OFS_UI_START_QUEUE_AID || '7',
    });
    await refreshTechnicianActivity({ techPid, targetDate, aid, qid });
    return data;
  }

  async function completeActivityMobile({ techPid, targetDate, aid, qid, aworktype }) {
    await prepareTechnicianActivity({ techPid, targetDate, aid, qid });
    const data = await enqueueMobileAction({
      techPid,
      targetDate,
      aid,
      qid,
      actionName: process.env.OFS_UI_COMPLETE_ACTION_NAME || 'mobile_end_activity',
      actionCode: process.env.OFS_UI_COMPLETE_ACTION_CODE || '325',
      aworktype,
      queueAId: process.env.OFS_UI_COMPLETE_QUEUE_AID || process.env.OFS_UI_QUEUE_AID || '7',
    });
    await refreshTechnicianActivity({ techPid, targetDate, aid, qid });
    return data;
  }

  return {
    config: cfg,
    getDv: () => ({ ...dv }),
    syncWrite,
    assignmentPacked,
    loadActivityByAid,
    openAssignment,
    listProvidersForMove,
    moveActivityToTechnician,
    loadTechnicianRoute,
    loadTechnicianDay,
    activateTechnicianRoute,
    cancelMealIfExists,
    prepareTechnicianRouteForWork,
    prepareTechnicianActivity,
    refreshTechnicianActivity,
    startActivityMobile,
    completeActivityMobile,
    enqueueMobileAction,
    enqueueQueueAction,
    findMealActivity,
    searchActivityByApptNumber,
    pollActivityByApptNumber,
  };
}

module.exports = { createOfsUiApiClient, buildMultipartBody };
