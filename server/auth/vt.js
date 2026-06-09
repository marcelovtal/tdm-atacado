/** Normaliza login para VT (ex.: vt422570 → VT422570). */
export function normalizeVt(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  const direct = upper.match(/^(VT\d+)$/i);
  if (direct) return direct[1].toUpperCase();
  const embedded = upper.match(/(VT\d+)/);
  if (embedded) return embedded[1].toUpperCase();
  const afterSlash = raw.split(/[\\/]/).pop() || raw;
  const fromSlash = String(afterSlash).trim().toUpperCase().match(/^(VT\d+)$/i);
  if (fromSlash) return fromSlash[1].toUpperCase();
  return upper.replace(/[^A-Z0-9]/g, '') || upper;
}

export function buildLdapBindUser(username, domain = 'CORPORATIVO') {
  const u = String(username || '').trim();
  if (!u) return '';
  if (u.includes('\\')) return u;
  const vt = normalizeVt(u);
  if (vt.startsWith('VT')) return `${domain}\\${vt.toLowerCase()}`;
  return `${domain}\\${u}`;
}
