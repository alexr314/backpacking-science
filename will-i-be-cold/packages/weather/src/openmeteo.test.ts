import { describe, expect, it } from 'vitest';
import {
  forecastUrlMany,
  parseForecastMany,
  MAX_FORECAST_POINTS,
  archiveUrl,
  assertHourlyContiguous,
  buildClimatology,
  climatologyUrls,
  createFetchJson,
  DEFAULT_ENDPOINTS,
  elevationUrl,
  fetchClimatology,
  fetchForecast,
  forecastUrl,
  geocode,
  geocodeUrl,
  lookupElevations,
  MAX_FORECAST_DAYS,
  OpenMeteoApiError,
  OpenMeteoShapeError,
  parseArchive,
  parseElevation,
  parseForecast,
  parseGeocode,
} from './openmeteo.js';
import { allFixtureUrls, fixtureFetchJson, loadFixture, manifest, TEST_POINT } from './fixtures.js';
import { dateOf } from './localtime.js';

const fetchJson = fixtureFetchJson(allFixtureUrls());

describe('geocoding', () => {
  it('ranks candidates and builds a disambiguating label', async () => {
    const results = await geocode({ name: 'Gatlinburg', count: 5 }, fetchJson);
    expect(results.length).toBeGreaterThan(0);
    const first = results[0]!;
    expect(first.name).toBe('Gatlinburg');
    expect(first.label).toBe('Gatlinburg, Tennessee, United States');
    expect(first.latitude).toBeCloseTo(35.71, 1);
    expect(first.longitude).toBeCloseTo(-83.51, 1);
    expect(first.timezone).toBe('America/New_York');
    // GeoNames gives the *town's* elevation, which is exactly why we also need the DEM lookup.
    expect(first.elevation).toBeLessThan(500);
  });

  it('normalises the no-match response, which omits `results` entirely', () => {
    const body = loadFixture('geocoding-empty.json');
    expect(body).not.toHaveProperty('results');
    expect(parseGeocode(body)).toEqual([]);
  });

  it('rejects a results entry that is not an object', () => {
    expect(() => parseGeocode({ results: ['Gatlinburg'] })).toThrow(OpenMeteoShapeError);
  });

  it('rejects an out-of-range latitude rather than passing it on', () => {
    expect(() => parseGeocode({ results: [{ id: 1, name: 'x', latitude: 120, longitude: 0 }] })).toThrow(/latitude out of range/);
  });

  it('refuses an empty query before touching the network', () => {
    expect(() => geocodeUrl({ name: '   ' })).toThrow(/non-empty/);
  });
});

describe('elevation', () => {
  it('batches several coordinates into one request and keeps the order', async () => {
    const points = [
      { latitude: 35.6, longitude: -83.43 },
      { latitude: 35.71453, longitude: -83.51189 },
      { latitude: 36.1, longitude: -83.8 },
    ];
    const elevations = await lookupElevations(points, fetchJson);
    expect(elevations).toHaveLength(3);
    // AT ridge >> Gatlinburg >> the valley north of it.
    expect(elevations[0]!).toBeGreaterThan(1200);
    expect(elevations[0]!).toBeGreaterThan(elevations[1]!);
    expect(elevations[1]!).toBeGreaterThan(elevations[2]!);
  });

  it('builds a comma-separated URL', () => {
    expect(elevationUrl([{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }])).toContain(
      'latitude=1%2C3&longitude=2%2C4',
    );
  });

  it('rejects a short elevation array instead of returning undefined', () => {
    expect(() => parseElevation({ elevation: [1446] }, 3)).toThrow(/expected 3 values, got 1/);
  });

  it('rejects nulls in the elevation array', () => {
    expect(() => parseElevation({ elevation: [1446, null] }, 2)).toThrow(OpenMeteoShapeError);
  });

  it('rejects an implausible elevation', () => {
    expect(() => parseElevation({ elevation: [99999] }, 1)).toThrow(/implausible elevation/);
  });
});

describe('forecast', () => {
  const withElev = parseForecast(loadFixture('forecast-smokies-elevation-1800.json'));
  const withoutElev = parseForecast(loadFixture('forecast-smokies-no-elevation.json'));

  it('returns the full 16-day hourly horizon with no gaps', () => {
    expect(withElev.hourly.time).toHaveLength(MAX_FORECAST_DAYS * 24);
    expect(withElev.daily).toHaveLength(MAX_FORECAST_DAYS);
    for (const key of [
      'temperature2m',
      'relativeHumidity2m',
      'windSpeed10m',
      'cloudCover',
      'precipitation',
      'shortwaveRadiation',
    ] as const) {
      expect(withElev.hourly[key]).toHaveLength(MAX_FORECAST_DAYS * 24);
      expect(withElev.hourly[key].every((x) => Number.isFinite(x))).toBe(true);
    }
    // Probability of precipitation is present for the whole horizon, not just the first week.
    expect(withElev.hourly.precipitationProbability.every((x) => x !== null)).toBe(true);
  });

  it('refuses to build a URL past the measured horizon', () => {
    expect(() => forecastUrl({ latitude: 35.6, longitude: -83.43, elevation: 1800, forecastDays: 17 })).toThrow(
      /1\.\.16/,
    );
  });

  it('requires an explicit elevation', () => {
    // @ts-expect-error -- elevation is deliberately mandatory in the type as well as at runtime
    expect(() => forecastUrl({ latitude: 35.6, longitude: -83.43 })).toThrow(/elevation` is required/);
  });

  it('asks for SI wind and local time', () => {
    const url = forecastUrl({ latitude: 35.6, longitude: -83.43, elevation: 1800 });
    expect(url).toContain('wind_speed_unit=ms');
    expect(url).toContain('timezone=auto');
    expect(url).toContain('elevation=1800');
  });

  describe('the `elevation=` parameter (the whole reason this is usable on a ridge)', () => {
    it('is honoured: the response reports the elevation we asked for', () => {
      expect(withoutElev.elevation).toBe(1446);
      expect(withElev.elevation).toBe(1800);
    });

    it('moves the temperature down by 2-3.5 C over the 354 m of terrain error', () => {
      const deltas = withElev.hourly.temperature2m.map((t, i) => t - withoutElev.hourly.temperature2m[i]!);
      const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      expect(meanDelta).toBeLessThan(-2.0);
      expect(meanDelta).toBeGreaterThan(-3.0);
      expect(Math.max(...deltas)).toBeLessThanOrEqual(-1.9);
      expect(Math.min(...deltas)).toBeGreaterThanOrEqual(-4.0);
      // Implied lapse rate sits between the saturated and dry adiabatic rates: physical.
      const lapse = (meanDelta / (1800 - 1446)) * 1000;
      expect(lapse).toBeLessThan(-4);
      expect(lapse).toBeGreaterThan(-10);
    });

    it('also nudges Open-Meteo onto a different grid cell', () => {
      // Open-Meteo picks the cell whose model terrain is closest to the requested elevation.
      expect(withElev.longitude).not.toBe(withoutElev.longitude);
    });
  });

  describe('timezone handling', () => {
    it('returns naive local timestamps with no offset or Z when timezone=auto', () => {
      for (const t of withElev.hourly.time.slice(0, 48)) {
        expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      }
      expect(withElev.timezone).toBe('America/New_York');
      expect(withElev.utcOffsetSeconds).toBe(-18000);
    });

    it('emits exactly 24 labelled hours per local date, so a local day is never 23 or 25 hours', () => {
      const perDate = new Map<string, number>();
      for (const t of withElev.hourly.time) perDate.set(t.slice(0, 10), (perDate.get(t.slice(0, 10)) ?? 0) + 1);
      expect([...perDate.values()].every((n) => n === 24)).toBe(true);
    });

    it('puts sunrise and sunset on their own local date, in local wall clock', () => {
      for (const d of withElev.daily) {
        expect(dateOf(d.sunrise)).toBe(d.date);
        expect(dateOf(d.sunset)).toBe(d.date);
        expect(d.polar).toBe(false);
      }
    });
  });

  describe('malformed responses fail loudly', () => {
    const good = loadFixture<Record<string, any>>('forecast-smokies-short.json');
    const clone = () => JSON.parse(JSON.stringify(good)) as Record<string, any>;

    it('rejects a hole punched in the middle of a series', () => {
      const bad = clone();
      bad['hourly']['temperature_2m'][10] = null;
      expect(() => parseForecast(bad)).toThrow(/temperature_2m\[10\]/);
    });

    it('rejects a truncated series rather than silently dropping hours', () => {
      const bad = clone();
      bad['hourly']['wind_speed_10m'] = bad['hourly']['wind_speed_10m'].slice(0, 20);
      expect(() => parseForecast(bad)).toThrow(/expected 72 values, got 20/);
    });

    it('tolerates a contiguous tail of nulls, which a live 16-day request really returns', () => {
      // Measured live on 2026-11-14 at the Smokies point: the last 4 of 384 hours were null in
      // every variable except precipitation probability, because the model run in flight had not
      // reached them. Throwing there would make a real 16-day request fail outright.
      const ragged = clone();
      for (const key of ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'cloud_cover', 'precipitation', 'shortwave_radiation']) {
        const arr = ragged['hourly'][key] as (number | null)[];
        for (let i = arr.length - 4; i < arr.length; i += 1) arr[i] = null;
      }
      const parsed = parseForecast(ragged);
      expect(parsed.truncatedHours).toBe(4);
      expect(parsed.hourly.time).toHaveLength(68);
      expect(parsed.hourly.temperature2m).toHaveLength(68);
      expect(parsed.hourly.temperature2m.every((t) => Number.isFinite(t))).toBe(true);
    });

    it('still rejects an interior null, which means a corrupt response and not an unfinished run', () => {
      const bad = clone();
      (bad['hourly']['temperature_2m'] as (number | null)[])[30] = null;
      expect(() => parseForecast(bad)).toThrow(/temperature_2m\[30\]/);
    });

    it('rejects a response whose hours are entirely null', () => {
      const bad = clone();
      const n = (bad['hourly']['temperature_2m'] as unknown[]).length;
      bad['hourly']['temperature_2m'] = new Array(n).fill(null);
      expect(() => parseForecast(bad)).toThrow(/no usable series/);
    });

    it('detects a missing hour in the time axis', () => {
      const bad = clone();
      bad['hourly']['time'].splice(5, 1);
      expect(() => parseForecast(bad)).toThrow(/not contiguous/);
    });

    it('detects a duplicated hour in the time axis', () => {
      const bad = clone();
      bad['hourly']['time'][5] = bad['hourly']['time'][4];
      expect(() => parseForecast(bad)).toThrow(/not contiguous/);
    });

    it('rejects a unit change (e.g. the server reverting to km/h)', () => {
      const bad = clone();
      bad['hourly_units']['wind_speed_10m'] = 'km/h';
      expect(() => parseForecast(bad)).toThrow(/expected unit "m\/s"/);
    });

    it('rejects a humidity outside 0..100 rather than clamping it', () => {
      const bad = clone();
      bad['hourly']['relative_humidity_2m'][3] = 140;
      expect(() => parseForecast(bad)).toThrow(/percentage out of range/);
    });

    it('rejects a negative precipitation accumulation', () => {
      const bad = clone();
      bad['hourly']['precipitation'][3] = -0.4;
      expect(() => parseForecast(bad)).toThrow(/non-negative/);
    });

    it('rejects an implausible air temperature', () => {
      const bad = clone();
      bad['hourly']['temperature_2m'][3] = 400;
      expect(() => parseForecast(bad)).toThrow(/implausible air temperature/);
    });

    it('rejects sunrise/sunset landing on the wrong date', () => {
      const bad = clone();
      bad['daily']['sunrise'][1] = bad['daily']['sunrise'][0];
      expect(() => parseForecast(bad)).toThrow(/are not on/);
    });

    it('rejects a response with no hourly block at all', () => {
      expect(() => parseForecast({ latitude: 1, longitude: 2 })).toThrow(/expected an object/);
    });

    it('never produces NaN from a NaN-ish input, because JSON cannot carry one and null is rejected', () => {
      const bad = clone();
      bad['hourly']['temperature_2m'][0] = 'NaN';
      expect(() => parseForecast(bad)).toThrow(/finite number/);
    });
  });

  it('propagates the API error envelope as OpenMeteoApiError', async () => {
    const body = loadFixture<Record<string, unknown>>('error-bad-latitude.json');
    expect(body['error']).toBe(true);
    const f = createFetchJson({
      fetchImpl: (async () =>
        new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
    });
    await expect(f('https://example.invalid')).rejects.toBeInstanceOf(OpenMeteoApiError);
    await expect(f('https://example.invalid')).rejects.toThrow(/Latitude must be in range/);
  });
});

describe('forecast for several points', () => {
  const pts = [
    { latitude: 35.6, longitude: -83.43, elevation: 1800 },
    { latitude: 35.7, longitude: -83.5, elevation: 1200 },
    { latitude: 35.8, longitude: -83.6, elevation: 900 },
  ];

  it('sends one coordinate list and one elevation list, in step', () => {
    const url = new URL(forecastUrlMany({ points: pts }));
    expect(url.searchParams.get('latitude')).toBe('35.6,35.7,35.8');
    expect(url.searchParams.get('longitude')).toBe('-83.43,-83.5,-83.6');
    // the point of the exercise: each night lapse-corrected to its own height, not all to one
    expect(url.searchParams.get('elevation')).toBe('1800,1200,900');
  });

  it('keeps the other terms the single-point call sends', () => {
    const url = new URL(forecastUrlMany({ points: pts }));
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('daily')).toBe('sunrise,sunset');
  });

  it('refuses a request it cannot make', () => {
    expect(() => forecastUrlMany({ points: [] })).toThrow(/no points/);
    expect(() => forecastUrlMany({ points: pts, forecastDays: 17 })).toThrow(/1\.\.16/);
    const tooMany = Array.from({ length: MAX_FORECAST_POINTS + 1 }, () => pts[0]!);
    expect(() => forecastUrlMany({ points: tooMany })).toThrow(/exceeds/);
    // @ts-expect-error -- elevation is mandatory here too
    expect(() => forecastUrlMany({ points: [{ latitude: 1, longitude: 2 }] })).toThrow(/elevation/);
  });

  it('reads an array back, and a bare object when only one point was asked for', () => {
    const one = loadFixture('forecast-smokies-elevation-1800.json');
    expect(parseForecastMany([one, one], 2)).toHaveLength(2);
    // Open-Meteo answers a one-point request with an object, not a one-element array
    expect(parseForecastMany(one, 1)).toHaveLength(1);
  });

  it('refuses a reply that does not answer the question asked', () => {
    const one = loadFixture('forecast-smokies-elevation-1800.json');
    expect(() => parseForecastMany([one, one], 3)).toThrow(/asked for 3 points, got 2/);
  });
});

describe('assertHourlyContiguous', () => {
  it('accepts a clean run', () => {
    expect(() => assertHourlyContiguous(['2026-11-13T22:00', '2026-11-13T23:00', '2026-11-14T00:00'], 'x')).not.toThrow();
  });
  it('rejects an empty series', () => {
    expect(() => assertHourlyContiguous([], 'x')).toThrow(/empty/);
  });
  it('rejects a backwards step', () => {
    expect(() => assertHourlyContiguous(['2026-11-13T02:00', '2026-11-13T01:00'], 'x')).toThrow(/-60 minutes/);
  });
});

describe('climatology (ERA5 archive)', () => {
  const years = manifest().climatologyYears;

  it('builds one small request per year rather than one huge range', () => {
    const urls = climatologyUrls({
      latitude: TEST_POINT.latitude,
      longitude: TEST_POINT.longitude,
      elevation: TEST_POINT.assumedTrailElevationMetres,
      targetDate: '2026-11-20',
      years: 20,
      endYear: 2025,
    });
    expect(urls).toHaveLength(20);
    expect(urls[0]!.year).toBe(2006);
    expect(urls[19]!.year).toBe(2025);
    expect(urls[0]!.url).toContain('start_date=2006-11-17');
    expect(urls[0]!.url).toContain('end_date=2006-11-23');
    expect(urls[0]!.url).toContain('elevation=1800');
  });

  it('pools 20 years of ERA5 into an hour-of-day distribution', async () => {
    const climo = await fetchClimatology(
      {
        latitude: TEST_POINT.latitude,
        longitude: TEST_POINT.longitude,
        elevation: TEST_POINT.assumedTrailElevationMetres,
        targetDate: '2026-11-20',
        years: 20,
        endYear: 2025,
      },
      fetchJson,
    );
    expect(climo.years).toEqual(years);
    expect(climo.byHour).toHaveLength(24);
    // 20 years x 7 days in the window.
    expect(climo.byHour[0]!.temperature).toHaveLength(140);
    expect(climo.elevation).toBe(1800);
    expect(climo.timezone).toBe('America/New_York');
    expect(climo.sunrise).toMatch(/^2026-11-20T0[67]:\d{2}$/);
    expect(climo.sunset).toMatch(/^2026-11-20T17:\d{2}$/);
    expect(climo.windowDays).toBe(3);
  });

  it('shows a real diurnal cycle and a wide interannual spread', async () => {
    const climo = await fetchClimatology(
      {
        latitude: TEST_POINT.latitude,
        longitude: TEST_POINT.longitude,
        elevation: TEST_POINT.assumedTrailElevationMetres,
        targetDate: '2026-11-20',
        years: 20,
        endYear: 2025,
      },
      fetchJson,
    );
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const dawn = avg(climo.byHour[6]!.temperature);
    const afternoon = avg(climo.byHour[15]!.temperature);
    expect(afternoon).toBeGreaterThan(dawn);
    // Interannual spread on a given calendar date is large: that is the point of the wide band.
    const sdOf = (xs: number[]) => {
      const m = avg(xs);
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    expect(sdOf(climo.byHour[6]!.temperature)).toBeGreaterThan(3);
  });

  it('reports no probability-of-precipitation, because ERA5 has none', () => {
    const one = parseArchive(loadFixture('archive/archive-smokies-2020.json'));
    expect(one.hourly.precipitationProbability.every((p) => p === null)).toBe(true);
    expect(one.hourly.precipitation.every((p) => Number.isFinite(p))).toBe(true);
  });

  it('rejects a year that came back with a partial day', () => {
    const one = parseArchive(loadFixture('archive/archive-smokies-2020.json'));
    const truncated = { ...one, hourly: { ...one.hourly, time: one.hourly.time.slice(0, 100) } };
    expect(() => buildClimatology([{ year: 2020, series: truncated }], '2026-11-20')).toThrow(/whole number of days/);
  });

  it('maps 29 February onto 28 February in non-leap years', () => {
    const urls = climatologyUrls({
      latitude: 0,
      longitude: 0,
      elevation: 0,
      targetDate: '2028-02-29',
      years: 2,
      endYear: 2024,
      windowDays: 1,
    });
    expect(urls[0]!.url).toContain('start_date=2023-02-27'); // 2023 is not a leap year -> 28 Feb +/- 1
    expect(urls[1]!.url).toContain('start_date=2024-02-28'); // 2024 is -> 29 Feb +/- 1
  });

  it('builds the archive URL with SI wind and local time', () => {
    const url = archiveUrl({ latitude: 1, longitude: 2, elevation: 100, startDate: '2020-01-01', endDate: '2020-01-02' });
    expect(url.startsWith(DEFAULT_ENDPOINTS.archive)).toBe(true);
    expect(url).toContain('wind_speed_unit=ms');
    expect(url).toContain('timezone=auto');
  });
});

// ------------------------------------------------------------------------------------------
// Optional live test. Off by default so CI never depends on a third-party API; run with
//   WIBC_LIVE=1 npm test
// to find out deliberately whether Open-Meteo has changed shape under us.
// ------------------------------------------------------------------------------------------
const live = process.env['WIBC_LIVE'] === '1' ? describe : describe.skip;

live('live API (WIBC_LIVE=1)', () => {
  const realFetch = createFetchJson();

  it('forecast still matches the recorded shape', { timeout: 30_000 }, async () => {
    const res = await fetchForecast(
      {
        latitude: TEST_POINT.latitude,
        longitude: TEST_POINT.longitude,
        elevation: TEST_POINT.assumedTrailElevationMetres,
      },
      realFetch,
    );
    const recorded = parseForecast(loadFixture('forecast-smokies-elevation-1800.json'));
    expect(res.hourly.time).toHaveLength(recorded.hourly.time.length);
    expect(res.elevation).toBe(recorded.elevation);
    expect(res.timezone).toBe(recorded.timezone);
    expect(Object.keys(res.hourly).sort()).toEqual(Object.keys(recorded.hourly).sort());
    expect(res.daily).toHaveLength(recorded.daily.length);
  });

  it('geocoding still matches the recorded shape', { timeout: 30_000 }, async () => {
    const res = await geocode({ name: 'Gatlinburg', count: 5 }, realFetch);
    expect(res[0]!.label).toBe('Gatlinburg, Tennessee, United States');
  });

  it('elevation batching still works', { timeout: 30_000 }, async () => {
    const res = await lookupElevations(
      [
        { latitude: 35.6, longitude: -83.43 },
        { latitude: 36.1, longitude: -83.8 },
      ],
      realFetch,
    );
    expect(res).toHaveLength(2);
    expect(res[0]!).toBeGreaterThan(res[1]!);
  });

  it('the archive still serves the climatology window', { timeout: 60_000 }, async () => {
    const res = await fetchClimatology(
      {
        latitude: TEST_POINT.latitude,
        longitude: TEST_POINT.longitude,
        elevation: TEST_POINT.assumedTrailElevationMetres,
        targetDate: '2026-11-20',
        years: 3,
        endYear: 2025,
      },
      realFetch,
    );
    expect(res.byHour).toHaveLength(24);
    expect(res.byHour[0]!.temperature).toHaveLength(21);
  });
});
