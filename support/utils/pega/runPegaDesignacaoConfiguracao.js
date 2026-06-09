const { parseObterDadosOrdemResponse, extractOrdemServicoOsFromItem } = require('./obterDadosOrdem.js');
const { buildDesignarFacilidadeDadosBody } = require('./designarFacilidadeDadosPayload.js');
const { buildConfigurarDadosBody } = require('./configurarDadosPayload.js');
const { buildConfiguracaoDeRedeBody } = require('./configuracaoDeRedePayload.js');
const { buildConfigurarEvcBody } = require('./configurarEvcPayload.js');
const { buildValidarExecucaoTecnicaRefreshBody } = require('./validarExecucaoTecnicaPayload.js');
const {
  buildSelecaoDePeriodoBody,
  buildSelecaoDoSlotRefreshBody,
  buildSelecaoDoSlotConfirmBody,
  extractAgendamentoSlotsFromApiJson,
  extractAgendamentoSlotsFromObterDadosItem,
} = require('./selecaoAgendamentoPayload.js');
const { logPegaCurl, logPegaResponse } = require('./pegaLogging.js');
const { delay } = require('../helpers/waitHelper.js');

/**
 * Link Dedicado: obterdadosordem pode voltar [] até o caso existir no PEGA — repetir GET.
 * Depois do 1º sucesso, opcionalmente exige pzInsKey igual a expectedChaveCaseOrdem.
 */
async function fetchObterDadosOrdemWithRetry(getObterDadosOrdemFn, parseOpts, options = {}) {
  const {
    isLinkDedicated = false,
    logTag = '',
    requireFull = false,
    expectedChaveCaseOrdem = null,
    maxTriesOverride = null,
    retryMsOverride = null,
  } = options;
  const defaultMaxTries = Math.max(
    1,
    parseInt(String(process.env.PEGA_OBTER_DADOS_EMPTY_MAX_TRIES || '10').trim(), 10) || 10,
  );
  const maxTries = isLinkDedicated
    ? Math.max(1, maxTriesOverride != null ? parseInt(String(maxTriesOverride).trim(), 10) || defaultMaxTries : defaultMaxTries)
    : 1;
  const defaultRetryMs = Math.max(
    0,
    parseInt(String(process.env.PEGA_OBTER_DADOS_EMPTY_RETRY_MS || '2500').trim(), 10) || 2500,
  );
  const retryMs =
    retryMsOverride != null
      ? Math.max(0, parseInt(String(retryMsOverride).trim(), 10) || 0)
      : defaultRetryMs;

  const classifyBad = (parsed, data) => {
    const empty = !Array.isArray(data) || data.length === 0;
    if (empty) return { bad: true, reason: '[]' };
    if (!parsed?.pyMemo) return { bad: true, reason: 'sem pyMemo' };
    if (requireFull && !parsed.chaveCaseOrdem) return { bad: true, reason: 'sem ChaveCaseOrdem' };
    const exp = expectedChaveCaseOrdem != null ? String(expectedChaveCaseOrdem).trim() : '';
    if (exp && !parsed.chaveCaseOrdem) return { bad: true, reason: 'sem ChaveCaseOrdem (esperado casar)' };
    if (exp && parsed.chaveCaseOrdem && String(parsed.chaveCaseOrdem).trim() !== exp) {
      return { bad: true, reason: 'ChaveCaseOrdem divergente' };
    }
    return { bad: false, reason: '' };
  };

  let last = null;
  let parsed = null;
  for (let i = 1; i <= maxTries; i++) {
    last = await getObterDadosOrdemFn();
    if (!last.res.ok) {
      return { ...last, parsed: null };
    }
    parsed = parseObterDadosOrdemResponse(last.data, parseOpts);
    const { bad, reason } = classifyBad(parsed, last.data);
    if (!bad) {
      return { ...last, parsed };
    }
    if (!isLinkDedicated || i === maxTries) {
      return { ...last, parsed };
    }
    const prefix = logTag ? ` ${logTag}` : '';
    console.log(`[PEGA]${prefix} obterdadosordem (${i}/${maxTries}): ${reason} — aguardando ${retryMs}ms`);
    await delay(retryMs);
  }
  return { ...last, parsed };
}

/** OAuth (1) no script + passos 2–13 + Agendamento 14–19 quando IsEmAgendamento (fluxo-pega.txt). */
const PEGA_TOTAL_STEPS = 19;
/** VPN: +2 passos após 1º GET (PATCH ConfiguracaoDeRede + GET pyMemo). */
const PEGA_TOTAL_STEPS_VPN = 21;

function getPegaTotalSteps(flowVariant) {
  return flowVariant === 'vpn' ? PEGA_TOTAL_STEPS_VPN : PEGA_TOTAL_STEPS;
}

/** IP Connect e Link Dedicado usam a mesma contagem de passos (VPN tem +2). */
function isLinkDedicatedFlow(flowVariant) {
  return flowVariant === 'linkDedicated';
}

const CASE_VIEW_REFRESH_BODY = JSON.stringify({
  content: {},
  pageInstructions: [],
  interestPage: '',
});

function buildAssignmentPath(chaveCaseOrdem, actionName) {
  const key = `ASSIGN-WORKBASKET ${chaveCaseOrdem}!DESIGNACAOECONFIGURACAO_FLOW`;
  return `/prweb/api/application/v2/assignments/${encodeURIComponent(key)}/actions/${actionName}`;
}

function buildValidacaoRefreshPaths(chaveCaseOrdem) {
  const key = `ASSIGN-WORKBASKET ${chaveCaseOrdem}!VALIDACAOTECNICA_FLOW`;
  const enc = encodeURIComponent(key);
  return [
    `/prweb/api/application/v2/assignments/${enc}/actions/ValidarExecucaoTecnica/refresh`,
    `/prweb/app/fulfillment/api/application/v2/assignments/${enc}/actions/ValidarExecucaoTecnica/refresh`,
  ];
}

function buildValidacaoViewTypeFormPath(chaveCaseOrdem) {
  const key = `ASSIGN-WORKBASKET ${chaveCaseOrdem}!VALIDACAOTECNICA_FLOW`;
  const enc = encodeURIComponent(key);
  return `/prweb/app/fulfillment/api/application/v2/assignments/${enc}/actions/ValidarExecucaoTecnica?viewType=form`;
}

function buildAgendamentoActionPaths(chaveCaseOrdem, actionFragment) {
  const key = `ASSIGN-WORKBASKET ${chaveCaseOrdem}!AGENDAMENTO_FLOW`;
  const enc = encodeURIComponent(key);
  return [
    `/prweb/app/fulfillment/api/application/v2/assignments/${enc}/actions/${actionFragment}`,
    `/prweb/api/application/v2/assignments/${enc}/actions/${actionFragment}`,
  ];
}

/** PATCH .../cases/{id}/views/{viewName}/refresh (fluxo-pega ~2776, ~3081). */
function buildCaseViewRefreshPaths(chaveCaseOrdem, viewName) {
  const enc = encodeURIComponent(chaveCaseOrdem);
  return [
    `/prweb/app/fulfillment/api/application/v2/cases/${enc}/views/${viewName}/refresh`,
    `/prweb/api/application/v2/cases/${enc}/views/${viewName}/refresh`,
  ];
}

function buildConfiguracaoDeRedePaths(chaveCaseOrdem) {
  const key = `ASSIGN-WORKBASKET ${chaveCaseOrdem}!CONFIGURACAODEREDE`;
  const enc = encodeURIComponent(key);
  return [
    `/prweb/api/application/v2/assignments/${enc}/actions/ConfiguracaoDeRede`,
    `/prweb/app/fulfillment/api/application/v2/assignments/${enc}/actions/ConfiguracaoDeRede`,
  ];
}

function buildConfigurarEvcPaths(chaveCaseOrdem) {
  const key = `ASSIGN-WORKBASKET ${chaveCaseOrdem}!CONFIGURACAOEVC_FLOW`;
  const enc = encodeURIComponent(key);
  return [
    `/prweb/api/application/v2/assignments/${enc}/actions/ConfigurarEvc`,
    `/prweb/app/fulfillment/api/application/v2/assignments/${enc}/actions/ConfigurarEvc`,
  ];
}

function pyMemoFromAssignmentResponse(data) {
  try {
    const c = data?.data?.caseInfo?.content ?? data?.data?.data?.caseInfo?.content;
    return c?.pyMemo != null ? String(c.pyMemo).trim() : null;
  } catch (_) {
    return null;
  }
}

/** 404 em ConfiguracaoDeRede quando o fluxo CONFIGURACAODEREDE ainda não está no ATV desta perna (chegou primeiro na outra ponta). */
function isPegaAssignmentNotFound404(status, text) {
  if (status !== 404) return false;
  const t = String(text || '');
  return (
    t.includes('Assignment_Not_Found') ||
    t.includes('Assignment not found') ||
    t.includes('Assignment not found for the given parameter') ||
    /resource cannot be found/i.test(t)
  );
}

/**
 * 422 ao gravar ConfiguracaoDeRede: save referencia outro ATV (irmão) que ainda não existe em D_AtvSavable — típico race LD (ex. pyID=ATV-67059 enquanto o PATCH é no ATV-67058).
 * Tratado com GET+if-match fresco e/ou fallback na outra perna.
 */
function isPegaConfigRede422SiblingLookupError(status, text) {
  if (status !== 422) return false;
  const t = String(text || '');
  return (
    t.includes('D_AtvSavable') ||
    (t.includes('No records were found for the lookup') && /pyID\s*=\s*ATV-/i.test(t))
  );
}

async function patchCaseViewsForChave(root, headersJson, fetchImpl, chaveCaseOrdem, viewName, pyMemo) {
  const paths = buildCaseViewRefreshPaths(chaveCaseOrdem, viewName);
  const hdr = { ...headersJson, 'if-match': pyMemo };
  let lastSt = 0;
  for (const p of paths) {
    const url = `${root}${p}`;
    logPegaCurl('PATCH', url, hdr, CASE_VIEW_REFRESH_BODY);
    const res = await fetchImpl(url, { method: 'PATCH', headers: hdr, body: CASE_VIEW_REFRESH_BODY });
    const text = await res.text();
    lastSt = res.status;
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {}
    logPegaResponse(`PEGA PATCH .../views/${viewName}/refresh`, res.status, data, text);
    if (res.ok) return { status: res.status, url };
    if (res.status === 404 && paths.indexOf(p) === 0) {
      console.log('[PEGA]   ↳ 404 na rota fulfillment — tentando API pública...');
      continue;
    }
    throw new Error(`PEGA cases/.../views/${viewName}/refresh: HTTP ${res.status} — ${text?.slice(0, 600)}`);
  }
  throw new Error(`PEGA cases/.../views/${viewName}/refresh falhou: HTTP ${lastSt}`);
}

/**
 * OAuth (passo 1 no script) + passos 2–13 (incl. views do caso) + 14–19 (Agendamento quando IsEmAgendamento; fluxo-pega.txt).
 */
async function runPegaDesignacaoEConfiguracao(opts) {
  const {
    ordemServico,
    baseUrl,
    bearerToken,
    cookie = '',
    fetchImpl = global.fetch,
    skipAgendamento: skipAgendamentoOpt,
    skipCaseViewRefresh: skipCaseViewRefreshOpt,
    agendamentoPeriodo,
    agendamentoSlotListIndex,
    flowVariant: flowVariantOpt,
    ldLeg: ldLegOpt,
    linkDedicatedStopAfterConfigRede: linkDedicatedStopAfterConfigRedeOpt,
    linkDedicatedConfigRedeFallbackOrdemServico: linkDedicatedConfigRedeFallbackOrdemServicoOpt,
  } = opts;

  const flowVariant =
    flowVariantOpt === 'vpn' ? 'vpn' : flowVariantOpt === 'linkDedicated' ? 'linkDedicated' : 'ip';
  const totalSteps = getPegaTotalSteps(flowVariant);
  const ldLegRaw = (ldLegOpt != null ? String(ldLegOpt) : '').trim();
  const parseObterOpts = { linkDedicado: isLinkDedicatedFlow(flowVariant) };
  if (isLinkDedicatedFlow(flowVariant)) {
    parseObterOpts.matchOrdemServico = String(ordemServico).trim();
    if (ldLegRaw) parseObterOpts.ldLeg = ldLegRaw;
  }
  let stepLog = 1;
  function logPegaStep(title, detail) {
    stepLog++;
    const d = detail ? `: ${detail}` : '';
    console.log(`[PEGA] Passo ${stepLog}/${totalSteps} — ${title}${d}`);
  }

  if (!ordemServico || !baseUrl || !bearerToken) {
    throw new Error('runPegaDesignacaoEConfiguracao: ordemServico, baseUrl e bearerToken são obrigatórios');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não disponível — use Node 18+ ou passe fetchImpl');
  }

  const root = baseUrl.replace(/\/$/, '');
  const headersAuth = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const headersJson = {
    ...headersAuth,
    'Content-Type': 'application/json',
  };

  const preFlightMs = Math.max(0, parseInt(String(process.env.PEGA_PRE_FLIGHT_MS || '0').trim(), 10) || 0);
  if (preFlightMs > 0 && isLinkDedicatedFlow(flowVariant)) {
    console.log(`[PEGA] PEGA_PRE_FLIGHT_MS=${preFlightMs} — aguardando antes do primeiro obterdadosordem...`);
    await delay(preFlightMs);
  }

  async function getObterDadosOrdem() {
    const q = `${root}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(String(ordemServico).trim())}`;
    logPegaCurl('GET', q, headersAuth, null);
    const res = await fetchImpl(q, { method: 'GET', headers: headersAuth });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    logPegaResponse(`PEGA GET ${q.replace(root, '')}`, res.status, data, text);
    return { res, text, data };
  }

  async function patchCaseViewRefresh(viewName, pyMemo) {
    const paths = buildCaseViewRefreshPaths(parsed1.chaveCaseOrdem, viewName);
    const hdr = { ...headersJson, 'if-match': pyMemo };
    let lastSt = 0;
    for (const p of paths) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdr, CASE_VIEW_REFRESH_BODY);
      const res = await fetchImpl(url, { method: 'PATCH', headers: hdr, body: CASE_VIEW_REFRESH_BODY });
      const text = await res.text();
      lastSt = res.status;
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {}
      logPegaResponse(`PEGA PATCH .../views/${viewName}/refresh`, res.status, data, text);
      if (res.ok) {
        return { status: res.status, url };
      }
      if (res.status === 404 && paths.indexOf(p) === 0) {
        console.log('[PEGA]   ↳ 404 na rota fulfillment — tentando API pública...');
        continue;
      }
      throw new Error(`PEGA cases/.../views/${viewName}/refresh: HTTP ${res.status} — ${text?.slice(0, 600)}`);
    }
    throw new Error(`PEGA cases/.../views/${viewName}/refresh falhou: HTTP ${lastSt}`);
  }

  // Passo 2
  logPegaStep('GET APIOrdemDeServico/obterdadosordem', `ORDEMSERVICO=${String(ordemServico).trim()}`);
  const first = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(inicial)',
    requireFull: true,
  });
  if (!first.res.ok) {
    throw new Error(`PEGA obterdadosordem: HTTP ${first.res.status} — ${first.text?.slice(0, 500)}`);
  }
  let parsed1 = first.parsed;
  if (!parsed1?.pyMemo || !parsed1.chaveCaseOrdem) {
    throw new Error('PEGA: não foi possível obter pyMemo/ChaveCaseOrdem do obterdadosordem');
  }
  console.log(
    '[PEGA]   Caso ativação: ChaveCaseOrdem=' +
      parsed1.chaveCaseOrdem +
      ', pyMemo=' +
      parsed1.pyMemo +
      ', CaseID=' +
      (parsed1.caseId || '—'),
  );

  if (flowVariant === 'vpn') {
    logPegaStep('PATCH assignment ConfiguracaoDeRede', 'CONFIGURACAODEREDE; if-match = pyMemo (VPN)');
    const bodyCfgRede = buildConfiguracaoDeRedeBody();
    const pathsCfgRede = buildConfiguracaoDeRedePaths(parsed1.chaveCaseOrdem);
    const hdrCfgRede = { ...headersJson, 'if-match': parsed1.pyMemo };
    let resCfgRede = null;
    let textCfgRede = '';
    let lastCfg = 0;
    for (const p of pathsCfgRede) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdrCfgRede, JSON.stringify(bodyCfgRede));
      resCfgRede = await fetchImpl(url, {
        method: 'PATCH',
        headers: hdrCfgRede,
        body: JSON.stringify(bodyCfgRede),
      });
      textCfgRede = await resCfgRede.text();
      lastCfg = resCfgRede.status;
      let dataCfgRede = null;
      try {
        dataCfgRede = textCfgRede ? JSON.parse(textCfgRede) : null;
      } catch (_) {}
      logPegaResponse(`PEGA PATCH .../ConfiguracaoDeRede`, resCfgRede.status, dataCfgRede, textCfgRede);
      if (resCfgRede.ok) break;
      if (resCfgRede.status === 404 && pathsCfgRede.indexOf(p) === 0) {
        console.log('[PEGA]   ↳ 404 na rota API pública — tentando fulfillment...');
        continue;
      }
      throw new Error(`PEGA ConfiguracaoDeRede: HTTP ${resCfgRede.status} — ${textCfgRede?.slice(0, 800)}`);
    }
    if (!resCfgRede?.ok) {
      throw new Error(`PEGA ConfiguracaoDeRede falhou: HTTP ${lastCfg}`);
    }

    logPegaStep('GET obterdadosordem', 'atualizar pyMemo após ConfiguracaoDeRede (VPN)');
    const afterCfgRede = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
      isLinkDedicated: isLinkDedicatedFlow(flowVariant),
      logTag: '(pós-ConfiguracaoDeRede VPN)',
      expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
    });
    if (!afterCfgRede.res.ok) {
      throw new Error(`PEGA obterdadosordem (pós-ConfiguracaoDeRede): HTTP ${afterCfgRede.res.status}`);
    }
    const parsedAfterCfg = afterCfgRede.parsed;
    if (!parsedAfterCfg?.pyMemo) {
      throw new Error('PEGA: pyMemo ausente após ConfiguracaoDeRede (VPN)');
    }
    parsed1 = {
      ...parsed1,
      pyMemo: parsedAfterCfg.pyMemo,
      item: parsedAfterCfg.item,
    };
    console.log('[PEGA]   pyMemo pós-ConfiguracaoDeRede (VPN): ' + parsed1.pyMemo);
  }

  const pathDesignar = buildAssignmentPath(parsed1.chaveCaseOrdem, 'DesignarFacilidadeDados');
  const pathConfig = buildAssignmentPath(parsed1.chaveCaseOrdem, 'ConfigurarDados');

  // Passo 3
  logPegaStep('PATCH assignment DesignarFacilidadeDados', 'if-match = pyMemo');
  const bodyDesignar = buildDesignarFacilidadeDadosBody({
    includeEnderecamentoIp: !isLinkDedicatedFlow(flowVariant),
  });
  const urlDesignar = `${root}${pathDesignar}`;
  const hdrDesignar = { ...headersJson, 'if-match': parsed1.pyMemo };
  logPegaCurl('PATCH', urlDesignar, hdrDesignar, JSON.stringify(bodyDesignar));
  const resDesignar = await fetchImpl(urlDesignar, {
    method: 'PATCH',
    headers: hdrDesignar,
    body: JSON.stringify(bodyDesignar),
  });
  const textDesignar = await resDesignar.text();
  let dataDesignar = null;
  try {
    dataDesignar = textDesignar ? JSON.parse(textDesignar) : null;
  } catch (_) {}
  logPegaResponse(`PEGA PATCH .../DesignarFacilidadeDados`, resDesignar.status, dataDesignar, textDesignar);
  if (!resDesignar.ok) {
    throw new Error(`PEGA DesignarFacilidadeDados: HTTP ${resDesignar.status} — ${textDesignar?.slice(0, 800)}`);
  }

  // Passo 4
  logPegaStep('GET obterdadosordem', 'atualizar pyMemo após DesignarFacilidadeDados');
  const second = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(pós-Designar)',
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!second.res.ok) {
    throw new Error(`PEGA obterdadosordem (2): HTTP ${second.res.status} — ${second.text?.slice(0, 500)}`);
  }
  const parsed2 = second.parsed;
  if (!parsed2?.pyMemo) {
    throw new Error('PEGA: pyMemo ausente após DesignarFacilidadeDados');
  }
  console.log('[PEGA]   pyMemo para ConfigurarDados: ' + parsed2.pyMemo);

  // Passo 5
  logPegaStep('PATCH assignment ConfigurarDados', 'Encaminhar → Ativ Física; if-match = pyMemo');
  const bodyConfig = buildConfigurarDadosBody();
  const urlConfig = `${root}${pathConfig}`;
  const hdrConfig = { ...headersJson, 'if-match': parsed2.pyMemo };
  logPegaCurl('PATCH', urlConfig, hdrConfig, JSON.stringify(bodyConfig));
  const resConfig = await fetchImpl(urlConfig, {
    method: 'PATCH',
    headers: hdrConfig,
    body: JSON.stringify(bodyConfig),
  });
  const textConfig = await resConfig.text();
  let dataConfig = null;
  try {
    dataConfig = textConfig ? JSON.parse(textConfig) : null;
  } catch (_) {}
  logPegaResponse(`PEGA PATCH .../ConfigurarDados`, resConfig.status, dataConfig, textConfig);
  if (!resConfig.ok) {
    throw new Error(`PEGA ConfigurarDados: HTTP ${resConfig.status} — ${textConfig?.slice(0, 800)}`);
  }

  let pyStatusWork = null;
  try {
    pyStatusWork = dataConfig?.data?.caseInfo?.content?.pyStatusWork ?? null;
  } catch (_) {}

  // Passo 6 — fluxo-pega: GET novamente antes da Validação Técnica
  logPegaStep('GET obterdadosordem', 'pyMemo para Validação Técnica (Pending-AtivacaoFisica)');
  const third = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(pré-Validação Técnica)',
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!third.res.ok) {
    throw new Error(`PEGA obterdadosordem (3): HTTP ${third.res.status} — ${third.text?.slice(0, 500)}`);
  }
  let parsed3 = third.parsed;
  if (!parsed3?.pyMemo) {
    throw new Error('PEGA: pyMemo ausente antes de ValidarExecucaoTecnica');
  }
  console.log('[PEGA]   pyMemo (após ConfigurarDados / pré-validação): ' + parsed3.pyMemo);

  const ldStopAfterConfigRede =
    isLinkDedicatedFlow(flowVariant) && linkDedicatedStopAfterConfigRedeOpt === true;

  if (ldStopAfterConfigRede) {
    const fallbackOsRaw =
      linkDedicatedConfigRedeFallbackOrdemServicoOpt != null
        ? String(linkDedicatedConfigRedeFallbackOrdemServicoOpt).trim()
        : '';

    async function patchConfigRedeTwoRoutes(chaveCaseOrdem, pyMemo, logLabel) {
      const bodyCfg = buildConfiguracaoDeRedeBody();
      const pathsCfg = buildConfiguracaoDeRedePaths(chaveCaseOrdem);
      const hdrCfg = { ...headersJson, 'if-match': pyMemo };
      let lastRes = null;
      let lastText = '';
      const okShape = (extra) => ({ assignmentMissing: false, siblingLookup422: false, ...extra });
      for (const p of pathsCfg) {
        const url = `${root}${p}`;
        logPegaCurl('PATCH', url, hdrCfg, JSON.stringify(bodyCfg));
        lastRes = await fetchImpl(url, {
          method: 'PATCH',
          headers: hdrCfg,
          body: JSON.stringify(bodyCfg),
        });
        lastText = await lastRes.text();
        let dataCfg = null;
        try {
          dataCfg = lastText ? JSON.parse(lastText) : null;
        } catch (_) {}
        logPegaResponse(`PEGA PATCH .../ConfiguracaoDeRede (${logLabel})`, lastRes.status, dataCfg, lastText);
        if (lastRes.ok) {
          return okShape({ ok: true, status: lastRes.status });
        }
        if (lastRes.status === 404 && pathsCfg.indexOf(p) === 0) {
          console.log('[PEGA]   ↳ 404 na rota API pública — tentando fulfillment...');
          continue;
        }
        if (lastRes.status === 404 && isPegaAssignmentNotFound404(lastRes.status, lastText)) {
          return okShape({ ok: false, status: lastRes.status, assignmentMissing: true });
        }
        if (isPegaConfigRede422SiblingLookupError(lastRes.status, lastText)) {
          return okShape({ ok: false, status: lastRes.status, siblingLookup422: true });
        }
        throw new Error(`PEGA LD ConfiguracaoDeRede (${logLabel}): HTTP ${lastRes.status} — ${lastText?.slice(0, 800)}`);
      }
      if (lastRes?.status === 404 && isPegaAssignmentNotFound404(lastRes.status, lastText)) {
        return okShape({ ok: false, status: lastRes.status, assignmentMissing: true });
      }
      throw new Error(`PEGA LD ConfiguracaoDeRede (${logLabel}) falhou: HTTP ${lastRes?.status ?? '?'}`);
    }

    logPegaStep(
      'PATCH assignment ConfiguracaoDeRede',
      'LD: CONFIGURACAODEREDE — Ponta A; 404 assignment → B; 422 D_AtvSavable → retries GET+PATCH e depois B se houver ORDEMSERVICO B',
    );

    let configRedeStatus = null;
    let configRedeLeg = null;

    const maxSiblingRounds = Math.max(
      1,
      parseInt(String(process.env.PEGA_LD_CONFIG_REDE_SIBLING_MAX_ROUNDS || '5').trim(), 10) || 5,
    );
    const siblingRetryMs = Math.max(
      0,
      parseInt(String(process.env.PEGA_LD_CONFIG_REDE_SIBLING_RETRY_MS || '4000').trim(), 10) || 4000,
    );

    let tryA = await patchConfigRedeTwoRoutes(parsed1.chaveCaseOrdem, parsed3.pyMemo, 'LD Ponta A');
    for (
      let sib = 0;
      !tryA.ok && tryA.siblingLookup422 && sib < maxSiblingRounds - 1;
      sib++
    ) {
      console.log(
        `[PEGA LD] ConfigRede 422 (D_AtvSavable / ATV irmão) — aguardando ${siblingRetryMs}ms e GET fresco Ponta A (tentativa ${sib + 2}/${maxSiblingRounds})`,
      );
      if (siblingRetryMs > 0) {
        await delay(siblingRetryMs);
      }
      const refreshA = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
        isLinkDedicated: true,
        logTag: '(LD ConfigRede retry irmão ATV)',
        expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
      });
      if (!refreshA.res.ok) {
        throw new Error(`PEGA obterdadosordem (ConfigRede retry irmão): HTTP ${refreshA.res.status}`);
      }
      if (!refreshA.parsed?.pyMemo) {
        throw new Error('PEGA: pyMemo ausente no GET após 422 D_AtvSavable (Ponta A)');
      }
      parsed3 = refreshA.parsed;
      tryA = await patchConfigRedeTwoRoutes(
        parsed1.chaveCaseOrdem,
        parsed3.pyMemo,
        `LD Ponta A (irmão ${sib + 2}/${maxSiblingRounds})`,
      );
    }

    if (tryA.ok) {
      configRedeStatus = tryA.status;
      configRedeLeg = 'pontaA';
    } else if ((tryA.assignmentMissing || tryA.siblingLookup422) && fallbackOsRaw) {
      const reason = tryA.siblingLookup422
        ? 'irmão ATV ainda indisponível em D_AtvSavable na Ponta A após retentativas'
        : 'assignment não encontrado no ATV da Ponta A';
      console.log(
        `[PEGA LD] ConfigRede: ${reason} — tentando Ponta B (ORDEMSERVICO=${fallbackOsRaw})`,
      );
      const parseOptsB = { linkDedicado: true, matchOrdemServico: fallbackOsRaw, ldLeg: 'pontaB' };
      async function getObterFallbackB() {
        const q = `${root}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(fallbackOsRaw)}`;
        logPegaCurl('GET', q, headersAuth, null);
        const res = await fetchImpl(q, { method: 'GET', headers: headersAuth });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          data = null;
        }
        logPegaResponse(`PEGA GET obterdadosordem (LD ConfigRede fallback Ponta B)`, res.status, data, text);
        return { res, text, data };
      }
      const fb = await fetchObterDadosOrdemWithRetry(getObterFallbackB, parseOptsB, {
        isLinkDedicated: true,
        logTag: '(LD ConfigRede fallback Ponta B)',
        requireFull: true,
      });
      if (!fb.res.ok) {
        throw new Error(`PEGA LD ConfigRede fallback: obterdadosordem Ponta B HTTP ${fb.res.status}`);
      }
      const parsedB = fb.parsed;
      if (!parsedB?.chaveCaseOrdem || !parsedB.pyMemo) {
        throw new Error('PEGA LD ConfigRede fallback: pyMemo/ChaveCaseOrdem ausentes (Ponta B)');
      }
      let tryB = await patchConfigRedeTwoRoutes(parsedB.chaveCaseOrdem, parsedB.pyMemo, 'LD Ponta B');
      for (
        let sibB = 0;
        !tryB.ok && tryB.siblingLookup422 && sibB < maxSiblingRounds - 1;
        sibB++
      ) {
        console.log(
          `[PEGA LD] ConfigRede Ponta B 422 (D_AtvSavable) — aguardando ${siblingRetryMs}ms e GET fresco B (${sibB + 2}/${maxSiblingRounds})`,
        );
        if (siblingRetryMs > 0) {
          await delay(siblingRetryMs);
        }
        const refreshB = await fetchObterDadosOrdemWithRetry(getObterFallbackB, parseOptsB, {
          isLinkDedicated: true,
          logTag: '(LD ConfigRede retry irmão ATV Ponta B)',
          requireFull: true,
        });
        if (!refreshB.res.ok) {
          throw new Error(`PEGA obterdadosordem (ConfigRede retry B): HTTP ${refreshB.res.status}`);
        }
        if (!refreshB.parsed?.pyMemo || !refreshB.parsed?.chaveCaseOrdem) {
          throw new Error('PEGA: pyMemo/ChaveCaseOrdem ausentes no GET após 422 (Ponta B)');
        }
        tryB = await patchConfigRedeTwoRoutes(
          refreshB.parsed.chaveCaseOrdem,
          refreshB.parsed.pyMemo,
          `LD Ponta B (irmão ${sibB + 2}/${maxSiblingRounds})`,
        );
      }
      if (!tryB.ok) {
        if (tryB.assignmentMissing) {
          throw new Error(
            'PEGA LD ConfiguracaoDeRede: assignment CONFIGURACAODEREDE não encontrado nem no ATV da Ponta A nem no da Ponta B',
          );
        }
        if (tryB.siblingLookup422) {
          throw new Error(
            'PEGA LD ConfiguracaoDeRede: D_AtvSavable (ATV irmão) continua indisponível na Ponta B após retentativas — aumente PEGA_LD_CONFIG_REDE_SIBLING_* ou aguarde propagação no PEGA',
          );
        }
        throw new Error(`PEGA LD ConfiguracaoDeRede (Ponta B) falhou: HTTP ${tryB.status}`);
      }
      configRedeStatus = tryB.status;
      configRedeLeg = 'pontaB';
    } else if (tryA.assignmentMissing && !fallbackOsRaw) {
      throw new Error(
        'PEGA LD ConfiguracaoDeRede: assignment não encontrado na Ponta A; informe ordem da Ponta B no fluxo LD (fallback)',
      );
    } else if (tryA.siblingLookup422 && !fallbackOsRaw) {
      throw new Error(
        'PEGA LD ConfiguracaoDeRede: 422 D_AtvSavable (ATV irmão) na Ponta A após retentativas; informe ORDEMSERVICO Ponta B para fallback ou aumente PEGA_LD_CONFIG_REDE_SIBLING_MAX_ROUNDS / PEGA_LD_CONFIG_REDE_SIBLING_RETRY_MS',
      );
    } else {
      throw new Error(`PEGA LD ConfiguracaoDeRede (Ponta A) falhou: HTTP ${tryA.status}`);
    }

    logPegaStep(
      'GET obterdadosordem',
      'atualizar pyMemo após ConfiguracaoDeRede (LD; leg=' + configRedeLeg + ')',
    );
    const afterCfgRedeLd = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
      isLinkDedicated: true,
      logTag: `(pós-ConfiguracaoDeRede LD ${configRedeLeg})`,
      expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
    });
    if (!afterCfgRedeLd.res.ok) {
      throw new Error(`PEGA obterdadosordem (pós-ConfiguracaoDeRede LD): HTTP ${afterCfgRedeLd.res.status}`);
    }
    const parsedAfterCfgLd = afterCfgRedeLd.parsed;
    if (!parsedAfterCfgLd?.pyMemo) {
      throw new Error('PEGA: pyMemo ausente após ConfiguracaoDeRede (LD)');
    }
    parsed1 = {
      ...parsed1,
      pyMemo: parsedAfterCfgLd.pyMemo,
      item: parsedAfterCfgLd.item,
    };

    return {
      chaveCaseOrdem: parsed1.chaveCaseOrdem,
      caseId: parsed1.caseId,
      linkDedicado: true,
      pegaOrdemServicoOs: extractOrdemServicoOsFromItem(parsed1.item),
      pyStatusWork,
      pyStatusWorkAfterRefresh: null,
      pyStatusWorkAfterValidacao: null,
      designarStatus: resDesignar.status,
      configurarStatus: resConfig.status,
      configuracaoDeRedeStatus: configRedeStatus,
      configRedeLeg,
      validacaoTecnicaRefreshStatus: null,
      validacaoTecnicaFormStatus: null,
      validarExecucaoRefreshUrl: '',
      validarExecucaoFormUrl: '',
      agendamentoSkipped: true,
      agendamentoSelecaoPeriodoStatus: null,
      agendamentoSelecaoSlotRefreshStatus: null,
      agendamentoSelecaoSlotFormStatus: null,
      agendamentoSelecaoPeriodoUrl: '',
      agendamentoSelecaoSlotRefreshUrl: '',
      agendamentoSelecaoSlotFormUrl: '',
      caseViewRefreshSkipped: true,
      caseViewPyDetailsStatus: null,
      caseViewDadosPedidoStatus: null,
      caseViewPyDetailsUrl: '',
      caseViewDadosPedidoUrl: '',
      linkDedicatedStopAfterConfigRede: true,
    };
  }

  // GET colado ao refresh: após ConfigurarDados o caso pode mudar de estado; if-match antigo → 409 "not a valid action".
  logPegaStep('GET obterdadosordem', 'pyMemo imediato antes de ValidarExecucaoTecnica/refresh');
  const immediatePreValidar = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(colado ao ValidarExecucao refresh)',
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!immediatePreValidar.res.ok) {
    throw new Error(`PEGA obterdadosordem (colado ao ValidarExecucao): HTTP ${immediatePreValidar.res.status}`);
  }
  parsed3 = immediatePreValidar.parsed;
  if (!parsed3?.pyMemo) {
    throw new Error('PEGA: pyMemo ausente no GET imediato antes de ValidarExecucaoTecnica');
  }
  console.log('[PEGA]   pyMemo para ValidarExecucaoTecnica/refresh: ' + parsed3.pyMemo);

  // Passo 7 — tentar /prweb/api/... primeiro; se 404, /prweb/app/fulfillment/api/... (navegador no fluxo-pega)
  logPegaStep(
    'PATCH ValidarExecucaoTecnica/refresh',
    'ValidacaoTecnica.Encaminhar=Sucesso (fluxo-pega)',
  );
  const bodyValid = buildValidarExecucaoTecnicaRefreshBody({
    includeOrdemEscolas: flowVariant === 'ip',
  });
  const max409 = Math.max(
    1,
    parseInt(String(process.env.PEGA_VALIDAR_EXECUCAO_409_MAX_RETRIES || '6').trim(), 10) || 6,
  );
  let resValid = null;
  let textValid = '';
  let urlUsed = '';
  let lastStatus = 0;

  roundLoop: for (let round = 0; round < max409; round++) {
    if (round > 0) {
      console.log(
        `[PEGA]   Nova tentativa ValidarExecucaoTecnica/refresh (${round + 1}/${max409}) — GET obterdadosordem para pyMemo atualizado`,
      );
      const again = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
        isLinkDedicated: isLinkDedicatedFlow(flowVariant),
        logTag: '(pós-409 ValidarExecucao)',
        expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
      });
      if (!again.res.ok) {
        throw new Error(`PEGA obterdadosordem (pós-409 ValidarExecucao): HTTP ${again.res.status}`);
      }
      parsed3 = again.parsed;
      if (!parsed3?.pyMemo) {
        throw new Error('PEGA: pyMemo ausente após 409 (ValidarExecucaoTecnica)');
      }
      console.log('[PEGA]   pyMemo atualizado p/ nova tentativa: ' + parsed3.pyMemo);
    }

    const hdrValid = { ...headersJson, 'if-match': parsed3.pyMemo };
    const paths = buildValidacaoRefreshPaths(parsed1.chaveCaseOrdem);
    for (const p of paths) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdrValid, JSON.stringify(bodyValid));
      resValid = await fetchImpl(url, {
        method: 'PATCH',
        headers: hdrValid,
        body: JSON.stringify(bodyValid),
      });
      textValid = await resValid.text();
      lastStatus = resValid.status;
      let dataV = null;
      try {
        dataV = textValid ? JSON.parse(textValid) : null;
      } catch (_) {}
      logPegaResponse(
        `PEGA PATCH .../ValidarExecucaoTecnica/refresh (${p.includes('fulfillment') ? 'fulfillment' : 'api'})`,
        resValid.status,
        dataV,
        textValid,
      );
      if (resValid.ok) {
        urlUsed = url;
        break roundLoop;
      }
      if (resValid.status === 404 && paths.indexOf(p) === 0) {
        console.log('[PEGA]   ↳ 404 na API pública — tentando caminho fulfillment (app/fulfillment/api)...');
        continue;
      }
      const is409Stale =
        resValid.status === 409 &&
        round < max409 - 1 &&
        (String(textValid).includes('not a valid action') ||
          String(textValid).includes('wrong state') ||
          String(textValid).includes('Resource in the wrong state'));
      if (is409Stale) {
        console.log('[PEGA]   ↳ 409 — estado/if-match desatualizado; novo GET e nova rodada.');
        continue roundLoop;
      }
      throw new Error(`PEGA ValidarExecucaoTecnica/refresh: HTTP ${resValid.status} — ${textValid?.slice(0, 800)}`);
    }
  }
  if (!resValid?.ok) {
    throw new Error(`PEGA ValidarExecucaoTecnica/refresh falhou: HTTP ${lastStatus}`);
  }

  let pyStatusWorkAfterRefresh = null;
  try {
    const j = textValid ? JSON.parse(textValid) : null;
    const c = j?.data?.caseInfo?.content ?? j?.data?.data?.caseInfo?.content;
    pyStatusWorkAfterRefresh = c?.pyStatusWork ?? null;
  } catch (_) {}

  // Passo 8 — GET pyMemo para o PATCH ?viewType=form (fluxo-pega ~2241; roteia p/ Agendamento)
  logPegaStep('GET obterdadosordem', 'pyMemo para ValidarExecucaoTecnica?viewType=form');
  const afterRefresh = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(pós-ValidarExecucao refresh)',
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!afterRefresh.res.ok) {
    throw new Error(`PEGA obterdadosordem (pós-refresh): HTTP ${afterRefresh.res.status}`);
  }
  const parsedAfterRefresh = afterRefresh.parsed;
  if (!parsedAfterRefresh?.pyMemo) {
    throw new Error('PEGA: pyMemo ausente antes de ValidarExecucaoTecnica?viewType=form');
  }

  // Passo 9 — fulfillment apenas (navegador no fluxo-pega)
  logPegaStep(
    'PATCH ValidarExecucaoTecnica?viewType=form',
    'mesmo body do refresh; conclui validação e segue fluxo (ex.: Agendamento)',
  );
  const urlForm = `${root}${buildValidacaoViewTypeFormPath(parsed1.chaveCaseOrdem)}`;
  const hdrForm = { ...headersJson, 'if-match': parsedAfterRefresh.pyMemo };
  logPegaCurl('PATCH', urlForm, hdrForm, JSON.stringify(bodyValid));
  const resForm = await fetchImpl(urlForm, {
    method: 'PATCH',
    headers: hdrForm,
    body: JSON.stringify(bodyValid),
  });
  const textForm = await resForm.text();
  let dataForm = null;
  try {
    dataForm = textForm ? JSON.parse(textForm) : null;
  } catch (_) {}
  logPegaResponse('PEGA PATCH .../ValidarExecucaoTecnica?viewType=form', resForm.status, dataForm, textForm);
  if (!resForm.ok) {
    throw new Error(`PEGA ValidarExecucaoTecnica?viewType=form: HTTP ${resForm.status} — ${textForm?.slice(0, 800)}`);
  }

  let pyStatusWorkAfterValidacao = null;
  try {
    pyStatusWorkAfterValidacao = dataForm?.data?.caseInfo?.content?.pyStatusWork ?? null;
  } catch (_) {}

  const skipCaseViews =
    skipCaseViewRefreshOpt === true || String(process.env.SKIP_PEGA_CASE_VIEW_REFRESH || '').trim() === '1';

  let caseViewPyDetailsStatus = null;
  let caseViewPyDetailsUrl = '';
  let caseViewDadosPedidoStatus = null;
  let caseViewDadosPedidoUrl = '';

  // Passo 10 — GET pyMemo para PATCH views do caso (fluxo-pega ~2776, ~3081)
  logPegaStep('GET obterdadosordem', 'pyMemo para pyDetailsTabContent + DadosPedidoOSTab /refresh');
  const afterValidacaoForm = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(pré-views caso)',
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!afterValidacaoForm.res.ok) {
    throw new Error(`PEGA obterdadosordem (pós-ValidarExecucao?viewType=form): HTTP ${afterValidacaoForm.res.status}`);
  }
  const parsedAfterValidacaoForm = afterValidacaoForm.parsed;
  if (!parsedAfterValidacaoForm?.pyMemo) {
    throw new Error('PEGA: pyMemo ausente após ValidarExecucao?viewType=form (views do caso)');
  }

  if (!skipCaseViews) {
    logPegaStep('PATCH cases/.../views/pyDetailsTabContent/refresh', 'fluxo-pega ~2776');
    const r1 = await patchCaseViewRefresh('pyDetailsTabContent', parsedAfterValidacaoForm.pyMemo);
    caseViewPyDetailsStatus = r1.status;
    caseViewPyDetailsUrl = r1.url;
    logPegaStep('PATCH cases/.../views/DadosPedidoOSTab/refresh', 'fluxo-pega ~3081');
    const r2 = await patchCaseViewRefresh('DadosPedidoOSTab', parsedAfterValidacaoForm.pyMemo);
    caseViewDadosPedidoStatus = r2.status;
    caseViewDadosPedidoUrl = r2.url;
  }

  // Passo 13 — GET pós-validação / views (IsEmAgendamento / pyMemo Agendamento)
  logPegaStep('GET obterdadosordem', 'estado após views; IsEmAgendamento / pyMemo Agendamento');
  const fourth = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
    isLinkDedicated: isLinkDedicatedFlow(flowVariant),
    logTag: '(pós-views caso)',
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!fourth.res.ok) {
    throw new Error(`PEGA obterdadosordem (pós-views do caso): HTTP ${fourth.res.status}`);
  }
  const parsedPostValidacao = fourth.parsed;
  if (parsedPostValidacao?.item) {
    console.log(
      '[PEGA]   Estado pós-validação: pyStatusWork=' +
        (parsedPostValidacao.item.pyStatusWork || '—') +
        ', StatusView=' +
        (parsedPostValidacao.item.StatusView || '—') +
        ', IsEmAgendamento=' +
        (parsedPostValidacao.item.IsEmAgendamento === true ? 'true' : 'false'),
    );
  }

  const skipAgendamento =
    skipAgendamentoOpt === true || String(process.env.SKIP_PEGA_AGENDAMENTO || '').trim() === '1';

  let pegaOrdemServicoOs = extractOrdemServicoOsFromItem(parsedPostValidacao?.item);

  let agendamentoSelecaoPeriodoStatus = null;
  let agendamentoSelecaoSlotRefreshStatus = null;
  let agendamentoSelecaoSlotFormStatus = null;
  let agendamentoSelecaoPeriodoUrl = '';
  let agendamentoSelecaoSlotRefreshUrl = '';
  let agendamentoSelecaoSlotFormUrl = '';
  let agendamentoSkipped = true;

  if (!skipAgendamento && parsedPostValidacao?.item?.IsEmAgendamento === true) {
    agendamentoSkipped = false;
    const periodoOpts = { ...(agendamentoPeriodo || {}) };
    const di = (process.env.PEGA_AGENDAMENTO_DATA_INICIO || '').trim();
    const df = (process.env.PEGA_AGENDAMENTO_DATA_FIM || '').trim();
    if (di) periodoOpts.dataInicio = di;
    if (df) periodoOpts.dataFim = df;
    const bodyPeriodo = buildSelecaoDePeriodoBody({ periodo: periodoOpts });

    logPegaStep('PATCH SelecaoDePeriodo?viewType=form', 'DataInicio/DataFim (fluxo-pega ~7427)');
    const hdrPeriodo = { ...headersJson, 'if-match': parsedPostValidacao.pyMemo };
    const pathsPeriodo = buildAgendamentoActionPaths(parsed1.chaveCaseOrdem, 'SelecaoDePeriodo?viewType=form');
    let resPer = null;
    let textPer = '';
    let urlPer = '';
    let lastPer = 0;
    for (const p of pathsPeriodo) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdrPeriodo, JSON.stringify(bodyPeriodo));
      resPer = await fetchImpl(url, { method: 'PATCH', headers: hdrPeriodo, body: JSON.stringify(bodyPeriodo) });
      textPer = await resPer.text();
      lastPer = resPer.status;
      let dataPer = null;
      try {
        dataPer = textPer ? JSON.parse(textPer) : null;
      } catch (_) {}
      logPegaResponse(`PEGA PATCH .../SelecaoDePeriodo?viewType=form`, resPer.status, dataPer, textPer);
      if (resPer.ok) {
        urlPer = url;
        break;
      }
      if (resPer.status === 404 && pathsPeriodo.indexOf(p) === 0) {
        console.log('[PEGA]   ↳ 404 na rota fulfillment — tentando API pública...');
        continue;
      }
      throw new Error(`PEGA SelecaoDePeriodo?viewType=form: HTTP ${resPer.status} — ${textPer?.slice(0, 800)}`);
    }
    if (!resPer?.ok) {
      throw new Error(`PEGA SelecaoDePeriodo falhou: HTTP ${lastPer}`);
    }
    agendamentoSelecaoPeriodoStatus = resPer.status;
    agendamentoSelecaoPeriodoUrl = urlPer;

    let slots = null;
    try {
      const dataPer = textPer ? JSON.parse(textPer) : null;
      slots = extractAgendamentoSlotsFromApiJson(dataPer);
    } catch (_) {}

    logPegaStep('GET obterdadosordem', 'pyMemo para SelecaoDoSlot (fluxo-pega ~12892)');
    const fifth = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
      isLinkDedicated: isLinkDedicatedFlow(flowVariant),
      logTag: '(pós-SelecaoDePeriodo)',
      expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
    });
    if (!fifth.res.ok) {
      throw new Error(`PEGA obterdadosordem (pós-SelecaoDePeriodo): HTTP ${fifth.res.status}`);
    }
    const parsed5 = fifth.parsed;
    if (!parsed5?.pyMemo) {
      throw new Error('PEGA: pyMemo ausente após SelecaoDePeriodo');
    }
    if (!slots || slots.length === 0) {
      slots = extractAgendamentoSlotsFromObterDadosItem(parsed5.item);
    }

    if (!slots || slots.length === 0) {
      const encSlot = encodeURIComponent(`ASSIGN-WORKBASKET ${parsed1.chaveCaseOrdem}!AGENDAMENTO_FLOW`);
      const pathsOpen = [
        `/prweb/app/fulfillment/api/application/v2/assignments/${encSlot}/actions/SelecaoDoSlot`,
        `/prweb/api/application/v2/assignments/${encSlot}/actions/SelecaoDoSlot`,
      ];
      for (const p of pathsOpen) {
        const url = `${root}${p}`;
        console.log('[PEGA]   Slots ausentes no PATCH — buscando GET .../SelecaoDoSlot');
        logPegaCurl('GET', url, headersAuth, null);
        const ro = await fetchImpl(url, { method: 'GET', headers: headersAuth });
        const to = await ro.text();
        let jo = null;
        try {
          jo = to ? JSON.parse(to) : null;
        } catch (_) {}
        logPegaResponse(`PEGA GET .../SelecaoDoSlot`, ro.status, jo, to);
        if (ro.ok) {
          slots = extractAgendamentoSlotsFromApiJson(jo);
          if (slots && slots.length) break;
        }
      }
    }

    if (!slots || slots.length === 0) {
      throw new Error('PEGA Agendamento: não foi possível obter Slots (EmbedListUUID__) para SelecaoDoSlot/refresh');
    }

    logPegaStep('PATCH SelecaoDoSlot/refresh', 'carregar slots (fluxo-pega ~12897)');
    const bodyRefresh = buildSelecaoDoSlotRefreshBody(slots);
    const hdrSlot = { ...headersJson, 'if-match': parsed5.pyMemo };
    const pathsRefresh = buildAgendamentoActionPaths(parsed1.chaveCaseOrdem, 'SelecaoDoSlot/refresh');
    let resRef = null;
    let textRef = '';
    let urlRefUsed = '';
    let lastRef = 0;
    for (const p of pathsRefresh) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdrSlot, JSON.stringify(bodyRefresh));
      resRef = await fetchImpl(url, { method: 'PATCH', headers: hdrSlot, body: JSON.stringify(bodyRefresh) });
      textRef = await resRef.text();
      lastRef = resRef.status;
      let dataRef = null;
      try {
        dataRef = textRef ? JSON.parse(textRef) : null;
      } catch (_) {}
      logPegaResponse(`PEGA PATCH .../SelecaoDoSlot/refresh`, resRef.status, dataRef, textRef);
      if (resRef.ok) {
        urlRefUsed = url;
        break;
      }
      if (resRef.status === 404 && pathsRefresh.indexOf(p) === 0) {
        console.log('[PEGA]   ↳ 404 na rota fulfillment — tentando API pública...');
        continue;
      }
      throw new Error(`PEGA SelecaoDoSlot/refresh: HTTP ${resRef.status} — ${textRef?.slice(0, 800)}`);
    }
    if (!resRef?.ok) {
      throw new Error(`PEGA SelecaoDoSlot/refresh falhou: HTTP ${lastRef}`);
    }
    agendamentoSelecaoSlotRefreshStatus = resRef.status;
    agendamentoSelecaoSlotRefreshUrl = urlRefUsed;

    let slotsAfterRefresh = null;
    try {
      const jRef = textRef ? JSON.parse(textRef) : null;
      slotsAfterRefresh = extractAgendamentoSlotsFromApiJson(jRef);
    } catch (_) {}
    const slotCount = (slotsAfterRefresh && slotsAfterRefresh.length) || slots.length;

    logPegaStep('GET obterdadosordem', 'pyMemo para SelecaoDoSlot?viewType=form');
    const sixth = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
      isLinkDedicated: isLinkDedicatedFlow(flowVariant),
      logTag: '(pré-SelecaoDoSlot form)',
      expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
    });
    if (!sixth.res.ok) {
      throw new Error(`PEGA obterdadosordem (pós-SelecaoDoSlot/refresh): HTTP ${sixth.res.status}`);
    }
    const parsed6 = sixth.parsed;
    if (!parsed6?.pyMemo) {
      throw new Error('PEGA: pyMemo ausente antes de SelecaoDoSlot?viewType=form');
    }

    const slotSel = parseInt(
      String(agendamentoSlotListIndex ?? process.env.PEGA_AGENDAMENTO_SLOT_INDEX ?? '1').trim(),
      10,
    );
    const slotIndex = Number.isFinite(slotSel) && slotSel >= 1 ? slotSel : 1;

    logPegaStep('PATCH SelecaoDoSlot?viewType=form', 'confirmar slot (fluxo-pega ~13877)');
    const bodyConfirm = buildSelecaoDoSlotConfirmBody(slotCount, slotIndex);
    const hdrConfirm = { ...headersJson, 'if-match': parsed6.pyMemo };
    const pathsConfirm = buildAgendamentoActionPaths(parsed1.chaveCaseOrdem, 'SelecaoDoSlot?viewType=form');
    let resConf = null;
    let textConf = '';
    let urlConf = '';
    let lastConf = 0;
    for (const p of pathsConfirm) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdrConfirm, JSON.stringify(bodyConfirm));
      resConf = await fetchImpl(url, { method: 'PATCH', headers: hdrConfirm, body: JSON.stringify(bodyConfirm) });
      textConf = await resConf.text();
      lastConf = resConf.status;
      let dataConf = null;
      try {
        dataConf = textConf ? JSON.parse(textConf) : null;
      } catch (_) {}
      logPegaResponse(`PEGA PATCH .../SelecaoDoSlot?viewType=form`, resConf.status, dataConf, textConf);
      if (resConf.ok) {
        urlConf = url;
        break;
      }
      if (resConf.status === 404 && pathsConfirm.indexOf(p) === 0) {
        console.log('[PEGA]   ↳ 404 na rota fulfillment — tentando API pública...');
        continue;
      }
      throw new Error(`PEGA SelecaoDoSlot?viewType=form: HTTP ${resConf.status} — ${textConf?.slice(0, 800)}`);
    }
    if (!resConf?.ok) {
      throw new Error(`PEGA SelecaoDoSlot?viewType=form falhou: HTTP ${lastConf}`);
    }
    agendamentoSelecaoSlotFormStatus = resConf.status;
    agendamentoSelecaoSlotFormUrl = urlConf;

    logPegaStep('GET obterdadosordem', 'confirmar estado após agendamento');
    const seventh = await fetchObterDadosOrdemWithRetry(getObterDadosOrdem, parseObterOpts, {
      isLinkDedicated: isLinkDedicatedFlow(flowVariant),
      logTag: '(pós-agendamento)',
      expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
    });
    if (seventh.res.ok) {
      const p7 = seventh.parsed;
      if (p7?.item) {
        console.log(
          '[PEGA]   Estado pós-agendamento: pyStatusWork=' +
            (p7.item.pyStatusWork || '—') +
            ', StatusView=' +
            (p7.item.StatusView || '—'),
        );
        const osFromP7 = extractOrdemServicoOsFromItem(p7.item);
        if (osFromP7) pegaOrdemServicoOs = osFromP7;
      }
    }
  }

  return {
    chaveCaseOrdem: parsed1.chaveCaseOrdem,
    caseId: parsed1.caseId,
    linkDedicado: !!parsed1.linkDedicado,
    pegaOrdemServicoOs,
    pyStatusWork,
    pyStatusWorkAfterRefresh,
    pyStatusWorkAfterValidacao,
    designarStatus: resDesignar.status,
    configurarStatus: resConfig.status,
    validacaoTecnicaRefreshStatus: resValid.status,
    validacaoTecnicaFormStatus: resForm.status,
    validarExecucaoRefreshUrl: urlUsed,
    validarExecucaoFormUrl: urlForm,
    agendamentoSkipped,
    agendamentoSelecaoPeriodoStatus,
    agendamentoSelecaoSlotRefreshStatus,
    agendamentoSelecaoSlotFormStatus,
    agendamentoSelecaoPeriodoUrl,
    agendamentoSelecaoSlotRefreshUrl,
    agendamentoSelecaoSlotFormUrl,
    caseViewRefreshSkipped: skipCaseViews,
    caseViewPyDetailsStatus,
    caseViewDadosPedidoStatus,
    caseViewPyDetailsUrl,
    caseViewDadosPedidoUrl,
  };
}

/**
 * Link Dedicado — doc "fluxo completo": GET Ponta B → DesignarFacilidadeDados → GET → ConfigurarDados (sem GET extra após Configurar).
 */
async function runPegaLinkDedicadoPontaDesignarConfigurarOnly(opts) {
  const { ordemServico, baseUrl, bearerToken, cookie = '', fetchImpl = global.fetch, ldLeg: ldLegOpt } = opts;
  if (!ordemServico || !baseUrl || !bearerToken) {
    throw new Error('runPegaLinkDedicadoPontaDesignarConfigurarOnly: ordemServico, baseUrl e bearerToken são obrigatórios');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não disponível — use Node 18+ ou passe fetchImpl');
  }
  const root = baseUrl.replace(/\/$/, '');
  const headersAuth = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const headersJson = { ...headersAuth, 'Content-Type': 'application/json' };
  const ldLegRaw = (ldLegOpt != null ? String(ldLegOpt) : 'pontaB').trim();
  const parseOpts = {
    linkDedicado: true,
    matchOrdemServico: String(ordemServico).trim(),
    ldLeg: ldLegRaw,
  };

  async function getObter() {
    const q = `${root}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(String(ordemServico).trim())}`;
    logPegaCurl('GET', q, headersAuth, null);
    const res = await fetchImpl(q, { method: 'GET', headers: headersAuth });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    logPegaResponse(`PEGA GET obterdadosordem (LD Designar/Configurar ${ldLegRaw})`, res.status, data, text);
    return { res, text, data };
  }

  console.log(
    `[PEGA LD] Designar + Configurar (${ldLegRaw}) — obterdadosordem=${String(ordemServico).trim()} (sem GET após Configurar, conforme doc)`,
  );
  const ldNorm = String(ldLegRaw).replace(/\s+/g, '').toLowerCase();
  const isPontaBDesignar = ldNorm === 'pontab';
  const first = await fetchObterDadosOrdemWithRetry(getObter, parseOpts, {
    isLinkDedicated: true,
    logTag: `(LD ${ldLegRaw} inicial)`,
    requireFull: true,
    ...(isPontaBDesignar
      ? {
          maxTriesOverride: Math.max(
            15,
            parseInt(String(process.env.PEGA_LD_OBTER_PONTA_B_MAX_TRIES || '30').trim(), 10) || 30,
          ),
          retryMsOverride: Math.max(
            2000,
            parseInt(String(process.env.PEGA_LD_OBTER_PONTA_B_RETRY_MS || '4000').trim(), 10) || 4000,
          ),
        }
      : {}),
  });
  if (!first.res.ok) {
    throw new Error(`PEGA LD: obterdadosordem HTTP ${first.res.status} — ${first.text?.slice(0, 500)}`);
  }
  let parsed1 = first.parsed;
  if (!parsed1?.pyMemo || !parsed1.chaveCaseOrdem) {
    const os = String(ordemServico).trim();
    const bodyPreview = Array.isArray(first.data)
      ? `array length ${first.data.length}`
      : String(first.data ?? 'null').slice(0, 120);
    throw new Error(
      `PEGA LD: obterdadosordem não retornou caso utilizável para Designar/Configurar (OS=${os}, perna=${ldLegRaw}). ` +
        `Corpo: ${bodyPreview}. O PEGA costuma demorar a criar a linha da Ponta B após a Ponta A — aumente ` +
        `PEGA_LD_DELAY_BEFORE_PONTA_B_MS (antes deste passo), PEGA_LD_OBTER_PONTA_B_MAX_TRIES (atualmente até 30) e ` +
        `PEGA_LD_OBTER_PONTA_B_RETRY_MS, ou confira se OrderNumber da Ponta B bate com o PEGA.`,
    );
  }

  const pathDesignar = buildAssignmentPath(parsed1.chaveCaseOrdem, 'DesignarFacilidadeDados');
  const pathConfig = buildAssignmentPath(parsed1.chaveCaseOrdem, 'ConfigurarDados');
  const bodyDesignar = buildDesignarFacilidadeDadosBody({ includeEnderecamentoIp: false });
  const urlDesignar = `${root}${pathDesignar}`;
  const hdrDesignar = { ...headersJson, 'if-match': parsed1.pyMemo };
  logPegaCurl('PATCH', urlDesignar, hdrDesignar, JSON.stringify(bodyDesignar));
  const resDesignar = await fetchImpl(urlDesignar, {
    method: 'PATCH',
    headers: hdrDesignar,
    body: JSON.stringify(bodyDesignar),
  });
  const textDesignar = await resDesignar.text();
  let dataDesignar = null;
  try {
    dataDesignar = textDesignar ? JSON.parse(textDesignar) : null;
  } catch (_) {}
  logPegaResponse(`PEGA LD PATCH .../DesignarFacilidadeDados (${ldLegRaw})`, resDesignar.status, dataDesignar, textDesignar);
  if (!resDesignar.ok) {
    throw new Error(`PEGA LD DesignarFacilidadeDados: HTTP ${resDesignar.status} — ${textDesignar?.slice(0, 800)}`);
  }

  const second = await fetchObterDadosOrdemWithRetry(getObter, parseOpts, {
    isLinkDedicated: true,
    logTag: `(LD ${ldLegRaw} pós-Designar)`,
    expectedChaveCaseOrdem: parsed1.chaveCaseOrdem,
  });
  if (!second.res.ok) {
    throw new Error(`PEGA LD obterdadosordem (pós-Designar): HTTP ${second.res.status}`);
  }
  const parsed2 = second.parsed;
  if (!parsed2?.pyMemo) {
    throw new Error('PEGA LD: pyMemo ausente após DesignarFacilidadeDados');
  }

  const bodyConfig = buildConfigurarDadosBody();
  const urlConfig = `${root}${pathConfig}`;
  const hdrConfig = { ...headersJson, 'if-match': parsed2.pyMemo };
  logPegaCurl('PATCH', urlConfig, hdrConfig, JSON.stringify(bodyConfig));
  const resConfig = await fetchImpl(urlConfig, {
    method: 'PATCH',
    headers: hdrConfig,
    body: JSON.stringify(bodyConfig),
  });
  const textConfig = await resConfig.text();
  let dataConfig = null;
  try {
    dataConfig = textConfig ? JSON.parse(textConfig) : null;
  } catch (_) {}
  logPegaResponse(`PEGA LD PATCH .../ConfigurarDados (${ldLegRaw})`, resConfig.status, dataConfig, textConfig);
  if (!resConfig.ok) {
    throw new Error(`PEGA LD ConfigurarDados: HTTP ${resConfig.status} — ${textConfig?.slice(0, 800)}`);
  }

  let pyStatusWork = null;
  try {
    pyStatusWork = dataConfig?.data?.caseInfo?.content?.pyStatusWork ?? null;
  } catch (_) {}

  return {
    chaveCaseOrdem: parsed1.chaveCaseOrdem,
    caseId: parsed1.caseId,
    linkDedicado: true,
    pegaOrdemServicoOs: extractOrdemServicoOsFromItem(parsed1.item),
    pyStatusWork,
    designarStatus: resDesignar.status,
    configurarStatus: resConfig.status,
    ldLeg: ldLegRaw,
  };
}

/**
 * Link Dedicado — Validação: GET → só PATCH ValidarExecucaoTecnica?viewType=form (doc não usa /refresh) → views.
 */
async function runPegaLinkDedicadoValidacaoFormEViews(opts) {
  const {
    ordemServico,
    baseUrl,
    bearerToken,
    cookie = '',
    fetchImpl = global.fetch,
    ldLeg: ldLegOpt,
    skipCaseViewRefresh: skipCaseViewRefreshOpt,
  } = opts;
  if (!ordemServico || !baseUrl || !bearerToken) {
    throw new Error('runPegaLinkDedicadoValidacaoFormEViews: ordemServico, baseUrl e bearerToken são obrigatórios');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não disponível — use Node 18+ ou passe fetchImpl');
  }
  const root = baseUrl.replace(/\/$/, '');
  const headersAuth = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const headersJson = { ...headersAuth, 'Content-Type': 'application/json' };
  const ldLegRaw = (ldLegOpt != null ? String(ldLegOpt) : 'pontaA').trim();
  const parseOpts = {
    linkDedicado: true,
    matchOrdemServico: String(ordemServico).trim(),
    ldLeg: ldLegRaw,
  };

  async function getObter() {
    const q = `${root}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(String(ordemServico).trim())}`;
    logPegaCurl('GET', q, headersAuth, null);
    const res = await fetchImpl(q, { method: 'GET', headers: headersAuth });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    logPegaResponse(`PEGA GET obterdadosordem (LD Validação ${ldLegRaw})`, res.status, data, text);
    return { res, text, data };
  }

  const first = await fetchObterDadosOrdemWithRetry(getObter, parseOpts, {
    isLinkDedicated: true,
    logTag: `(LD Validação ${ldLegRaw})`,
    requireFull: true,
  });
  if (!first.res.ok) {
    throw new Error(`PEGA LD Validação: obterdadosordem HTTP ${first.res.status}`);
  }
  const parsed = first.parsed;
  if (!parsed?.chaveCaseOrdem || !parsed.pyMemo) {
    throw new Error('PEGA LD Validação: pyMemo/ChaveCaseOrdem ausentes');
  }

  /** LD (fluxo completo / Postman): só `content.ValidacaoTecnica` — `OrdemServico.EscolasConectadas` → 400 Invalid inputs. */
  const bodyValid = buildValidarExecucaoTecnicaRefreshBody({
    includeOrdemEscolas: String(process.env.PEGA_LD_VALIDAR_ORDEM_ESCOLAS || '').trim() === '1',
  });
  const urlForm = `${root}${buildValidacaoViewTypeFormPath(parsed.chaveCaseOrdem)}`;
  const max409 = Math.max(
    1,
    parseInt(String(process.env.PEGA_VALIDAR_EXECUCAO_409_MAX_RETRIES || '6').trim(), 10) || 6,
  );

  let pyMemoForm = parsed.pyMemo;
  let resForm = null;
  let textForm = '';
  let dataForm = null;

  for (let round = 0; round < max409; round++) {
    if (round > 0) {
      console.log(`[PEGA LD Validação ${ldLegRaw}] Nova tentativa viewType=form (${round + 1}/${max409}) — GET obterdadosordem`);
      const again = await fetchObterDadosOrdemWithRetry(getObter, parseOpts, {
        isLinkDedicated: true,
        logTag: `(LD Validação ${ldLegRaw} pós-409)`,
        expectedChaveCaseOrdem: parsed.chaveCaseOrdem,
      });
      if (!again.res.ok) {
        throw new Error(`PEGA LD Validação: obterdadosordem pós-409 HTTP ${again.res.status}`);
      }
      if (!again.parsed?.pyMemo) {
        throw new Error('PEGA LD Validação: pyMemo ausente após 409');
      }
      pyMemoForm = again.parsed.pyMemo;
    }

    const hdrForm = { ...headersJson, 'if-match': pyMemoForm };
    logPegaCurl('PATCH', urlForm, hdrForm, JSON.stringify(bodyValid));
    resForm = await fetchImpl(urlForm, {
      method: 'PATCH',
      headers: hdrForm,
      body: JSON.stringify(bodyValid),
    });
    textForm = await resForm.text();
    try {
      dataForm = textForm ? JSON.parse(textForm) : null;
    } catch (_) {
      dataForm = null;
    }
    logPegaResponse(`PEGA LD PATCH .../ValidarExecucaoTecnica?viewType=form (${ldLegRaw})`, resForm.status, dataForm, textForm);

    if (resForm.ok) break;

    const is409Stale =
      resForm.status === 409 &&
      round < max409 - 1 &&
      (String(textForm).includes('not a valid action') ||
        String(textForm).includes('wrong state') ||
        String(textForm).includes('Resource in the wrong state'));
    if (is409Stale) {
      console.log('[PEGA LD Validação]   ↳ 409 — novo GET e nova tentativa (form apenas, sem /refresh).');
      continue;
    }
    throw new Error(`PEGA LD ValidarExecucaoTecnica?viewType=form: HTTP ${resForm.status} — ${textForm?.slice(0, 800)}`);
  }

  if (!resForm?.ok) {
    throw new Error(`PEGA LD ValidarExecucaoTecnica?viewType=form falhou: HTTP ${resForm.status}`);
  }

  const skipCaseViews =
    skipCaseViewRefreshOpt === true || String(process.env.SKIP_PEGA_CASE_VIEW_REFRESH || '').trim() === '1';

  let pyMemoViews = pyMemoFromAssignmentResponse(dataForm);
  if (!pyMemoViews) {
    const afterForm = await fetchObterDadosOrdemWithRetry(getObter, parseOpts, {
      isLinkDedicated: true,
      logTag: `(LD Validação ${ldLegRaw} pós-form)`,
      expectedChaveCaseOrdem: parsed.chaveCaseOrdem,
    });
    if (!afterForm.res.ok) {
      throw new Error(`PEGA LD Validação: GET pós-form HTTP ${afterForm.res.status}`);
    }
    pyMemoViews = afterForm.parsed?.pyMemo;
  }
  if (!pyMemoViews) {
    throw new Error('PEGA LD Validação: pyMemo ausente para views do caso');
  }

  let caseViewPyDetailsStatus = null;
  let caseViewPyDetailsUrl = '';
  let caseViewDadosPedidoStatus = null;
  let caseViewDadosPedidoUrl = '';

  if (!skipCaseViews) {
    const r1 = await patchCaseViewsForChave(root, headersJson, fetchImpl, parsed.chaveCaseOrdem, 'pyDetailsTabContent', pyMemoViews);
    caseViewPyDetailsStatus = r1.status;
    caseViewPyDetailsUrl = r1.url;
    const r2 = await patchCaseViewsForChave(root, headersJson, fetchImpl, parsed.chaveCaseOrdem, 'DadosPedidoOSTab', pyMemoViews);
    caseViewDadosPedidoStatus = r2.status;
    caseViewDadosPedidoUrl = r2.url;
  }

  return {
    ldLeg: ldLegRaw,
    chaveCaseOrdem: parsed.chaveCaseOrdem,
    caseId: parsed.caseId,
    validacaoTecnicaFormStatus: resForm.status,
    validarExecucaoFormUrl: urlForm,
    caseViewRefreshSkipped: skipCaseViews,
    caseViewPyDetailsStatus,
    caseViewDadosPedidoStatus,
    caseViewPyDetailsUrl,
    caseViewDadosPedidoUrl,
  };
}

/**
 * Link Dedicado — GET EVC → PATCH ConfigurarEvc (CONFIGURACAOEVC_FLOW).
 */
async function runPegaLinkDedicadoConfigurarEvc(opts) {
  const { ordemServico, baseUrl, bearerToken, cookie = '', fetchImpl = global.fetch } = opts;
  if (!ordemServico || !baseUrl || !bearerToken) {
    throw new Error('runPegaLinkDedicadoConfigurarEvc: ordemServico, baseUrl e bearerToken são obrigatórios');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não disponível — use Node 18+ ou passe fetchImpl');
  }
  const root = baseUrl.replace(/\/$/, '');
  const headersAuth = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const headersJson = { ...headersAuth, 'Content-Type': 'application/json' };
  const parseOpts = {
    linkDedicado: true,
    matchOrdemServico: String(ordemServico).trim(),
    ldLeg: 'evc',
  };

  async function getObter() {
    const q = `${root}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(String(ordemServico).trim())}`;
    logPegaCurl('GET', q, headersAuth, null);
    const res = await fetchImpl(q, { method: 'GET', headers: headersAuth });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    logPegaResponse(`PEGA GET obterdadosordem (LD EVC)`, res.status, data, text);
    return { res, text, data };
  }

  console.log('[PEGA LD] EVC — GET + ConfigurarEvc (obterdadosordem=' + String(ordemServico).trim() + ')');
  const first = await fetchObterDadosOrdemWithRetry(getObter, parseOpts, {
    isLinkDedicated: true,
    logTag: '(LD EVC)',
    requireFull: true,
  });
  if (!first.res.ok) {
    throw new Error(`PEGA LD EVC: obterdadosordem HTTP ${first.res.status}`);
  }
  const parsed = first.parsed;
  if (!parsed?.chaveCaseOrdem || !parsed.pyMemo) {
    throw new Error('PEGA LD EVC: pyMemo/ChaveCaseOrdem ausentes');
  }

  const bodyEvc = buildConfigurarEvcBody();
  const pathsEvc = buildConfigurarEvcPaths(parsed.chaveCaseOrdem);
  const hdrEvc = { ...headersJson, 'if-match': parsed.pyMemo };
  let resEvc = null;
  let textEvc = '';
  let lastSt = 0;
  for (const p of pathsEvc) {
    const url = `${root}${p}`;
    logPegaCurl('PATCH', url, hdrEvc, JSON.stringify(bodyEvc));
    resEvc = await fetchImpl(url, { method: 'PATCH', headers: hdrEvc, body: JSON.stringify(bodyEvc) });
    textEvc = await resEvc.text();
    lastSt = resEvc.status;
    let dataEvc = null;
    try {
      dataEvc = textEvc ? JSON.parse(textEvc) : null;
    } catch (_) {}
    logPegaResponse(`PEGA LD PATCH .../ConfigurarEvc`, resEvc.status, dataEvc, textEvc);
    if (resEvc.ok) break;
    if (resEvc.status === 404 && pathsEvc.indexOf(p) === 0) {
      console.log('[PEGA LD EVC]   ↳ 404 na rota API pública — tentando fulfillment...');
      continue;
    }
    throw new Error(`PEGA LD ConfigurarEvc: HTTP ${resEvc.status} — ${textEvc?.slice(0, 800)}`);
  }
  if (!resEvc?.ok) {
    throw new Error(`PEGA LD ConfigurarEvc falhou: HTTP ${lastSt}`);
  }

  return {
    chaveCaseOrdem: parsed.chaveCaseOrdem,
    caseId: parsed.caseId,
    configurarEvcStatus: resEvc.status,
  };
}

/**
 * Link Dedicado — Ponta B (fluxo link dedicado.txt): após a Ponta A, GET com ORDEMSERVICO do subpedido Ponta B,
 * depois SelecaoDePeriodo → views do caso → SelecaoDoSlot (refresh + form) → views.
 */
async function runPegaLinkDedicadoPontaBAgendamento(opts) {
  const {
    ordemServico,
    baseUrl,
    bearerToken,
    cookie = '',
    fetchImpl = global.fetch,
    skipAgendamento: skipAgendamentoOpt,
    skipCaseViewRefresh: skipCaseViewRefreshOpt,
    agendamentoPeriodo,
    agendamentoSlotListIndex,
    ldLeg: ldLegOpt,
  } = opts;

  if (!ordemServico || !baseUrl || !bearerToken) {
    throw new Error('runPegaLinkDedicadoPontaBAgendamento: ordemServico, baseUrl e bearerToken são obrigatórios');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não disponível — use Node 18+ ou passe fetchImpl');
  }

  const root = baseUrl.replace(/\/$/, '');
  const headersAuth = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const headersJson = {
    ...headersAuth,
    'Content-Type': 'application/json',
  };
  const ldLegRaw = (ldLegOpt != null ? String(ldLegOpt) : 'pontaB').trim();
  const parseOpts = {
    linkDedicado: true,
    matchOrdemServico: String(ordemServico).trim(),
    ldLeg: ldLegRaw,
  };

  async function getObterDadosOrdemB() {
    const q = `${root}/prweb/api/APIOrdemDeServico/v1/obterdadosordem?ORDEMSERVICO=${encodeURIComponent(String(ordemServico).trim())}`;
    logPegaCurl('GET', q, headersAuth, null);
    const res = await fetchImpl(q, { method: 'GET', headers: headersAuth });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    logPegaResponse(`PEGA GET obterdadosordem (LD agendamento ${ldLegRaw})`, res.status, data, text);
    return { res, text, data };
  }

  async function patchCaseViewsB(viewName, pyMemo, chaveCase) {
    const paths = buildCaseViewRefreshPaths(chaveCase, viewName);
    const hdr = { ...headersJson, 'if-match': pyMemo };
    let lastSt = 0;
    for (const p of paths) {
      const url = `${root}${p}`;
      logPegaCurl('PATCH', url, hdr, CASE_VIEW_REFRESH_BODY);
      const res = await fetchImpl(url, { method: 'PATCH', headers: hdr, body: CASE_VIEW_REFRESH_BODY });
      const text = await res.text();
      lastSt = res.status;
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {}
      logPegaResponse(`PEGA LD ${ldLegRaw} PATCH .../views/${viewName}/refresh`, res.status, data, text);
      if (res.ok) return { status: res.status, url };
      if (res.status === 404 && paths.indexOf(p) === 0) {
        console.log(`[PEGA LD ${ldLegRaw}]   ↳ 404 na rota fulfillment — tentando API pública...`);
        continue;
      }
      throw new Error(`PEGA LD ${ldLegRaw} views/${viewName}/refresh: HTTP ${res.status} — ${text?.slice(0, 600)}`);
    }
    throw new Error(`PEGA LD ${ldLegRaw} views/${viewName}/refresh falhou: HTTP ${lastSt}`);
  }

  const skipAgendamento =
    skipAgendamentoOpt === true || String(process.env.SKIP_PEGA_AGENDAMENTO || '').trim() === '1';
  if (skipAgendamento) {
    console.log(`[PEGA LD ${ldLegRaw}] SKIP_PEGA_AGENDAMENTO=1 — omitindo agendamento.`);
    return { skipped: true };
  }

  console.log(`[PEGA LD ${ldLegRaw}] GET obterdadosordem — ORDEMSERVICO=` + String(ordemServico).trim());
  const first = await fetchObterDadosOrdemWithRetry(getObterDadosOrdemB, parseOpts, {
    isLinkDedicated: true,
    logTag: `[LD ${ldLegRaw} agendamento inicial]`,
    requireFull: true,
  });
  if (!first.res.ok) {
    throw new Error(`PEGA LD Ponta B obterdadosordem: HTTP ${first.res.status} — ${first.text?.slice(0, 500)}`);
  }
  const parsed = first.parsed;
  if (!parsed?.pyMemo || !parsed.chaveCaseOrdem) {
    throw new Error('PEGA LD Ponta B: pyMemo ou chaveCaseOrdem ausente no obterdadosordem');
  }
  const chaveCaseOrdem = parsed.chaveCaseOrdem;
  console.log('[PEGA LD Ponta B] Caso (pzInsKey):', chaveCaseOrdem);

  const periodoOpts = { ...(agendamentoPeriodo || {}) };
  const di = (process.env.PEGA_AGENDAMENTO_DATA_INICIO || '').trim();
  const df = (process.env.PEGA_AGENDAMENTO_DATA_FIM || '').trim();
  if (di) periodoOpts.dataInicio = di;
  if (df) periodoOpts.dataFim = df;
  const bodyPeriodo = buildSelecaoDePeriodoBody({ periodo: periodoOpts });

  console.log('[PEGA LD Ponta B] PATCH SelecaoDePeriodo?viewType=form');
  const hdrPeriodo = { ...headersJson, 'if-match': parsed.pyMemo };
  const pathsPeriodo = buildAgendamentoActionPaths(chaveCaseOrdem, 'SelecaoDePeriodo?viewType=form');
  let resPer = null;
  let textPer = '';
  let urlPer = '';
  let lastPer = 0;
  for (const p of pathsPeriodo) {
    const url = `${root}${p}`;
    logPegaCurl('PATCH', url, hdrPeriodo, JSON.stringify(bodyPeriodo));
    resPer = await fetchImpl(url, { method: 'PATCH', headers: hdrPeriodo, body: JSON.stringify(bodyPeriodo) });
    textPer = await resPer.text();
    lastPer = resPer.status;
    let dataPer = null;
    try {
      dataPer = textPer ? JSON.parse(textPer) : null;
    } catch (_) {}
    logPegaResponse(`PEGA LD Ponta B .../SelecaoDePeriodo?viewType=form`, resPer.status, dataPer, textPer);
    if (resPer.ok) {
      urlPer = url;
      break;
    }
    if (resPer.status === 404 && pathsPeriodo.indexOf(p) === 0) {
      console.log('[PEGA LD Ponta B]   ↳ 404 — tentando API pública...');
      continue;
    }
    throw new Error(`PEGA LD Ponta B SelecaoDePeriodo: HTTP ${resPer.status} — ${textPer?.slice(0, 800)}`);
  }
  if (!resPer?.ok) throw new Error(`PEGA LD Ponta B SelecaoDePeriodo falhou: HTTP ${lastPer}`);

  const skipCaseViews =
    skipCaseViewRefreshOpt === true || String(process.env.SKIP_PEGA_CASE_VIEW_REFRESH || '').trim() === '1';

  let pyMemoViews = parsed.pyMemo;
  const afterPer = await fetchObterDadosOrdemWithRetry(getObterDadosOrdemB, parseOpts, {
    isLinkDedicated: true,
    logTag: '[LD Ponta B] (pós-SelecaoDePeriodo)',
    expectedChaveCaseOrdem: chaveCaseOrdem,
  });
  if (afterPer.res.ok && afterPer.parsed?.pyMemo) {
    pyMemoViews = afterPer.parsed.pyMemo;
  }

  if (!skipCaseViews) {
    console.log('[PEGA LD Ponta B] PATCH views pyDetailsTabContent + DadosPedidoOSTab');
    await patchCaseViewsB('pyDetailsTabContent', pyMemoViews, chaveCaseOrdem);
    await patchCaseViewsB('DadosPedidoOSTab', pyMemoViews, chaveCaseOrdem);
  }

  let slots = null;
  try {
    const dataPer = textPer ? JSON.parse(textPer) : null;
    slots = extractAgendamentoSlotsFromApiJson(dataPer);
  } catch (_) {}

  console.log('[PEGA LD Ponta B] GET obterdadosordem (pyMemo SelecaoDoSlot)');
  const fifth = await fetchObterDadosOrdemWithRetry(getObterDadosOrdemB, parseOpts, {
    isLinkDedicated: true,
    logTag: '[LD Ponta B] (slots)',
    expectedChaveCaseOrdem: chaveCaseOrdem,
  });
  if (!fifth.res.ok) throw new Error(`PEGA LD Ponta B obterdadosordem (slots): HTTP ${fifth.res.status}`);
  const parsed5 = fifth.parsed;
  if (!parsed5?.pyMemo) throw new Error('PEGA LD Ponta B: pyMemo ausente antes de SelecaoDoSlot');

  if (!slots || slots.length === 0) {
    slots = extractAgendamentoSlotsFromObterDadosItem(parsed5.item);
  }
  if (!slots || slots.length === 0) {
    const encSlot = encodeURIComponent(`ASSIGN-WORKBASKET ${chaveCaseOrdem}!AGENDAMENTO_FLOW`);
    const pathsOpen = [
      `/prweb/app/fulfillment/api/application/v2/assignments/${encSlot}/actions/SelecaoDoSlot`,
      `/prweb/api/application/v2/assignments/${encSlot}/actions/SelecaoDoSlot`,
    ];
    for (const p of pathsOpen) {
      const url = `${root}${p}`;
      logPegaCurl('GET', url, headersAuth, null);
      const ro = await fetchImpl(url, { method: 'GET', headers: headersAuth });
      const to = await ro.text();
      let jo = null;
      try {
        jo = to ? JSON.parse(to) : null;
      } catch (_) {}
      logPegaResponse(`PEGA LD Ponta B GET .../SelecaoDoSlot`, ro.status, jo, to);
      if (ro.ok) {
        slots = extractAgendamentoSlotsFromApiJson(jo);
        if (slots && slots.length) break;
      }
    }
  }
  if (!slots || slots.length === 0) {
    throw new Error('PEGA LD Ponta B: não foi possível obter Slots para SelecaoDoSlot');
  }

  console.log('[PEGA LD Ponta B] PATCH SelecaoDoSlot/refresh');
  const bodyRefresh = buildSelecaoDoSlotRefreshBody(slots);
  const hdrSlot = { ...headersJson, 'if-match': parsed5.pyMemo };
  const pathsRefresh = buildAgendamentoActionPaths(chaveCaseOrdem, 'SelecaoDoSlot/refresh');
  let resRef = null;
  let textRef = '';
  let urlRefUsed = '';
  let lastRef = 0;
  for (const p of pathsRefresh) {
    const url = `${root}${p}`;
    logPegaCurl('PATCH', url, hdrSlot, JSON.stringify(bodyRefresh));
    resRef = await fetchImpl(url, { method: 'PATCH', headers: hdrSlot, body: JSON.stringify(bodyRefresh) });
    textRef = await resRef.text();
    lastRef = resRef.status;
    let dataRef = null;
    try {
      dataRef = textRef ? JSON.parse(textRef) : null;
    } catch (_) {}
    logPegaResponse(`PEGA LD Ponta B .../SelecaoDoSlot/refresh`, resRef.status, dataRef, textRef);
    if (resRef.ok) {
      urlRefUsed = url;
      break;
    }
    if (resRef.status === 404 && pathsRefresh.indexOf(p) === 0) {
      console.log('[PEGA LD Ponta B]   ↳ 404 — tentando outra rota...');
      continue;
    }
    throw new Error(`PEGA LD Ponta B SelecaoDoSlot/refresh: HTTP ${resRef.status} — ${textRef?.slice(0, 800)}`);
  }
  if (!resRef?.ok) throw new Error(`PEGA LD Ponta B SelecaoDoSlot/refresh falhou: HTTP ${lastRef}`);

  let slotsAfterRefresh = null;
  try {
    const jRef = textRef ? JSON.parse(textRef) : null;
    slotsAfterRefresh = extractAgendamentoSlotsFromApiJson(jRef);
  } catch (_) {}
  const slotCount = (slotsAfterRefresh && slotsAfterRefresh.length) || slots.length;

  console.log('[PEGA LD Ponta B] GET obterdadosordem (pyMemo SelecaoDoSlot?viewType=form)');
  const sixth = await fetchObterDadosOrdemWithRetry(getObterDadosOrdemB, parseOpts, {
    isLinkDedicated: true,
    logTag: '[LD Ponta B] (pre-form)',
    expectedChaveCaseOrdem: chaveCaseOrdem,
  });
  if (!sixth.res.ok) throw new Error(`PEGA LD Ponta B obterdadosordem (pre-form): HTTP ${sixth.res.status}`);
  const parsed6 = sixth.parsed;
  if (!parsed6?.pyMemo) throw new Error('PEGA LD Ponta B: pyMemo ausente antes de SelecaoDoSlot?viewType=form');

  const slotSel = parseInt(
    String(agendamentoSlotListIndex ?? process.env.PEGA_AGENDAMENTO_SLOT_INDEX ?? '1').trim(),
    10,
  );
  const slotIndex = Number.isFinite(slotSel) && slotSel >= 1 ? slotSel : 1;

  console.log('[PEGA LD Ponta B] PATCH SelecaoDoSlot?viewType=form');
  const bodyConfirm = buildSelecaoDoSlotConfirmBody(slotCount, slotIndex);
  const hdrConfirm = { ...headersJson, 'if-match': parsed6.pyMemo };
  const pathsConfirm = buildAgendamentoActionPaths(chaveCaseOrdem, 'SelecaoDoSlot?viewType=form');
  let resConf = null;
  let textConf = '';
  let lastConf = 0;
  for (const p of pathsConfirm) {
    const url = `${root}${p}`;
    logPegaCurl('PATCH', url, hdrConfirm, JSON.stringify(bodyConfirm));
    resConf = await fetchImpl(url, { method: 'PATCH', headers: hdrConfirm, body: JSON.stringify(bodyConfirm) });
    textConf = await resConf.text();
    lastConf = resConf.status;
    let dataConf = null;
    try {
      dataConf = textConf ? JSON.parse(textConf) : null;
    } catch (_) {}
    logPegaResponse(`PEGA LD Ponta B .../SelecaoDoSlot?viewType=form`, resConf.status, dataConf, textConf);
    if (resConf.ok) break;
    if (resConf.status === 404 && pathsConfirm.indexOf(p) === 0) {
      console.log('[PEGA LD Ponta B]   ↳ 404 — tentando outra rota...');
      continue;
    }
    throw new Error(`PEGA LD Ponta B SelecaoDoSlot?viewType=form: HTTP ${resConf.status} — ${textConf?.slice(0, 800)}`);
  }
  if (!resConf?.ok) throw new Error(`PEGA LD Ponta B SelecaoDoSlot form falhou: HTTP ${lastConf}`);

  let pyMemoFinal = parsed6.pyMemo;
  const seventh = await fetchObterDadosOrdemWithRetry(getObterDadosOrdemB, parseOpts, {
    isLinkDedicated: true,
    logTag: '[LD Ponta B] (pós-agendamento)',
    expectedChaveCaseOrdem: chaveCaseOrdem,
  });
  if (seventh.res.ok && seventh.parsed?.pyMemo) {
    pyMemoFinal = seventh.parsed.pyMemo;
  }

  if (!skipCaseViews) {
    console.log('[PEGA LD Ponta B] PATCH views (pós-agendamento)');
    await patchCaseViewsB('pyDetailsTabContent', pyMemoFinal, chaveCaseOrdem);
    await patchCaseViewsB('DadosPedidoOSTab', pyMemoFinal, chaveCaseOrdem);
  }

  return {
    chaveCaseOrdem,
    agendamentoSelecaoPeriodoStatus: resPer.status,
    agendamentoSelecaoSlotRefreshStatus: resRef.status,
    agendamentoSelecaoSlotFormStatus: resConf.status,
    agendamentoSelecaoPeriodoUrl: urlPer,
    agendamentoSelecaoSlotRefreshUrl: urlRefUsed,
  };
}

/**
 * Link Dedicado — fases alinhadas ao doc "fluxo completo de link dedicado.txt", com diferenças operacionais intencionais:
 *
 * Doc vs este código (não são o mesmo trace HTTP):
 * - Após PATCH ConfigRede: aqui há GET `obterdadosordem` (Ponta A) para pyMemo; o doc passa ao GET da outra OS sem esse passo explícito.
 * - Antes do Designar/Configurar Ponta B: pausa `PEGA_LD_DELAY_BEFORE_PONTA_B_MS` (padrão 5s); não está no Postman.
 * - `obterdadosordem` com `[]`: retentativas (`PEGA_LD_OBTER_PONTA_B_*`, etc.); o doc mostra um único GET quando já há dados.
 * - ConfigRede: tenta ATV da Ponta A; se assignment 404, uma tentativa na Ponta B (`linkDedicatedConfigRedeFallbackOrdemServico`).
 * - Validação: só `ValidarExecucaoTecnica?viewType=form` + views; sem `OrdemServico.EscolasConectadas` salvo `PEGA_LD_VALIDAR_ORDEM_ESCOLAS=1`.
 * - Agendamento (`runPegaLinkDedicadoPontaBAgendamento`): após SelecaoDePeriodo o código pode GET antes das views; antes do form há GET
 *   extra; após form, outro GET — ordem não é idêntica ao recorte do ficheiro (mesmos PATCHs, ordem micro diferente).
 * - Cabeçalhos (Referer, pzCTkn, …) do browser não são enviados; só o necessário para a API.
 *
 * Ponta A até ConfigRede → Ponta B Designar+Configurar → Validação A → Validação B → EVC ConfigurarEvc → Agendamento A → Agendamento B.
 * Opcional: `getPegaBearerToken` por perna.
 */
async function runPegaLinkDedicadoDuasPontas(opts) {
  const {
    ordemServicoPontaA,
    ordemServicoPontaB,
    ordemServicoEVC,
    getPegaBearerToken,
    bearerToken: staticBearer,
    ...rest
  } = opts;
  if (!ordemServicoPontaA || !ordemServicoPontaB) {
    throw new Error('runPegaLinkDedicadoDuasPontas: ordemServicoPontaA e ordemServicoPontaB são obrigatórios');
  }

  async function bearerParaPerna(label) {
    if (typeof getPegaBearerToken === 'function') {
      const t = await getPegaBearerToken();
      if (!t || typeof t !== 'string' || !String(t).trim()) {
        throw new Error(
          `PEGA Link Dedicado (${label}): getPegaBearerToken não retornou access_token PEGA válido — verifique user.json → pega ou PEGA_CLIENT_ID / PEGA_BEARER_TOKEN`,
        );
      }
      return String(t).trim();
    }
    if (staticBearer == null || !String(staticBearer).trim()) {
      throw new Error('runPegaLinkDedicadoDuasPontas: informe `getPegaBearerToken` ou `bearerToken` (access_token PEGA)');
    }
    return String(staticBearer).trim();
  }

  const bearerA = await bearerParaPerna('Ponta A');
  console.log(
    '[PEGA LD] 1) Ponta A — até ConfiguracaoDeRede (obterdadosordem=' + String(ordemServicoPontaA).trim() + ')',
  );
  const pontaAteRede = await runPegaDesignacaoEConfiguracao({
    ...rest,
    bearerToken: bearerA,
    ordemServico: ordemServicoPontaA,
    flowVariant: 'linkDedicated',
    ldLeg: 'pontaA',
    linkDedicatedStopAfterConfigRede: true,
    linkDedicatedConfigRedeFallbackOrdemServico: ordemServicoPontaB,
    skipAgendamento: true,
  });

  const bearerB = await bearerParaPerna('Ponta B');
  const rawDelayB = process.env.PEGA_LD_DELAY_BEFORE_PONTA_B_MS;
  const delayBeforePontaBMs =
    rawDelayB !== undefined && String(rawDelayB).trim() !== ''
      ? Math.max(0, parseInt(String(rawDelayB).trim(), 10) || 0)
      : 5000;
  if (delayBeforePontaBMs > 0) {
    console.log(
      `[PEGA LD] Pausa ${delayBeforePontaBMs}ms antes da Ponta B (sincronização obterdadosordem no PEGA). Defina PEGA_LD_DELAY_BEFORE_PONTA_B_MS=0 para desligar.`,
    );
    await delay(delayBeforePontaBMs);
  }
  console.log('[PEGA LD] 2) Ponta B — Designar + Configurar (sem ConfigRede; obterdadosordem=' + String(ordemServicoPontaB).trim() + ')');
  const pontaBDesignarConfig = await runPegaLinkDedicadoPontaDesignarConfigurarOnly({
    ...rest,
    bearerToken: bearerB,
    ordemServico: ordemServicoPontaB,
    ldLeg: 'pontaB',
  });

  console.log('[PEGA LD] 3) Validação técnica + views — Ponta A');
  const validacaoA = await runPegaLinkDedicadoValidacaoFormEViews({
    ...rest,
    bearerToken: bearerA,
    ordemServico: ordemServicoPontaA,
    ldLeg: 'pontaA',
  });

  console.log('[PEGA LD] 4) Validação técnica + views — Ponta B');
  const validacaoB = await runPegaLinkDedicadoValidacaoFormEViews({
    ...rest,
    bearerToken: bearerB,
    ordemServico: ordemServicoPontaB,
    ldLeg: 'pontaB',
  });

  let evc = null;
  const evcOrd = ordemServicoEVC != null ? String(ordemServicoEVC).trim() : '';
  const skipEvc = String(process.env.PEGA_SKIP_LD_EVC || '').trim() === '1';
  if (evcOrd && !skipEvc) {
    console.log('[PEGA LD] 5) EVC — ConfigurarEvc (obterdadosordem=' + evcOrd + ')');
    try {
      evc = await runPegaLinkDedicadoConfigurarEvc({
        ...rest,
        bearerToken: await bearerParaPerna('EVC'),
        ordemServico: evcOrd,
      });
    } catch (err) {
      if (String(process.env.PEGA_LD_EVC_STRICT || '').trim() === '1') {
        throw err;
      }
      console.warn('[PEGA LD] EVC: ignorado (PEGA_LD_EVC_STRICT≠1):', err.message);
    }
  }

  console.log('[PEGA LD] 6) Agendamento — Ponta A');
  const agendamentoA = await runPegaLinkDedicadoPontaBAgendamento({
    ...rest,
    bearerToken: bearerA,
    ordemServico: ordemServicoPontaA,
    ldLeg: 'pontaA',
  });

  console.log('[PEGA LD] 7) Agendamento — Ponta B');
  const agendamentoB = await runPegaLinkDedicadoPontaBAgendamento({
    ...rest,
    bearerToken: bearerB,
    ordemServico: ordemServicoPontaB,
    ldLeg: 'pontaB',
  });

  const pontaA = {
    ...pontaAteRede,
    validacao: validacaoA,
    agendamento: agendamentoA,
  };
  const pontaB = {
    ...pontaBDesignarConfig,
    validacao: validacaoB,
    agendamento: agendamentoB,
  };

  return { pontaA, pontaB, evc };
}

module.exports = {
  runPegaDesignacaoEConfiguracao,
  runPegaLinkDedicadoPontaDesignarConfigurarOnly,
  runPegaLinkDedicadoValidacaoFormEViews,
  runPegaLinkDedicadoConfigurarEvc,
  runPegaLinkDedicadoPontaBAgendamento,
  runPegaLinkDedicadoDuasPontas,
  buildAssignmentPath,
  buildValidacaoRefreshPaths,
  buildValidacaoViewTypeFormPath,
  buildAgendamentoActionPaths,
  buildCaseViewRefreshPaths,
  buildConfiguracaoDeRedePaths,
  buildConfigurarEvcPaths,
  PEGA_TOTAL_STEPS,
  PEGA_TOTAL_STEPS_VPN,
  getPegaTotalSteps,
};
