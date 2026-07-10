const API = '/api';

async function api(path, options = {}) {
  const headers =
    typeof window !== 'undefined' && window.fdlVtalAuth
      ? window.fdlVtalAuth.authHeaders(options.headers || {})
      : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (window.fdlVtalAuth) {
      window.fdlVtalAuth.clearSession();
      window.location.replace('/login.html');
    }
    throw new Error('Sessão expirada — faça login novamente');
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const FORM_MESSAGE_SUCCESS_HIDE_MS = 6000;
const LAST_RUN_SUMMARY_HIDE_MS = 4000;

/**
 * Card BRM massa pronta usa `#brm-massa-pronta-fields` — formVariant `brm-massa-pronta` na API.
 */

/** Config carregada de GET /api/config (tipos de massa + permissões). */
let appConfig = { massCategories: [], user: null };
let massTypeToggleBusy = false;

function renderCategoryHint(hint) {
  if (!hint) return '';
  return hint
    .split(' · ')
    .map((part) => `<code>${escapeHtml(part.trim())}</code>`)
    .join(' · ');
}

function getSelectedEnvironment() {
  return document.getElementById('environment')?.value || 'ti';
}

function isTypeActiveInEnv(type, environment) {
  return type.activeEnvironments?.[environment] !== false;
}

function isTypeAutoDisabledInEnv(type, environment) {
  return type.autoDisabledByEnv?.[environment] === true;
}

function formatInactiveBadge(type, environment, { isAdmin }) {
  const envLabel = environment.toUpperCase();
  if (isTypeAutoDisabledInEnv(type, environment)) {
    const streak = type.failureStreakByEnv?.[environment] || 4;
    return `<span class="mass-type-badge mass-type-badge--auto" title="${escapeHtml(type.autoDisableReasonByEnv?.[environment] || '')}">Inativo (${streak} falhas técnicas)</span>`;
  }
  if (isAdmin) {
    return `<span class="mass-type-badge">Inativo em ${envLabel}</span>`;
  }
  return '';
}

function formatEnvSummary(activeEnvironments = {}) {
  return ['ti', 'trg']
    .map((env) => `${env.toUpperCase()}: ${activeEnvironments[env] !== false ? 'ativo' : 'off'}`)
    .join(' · ');
}

function flowStepClass(step) {
  return `choice-flow-step choice-flow-step--${String(step)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

function renderFlowPath(steps) {
  if (!Array.isArray(steps) || !steps.length) return '';
  const parts = steps.map((step, index) => {
    const arrow =
      index > 0 ? '<span class="choice-flow-arrow" aria-hidden="true">→</span>' : '';
    return `${arrow}<span class="${flowStepClass(step)}">${escapeHtml(step)}</span>`;
  });
  const label = escapeHtml(steps.join(' → '));
  return `<div class="choice-flow-path" aria-label="Fluxo: ${label}">${parts.join('')}</div>`;
}

function renderMassTypeCard(type, { isAdmin, environment, checkFirstActive }) {
  const activeInEnv = isTypeActiveInEnv(type, environment);
  const autoDisabled = isTypeAutoDisabledInEnv(type, environment);
  if (!isAdmin && !activeInEnv && !autoDisabled) return '';

  const envLabel = environment.toUpperCase();
  const cardClasses = ['choice-card', type.cardClass, !activeInEnv ? 'choice-card--inactive' : '']
    .filter(Boolean)
    .join(' ');
  const checked = activeInEnv && checkFirstActive.value ? ' checked' : '';
  if (activeInEnv && checkFirstActive.value) checkFirstActive.value = false;

  const toggleBtn = isAdmin
    ? `<button type="button" class="btn btn-secondary btn-sm mass-type-toggle" data-mass-type-id="${escapeHtml(type.id)}" data-mass-type-environment="${escapeHtml(environment)}" data-mass-type-active="${activeInEnv ? '1' : '0'}">${activeInEnv ? `Desativar em ${envLabel}` : `Ativar em ${envLabel}`}</button>`
    : '';
  const badge = !activeInEnv ? formatInactiveBadge(type, environment, { isAdmin }) : '';
  const envSummary = isAdmin
    ? `<span class="mass-type-env-summary">${escapeHtml(formatEnvSummary(type.activeEnvironments))}</span>`
    : '';

  const envData = type.activeEnvironments || {};
  return `
    <label class="${cardClasses}" data-mass-type-id="${escapeHtml(type.id)}" data-form-variant="${escapeHtml(type.formVariant || '')}" data-active-ti="${envData.ti !== false ? 'true' : 'false'}" data-active-trg="${envData.trg !== false ? 'true' : 'false'}">
      ${renderFlowPath(type.flowSteps)}
      <input type="radio" name="massType" value="${escapeHtml(type.id)}"${!activeInEnv ? ' disabled' : ''}${checked} />
      <span class="choice-title">${escapeHtml(type.label)}</span>
      ${badge}
      ${envSummary}
      <span class="choice-subtitle">${escapeHtml(type.subtitle || '')}</span>
      ${toggleBtn}
    </label>
  `;
}

function renderMassTypes(categories, isAdmin, environment = 'ti') {
  const root = document.getElementById('mass-types-root');
  if (!root) return;

  const env = environment || 'ti';
  const visibleCategories = categories
    .map((cat) => ({
      ...cat,
      types: cat.types.filter(
        (t) => isAdmin || isTypeActiveInEnv(t, env) || isTypeAutoDisabledInEnv(t, env),
      ),
    }))
    .filter((cat) => cat.types.length > 0);

  if (!visibleCategories.length) {
    root.innerHTML = `<p class="empty">Nenhum tipo de massa disponível em ${env.toUpperCase()}. ${isAdmin ? 'Ative fluxos em Admin ou use os botões abaixo.' : 'Contate o administrador.'}</p>`;
    return;
  }

  const checkFirstActive = { value: true };
  root.innerHTML = visibleCategories
    .map(
      (cat) => `
    <div class="flow-category" data-category="${escapeHtml(cat.id)}">
      <h3 class="flow-category__title">${escapeHtml(cat.title)}</h3>
      <p class="flow-category__hint">${renderCategoryHint(cat.hint)}</p>
      <div class="choice-group">
        ${cat.types.map((t) => renderMassTypeCard(t, { isAdmin, environment: env, checkFirstActive })).join('')}
      </div>
    </div>
  `
    )
    .join('');

  root.querySelectorAll('input[name="massType"]:not([disabled])').forEach((input) => {
    input.addEventListener('change', updateMassaProntaVisibility);
  });
  root.querySelectorAll('.mass-type-toggle').forEach((btn) => {
    btn.addEventListener('click', onMassTypeToggleClick);
  });
  updateMassaProntaVisibility();
}

function refreshMassTypesForEnvironment() {
  renderMassTypes(
    appConfig.massCategories || [],
    !!appConfig.user?.isPlatformAdmin,
    getSelectedEnvironment(),
  );
  updateMassaProntaEnvBadge();
}

function clearMassaProntaFields() {
  for (const id of ['accountOrganizationId', 'accountBusinessId', 'accountBillingId']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
}

function updateMassaProntaEnvBadge() {
  const badge = document.getElementById('massa-pronta-env-badge');
  if (badge) badge.textContent = getSelectedEnvironment().toUpperCase();
}

function isMassaProntaCustomOpen() {
  const block = document.getElementById('massa-pronta-custom-fields');
  return block && !block.hidden;
}

function setMassaProntaCustomOpen(open) {
  const panel = document.getElementById('massa-pronta-panel');
  const block = document.getElementById('massa-pronta-custom-fields');
  const btn = document.getElementById('massa-pronta-edit-toggle');
  if (!panel || !block) return;
  block.hidden = !open;
  panel.classList.toggle('massa-pronta-panel--editing', open);
  if (btn) {
    btn.textContent = open ? 'Ocultar personalização' : 'Personalizar contas (opcional)';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (!open) clearMassaProntaFields();
  else block.querySelector('.mp-field__input')?.focus({ preventScroll: true });
}

function resolveMassaProntaTripleEnv(environment) {
  const org = document.getElementById('accountOrganizationId')?.value?.trim() || '';
  const business = document.getElementById('accountBusinessId')?.value?.trim() || '';
  const billing = document.getElementById('accountBillingId')?.value?.trim() || '';
  return { org, business, billing };
}

function resolveMassTypeIdFromLabel(label) {
  const needle = String(label || '').trim();
  if (!needle) return null;
  for (const cat of appConfig.massCategories || []) {
    for (const type of cat.types || []) {
      if (type.label === needle) return type.id;
    }
  }
  return null;
}

function buildExtraEnvFromJobResult(r, jobData) {
  const ev = jobData?.envVars || {};
  const org = r.accountOrganizationId || ev.ACCOUNT_ORGANIZATION_ID || '';
  const business = r.accountBusinessId || ev.ACCOUNT_BUSINESS_ID || '';
  const billing = r.accountBillingId || ev.ACCOUNT_BILLING_ID || '';
  const extraEnv = {};
  if (org && business && billing) {
    extraEnv.START_FROM_QUOTE = ev.START_FROM_QUOTE || '1';
    extraEnv.ACCOUNT_ORGANIZATION_ID = org;
    extraEnv.ACCOUNT_BUSINESS_ID = business;
    extraEnv.ACCOUNT_BILLING_ID = billing;
  } else if (billing && !org && !business) {
    extraEnv.ACCOUNT_BILLING_ID = billing;
  }
  const region = ev.MASS_ADDRESS_REGION || ev.ORDER_UF;
  if (region) Object.assign(extraEnv, collectMassAddressEnvFromValue(region));
  return extraEnv;
}

function collectMassAddressEnvFromValue(region) {
  const r = String(region || 'SP').trim().toUpperCase() === 'RJ' ? 'RJ' : 'SP';
  return {
    MASS_ADDRESS_REGION: r,
    ORDER_UF: r,
    ORDER_CITY: r === 'RJ' ? 'Rio De Janeiro' : 'São Paulo',
  };
}

function collectMassAddressEnv(selectId = 'massAddressRegion') {
  const region = document.getElementById(selectId)?.value?.trim().toUpperCase() || 'SP';
  return collectMassAddressEnvFromValue(region);
}

async function rerunJobFromId(id) {
  const msg = document.getElementById('form-message');
  try {
    const job = await api(`/jobs/${id}`);
    const state = (job.state || job.status || '').toLowerCase();
    if (state !== 'completed') {
      showMessage(msg, 'Só é possível repetir jobs concluídos com sucesso.', 'error');
      return;
    }
    const massType =
      job.data?.massTypeId ||
      job.massTypeId ||
      resolveMassTypeIdFromLabel(job.data?.massTypeLabel || job.massType);
    const environment = job.data?.environment || job.environment;
    if (!massType || !environment) {
      showMessage(msg, 'Não foi possível identificar o tipo de massa deste job.', 'error');
      return;
    }
    const r = mergeJobResultFields(job);
    const extraEnv = buildExtraEnvFromJobResult(r, job.data);
    showMessage(msg, 'Enfileirando nova execução com os mesmos parâmetros…', 'pending');
    const { jobs, message } = await api('/jobs', {
      method: 'POST',
      body: JSON.stringify({ environment, massType, quantity: 1, extraEnv }),
    });
    closeModal();
    setLastRunSummary(message, jobs.length);
    showMessage(msg, 'Nova execução enfileirada.', 'success');
    loadJobs();
    document.querySelector('.card-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showMessage(msg, err.message || 'Erro ao repetir job.', 'error');
  }
}

async function loadAppConfig() {
  const data = await api('/config');
  appConfig = data;
  refreshMassTypesForEnvironment();
}

async function onMassTypeToggleClick(e) {
  e.preventDefault();
  e.stopPropagation();
  if (massTypeToggleBusy) return;
  const btn = e.currentTarget;
  const id = btn.dataset.massTypeId;
  const environment = btn.dataset.massTypeEnvironment || getSelectedEnvironment();
  const nextActive = btn.dataset.massTypeActive !== '1';
  massTypeToggleBusy = true;
  btn.disabled = true;
  try {
    await api('/auth/mass-types', {
      method: 'PUT',
      body: JSON.stringify({ types: [{ id, environment, active: nextActive }] }),
    });
    await loadAppConfig();
  } catch (err) {
    const msg = document.getElementById('form-message');
    showMessage(msg, err.message || 'Erro ao alterar tipo de massa', 'error');
  } finally {
    massTypeToggleBusy = false;
    btn.disabled = false;
  }
}

function getSelectedMassTypeMeta() {
  const input = document.querySelector('input[name="massType"]:checked:not([disabled])');
  if (!input) return null;
  const card = input.closest('.choice-card');
  return {
    id: input.value,
    formVariant: card?.dataset?.formVariant || null,
  };
}

/** Só a última requisição disparada por “Atualizar” atualiza o texto (evita “dança” com cliques em rajada). */
let jobsRefreshSeq = 0;

const JOBS_PAGE_SIZE = 10;
/** Última lista recebida da API — usada ao mudar de página sem novo fetch. */
let cachedJobsForList = [];
let cachedJobsMeta = { scope: 'user', historyDays: 7, showOwnerVt: false, showHistoryPanel: false };
/** Páginas 1-based por seção (`current` = na fila, `history` = banco). */
const jobsListPages = { current: 1, history: 1 };
let jobDetailPollTimer = null;
let jobsAutoRefreshTimer = null;
const JOB_LIVE_POLL_MS = 10_000;
const ORDER_STATUS_POLL_DEFAULT_ERROR =
  'O status da ordem não foi alterado para "Concluída" no Salesforce dentro do tempo esperado.';

const ORDER_STATUS_DISPLAY = {
  Activated: 'Concluída',
  'In Implementation': 'Em implantação',
  Draft: 'Rascunho',
};

function formatOrderStatusDisplay(status) {
  if (status == null || status === '') return status;
  const raw = String(status).trim();
  if (ORDER_STATUS_DISPLAY[raw]) return ORDER_STATUS_DISPLAY[raw];
  const key = Object.keys(ORDER_STATUS_DISPLAY).find((k) => k.toLowerCase() === raw.toLowerCase());
  return key ? ORDER_STATUS_DISPLAY[key] : raw;
}

function paginateSlice(items, page, pageSize) {
  const total = items.length;
  if (total === 0) {
    return { slice: [], page: 1, totalPages: 0, total: 0 };
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.max(1, Math.min(page, totalPages));
  const start = (p - 1) * pageSize;
  return {
    slice: items.slice(start, start + pageSize),
    page: p,
    totalPages,
    total,
  };
}

function renderPaginationNav(sectionKey, meta) {
  const { page, totalPages, total } = meta;
  if (totalPages <= 1) return '';
  const label = sectionKey === 'current' ? 'Execuções atuais' : 'Histórico';
  return `
    <nav class="jobs-pagination" aria-label="Paginação: ${label}">
      <button type="button" class="btn btn-secondary jobs-pagination__btn" data-jobs-paginate="${sectionKey}" data-jobs-action="prev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
      <span class="jobs-pagination__info">Página ${page} de ${totalPages} <span class="jobs-pagination__count">(${total} itens)</span></span>
      <button type="button" class="btn btn-secondary jobs-pagination__btn" data-jobs-paginate="${sectionKey}" data-jobs-action="next" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
    </nav>
  `;
}

function showMessage(el, text, type = '') {
  if (!el) return;
  clearTimeout(el._formMessageHideTimer);
  el._formMessageHideTimer = null;
  el.textContent = text;
  el.className = 'message' + (type ? ` ${type}` : '');
  el.hidden = !text;
  /* aria-live desligado: regiões polite/assertive fazem o browser rolar até a mensagem ao atualizar */
  el.setAttribute('aria-live', 'off');
  if (type === 'success' && text) {
    el._formMessageHideTimer = setTimeout(() => {
      showMessage(el, '', '');
    }, FORM_MESSAGE_SUCCESS_HIDE_MS);
  }
}

function setSubmitLoading(isLoading) {
  const btn = document.getElementById('btn-submit');
  if (!btn) return;
  btn.disabled = isLoading;
  btn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function setLastRunSummary(queueMessage, createdCount) {
  const wrap = document.getElementById('last-run-summary');
  const lineQueue = document.getElementById('last-run-queue');
  const lineCreated = document.getElementById('last-run-created');
  if (!wrap || !lineQueue || !lineCreated) return;
  clearTimeout(wrap._summaryHideTimer);
  wrap._summaryHideTimer = null;
  lineQueue.textContent = queueMessage || '';
  lineCreated.textContent = `${createdCount} job(s) criado(s).`;
  wrap.hidden = !(queueMessage || createdCount);
  if (!wrap.hidden) {
    wrap._summaryHideTimer = setTimeout(() => {
      wrap.hidden = true;
      lineQueue.textContent = '';
      lineCreated.textContent = '';
    }, LAST_RUN_SUMMARY_HIDE_MS);
  }
}

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function jobPrimaryPegaOs(j) {
  return (
    j.pegaOrdemServicoOsEVC ||
    j.pegaOrdemServicoOs ||
    j.pegaOrdemServicoOsPontaA ||
    j.pegaOrdemServicoOsPontaB ||
    null
  );
}

function jobLegPegaDisplay(j, osKey, caseKey) {
  return j[osKey] || j[caseKey] || null;
}

function jobHasLinkDedicadoPegaLegs(j) {
  return !!(
    j.pegaOrdemServicoOsPontaA ||
    j.pegaOrdemServicoOsPontaB ||
    j.pegaOrdemServicoOsEVC ||
    j.pegaCaseIdPontaA ||
    j.pegaCaseIdPontaB ||
    j.pegaCaseIdEVC
  );
}

function jobHasLinkDedicadoSubpedidos(j) {
  return !!(
    j.subOrderOrderNumberPontaA ||
    j.subOrderOrderNumberPontaB ||
    j.subOrderOrderNumberEVC
  );
}

function formatJobListLinkDedicadoSubpedidos(j) {
  if (!jobHasLinkDedicadoSubpedidos(j)) return null;
  const parts = [];
  if (j.subOrderOrderNumberPontaA) parts.push(`A: ${j.subOrderOrderNumberPontaA}`);
  if (j.subOrderOrderNumberPontaB) parts.push(`B: ${j.subOrderOrderNumberPontaB}`);
  if (j.subOrderOrderNumberEVC) parts.push(`EVC: ${j.subOrderOrderNumberEVC}`);
  return parts.length ? parts.join(' · ') : null;
}

function formatJobListResultSummary(j) {
  if (j.orderStatusPollFailed) {
    const err = j.orderStatusPollError || ORDER_STATUS_POLL_DEFAULT_ERROR;
    const short = err.length > 72 ? `${err.slice(0, 72)}…` : err;
    return `Erro: ${short}`;
  }
  const orderPart = j.orderNumber ? `Pedido: ${j.orderNumber}` : null;
  const statusPart = j.orderStatus ? `Status: ${formatOrderStatusDisplay(j.orderStatus)}` : null;
  const pegaSummary = formatJobListPegaSummary(j);
  const ldSubpedidos = !pegaSummary ? formatJobListLinkDedicadoSubpedidos(j) : null;
  const subpedidoPart =
    j.subOrderOrderNumber && !pegaSummary && !ldSubpedidos
      ? `Subpedido: ${j.subOrderOrderNumber}`
      : ldSubpedidos
        ? `Subpedidos: ${ldSubpedidos}`
        : null;

  const parts = [];
  if (orderPart) parts.push(orderPart);
  if (statusPart) parts.push(statusPart);
  if (pegaSummary) parts.push(`PEGA: ${pegaSummary}`);
  else if (subpedidoPart) parts.push(subpedidoPart);
  return parts.length ? parts.join(' · ') : null;
}

function formatJobListPegaSummary(j) {
  if (jobHasLinkDedicadoPegaLegs(j)) {
    const parts = [];
    const legA = jobLegPegaDisplay(j, 'pegaOrdemServicoOsPontaA', 'pegaCaseIdPontaA');
    const legB = jobLegPegaDisplay(j, 'pegaOrdemServicoOsPontaB', 'pegaCaseIdPontaB');
    const legEvc = jobLegPegaDisplay(j, 'pegaOrdemServicoOsEVC', 'pegaCaseIdEVC');
    if (legA) parts.push(`A: ${legA}`);
    if (legB) parts.push(`B: ${legB}`);
    if (legEvc) parts.push(`EVC: ${legEvc}`);
    if (parts.length) return parts.join(' · ');
  }
  return jobPrimaryPegaOs(j) || j.pegaCaseId || null;
}

function renderJobAccountsSection(r) {
  if (!r.accountOrganizationId && !r.accountBusinessId && !r.accountBillingId && !r.contactTecnicoId) {
    return '';
  }
  return `
      <div class="detail-row">
        <div class="detail-label">Contas</div>
        <div class="detail-value">
          ${r.accountOrganizationId ? `Conta Organization: ${escapeHtml(r.accountOrganizationId)}<br>` : ''}
          ${r.accountBusinessId ? `Conta Business: ${escapeHtml(r.accountBusinessId)}<br>` : ''}
          ${r.accountBillingId ? `Conta Billing: ${escapeHtml(r.accountBillingId)}<br>` : ''}
          ${r.contactTecnicoId ? `Contato técnico: ${escapeHtml(r.contactTecnicoId)}` : ''}
        </div>
      </div>`;
}

function renderJobSubpedidoDetailLines(r) {
  if (jobHasLinkDedicadoSubpedidos(r)) {
    const lines = [];
    if (r.subOrderOrderNumberPontaA) {
      lines.push(`Subpedido Ponta A (SF): ${escapeHtml(r.subOrderOrderNumberPontaA)}`);
    }
    if (r.subOrderOrderNumberPontaB) {
      lines.push(`Subpedido Ponta B (SF): ${escapeHtml(r.subOrderOrderNumberPontaB)}`);
    }
    if (r.subOrderOrderNumberEVC) {
      lines.push(`Subpedido EVC (SF): ${escapeHtml(r.subOrderOrderNumberEVC)}`);
    }
    return lines.length ? `${lines.join('<br>')}<br>` : '';
  }
  if (r.subOrderOrderNumber && !r.pegaOrdemServicoOs && !jobHasLinkDedicadoPegaLegs(r)) {
    return `Subpedido (SF): ${escapeHtml(r.subOrderOrderNumber)}<br>`;
  }
  return '';
}

function renderJobPegaDetailLines(r) {
  if (jobHasLinkDedicadoPegaLegs(r)) {
    const lines = [];
    const legA = jobLegPegaDisplay(r, 'pegaOrdemServicoOsPontaA', 'pegaCaseIdPontaA');
    const legB = jobLegPegaDisplay(r, 'pegaOrdemServicoOsPontaB', 'pegaCaseIdPontaB');
    const legEvc = jobLegPegaDisplay(r, 'pegaOrdemServicoOsEVC', 'pegaCaseIdEVC');
    if (legA) {
      lines.push(
        r.pegaOrdemServicoOsPontaA
          ? `PEGA Ponta A (OSS): ${escapeHtml(legA)}`
          : `PEGA Ponta A (caso): ${escapeHtml(legA)}`,
      );
    }
    if (legB) {
      lines.push(
        r.pegaOrdemServicoOsPontaB
          ? `PEGA Ponta B (OSS): ${escapeHtml(legB)}`
          : `PEGA Ponta B (caso): ${escapeHtml(legB)}`,
      );
    }
    if (legEvc) {
      lines.push(
        r.pegaOrdemServicoOsEVC
          ? `PEGA EVC (OSS): ${escapeHtml(legEvc)}`
          : `PEGA EVC (caso): ${escapeHtml(legEvc)}`,
      );
    }
    return lines.length ? `${lines.join('<br>')}<br>` : '';
  }
  if (r.pegaOrdemServicoOs) {
    return `PEGA Ordem (OSS): ${escapeHtml(r.pegaOrdemServicoOs)}<br>`;
  }
  return '';
}

function jobExecutedAtMs(j) {
  const raw = j?.finishedOn ?? j?.executedAt ?? j?.timestamp ?? 0;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function sortJobsByExecutionDate(jobs) {
  jobs.sort((a, b) => jobExecutedAtMs(b) - jobExecutedAtMs(a));
}

function formatJobCardTime(j, showOwnerVt = false) {
  const ts = j.finishedOn || j.timestamp;
  const isHistory = String(j.id).startsWith('hist-');
  let text = '—';
  if (ts) {
    const d = new Date(ts);
    if (isHistory) {
      text = d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } else {
      text = formatTime(ts);
    }
  }
  if (showOwnerVt && j.ownerVt) {
    text += ` · ${j.ownerVt}`;
  }
  return text;
}

function renderOwnerFilter(meta) {
  const wrap = document.getElementById('jobs-history-filters');
  const sel = document.getElementById('jobs-filter-owner');
  if (!wrap || !sel) return;
  if (!meta?.canFilterByUser) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const selected = meta.ownerFilter || sel.value || '';
  const owners = meta.historyOwners || [];
  sel.innerHTML =
    '<option value="">Todos os usuários</option>' +
    owners
      .map((vt) => {
        const v = escapeHtml(vt);
        return `<option value="${v}"${vt === selected ? ' selected' : ''}>${v}</option>`;
      })
      .join('');
}

function formatJobDisplayLabel(j, { showOwnerVt = false } = {}) {
  const num = j?.displayNumber;
  if (num != null && Number.isFinite(num)) {
    if (showOwnerVt && j.ownerVt) {
      return `${j.ownerVt} #${num}`;
    }
    return `#${num}`;
  }
  return `#${String(j?.id ?? '—')}`;
}

function renderJobCard(j, { showOwnerVt = false } = {}) {
  const status = (j.status || '').toLowerCase();
  const canCancel =
    typeof window !== 'undefined' &&
    window.fdlVtalAuth &&
    window.fdlVtalAuth.isPlatformAdmin();
  const isWaiting = status === 'waiting' || status === 'prioritized' || status === 'delayed';
  const isActive = status === 'active';
  const cancelBtn =
    canCancel && (isWaiting || isActive)
      ? `<button type="button" class="btn btn-secondary job-cancel-btn" data-job-id="${escapeHtml(String(j.id))}" title="${isActive ? 'Interromper execução' : 'Remover da fila'}">Cancelar</button>`
      : '';
  const rerunBtn =
    status === 'completed'
      ? `<button type="button" class="btn btn-secondary job-rerun-btn" data-job-id="${escapeHtml(String(j.id))}" title="Enfileirar novamente com os mesmos parâmetros">Gerar novamente</button>`
      : '';
  return `
    <article class="job-item" data-job-id="${j.id}" role="button" tabindex="0">
      <span class="job-id">${escapeHtml(formatJobDisplayLabel(j, { showOwnerVt }))}</span>
      <span class="job-type">${escapeHtml(j.massType || '—')}</span>
      <span class="job-env">${escapeHtml((j.environment || '').toUpperCase())}</span>
      <span class="job-status ${(j.status || '').toLowerCase()}">${statusLabel(j.status)}</span>
      <span class="job-time" title="Data de execução">${escapeHtml(formatJobCardTime(j, showOwnerVt))}</span>
      ${
        (() => {
          const resultSummary = formatJobListResultSummary(j);
          if (resultSummary) {
            const errClass = j.orderStatusPollFailed ? ' job-result--error' : '';
            return `<span class="job-result${errClass}">${escapeHtml(resultSummary)}</span>`;
          }
          return null;
        })() ||
        ((j.status === 'failed' || j.status === 'user_error') && j.error
            ? `<span class="job-result job-result--error${j.status === 'user_error' ? ' job-result--user-error' : ''}">${escapeHtml(j.error.length > 72 ? `${j.error.slice(0, 72)}…` : j.error)}</span>`
            : j.status === 'cancelled'
              ? `<span class="job-result job-result--muted">Cancelado</span>`
              : j.accountBillingId
              ? `<span class="job-result">Conta BRM: ${escapeHtml(j.accountBillingId)}</span>`
              : '<span class="job-result job-result--muted">—</span>')
      }
      <span class="job-actions">${rerunBtn}${cancelBtn}</span>
    </article>
  `;
}

function renderJobsList(jobs, meta = cachedJobsMeta) {
  const list = document.getElementById('jobs-list');
  cachedJobsForList = jobs;
  cachedJobsMeta = meta || cachedJobsMeta;
  const cardOpts = { showOwnerVt: !!meta?.showOwnerVt };

  if (!jobs.length) {
    list.innerHTML = '<p class="empty">Nenhum job encontrado no período.</p>';
    return;
  }

  const showHistoryPanel = !!meta?.showHistoryPanel;
  const liveJobs = jobs.filter((j) => !String(j.id).startsWith('hist-'));
  const historyJobs = jobs.filter((j) => String(j.id).startsWith('hist-'));

  const inFlight = liveJobs.filter((j) => {
    const s = (j.status || '').toLowerCase();
    return s === 'waiting' || s === 'prioritized' || s === 'delayed' || s === 'active';
  });
  let recentDone = liveJobs.filter((j) => {
    const s = (j.status || '').toLowerCase();
    return s !== 'waiting' && s !== 'prioritized' && s !== 'delayed' && s !== 'active';
  });

  /** Usuário comum: jobs persistidos entram na mesma lista de executados (sem seção Histórico). */
  if (!showHistoryPanel && historyJobs.length) {
    const seen = new Set(recentDone.map((j) => String(j.id)));
    const merged = [...recentDone];
    for (const j of historyJobs) {
      const id = String(j.id);
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(j);
      }
    }
    merged.sort((a, b) => jobExecutedAtMs(b) - jobExecutedAtMs(a));
    recentDone = merged;
  }

  const historyForPanel = showHistoryPanel ? [...historyJobs] : [];
  if (showHistoryPanel && historyForPanel.length > 1) {
    if (!meta?.ownerFilter) {
      sortJobsByExecutionDate(historyForPanel);
    } else {
      historyForPanel.sort((a, b) => (b.displayNumber || 0) - (a.displayNumber || 0));
    }
  }
  const histMeta = paginateSlice(historyForPanel, jobsListPages.history, JOBS_PAGE_SIZE);
  jobsListPages.history = histMeta.page;

  const doneTitle = showHistoryPanel
    ? 'Concluídos recentes <span class="jobs-section__hint">Detalhes completos (pedido, PEGA, contas)</span>'
    : 'Executados <span class="jobs-section__hint">Seus jobs finalizados (pedido, PEGA, contas)</span>';

  const sections = [];
  if (inFlight.length) {
    sections.push(`
      <div class="jobs-section">
        <p class="jobs-section__title">Na fila / executando</p>
        ${inFlight.map((j) => renderJobCard(j, cardOpts)).join('')}
      </div>
    `);
  }
  if (recentDone.length) {
    sections.push(`
      <div class="jobs-section">
        <p class="jobs-section__title">${doneTitle}</p>
        ${recentDone.map((j) => renderJobCard(j, cardOpts)).join('')}
      </div>
    `);
  }
  if (historyForPanel.length) {
    const historyHint =
      meta?.historyDays === 30
        ? 'Últimos 30 dias (todas as execuções)'
        : `Últimos ${meta?.historyDays || 7} dias`;
    sections.push(`
      <div class="jobs-section">
        <p class="jobs-section__title">Histórico <span class="jobs-section__hint">${escapeHtml(historyHint)}</span></p>
        ${histMeta.slice.map((j) => renderJobCard(j, cardOpts)).join('')}
        ${renderPaginationNav('history', histMeta)}
      </div>
    `);
  }

  list.innerHTML = sections.join('') || '<p class="empty">Nenhum job encontrado no período.</p>';

  list.querySelectorAll('.job-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.job-cancel-btn')) return;
      openJobDetail(el.dataset.jobId);
    });
    el.addEventListener('keydown', (e) => {
      if (e.target.closest('.job-cancel-btn')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openJobDetail(el.dataset.jobId);
      }
    });
  });
}

async function cancelQueuedJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return;
  if (!window.confirm(`Remover o job #${id} da fila?`)) return;
  const msg = document.getElementById('form-message');
  try {
    await api(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    showMessage(msg, `Job #${id} removido da fila.`, 'success');
    loadJobs({ fromUiRefresh: true });
  } catch (err) {
    showMessage(msg, err.message || 'Não foi possível cancelar o job.', 'error');
  }
}

function statusLabel(s) {
  const map = {
    waiting: 'Na fila',
    prioritized: 'Na fila',
    delayed: 'Na fila',
    active: 'Executando',
    completed: 'Sucesso',
    failed: 'Falha',
    user_error: 'Erro do usuário',
    cancelled: 'Cancelado',
  };
  return map[s?.toLowerCase()] || s || '—';
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Erro só após o job terminar em falha — nunca durante execução ou na fila. */
function showJobError(job, result) {
  const state = (job.state || '').toLowerCase();
  return (state === 'failed' || state === 'user_error') && !!(result?.error || job.failedReason);
}

function hasOrderStatusPollFailed(job, result) {
  const failed = !!(result?.orderStatusPollFailed ?? job.orderStatusPollFailed);
  if (!failed) return false;
  const status = formatOrderStatusDisplay(result?.orderStatus ?? job.orderStatus);
  if (status === 'Concluída') return false;
  return true;
}

function orderStatusPollErrorText(job, result) {
  return result?.orderStatusPollError ?? job.orderStatusPollError ?? ORDER_STATUS_POLL_DEFAULT_ERROR;
}

function jobErrorText(job, result) {
  return result?.error || job.failedReason || '';
}

async function loadJobs({ fromUiRefresh = false } = {}) {
  const list = document.getElementById('jobs-list');
  const statusEl = document.getElementById('jobs-refresh-status');
  let mySeq = 0;

  if (fromUiRefresh) {
    mySeq = ++jobsRefreshSeq;
    if (statusEl) {
      clearTimeout(statusEl._hideTimer);
      statusEl._hideTimer = null;
      statusEl.classList.remove('jobs-refresh-status--empty');
      statusEl.textContent = 'Atualizando lista…';
    }
    list?.classList.add('is-refreshing');
  }

  let ok = false;
  try {
    const ownerVt = document.getElementById('jobs-filter-owner')?.value?.trim();
    const qs = ownerVt ? `?ownerVt=${encodeURIComponent(ownerVt)}` : '';
    const { jobs, meta } = await api(`/jobs${qs}`);
    renderOwnerFilter(meta);
    renderJobsList(jobs, meta);
    scheduleJobsAutoRefresh(jobs);
    ok = true;
  } catch (e) {
    list.innerHTML = `<p class="empty error">Erro ao carregar: ${escapeHtml(e.message)}</p>`;
  } finally {
    if (!fromUiRefresh || mySeq !== jobsRefreshSeq) {
      return;
    }

    list?.classList.remove('is-refreshing');
    if (statusEl) {
      if (ok) {
        statusEl.classList.remove('jobs-refresh-status--empty');
        statusEl.textContent = 'Lista atualizada.';
        clearTimeout(statusEl._hideTimer);
        statusEl._hideTimer = setTimeout(() => {
          if (mySeq !== jobsRefreshSeq) return;
          statusEl.textContent = '';
          statusEl.classList.add('jobs-refresh-status--empty');
        }, 2200);
      } else {
        statusEl.classList.remove('jobs-refresh-status--empty');
        statusEl.textContent = 'Não foi possível atualizar.';
        clearTimeout(statusEl._hideTimer);
        statusEl._hideTimer = setTimeout(() => {
          if (mySeq !== jobsRefreshSeq) return;
          statusEl.textContent = '';
          statusEl.classList.add('jobs-refresh-status--empty');
        }, 4000);
      }
    }
    document.getElementById('btn-refresh')?.focus({ preventScroll: true });
  }
}

function mergeJobResultFields(job) {
  const r = job.result || {};
  const ev = job.data?.envVars || {};
  return {
    ...r,
    orderId: r.orderId ?? job.orderId ?? null,
    orderNumber: r.orderNumber ?? job.orderNumber ?? null,
    orderStatus: r.orderStatus ?? job.orderStatus ?? null,
    accountOrganizationId:
      r.accountOrganizationId ?? job.accountOrganizationId ?? ev.ACCOUNT_ORGANIZATION_ID ?? null,
    accountBusinessId:
      r.accountBusinessId ?? job.accountBusinessId ?? ev.ACCOUNT_BUSINESS_ID ?? null,
    accountBillingId:
      r.accountBillingId ?? job.accountBillingId ?? ev.ACCOUNT_BILLING_ID ?? null,
    contactTecnicoId:
      r.contactTecnicoId ?? job.contactTecnicoId ?? ev.CONTACT_TECNICO_ID ?? null,
    pegaCaseId: r.pegaCaseId ?? job.pegaCaseId ?? null,
    pegaCaseIdPontaA: r.pegaCaseIdPontaA ?? job.pegaCaseIdPontaA ?? null,
    pegaCaseIdPontaB: r.pegaCaseIdPontaB ?? job.pegaCaseIdPontaB ?? null,
    pegaCaseIdEVC: r.pegaCaseIdEVC ?? job.pegaCaseIdEVC ?? null,
    pegaOrdemServicoOs: r.pegaOrdemServicoOs ?? job.pegaOrdemServicoOs ?? null,
    pegaOrdemServicoOsPontaA: r.pegaOrdemServicoOsPontaA ?? job.pegaOrdemServicoOsPontaA ?? null,
    pegaOrdemServicoOsPontaB: r.pegaOrdemServicoOsPontaB ?? job.pegaOrdemServicoOsPontaB ?? null,
    pegaOrdemServicoOsEVC: r.pegaOrdemServicoOsEVC ?? job.pegaOrdemServicoOsEVC ?? null,
    subOrderOrderNumber: r.subOrderOrderNumber ?? job.subOrderOrderNumber ?? null,
    subOrderOrderNumberPontaA: r.subOrderOrderNumberPontaA ?? job.subOrderOrderNumberPontaA ?? null,
    subOrderOrderNumberPontaB: r.subOrderOrderNumberPontaB ?? job.subOrderOrderNumberPontaB ?? null,
    subOrderOrderNumberEVC: r.subOrderOrderNumberEVC ?? job.subOrderOrderNumberEVC ?? null,
    orderStatusPollFailed: r.orderStatusPollFailed ?? job.orderStatusPollFailed ?? false,
    orderStatusPollError: r.orderStatusPollError ?? job.orderStatusPollError ?? null,
  };
}

function stopJobDetailPoll() {
  if (jobDetailPollTimer) {
    clearInterval(jobDetailPollTimer);
    jobDetailPollTimer = null;
  }
}

function isJobInFlight(job) {
  const s = (job?.status || '').toLowerCase();
  return s === 'waiting' || s === 'prioritized' || s === 'delayed' || s === 'active';
}

function isJobTerminal(job) {
  const s = (job?.status || '').toLowerCase();
  return s === 'completed' || s === 'failed' || s === 'user_error' || s === 'cancelled';
}

/** Job saiu de fila/executando → estado final (refresh da lista, não durante poll SF). */
function jobTransitionedToTerminal(prevJob, nextJob) {
  if (!prevJob || !nextJob) return false;
  if (String(prevJob.id) !== String(nextJob.id)) return false;
  return isJobInFlight(prevJob) && isJobTerminal(nextJob);
}

function scheduleJobsAutoRefresh(jobs) {
  const hasInFlight = (jobs || []).some(isJobInFlight);
  if (!hasInFlight) {
    if (jobsAutoRefreshTimer) {
      clearInterval(jobsAutoRefreshTimer);
      jobsAutoRefreshTimer = null;
    }
    return;
  }
  if (jobsAutoRefreshTimer) return;
  jobsAutoRefreshTimer = setInterval(async () => {
    try {
      const ownerVt = document.getElementById('jobs-filter-owner')?.value?.trim();
      const qs = ownerVt ? `?ownerVt=${encodeURIComponent(ownerVt)}` : '';
      const { jobs: freshJobs } = await api(`/jobs${qs}`);
      const prevById = new Map(cachedJobsForList.map((j) => [String(j.id), j]));
      const settled = freshJobs.some((j) => {
        const prev = prevById.get(String(j.id));
        return jobTransitionedToTerminal(prev, j);
      });
      if (settled) {
        loadJobs({ fromUiRefresh: true });
      } else {
        scheduleJobsAutoRefresh(freshJobs);
      }
    } catch (_) {
      /* próximo ciclo tenta de novo */
    }
  }, JOB_LIVE_POLL_MS);
}

function renderJobDetailBody(job, id) {
  const r = mergeJobResultFields(job);
  const hasOrderResult =
    r.orderId ||
    r.orderNumber ||
    r.subOrderOrderNumber ||
    jobHasLinkDedicadoSubpedidos(r) ||
    r.pegaCaseId ||
    r.pegaOrdemServicoOs ||
    jobHasLinkDedicadoPegaLegs(r);
  const isRunning =
    job.state === 'active' ||
    job.state === 'waiting' ||
    job.state === 'prioritized' ||
    job.state === 'delayed' ||
    job.status === 'active' ||
    job.status === 'waiting' ||
    job.status === 'prioritized' ||
    job.status === 'delayed';
  const statusPollFailed = hasOrderStatusPollFailed(job, r);
  const progressHint = statusPollFailed
    ? orderStatusPollErrorText(job, r)
    : hasOrderResult
      ? 'Aguardando atualização do status no Salesforce (atualiza a cada 10s)…'
      : 'Em execução — o resultado aparecerá conforme o fluxo avança.';

  return `
      <div class="detail-row">
        <div class="detail-label">Status</div>
        <div class="detail-value"><span class="job-status ${(job.state || '').toLowerCase()}">${statusLabel(job.state)}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Tipo / Ambiente</div>
        <div class="detail-value">${escapeHtml(job.data?.massTypeLabel || '—')} / ${escapeHtml((job.data?.environment || '').toUpperCase())}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Horário</div>
        <div class="detail-value">${formatTime(job.timestamp)} — ${job.finishedOn ? 'Finalizado ' + formatTime(job.finishedOn) : 'Em execução'}</div>
      </div>
      ${renderJobAccountsSection(r)}
      ${
        hasOrderResult ? `
      <div class="detail-row">
        <div class="detail-label">Resultado</div>
        <div class="detail-value">
          ${r.orderId ? `OrderId: ${escapeHtml(r.orderId)}<br>` : ''}
          ${r.orderNumber ? `OrderNumber (pedido): ${escapeHtml(r.orderNumber)}<br>` : ''}
          ${r.orderStatus ? `Status: ${escapeHtml(formatOrderStatusDisplay(r.orderStatus))}<br>` : ''}
          ${renderJobSubpedidoDetailLines(r)}
          ${renderJobPegaDetailLines(r)}
          ${r.pegaCaseId && !jobHasLinkDedicadoPegaLegs(r) ? `PEGA Caso: ${escapeHtml(r.pegaCaseId)}<br>` : ''}
        </div>
      </div>
          ` : ''
      }
      ${job.state === 'cancelled' ? `
      <div class="detail-row">
        <div class="detail-label">Observação</div>
        <div class="detail-value">Execução cancelada pelo usuário.</div>
      </div>
      ` : showJobError(job, r) ? `
      <div class="detail-row">
        <div class="detail-label">${(job.state || '').toLowerCase() === 'user_error' ? 'Erro do usuário' : 'Erro'}</div>
        <div class="detail-value" style="color: ${(job.state || '').toLowerCase() === 'user_error' ? 'var(--warning, #f59e0b)' : 'var(--error)'};">${escapeHtml(jobErrorText(job, r))}</div>
      </div>
      ` : statusPollFailed ? `
      <div class="detail-row">
        <div class="detail-label">Erro</div>
        <div class="detail-value" style="color: var(--error);">${escapeHtml(orderStatusPollErrorText(job, r))}</div>
      </div>
      ` : isRunning ? `
      <div class="detail-row">
        <div class="detail-label">Progresso</div>
        <div class="detail-value">${escapeHtml(progressHint)}</div>
      </div>
      ` : ''}
      ${
        (job.state || job.status || '').toLowerCase() === 'completed' && !showJobError(job, r) && !statusPollFailed
          ? `
      <div class="detail-row detail-row--actions">
        <button type="button" class="btn btn-primary job-rerun-btn" data-job-id="${escapeHtml(String(id))}">Gerar massa novamente</button>
        <p class="detail-rerun-hint">Cria um <strong>novo job</strong> com o mesmo tipo, ambiente e contas desta execução.</p>
      </div>
      `
          : ''
      }
      <p class="card-hint" style="margin-top: 1rem;">
        Logs completos (stdout/stderr) ficam apenas no terminal da API ou do worker — não são exibidos aqui por desempenho e segurança.
      </p>
    `;
}

async function openJobDetail(id) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  stopJobDetailPoll();
  modal.hidden = false;
  const cached = cachedJobsForList.find((j) => String(j.id) === String(id));
  title.textContent = cached
    ? `Job ${formatJobDisplayLabel(cached, { showOwnerVt: !!cachedJobsMeta?.showOwnerVt })}`
    : `Job #${id}`;
  body.innerHTML = '<p>Carregando…</p>';

  const refreshDetail = async () => {
    try {
      const job = await api(`/jobs/${id}`);
      if (job.displayNumber != null) {
        title.textContent = `Job ${formatJobDisplayLabel(
          { ...job, ownerVt: job.ownerVt || job.data?.createdByVt },
          { showOwnerVt: !!cachedJobsMeta?.showOwnerVt },
        )}`;
      }
      body.innerHTML = renderJobDetailBody(job, id);
      const state = (job.state || job.status || '').toLowerCase();
      if (state !== 'active' && state !== 'waiting' && state !== 'prioritized' && state !== 'delayed') {
        stopJobDetailPoll();
        loadJobs({ fromUiRefresh: true });
      }
    } catch (e) {
      body.innerHTML = `<p class="error">Erro ao carregar job: ${escapeHtml(e.message)}</p>`;
      stopJobDetailPoll();
    }
  };

  await refreshDetail();
  jobDetailPollTimer = setInterval(refreshDetail, JOB_LIVE_POLL_MS);
}

function closeModal() {
  stopJobDetailPoll();
  document.getElementById('modal').hidden = true;
}

/**
 * Lê e valida a seleção do formulário (tipo de massa, ambiente, quantidade, contas).
 * Retorna { environment, massType, quantity, extraEnv } ou null (após exibir a mensagem de erro).
 */
function collectMassSelection(msg) {
  const form = document.getElementById('form-mass');
  const environment = form.environment.value;
  const massType = form.massType.value;
  const quantity = parseInt(form.quantity.value, 10) || 1;
  const selectedMeta = getSelectedMassTypeMeta();

  if (!massType || !selectedMeta) {
    showMessage(msg, 'Selecione um tipo de massa disponível.', 'error');
    return null;
  }

  let extraEnv = { ...collectMassAddressEnv() };
  if (selectedMeta.formVariant === 'massa-pronta-triple') {
    const { org, business, billing } = resolveMassaProntaTripleEnv(environment);
    if (!org || !business || !billing) {
      showMessage(msg, 'Informe Organization, Business e Billing da massa pronta.', 'error');
      return null;
    }
    extraEnv = {
      ...extraEnv,
      START_FROM_QUOTE: '1',
      ACCOUNT_ORGANIZATION_ID: org,
      ACCOUNT_BUSINESS_ID: business,
      ACCOUNT_BILLING_ID: billing,
    };
  } else if (selectedMeta.formVariant === 'brm-massa-pronta') {
    const billing = document.getElementById('accountBillingIdBrmOnly')?.value?.trim();
    if (!billing) {
      showMessage(msg, 'Informe o Id da conta Billing para ativar no BRM.', 'error');
      return null;
    }
    extraEnv = { ACCOUNT_BILLING_ID: billing };
  }

  const effectiveQuantity = selectedMeta.formVariant === 'brm-massa-pronta' ? 1 : quantity;
  return { environment, massType, quantity: effectiveQuantity, extraEnv };
}

async function submitForm(e) {
  e.preventDefault();
  const msg = document.getElementById('form-message');
  const selection = collectMassSelection(msg);
  if (!selection) return;

  setSubmitLoading(true);
  showMessage(
    msg,
    'Pedido recebido — enfileirando os jobs na fila. Aguarde um instante.',
    'pending'
  );

  try {
    const { jobs, message } = await api('/jobs', {
      method: 'POST',
      body: JSON.stringify(selection),
    });
    setLastRunSummary(message, jobs.length);
    showMessage(msg, 'Enfileirado com sucesso.', 'success');
    loadJobs();
  } catch (err) {
    showMessage(msg, err.message || 'Erro ao enfileirar.', 'error');
  } finally {
    setSubmitLoading(false);
  }
}

document.getElementById('form-mass').addEventListener('submit', submitForm);
document.getElementById('btn-refresh').addEventListener('click', () => loadJobs({ fromUiRefresh: true }));
document.getElementById('jobs-filter-owner')?.addEventListener('change', () => {
  jobsListPages.history = 1;
  loadJobs({ fromUiRefresh: true });
});
document.getElementById('jobs-list')?.addEventListener('click', (e) => {
  const rerunBtn = e.target.closest('.job-rerun-btn');
  if (rerunBtn) {
    e.preventDefault();
    e.stopPropagation();
    rerunJobFromId(rerunBtn.dataset.jobId);
    return;
  }
  const cancelBtn = e.target.closest('.job-cancel-btn');
  if (cancelBtn) {
    e.preventDefault();
    e.stopPropagation();
    cancelQueuedJob(cancelBtn.dataset.jobId);
    return;
  }
  const btn = e.target.closest('[data-jobs-paginate]');
  if (!btn || btn.disabled) return;
  const section = btn.dataset.jobsPaginate;
  const action = btn.dataset.jobsAction;
  if (section !== 'current' && section !== 'history') return;
  if (action === 'prev') jobsListPages[section] = Math.max(1, jobsListPages[section] - 1);
  else if (action === 'next') jobsListPages[section] += 1;
  else return;
  renderJobsList(cachedJobsForList, cachedJobsMeta);
});
document.getElementById('modal-close').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
document.getElementById('modal-body')?.addEventListener('click', (e) => {
  const rerunBtn = e.target.closest('.job-rerun-btn');
  if (rerunBtn) {
    e.preventDefault();
    rerunJobFromId(rerunBtn.dataset.jobId);
  }
});

function setMassaProntaInputsActive(active) {
  for (const id of ['accountOrganizationId', 'accountBusinessId', 'accountBillingId']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.required = active;
    el.disabled = !active;
  }
}

function updateMassaProntaVisibility() {
  const meta = getSelectedMassTypeMeta();
  const block = document.getElementById('massa-pronta-fields');
  const brmBlock = document.getElementById('brm-massa-pronta-fields');
  if (!block) return;
  const showTriple = meta?.formVariant === 'massa-pronta-triple';
  const showBrm = meta?.formVariant === 'brm-massa-pronta';
  block.hidden = !showTriple;
  setMassaProntaInputsActive(showTriple);
  if (brmBlock) {
    brmBlock.hidden = !showBrm;
  }
  if (showTriple) {
    updateMassaProntaEnvBadge();
  }
  const sidebar = document.querySelector('.form-layout__sidebar');
  if (showTriple || showBrm) {
    if (window.matchMedia('(max-width: 879px)').matches && sidebar) {
      sidebar.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }
}


/** Filtra cards por texto (útil com muitos tipos de massa). */
const massTypeFilter = document.getElementById('mass-type-filter');
if (massTypeFilter) {
  massTypeFilter.addEventListener('input', () => {
    const q = massTypeFilter.value.trim().toLowerCase();
    document.querySelectorAll('#mass-types-root .flow-category').forEach((cat) => {
      const cards = cat.querySelectorAll('.choice-card');
      let anyVisible = false;
      cards.forEach((card) => {
        const match = !q || card.textContent.toLowerCase().includes(q);
        card.style.display = match ? '' : 'none';
        if (match) anyVisible = true;
      });
      cat.style.display = !q || anyVisible ? '' : 'none';
    });
  });
}

loadAppConfig().catch((err) => {
  const root = document.getElementById('mass-types-root');
  if (root) root.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
});
document.getElementById('environment')?.addEventListener('change', refreshMassTypesForEnvironment);
loadJobs();
