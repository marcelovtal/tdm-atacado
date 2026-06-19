/** Famílias exibidas no dashboard — agrupa todos os labels gravados em job_executions. */

export const MASS_FAMILY_ORDER = [
  { id: 'ip', label: 'IP Connect', color: '#38bdf8' },
  { id: 'vpn', label: 'VPN', color: '#14b8a6' },
  { id: 'link_dedicado', label: 'Link Dedicado', color: '#a855f7' },
  { id: 'outros', label: 'Outros', color: '#71717a' },
];

/**
 * @param {string | null | undefined} label mass_type_label gravado no job
 * @returns {'ip' | 'vpn' | 'link_dedicado' | 'outros'}
 */
export function resolveMassFamily(label) {
  const s = String(label || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!s || s === 'sem tipo') return 'outros';

  if (/link dedicado|\bld\b/.test(s)) return 'link_dedicado';
  if (/\bvpn\b/.test(s)) return 'vpn';
  if (/ip connect|\bip\b/.test(s)) return 'ip';

  return 'outros';
}

/** Soma contagens por família (sem limite de tipos individuais). */
export function groupByMassFamily(rows = []) {
  const counts = { ip: 0, vpn: 0, link_dedicado: 0, outros: 0 };
  for (const row of rows) {
    const family = resolveMassFamily(row.label);
    counts[family] += Number(row.count) || 0;
  }
  return MASS_FAMILY_ORDER.map(({ id, label, color }) => ({
    label,
    count: counts[id],
    color,
  })).filter((item) => item.count > 0);
}
