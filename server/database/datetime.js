/**
 * MySQL DATETIME/DATETIME(3) não aceita ISO 8601 (ex.: 2026-06-01T13:54:16.136Z).
 */

export function toMysqlDatetimeString(value) {
  const d = toDate(value);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const ms = pad(d.getMilliseconds(), 3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
}

export function toDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`Data inválida: ${value}`);
    return value;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Data inválida para MySQL: ${value}`);
  }
  return d;
}

/** Valor seguro para bind mysql2 em coluna DATETIME. */
export function toMysqlDatetimeParam(value) {
  return toMysqlDatetimeString(value);
}
