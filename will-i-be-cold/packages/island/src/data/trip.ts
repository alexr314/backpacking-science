/**
 * The panel's weather source: the recorded Smokies fixture, parsed through the weather
 * package's real public API.
 *
 * Nothing here fetches. `packages/weather/fixtures/forecast-smokies-elevation-1800.json` is a
 * verbatim recording of an Open-Meteo response for 35.606 N, −83.467 W at `elevation=1800`,
 * and `parseForecast` → `sampleForecast` is exactly the path a live call takes, so the panel
 * renders offline and deterministically while exercising the shipping code.
 *
 * `today` is pinned rather than read from the clock: `sampleForecast` folds a lead-time
 * uncertainty into every band (`forecastUncertaintySd(daysOut)`), so a floating "today" would
 * silently widen the bands as the fixture ages.
 */

import {
  parseForecast,
  sampleForecast,
  type DayWeather,
  type LocalDate,
  type PhaseWeather,
  type SeriesResponse,
  type TripWeather,
} from '@will-i-be-cold/weather';
import { lapseCorrection, nightsBySource, tripDates, tripSubset, type LoadedTrip, type Place, type TripSpec } from '../model/trip.js';

/** The first date in the recording. Pinning it keeps `daysOut`, and so every band, fixed. */
export const FIXTURE_TODAY: LocalDate = '2026-11-13';

/** Which night the panel shows. Three days out: a real forecast band, not a nowcast sliver. */
export const PANEL_DATE: LocalDate = '2026-11-16';

export const FIXTURE_PROVENANCE =
  'Recorded Open-Meteo response for 35.606 N, 83.467 W at elevation 1800 m (Great Smoky ' +
  'Mountains), captured 2026-11-13. Replayed through the same parser and sampler a live call ' +
  'uses, so this panel is offline and deterministic.';

/**
 * The recorded point as a place. The manifest's test point is 35.60 N, 83.43 W, where the 90 m
 * DEM reads 1446 m (`fixtures/elevation-smokies-batch.json`, first entry); the recording asked
 * for 1800 m, the assumed height of the AT ridge above it. So the fixture is itself an example
 * of the override: DEM below, forecast height above, the difference visible on the trip tab.
 */
export const FIXTURE_PLACE: Place = {
  latitude: 35.6,
  longitude: -83.43,
  label: 'Great Smoky Mountains, 1 800 m',
  origin: 'fixture',
  demElevation: 1446,
  elevation: 1800,
  timezone: 'America/New_York',
};

/** Three nights from the pinned panel date: the trip the README's worked numbers pool. */
export const FIXTURE_SPEC: TripSpec = { pins: [FIXTURE_PLACE], startDate: PANEL_DATE, nights: 3 };

export const FIXTURE_LABEL = 'Great Smoky Mountains, 1 800 m';

export function tripWeatherFrom(body: unknown, modelElevation?: number): TripWeather {
  return sampleForecast({
    series: parseForecast(body),
    today: FIXTURE_TODAY,
    label: FIXTURE_LABEL,
    ...(modelElevation !== undefined ? { modelElevation } : {}),
  });
}

/**
 * The fixture as the panel's starting `LoadedTrip`: the recorded series, cut to the fixture
 * trip's nights, with the lapse correction measured from the paired recording made without
 * `elevation=` (the README §1.2 pair), so the trip tab shows the same number offline as live.
 */
export function fixtureLoadedTrip(corrected: SeriesResponse, uncorrected: SeriesResponse, spec: TripSpec = FIXTURE_SPEC): LoadedTrip {
  const lapse = lapseCorrection(corrected, uncorrected);
  const full = sampleForecast({ series: corrected, today: FIXTURE_TODAY, label: FIXTURE_LABEL, modelElevation: lapse.modelElevation });
  const weather = tripSubset(full, tripDates(spec));
  return {
    weather,
    spec,
    source: 'fixture',
    provenance: FIXTURE_PROVENANCE,
    lapse,
    nightsBySource: nightsBySource(weather.days),
    truncatedHours: corrected.truncatedHours ?? 0,
    fetchedAtUtc: null,
    climatologyYears: null,
  };
}

export function dayOf(trip: TripWeather, date: LocalDate): DayWeather {
  const day = trip.days.find((d) => d.date === date);
  if (day === undefined) {
    throw new Error(
      `No weather for ${date}. The fixture covers ${trip.days[0]?.date} … ${
        trip.days[trip.days.length - 1]?.date
      }.`,
    );
  }
  return day;
}

export function campEveningOf(trip: TripWeather, date: LocalDate): PhaseWeather {
  return dayOf(trip, date).phases.camp_evening;
}
