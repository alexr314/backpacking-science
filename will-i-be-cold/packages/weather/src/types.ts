/**
 * Public contract for `@will-i-be-cold/weather`.
 *
 * Everything here is SI: degrees Celsius, metres per second, metres, millimetres,
 * watts per square metre. Fractions (cloud cover, humidity, probability) are 0..1,
 * never percent: the APIs return percent and the parsers convert once, at the edge.
 *
 * The physics engine consumes `TripWeather` and must never need to know whether the
 * numbers came from a forecast, from a 20-year reanalysis climatology, or from a
 * high/low the user typed in. `PhaseWeather.source` is for labelling the UI, not for
 * branching the physics.
 */

/** Degrees Celsius. */
export type Celsius = number;
/** Metres per second (10 m wind, as the models report it). */
export type MetresPerSecond = number;
/** Metres above mean sea level. */
export type Metres = number;
/** Millimetres of liquid-water-equivalent precipitation. */
export type Millimetres = number;
/** Watts per square metre. */
export type WattsPerSquareMetre = number;
/** A dimensionless 0..1 fraction. */
export type Fraction = number;

/**
 * A local *naive* timestamp, `YYYY-MM-DDTHH:mm`, with no offset and no `Z`.
 *
 * This is deliberate and matches what Open-Meteo returns with `timezone=auto`: wall-clock
 * time at the forecast point. Phase windows ("sunset to 21:00") are wall-clock concepts,
 * so the whole package works in naive local time and never constructs a `Date` from these
 * strings (which would silently reinterpret them in the *browser's* zone). The IANA zone
 * is carried separately on `TripWeather.location.timezone` for display.
 */
export type LocalDateTime = string;

/** A local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

/** The five phases of a backpacking day, in chronological order within a date. */
export type PhaseName =
  /** Waking in camp through to setting off: sunrise−1h → start of hiking. Usually the coldest standing-still phase. */
  | 'camp_morning'
  /** On the move with a pack. */
  | 'hiking'
  /** Rest and lunch stops taken inside the hiking window: same air, far less metabolic heat. */
  | 'day_break'
  /** Arriving in camp through to bedtime. */
  | 'camp_evening'
  /** Bedtime → wake. Crosses midnight; see `DayWeather.date` for which night it is. */
  | 'sleep';

export const PHASE_NAMES = [
  'camp_morning',
  'hiking',
  'day_break',
  'camp_evening',
  'sleep',
] as const satisfies readonly PhaseName[];

/**
 * Where the numbers came from. The three sources produce the *same* shape on purpose.
 *
 * - `forecast`   : hourly NWP within the 16-day horizon, lapse-corrected to the trail elevation.
 * - `climatology`: ERA5 reanalysis over the same calendar window across ~20 past years.
 *                   An honest statement about what that date is usually like. NOT a forecast.
 * - `manual`     : synthesised from a user-entered daily high and low.
 */
export type WeatherSource = 'forecast' | 'climatology' | 'manual';

/**
 * A summary of one scalar over the hours of a phase window.
 *
 * `p10`/`p50`/`p90` are what the UI draws as the band and what the coverage check uses.
 * For temperature they already include forecast uncertainty (see `Distribution` on
 * `PhaseWeather.temperature` and `PhaseWeather.uncertaintySd`); `sd` is the *combined*
 * standard deviation, not the within-window one.
 */
export interface Distribution {
  /** 10th percentile. */
  p10: number;
  /** Median. */
  p50: number;
  /** 90th percentile. */
  p90: number;
  /** Plausible low end (within-window minimum, widened by uncertainty). */
  min: number;
  /** Plausible high end (within-window maximum, widened by uncertainty). */
  max: number;
  /** Arithmetic mean over the hours in the window. Unaffected by the uncertainty widening. */
  mean: number;
  /** Combined standard deviation: within-window spread and forecast uncertainty in quadrature. */
  sd: number;
}

/** Everything the heat-balance model needs for one phase of one day. */
export interface PhaseWeather {
  phase: PhaseName;
  /** Inclusive start of the window, local wall-clock. */
  startLocal: LocalDateTime;
  /** Exclusive end of the window, local wall-clock. May be on the next date for `sleep`. */
  endLocal: LocalDateTime;
  /** How many hourly samples fell inside the window (see the midpoint rule in the README). */
  sampleHours: number;
  /** For climatology, how many past years were pooled; otherwise 1. */
  sampleYears: number;

  /** 2 m air temperature, °C. */
  temperature: Distribution;
  /**
   * The hourly values `temperature` was summarised from: one entry per hour of the window, in
   * window order, each holding every realisation of that hour, °C.
   *
   * Forecast and manual have exactly one realisation per hour. Climatology has one per pooled
   * (year, window-day) occasion, in the same order at every hour, so index `k` is the *same
   * historical occasion* at every hour of the window. That alignment is what lets
   * `encounter.ts` draw one occasion per night instead of inventing hour-to-hour independence.
   *
   * Carried so a phase can be re-aggregated across nights without re-fetching anything.
   */
  temperatureByHourC?: readonly (readonly Celsius[])[];
  /** 10 m wind speed, m/s. Not widened for forecast uncertainty: see `windUncertaintyModelled`. */
  windSpeed: Distribution;
  /** Mean total cloud cover, 0..1. Drives the clear-sky radiant-loss term. */
  cloudCover: Fraction;
  /** Mean relative humidity, 0..1. Drives the respiratory evaporative term. */
  relativeHumidity: Fraction;
  /** Expected liquid-equivalent precipitation summed over the window, mm. */
  precipitationTotal: Millimetres;
  /**
   * Mean probability that any given hour inside the window has measurable precipitation, 0..1.
   *
   * Deliberately an hourly rate, not a "chance of rain today": the two sources can both compute
   * it honestly without assuming hour-to-hour independence. `forecast` averages the model's own
   * hourly PoP; `climatology` uses the share of pooled historical hours with >= 0.1 mm; `manual`
   * has nothing to say and reports `null`.
   */
  precipitationProbability: Fraction | null;
  /** Mean downwelling shortwave radiation, W/m². `null` in `manual` mode. */
  shortwaveRadiation: WattsPerSquareMetre | null;

  /**
   * 1 standard deviation of temperature uncertainty folded into `temperature`, °C.
   * Forecast: the lead-time error model. Climatology: 0 (the interannual spread is already
   * in the sample). Manual: the user's stated confidence.
   */
  uncertaintySd: Celsius;
  /** False everywhere today: we model temperature uncertainty but not wind uncertainty. */
  windUncertaintyModelled: boolean;
  source: WeatherSource;
}

/** One calendar day, partitioned into the five phases. */
export interface DayWeather {
  /** The date the *day* belongs to. `sleep` starts on this date and ends on the next. */
  date: LocalDate;
  /** Local wall-clock sunrise for `date`. Synthesised in `manual` mode. */
  sunrise: LocalDateTime;
  /** Local wall-clock sunset for `date`. */
  sunset: LocalDateTime;
  /** Whole days from "today" to `date`; 0 is today. Negative for past dates. */
  daysOut: number;
  source: WeatherSource;
  /** Keyed by phase; every `PhaseName` is always present. */
  phases: Record<PhaseName, PhaseWeather>;
}

/** Where on earth, and at what height, the trip happens. */
export interface TripLocation {
  latitude: number;
  longitude: number;
  /**
   * The elevation the weather was computed FOR, in metres. This is the elevation passed to
   * Open-Meteo as `elevation=`, i.e. the real trail height, not the model's terrain height.
   */
  elevation: Metres;
  /** The model terrain height Open-Meteo would have used without `elevation=`, if known. */
  modelElevation?: Metres;
  /** IANA zone, e.g. `America/New_York`. All `LocalDateTime` values are wall-clock in this zone. */
  timezone: string;
  /** Human label for the UI, e.g. `Gatlinburg, Tennessee, United States`. */
  label?: string;
}

/** The whole contract: a trip's worth of per-phase weather. */
export interface TripWeather {
  location: TripLocation;
  /** When this object was built, ISO 8601 UTC. */
  generatedAtUtc: string;
  /**
   * Attribution string that MUST be rendered somewhere visible on any public page using
   * this data. Open-Meteo's underlying data is CC BY 4.0 and attribution is a licence term.
   */
  attribution: string;
  /** Mixed sources across days are allowed (a 20-day trip starting tomorrow), but never within a day. */
  days: DayWeather[];
}

/**
 * The attribution Open-Meteo's licence requires.
 *
 * Verbatim from https://open-meteo.com/en/licence (checked 2026-11-13): API data are offered
 * under CC BY 4.0, and "You must include a link next to any location Open-Meteo data are
 * displayed, for example: <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>".
 *
 * So this is a licence term, not a courtesy, and the *link* is part of it: rendering the plain
 * string without the anchor does not satisfy it. Use `OPEN_METEO_ATTRIBUTION_HTML` in the UI.
 */
export const OPEN_METEO_ATTRIBUTION = 'Weather data by Open-Meteo.com';

/** The attribution as the licence spells it: text wrapped in a link to open-meteo.com. */
export const OPEN_METEO_ATTRIBUTION_HTML =
  '<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>';

/** Where to link for the licence itself, which CC BY 4.0 also requires us to point at. */
export const OPEN_METEO_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
