/**
 * The live path: a `TripSpec` to a `LoadedTrip`, through the weather package's real clients.
 *
 * Nothing here is fetched until the user asks. The recorded fixture (`fixture.ts`) is the
 * panel's starting state and stays its offline fallback; this file is the upgrade from it.
 *
 * WHAT ONE LOAD COSTS. Two forecast calls (the lapse-corrected one the trip uses, and the
 * same request without `elevation=` so the correction can be shown as a measured number
 * rather than implied), plus, only when a night lies beyond the 16-day horizon or past the
 * end of the model run, one climatology: twenty one-year archive calls, at most
 * `MAX_IN_FLIGHT` at a time because the archive refuses more, and cached in `localStorage` by
 * (rounded point, elevation, month-day) because it is the one expensive operation
 * (`packages/weather/README.md` §1.3).
 *
 * FORECAST AND CLIMATOLOGY ARE NEVER MIXED WITHIN A NIGHT. `sampleForecast` without `dates`
 * emits every night the series covers end to end and drops the ragged last one; whichever of
 * the trip's nights that leaves out, horizon or tail, is served as climatology and labelled
 * as such, per night, in `LoadedTrip.nightsBySource`.
 */

import {
  fetchClimatology,
  fetchForecast,
  forecastUrl,
  geocode,
  lookupElevations,
  OpenMeteoApiError,
  parseForecast,
  sampleClimatology,
  sampleForecast,
  type ClimatologyResponse,
  type FetchJson,
  type GeocodeResult,
  type LocalDate,
  type Metres,
  type SeriesResponse,
  type TripWeather,
} from '@will-i-be-cold/weather';
import {
  classifyFailure,
  formatLatLon,
  lapseCorrection,
  nightsBySource,
  tripDates,
  tripSubset,
  type LoadedTrip,
  type Place,
  type TripSpec,
} from '../model/trip.js';

export type LoadStep = 'forecast' | 'climatology';

export interface LoadOptions {
  readonly fetchJson: FetchJson;
  readonly signal?: AbortSignal;
  readonly onStep?: (step: LoadStep) => void;
  /** Injected for tests; defaults to `localStorage` when there is one. */
  readonly cache?: Storage | null;
}

// ---------------------------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------------------------

/** Ranked candidates for a typed name. The empty list is the geocoder's honest "no match". */
export async function searchPlaces(name: string, fetchJson: FetchJson): Promise<GeocodeResult[]> {
  return geocode({ name, count: 8 }, fetchJson);
}

/** A geocoding hit as a place, before its DEM height is known. */
export function placeFromResult(r: GeocodeResult): Place {
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    label: r.label,
    origin: 'search',
    demElevation: null,
    elevation: null,
    timezone: r.timezone,
  };
}

/** A dropped pin as a place, before its DEM height is known. */
export function placeFromPin(latitude: number, longitude: number): Place {
  return {
    latitude,
    longitude,
    label: `Pin at ${formatLatLon(latitude, longitude)}`,
    origin: 'pin',
    demElevation: null,
    elevation: null,
    timezone: null,
  };
}

/** The 90 m DEM height at the place, set as both the terrain height and the height to forecast for. */
export async function withDemElevation(place: Place, fetchJson: FetchJson): Promise<Place> {
  const [dem] = await lookupElevations([{ latitude: place.latitude, longitude: place.longitude }], fetchJson);
  if (dem === undefined) throw new RangeError('lookupElevations returned nothing for one point');
  return { ...place, demElevation: dem, elevation: dem };
}

// ---------------------------------------------------------------------------------------------
// The forecast, with and without the correction
// ---------------------------------------------------------------------------------------------

/**
 * The same request with `elevation=` removed. Used for one thing only: measuring what the
 * correction was worth at this point. The trip itself always uses the corrected series;
 * `fetchForecast` will not build a request without an elevation, and nothing here asks it to.
 */
export function uncorrectedForecastUrl(req: { latitude: number; longitude: number; elevation: Metres }): string {
  const u = new URL(forecastUrl(req));
  u.searchParams.delete('elevation');
  return u.toString();
}

async function fetchBothForecasts(
  pin: { latitude: number; longitude: number; elevation: Metres },
  fetchJson: FetchJson,
): Promise<{ corrected: SeriesResponse; uncorrected: SeriesResponse }> {
  const [corrected, uncorrected] = await Promise.all([
    fetchForecast(pin, fetchJson),
    fetchJson(uncorrectedForecastUrl(pin)).then(parseForecast),
  ]);
  return { corrected, uncorrected };
}

// ---------------------------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------------------------

/**
 * How many requests to have in flight at once.
 *
 * Measured 2026-11-14 against the archive endpoint with the twenty one-year requests a
 * climatology needs: all twenty at once gets nine of them refused with HTTP 429 "Too many
 * concurrent requests" (a separate ceiling from the per-minute budget in the README); eight
 * at once passes cleanly, as does four. Four leaves a wide margin under the measured pass, and
 * the twenty still complete in about a second from a browser.
 *
 * Once that ceiling has been tripped the archive answers slowly for a while and may refuse a
 * stray request even under the limit, so a refusal that names concurrency is retried a few
 * times with a pause (`retryConcurrencyRefusals`). Any other refusal is reported at once.
 */
export const MAX_IN_FLIGHT = 4;

const CONCURRENCY_RETRIES = 3;
const CONCURRENCY_PAUSE_MS = 1500;

/** The same `FetchJson`, retrying only the archive's "Too many concurrent requests" refusal, with a growing pause. */
export function retryConcurrencyRefusals(fetchJson: FetchJson, retries: number = CONCURRENCY_RETRIES, pauseMs: number = CONCURRENCY_PAUSE_MS): FetchJson {
  return async (url: string) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchJson(url);
      } catch (e) {
        const concurrent = e instanceof OpenMeteoApiError && e.status === 429 && /concurrent/i.test(e.reason);
        if (!concurrent || attempt >= retries) throw e;
        await new Promise<void>((resolve) => setTimeout(resolve, pauseMs * (attempt + 1)));
      }
    }
  };
}

/** The same `FetchJson`, never more than `limit` requests in flight. The weather package's own `Promise.all` then queues here. */
export function limitInFlight(fetchJson: FetchJson, limit: number = MAX_IN_FLIGHT): FetchJson {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };
  return async (url: string) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await fetchJson(url);
    } finally {
      release();
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Climatology, cached
// ---------------------------------------------------------------------------------------------

const CACHE_PREFIX = 'wibc:climatology:v1:';

function cacheKey(pin: { latitude: number; longitude: number; elevation: Metres }, targetDate: LocalDate): string {
  return `${CACHE_PREFIX}${pin.latitude.toFixed(2)},${pin.longitude.toFixed(2)},${Math.round(pin.elevation)},${targetDate.slice(5)}`;
}

function defaultCache(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function climatologyFor(
  pin: { latitude: number; longitude: number; elevation: Metres },
  targetDate: LocalDate,
  fetchJson: FetchJson,
  cache: Storage | null,
): Promise<ClimatologyResponse> {
  const key = cacheKey(pin, targetDate);
  if (cache !== null) {
    try {
      const hit = cache.getItem(key);
      if (hit !== null) return JSON.parse(hit) as ClimatologyResponse;
    } catch {
      // a corrupt or inaccessible cache entry is just a miss
    }
  }
  const fresh = await fetchClimatology({ ...pin, targetDate }, fetchJson);
  if (cache !== null) {
    try {
      cache.setItem(key, JSON.stringify(fresh));
    } catch {
      // quota or privacy mode: the fetch still succeeded
    }
  }
  return fresh;
}

// ---------------------------------------------------------------------------------------------
// The load
// ---------------------------------------------------------------------------------------------

/**
 * Fetch and sample the trip. Throws the underlying error; callers name it with
 * `classifyFailure`. `signal` aborts the in-flight fetches through the caller's `fetchJson`.
 */
export async function loadLiveTrip(spec: TripSpec, options: LoadOptions): Promise<LoadedTrip> {
  const pin = spec.pins[0];
  if (pin === undefined) throw new RangeError('loadLiveTrip: the trip has no pin');
  if (pin.elevation === null) throw new RangeError('loadLiveTrip: the pin has no elevation to forecast for');
  const point = { latitude: pin.latitude, longitude: pin.longitude, elevation: pin.elevation };
  const dates = tripDates(spec);
  const cache = options.cache === undefined ? defaultCache() : options.cache;
  const fetchJson = limitInFlight(retryConcurrencyRefusals(options.fetchJson));

  options.onStep?.('forecast');
  const { corrected, uncorrected } = await fetchBothForecasts(point, fetchJson);
  throwIfAborted(options.signal);
  const lapse = lapseCorrection(corrected, uncorrected);

  // `today` is the place's own date: the first date of the run, not the browser's clock.
  const today = corrected.daily[0]?.date;
  if (today === undefined) throw new RangeError('the forecast carried no daily block');
  if (dates[0]! < today) {
    throw new RangeError(`the trip starts ${dates[0]} but it is already ${today} at that point: the start date is in the past`);
  }

  const full = sampleForecast({ series: corrected, label: pin.label, modelElevation: lapse.modelElevation });
  const fromForecast = tripSubset(full, dates);
  const covered = new Set(fromForecast.days.map((d) => d.date));
  const missing = dates.filter((d) => !covered.has(d));

  let weather: TripWeather = fromForecast;
  let climatologyYears: readonly number[] | null = null;
  if (missing.length > 0) {
    options.onStep?.('climatology');
    const middle = missing[Math.floor(missing.length / 2)]!;
    const climatology = await climatologyFor(point, middle, fetchJson, cache);
    throwIfAborted(options.signal);
    const normals = sampleClimatology({ climatology, dates: missing, today, label: pin.label, modelElevation: lapse.modelElevation });
    climatologyYears = climatology.years;
    weather = {
      ...fromForecast,
      days: [...fromForecast.days, ...normals.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    };
  }

  const fetchedAtUtc = new Date().toISOString();
  const bySource = nightsBySource(weather.days);
  return {
    weather,
    spec,
    source: 'live',
    provenance: describeLive({ pin: point, label: pin.label, lapse, fetchedAtUtc, bySource, truncatedHours: corrected.truncatedHours ?? 0, climatologyYears, lastDate: corrected.daily[corrected.daily.length - 1]?.date ?? today }),
    lapse,
    nightsBySource: bySource,
    truncatedHours: corrected.truncatedHours ?? 0,
    fetchedAtUtc,
    climatologyYears,
  };
}

/** `+1.2`, `\u22122.4`: a real minus sign in prose. */
function signed(x: number): string {
  const v = x.toFixed(1);
  return v.startsWith('-') ? `\u2212${v.slice(1)}` : `+${v}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
}

function describeLive(a: {
  pin: { latitude: number; longitude: number; elevation: Metres };
  label: string;
  lapse: ReturnType<typeof lapseCorrection>;
  fetchedAtUtc: string;
  bySource: Readonly<Record<'forecast' | 'climatology' | 'manual', readonly LocalDate[]>>;
  truncatedHours: number;
  climatologyYears: readonly number[] | null;
  lastDate: LocalDate;
}): string {
  const when = `${a.fetchedAtUtc.slice(0, 10)} ${a.fetchedAtUtc.slice(11, 16)} UTC`;
  const parts = [
    `Live Open-Meteo forecast for ${formatLatLon(a.pin.latitude, a.pin.longitude)} at elevation ${Math.round(a.pin.elevation)} m (${a.label}), fetched ${when}.`,
    `The model's own terrain there is ${Math.round(a.lapse.modelElevation)} m; asking for ${Math.round(a.lapse.trailElevation)} m moved the 2 m temperature by ${signed(a.lapse.meanDeltaC)} °C on average over ${a.lapse.hoursCompared} forecast hours.`,
  ];
  if (a.bySource.climatology.length > 0) {
    const years = a.climatologyYears;
    const span = years !== null && years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : 'past years';
    const nights = a.bySource.climatology.length === 1 ? `The night of ${a.bySource.climatology[0]} is` : `${a.bySource.climatology.length} nights are`;
    parts.push(`${nights} beyond what the forecast run covers and shown as ERA5 climatology (${span}): what that date usually does at this point, not a forecast.`);
  }
  if (a.truncatedHours > 0) {
    parts.push(`The current model run had not yet produced the last ${a.truncatedHours} hours of ${a.lastDate}; that is normal between runs.`);
  }
  return parts.join(' ');
}

export { classifyFailure };
