import { getReservationHolder } from './database.js';
import { normalizeVt } from './auth/vt.js';

/** BullMQ: 1 = maior prioridade; números maiores = menor prioridade. */
export const RESERVED_PRIORITY = 1;
export const NORMAL_PRIORITY = 100;

/** Data local do servidor no formato YYYY-MM-DD (mesmo formato do <input type="date">). */
export function todayDateString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Prioridade do job na fila: quem tem reserva do ambiente na data de hoje passa na frente.
 * @returns {Promise<number>} RESERVED_PRIORITY (reserva ativa do VT) ou NORMAL_PRIORITY.
 */
export async function resolveJobPriority(environment, vt) {
  const viewer = normalizeVt(vt);
  if (!environment || !viewer) return NORMAL_PRIORITY;
  try {
    const holder = await getReservationHolder(environment, todayDateString());
    if (holder && normalizeVt(holder) === viewer) return RESERVED_PRIORITY;
  } catch (_) {
    /* sem reserva / erro de leitura → prioridade normal */
  }
  return NORMAL_PRIORITY;
}
