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
