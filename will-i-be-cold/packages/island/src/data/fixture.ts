/**
 * The one Vite-specific line in the data path: the recorded fixtures, imported as raw text so
 * TypeScript never has to infer a 39 kB literal type for them.
 *
 * Two recordings: the one the panel runs on (`elevation=1800`) and its pair made without
 * `elevation=`, kept so the lapse correction can be shown as a measured number offline exactly
 * as it is live. Mounting this as an Astro island keeps working as-is (Astro is Vite). A
 * different bundler only has to supply these two some other way; everything downstream takes
 * `unknown`.
 */
import raw from '../../../weather/fixtures/forecast-smokies-elevation-1800.json?raw';
import rawUncorrected from '../../../weather/fixtures/forecast-smokies-no-elevation.json?raw';
import { parseForecast, type TripWeather } from '@will-i-be-cold/weather';
import { fixtureLoadedTrip, tripWeatherFrom } from './trip.js';
import type { LoadedTrip, TripSpec } from '../model/trip.js';

let cached: TripWeather | undefined;

/** The whole 15-night recording, every date it covers. */
export function tripWeather(): TripWeather {
  cached ??= tripWeatherFrom(JSON.parse(raw) as unknown);
  return cached;
}

/** The recording as the panel's offline starting state, cut to `spec` (default: the fixture trip). */
export function fixtureTrip(spec?: TripSpec): LoadedTrip {
  return fixtureLoadedTrip(parseForecast(JSON.parse(raw) as unknown), parseForecast(JSON.parse(rawUncorrected) as unknown), spec);
}
