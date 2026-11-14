/**
 * Display units. SI inside, °F on screen by default (`SPEC.md` §9).
 *
 * Every conversion goes through the engine's own `celsiusToFahrenheit`; there is no second
 * copy of the arithmetic in the UI.
 */
import { celsiusToFahrenheit, type Celsius } from '@will-i-be-cold/heat';

export type Unit = 'F' | 'C';

export const UNIT_SYMBOL: Readonly<Record<Unit, string>> = { F: '°F', C: '°C' };

/** A Celsius value in the display unit, as a number. */
export const toUnit = (c: Celsius, unit: Unit): number => (unit === 'F' ? celsiusToFahrenheit(c) : c);

/** A *difference* in kelvin, expressed in the display unit's degrees. */
export const deltaToUnit = (k: number, unit: Unit): number => (unit === 'F' ? (k * 9) / 5 : k);

export function formatTemp(c: Celsius, unit: Unit, digits = 0): string {
  return `${toUnit(c, unit).toFixed(digits)} ${UNIT_SYMBOL[unit]}`;
}

export function formatTempPlain(c: Celsius, unit: Unit, digits = 0): string {
  return toUnit(c, unit).toFixed(digits);
}

export function formatDelta(k: number, unit: Unit, digits = 0): string {
  return `${deltaToUnit(k, unit).toFixed(digits)} ${UNIT_SYMBOL[unit]}`;
}

export function formatClo(clo: number): string {
  return `${clo.toFixed(2)} clo`;
}

/** `2026-11-16` → `Monday 16 November`. Parsed as parts, never through `new Date(string)`. */
export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((x) => Number.parseInt(x, 10));
  if (y === undefined || m === undefined || d === undefined) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt);
}

/** `2026-11-16T16:26` → `16:26`. */
export const clockOf = (localDateTime: string): string => localDateTime.slice(11, 16);

/** `2026-11-16` → `Mon 16 Nov`. */
export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((x) => Number.parseInt(x, 10));
  if (y === undefined || m === undefined || d === undefined) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(dt);
}

/** `2026-11-16`, `2026-11-18` → `Mon 16 to Wed 18 November`; across months, both months are named. */
export function formatDateSpan(fromIso: string, toIso: string): string {
  if (fromIso === toIso) return formatLongDate(fromIso);
  const sameMonth = fromIso.slice(0, 7) === toIso.slice(0, 7);
  const [y, m, d] = fromIso.split('-').map((x) => Number.parseInt(x, 10));
  if (y === undefined || m === undefined || d === undefined) return `${fromIso} to ${toIso}`;
  const first = sameMonth
    ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
    : formatShortDate(fromIso);
  const last = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)))),
  );
  return `${first} to ${last}`;
}
