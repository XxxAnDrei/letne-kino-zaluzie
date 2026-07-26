export const TZ = 'Europe/Bratislava';

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dnešok v slovenskom čase ako YYYY-MM-DD. */
export function today() {
  return isoFormatter.format(new Date());
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/** Posun o N dní. Počíta sa v UTC nad kalendárnym dátumom, takže letný čas nevadí. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return isoFromUTC(t);
}

function isoFromUTC(date) {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(from, to) {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

/**
 * Sezóna sa zadáva ako MM-DD, takže funguje aj okno preklápajúce sa cez Nový rok
 * (napr. 11-01 → 02-28).
 */
export function inSeason(iso, seasonStart, seasonEnd) {
  const md = iso.slice(5);
  if (seasonStart <= seasonEnd) return md >= seasonStart && md <= seasonEnd;
  return md >= seasonStart || md <= seasonEnd;
}
