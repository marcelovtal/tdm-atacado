const API = '/api';

export async function api(path, options = {}) {
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

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showMessage(el, text, type = 'info') {
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.className = `message message--${type}`;
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
}

export function hideMessage(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}
