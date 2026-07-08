function api(path, options = {}) {
  const headers = window.fdlVtalAuth
    ? fdlVtalAuth.authHeaders(options.headers || {})
    : { 'Content-Type': 'application/json' };
  return fetch('/api' + path, { ...options, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      fdlVtalAuth.clearSession();
      window.location.replace('/login.html');
      throw new Error('Sessão expirada');
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  });
}

function renderTable(users) {
  const wrap = document.getElementById('acl-table-wrap');
  if (!users.length) {
    wrap.innerHTML = '<p class="empty">Nenhum VT configurado. Adicione acima.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>VT</th>
          <th>Dashboard</th>
          <th>Cancelar jobs</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${users
          .map(
            (u, i) => `
          <tr data-index="${i}" data-vt="${escapeHtml(u.vt)}">
            <td><strong>${escapeHtml(u.vt)}</strong></td>
            <td><input type="checkbox" data-field="dashboard" ${u.dashboard ? 'checked' : ''} /></td>
            <td><input type="checkbox" data-field="cancelJobs" ${u.cancelJobs ? 'checked' : ''} /></td>
            <td><button type="button" class="btn btn-secondary btn-sm" data-remove title="Remover VT">Remover</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let aclUsers = [];
let saving = false;

function readTableIntoUsers() {
  const rows = document.querySelectorAll('#acl-table-wrap tbody tr');
  return Array.from(rows).map((row) => {
    const vt = row.dataset.vt || row.querySelector('td strong')?.textContent?.trim() || '';
    return {
      vt,
      dashboard: row.querySelector('[data-field="dashboard"]')?.checked || false,
      cancelJobs: row.querySelector('[data-field="cancelJobs"]')?.checked || false,
    };
  });
}

function showMsg(text, type) {
  const el = document.getElementById('acl-message');
  el.textContent = text;
  el.className = 'message' + (type ? ` ${type}` : '');
  el.hidden = !text;
}

function setSaving(active) {
  saving = active;
  document.getElementById('btn-add-vt')?.toggleAttribute('disabled', active);
  document.querySelector('#acl-form button[type="submit"]')?.toggleAttribute('disabled', active);
}

async function persistUsers(users, successMsg) {
  if (saving) return;
  setSaving(true);
  try {
    const data = await api('/auth/access-control', {
      method: 'PUT',
      body: JSON.stringify({ users }),
    });
    aclUsers = data.users || users;
    renderTable(aclUsers);
    showMsg(successMsg || 'Permissões salvas.', 'success');
  } catch (err) {
    showMsg(err.message || 'Erro ao salvar', 'error');
    throw err;
  } finally {
    setSaving(false);
  }
}

async function loadAcl() {
  const data = await api('/auth/access-control');
  aclUsers = data.users || [];
  renderTable(aclUsers);
  const platEl = document.getElementById('platform-admins-list');
  if (platEl) {
    const list = data.platformAdmins || [];
    platEl.textContent = list.length ? list.join(', ') : 'VT422570';
  }
}

document.getElementById('btn-add-vt')?.addEventListener('click', async () => {
  const input = document.getElementById('new-vt');
  const vt = (input?.value || '').trim().toUpperCase();
  if (!/^VT\d+$/i.test(vt)) {
    showMsg('Informe um VT válido (ex.: VT422336)', 'error');
    return;
  }
  if (aclUsers.some((u) => u.vt === vt)) {
    showMsg('VT já está na lista', 'error');
    return;
  }
  const next = [...aclUsers, { vt, dashboard: false, cancelJobs: false }];
  try {
    await persistUsers(next, `${vt} adicionado e salvo.`);
    input.value = '';
  } catch (_) {
    /* mensagem já exibida */
  }
});

document.getElementById('acl-table-wrap')?.addEventListener('click', async (e) => {
  if (!e.target.matches('[data-remove]')) return;
  const row = e.target.closest('tr');
  const vt = row?.dataset.vt || row?.querySelector('td strong')?.textContent?.trim();
  if (!vt) return;
  if (!window.confirm(`Remover ${vt} da lista de permissões?`)) return;

  const next = aclUsers.filter((u) => u.vt !== vt);
  try {
    await persistUsers(next, `${vt} removido.`);
  } catch (_) {
    /* mensagem já exibida */
  }
});

document.getElementById('acl-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const users = readTableIntoUsers();
  try {
    await persistUsers(users);
  } catch (_) {
    /* mensagem já exibida */
  }
});

loadAcl().catch((err) => showMsg(err.message, 'error'));

function renderMassTypesTable(types) {
  const wrap = document.getElementById('mass-types-table-wrap');
  if (!wrap) return;
  if (!types.length) {
    wrap.innerHTML = '<p class="empty">Nenhum tipo configurado.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Fluxo</th>
          <th>Script</th>
          <th>TI</th>
          <th>TRG</th>
        </tr>
      </thead>
      <tbody>
        ${types
          .map(
            (t, i) => `
          <tr data-index="${i}" data-id="${escapeHtml(t.id)}">
            <td><strong>${escapeHtml(t.label)}</strong><br><span class="card-hint">${escapeHtml(t.id)}</span></td>
            <td><code>${escapeHtml(t.script)}</code></td>
            <td><input type="checkbox" data-field="activeTi" ${t.activeEnvironments?.ti !== false ? 'checked' : ''} /></td>
            <td><input type="checkbox" data-field="activeTrg" ${t.activeEnvironments?.trg !== false ? 'checked' : ''} /></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function showMassTypesMsg(text, type) {
  const el = document.getElementById('mass-types-message');
  if (!el) return;
  el.textContent = text;
  el.className = 'message' + (type ? ` ${type}` : '');
  el.hidden = !text;
}

function readMassTypesFromTable() {
  const rows = document.querySelectorAll('#mass-types-table-wrap tbody tr');
  return Array.from(rows).map((row) => ({
    id: row.dataset.id,
    activeEnvironments: {
      ti: row.querySelector('[data-field="activeTi"]')?.checked || false,
      trg: row.querySelector('[data-field="activeTrg"]')?.checked || false,
    },
  }));
}

let massTypesList = [];

async function loadMassTypesAdmin() {
  const data = await api('/auth/mass-types');
  massTypesList = data.types || [];
  renderMassTypesTable(massTypesList);
}

document.getElementById('mass-types-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const types = readMassTypesFromTable();
  try {
    const data = await api('/auth/mass-types', {
      method: 'PUT',
      body: JSON.stringify({ types }),
    });
    massTypesList = data.types || types;
    renderMassTypesTable(massTypesList);
    showMassTypesMsg('Tipos de massa salvos.', 'success');
  } catch (err) {
    showMassTypesMsg(err.message || 'Erro ao salvar', 'error');
  }
});

loadMassTypesAdmin().catch((err) => showMassTypesMsg(err.message, 'error'));

function showJobQueueMsg(text, type) {
  const el = document.getElementById('job-queue-message');
  if (!el) return;
  el.textContent = text;
  el.className = 'message' + (type ? ` ${type}` : '');
  el.hidden = !text;
}

function renderParallelJobsSelect(settings) {
  const select = document.getElementById('parallel-jobs-select');
  if (!select) return;
  const min = settings.min ?? 1;
  const max = settings.max ?? 10;
  const current = settings.parallelJobs ?? 1;
  select.innerHTML = '';
  for (let n = min; n <= max; n++) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = n === 1 ? '1 (sequencial)' : String(n);
    if (n === current) opt.selected = true;
    select.appendChild(opt);
  }
}

async function loadJobQueueAdmin() {
  const data = await api('/auth/job-queue');
  renderParallelJobsSelect(data);
}

document.getElementById('job-queue-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const select = document.getElementById('parallel-jobs-select');
  const parallelJobs = parseInt(select?.value || '1', 10) || 1;
  try {
    const data = await api('/auth/job-queue', {
      method: 'PUT',
      body: JSON.stringify({ parallelJobs }),
    });
    renderParallelJobsSelect(data);
    showJobQueueMsg(`Paralelismo atualizado: ${data.parallelJobs} job(s) simultâneo(s).`, 'success');
  } catch (err) {
    showJobQueueMsg(err.message || 'Erro ao salvar', 'error');
  }
});

loadJobQueueAdmin().catch((err) => showJobQueueMsg(err.message, 'error'));
