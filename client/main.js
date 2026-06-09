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
 * Único tipo de massa que usa o card lateral `#brm-massa-pronta-fields` e `ativacao-brm-massa-pronta.js`
 * (só Billing no BRM). Não misturar com IP/VPN/Link Dedicado nem com `conta-ativacao-brm` / `conta-ativacao-brm-msa`.
 * @see server/config.js massTypes id
 */
const MASS_TYPE_BRM_MASSA_PRONTA = 'conta-ativacao-brm-massa-pronta';

/** Só a última requisição disparada por “Atualizar” atualiza o texto (evita “dança” com cliques em rajada). */
let jobsRefreshSeq = 0;

const JOBS_PAGE_SIZE = 10;
/** Última lista recebida da API — usada ao mudar de página sem novo fetch. */
let cachedJobsForList = [];
/** Páginas 1-based por seção (`current` = execuções na fila, `history` = SQLite). */
const jobsListPages = { current: 1, history: 1 };

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

function renderJobCard(j) {
  const status = (j.status || '').toLowerCase();
  const canCancel =
    typeof window !== 'undefined' &&
    window.fdlVtalAuth &&
    window.fdlVtalAuth.hasPermission('cancelJobs');
  const isWaiting = status === 'waiting';
  const isActive = status === 'active';
  const cancelBtn =
    canCancel && (isWaiting || isActive)
      ? `<button type="button" class="btn btn-secondary job-cancel-btn" data-job-id="${escapeHtml(String(j.id))}" title="${isActive ? 'Interromper execução' : 'Remover da fila'}">Cancelar</button>`
      : '';
  return `
    <article class="job-item" data-job-id="${j.id}" role="button" tabindex="0">
      <span class="job-id">#${j.id}</span>
      <span class="job-type">${escapeHtml(j.massType || '—')}</span>
      <span class="job-env">${escapeHtml((j.environment || '').toUpperCase())}</span>
      <span class="job-status ${(j.status || '').toLowerCase()}">${statusLabel(j.status)}</span>
      <span class="job-time">${formatTime(j.timestamp)}</span>
      ${
        j.orderNumber
          ? `<span class="job-result">Pedido: ${escapeHtml(j.orderNumber)}</span>`
          : j.status === 'failed' && j.error
            ? `<span class="job-result job-result--error">${escapeHtml(j.error.length > 72 ? `${j.error.slice(0, 72)}…` : j.error)}</span>`
            : j.status === 'cancelled'
              ? `<span class="job-result job-result--muted">Cancelado</span>`
              : j.accountBillingId
              ? `<span class="job-result">Conta BRM: ${escapeHtml(j.accountBillingId)}</span>`
              : ''
      }
      <span class="job-actions">${cancelBtn}</span>
    </article>
  `;
}

function renderJobsList(jobs) {
  const list = document.getElementById('jobs-list');
  cachedJobsForList = jobs;

  if (!jobs.length) {
    list.innerHTML = '<p class="empty">Nenhum job na fila.</p>';
    return;
  }

  const currentJobs = jobs.filter((j) => !String(j.id).startsWith('hist-'));
  const historyJobs = jobs.filter((j) => String(j.id).startsWith('hist-'));

  const curMeta = paginateSlice(currentJobs, jobsListPages.current, JOBS_PAGE_SIZE);
  jobsListPages.current = curMeta.page;
  const histMeta = paginateSlice(historyJobs, jobsListPages.history, JOBS_PAGE_SIZE);
  jobsListPages.history = histMeta.page;

  const sections = [];
  if (currentJobs.length) {
    sections.push(`
      <div class="jobs-section">
        <p class="jobs-section__title">Execucoes atuais</p>
        ${curMeta.slice.map(renderJobCard).join('')}
        ${renderPaginationNav('current', curMeta)}
      </div>
    `);
  }
  if (historyJobs.length) {
    sections.push(`
      <div class="jobs-section">
        <p class="jobs-section__title">Historico</p>
        ${histMeta.slice.map(renderJobCard).join('')}
        ${renderPaginationNav('history', histMeta)}
      </div>
    `);
  }

  list.innerHTML = sections.join('');

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
    active: 'Executando',
    completed: 'Sucesso',
    failed: 'Falha',
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
    const { jobs } = await api('/jobs');
    renderJobsList(jobs);
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

async function openJobDetail(id) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  modal.hidden = false;
  title.textContent = `Job #${id}`;
  body.innerHTML = '<p>Carregando…</p>';

  try {
    const job = await api(`/jobs/${id}`);
    const r = job.result || {};
    const isBrmFlow =
      (job.data?.massTypeId || '').includes('conta-ativacao-brm') ||
      (job.data?.massTypeLabel || '').toLowerCase().includes('brm');
    body.innerHTML = `
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
      ${
        isBrmFlow
          ? (r.accountBillingId || r.accountBusinessId || r.accountOrganizationId || r.contactTecnicoId) ? `
      <div class="detail-row">
        <div class="detail-label">Resultado (BRM)</div>
        <div class="detail-value">
          ${r.accountBillingId ? `AccountBillingId: ${escapeHtml(r.accountBillingId)}<br>` : ''}
          ${r.accountBusinessId ? `AccountBusinessId: ${escapeHtml(r.accountBusinessId)}<br>` : ''}
          ${r.accountOrganizationId ? `AccountOrganizationId: ${escapeHtml(r.accountOrganizationId)}<br>` : ''}
          ${r.contactTecnicoId ? `ContactTecnicoId: ${escapeHtml(r.contactTecnicoId)}` : ''}
        </div>
      </div>
          ` : ''
          : (r.orderId || r.orderNumber || r.pegaCaseId || r.pegaOrdemServicoOs) ? `
      <div class="detail-row">
        <div class="detail-label">Resultado</div>
        <div class="detail-value">
          ${r.orderId ? `OrderId: ${escapeHtml(r.orderId)}<br>` : ''}
          ${r.orderNumber ? `OrderNumber: ${escapeHtml(r.orderNumber)}<br>` : ''}
          ${r.orderStatus ? `Status: ${escapeHtml(r.orderStatus)}<br>` : ''}
          ${r.pegaCaseId ? `PEGA: ${escapeHtml(r.pegaCaseId)}<br>` : ''}
          ${r.pegaOrdemServicoOs ? `PEGA: ${escapeHtml(r.pegaOrdemServicoOs)}` : ''}
        </div>
      </div>
          ` : ''
      }
      ${job.state === 'cancelled' ? `
      <div class="detail-row">
        <div class="detail-label">Observação</div>
        <div class="detail-value">Execução cancelada pelo usuário.</div>
      </div>
      ` : (r.error || job.failedReason) ? `
      <div class="detail-row">
        <div class="detail-label">Erro</div>
        <div class="detail-value" style="color: var(--error);">${escapeHtml(r.error || job.failedReason || '')}</div>
      </div>
      ` : ''}
      <p class="card-hint" style="margin-top: 1rem;">
        Logs completos (stdout/stderr) ficam apenas no terminal da API ou do worker — não são exibidos aqui por desempenho e segurança.
      </p>
    `;
  } catch (e) {
    body.innerHTML = `<p class="error">Erro ao carregar job: ${escapeHtml(e.message)}</p>`;
  }
}

function closeModal() {
  document.getElementById('modal').hidden = true;
}

async function submitForm(e) {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('form-message');

  const environment = form.environment.value;
  const massType = form.massType.value;
  const quantity = parseInt(form.quantity.value, 10) || 1;

  let extraEnv = {};
  // Massa pronta Opp → pedido (IP / VPN / Link Dedicado): inalterado em relação ao fluxo original.
  if (
    massType === 'massa-pronta-opp-pedido' ||
    massType === 'massa-pronta-opp-pedido-pega' ||
    massType === 'massa-pronta-opp-pedido-vpn' ||
    massType === 'massa-pronta-opp-pedido-vpn-pega' ||
    massType === 'massa-pronta-opp-pedido-link-dedicado' ||
    massType === 'massa-pronta-opp-pedido-link-dedicado-pega'
  ) {
    const org = document.getElementById('accountOrganizationId')?.value?.trim();
    const business = document.getElementById('accountBusinessId')?.value?.trim();
    const billing = document.getElementById('accountBillingId')?.value?.trim();
    if (!org || !business || !billing) {
      showMessage(msg, 'Preencha Organization, Business e Billing para este tipo de massa.', 'error');
      return;
    }
    extraEnv = {
      START_FROM_QUOTE: '1',
      ACCOUNT_ORGANIZATION_ID: org,
      ACCOUNT_BUSINESS_ID: business,
      ACCOUNT_BILLING_ID: billing,
    };
  } else if (massType === MASS_TYPE_BRM_MASSA_PRONTA) {
    const billing = document.getElementById('accountBillingIdBrmOnly')?.value?.trim();
    if (!billing) {
      showMessage(msg, 'Informe o Id da conta Billing para ativar no BRM.', 'error');
      return;
    }
    extraEnv = { ACCOUNT_BILLING_ID: billing };
  }

  const effectiveQuantity = massType === MASS_TYPE_BRM_MASSA_PRONTA ? 1 : quantity;

  setSubmitLoading(true);
  showMessage(
    msg,
    'Pedido recebido — enfileirando os jobs na fila. Aguarde um instante.',
    'pending'
  );

  try {
    const { jobs, message } = await api('/jobs', {
      method: 'POST',
      body: JSON.stringify({ environment, massType, quantity: effectiveQuantity, extraEnv }),
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
document.getElementById('jobs-list')?.addEventListener('click', (e) => {
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
  renderJobsList(cachedJobsForList);
});
document.getElementById('modal-close').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);

function updateMassaProntaVisibility() {
  const massType = document.querySelector('input[name="massType"]:checked')?.value;
  const block = document.getElementById('massa-pronta-fields');
  const brmBlock = document.getElementById('brm-massa-pronta-fields');
  if (!block) return;
  // Três IDs: só cards IP/VPN/LD massa pronta. Card BRM massa pronta usa bloco separado (um Id).
  const showTriple =
    massType === 'massa-pronta-opp-pedido' ||
    massType === 'massa-pronta-opp-pedido-pega' ||
    massType === 'massa-pronta-opp-pedido-vpn' ||
    massType === 'massa-pronta-opp-pedido-vpn-pega' ||
    massType === 'massa-pronta-opp-pedido-link-dedicado' ||
    massType === 'massa-pronta-opp-pedido-link-dedicado-pega';
  const showBrm = massType === MASS_TYPE_BRM_MASSA_PRONTA;
  block.hidden = !showTriple;
  if (brmBlock) {
    brmBlock.hidden = !showBrm;
  }
  const sidebar = document.querySelector('.form-layout__sidebar');
  if (showTriple || showBrm) {
    if (window.matchMedia('(max-width: 879px)').matches && sidebar) {
      sidebar.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
    const focusEl = showBrm
      ? document.getElementById('accountBillingIdBrmOnly')
      : document.getElementById('accountOrganizationId');
    requestAnimationFrame(() => focusEl?.focus({ preventScroll: true }));
  }
}

document.querySelectorAll('input[name="massType"]').forEach((input) => {
  input.addEventListener('change', updateMassaProntaVisibility);
});

/** Filtra cards por texto (útil com muitos tipos de massa). */
const massTypeFilter = document.getElementById('mass-type-filter');
if (massTypeFilter) {
  massTypeFilter.addEventListener('input', () => {
    const q = massTypeFilter.value.trim().toLowerCase();
    document.querySelectorAll('.flow-category').forEach((cat) => {
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

loadJobs();
