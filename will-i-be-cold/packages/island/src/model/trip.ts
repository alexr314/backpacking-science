/**
 * The trip: where, at what height, and when. Pure functions only; the I/O is in `data/live.ts`.
 *
 * A trip is a list of pins and a run of nights. SPEC §9 allows two or three pins for a route
 * (start, high camp, end); this pass reads the first pin only, but the shape is the route's
 * shape so adding the others later changes `data/live.ts`, not every caller.
 *
 * THE POINT IS A POINT, NOT A TOWN. Open-Meteo takes an `elevation=` and lapse-corrects from
 * its model terrain to it (`packages/weather/README.md` §1.2: 2.0 to 3.5 °C at the Smokies
 * test point). So a place carries two heights: the 90 m DEM's terrain height at the pin,
 * which is the default, and the height the forecast is asked for, which the user may
 * override (the DEM reads the valley floor under a trail that climbs out of it, or the ridge
 * when camp is in the gap). `LapseCorrection` is what that parameter was worth, measured
 * from the two series rather than quoted from a lapse rate.
 *
 * HORIZON. `chooseHorizon` is the one rule: within 16 days a forecast, beyond it climatology,
 * labelled, never mixed within a day. `planHorizon` applies it to the trip's dates.
 *
 * POOLED BY DEFAULT. The panel shows every phase pooled over the whole trip and steps down
 * to one night on demand. `phaseDistributions` from the weather package provides the pooled
 * temperature marginal and the pooled encounter curve; `pooledPhaseWeather` dresses that as
 * a `PhaseWeather` for the engine, filling the non-temperature fields (wind, cloud, humidity,
 * sun) by pooling the nights with the weather package's own `mean` and `describeSample`.
 */

import {
  chooseHorizon,
  dateRange,
  describeSample,
  mean,
  OpenMeteoApiError,
  OpenMeteoShapeError,
  type DayWeather,
  type HorizonDecision,
  type LocalDate,
  type Metres,
  type PhaseDistribution,
  type PhaseName,
  type PhaseWeather,
  type SeriesResponse,
  type TripWeather,
  type WeatherSource,
} from '@will-i-be-cold/weather';

// ---------------------------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------------------------

/** How a point was chosen; it changes the words around it, never the data path. */
export type PlaceOrigin = 'search' | 'pin' | 'fixture';

export interface Place {
  readonly latitude: number;
  readonly longitude: number;
  /** Disambiguated, e.g. "Gatlinburg, Tennessee, United States", or "Pin at 35.606 N, 83.467 W". */
  readonly label: string;
  readonly origin: PlaceOrigin;
  /** Terrain height at the point from the 90 m DEM; `null` until looked up or if the lookup failed. */
  readonly demElevation: Metres | null;
  /** The height the forecast is asked for. Starts as the DEM and may be overridden. `null` = not yet known. */
  readonly elevation: Metres | null;
  /** IANA zone when the geocoder knew it; display only. */
  readonly timezone: string | null;
}

export interface TripSpec {
  /** One to three points. This pass reads `pins[0]`; see the file comment. */
  readonly pins: readonly Place[];
  readonly startDate: LocalDate;
  /** How many nights out, 1 to `MAX_NIGHTS`. */
  readonly nights: number;
}

/** The longest trip the night selector lays out as a row of buttons. */
export const MAX_NIGHTS = 10;

export const MAX_PINS = 3;

/** The dates of the trip's nights, the start date first. */
export function tripDates(spec: Pick<TripSpec, 'startDate' | 'nights'>): LocalDate[] {
  const nights = clampNights(spec.nights);
  return dateRange(spec.startDate, addDaysLocal(spec.startDate, nights - 1));
}

export function clampNights(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_NIGHTS, Math.max(1, Math.round(n)));
}

/** `YYYY-MM-DD` plus n days, by calendar arithmetic in UTC so no local zone leaks in. */
export function addDaysLocal(date: LocalDate, n: number): LocalDate {
  const base = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(base + n * 86_400_000).toISOString().slice(0, 10);
}

/** Today's date as the browser sees it, `YYYY-MM-DD`, from the local clock rather than UTC. */
export function localToday(now: Date = new Date()): LocalDate {
  const pad = (x: number): string => (x < 10 ? `0${x}` : String(x));
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The spec's pin, or null while none has been chosen. */
export function primaryPin(spec: TripSpec): Place | null {
  return spec.pins[0] ?? null;
}

/** Why the spec cannot be fetched yet, or null when it can. One reason, the first that applies. */
export function specProblem(spec: TripSpec, today: LocalDate): string | null {
  const pin = primaryPin(spec);
  if (pin === null) return 'Choose a place first: search for one, or drop a pin.';
  if (pin.elevation === null || !Number.isFinite(pin.elevation)) return 'Enter the elevation the forecast should be made for.';
  if (pin.elevation < -500 || pin.elevation > 9000) return 'That elevation is outside anywhere on land.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.startDate)) return 'Pick a start date.';
  const plan = planHorizon(tripDates(spec), today);
  if (plan.past.length > 0) return 'The start date has passed. This tool answers "will I be cold", so it needs a night still to come.';
  return null;
}

// ---------------------------------------------------------------------------------------------
// The horizon
// ---------------------------------------------------------------------------------------------

export interface HorizonPlan {
  readonly forecast: readonly LocalDate[];
  readonly climatology: readonly LocalDate[];
  readonly past: readonly LocalDate[];
  readonly lastForecastDate: LocalDate;
  readonly decisions: readonly HorizonDecision[];
}

/** `chooseHorizon` over every night of the trip. */
export function planHorizon(dates: readonly LocalDate[], today: LocalDate): HorizonPlan {
  const decisions = dates.map((d) => chooseHorizon(d, today));
  const first = decisions[0];
  return {
    forecast: dates.filter((_, i) => decisions[i]!.mode === 'forecast'),
    climatology: dates.filter((_, i) => decisions[i]!.reason === 'beyond-horizon'),
    past: dates.filter((_, i) => decisions[i]!.reason === 'past'),
    lastForecastDate: first?.lastForecastDate ?? chooseHorizon(today, today).lastForecastDate,
    decisions,
  };
}

// ---------------------------------------------------------------------------------------------
// The lapse correction, measured
// ---------------------------------------------------------------------------------------------

export interface LapseCorrection {
  /** The terrain height Open-Meteo would have used on its own. */
  readonly modelElevation: Metres;
  /** The height the forecast was made for. */
  readonly trailElevation: Metres;
  /** Mean of (corrected minus uncorrected) 2 m temperature over the hours both series share, °C. */
  readonly meanDeltaC: number;
  readonly hoursCompared: number;
}

/**
 * What `elevation=` was worth, measured: the same request with and without it, differenced
 * hour by hour. This is the README §1.2 measurement done live for the user's own point.
 */
export function lapseCorrection(corrected: SeriesResponse, uncorrected: SeriesResponse): LapseCorrection {
  const byTime = new Map<string, number>();
  uncorrected.hourly.time.forEach((t, i) => byTime.set(t, uncorrected.hourly.temperature2m[i]!));
  const deltas: number[] = [];
  corrected.hourly.time.forEach((t, i) => {
    const base = byTime.get(t);
    if (base !== undefined) deltas.push(corrected.hourly.temperature2m[i]! - base);
  });
  if (deltas.length === 0) throw new RangeError('lapseCorrection: the two series share no hours');
  return {
    modelElevation: uncorrected.elevation,
    trailElevation: corrected.elevation,
    meanDeltaC: mean(deltas),
    hoursCompared: deltas.length,
  };
}

// ---------------------------------------------------------------------------------------------
// What the panel holds
// ---------------------------------------------------------------------------------------------

export type TripSource = 'fixture' | 'live';

export interface LoadedTrip {
  /** Only the trip's nights, in order. */
  readonly weather: TripWeather;
  readonly spec: TripSpec;
  readonly source: TripSource;
  /** One or two sentences for the attribution line: what this data is and where it came from. */
  readonly provenance: string;
  readonly lapse: LapseCorrection | null;
  /** Which nights came from the forecast and which from climatology, after fetching. */
  readonly nightsBySource: Readonly<Record<WeatherSource, readonly LocalDate[]>>;
  /** Hours the live model run had not produced at the end of its 16 days. Normal; not an error. */
  readonly truncatedHours: number;
  /** ISO 8601 UTC, or null for the recorded fixture (whose capture time is in its provenance). */
  readonly fetchedAtUtc: string | null;
  /** Climatology years pooled, when any night is climatology. */
  readonly climatologyYears: readonly number[] | null;
}

/** The nights of `full` that fall on `dates`, in date order. */
export function tripSubset(full: TripWeather, dates: readonly LocalDate[]): TripWeather {
  const wanted = new Set(dates);
  return { ...full, days: full.days.filter((d) => wanted.has(d.date)) };
}

export function nightsBySource(days: readonly DayWeather[]): Record<WeatherSource, LocalDate[]> {
  const out: Record<WeatherSource, LocalDate[]> = { forecast: [], climatology: [], manual: [] };
  for (const d of days) out[d.source].push(d.date);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pooled versus per night
// ---------------------------------------------------------------------------------------------

/** What the phase tabs show: the whole trip pooled, or one of its nights. */
export type NightScope = { readonly kind: 'trip' } | { readonly kind: 'night'; readonly index: number };

export const WHOLE_TRIP: NightScope = { kind: 'trip' };

/**
 * One `PhaseWeather` for a phase pooled over the trip's nights, for the engine.
 *
 * Temperature is the weather package's pooled marginal (`PhaseDistribution.temperature`),
 * which already carries each night's lead-time uncertainty. The other fields are pooled here
 * with the package's own statistics: means weighted by hours for the fractions and the sun,
 * and `describeSample` over the nights' median winds for the wind (the engine reads `p50`).
 * A one-night trip reproduces that night's record exactly, so the per-night view and the
 * pooled view of a single night cannot disagree.
 */
export function pooledPhaseWeather(days: readonly DayWeather[], phase: PhaseName, pooled: PhaseDistribution): PhaseWeather {
  const nights = days.map((d) => d.phases[phase]);
  const first = nights[0];
  if (first === undefined) throw new RangeError('pooledPhaseWeather: no nights');
  if (nights.length === 1) return first;

  const hours = nights.map((n) => n.sampleHours);
  const weighted = (pick: (n: PhaseWeather) => number): number => {
    const total = hours.reduce((a, b) => a + b, 0);
    return nights.reduce((s, n, i) => s + pick(n) * (hours[i]! / total), 0);
  };
  const sources = new Set(nights.map((n) => n.source));
  const swr = nights.map((n) => n.shortwaveRadiation);
  const pops = nights.map((n) => n.precipitationProbability);

  return {
    phase,
    startLocal: first.startLocal,
    endLocal: first.endLocal,
    sampleHours: hours.reduce((a, b) => a + b, 0),
    sampleYears: Math.max(...nights.map((n) => n.sampleYears)),
    temperature: pooled.temperature,
    windSpeed: describeSample(nights.map((n) => n.windSpeed.p50)),
    cloudCover: weighted((n) => n.cloudCover),
    relativeHumidity: weighted((n) => n.relativeHumidity),
    precipitationTotal: mean(nights.map((n) => n.precipitationTotal)),
    precipitationProbability: pops.every((p): p is number => p !== null) ? weighted((n) => n.precipitationProbability as number) : null,
    shortwaveRadiation: swr.every((x): x is number => x !== null) ? weighted((n) => n.shortwaveRadiation as number) : null,
    uncertaintySd: weighted((n) => n.uncertaintySd),
    windUncertaintyModelled: nights.every((n) => n.windUncertaintyModelled),
    // A pool with any climatology in it is not a forecast, and says so.
    source: sources.size === 1 ? first.source : sources.has('climatology') ? 'climatology' : first.source,
  };
}

// ---------------------------------------------------------------------------------------------
// Failure, named
// ---------------------------------------------------------------------------------------------

export type TripFailureKind = 'offline' | 'rate-limit' | 'api' | 'shape' | 'no-match' | 'past' | 'aborted' | 'unknown';

export interface TripFailure {
  readonly kind: TripFailureKind;
  /** One sentence for the user. */
  readonly message: string;
  /** The underlying error's words, for the small print. */
  readonly detail: string | null;
}

/** Turn whatever the fetch threw into one of the states the UI has words for. */
export function classifyFailure(e: unknown): TripFailure {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { kind: 'aborted', message: 'Cancelled.', detail: null };
  }
  if (e instanceof OpenMeteoApiError) {
    const limited = e.status === 429 || /limit|too many/i.test(e.reason);
    return limited
      ? {
          kind: 'rate-limit',
          message: 'Open-Meteo is rate-limiting this connection. Wait a minute and try again; the free tier allows 600 calls a minute per address.',
          detail: e.reason,
        }
      : { kind: 'api', message: 'Open-Meteo refused the request.', detail: e.reason };
  }
  if (e instanceof OpenMeteoShapeError) {
    return {
      kind: 'shape',
      message: 'Open-Meteo answered, but not in the shape this tool checks for, so nothing was shown rather than something wrong.',
      detail: e.message,
    };
  }
  if (e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return {
      kind: 'offline',
      message: 'Could not reach Open-Meteo. You look to be offline; the recorded Smokies trip still works without a network.',
      detail: e instanceof Error ? e.message : null,
    };
  }
  if (e instanceof RangeError && /past|days out/.test(e.message)) {
    return { kind: 'past', message: 'That date has already passed at the place you chose.', detail: e.message };
  }
  return { kind: 'unknown', message: 'Something went wrong fetching the weather.', detail: e instanceof Error ? e.message : String(e) };
}

/** `35.6056, -83.4672` (or with N/S/E/W letters) to a point, or null when it does not parse. */
export function parsePin(text: string): { latitude: number; longitude: number } | null {
  const cleaned = text.trim().replace(/[()°]/g, ' ');
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([NnSs])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*([EeWw])?\s*$/.exec(cleaned);
  if (m === null) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] !== undefined && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] !== undefined && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: lat, longitude: lon };
}

/** `35.606 N, 83.467 W`. */
export function formatLatLon(latitude: number, longitude: number, digits = 3): string {
  const lat = `${Math.abs(latitude).toFixed(digits)} ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(digits)} ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

/** Metres, with a thin space for the thousands as the panel already writes "1 800 m". */
export function formatMetres(m: number): string {
  const r = Math.round(m);
  const s = String(Math.abs(r));
  const grouped = s.length > 3 ? `${s.slice(0, -3)} ${s.slice(-3)}` : s;
  return `${r < 0 ? '−' : ''}${grouped} m`;
}

/** Feet, for the US reader; the factor is the definition of the international foot, not a model number. */
export function formatFeet(m: number): string {
  return `${Math.round(m / 0.3048).toLocaleString('en-US')} ft`;
}
