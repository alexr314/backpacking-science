/**
 * Per-phase distributions aggregated over the hours of a window and the nights of a trip, plus
 * the thing the panel actually leads with: the **encounter probability curve**.
 *
 * ## Two different questions, two different objects
 *
 * 1. *"What is the temperature at a random moment I am exposed during this phase?"* That is a
 *    **marginal** of a mixture over (night, hour in the window, forecast error). Being a
 *    marginal, correlation between hours and between nights cannot affect it, so it needs no
 *    correlation model at all. It is {@link PhaseDistribution.temperature} and the histogram
 *    next to it, and it is visual texture: the spread of conditions to expect.
 *
 * 2. *"Will the temperature reach 30 °F at some point tonight?"* That is a **minimum over
 *    correlated samples**, and correlation is the whole game. Treating the hours as independent
 *    would give the minimum many independent chances to dip and would badly overstate the risk
 *    of extreme cold. This is {@link EncounterCurve} and it is the primary read.
 *
 * ## What the curve is, and what it is not
 *
 *     encounterProbability(T) = P( min(period) <= T <= max(period) )
 *     coldRiskProbability(T)  = P( min(period) <= T )
 *
 * `encounterProbability` is the probability the temperature **passes through** T at some point
 * in the period. **It is not a distribution.** It is not normalised, it is not a density, and
 * summing it over the grid gives much more than 1, because one evening visits many
 * temperatures. Each value is its own probability in [0, 1]. Drawn, it is a plateau near 1
 * across the bulk of the period's range with a falling limb at each end: it is near certain you
 * will pass through 45 °F this evening, and near impossible you will pass through 5 °F.
 *
 * `coldRiskProbability` is what prices a coverage gap. If your gear fails below 30 °F, the risk
 * of that gap is the probability the temperature *gets* below 30 °F, not the probability it
 * passes through exactly 30 °F. It rises monotonically with T, from 0 well below the coldest
 * plausible value to 1 well above the warmest. The two curves nearly coincide on the cold limb,
 * because P(max >= T) is essentially 1 for any T below the usual daytime high: they separate
 * only at the warm end.
 *
 * ## How the correlation is modelled, and where the numbers come from
 *
 * Forecast error is a **correlated process in clock time**, not a set of exchangeable buckets.
 * The measured autocorrelation (see {@link MEASURED_HOURLY_PROCESS_BY_LEAD}) is 0.77 to 0.92 at
 * lag 1 h, decays to roughly zero by lag 6 h, goes *negative* around lags 9 to 12 h, and comes
 * back strongly positive at lag 24 h. So the error is modelled as the sum of four unit-variance
 * pieces, scaled by the night's own forecast-error sd:
 *
 *     T(t) = forecast(t) + sigma(night) * [ sqrt(w_shared)      * z
 *                                         + sqrt(w_diurnal)     * diurnal(t)
 *                                         + sqrt(w_semidiurnal) * semidiurnal(t)
 *                                         + sqrt(w_ar)          * a(t)
 *                                         + sqrt(w_white)       * eps(t) ]
 *
 * `z` is one trip-wide offset (the model has the airmass slightly wrong for days on end);
 * `diurnal` and `semidiurnal` are random-amplitude, random-phase 24 h and 12 h harmonics drawn
 * once per trip (a diurnal amplitude or timing error: too warm in the evening means too cold
 * about twelve hours later and too warm again a day later); `a` is one stationary **AR(1)** chain
 * in absolute clock time with lag-1 correlation `phi`; `eps` is hour-to-hour white noise. The
 * whole thing has autocorrelation {@link processAutocorrelation}, which is what gets fitted to
 * the measurement, lag by lag, per lead time.
 *
 * The curve is then built by **seeded Monte Carlo**: draw the components, take the minimum and
 * the maximum over the hours (and nights) the period spans, repeat a few thousand times, and
 * accumulate the indicators over a temperature grid. One pass gives both curves. That handles
 * any correlation structure exactly and avoids fragile analytic approximations. The RNG is
 * deterministic and seeded, so the panel renders identically every time.
 *
 * The superseded **nested exchangeable** decomposition is still here and still honoured if you
 * pass it (`errorStructure`), because it is the right way to answer "what if the hours were
 * exchangeable": see {@link ErrorStructure}. It is no longer the default, because an
 * exchangeable model cannot carry a decaying, sign-changing autocorrelation, and understating
 * the hour-to-hour correlation gives the minimum many more effectively independent chances to
 * dip, which makes the cold tail too deep.
 */

import type {
  Celsius,
  DayWeather,
  Distribution,
  LocalDate,
  PhaseName,
  PhaseWeather,
  TripWeather,
  WeatherSource,
} from './types.js';
import { Z95 } from './stats.js';
import { parseLocal } from './localtime.js';

// =============================================================================================
// The measured error structure: a correlated hourly process
// =============================================================================================

/**
 * The within-trip forecast-error process, as variance shares of five unit-variance components
 * plus one correlation coefficient. The five shares sum to 1, so the total error variance stays
 * exactly `sigma(night)^2` whatever the correlation is: changing the structure re-arranges the
 * correlation and leaves the marginal alone, which is what makes the sensitivity test honest.
 *
 * The implied autocorrelation at lag `L` hours is {@link processAutocorrelation}:
 *
 *     rho(L) = w_shared
 *            + w_diurnal     * cos(2 pi L / 24)
 *            + w_semidiurnal * cos(2 pi L / 12)
 *            + w_ar          * phi^L
 *
 * Each term earns its place from the data; see {@link MEASURED_HOURLY_PROCESS_BY_LEAD}.
 */
export interface HourlyErrorProcess {
  /** Lag-1 correlation `phi` of the AR(1) component. In [0, 1). */
  ar1: number;
  /**
   * Share carried by the AR(1) component: one stationary chain in absolute clock time, so it
   * decays smoothly across the gap between one night and the next rather than restarting.
   * Together with {@link whiteVarianceFraction} this is an ARMA(1,1), which is what lets
   * `rho(1)` sit well below 1 while `rho(2)/rho(1)` still reports the true decay rate.
   */
  arVarianceFraction: number;
  /**
   * Share carried by a random-amplitude, random-phase **24 h harmonic**, drawn once per trip.
   * Its autocorrelation is `cos(2 pi L / 24)`: +1 at lag 24, -1 at lag 12, 0 at lag 6. That is
   * exactly the measured sign pattern, and it is the diurnal amplitude or timing error.
   */
  diurnalVarianceFraction: number;
  /**
   * Share carried by a **12 h harmonic**, also drawn once per trip. Autocorrelation
   * `cos(2 pi L / 12)`: -1 at lags 6 and 18, +1 at lags 12 and 24. It is what takes the
   * correlation through zero near lag 6 and holds lag 18 near zero; without it the fit at lag 6
   * is off by about 0.15.
   */
  semidiurnalVarianceFraction: number;
  /**
   * Share carried by a flat offset shared by the whole trip: the old `b_trip`. It is what makes
   * the lag-24 correlation larger in size than the lag-12 one.
   */
  sharedVarianceFraction: number;
  /** Share that is independent hour to hour. The five shares sum to 1. */
  whiteVarianceFraction: number;
}

/**
 * **Measured**, from 2 208 hourly forecast/analysis pairs per lead (92 days, 13 Aug to 13 Nov
 * 2026) at our test point (35.60 N, 83.43 W, elevation 1800 m):
 * `scripts/verify-error-structure.mjs` pulls Open-Meteo's Previous Model Runs API, scores the run
 * issued N days earlier against the latest estimate for the same hour, estimates the **full
 * autocorrelation function by lag**, and fits the process above to lags 1 to 24 by weighted least
 * squares under `w >= 0, sum(w) <= 1`. The raw table, the measured and fitted autocorrelations
 * and the residuals are all in `fixtures/error-structure.json`.
 *
 * The measurement, and why a single averaged correlation will not do:
 *
 *   lead (d) |  sd  | lag 1 |  2   |  3   |  6   |  9    |  12   |  18   |  24
 *   ---------|------|-------|------|------|------|-------|-------|-------|------
 *       1    | 1.00 | 0.77  | 0.58 | 0.46 | 0.31 |  0.21 |  0.22 |  0.23 | 0.36
 *       2    | 2.04 | 0.88  | 0.69 | 0.51 | 0.05 | -0.21 | -0.24 | -0.03 | 0.64
 *       3    | 2.07 | 0.87  | 0.69 | 0.52 | 0.06 | -0.16 | -0.18 | -0.01 | 0.58
 *       7    | 2.86 | 0.92  | 0.80 | 0.68 | 0.37 |  0.22 |  0.16 |  0.15 | 0.30
 *
 * Adjacent hours are strongly correlated and the correlation decays fast; the mean over lags 1
 * to 9 is only 0.25 to 0.51, which is what the superseded {@link MEASURED_ERROR_STRUCTURE} was
 * built from, and it treats neighbouring hours as far more independent than they are. The
 * revival at lag 24, after passing through zero and going negative, is a diurnal error, not
 * noise.
 *
 * The fit reproduces the measurement at lags 1, 2, 3 and 6 to within 0.03 at every lead, and
 * over the whole of lags 1 to 24 to within 0.05. Where it does miss, it misses *low* at lag 1
 * (by 0.01 to 0.03), because the shares are constrained to sum to at most 1; too little
 * correlation errs on the pessimistic side of the cold tail, which is the safe direction.
 *
 * Indexed by lead day, as measured. Use {@link hourlyErrorProcess}, which interpolates between
 * rows and clamps outside the measured range.
 *
 * ⚠️ Three honest limits. Truth here is the model's own latest analysis rather than station
 * observations, as in the lead-time table; correlations are taken about the mean, so the model's
 * standing bias against reality is excluded rather than inflating these numbers. The measurement
 * is one point and one season. And there is no measurement past day 7, so
 * {@link hourlyErrorProcess} clamps to the day-7 row: the trend with lead is towards *more*
 * correlation (a long-range error is a synoptic error, not hourly noise), so clamping
 * understates the correlation at longer leads and again errs pessimistic.
 */
export const MEASURED_HOURLY_PROCESS_BY_LEAD: readonly { leadDays: number; process: HourlyErrorProcess }[] = [
  {
    leadDays: 1,
    process: {
      ar1: 0.6425,
      arVarianceFraction: 0.6602,
      diurnalVarianceFraction: 0.0657,
      semidiurnalVarianceFraction: 0.0207,
      sharedVarianceFraction: 0.2534,
      whiteVarianceFraction: 0,
    },
  },
  {
    leadDays: 2,
    process: {
      ar1: 0.74,
      arVarianceFraction: 0.3598,
      diurnalVarianceFraction: 0.4362,
      semidiurnalVarianceFraction: 0.1039,
      sharedVarianceFraction: 0.0804,
      whiteVarianceFraction: 0.0197,
    },
  },
  {
    leadDays: 3,
    process: {
      ar1: 0.7325,
      arVarianceFraction: 0.4367,
      diurnalVarianceFraction: 0.3801,
      semidiurnalVarianceFraction: 0.0977,
      sharedVarianceFraction: 0.0855,
      whiteVarianceFraction: 0,
    },
  },
  {
    leadDays: 4,
    process: {
      ar1: 0.7525,
      arVarianceFraction: 0.4643,
      diurnalVarianceFraction: 0.3597,
      semidiurnalVarianceFraction: 0.0817,
      sharedVarianceFraction: 0.0943,
      whiteVarianceFraction: 0,
    },
  },
  {
    leadDays: 5,
    process: {
      ar1: 0.82,
      arVarianceFraction: 0.5901,
      diurnalVarianceFraction: 0.2878,
      semidiurnalVarianceFraction: 0.0657,
      sharedVarianceFraction: 0.0564,
      whiteVarianceFraction: 0,
    },
  },
  {
    leadDays: 6,
    process: {
      ar1: 0.81,
      arVarianceFraction: 0.5777,
      diurnalVarianceFraction: 0.2419,
      semidiurnalVarianceFraction: 0.0655,
      sharedVarianceFraction: 0.1149,
      whiteVarianceFraction: 0,
    },
  },
  {
    leadDays: 7,
    process: {
      ar1: 0.87,
      arVarianceFraction: 0.7092,
      diurnalVarianceFraction: 0.1363,
      semidiurnalVarianceFraction: 0.0396,
      sharedVarianceFraction: 0.1149,
      whiteVarianceFraction: 0,
    },
  },
];

/**
 * The lead-averaged process. Used where a lead time is meaningless (a user-entered high and low)
 * and as the documented default of {@link AggregateOptions.hourlyProcess}.
 */
export const MEASURED_HOURLY_PROCESS: HourlyErrorProcess = {
  ar1: 0.7668,
  arVarianceFraction: 0.5426,
  diurnalVarianceFraction: 0.2725,
  semidiurnalVarianceFraction: 0.0678,
  sharedVarianceFraction: 0.1143,
  whiteVarianceFraction: 0.0028,
};

const PROCESS_SHARES = [
  'arVarianceFraction',
  'diurnalVarianceFraction',
  'semidiurnalVarianceFraction',
  'sharedVarianceFraction',
  'whiteVarianceFraction',
] as const satisfies readonly (keyof HourlyErrorProcess)[];

export function checkHourlyErrorProcess(p: HourlyErrorProcess): void {
  if (!Number.isFinite(p.ar1) || p.ar1 < 0 || p.ar1 >= 1) {
    throw new RangeError(`ar1 must be a number in [0, 1), got ${p.ar1}`);
  }
  let total = 0;
  for (const k of PROCESS_SHARES) {
    const v = p[k];
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${k} must be a non-negative number, got ${v}`);
    total += v;
  }
  if (Math.abs(total - 1) > 1e-6) {
    throw new RangeError(`hourly-process variance fractions must sum to 1, got ${total}`);
  }
}

/**
 * The process's own autocorrelation at a separation of `lagHours` hours, within a night or across
 * nights alike (the model lives in absolute clock time, so only the separation matters). This is
 * the function fitted to the measurement, and the one the tests check against it.
 */
export function processAutocorrelation(p: HourlyErrorProcess, lagHours: number): number {
  if (!Number.isFinite(lagHours)) throw new RangeError(`lagHours must be finite, got ${lagHours}`);
  const L = Math.abs(lagHours);
  if (L === 0) return 1;
  return (
    p.sharedVarianceFraction +
    p.diurnalVarianceFraction * Math.cos((2 * Math.PI * L) / 24) +
    p.semidiurnalVarianceFraction * Math.cos((2 * Math.PI * L) / 12) +
    p.arVarianceFraction * Math.pow(p.ar1, L)
  );
}

/**
 * The measured process for a forecast `leadDays` days out: linear between the measured rows,
 * clamped to the first and last of them. Interpolating affine combinations of shares that each
 * sum to 1 gives shares that sum to 1, so the result is always a valid process.
 */
export function hourlyErrorProcess(leadDays: number): HourlyErrorProcess {
  const table = MEASURED_HOURLY_PROCESS_BY_LEAD;
  const first = table[0] as { leadDays: number; process: HourlyErrorProcess };
  const last = table[table.length - 1] as { leadDays: number; process: HourlyErrorProcess };
  if (!Number.isFinite(leadDays) || leadDays <= first.leadDays) return first.process;
  if (leadDays >= last.leadDays) return last.process;
  let i = 1;
  while (i < table.length - 1 && (table[i] as typeof first).leadDays < leadDays) i += 1;
  const hi = table[i] as typeof first;
  const lo = table[i - 1] as typeof first;
  const f = (leadDays - lo.leadDays) / (hi.leadDays - lo.leadDays);
  const mix = (a: number, b: number): number => a + f * (b - a);
  return {
    ar1: mix(lo.process.ar1, hi.process.ar1),
    arVarianceFraction: mix(lo.process.arVarianceFraction, hi.process.arVarianceFraction),
    diurnalVarianceFraction: mix(lo.process.diurnalVarianceFraction, hi.process.diurnalVarianceFraction),
    semidiurnalVarianceFraction: mix(
      lo.process.semidiurnalVarianceFraction,
      hi.process.semidiurnalVarianceFraction,
    ),
    sharedVarianceFraction: mix(lo.process.sharedVarianceFraction, hi.process.sharedVarianceFraction),
    whiteVarianceFraction: mix(lo.process.whiteVarianceFraction, hi.process.whiteVarianceFraction),
  };
}

/** Longest within-night separation an exchangeable summary pretends to describe. */
const SUMMARY_MAX_LAG_H = 9;

/**
 * The nested exchangeable {@link ErrorStructure} that best *summarises* a correlated process, so
 * {@link EncounterCurve.errorStructure} keeps meaning a thing on the new model too.
 *
 * It is **deliberately lossy** and is reported, not simulated: `f_trip` is the correlation at a
 * separation of exactly 24 h, `f_night` takes the mean within-night correlation over lags 1 to 9
 * above that, and `f_hour` is the remainder. Collapsing a decaying, sign-changing
 * autocorrelation into three numbers is precisely the error this module was rewritten to stop
 * making, so use it for display and never to drive a simulation.
 */
export function impliedErrorStructure(p: HourlyErrorProcess): ErrorStructure {
  const across = Math.min(1, Math.max(0, processAutocorrelation(p, 24)));
  let within = 0;
  for (let L = 1; L <= SUMMARY_MAX_LAG_H; L += 1) within += processAutocorrelation(p, L);
  within /= SUMMARY_MAX_LAG_H;
  const tripVarianceFraction = across;
  const nightVarianceFraction = Math.min(1 - across, Math.max(0, within - across));
  return {
    tripVarianceFraction,
    nightVarianceFraction,
    hourVarianceFraction: Math.max(0, 1 - tripVarianceFraction - nightVarianceFraction),
  };
}

// =============================================================================================
// The superseded nested exchangeable structure, kept because overriding it is still the honest
// way to ask "what if the hours really were exchangeable?"
// =============================================================================================

/** How the forecast-error variance splits between the trip, the night and the hour. */
export interface ErrorStructure {
  /** Share of the variance shared by every hour of every night of the trip. */
  tripVarianceFraction: number;
  /** Share shared by the hours of one night, independent between nights. */
  nightVarianceFraction: number;
  /** Share independent from hour to hour. */
  hourVarianceFraction: number;
}

/**
 * **SUPERSEDED** by {@link MEASURED_HOURLY_PROCESS_BY_LEAD}, and kept for two reasons: passing it
 * is still how you ask "what if the hours really were exchangeable?", and the numbers are still
 * in `fixtures/error-structure.json` under the same keys as before.
 *
 * It was measured from the same 2 208 hourly forecast/analysis pairs as the lead-time table, by
 * reading one summary off the error's autocorrelation: `rho_within_night` as the **mean**
 * correlation of hourly pairs at lags up to 9 h, `rho_across_nights` from adjacent days' mean
 * errors. Two hours of one night were taken to share `b_trip` and `b_night`, two hours on
 * different nights only `b_trip`, so:
 *
 *     f_trip  = rho(two hours on adjacent nights)
 *     f_night = rho(two hours of one night) - f_trip
 *     f_hour  = 1 - rho(two hours of one night)
 *
 *   lead (d) |    1     2     3     4     5     6     7   | pooled
 *   f_trip   | 0.23  0.08  0.07  0.10  0.10  0.11  0.17   |  0.12
 *   f_night  | 0.20  0.15  0.19  0.19  0.26  0.29  0.35   |  0.23
 *   f_hour   | 0.58  0.77  0.75  0.71  0.64  0.60  0.49   |  0.65
 *
 * **Why that was wrong.** The mean over lags 1 to 9 collapses an autocorrelation that runs 0.88,
 * 0.69, 0.51, ..., 0.05 at lag 6, -0.21 at lag 9 into a single exchangeable 0.23, so adjacent
 * hours came out far more independent than they are. The minimum over a nine-hour window then
 * got roughly nine independent chances to dip instead of about two, and the cold tail came out
 * materially too deep. The replacement fits the autocorrelation lag by lag instead; see
 * {@link HourlyErrorProcess}.
 *
 * ⚠️ Two honest limits, which the replacement inherits. Truth here is the model's own latest
 * analysis rather than station observations, as in the lead-time table; correlations are taken
 * about the mean, so the model's standing bias against reality is excluded from these shares
 * rather than inflating them. And the measurement is one point and one season. Passing
 * `errorStructure` still switches the simulation back to this exchangeable model, which is the
 * clean way to test sensitivity: more shared variance means a *less* extreme cold tail, because
 * the minimum gets fewer independent chances to dip.
 */
export const MEASURED_ERROR_STRUCTURE: ErrorStructure = {
  tripVarianceFraction: 0.12,
  nightVarianceFraction: 0.232,
  hourVarianceFraction: 0.648,
};

export function checkErrorStructure(s: ErrorStructure): void {
  const total = s.tripVarianceFraction + s.nightVarianceFraction + s.hourVarianceFraction;
  for (const [k, v] of Object.entries(s)) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${k} must be a non-negative number, got ${v}`);
  }
  if (Math.abs(total - 1) > 1e-6) {
    throw new RangeError(`error-structure variance fractions must sum to 1, got ${total}`);
  }
}

// =============================================================================================
// Options
// =============================================================================================

/** Unit the *display* edges are made round in. Every number in the output stays SI. */
export type DisplayUnit = 'C' | 'F';

export interface AggregateOptions {
  /** Unit the bin edges and the curve grid land on round numbers in. Default `'F'` (SPEC §9). */
  unit?: DisplayUnit;
  /** Histogram bin width in the display unit. Default 5 °F, or 2 °C. */
  binWidth?: number;
  /** Spacing of the encounter curve's temperature grid, display unit. Default 1. */
  curveStep?: number;
  /** Monte Carlo draws behind the encounter curve. Default 4 000. */
  draws?: number;
  /** RNG seed. Fixed by default: the panel must render identically every time. */
  seed?: number;
  /**
   * Override the correlated hourly process. Default: {@link hourlyErrorProcess} at the mean lead
   * time of the nights being pooled, or {@link MEASURED_HOURLY_PROCESS} where no lead time is
   * meaningful. Wins over `errorStructure` if both are given.
   */
  hourlyProcess?: HourlyErrorProcess;
  /**
   * Switch the simulation back to the superseded nested **exchangeable** model and use these
   * shares. Only honoured when `hourlyProcess` is not given. See {@link MEASURED_ERROR_STRUCTURE}
   * for why it is not the default; it stays supported because "what if the hours were
   * exchangeable" is a question worth being able to ask.
   */
  errorStructure?: ErrorStructure;
}

export const DEFAULT_AGGREGATION = {
  unit: 'F' as DisplayUnit,
  binWidthF: 5,
  binWidthC: 2,
  curveStep: 1,
  draws: 4000,
  seed: 20261114,
} as const;

// =============================================================================================
// Outputs
// =============================================================================================

export interface HistogramBin {
  /** Inclusive lower edge, °C. */
  fromC: Celsius;
  /** Exclusive upper edge, °C. */
  toC: Celsius;
  /** The same edges in the display unit, on round numbers, ready to print. */
  from: number;
  to: number;
  /**
   * Expected number of the pooled samples in this bin. Fractional, because each sample is itself
   * a distribution once forecast error is folded in. The two outermost bins are closed on the
   * outside: they carry the whole tail beyond their nominal edge, so the counts sum exactly to
   * {@link Histogram.sampleCount}.
   */
  count: number;
  /** `count / sampleCount`. The bins' fractions sum to 1. */
  fraction: number;
}

/**
 * Ready-made bins, so the UI never re-bins raw samples. Edges are round numbers in the display
 * unit (every 5 °F by default) and are computed in SI: the edge values in `fromC`/`toC` are the
 * exact SI equivalents of those round display numbers, not rounded Celsius.
 */
export interface Histogram {
  unit: DisplayUnit;
  /** Bin width in the display unit, as asked for. */
  binWidth: number;
  /** The same width in kelvin. */
  binWidthK: number;
  /** Pooled samples behind the histogram: hours summed over nights, times realisations. */
  sampleCount: number;
  bins: HistogramBin[];
}

/**
 * The encounter curve. See the module docstring: `encounter` is **not normalised** and must not
 * be drawn as a density.
 */
export interface EncounterCurve {
  /** Ascending temperature grid, °C. Round numbers in the display unit. */
  temperaturesC: Celsius[];
  /** The same grid in the display unit. */
  temperatures: number[];
  /**
   * `P(min <= T <= max)`: the probability the temperature passes through T at some point in the
   * period. Each entry is its own probability in [0, 1]; the array does **not** sum to 1.
   * Use {@link encounterProbability} to read it at an arbitrary temperature.
   */
  encounter: number[];
  /**
   * `P(min <= T)`: the probability the temperature gets at least this cold at some point in the
   * period. Monotone non-decreasing in T, from 0 below the coldest plausible value to 1 above
   * the warmest. This is the one that prices a coverage gap.
   * Use {@link coldRiskProbability}.
   */
  coldRisk: number[];
  /** `P(max >= T)`: the mirror at the warm end. Monotone non-increasing in T. */
  warmRisk: number[];
  draws: number;
  seed: number;
  /** Which correlation model actually drove the draws. */
  errorModel: ErrorModelName;
  /**
   * The correlated hourly process the draws used, or `null` on the `exchangeable-nested` path.
   * One process covers the whole curve, chosen at the mean lead time of the nights pooled in,
   * because the trip-wide components and the AR(1) chain run across nights and so cannot have
   * per-night parameters.
   */
  hourlyProcess: HourlyErrorProcess | null;
  /** The lead time, in days, the process was read off at. `null` on the exchangeable path. */
  processLeadDays: number | null;
  /**
   * The nested exchangeable shares. On the `exchangeable-nested` path these are what was
   * simulated. On the default path they are {@link impliedErrorStructure}: a **lossy summary**
   * of `hourlyProcess`, kept so the field keeps meaning, and never the thing that was drawn.
   */
  errorStructure: ErrorStructure;
}

/** Which of the two correlation models built a curve. */
export type ErrorModelName = 'correlated-hourly' | 'exchangeable-nested';

/**
 * One phase, aggregated. **The same type for both scopes**: pooled over the whole trip (the
 * default view) and per night (the drill-down), exactly as `sampleForecast` and `sampleManual`
 * already return the same type for forecast and manual.
 */
export interface PhaseDistribution {
  phase: PhaseName;
  /** The dates pooled in, in order. One entry for a per-night view. */
  dates: LocalDate[];
  /** How many nights were pooled. */
  nights: number;
  /** Hours of window pooled in, summed over nights. */
  hours: number;
  /** Which sources contributed. More than one only if the trip mixes forecast and climatology. */
  sources: WeatherSource[];
  /**
   * The marginal: the temperature at a random exposed moment of this phase. `p10`/`p50`/`p90`
   * still draw the confidence interval. Correlation does not enter here, by construction.
   */
  temperature: Distribution;
  histogram: Histogram;
  encounter: EncounterCurve;
}

// =============================================================================================
// Units, and round edges in the display unit
// =============================================================================================

const toDisplay = (c: Celsius, unit: DisplayUnit): number => (unit === 'F' ? c * 1.8 + 32 : c);
const fromDisplay = (v: number, unit: DisplayUnit): Celsius => (unit === 'F' ? (v - 32) / 1.8 : v);
/** One step of the display scale, in kelvin. */
const stepK = (step: number, unit: DisplayUnit): number => (unit === 'F' ? step / 1.8 : step);

/** Round display edges spanning `[lowC, highC]`, inclusive, as display values. */
function roundEdges(lowC: Celsius, highC: Celsius, step: number, unit: DisplayUnit, pad: number): number[] {
  if (!(step > 0)) throw new RangeError(`step must be positive, got ${step}`);
  const lo = Math.floor(toDisplay(lowC, unit) / step) - pad;
  const hi = Math.ceil(toDisplay(highC, unit) / step) + pad;
  const edges: number[] = [];
  for (let k = lo; k <= hi; k += 1) edges.push(k * step);
  return edges;
}

// =============================================================================================
// The pooled sample
// =============================================================================================

/** One night's contribution: its hours, each with every realisation of that hour, and its sd. */
interface NightSample {
  date: LocalDate;
  /** `[hour][realisation]`, °C. Realisation k is the same occasion at every hour. */
  byHour: readonly (readonly Celsius[])[];
  /** 1 sd of the forecast error applying to this whole night, °C. 0 for climatology. */
  uncertaintySd: number;
  /** Whole days from "today" to this night. Picks the lead time of the error process. */
  daysOut: number;
  /**
   * Absolute hour index (hours since the naive local epoch) of `byHour[0]`. The correlated
   * process lives in clock time, so the harmonics and the AR(1) chain need to know *when* each
   * sample is, not just its position in the window. `byHour[i]` is at `firstHour + i`.
   */
  firstHour: number;
}

/**
 * The absolute hour index of the first hourly sample inside a window starting at `startLocal`.
 *
 * `hoursInWindow` applies the midpoint rule: the hour labelled `t` belongs to the window
 * containing `t + 30 min`, so the first hour inside the window is the smallest whole hour `t`
 * with `t + 30 >= start`. That is `ceil((start - 30) / 60)` in hours.
 */
function firstHourOf(startLocal: string): number {
  return Math.ceil((parseLocal(startLocal) - 30) / 60);
}

function nightSamples(days: readonly DayWeather[], phase: PhaseName): NightSample[] {
  if (days.length === 0) throw new RangeError('aggregatePhase: no days to aggregate');
  return days.map((day) => {
    const p: PhaseWeather | undefined = day.phases[phase];
    if (p === undefined) throw new RangeError(`day ${day.date} has no phase "${phase}"`);
    const byHour = p.temperatureByHourC;
    if (byHour === undefined || byHour.length === 0) {
      throw new RangeError(
        `day ${day.date} phase "${phase}" carries no hourly samples; it was built by an older ` +
          'version of the sampler. Re-run sampleForecast/sampleClimatology/sampleManual.',
      );
    }
    return {
      date: day.date,
      byHour,
      uncertaintySd: p.uncertaintySd,
      daysOut: day.daysOut,
      firstHour: firstHourOf(p.startLocal),
    };
  });
}

/** Every pooled realisation as a flat list of (value, sd) components of the marginal mixture. */
function mixtureComponents(nights: readonly NightSample[]): { values: number[]; sds: number[] } {
  const values: number[] = [];
  const sds: number[] = [];
  for (const night of nights) {
    for (const hour of night.byHour) {
      for (const v of hour) {
        if (!Number.isFinite(v)) throw new RangeError(`non-finite temperature sample: ${v}`);
        values.push(v);
        sds.push(night.uncertaintySd);
      }
    }
  }
  if (values.length === 0) throw new RangeError('aggregatePhase: pooled sample is empty');
  return { values, sds };
}

// =============================================================================================
// The marginal mixture: quantiles, moments and bins, all from one CDF
// =============================================================================================

/**
 * Standard normal CDF, via the Numerical Recipes rational approximation to `erfc`. Max error
 * ~1.2e-7 in `erfc`, which is far below need.
 *
 *     Phi(z) = 0.5 * erfc(-z / sqrt(2))
 *
 * so the approximation is evaluated at `x = |z| / sqrt(2)`, not at `|z|`. Getting that wrong
 * costs 0.03 of probability at `z = -0.5` and 0.005 at `z = -2.3`, which is 0.5 °C of p10 on a
 * 2 °C forecast error, so it is pinned by a test against known values of Phi.
 */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const y =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  const tail = 0.5 * y;
  return z >= 0 ? 1 - tail : tail;
}

/** `P(X <= x)` for the pooled mixture: each component is `N(value, sd)`, equally weighted. */
function mixtureCdf(values: readonly number[], sds: readonly number[], x: number): number {
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const sd = sds[i] as number;
    const v = values[i] as number;
    acc += sd <= 0 ? (v <= x ? 1 : 0) : normalCdf((x - v) / sd);
  }
  return acc / values.length;
}

function mixtureQuantile(values: readonly number[], sds: readonly number[], q: number): number {
  const maxSd = Math.max(...sds);
  let lo = Math.min(...values) - 8 * maxSd - 1;
  let hi = Math.max(...values) + 8 * maxSd + 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (mixtureCdf(values, sds, mid) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Summarise the pooled mixture.
 *
 * The quantiles are the **exact** mixture quantiles, found on the mixture's own CDF, rather than
 * `stats.describe()`'s trick of shifting the empirical quantiles outward by `Z90 · sd`. That
 * trick is a deliberately conservative approximation for one window with one error sd; it has no
 * well-defined meaning for a mixture whose nights carry *different* sds, and here the exact
 * answer is one bisection away. `min`/`max` keep `describe()`'s convention: the extreme sample,
 * widened by `Z95 ·` its own night's sd.
 */
function describeMixture(values: readonly number[], sds: readonly number[]): Distribution {
  const n = values.length;
  let sumV = 0;
  let sumSq = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const v = values[i] as number;
    const sd = sds[i] as number;
    sumV += v;
    sumSq += v * v + sd * sd;
    min = Math.min(min, v - Z95 * sd);
    max = Math.max(max, v + Z95 * sd);
  }
  const mean = sumV / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    p10: mixtureQuantile(values, sds, 0.1),
    p50: mixtureQuantile(values, sds, 0.5),
    p90: mixtureQuantile(values, sds, 0.9),
    min,
    max,
    mean,
    sd: Math.sqrt(variance),
  };
}

function histogramOf(
  values: readonly number[],
  sds: readonly number[],
  dist: Distribution,
  unit: DisplayUnit,
  binWidth: number,
): Histogram {
  const edges = roundEdges(dist.min, dist.max, binWidth, unit, 0);
  const n = values.length;
  const bins: HistogramBin[] = [];
  for (let b = 0; b + 1 < edges.length; b += 1) {
    const from = edges[b] as number;
    const to = edges[b + 1] as number;
    // The outermost bins are closed on the outside, so the Gaussian tails beyond the grid land
    // in them and the counts sum exactly to the sample count.
    const lowerCdf = b === 0 ? 0 : mixtureCdf(values, sds, fromDisplay(from, unit));
    const upperCdf = b + 2 === edges.length ? 1 : mixtureCdf(values, sds, fromDisplay(to, unit));
    const fraction = Math.max(0, upperCdf - lowerCdf);
    bins.push({
      fromC: fromDisplay(from, unit),
      toC: fromDisplay(to, unit),
      from,
      to,
      count: fraction * n,
      fraction,
    });
  }
  return { unit, binWidth, binWidthK: stepK(binWidth, unit), sampleCount: n, bins };
}

// =============================================================================================
// The encounter curve: seeded Monte Carlo over the nested error structure
// =============================================================================================

/** mulberry32. Small, fast, deterministic, and good enough for a few thousand draws. */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normals, Box-Muller, with the second of each pair kept rather than thrown away. */
function gaussians(seed: number): () => number {
  const u = rng32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    const r = Math.sqrt(-2 * Math.log(1 - u()));
    const theta = 2 * Math.PI * u();
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

/** One hourly sample of the trip, placed in absolute clock time. */
interface Slot {
  /** Index into the nights array. */
  night: number;
  /** Index into that night's `byHour`. */
  hourIndex: number;
  /** Hours since the naive local epoch. */
  absoluteHour: number;
}

/** Every hour of every night, in ascending clock order, so one AR(1) chain can walk the trip. */
function slotsOf(nights: readonly NightSample[]): Slot[] {
  const slots: Slot[] = [];
  for (let n = 0; n < nights.length; n += 1) {
    const night = nights[n] as NightSample;
    for (let i = 0; i < night.byHour.length; i += 1) {
      slots.push({ night: n, hourIndex: i, absoluteHour: night.firstHour + i });
    }
  }
  slots.sort((a, b) => a.absoluteHour - b.absoluteHour || a.night - b.night);
  return slots;
}

/**
 * Which realisation of each hour to use, drawn **once per night per draw**.
 *
 * For climatology that means one historical occasion for the whole night, rather than a
 * different year at every hour, which would invent hour-to-hour independence the record does not
 * have. Forecast and manual carry a single realisation per hour, so nothing is drawn for them and
 * the random stream is untouched.
 */
function realisationFractions(
  nights: readonly NightSample[],
  uniform: () => number,
  out: Float64Array,
): void {
  for (let n = 0; n < nights.length; n += 1) {
    const night = nights[n] as NightSample;
    out[n] = night.byHour.some((h) => h.length > 1) ? uniform() : 0;
  }
}

/** Pick the realisation index for one hour from its night's fraction. */
const realisationOf = (hour: readonly Celsius[], fraction: number): number =>
  hour.length === 1 ? 0 : Math.min(hour.length - 1, Math.floor(fraction * hour.length));

/**
 * The trip minimum and maximum per draw, under the **correlated hourly process**.
 *
 * One pass over the hours in clock order. The trip-wide pieces (the flat offset and the two
 * harmonics) are drawn once per draw; the AR(1) chain is advanced from one hour to the next by
 * the real gap between them, so it decays honestly across the hours between one night's window
 * and the next instead of restarting at each night.
 *
 * ### The negative correlation around lags 9 to 12 is represented, not skipped
 *
 * It comes out of the harmonics for free: `cos(2 pi L / 24)` is already -0.71 at lag 9 and -1 at
 * lag 12, and the fitted 24 h and 12 h shares are what reproduce the measured -0.24 there. No
 * extra machinery was needed, so there was no reason to approximate it away. It matters less than
 * it looks for a 5 to 9 hour window, which only ever sees lags up to 8, but it matters for the
 * *pooled* curve over three nights, where hours on adjacent nights sit 20 to 28 hours apart, and
 * leaving it out would have forced the lag-24 revival to be carried by a flat shared term that
 * also raised lags 9 to 18 towards it.
 */
function drawExtremesCorrelated(
  nights: readonly NightSample[],
  slots: readonly Slot[],
  p: HourlyErrorProcess,
  draws: number,
  seed: number,
  mins: Float64Array,
  maxes: Float64Array,
): void {
  const cShared = Math.sqrt(p.sharedVarianceFraction);
  const cDiurnal = Math.sqrt(p.diurnalVarianceFraction);
  const cSemi = Math.sqrt(p.semidiurnalVarianceFraction);
  const cAr = Math.sqrt(p.arVarianceFraction);
  const cWhite = Math.sqrt(p.whiteVarianceFraction);

  // Per-slot constants: the harmonic basis, and the AR(1) step from the previous slot. A gap of
  // 0 (the same clock hour twice, which happens only if one night is pooled in more than once)
  // carries the chain forward untouched, because the same hour must get the same error. Slot 0
  // gets decay 0 and innovation 1, which is exactly a stationary start.
  const n = slots.length;
  const cos24 = new Float64Array(n);
  const sin24 = new Float64Array(n);
  const cos12 = new Float64Array(n);
  const sin12 = new Float64Array(n);
  const decay = new Float64Array(n);
  const innovation = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = (slots[i] as Slot).absoluteHour;
    const theta = (2 * Math.PI * t) / 24;
    cos24[i] = Math.cos(theta);
    sin24[i] = Math.sin(theta);
    cos12[i] = Math.cos(2 * theta);
    sin12[i] = Math.sin(2 * theta);
    const gap = i === 0 ? 0 : Math.max(0, t - (slots[i - 1] as Slot).absoluteHour);
    const r = i === 0 ? 0 : Math.pow(p.ar1, gap);
    decay[i] = r;
    innovation[i] = Math.sqrt(Math.max(0, 1 - r * r));
  }

  const next = gaussians(seed);
  const uniform = rng32(seed ^ 0x9e3779b9);
  const fractions = new Float64Array(nights.length);

  for (let d = 0; d < draws; d += 1) {
    const zShared = next();
    const g1 = next();
    const g2 = next();
    const h1 = next();
    const h2 = next();
    realisationFractions(nights, uniform, fractions);
    let a = 0;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i += 1) {
      a = (decay[i] as number) * a + (innovation[i] as number) * next();
      const unit =
        cShared * zShared +
        cDiurnal * (g1 * (cos24[i] as number) + g2 * (sin24[i] as number)) +
        cSemi * (h1 * (cos12[i] as number) + h2 * (sin12[i] as number)) +
        cAr * a +
        cWhite * next();
      const slot = slots[i] as Slot;
      const night = nights[slot.night] as NightSample;
      const hour = night.byHour[slot.hourIndex] as readonly Celsius[];
      const t =
        (hour[realisationOf(hour, fractions[slot.night] as number)] as number) + night.uncertaintySd * unit;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    mins[d] = lo;
    maxes[d] = hi;
  }
}

/**
 * The trip minimum and maximum per draw, under the superseded nested **exchangeable** model:
 * `e(night, hour) = b_trip + b_night + e_hour`. Reachable by passing `errorStructure`.
 */
function drawExtremesExchangeable(
  nights: readonly NightSample[],
  structure: ErrorStructure,
  draws: number,
  seed: number,
  mins: Float64Array,
  maxes: Float64Array,
): void {
  const aTrip = Math.sqrt(structure.tripVarianceFraction);
  const aNight = Math.sqrt(structure.nightVarianceFraction);
  const aHour = Math.sqrt(structure.hourVarianceFraction);

  const next = gaussians(seed);
  const uniform = rng32(seed ^ 0x9e3779b9);
  const fractions = new Float64Array(nights.length);

  for (let d = 0; d < draws; d += 1) {
    const zTrip = next();
    realisationFractions(nights, uniform, fractions);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let nIndex = 0; nIndex < nights.length; nIndex += 1) {
      const night = nights[nIndex] as NightSample;
      const zNight = next();
      // One standard normal for the whole trip, loaded by each night's own error sd. Nights at
      // different lead times have different error sizes but the same shared *direction*, so the
      // covariance between two nights comes out as sigma_i times sigma_j times f_trip, which is
      // what a common factor with heteroscedastic loadings means.
      const shared = night.uncertaintySd * (aTrip * zTrip + aNight * zNight);
      for (const hour of night.byHour) {
        const t =
          (hour[realisationOf(hour, fractions[nIndex] as number)] as number) +
          shared +
          night.uncertaintySd * aHour * next();
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    mins[d] = lo;
    maxes[d] = hi;
  }
}

function encounterCurve(
  nights: readonly NightSample[],
  dist: Distribution,
  options: Required<Pick<AggregateOptions, 'unit' | 'curveStep' | 'draws' | 'seed'>> &
    Pick<AggregateOptions, 'hourlyProcess' | 'errorStructure'>,
): EncounterCurve {
  const { unit, curveStep, draws, seed } = options;
  if (!Number.isInteger(draws) || draws < 1) throw new RangeError(`draws must be a positive integer, got ${draws}`);

  const mins = new Float64Array(draws);
  const maxes = new Float64Array(draws);

  let errorModel: ErrorModelName;
  let hourlyProcess: HourlyErrorProcess | null;
  let processLeadDays: number | null;
  let errorStructure: ErrorStructure;

  if (options.hourlyProcess === undefined && options.errorStructure !== undefined) {
    errorModel = 'exchangeable-nested';
    errorStructure = options.errorStructure;
    checkErrorStructure(errorStructure);
    hourlyProcess = null;
    processLeadDays = null;
    drawExtremesExchangeable(nights, errorStructure, draws, seed, mins, maxes);
  } else {
    errorModel = 'correlated-hourly';
    // ONE process for the whole curve, read off the mean lead time of the nights pooled in. The
    // trip-wide components and the AR(1) chain run *across* nights, so per-night parameters would
    // not define a single consistent covariance. For a per-night drill-down the mean is that
    // night's own lead, which is the case that matters most.
    if (options.hourlyProcess === undefined) {
      processLeadDays = nights.reduce((acc, night) => acc + night.daysOut, 0) / nights.length;
      hourlyProcess = hourlyErrorProcess(processLeadDays);
    } else {
      processLeadDays = null;
      hourlyProcess = options.hourlyProcess;
    }
    checkHourlyErrorProcess(hourlyProcess);
    errorStructure = impliedErrorStructure(hourlyProcess);
    drawExtremesCorrelated(nights, slotsOf(nights), hourlyProcess, draws, seed, mins, maxes);
  }

  let gridLow = Number.POSITIVE_INFINITY;
  let gridHigh = Number.NEGATIVE_INFINITY;
  for (let d = 0; d < draws; d += 1) {
    gridLow = Math.min(gridLow, mins[d] as number);
    gridHigh = Math.max(gridHigh, maxes[d] as number);
  }
  // Pad by one step each way so both falling limbs are on the grid and reach 0.
  const temperatures = roundEdges(Math.min(gridLow, dist.min), Math.max(gridHigh, dist.max), curveStep, unit, 1);
  const temperaturesC = temperatures.map((v) => fromDisplay(v, unit));

  const encounter: number[] = [];
  const coldRisk: number[] = [];
  const warmRisk: number[] = [];
  for (const tC of temperaturesC) {
    let both = 0;
    let cold = 0;
    let warm = 0;
    for (let d = 0; d < draws; d += 1) {
      const isCold = (mins[d] as number) <= tC;
      const isWarm = (maxes[d] as number) >= tC;
      if (isCold) cold += 1;
      if (isWarm) warm += 1;
      if (isCold && isWarm) both += 1;
    }
    encounter.push(both / draws);
    coldRisk.push(cold / draws);
    warmRisk.push(warm / draws);
  }

  return {
    temperaturesC,
    temperatures,
    encounter,
    coldRisk,
    warmRisk,
    draws,
    seed,
    errorModel,
    hourlyProcess,
    processLeadDays,
    errorStructure,
  };
}

/** Linear read of a curve between grid points, clamped to the ends. */
function readCurve(curve: EncounterCurve, values: readonly number[], temperatureC: Celsius): number {
  const xs = curve.temperaturesC;
  if (xs.length === 0) return 0;
  if (temperatureC <= (xs[0] as number)) return values[0] as number;
  const last = xs.length - 1;
  if (temperatureC >= (xs[last] as number)) return values[last] as number;
  let i = 1;
  while (i < last && (xs[i] as number) < temperatureC) i += 1;
  const x0 = xs[i - 1] as number;
  const x1 = xs[i] as number;
  const y0 = values[i - 1] as number;
  const y1 = values[i] as number;
  return x1 === x0 ? y0 : y0 + ((temperatureC - x0) / (x1 - x0)) * (y1 - y0);
}

/**
 * `P(min <= T <= max)`: the probability the temperature **passes through** `temperatureC` at
 * some point in the period. Not a density, and not to be summed. See {@link EncounterCurve}.
 */
export const encounterProbability = (curve: EncounterCurve, temperatureC: Celsius): number =>
  readCurve(curve, curve.encounter, temperatureC);

/**
 * `P(min <= T)`: the probability the temperature **gets at least as cold as** `temperatureC` at
 * some point in the period. This is the number that prices a coverage gap.
 */
export const coldRiskProbability = (curve: EncounterCurve, temperatureC: Celsius): number =>
  readCurve(curve, curve.coldRisk, temperatureC);

/** `P(max >= T)`: the warm-end mirror of {@link coldRiskProbability}. */
export const warmRiskProbability = (curve: EncounterCurve, temperatureC: Celsius): number =>
  readCurve(curve, curve.warmRisk, temperatureC);

/** The temperature at which `coldRiskProbability` crosses `p`, °C. Inverse of the cold limb. */
export function coldRiskTemperature(curve: EncounterCurve, p: number): Celsius {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`probability must be in [0,1], got ${p}`);
  const xs = curve.temperaturesC;
  const ys = curve.coldRisk;
  for (let i = 0; i < xs.length; i += 1) {
    const y = ys[i] as number;
    if (y >= p) {
      if (i === 0) return xs[0] as number;
      const y0 = ys[i - 1] as number;
      const x0 = xs[i - 1] as number;
      const x1 = xs[i] as number;
      return y === y0 ? x1 : x0 + ((p - y0) / (y - y0)) * (x1 - x0);
    }
  }
  return xs[xs.length - 1] as number;
}

// =============================================================================================
// Entry points
// =============================================================================================

/**
 * Aggregate one phase over any set of days into one {@link PhaseDistribution}.
 *
 * Pass every day of the trip for the default pooled view, or a single day for that night's
 * drill-down. The output type is identical either way.
 */
export function aggregatePhase(
  days: readonly DayWeather[],
  phase: PhaseName,
  options: AggregateOptions = {},
): PhaseDistribution {
  const unit = options.unit ?? DEFAULT_AGGREGATION.unit;
  const binWidth =
    options.binWidth ?? (unit === 'F' ? DEFAULT_AGGREGATION.binWidthF : DEFAULT_AGGREGATION.binWidthC);
  const nights = nightSamples(days, phase);
  const { values, sds } = mixtureComponents(nights);
  const temperature = describeMixture(values, sds);
  return {
    phase,
    dates: nights.map((n) => n.date),
    nights: nights.length,
    hours: nights.reduce((s, n) => s + n.byHour.length, 0),
    sources: [...new Set(days.map((d) => d.source))],
    temperature,
    histogram: histogramOf(values, sds, temperature, unit, binWidth),
    encounter: encounterCurve(nights, temperature, {
      unit,
      curveStep: options.curveStep ?? DEFAULT_AGGREGATION.curveStep,
      draws: options.draws ?? DEFAULT_AGGREGATION.draws,
      seed: options.seed ?? DEFAULT_AGGREGATION.seed,
      ...(options.hourlyProcess !== undefined ? { hourlyProcess: options.hourlyProcess } : {}),
      ...(options.errorStructure !== undefined ? { errorStructure: options.errorStructure } : {}),
    }),
  };
}

/** The default view and the drill-down, in one call. Same type in both fields. */
export interface PhaseDistributions {
  phase: PhaseName;
  /** Pooled over every night of the trip. This is what the panel shows by default. */
  overall: PhaseDistribution;
  /** One entry per night, in trip order. */
  byNight: PhaseDistribution[];
}

export function phaseDistributions(
  trip: TripWeather,
  phase: PhaseName,
  options: AggregateOptions = {},
): PhaseDistributions {
  return {
    phase,
    overall: aggregatePhase(trip.days, phase, options),
    byNight: trip.days.map((day) => aggregatePhase([day], phase, options)),
  };
}
