/**
 * Naive local wall-clock arithmetic on `YYYY-MM-DDTHH:mm` strings.
 *
 * Why not `Date`? Open-Meteo with `timezone=auto` returns wall-clock strings *without* an
 * offset. `new Date('2026-11-20T06:00')` reinterprets them in whatever zone the browser is
 * in, which silently shifts every phase window for anyone planning a trip from another
 * timezone. So we never parse these into `Date`; we do the arithmetic ourselves.
 *
 * Empirically pinned (see `openmeteo.test.ts`): Open-Meteo applies ONE fixed UTC offset per
 * response (`utc_offset_seconds`) and emits exactly 24 evenly spaced hourly labels per local
 * date, including across DST transitions. So "add an hour" is always "+1 on the hour field",
 * with no skipped or repeated hours to special-case.
 */

/** Minutes since 1970-01-01T00:00 in naive local terms. Monotonic, offset-free, test-friendly. */
export type LocalMinutes = number;

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MINUTES_PER_DAY = 1440;

/** Days since the epoch for a proleptic Gregorian Y-M-D, no timezone involved. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): [number, number, number] {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Parse `YYYY-MM-DDTHH:mm` (seconds tolerated and discarded) into naive local minutes. */
export function parseLocal(s: string): LocalMinutes {
  const m = DATETIME_RE.exec(s);
  if (!m) throw new RangeError(`not a naive local datetime (YYYY-MM-DDTHH:mm): ${JSON.stringify(s)}`);
  const [, y, mo, d, hh, mm] = m as unknown as [string, string, string, string, string, string];
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new RangeError(`out-of-range naive local datetime: ${s}`);
  }
  return daysFromCivil(Number(y), month, day) * MINUTES_PER_DAY + hour * 60 + minute;
}

/** Parse `YYYY-MM-DD` into the naive local minutes of its midnight. */
export function parseLocalDate(s: string): LocalMinutes {
  const m = DATE_RE.exec(s);
  if (!m) throw new RangeError(`not a local date (YYYY-MM-DD): ${JSON.stringify(s)}`);
  return parseLocal(`${s}T00:00`);
}

/** Format naive local minutes back as `YYYY-MM-DDTHH:mm`. */
export function formatLocal(t: LocalMinutes): string {
  const days = Math.floor(t / MINUTES_PER_DAY);
  const rem = t - days * MINUTES_PER_DAY;
  const [y, m, d] = civilFromDays(days);
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(Math.floor(rem / 60))}:${pad2(rem % 60)}`;
}

/** Format naive local minutes as `YYYY-MM-DD`, dropping the time. */
export function formatLocalDate(t: LocalMinutes): string {
  return formatLocal(t).slice(0, 10);
}

/** The `YYYY-MM-DD` part of a datetime string, validated. */
export function dateOf(s: string): string {
  return formatLocalDate(parseLocal(s));
}

/** Midnight at the start of the local date containing `t`. */
export function startOfDay(t: LocalMinutes): LocalMinutes {
  return Math.floor(t / MINUTES_PER_DAY) * MINUTES_PER_DAY;
}

/** Whole days between two local dates (b − a), ignoring any time-of-day. */
export function daysBetween(a: string, b: string): number {
  return (startOfDay(parseLocal(lengthen(a))) - startOfDay(parseLocal(lengthen(b)))) / MINUTES_PER_DAY;
}

function lengthen(s: string): string {
  return s.length === 10 ? `${s}T00:00` : s;
}

/** Add hours (may be fractional; result is rounded to the nearest minute). */
export function addHours(t: LocalMinutes, hours: number): LocalMinutes {
  return Math.round(t + hours * 60);
}

/** Minutes-from-midnight (0..1439) for a clock string like `21:00`. */
export function clockMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`not a HH:mm clock time: ${JSON.stringify(hhmm)}`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new RangeError(`out-of-range clock time: ${hhmm}`);
  return h * 60 + mi;
}

/** The instant of `hhmm` on the local date containing `t`. */
export function atClock(t: LocalMinutes, hhmm: string): LocalMinutes {
  return startOfDay(t) + clockMinutes(hhmm);
}

/** Clamp `t` to lie between `hhmm` bounds on its own local date. */
export function clampToClock(t: LocalMinutes, earliest: string, latest: string): LocalMinutes {
  const lo = atClock(t, earliest);
  const hi = atClock(t, latest);
  return Math.min(Math.max(t, lo), hi);
}

export const MINUTES_IN_DAY = MINUTES_PER_DAY;
