import { db, getSettings } from './db.js';
import { addDays, daysBetween, inSeason, isIsoDate, today } from './dates.js';

export const ACTIVE_STATUSES = ['pending', 'approved'];

/**
 * Stavy termínu:
 *   free     — dá sa oň požiadať
 *   taken    — už oň niekto požiadal alebo je schválený
 *   blocked  — ručne zablokované správcom
 *   past     — v minulosti alebo v rámci lehoty na overenie
 *   offseason— mimo sezóny letného kina
 *   far      — za horizontom, na ktorý sa dá rezervovať
 *   paused   — príjem žiadostí je dočasne pozastavený
 */
export function buildAvailability(from, to) {
  const settings = getSettings();
  const now = today();
  const firstOpen = addDays(now, settings.leadDays);
  const lastOpen = addDays(now, settings.horizonDays);

  const takenRows = db
    .prepare(
      `SELECT date FROM reservations
        WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
          AND date BETWEEN ? AND ?`
    )
    .all(...ACTIVE_STATUSES, from, to);
  const taken = new Set(takenRows.map((r) => r.date));

  const blockedRows = db
    .prepare('SELECT date, reason FROM blackouts WHERE date BETWEEN ? AND ?')
    .all(from, to);
  const blocked = new Map(blockedRows.map((r) => [r.date, r.reason]));

  const days = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span; i += 1) {
    const date = addDays(from, i);
    days.push({ date, status: statusFor(date, { settings, firstOpen, lastOpen, taken, blocked }), reason: blocked.get(date) || null });
  }
  return { days, settings, firstOpen, lastOpen, today: now };
}

function statusFor(date, ctx) {
  const { settings, firstOpen, lastOpen, taken, blocked } = ctx;
  if (blocked.has(date)) return 'blocked';
  if (taken.has(date)) return 'taken';
  if (date < firstOpen) return 'past';
  if (date > lastOpen) return 'far';
  if (!inSeason(date, settings.seasonStart, settings.seasonEnd)) return 'offseason';
  if (settings.paused) return 'paused';
  return 'free';
}

/** Jediný zdroj pravdy pre „dá sa tento termín rezervovať". Používa ho aj POST. */
export function dateStatus(date) {
  if (!isIsoDate(date)) return 'invalid';
  const { days } = buildAvailability(date, date);
  return days[0].status;
}
