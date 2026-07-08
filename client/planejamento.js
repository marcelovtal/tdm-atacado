import { api, escapeHtml, showMessage, collectMassAddressEnv } from './shared.js';

let appConfig = { massCategories: [], user: null };

/* ===================== Tabs ===================== */

function setActiveTab(tab) {
  const tabs = ['schedule', 'reservation'];
  tabs.forEach((t) => {
    const btn = document.querySelector(`[data-tab="${t}"]`);
    const panel = document.getElementById(`tab-panel-${t}`);
    const active = t === tab;
    if (btn) {
      btn.classList.toggle('planning-tabs__btn--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (panel) panel.hidden = !active;
  });
  if (tab === 'schedule') loadSchedules();
  if (tab === 'reservation') loadReservations();
}

/* ===================== Mass types ===================== */

function getSelectedEnvironment() {
  return document.getElementById('schedule-environment')?.value || 'ti';
}

function isTypeActiveInEnv(type, environment) {
  return type.activeEnvironments?.[environment] !== false;
}

function isTypeAutoDisabledInEnv(type, environment) {
  return type.autoDisabledByEnv?.[environment] === true;
}

function getSelectedMassTypeMetas() {
  const root = document.getElementById('schedule-mass-types-root');
  if (!root) return [];
  return [...root.querySelectorAll('input[type="checkbox"]:checked:not([disabled])')].map((input) => ({
    id: input.value,
    label: input.dataset.label || input.value,
    formVariant: input.dataset.formVariant || null,
  }));
}

function renderPlanningMassTypes() {
  const root = document.getElementById('schedule-mass-types-root');
  if (!root) return;
  const env = getSelectedEnvironment();
  const isAdmin = !!appConfig.user?.isPlatformAdmin;
  const previouslyChecked = new Set(
    [...root.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value),
  );

  const visibleCategories = (appConfig.massCategories || [])
    .map((cat) => ({
      ...cat,
      types: cat.types.filter(
        (t) => isAdmin || isTypeActiveInEnv(t, env) || isTypeAutoDisabledInEnv(t, env),
      ),
    }))
    .filter((cat) => cat.types.length > 0);

  if (!visibleCategories.length) {
    root.innerHTML = `<p class="empty">Nenhum tipo disponível em ${env.toUpperCase()}.</p>`;
    return;
  }

  root.innerHTML = visibleCategories
    .map(
      (cat) => `
    <div class="planning-mass-category" data-category="${escapeHtml(cat.id)}">
      <h4 class="planning-mass-category__title">${escapeHtml(cat.title)}</h4>
      <div class="planning-mass-category__grid">
        ${cat.types
          .map((type) => {
            const activeInEnv = isTypeActiveInEnv(type, env);
            const autoDisabled = isTypeAutoDisabledInEnv(type, env);
            const checked = previouslyChecked.has(type.id);
            const autoBadge = !activeInEnv && autoDisabled
              ? `<span class="mass-type-badge mass-type-badge--auto">Inativo (${type.failureStreakByEnv?.[env] || 4} falhas técnicas)</span>`
              : '';
            return `
          <label class="planning-mass-card${activeInEnv ? '' : ' planning-mass-card--inactive'}">
            <input type="checkbox" value="${escapeHtml(type.id)}" data-label="${escapeHtml(type.label)}" data-form-variant="${escapeHtml(type.formVariant || '')}"${activeInEnv ? '' : ' disabled'}${checked && activeInEnv ? ' checked' : ''} />
            <span class="planning-mass-card__body">
              <span class="planning-mass-card__title">${escapeHtml(type.label)}</span>
              ${autoBadge}
              ${type.subtitle ? `<span class="planning-mass-card__sub">${escapeHtml(type.subtitle)}</span>` : ''}
            </span>
          </label>`;
          })
          .join('')}
      </div>
    </div>`,
    )
    .join('');

  root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', updateAccountsVisibility);
  });
  applyMassTypeFilter();
  updateAccountsVisibility();
}

function applyMassTypeFilter() {
  const q = document.getElementById('schedule-mass-filter')?.value?.trim().toLowerCase() || '';
  document.querySelectorAll('#schedule-mass-types-root .planning-mass-category').forEach((cat) => {
    const cards = cat.querySelectorAll('.planning-mass-card');
    let anyVisible = false;
    cards.forEach((card) => {
      const match = !q || card.textContent.toLowerCase().includes(q);
      card.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    cat.style.display = anyVisible ? '' : 'none';
  });
}

function updateAccountsVisibility() {
  const metas = getSelectedMassTypeMetas();
  const tripleBlock = document.getElementById('schedule-massa-pronta-fields');
  const brmBlock = document.getElementById('schedule-brm-fields');
  const badge = document.getElementById('schedule-env-badge');
  const showTriple = metas.some((m) => m.formVariant === 'massa-pronta-triple');
  const showBrm = metas.some((m) => m.formVariant === 'brm-massa-pronta');
  if (tripleBlock) tripleBlock.hidden = !showTriple;
  if (brmBlock) brmBlock.hidden = !showBrm;
  if (badge) badge.textContent = getSelectedEnvironment().toUpperCase();
}

function buildExtraEnv(metas, msgEl) {
  const needsTriple = metas.some((m) => m.formVariant === 'massa-pronta-triple');
  const needsBrm = metas.some((m) => m.formVariant === 'brm-massa-pronta');
  if (needsTriple && needsBrm) {
    showMessage(msgEl, 'Não é possível agendar fluxos BRM junto com massa pronta triple no mesmo agendamento.', 'error');
    return null;
  }
  if (needsTriple) {
    const org = document.getElementById('schedule-account-org')?.value?.trim() || '';
    const business = document.getElementById('schedule-account-business')?.value?.trim() || '';
    const billing = document.getElementById('schedule-account-billing')?.value?.trim() || '';
    if (!org || !business || !billing) {
      showMessage(msgEl, 'Informe Organization, Business e Billing da massa pronta.', 'error');
      return null;
    }
    return {
      ...collectMassAddressEnv('schedule-mass-address-region'),
      START_FROM_QUOTE: '1',
      ACCOUNT_ORGANIZATION_ID: org,
      ACCOUNT_BUSINESS_ID: business,
      ACCOUNT_BILLING_ID: billing,
    };
  }
  if (needsBrm) {
    const billing = document.getElementById('schedule-account-brm')?.value?.trim();
    if (!billing) {
      showMessage(msgEl, 'Informe o Id da conta Billing para ativar no BRM.', 'error');
      return null;
    }
    return { ...collectMassAddressEnv('schedule-mass-address-region'), ACCOUNT_BILLING_ID: billing };
  }
  return collectMassAddressEnv('schedule-mass-address-region');
}

async function submitScheduleForm(e) {
  e.preventDefault();
  const msgEl = document.getElementById('schedule-form-message');
  const environment = getSelectedEnvironment();
  const quantity = parseInt(document.getElementById('schedule-quantity')?.value, 10) || 1;
  const metas = getSelectedMassTypeMetas();
  if (!metas.length) {
    showMessage(msgEl, 'Selecione ao menos um tipo de massa.', 'error');
    return;
  }
  const extraEnv = buildExtraEnv(metas, msgEl);
  if (extraEnv === null) return;

  const input = document.getElementById('schedule-at');
  const value = input?.value;
  if (!value) {
    showMessage(msgEl, 'Escolha a data e hora do agendamento.', 'error');
    input?.focus();
    return;
  }
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) {
    showMessage(msgEl, 'Data/hora inválida.', 'error');
    return;
  }
  if (when.getTime() <= Date.now()) {
    showMessage(msgEl, 'O horário precisa ser no futuro.', 'error');
    return;
  }

  const hasBrm = metas.some((m) => m.formVariant === 'brm-massa-pronta');
  const btn = document.getElementById('btn-schedule-submit');
  if (btn) btn.disabled = true;
  showMessage(msgEl, 'Criando agendamento…', 'pending');
  try {
    const { message } = await api('/schedules', {
      method: 'POST',
      body: JSON.stringify({
        environment,
        massTypes: metas.map((m) => ({ id: m.id, label: m.label })),
        quantity: hasBrm ? 1 : quantity,
        extraEnv,
        scheduledAt: when.toISOString(),
      }),
    });
    showMessage(msgEl, message || 'Agendamento criado.', 'success');
    loadSchedules();
  } catch (err) {
    showMessage(msgEl, err.message || 'Erro ao criar agendamento.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ===================== Agendamentos (lista) ===================== */

const SCHEDULE_STATUS_LABEL = {
  pending: 'Agendado',
  processing: 'Disparando…',
  done: 'Disparado',
  error: 'Falha',
  cancelled: 'Cancelado',
};

function formatScheduleDateTime(value) {
  if (!value) return '—';
  const d = new Date(/\d{4}-\d{2}-\d{2}[ T]/.test(String(value)) ? String(value).replace(' ', 'T') : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function buildScheduleTitle(s, massTypes, showOwnerVt) {
  const owner = showOwnerVt && s.createdByVt ? `${escapeHtml(s.createdByVt)} · ` : '';
  if (massTypes.length > 1) {
    return `${owner}${massTypes.length} tipos de massa`;
  }
  const single = massTypes[0]?.label || s.massType || '—';
  return `${owner}${escapeHtml(single)}`;
}

function renderScheduleCard(s, showOwnerVt) {
  const status = (s.status || '').toLowerCase();
  const statusLabelText = SCHEDULE_STATUS_LABEL[status] || status;
  const massTypes = Array.isArray(s.massTypes) && s.massTypes.length ? s.massTypes : [];
  const cancelBtn =
    status === 'pending'
      ? `<button type="button" class="btn btn-secondary btn-sm schedule-cancel-btn" data-schedule-id="${escapeHtml(String(s.id))}">Cancelar</button>`
      : '';
  const hasManyTypes = massTypes.length > 1;
  const typeChips = hasManyTypes
    ? `<div class="planning-item__chips-scroll"><ul class="planning-item__chips" aria-label="Tipos de massa agendados">${massTypes.map((t) => `<li>${escapeHtml(t.label || t.id)}</li>`).join('')}</ul></div>`
    : '';
  const itemClass = hasManyTypes
    ? 'planning-item planning-item--schedule planning-item--multi'
    : 'planning-item planning-item--schedule';
  return `
    <article class="${itemClass}" data-schedule-id="${escapeHtml(String(s.id))}">
      <div class="planning-item__main">
        <div class="planning-item__top">
          <span class="planning-item__id">#${escapeHtml(String(s.id))}</span>
          <span class="job-status ${status}">${escapeHtml(statusLabelText)}</span>
        </div>
        <p class="planning-item__title">${buildScheduleTitle(s, massTypes, showOwnerVt)}</p>
        <p class="planning-item__meta">
          <span>${escapeHtml((s.environment || '').toUpperCase())}</span>
          <span>${escapeHtml(String(s.quantity || 1))}x por tipo</span>
          <span>${escapeHtml(formatScheduleDateTime(s.scheduledAt))}</span>
        </p>
        ${s.lastError && status === 'error' ? `<p class="planning-item__error">${escapeHtml(s.lastError.length > 100 ? `${s.lastError.slice(0, 100)}…` : s.lastError)}</p>` : ''}
      </div>
      <div class="planning-item__aside">${cancelBtn}</div>
      ${typeChips}
    </article>`;
}

let schedulesRefreshSeq = 0;
let reservationsRefreshSeq = 0;

function setListRefreshStatus(statusEl, text, { isEmpty = false, autoHideMs = 0 } = {}) {
  if (!statusEl) return;
  clearTimeout(statusEl._hideTimer);
  statusEl._hideTimer = null;
  statusEl.textContent = text;
  statusEl.classList.toggle('jobs-refresh-status--empty', isEmpty);
  if (autoHideMs > 0 && text) {
    statusEl._hideTimer = setTimeout(() => {
      statusEl.textContent = '';
      statusEl.classList.add('jobs-refresh-status--empty');
    }, autoHideMs);
  }
}

async function loadSchedules({ fromUiRefresh = false } = {}) {
  const list = document.getElementById('schedules-list');
  const btn = document.getElementById('btn-refresh-schedules');
  const statusEl = document.getElementById('schedules-refresh-status');
  if (!list) return;

  let mySeq = 0;
  if (fromUiRefresh) {
    mySeq = ++schedulesRefreshSeq;
    if (btn) btn.disabled = true;
    setListRefreshStatus(statusEl, 'Atualizando…');
    list.classList.add('is-refreshing');
  }

  let ok = false;
  try {
    const { schedules, meta } = await api('/schedules');
    if (!schedules.length) {
      list.innerHTML = '<p class="empty">Nenhum agendamento. Crie um ao lado.</p>';
    } else {
      list.innerHTML = `<div class="planning-list__items">${schedules.map((s) => renderScheduleCard(s, !!meta?.showOwnerVt)).join('')}</div>`;
    }
    ok = true;
  } catch (err) {
    list.innerHTML = `<p class="empty error">${escapeHtml(err.message)}</p>`;
  } finally {
    if (fromUiRefresh && mySeq === schedulesRefreshSeq) {
      list.classList.remove('is-refreshing');
      if (btn) btn.disabled = false;
      setListRefreshStatus(statusEl, ok ? 'Lista atualizada.' : 'Não foi possível atualizar.', {
        autoHideMs: ok ? 2200 : 4000,
      });
      btn?.focus({ preventScroll: true });
    }
  }
}

async function cancelSchedule(id) {
  if (!window.confirm(`Cancelar o agendamento #${id}?`)) return;
  const msgEl = document.getElementById('schedule-form-message');
  try {
    await api(`/schedules/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    showMessage(msgEl, `Agendamento #${id} cancelado.`, 'success');
    loadSchedules();
  } catch (err) {
    showMessage(msgEl, err.message || 'Não foi possível cancelar.', 'error');
  }
}

/* ===================== Reservas ===================== */

function formatReservationDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function renderReservationCard(r, { isAdmin, today }) {
  const canCancel = isAdmin || r.isMine;
  const isToday = r.date === today;
  const cancelBtn = canCancel
    ? `<button type="button" class="btn btn-secondary btn-sm reservation-cancel-btn" data-reservation-id="${escapeHtml(String(r.id))}">Cancelar</button>`
    : '';
  return `
    <article class="planning-item planning-item--reservation" data-reservation-id="${escapeHtml(String(r.id))}">
      <div class="planning-item__main">
        <div class="planning-item__top">
          <span class="planning-item__env">${escapeHtml((r.environment || '').toUpperCase())}</span>
          <span class="job-status ${isToday ? 'done' : 'pending'}">${isToday ? 'Prioridade ativa hoje' : 'Reservado'}</span>
        </div>
        <p class="planning-item__title">${escapeHtml(r.vt || '—')}${r.isMine ? ' <span class="planning-item__you">(você)</span>' : ''}</p>
        <p class="planning-item__meta"><span>${escapeHtml(formatReservationDate(r.date))}</span></p>
      </div>
      <div class="planning-item__aside">${cancelBtn}</div>
    </article>`;
}

async function loadReservations({ fromUiRefresh = false } = {}) {
  const list = document.getElementById('reservations-list');
  const btn = document.getElementById('btn-refresh-reservations');
  const statusEl = document.getElementById('reservations-refresh-status');
  if (!list) return;

  let mySeq = 0;
  if (fromUiRefresh) {
    mySeq = ++reservationsRefreshSeq;
    if (btn) btn.disabled = true;
    setListRefreshStatus(statusEl, 'Atualizando…');
    list.classList.add('is-refreshing');
  }

  let ok = false;
  try {
    const { reservations, meta } = await api('/reservations');
    if (!reservations.length) {
      list.innerHTML = '<p class="empty">Nenhuma reserva ativa.</p>';
    } else {
      list.innerHTML = `<div class="planning-list__items">${reservations
        .map((r) => renderReservationCard(r, { isAdmin: !!meta?.isAdmin, today: meta?.today }))
        .join('')}</div>`;
    }
    ok = true;
  } catch (err) {
    list.innerHTML = `<p class="empty error">${escapeHtml(err.message)}</p>`;
  } finally {
    if (fromUiRefresh && mySeq === reservationsRefreshSeq) {
      list.classList.remove('is-refreshing');
      if (btn) btn.disabled = false;
      setListRefreshStatus(statusEl, ok ? 'Lista atualizada.' : 'Não foi possível atualizar.', {
        autoHideMs: ok ? 2200 : 4000,
      });
      btn?.focus({ preventScroll: true });
    }
  }
}

async function submitReservation() {
  const msgEl = document.getElementById('reservation-message');
  const environment = document.getElementById('reservation-env')?.value;
  const date = document.getElementById('reservation-date')?.value;
  if (!date) {
    showMessage(msgEl, 'Escolha a data da reserva.', 'error');
    return;
  }
  const btn = document.getElementById('btn-reserve');
  if (btn) btn.disabled = true;
  showMessage(msgEl, 'Criando reserva…', 'pending');
  try {
    const { message } = await api('/reservations', {
      method: 'POST',
      body: JSON.stringify({ environment, date }),
    });
    showMessage(msgEl, message || 'Reserva criada.', 'success');
    loadReservations();
  } catch (err) {
    showMessage(msgEl, err.message || 'Erro ao criar reserva.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function cancelReservation(id) {
  if (!window.confirm(`Cancelar a reserva #${id}?`)) return;
  const msgEl = document.getElementById('reservation-message');
  try {
    await api(`/reservations/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    showMessage(msgEl, 'Reserva cancelada.', 'success');
    loadReservations();
  } catch (err) {
    showMessage(msgEl, err.message || 'Não foi possível cancelar.', 'error');
  }
}

/* ===================== Init ===================== */

function initScheduleDatetime() {
  const input = document.getElementById('schedule-at');
  if (!input || input.value) return;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initReservationDateMin() {
  const el = document.getElementById('reservation-date');
  if (!el) return;
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  el.min = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

async function loadAppConfig() {
  appConfig = await api('/config');
  renderPlanningMassTypes();
}

document.querySelectorAll('.planning-tabs__btn').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

document.getElementById('form-schedule')?.addEventListener('submit', submitScheduleForm);
document.getElementById('schedule-environment')?.addEventListener('change', renderPlanningMassTypes);
document.getElementById('schedule-mass-filter')?.addEventListener('input', applyMassTypeFilter);
document.getElementById('btn-refresh-schedules')?.addEventListener('click', () => loadSchedules({ fromUiRefresh: true }));
document.getElementById('schedules-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.schedule-cancel-btn');
  if (btn) cancelSchedule(btn.dataset.scheduleId);
});
document.getElementById('btn-reserve')?.addEventListener('click', submitReservation);
document.getElementById('btn-refresh-reservations')?.addEventListener('click', () => loadReservations({ fromUiRefresh: true }));
document.getElementById('reservations-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.reservation-cancel-btn');
  if (btn) cancelReservation(btn.dataset.reservationId);
});

const urlTab = new URLSearchParams(window.location.search).get('tab');
if (urlTab === 'reservation') setActiveTab('reservation');
else setActiveTab('schedule');

initScheduleDatetime();
initReservationDateMin();
loadAppConfig().catch((err) => {
  const root = document.getElementById('schedule-mass-types-root');
  if (root) root.innerHTML = `<p class="empty error">${escapeHtml(err.message)}</p>`;
});
