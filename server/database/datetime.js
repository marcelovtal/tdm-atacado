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

/** Valor seguro para bind SQLite (TEXT ISO 8601). Evita gravar Date como epoch ms. */
export function toSqliteDatetimeParam(value) {
  return toDate(value).toISOString();
}

/**
 * Expressão SQL SQLite: executed_at legado (epoch ms) ou ISO → datetime UTC.
 * ISO com milissegundos (ex.: 2026-06-13T21:33:27.432Z) NÃO pode cair no branch epoch:
 * o GLOB '[0-9]*.[0-9]*' matchava o ".432" e gerava datetime ~1970, excluindo tudo do histórico.
 */
export const SQLITE_EXECUTED_AT_DT = `
  CASE
    WHEN executed_at LIKE '%-%' OR executed_at LIKE '%T%'
      THEN datetime(replace(substr(replace(executed_at, 'Z', ''), 1, 19), 'T', ' '))
    WHEN executed_at GLOB '[0-9]*'
      AND length(executed_at) >= 12
      AND executed_at NOT LIKE '%-%'
      AND executed_at NOT LIKE '%T%'
      THEN datetime(CAST(executed_at AS REAL) / 1000, 'unixepoch')
    ELSE datetime(executed_at)
  END
`;
