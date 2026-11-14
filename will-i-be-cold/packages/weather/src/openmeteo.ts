/**
 * Thin, strictly-validating clients for the four keyless Open-Meteo endpoints this project uses.
 *
 * Design rules:
 *  - Every network call goes through one injectable `FetchJson`, so tests run offline.
 *  - Responses are *parsed*, not cast. A short series, a `null` where a number belongs, a gap in
 *    the hourly timestamps or a percentage outside 0..100 throws `OpenMeteoShapeError`. Nothing
 *    here can hand the physics engine a `NaN`.
 *  - Units are converted to SI/fractions exactly once, here at the edge.
 *
 * Endpoints and what each is for:
 *  - Geocoding : place name → ranked lat/lon candidates with admin names, for disambiguation.
 *  - Elevation : 90 m DEM height for a dropped pin (batched: many coordinates per request).
 *  - Forecast  : 16 days of hourly NWP, lapse-corrected to the trail elevation via `elevation=`.
 *  - Archive   : ERA5 reanalysis, for the climatology fallback beyond the forecast horizon.
 *
 * Attribution: Open-Meteo's data is CC BY 4.0. See `OPEN_METEO_ATTRIBUTION` in `types.ts` and
 * the licence section of the README: attribution is a licence term, not a courtesy.
 */

import type { Fraction, LocalDate, LocalDateTime, Metres } from './types.js';
import { dateOf, parseLocal } from './localtime.js';

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

/** The single seam between this package and the network. Must reject on non-2xx. */
export type FetchJson = (url: string) => Promise<unknown>;

/** The API answered, but with its error envelope: `{"error": true, "reason": "..."}`. */
export class OpenMeteoApiError extends Error {
  constructor(
    readonly reason: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(`Open-Meteo rejected the request (${status ?? 'no status'}): ${reason}`);
    this.name = 'OpenMeteoApiError';
  }
}

/** The response did not have the shape we require. Never swallowed, never defaulted away. */
export class OpenMeteoShapeError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path})`);
    this.name = 'OpenMeteoShapeError';
  }
}

/** Base URLs, overridable so a caching proxy can be dropped in without touching call sites. */
export interface OpenMeteoEndpoints {
  forecast: string;
  archive: string;
  geocoding: string;
  elevation: string;
}

export const DEFAULT_ENDPOINTS: OpenMeteoEndpoints = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
  elevation: 'https://api.open-meteo.com/v1/elevation',
};

/**
 * Build a `FetchJson` over the platform `fetch`.
 *
 * All four endpoints send `access-control-allow-origin: *` (verified 2026-11-13), so this works
 * directly from a browser with no backend and no API key.
 */
export function createFetchJson(options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): FetchJson {
  const f = options.fetchImpl ?? globalThis.fetch;
  if (typeof f !== 'function') throw new TypeError('no fetch implementation available');
  return async (url: string) => {
    const res = await f(url, options.signal ? { signal: options.signal } : {});
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new OpenMeteoShapeError(`response was not JSON: ${text.slice(0, 200)}`, url);
    }
    if (isRecord(body) && body['error'] === true) {
      throw new OpenMeteoApiError(String(body['reason'] ?? 'unknown'), url, res.status);
    }
    if (!res.ok) throw new OpenMeteoApiError(text.slice(0, 200), url, res.status);
    return body;
  };
}

// ---------------------------------------------------------------------------------------------
// Validation primitives
// ---------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) throw new OpenMeteoShapeError(`expected an object, got ${describeType(v)}`, path);
  return v;
}

function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new OpenMeteoShapeError(`expected an array, got ${describeType(v)}`, path);
  return v;
}

function asFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new OpenMeteoShapeError(`expected a finite number, got ${describeType(v)}`, path);
  }
  return v;
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new OpenMeteoShapeError(`expected a string, got ${describeType(v)}`, path);
  return v;
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `an array(${v.length})`;
  if (typeof v === 'number' && !Number.isFinite(v)) return `the non-finite number ${v}`;
  return `${typeof v} ${JSON.stringify(v)?.slice(0, 40) ?? ''}`.trim();
}

/** Strict numeric series: right length, every element finite. */
function numberSeries(v: unknown, path: string, expectedLength: number): number[] {
  const arr = asArray(v, path);
  if (arr.length !== expectedLength) {
    throw new OpenMeteoShapeError(`expected ${expectedLength} values, got ${arr.length}`, path);
  }
  return arr.map((x, i) => asFiniteNumber(x, `${path}[${i}]`));
}

/** Numeric series that is allowed to contain `null` (only where the API genuinely has gaps). */
function nullableNumberSeries(v: unknown, path: string, expectedLength: number): (number | null)[] {
  const arr = asArray(v, path);
  if (arr.length !== expectedLength) {
    throw new OpenMeteoShapeError(`expected ${expectedLength} values, got ${arr.length}`, path);
  }
  return arr.map((x, i) => (x === null ? null : asFiniteNumber(x, `${path}[${i}]`)));
}

/** Percent → 0..1, rejecting anything outside the documented range rather than clamping silently. */
function percentSeries(v: unknown, path: string, expectedLength: number): Fraction[] {
  return numberSeries(v, path, expectedLength).map((x, i) => {
    if (x < 0 || x > 100) throw new OpenMeteoShapeError(`percentage out of range: ${x}`, `${path}[${i}]`);
    return x / 100;
  });
}

function nullablePercentSeries(v: unknown, path: string, expectedLength: number): (Fraction | null)[] {
  return nullableNumberSeries(v, path, expectedLength).map((x, i) => {
    if (x === null) return null;
    if (x < 0 || x > 100) throw new OpenMeteoShapeError(`percentage out of range: ${x}`, `${path}[${i}]`);
    return x / 100;
  });
}

function nonNegativeSeries(v: unknown, path: string, expectedLength: number): number[] {
  return numberSeries(v, path, expectedLength).map((x, i) => {
    if (x < 0) throw new OpenMeteoShapeError(`expected a non-negative value, got ${x}`, `${path}[${i}]`);
    return x;
  });
}

/**
 * Require a strictly hourly, gap-free, ascending series of naive local timestamps.
 *
 * Open-Meteo applies a single fixed UTC offset per response, so a local day is always exactly
 * 24 labelled hours even across a DST transition (verified against 2024-03-10 and 2024-11-03 in
 * `America/New_York`). A step other than 60 minutes therefore means a real gap, not DST.
 */
export function assertHourlyContiguous(times: readonly string[], path: string): void {
  if (times.length === 0) throw new OpenMeteoShapeError('hourly series is empty', path);
  let prev = parseLocal(times[0]!);
  for (let i = 1; i < times.length; i++) {
    const t = parseLocal(times[i]!);
    const step = t - prev;
    if (step !== 60) {
      throw new OpenMeteoShapeError(
        `hourly series is not contiguous: ${times[i - 1]} -> ${times[i]} is ${step} minutes, expected 60`,
        `${path}[${i}]`,
      );
    }
    prev = t;
  }
}

function timeSeries(v: unknown, path: string): LocalDateTime[] {
  const arr = asArray(v, path).map((x, i) => asString(x, `${path}[${i}]`));
  arr.forEach((s, i) => {
    try {
      parseLocal(s);
    } catch (e) {
      throw new OpenMeteoShapeError((e as Error).message, `${path}[${i}]`);
    }
  });
  assertHourlyContiguous(arr, path);
  return arr;
}

// ---------------------------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------------------------

export interface GeocodeResult {
  /** Open-Meteo / GeoNames id. Stable enough to use as a React key or a saved favourite. */
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  /** GeoNames' elevation for the populated place, metres. Often the valley, not the ridge. */
  elevation: Metres | null;
  country: string | null;
  countryCode: string | null;
  /** State / province. */
  admin1: string | null;
  /** County / district. */
  admin2: string | null;
  /** IANA timezone of the place. */
  timezone: string | null;
  population: number | null;
  /** GeoNames feature code, e.g. `PPL` (populated place), `MT` (mountain), `AIRP`. */
  featureCode: string | null;
  /** Ready-to-display disambiguation label, e.g. `Gatlinburg, Tennessee, United States`. */
  label: string;
}

export interface GeocodeQuery {
  name: string;
  /** 1..100; the API defaults to 10. */
  count?: number;
  /** ISO 639-1, default `en`. */
  language?: string;
}

export function geocodeUrl(q: GeocodeQuery, endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS): string {
  const name = q.name.trim();
  if (name.length === 0) throw new RangeError('geocode: `name` must be a non-empty string');
  const p = new URLSearchParams({
    name,
    count: String(q.count ?? 10),
    language: q.language ?? 'en',
    format: 'json',
  });
  return `${endpoints.geocoding}?${p}`;
}

/**
 * Place name → ranked candidates.
 *
 * NOTE on the empty case: when nothing matches, the API omits the `results` key entirely rather
 * than returning `[]`. We normalise that to `[]`; a *present but non-array* `results` is still
 * an error.
 */
export async function geocode(
  q: GeocodeQuery,
  fetchJson: FetchJson,
  endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS,
): Promise<GeocodeResult[]> {
  return parseGeocode(await fetchJson(geocodeUrl(q, endpoints)));
}

export function parseGeocode(body: unknown): GeocodeResult[] {
  const root = asRecord(body, 'geocoding');
  if (!('results' in root) || root['results'] === undefined) return [];
  const results = asArray(root['results'], 'geocoding.results');
  return results.map((raw, i) => {
    const p = `geocoding.results[${i}]`;
    const r = asRecord(raw, p);
    const name = asString(r['name'], `${p}.name`);
    const admin1 = optionalString(r['admin1']);
    const country = optionalString(r['country']);
    return {
      id: asFiniteNumber(r['id'], `${p}.id`),
      name,
      latitude: asLatitude(r['latitude'], `${p}.latitude`),
      longitude: asLongitude(r['longitude'], `${p}.longitude`),
      elevation: optionalNumber(r['elevation'], `${p}.elevation`),
      country,
      countryCode: optionalString(r['country_code']),
      admin1,
      admin2: optionalString(r['admin2']),
      timezone: optionalString(r['timezone']),
      population: optionalNumber(r['population'], `${p}.population`),
      featureCode: optionalString(r['feature_code']),
      label: [name, admin1, country].filter((x): x is string => !!x).join(', '),
    };
  });
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function optionalNumber(v: unknown, path: string): number | null {
  if (v === undefined || v === null) return null;
  return asFiniteNumber(v, path);
}

function asLatitude(v: unknown, path: string): number {
  const n = asFiniteNumber(v, path);
  if (n < -90 || n > 90) throw new OpenMeteoShapeError(`latitude out of range: ${n}`, path);
  return n;
}

function asLongitude(v: unknown, path: string): number {
  const n = asFiniteNumber(v, path);
  if (n < -180 || n > 180) throw new OpenMeteoShapeError(`longitude out of range: ${n}`, path);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Elevation (90 m Copernicus DEM)
// ---------------------------------------------------------------------------------------------

export interface LatLon {
  latitude: number;
  longitude: number;
}

/**
 * The endpoint accepts comma-separated coordinate lists and returns one elevation per input,
 * in order (verified 2026-11-13). Mismatched list lengths are a hard API error, not a silent
 * truncation. 100 per request is the documented ceiling; we chunk at that.
 */
export const ELEVATION_BATCH_LIMIT = 100;

export function elevationUrl(points: readonly LatLon[], endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS): string {
  if (points.length === 0) throw new RangeError('lookupElevations: no points given');
  if (points.length > ELEVATION_BATCH_LIMIT) {
    throw new RangeError(`lookupElevations: at most ${ELEVATION_BATCH_LIMIT} points per request`);
  }
  const p = new URLSearchParams({
    latitude: points.map((x) => x.latitude).join(','),
    longitude: points.map((x) => x.longitude).join(','),
  });
  return `${endpoints.elevation}?${p}`;
}

/** Terrain height, metres, for each point, in the order given. */
export async function lookupElevations(
  points: readonly LatLon[],
  fetchJson: FetchJson,
  endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS,
): Promise<Metres[]> {
  const out: Metres[] = [];
  for (let i = 0; i < points.length; i += ELEVATION_BATCH_LIMIT) {
    const chunk = points.slice(i, i + ELEVATION_BATCH_LIMIT);
    out.push(...parseElevation(await fetchJson(elevationUrl(chunk, endpoints)), chunk.length));
  }
  return out;
}

export function parseElevation(body: unknown, expectedLength: number): Metres[] {
  const root = asRecord(body, 'elevation');
  return numberSeries(root['elevation'], 'elevation.elevation', expectedLength).map((m, i) => {
    // Deepest ocean trench ~ −11 000 m, highest land 8 849 m. Anything outside is corrupt.
    if (m < -11000 || m > 9000) throw new OpenMeteoShapeError(`implausible elevation ${m} m`, `elevation.elevation[${i}]`);
    return m;
  });
}

// ---------------------------------------------------------------------------------------------
// Shared series shape
// ---------------------------------------------------------------------------------------------

/** The hourly variables this project needs, in SI with percentages already turned into fractions. */
export interface HourlySeries {
  /** Naive local wall-clock, strictly hourly, gap-free. */
  time: LocalDateTime[];
  /** 2 m air temperature, °C. */
  temperature2m: number[];
  /** 2 m relative humidity, 0..1. */
  relativeHumidity2m: Fraction[];
  /** 10 m wind speed, m/s. */
  windSpeed10m: number[];
  /** Total cloud cover, 0..1. */
  cloudCover: Fraction[];
  /** Precipitation in the *preceding* hour, mm. */
  precipitation: number[];
  /** Probability of precipitation, 0..1. `null` for every hour in the archive (ERA5 has no PoP). */
  precipitationProbability: (Fraction | null)[];
  /** Downwelling shortwave radiation, W/m². */
  shortwaveRadiation: number[];
}

/** Sunrise and sunset for one local date, as wall-clock strings. */
export interface DailySun {
  date: LocalDate;
  sunrise: LocalDateTime;
  sunset: LocalDateTime;
  /** True at latitudes/dates with no sunrise or sunset: the API degenerates to `T00:00` for both. */
  polar: boolean;
}

export interface SeriesResponse {
  /** The grid point actually used, which is NOT exactly the requested lat/lon. */
  latitude: number;
  longitude: number;
  /** The elevation the data is valid for: our `elevation=` when we send one, else the model's DEM. */
  elevation: Metres;
  timezone: string;
  utcOffsetSeconds: number;
  hourly: HourlySeries;
  /**
   * Hours trimmed from the end of the series because the model run had not produced them yet.
   * Normally 0. A live 16-day request often ends in a short contiguous run of nulls; those hours
   * are dropped rather than throwing, and this says how many. An interior null still throws.
   */
  truncatedHours?: number;
  daily: DailySun[];
}

const FORECAST_HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'cloud_cover',
  'precipitation',
  'precipitation_probability',
  'shortwave_radiation',
] as const;

/** ERA5 has no probability-of-precipitation field, so the archive request omits it. */
const ARCHIVE_HOURLY_VARS = FORECAST_HOURLY_VARS.filter((v) => v !== 'precipitation_probability');

/**
 * How many trailing hours to drop because the model run has not reached them yet.
 *
 * A live 16-day request routinely comes back with a short, contiguous run of nulls at the very
 * end: the run in flight has not produced those hours. Measured live on 2026-11-14 at the Smokies
 * point, the last 4 of 384 hours were null in every variable except precipitation probability,
 * and the boundary drifts through the day as runs update. That is normal and must not be fatal.
 *
 * An **interior** null is a different thing entirely. It means a corrupt or partial response, and
 * it still throws. So this looks only at a contiguous tail, and only reports how much of it to
 * drop; anything earlier is left to the per-variable parsers to reject.
 */
function raggedTailLength(hourly: Record<string, unknown>, n: number): number {
  let firstMissing = n;
  for (const key of FORECAST_HOURLY_VARS) {
    // Precipitation probability is nullable by design, so it never shortens the usable window.
    if (key === 'precipitation_probability') continue;
    const arr = hourly[key];
    // Only an array of the right length can have a ragged tail. A short array is a malformed
    // response, not an unfinished model run, and must still reach the per-variable length check.
    if (!Array.isArray(arr) || arr.length !== n) continue;
    let i = n;
    while (i > 0 && arr[i - 1] === null) i -= 1;
    if (i < firstMissing) firstMissing = i;
  }
  return n - firstMissing;
}

function parseSeriesResponse(body: unknown, path: string, options: { expectPop: boolean }): SeriesResponse {
  const root = asRecord(body, path);
  const hourly = asRecord(root['hourly'], `${path}.hourly`);
  const fullTime = timeSeries(hourly['time'], `${path}.hourly.time`);
  const dropped = raggedTailLength(hourly, fullTime.length);
  if (dropped >= fullTime.length) {
    throw new OpenMeteoShapeError('every hour is null; the response carries no usable series', `${path}.hourly`);
  }
  if (dropped > 0) {
    for (const key of Object.keys(hourly)) {
      const arr = hourly[key];
      if (Array.isArray(arr)) hourly[key] = arr.slice(0, arr.length - dropped);
    }
  }
  const time = fullTime.slice(0, fullTime.length - dropped);
  const n = time.length;

  const series: HourlySeries = {
    time,
    temperature2m: numberSeries(hourly['temperature_2m'], `${path}.hourly.temperature_2m`, n).map((t, i) => {
      if (t < -95 || t > 65) throw new OpenMeteoShapeError(`implausible air temperature ${t} °C`, `${path}.hourly.temperature_2m[${i}]`);
      return t;
    }),
    relativeHumidity2m: percentSeries(hourly['relative_humidity_2m'], `${path}.hourly.relative_humidity_2m`, n),
    windSpeed10m: nonNegativeSeries(hourly['wind_speed_10m'], `${path}.hourly.wind_speed_10m`, n),
    cloudCover: percentSeries(hourly['cloud_cover'], `${path}.hourly.cloud_cover`, n),
    precipitation: nonNegativeSeries(hourly['precipitation'], `${path}.hourly.precipitation`, n),
    precipitationProbability: options.expectPop
      ? nullablePercentSeries(hourly['precipitation_probability'], `${path}.hourly.precipitation_probability`, n)
      : new Array<Fraction | null>(n).fill(null),
    shortwaveRadiation: nonNegativeSeries(hourly['shortwave_radiation'], `${path}.hourly.shortwave_radiation`, n),
  };

  assertUnits(root[`hourly_units`], `${path}.hourly_units`, options.expectPop);

  return {
    latitude: asLatitude(root['latitude'], `${path}.latitude`),
    longitude: asLongitude(root['longitude'], `${path}.longitude`),
    elevation: asFiniteNumber(root['elevation'], `${path}.elevation`),
    timezone: asString(root['timezone'], `${path}.timezone`),
    utcOffsetSeconds: asFiniteNumber(root['utc_offset_seconds'], `${path}.utc_offset_seconds`),
    hourly: series,
    /** Hours trimmed from the end because the model run had not produced them yet. */
    truncatedHours: dropped,
    daily: parseDaily(root['daily'], `${path}.daily`),
  };
}

/**
 * The unit block is the cheapest possible guard against a silent server-side default change
 * (e.g. wind reverting to km/h, or temperature to °F) that would otherwise look like weather.
 */
function assertUnits(v: unknown, path: string, expectPop: boolean): void {
  const units = asRecord(v, path);
  const expected: Record<string, string> = {
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    wind_speed_10m: 'm/s',
    cloud_cover: '%',
    precipitation: 'mm',
    shortwave_radiation: 'W/m²',
  };
  if (expectPop) expected['precipitation_probability'] = '%';
  for (const [k, want] of Object.entries(expected)) {
    const got = units[k];
    if (got !== want) {
      throw new OpenMeteoShapeError(`expected unit ${JSON.stringify(want)}, got ${JSON.stringify(got)}`, `${path}.${k}`);
    }
  }
}

function parseDaily(v: unknown, path: string): DailySun[] {
  const daily = asRecord(v, path);
  const dates = asArray(daily['time'], `${path}.time`).map((x, i) => asString(x, `${path}.time[${i}]`));
  const n = dates.length;
  const sunrise = asArray(daily['sunrise'], `${path}.sunrise`);
  const sunset = asArray(daily['sunset'], `${path}.sunset`);
  if (sunrise.length !== n || sunset.length !== n) {
    throw new OpenMeteoShapeError(`sunrise/sunset length ${sunrise.length}/${sunset.length} != ${n} dates`, path);
  }
  return dates.map((date, i) => {
    const rise = asString(sunrise[i], `${path}.sunrise[${i}]`);
    const set = asString(sunset[i], `${path}.sunset[${i}]`);
    if (dateOf(rise) !== date || dateOf(set) !== date) {
      throw new OpenMeteoShapeError(`sunrise/sunset ${rise}/${set} are not on ${date}`, `${path}[${i}]`);
    }
    return { date, sunrise: rise, sunset: set, polar: parseLocal(set) <= parseLocal(rise) };
  });
}

// ---------------------------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------------------------

/**
 * Hourly horizon of the free tier, measured on 2026-11-13: `forecast_days=16` returns exactly
 * 384 hourly values with no nulls in any of the seven variables we request. `forecast_days=17`
 * is rejected with "Forecast days is invalid. Allowed range 0 to 16."
 */
export const MAX_FORECAST_DAYS = 16;

export interface ForecastRequest {
  latitude: number;
  longitude: number;
  /**
   * REQUIRED. The real trail elevation in metres.
   *
   * Open-Meteo picks the grid cell whose model terrain is closest to this value and lapse-corrects
   * the 2 m temperature from model terrain to it. Omitting it silently gives you the weather of
   * whatever valley the model thinks is there: at our Smokies test point the model DEM is 1446 m
   * against a real 1800 m, a 2.0–3.5 °C error. See the README for the measurement.
   */
  elevation: Metres;
  /** 1..16, default 16. */
  forecastDays?: number;
  /** Include this many past days before today (the API's `past_days`), default 0. */
  pastDays?: number;
}

export function forecastUrl(req: ForecastRequest, endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS): string {
  const days = req.forecastDays ?? MAX_FORECAST_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) {
    throw new RangeError(`forecastDays must be an integer 1..${MAX_FORECAST_DAYS}, got ${days}`);
  }
  if (!Number.isFinite(req.elevation)) {
    throw new RangeError('forecast: `elevation` is required (metres) so Open-Meteo can lapse-correct');
  }
  const p = new URLSearchParams({
    latitude: String(req.latitude),
    longitude: String(req.longitude),
    elevation: String(Math.round(req.elevation)),
    hourly: FORECAST_HOURLY_VARS.join(','),
    daily: 'sunrise,sunset',
    forecast_days: String(days),
    timezone: 'auto',
    wind_speed_unit: 'ms',
  });
  if (req.pastDays) p.set('past_days', String(req.pastDays));
  return `${endpoints.forecast}?${p}`;
}

export async function fetchForecast(
  req: ForecastRequest,
  fetchJson: FetchJson,
  endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS,
): Promise<SeriesResponse> {
  return parseForecast(await fetchJson(forecastUrl(req, endpoints)));
}

export function parseForecast(body: unknown): SeriesResponse {
  return parseSeriesResponse(body, 'forecast', { expectPop: true });
}

// ---------------------------------------------------------------------------------------------
// Climatology (ERA5 archive)
// ---------------------------------------------------------------------------------------------

/**
 * Why the Historical/ERA5 archive and not the Climate (CMIP6) endpoint:
 *
 *  - `climate-api.open-meteo.com` serves **daily** variables only; a request with `hourly=` comes
 *    back with no `hourly` block at all (verified 2026-11-13). We need a per-hour-of-day shape, so
 *    it cannot do the job even in principle.
 *  - It also serves bias-corrected CMIP6 *projections*, i.e. a model's opinion about a future
 *    climate, not observed normals. For "what is 20 November usually like up there" the honest
 *    answer is the observed record.
 *  - ERA5 via `archive-api.open-meteo.com` is hourly, goes back to 1940, honours `elevation=` for
 *    the same lapse correction as the forecast, and is on the free tier.
 */
export interface ClimatologyRequest {
  latitude: number;
  longitude: number;
  /** Real trail elevation, metres. Same lapse correction as the forecast path. */
  elevation: Metres;
  /** The target calendar date, `YYYY-MM-DD`. Only its month and day are used. */
  targetDate: LocalDate;
  /** Pool this many days either side of the target calendar date. Default 3 (a 7-day window). */
  windowDays?: number;
  /** Most recent year to include. Default: the year before `targetDate`'s year. */
  endYear?: number;
  /** How many years back to pool. Default 20. */
  years?: number;
}

/** Everything observed at one hour of the day, pooled across years and window days. */
export interface HourOfDayClimatology {
  /** 0..23 local. */
  hour: number;
  /** One entry per (year × window-day) sample. */
  temperature: number[];
  windSpeed: number[];
  cloudCover: Fraction[];
  relativeHumidity: Fraction[];
  precipitation: number[];
  shortwaveRadiation: number[];
}

export interface ClimatologyResponse {
  latitude: number;
  longitude: number;
  elevation: Metres;
  timezone: string;
  /** Years actually pooled, ascending. */
  years: number[];
  /** Days either side of the target calendar date that were pooled. */
  windowDays: number;
  /** Indexed 0..23 by hour of day. */
  byHour: HourOfDayClimatology[];
  /** Median sunrise/sunset across the pooled years, on the requested target date. */
  sunrise: LocalDateTime;
  sunset: LocalDateTime;
}

export function archiveUrl(
  req: { latitude: number; longitude: number; elevation: Metres; startDate: LocalDate; endDate: LocalDate },
  endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS,
): string {
  const p = new URLSearchParams({
    latitude: String(req.latitude),
    longitude: String(req.longitude),
    elevation: String(Math.round(req.elevation)),
    start_date: req.startDate,
    end_date: req.endDate,
    hourly: ARCHIVE_HOURLY_VARS.join(','),
    daily: 'sunrise,sunset',
    timezone: 'auto',
    wind_speed_unit: 'ms',
  });
  return `${endpoints.archive}?${p}`;
}

export function parseArchive(body: unknown): SeriesResponse {
  return parseSeriesResponse(body, 'archive', { expectPop: false });
}

/** Default number of past years pooled into a climatology. 20 requests, ~8 kB each. */
export const DEFAULT_CLIMATOLOGY_YEARS = 20;
/** Default half-width of the calendar window, in days. */
export const DEFAULT_CLIMATOLOGY_WINDOW_DAYS = 3;

/**
 * Build the per-year archive URLs for a climatology.
 *
 * One request per year rather than one long 20-year range, because the long range is both
 * *more* expensive in the provider's own accounting (a 30-year single-variable request bills
 * 78.3 calls and returns 6 MB; thirty 7-day windows bill 1.0 each and return ~8 kB each) and
 * unusable in a browser.
 */
export function climatologyUrls(
  req: ClimatologyRequest,
  endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS,
): { year: number; url: string }[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.targetDate);
  if (!m) throw new RangeError(`climatology: targetDate must be YYYY-MM-DD, got ${req.targetDate}`);
  const targetYear = Number(m[1]);
  const monthDay = `${m[2]}-${m[3]}`;
  const windowDays = req.windowDays ?? DEFAULT_CLIMATOLOGY_WINDOW_DAYS;
  const nYears = req.years ?? DEFAULT_CLIMATOLOGY_YEARS;
  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 15) {
    throw new RangeError(`climatology: windowDays must be an integer 0..15, got ${windowDays}`);
  }
  if (!Number.isInteger(nYears) || nYears < 1 || nYears > 80) {
    throw new RangeError(`climatology: years must be an integer 1..80, got ${nYears}`);
  }
  const endYear = req.endYear ?? targetYear - 1;
  const out: { year: number; url: string }[] = [];
  for (let y = endYear - nYears + 1; y <= endYear; y++) {
    // 29 February falls back to 28 February in non-leap years; the ±window covers it either way.
    const anchor = monthDay === '02-29' && !isLeap(y) ? '02-28' : monthDay;
    const centre = parseLocal(`${y}-${anchor}T00:00`);
    out.push({
      year: y,
      url: archiveUrl(
        {
          latitude: req.latitude,
          longitude: req.longitude,
          elevation: req.elevation,
          startDate: toDate(centre - windowDays * 1440),
          endDate: toDate(centre + windowDays * 1440),
        },
        endpoints,
      ),
    });
  }
  return out;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function toDate(minutes: number): LocalDate {
  // Local import avoided to keep this file's dependency list to `localtime` only.
  const d = new Date(Date.UTC(1970, 0, 1) + minutes * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull the same calendar window across ~20 past years and pool it by hour of day.
 *
 * Returns the raw per-hour samples rather than pre-computed means so the sampler can pool all
 * the hours of a phase window together and take real empirical quantiles over (year × hour).
 */
export async function fetchClimatology(
  req: ClimatologyRequest,
  fetchJson: FetchJson,
  endpoints: OpenMeteoEndpoints = DEFAULT_ENDPOINTS,
): Promise<ClimatologyResponse> {
  const jobs = climatologyUrls(req, endpoints);
  const responses = await Promise.all(jobs.map(async (j) => ({ year: j.year, body: await fetchJson(j.url) })));
  return buildClimatology(
    responses.map((r) => ({ year: r.year, series: parseArchive(r.body) })),
    req.targetDate,
  );
}

/** Pure half of {@link fetchClimatology}: fold parsed archive responses into one climatology. */
export function buildClimatology(
  years: readonly { year: number; series: SeriesResponse }[],
  targetDate: LocalDate,
): ClimatologyResponse {
  if (years.length === 0) throw new RangeError('buildClimatology: no years supplied');
  const first = years[0]!.series;
  const byHour: HourOfDayClimatology[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    temperature: [],
    windSpeed: [],
    cloudCover: [],
    relativeHumidity: [],
    precipitation: [],
    shortwaveRadiation: [],
  }));

  const sunriseClock: number[] = [];
  const sunsetClock: number[] = [];
  let windowDays = 0;

  for (const { year, series } of years) {
    const h = series.hourly;
    if (h.time.length % 24 !== 0) {
      throw new OpenMeteoShapeError(
        `climatology year ${year} returned ${h.time.length} hours, not a whole number of days`,
        'archive.hourly.time',
      );
    }
    windowDays = Math.max(windowDays, (h.time.length / 24 - 1) / 2);
    for (let i = 0; i < h.time.length; i++) {
      const hour = Number(h.time[i]!.slice(11, 13));
      const slot = byHour[hour]!;
      slot.temperature.push(h.temperature2m[i]!);
      slot.windSpeed.push(h.windSpeed10m[i]!);
      slot.cloudCover.push(h.cloudCover[i]!);
      slot.relativeHumidity.push(h.relativeHumidity2m[i]!);
      slot.precipitation.push(h.precipitation[i]!);
      slot.shortwaveRadiation.push(h.shortwaveRadiation[i]!);
    }
    // Sun times drift by only a minute or two over 20 years; take the central day of each year.
    const mid = series.daily[Math.floor(series.daily.length / 2)];
    if (mid && !mid.polar) {
      sunriseClock.push(Number(mid.sunrise.slice(11, 13)) * 60 + Number(mid.sunrise.slice(14, 16)));
      sunsetClock.push(Number(mid.sunset.slice(11, 13)) * 60 + Number(mid.sunset.slice(14, 16)));
    }
  }

  for (const slot of byHour) {
    if (slot.temperature.length === 0) {
      throw new OpenMeteoShapeError(`climatology has no samples for hour ${slot.hour}`, 'archive.hourly');
    }
  }

  const medianClock = (xs: number[], fallback: number): LocalDateTime => {
    if (xs.length === 0) return `${targetDate}T${pad2(Math.floor(fallback / 60))}:${pad2(fallback % 60)}`;
    const s = [...xs].sort((a, b) => a - b);
    const v = s[Math.floor(s.length / 2)]!;
    return `${targetDate}T${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
  };

  return {
    latitude: first.latitude,
    longitude: first.longitude,
    elevation: first.elevation,
    timezone: first.timezone,
    years: years.map((y) => y.year).sort((a, b) => a - b),
    windowDays,
    byHour,
    sunrise: medianClock(sunriseClock, 7 * 60),
    sunset: medianClock(sunsetClock, 19 * 60),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
