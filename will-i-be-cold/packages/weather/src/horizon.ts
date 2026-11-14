/**
 * The switch between a real forecast and honest climatology.
 *
 * There is exactly one rule and it is never fudged: if the target date is inside the hourly
 * forecast horizon we use the forecast, otherwise we use the ERA5 climatology, and the output
 * is labelled with which. A day is never half forecast and half normals.
 */

import { daysBetween } from './localtime.js';
import type { LocalDate } from './types.js';

export type HorizonMode = 'forecast' | 'climatology';

export interface HorizonConfig {
  /**
   * How many calendar days of hourly data the forecast endpoint actually returns, today included.
   *
   * Measured against the live free tier on 2026-11-13: `forecast_days=16` returns 384 hourly
   * values (16 × 24) with no nulls in any of temperature, humidity, wind, cloud, precipitation,
   * precipitation probability or shortwave radiation; `forecast_days=17` is rejected outright.
   * So the last forecastable date is today + 15.
   */
  hourlyForecastDays: number;
}

export const DEFAULT_HORIZON: HorizonConfig = { hourlyForecastDays: 16 };

export interface HorizonDecision {
  mode: HorizonMode;
  /** Whole days from `today` to `targetDate`. 0 is today, negative is in the past. */
  daysOut: number;
  /** The last date the forecast covers, for UI copy like "forecast runs to 28 November". */
  lastForecastDate: LocalDate;
  /** Short machine-readable justification: `within-horizon`, `beyond-horizon` or `past`. */
  reason: 'within-horizon' | 'beyond-horizon' | 'past';
}

/**
 * Decide how one date should be sourced.
 *
 * Past dates fall to `climatology` rather than silently reporting what actually happened: the
 * tool answers "will I be cold", and a date in the past needs a different UI affordance, not a
 * quietly different data path. (The ERA5 client can of course serve the actuals if a caller
 * explicitly wants them.)
 */
export function chooseHorizon(
  targetDate: LocalDate,
  today: LocalDate,
  config: HorizonConfig = DEFAULT_HORIZON,
): HorizonDecision {
  const horizon = config.hourlyForecastDays;
  if (!Number.isInteger(horizon) || horizon < 1) {
    throw new RangeError(`hourlyForecastDays must be a positive integer, got ${horizon}`);
  }
  const daysOut = daysBetween(targetDate, today);
  const lastForecastDate = addDays(today, horizon - 1);
  if (daysOut < 0) return { mode: 'climatology', daysOut, lastForecastDate, reason: 'past' };
  if (daysOut <= horizon - 1) return { mode: 'forecast', daysOut, lastForecastDate, reason: 'within-horizon' };
  return { mode: 'climatology', daysOut, lastForecastDate, reason: 'beyond-horizon' };
}

/** Decide for a whole trip. A trip may legitimately straddle the horizon; each day is labelled. */
export function chooseHorizons(
  targetDates: readonly LocalDate[],
  today: LocalDate,
  config: HorizonConfig = DEFAULT_HORIZON,
): HorizonDecision[] {
  return targetDates.map((d) => chooseHorizon(d, today, config));
}

/** `YYYY-MM-DD` plus n days. */
export function addDays(date: LocalDate, n: number): LocalDate {
  const base = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(base + n * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive list of dates from `start` to `end`. */
export function dateRange(start: LocalDate, end: LocalDate): LocalDate[] {
  const n = daysBetween(end, start);
  if (n < 0) throw new RangeError(`dateRange: ${end} is before ${start}`);
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}
