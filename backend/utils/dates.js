/**
 * Datas no formato do SQLite.
 *
 * O banco grava datas com datetime('now'), que produz "YYYY-MM-DD HH:MM:SS"
 * em UTC. Toda data que a aplicacao escreve precisa usar o MESMO formato,
 * senao as comparacoes de string no SQL (ex.: expires_at < datetime('now'))
 * dao resultado errado.
 */

/** Date -> "YYYY-MM-DD HH:MM:SS" (UTC). */
export function toSqlDatetime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) -> Date. Aceita tambem ISO completo. */
export function parseSqlDatetime(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Agora + N minutos, ja no formato do SQLite. */
export function sqlDatetimeIn(minutes) {
  return toSqlDatetime(new Date(Date.now() + minutes * 60 * 1000));
}
