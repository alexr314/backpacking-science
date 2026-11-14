/**
 * The sampler: weather series -> per-phase temperature (and wind/cloud/humidity/rain)
 * distributions, which is the only thing the physics engine ever sees.
 *
 * Three entry points ({@link sampleForecast}, {@link sampleClimatology}, {@link sampleManual})
 * all return `TripWeather`. That is the whole point: the heat-balance model cannot tell which
 * one produced its input, so there is no second code path to keep in sync and no way for a
 * manual-mode bug to hide.
 *
 * See the README for the phase-window rule and the uncertainty model; the short version is in
 * {@link DEFAULT_PHASE_WINDOWS} and {@link DEFAULT_UNCERTAINTY} below.
 */

import type { ClimatologyResponse, SeriesResponse } from './openmeteo.js';
import { OPEN_METEO_ATTRIBUTION, PHASE_NAMES } from './types.js';
import type {
  Celsius,
  DayWeather,
  Fraction,
  LocalDate,
  Metres,
  PhaseName,
  PhaseWeather,
  TripLocation,
  TripWeather,
  WeatherSource,
} from './types.js';
import {
  addHours,
  atClock,
  clampToClock,
  dateOf,
  formatLocal,
  parseLocal,
  parseLocalDate,
  startOfDay,
  type LocalMinutes,
} from './localtime.js';
import { describe, mean, sum } from './stats.js';
import { sunTimes } from './solar.js';
import { chooseHorizon, DEFAULT_HORIZON, type HorizonConfig } from './horizon.js';

// =============================================================================================
// Phase windows
// =============================================================================================

/**
 * How the five phase windows are placed.
 *
 * The rule: anchor to the sun, then clamp to clock bounds that stop the windows becoming absurd
 * in June in Norway or in December in Florida. The four boundaries partition the 24 hours with no
 * gaps and no overlaps, so every hour of the day belongs to exactly one phase (`day_break` is the
 * one exception: it is a sub-window of `hiking`, reported separately because the physics engine
 * applies a different metabolic rate to it).
 *
 *   sleep        bedtime (prev day)    -> wake
 *   camp_morning wake                  -> hikingStart
 *   hiking       hikingStart           -> hikingEnd
 *   day_break    hikingStart + inset   -> hikingEnd - inset     (inside hiking)
 *   camp_evening hikingEnd             -> bedtime
 *
 * With the defaults below, the Smokies on 13 November 2026 (sunrise 07:07, sunset 17:28) gives
 * wake 06:07, hiking 08:37–16:28, camp evening 16:28–21:00, sleep 21:00–06:07, within ten
 * minutes of the fixed clock windows in SPEC §3, but self-adjusting for date and latitude.
 *
 * Why `camp_evening` starts when hiking stops rather than at sunset (as SPEC §3 says): the hour
 * between arriving in camp and sunset is spent standing around at 1.6 MET, not walking at 3.0,
 * so it belongs to the camp phase. Starting it at sunset would leave that hour in no phase at all.
 */
export interface PhaseWindowConfig {
  /** Hours relative to sunrise at which you get up. Negative = before sunrise. */
  wakeOffsetHours: number;
  wakeEarliest: string;
  wakeLatest: string;
  /** Hours after sunrise that you actually start walking. */
  hikingStartOffsetHours: number;
  hikingStartEarliest: string;
  hikingStartLatest: string;
  /** Hours relative to sunset at which you stop walking. Negative = before sunset. */
  hikingEndOffsetHours: number;
  hikingEndEarliest: string;
  hikingEndLatest: string;
  /** Wall-clock bedtime. */
  bedtime: string;
  /**
   * Hours trimmed off each end of the hiking window to get the break window: you do not stop for
   * lunch twenty minutes after setting off, nor in the last stretch before camp.
   */
  breakInsetHours: number;
  /** Minimum length of the hiking window, hours, enforced after clamping. */
  minHikingHours: number;
}

export const DEFAULT_PHASE_WINDOWS: PhaseWindowConfig = {
  wakeOffsetHours: -1,
  wakeEarliest: '04:30',
  wakeLatest: '08:00',
  hikingStartOffsetHours: 1.5,
  hikingStartEarliest: '07:00',
  hikingStartLatest: '09:30',
  hikingEndOffsetHours: -1,
  hikingEndEarliest: '14:30',
  hikingEndLatest: '18:00',
  bedtime: '21:00',
  breakInsetHours: 1,
  minHikingHours: 3,
};

export interface PhaseWindow {
  start: LocalMinutes;
  /** Exclusive. For `sleep` this is on the following date. */
  end: LocalMinutes;
}

/**
 * Place the five windows for one date.
 *
 * `polar` days (no sunrise or no sunset: the API collapses both to `T00:00`) fall back to the
 * fixed clock windows from SPEC §3, because "sunset − 1 h" is meaningless when the sun does not set.
 */
export function phaseWindows(
  day: { date: LocalDate; sunrise: string; sunset: string; polar?: boolean },
  config: PhaseWindowConfig = DEFAULT_PHASE_WINDOWS,
): Record<PhaseName, PhaseWindow> {
  const dayStart = parseLocalDate(day.date);
  const bedtime = atClock(dayStart, config.bedtime);

  let wake: LocalMinutes;
  let hikingStart: LocalMinutes;
  let hikingEnd: LocalMinutes;

  const polar = day.polar ?? parseLocal(day.sunset) <= parseLocal(day.sunrise);
  if (polar) {
    wake = atClock(dayStart, '06:00');
    hikingStart = atClock(dayStart, '08:30');
    hikingEnd = atClock(dayStart, '16:30');
  } else {
    const sunrise = parseLocal(day.sunrise);
    const sunset = parseLocal(day.sunset);
    wake = clampToClock(addHours(sunrise, config.wakeOffsetHours), config.wakeEarliest, config.wakeLatest);
    hikingStart = clampToClock(
      addHours(sunrise, config.hikingStartOffsetHours),
      config.hikingStartEarliest,
      config.hikingStartLatest,
    );
    hikingEnd = clampToClock(
      addHours(sunset, config.hikingEndOffsetHours),
      config.hikingEndEarliest,
      config.hikingEndLatest,
    );
  }

  // Enforce a sane ordering even for pathological sun times: wake < hikingStart < hikingEnd < bedtime.
  wake = Math.min(wake, hikingStart - 30);
  hikingEnd = Math.max(hikingEnd, hikingStart + config.minHikingHours * 60);
  hikingEnd = Math.min(hikingEnd, bedtime - 30);
  hikingStart = Math.min(hikingStart, hikingEnd - config.minHikingHours * 60);
  wake = Math.min(wake, hikingStart - 30);

  const inset = Math.round(config.breakInsetHours * 60);
  const breakStart = hikingEnd - hikingStart > 3 * inset ? hikingStart + inset : hikingStart;
  const breakEnd = hikingEnd - hikingStart > 3 * inset ? hikingEnd - inset : hikingEnd;

  return {
    sleep: { start: bedtime, end: wake + 1440 },
    camp_morning: { start: wake, end: hikingStart },
    hiking: { start: hikingStart, end: hikingEnd },
    day_break: { start: breakStart, end: breakEnd },
    camp_evening: { start: hikingEnd, end: bedtime },
  };
}

/**
 * Which hourly stamps fall inside a window: the **midpoint rule**. An hour labelled `09:00`
 * covers 09:00–10:00, so it belongs to the window containing 09:30. This makes the four
 * non-overlapping windows an exact partition of the 24 hourly samples, with no hour counted
 * twice and none dropped.
 *
 * Caveat, stated rather than hidden: Open-Meteo's `precipitation` is the sum over the *preceding*
 * hour while temperature and wind are instantaneous, so precipitation is effectively offset by up
 * to an hour relative to the window. At our resolution that is noise.
 */
export function hoursInWindow(window: PhaseWindow): LocalMinutes[] {
  const out: LocalMinutes[] = [];
  const firstHour = Math.floor((window.start - 30) / 60) * 60;
  for (let t = firstHour; t < window.end; t += 60) {
    const mid = t + 30;
    if (mid >= window.start && mid < window.end) out.push(t);
  }
  return out;
}

// =============================================================================================
// Uncertainty
// =============================================================================================

/**
 * How wide the temperature band should be, over and above the within-window diurnal spread.
 *
 * `leadDaySdC` is **measured, not assumed**. `scripts/verify-leadtime.mjs` pulls Open-Meteo's
 * Previous Model Runs API for our exact test point (35.60 N, 83.43 W, elevation=1800) and scores
 * the forecast issued N days earlier against the latest estimate for the same hour, over 2 208
 * hourly pairs (13 Aug – 12 Nov 2026). The raw table is in `fixtures/leadtime-verification.json`:
 *
 *   lead (d) |   1     2     3     4     5     6     7
 *   RMSE (C) | 1.06  2.05  2.08  2.14  2.22  2.36  2.83
 *
 * Two deliberate adjustments on top of that table:
 *
 *  1. `verificationInflation`: the truth field above is the model's own latest analysis, not
 *     station observations, so it cannot see the model's standing bias against reality, and a
 *     1–11 km grid in the southern Appalachians verifies worse than the flat-terrain average.
 *     Published verification against observations for global 2 m temperature is materially larger:
 *     ECMWF IFS and the current generation of data-driven models sit around 2.8–3.7 K RMSE at
 *     day 10 globally (Rasp et al., *WeatherBench 2*, JAMES 16, e2023MS004019, 2024,
 *     doi:10.1029/2023MS004019). 1.2 brings our day-10 value into that range from below.
 *  2. `saturationSdC` / `saturationTauDays`: past day 7 we have no measurement, so the curve
 *     relaxes exponentially towards a ceiling. The ceiling is bounded above by the *climatological*
 *     interannual sd, which at this point in mid-November is 5.7–6.5 °C: a forecast can never be
 *     worse than guessing the climate mean, so 4.0 °C is a defensible asymptote and the resulting
 *     day-16 value (~4.7 °C after inflation) is honestly wide without being useless.
 *
 * Every number here is overridable; nothing in the package hard-codes a spread.
 */
export interface UncertaintyConfig {
  /** RMSE of 2 m temperature, °C, indexed by lead day. Index 0 is today. */
  leadDaySdC: readonly number[];
  /** Asymptote the error approaches beyond the measured range, °C. */
  saturationSdC: number;
  /** e-folding time, days, for the approach to `saturationSdC` past the measured range. */
  saturationTauDays: number;
  /** Multiplier applied to the whole curve; see note 1 above. */
  verificationInflation: number;
  /** Spread assumed when the user typed a high and a low rather than fetching a forecast, °C. */
  manualSdC: number;
  /**
   * Extra spread added in climatology mode, °C. Zero by default: the pooled 20-year sample
   * already contains the full interannual spread, so adding more would be double counting.
   */
  climatologyExtraSdC: number;
}

export const DEFAULT_UNCERTAINTY: UncertaintyConfig = {
  leadDaySdC: [0.7, 1.06, 2.05, 2.08, 2.14, 2.22, 2.36, 2.83],
  saturationSdC: 4.0,
  saturationTauDays: 6,
  verificationInflation: 1.2,
  manualSdC: 2.0,
  climatologyExtraSdC: 0,
};

/** 1 sd of temperature error, °C, for a forecast `daysOut` days ahead. */
export function forecastUncertaintySd(daysOut: number, config: UncertaintyConfig = DEFAULT_UNCERTAINTY): Celsius {
  const table = config.leadDaySdC;
  if (table.length === 0) throw new RangeError('leadDaySdC must not be empty');
  const d = Math.max(0, daysOut);
  if (d < table.length) {
    const lo = Math.floor(d);
    const hi = Math.min(lo + 1, table.length - 1);
    const frac = d - lo;
    const v = table[lo]! + frac * (table[hi]! - table[lo]!);
    return v * config.verificationInflation;
  }
  const last = table.length - 1;
  const lastSd = table[last]!;
  const sat = Math.max(config.saturationSdC, lastSd);
  const v = sat - (sat - lastSd) * Math.exp(-(d - last) / config.saturationTauDays);
  return v * config.verificationInflation;
}

// =============================================================================================
// Generic day builder
// =============================================================================================

/** One realisation of the weather at one hour. Several per hour in climatology mode. */
interface HourSample {
  temperature: number;
  windSpeed: number;
  cloudCover: Fraction;
  relativeHumidity: Fraction;
  precipitation: number;
  precipitationProbability: Fraction | null;
  shortwaveRadiation: number | null;
}

/** Returns every sample for the hour starting at `hourStart`, or `undefined` if not covered. */
type HourLookup = (hourStart: LocalMinutes) => readonly HourSample[] | undefined;

export class MissingHoursError extends Error {
  constructor(
    readonly date: LocalDate,
    readonly phase: PhaseName,
    readonly missing: string[],
  ) {
    super(
      `weather series does not cover ${missing.length} hour(s) of phase "${phase}" on ${date}: ` +
        `${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', ...' : ''}`,
    );
    this.name = 'MissingHoursError';
  }
}

function buildPhase(
  phase: PhaseName,
  window: PhaseWindow,
  lookup: HourLookup,
  date: LocalDate,
  uncertaintySd: Celsius,
  source: WeatherSource,
  sampleYears: number,
): PhaseWeather {
  const hours = hoursInWindow(window);
  const samples: HourSample[] = [];
  /** Per hour, every realisation of the temperature at that hour: see `PhaseWeather`. */
  const temperatureByHourC: Celsius[][] = [];
  const missing: string[] = [];
  /** Per-hour means, used for the quantities that must be summed or averaged over the window. */
  const hourlyPrecipMeans: number[] = [];
  const hourlyPopMeans: number[] = [];

  for (const h of hours) {
    const got = lookup(h);
    if (!got || got.length === 0) {
      missing.push(formatLocal(h));
      continue;
    }
    samples.push(...got);
    temperatureByHourC.push(got.map((s) => s.temperature));
    hourlyPrecipMeans.push(mean(got.map((s) => s.precipitation)));
    const pops = got.map((s) => s.precipitationProbability).filter((p): p is number => p !== null);
    if (pops.length === got.length) hourlyPopMeans.push(mean(pops));
  }

  if (missing.length > 0) throw new MissingHoursError(date, phase, missing);
  if (samples.length === 0) throw new MissingHoursError(date, phase, [formatLocal(window.start)]);

  const swr = samples.map((s) => s.shortwaveRadiation).filter((x): x is number => x !== null);

  return {
    phase,
    startLocal: formatLocal(window.start),
    endLocal: formatLocal(window.end),
    sampleHours: hours.length,
    sampleYears,
    temperature: describe(
      samples.map((s) => s.temperature),
      uncertaintySd,
    ),
    temperatureByHourC,
    windSpeed: describe(samples.map((s) => s.windSpeed)),
    cloudCover: mean(samples.map((s) => s.cloudCover)),
    relativeHumidity: mean(samples.map((s) => s.relativeHumidity)),
    precipitationTotal: sum(hourlyPrecipMeans),
    precipitationProbability: hourlyPopMeans.length === hours.length ? mean(hourlyPopMeans) : null,
    shortwaveRadiation: swr.length === samples.length ? mean(swr) : null,
    uncertaintySd,
    windUncertaintyModelled: false,
    source,
  };
}

function buildDay(args: {
  date: LocalDate;
  sunrise: string;
  sunset: string;
  polar?: boolean;
  lookup: HourLookup;
  uncertaintySd: Celsius;
  source: WeatherSource;
  daysOut: number;
  sampleYears: number;
  windows: PhaseWindowConfig;
}): DayWeather {
  const windows = phaseWindows(
    { date: args.date, sunrise: args.sunrise, sunset: args.sunset, ...(args.polar !== undefined ? { polar: args.polar } : {}) },
    args.windows,
  );
  const phases = Object.fromEntries(
    PHASE_NAMES.map((p) => [
      p,
      buildPhase(p, windows[p], args.lookup, args.date, args.uncertaintySd, args.source, args.sampleYears),
    ]),
  ) as Record<PhaseName, PhaseWeather>;

  return {
    date: args.date,
    sunrise: args.sunrise,
    sunset: args.sunset,
    daysOut: args.daysOut,
    source: args.source,
    phases,
  };
}

// =============================================================================================
// Forecast path
// =============================================================================================

export interface SampleForecastOptions {
  /** A parsed `fetchForecast` response. */
  series: SeriesResponse;
  /** Which dates to emit. Default: every date the series covers end-to-end, including the sleep tail. */
  dates?: readonly LocalDate[];
  /** "Today", `YYYY-MM-DD` local. Default: the first date in the series. Drives `daysOut`. */
  today?: LocalDate;
  /** Display label, e.g. the geocoding result's `label`. */
  label?: string;
  /** The model terrain height, for the UI to show how big the lapse correction was. */
  modelElevation?: Metres;
  windows?: PhaseWindowConfig;
  uncertainty?: UncertaintyConfig;
  horizon?: HorizonConfig;
}

/**
 * Sample a 16-day hourly forecast into per-phase distributions.
 *
 * Dates whose `sleep` phase runs past the end of the series are dropped rather than truncated:
 * a half-sampled night would quietly bias the coldest phase warm.
 */
export function sampleForecast(options: SampleForecastOptions): TripWeather {
  const { series } = options;
  const windows = options.windows ?? DEFAULT_PHASE_WINDOWS;
  const uncertainty = options.uncertainty ?? DEFAULT_UNCERTAINTY;
  const horizon = options.horizon ?? DEFAULT_HORIZON;

  const index = new Map<LocalMinutes, HourSample[]>();
  const h = series.hourly;
  for (let i = 0; i < h.time.length; i++) {
    index.set(parseLocal(h.time[i]!), [
      {
        temperature: h.temperature2m[i]!,
        windSpeed: h.windSpeed10m[i]!,
        cloudCover: h.cloudCover[i]!,
        relativeHumidity: h.relativeHumidity2m[i]!,
        precipitation: h.precipitation[i]!,
        precipitationProbability: h.precipitationProbability[i] ?? null,
        shortwaveRadiation: h.shortwaveRadiation[i]!,
      },
    ]);
  }
  const lookup: HourLookup = (t) => index.get(t);

  const sunByDate = new Map(series.daily.map((d) => [d.date, d]));
  const today = options.today ?? dateOf(h.time[0]!);
  const candidateDates = options.dates ?? series.daily.map((d) => d.date);

  const days: DayWeather[] = [];
  for (const date of candidateDates) {
    const sun = sunByDate.get(date);
    if (!sun) continue;
    const decision = chooseHorizon(date, today, horizon);
    if (options.dates && decision.mode !== 'forecast') {
      throw new RangeError(
        `sampleForecast: ${date} is ${decision.daysOut} days out (${decision.reason}); ` +
          `use sampleClimatology for it. Forecast and climatology are never mixed within a day.`,
      );
    }
    const day = (() => {
      try {
        return buildDay({
          date,
          sunrise: sun.sunrise,
          sunset: sun.sunset,
          polar: sun.polar,
          lookup,
          uncertaintySd: forecastUncertaintySd(decision.daysOut, uncertainty),
          source: 'forecast',
          daysOut: decision.daysOut,
          sampleYears: 1,
          windows,
        });
      } catch (e) {
        // The last date's night always runs off the end of the series; that is expected.
        if (e instanceof MissingHoursError && !options.dates) return undefined;
        throw e;
      }
    })();
    if (day) days.push(day);
  }

  return {
    location: {
      latitude: series.latitude,
      longitude: series.longitude,
      elevation: series.elevation,
      timezone: series.timezone,
      ...(options.modelElevation !== undefined ? { modelElevation: options.modelElevation } : {}),
      ...(options.label !== undefined ? { label: options.label } : {}),
    },
    generatedAtUtc: new Date().toISOString(),
    attribution: OPEN_METEO_ATTRIBUTION,
    days,
  };
}

// =============================================================================================
// Climatology path
// =============================================================================================

export interface SampleClimatologyOptions {
  climatology: ClimatologyResponse;
  /** The dates this climatology stands in for. All get the same hour-of-day sample. */
  dates: readonly LocalDate[];
  today: LocalDate;
  label?: string;
  modelElevation?: Metres;
  windows?: PhaseWindowConfig;
  uncertainty?: UncertaintyConfig;
}

/**
 * Sample a pooled ERA5 climatology into the same per-phase shape.
 *
 * The spread here is the real interannual spread: the pooled sample for a phase is every
 * (year × window-day × hour-in-window) observation, so the quantiles already answer "how cold has
 * this phase actually been on this date, historically", without any extra uncertainty model.
 * `uncertaintySd` is therefore 0 unless `climatologyExtraSdC` is overridden.
 */
export function sampleClimatology(options: SampleClimatologyOptions): TripWeather {
  const { climatology } = options;
  const windows = options.windows ?? DEFAULT_PHASE_WINDOWS;
  const extraSd = (options.uncertainty ?? DEFAULT_UNCERTAINTY).climatologyExtraSdC;

  const byHour = new Map<number, HourSample[]>();
  for (const slot of climatology.byHour) {
    byHour.set(
      slot.hour,
      slot.temperature.map((t, i) => ({
        temperature: t,
        windSpeed: slot.windSpeed[i]!,
        cloudCover: slot.cloudCover[i]!,
        relativeHumidity: slot.relativeHumidity[i]!,
        precipitation: slot.precipitation[i]!,
        // ERA5 has no PoP; the share of historical hours with measurable rain is the honest analogue.
        precipitationProbability: null,
        shortwaveRadiation: slot.shortwaveRadiation[i]!,
      })),
    );
  }

  const days = options.dates.map((date) => {
    const sunrise = `${date}T${climatology.sunrise.slice(11)}`;
    const sunset = `${date}T${climatology.sunset.slice(11)}`;
    const day = buildDay({
      date,
      sunrise,
      sunset,
      lookup: (t) => byHour.get(Math.floor((t - startOfDay(t)) / 60)),
      uncertaintySd: extraSd,
      source: 'climatology',
      daysOut: chooseHorizon(date, options.today).daysOut,
      sampleYears: climatology.years.length,
      windows,
    });
    // Rebuild the precipitation probability from the historical wet-hour share.
    for (const phase of PHASE_NAMES) {
      const w = phaseWindows({ date, sunrise, sunset }, windows);
      const samples = hoursInWindow(w[phase]).flatMap((t) => byHour.get(Math.floor((t - startOfDay(t)) / 60)) ?? []);
      const wet = samples.filter((s) => s.precipitation >= 0.1).length;
      day.phases[phase].precipitationProbability = samples.length > 0 ? wet / samples.length : null;
    }
    return day;
  });

  return {
    location: {
      latitude: climatology.latitude,
      longitude: climatology.longitude,
      elevation: climatology.elevation,
      timezone: climatology.timezone,
      ...(options.modelElevation !== undefined ? { modelElevation: options.modelElevation } : {}),
      ...(options.label !== undefined ? { label: options.label } : {}),
    },
    generatedAtUtc: new Date().toISOString(),
    attribution: OPEN_METEO_ATTRIBUTION,
    days,
  };
}

// =============================================================================================
// Manual path
// =============================================================================================

/**
 * Shape of the synthesised day, as a fraction of the daily range, so it can be unit-tested
 * independently of the actual temperatures.
 *
 * Rise (sunrise -> `peakClock`): a half-cosine. Smooth, zero-derivative at both ends, and the
 * standard form used for daily temperature interpolation.
 *
 * Fall (`peakClock` -> next sunrise): a normalised exponential decay
 *
 *     f(s) = (exp(-s/tau) - exp(-1/tau)) / (1 - exp(-1/tau)),   s = elapsed fraction of the night
 *
 * which is 1 at the peak and exactly 0 at the next sunrise, and sheds most of its heat in the
 * first few hours. That asymmetry is the physical one: clear-sky radiative cooling is fastest
 * immediately after sunset and flattens out towards dawn, which is why the evening drop is steep
 * and the pre-dawn hours hover near the minimum. The default `tau = 0.35` puts the half-way point
 * of the cooling about a quarter of the way through the night.
 */
export interface ManualCurveConfig {
  /** Wall-clock time of the daily maximum. */
  peakClock: string;
  /** Night-time decay constant as a fraction of the time from peak to next sunrise. */
  nightDecayTau: number;
}

export const DEFAULT_MANUAL_CURVE: ManualCurveConfig = { peakClock: '15:00', nightDecayTau: 0.35 };

/**
 * Temperature at `t` for a day whose minimum is `lowC` at sunrise and maximum is `highC` at the
 * configured peak. Exported so the curve can be tested and plotted on its own.
 */
export function manualDiurnalTemperature(
  t: LocalMinutes,
  args: { lowC: Celsius; highC: Celsius; sunrise: LocalMinutes; config?: ManualCurveConfig },
): Celsius {
  const cfg = args.config ?? DEFAULT_MANUAL_CURVE;
  const range = args.highC - args.lowC;
  const dayStart = startOfDay(args.sunrise);
  const peak = atClock(dayStart, cfg.peakClock);
  // Work out which rise/fall segment `t` is in, shifting by whole days as needed.
  let x = t;
  while (x < args.sunrise - 720) x += 1440;
  while (x >= args.sunrise + 1440 - 720) x -= 1440;

  if (x <= args.sunrise) {
    // Pre-dawn: the tail of the previous night's decay.
    return fall(x + 1440, peak, args.sunrise + 1440, range, args.lowC, cfg);
  }
  if (x <= peak) {
    const frac = (x - args.sunrise) / (peak - args.sunrise);
    return args.lowC + (range * (1 - Math.cos(Math.PI * frac))) / 2;
  }
  return fall(x, peak, args.sunrise + 1440, range, args.lowC, cfg);
}

function fall(
  x: LocalMinutes,
  peak: LocalMinutes,
  nextSunrise: LocalMinutes,
  range: number,
  lowC: number,
  cfg: ManualCurveConfig,
): number {
  const span = nextSunrise - peak;
  const s = Math.min(Math.max((x - peak) / span, 0), 1);
  const e = Math.exp(-1 / cfg.nightDecayTau);
  const f = (Math.exp(-s / cfg.nightDecayTau) - e) / (1 - e);
  return lowC + range * f;
}

export interface SampleManualOptions {
  /** Daily maximum, °C. */
  highC: Celsius;
  /** Daily minimum, °C, which lands at sunrise. */
  lowC: Celsius;
  /** Dates to emit. Every date gets the same high/low. */
  dates: readonly LocalDate[];
  today?: LocalDate;
  latitude: number;
  longitude: number;
  elevation: Metres;
  /** IANA zone for display only; sun times come from `utcOffsetHours`. */
  timezone?: string;
  /** Offset from UTC in hours. Defaults to the longitudinal mean. */
  utcOffsetHours?: number;
  label?: string;
  /** Constant 10 m wind speed, m/s. Default 1.5 (a light breeze, not still air). */
  windSpeedMs?: number;
  /** Constant cloud cover, 0..1. Default 0.5. */
  cloudCover?: Fraction;
  /** Constant relative humidity, 0..1. Default 0.7. */
  relativeHumidity?: Fraction;
  /** Constant precipitation rate, mm/h. Default 0. */
  precipitationMmPerHour?: number;
  /** 1 sd of the user's confidence in their high/low, °C. Default `DEFAULT_UNCERTAINTY.manualSdC`. */
  uncertaintySdC?: Celsius;
  windows?: PhaseWindowConfig;
  curve?: ManualCurveConfig;
  uncertainty?: UncertaintyConfig;
}

/**
 * Synthesise the identical `TripWeather` shape from a typed-in high and low.
 *
 * `source` is `'manual'` and `shortwaveRadiation` / `precipitationProbability` are `null`, but
 * every field the physics engine reads is populated, in the same units, with the same semantics.
 */
export function sampleManual(options: SampleManualOptions): TripWeather {
  if (!(options.highC >= options.lowC)) {
    throw new RangeError(`sampleManual: highC (${options.highC}) must be >= lowC (${options.lowC})`);
  }
  const windows = options.windows ?? DEFAULT_PHASE_WINDOWS;
  const uncertaintySd = options.uncertaintySdC ?? (options.uncertainty ?? DEFAULT_UNCERTAINTY).manualSdC;
  const wind = options.windSpeedMs ?? 1.5;
  const cloud = options.cloudCover ?? 0.5;
  const rh = options.relativeHumidity ?? 0.7;
  const precip = options.precipitationMmPerHour ?? 0;
  const today = options.today ?? options.dates[0]!;

  const days = options.dates.map((date) => {
    const sun = sunTimes(date, options.latitude, options.longitude, options.utcOffsetHours);
    const sunriseMinutes = parseLocal(sun.sunrise);
    const lookup: HourLookup = (t) => [
      {
        // Sample the curve at the centre of the hour, matching the midpoint rule.
        temperature: manualDiurnalTemperature(t + 30, {
          lowC: options.lowC,
          highC: options.highC,
          sunrise: sunriseMinutes,
          ...(options.curve ? { config: options.curve } : {}),
        }),
        windSpeed: wind,
        cloudCover: cloud,
        relativeHumidity: rh,
        precipitation: precip,
        precipitationProbability: null,
        shortwaveRadiation: null,
      },
    ];
    return buildDay({
      date,
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      polar: sun.polar,
      lookup,
      uncertaintySd,
      source: 'manual',
      daysOut: chooseHorizon(date, today).daysOut,
      sampleYears: 1,
      windows,
    });
  });

  return {
    location: {
      latitude: options.latitude,
      longitude: options.longitude,
      elevation: options.elevation,
      timezone: options.timezone ?? 'UTC',
      ...(options.label !== undefined ? { label: options.label } : {}),
    },
    generatedAtUtc: new Date().toISOString(),
    attribution: 'Manual high/low entered by the user; no external data source.',
    days,
  };
}
