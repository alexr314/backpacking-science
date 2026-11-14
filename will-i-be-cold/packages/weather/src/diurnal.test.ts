import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANUAL_CURVE,
  DEFAULT_PHASE_WINDOWS,
  DEFAULT_UNCERTAINTY,
  forecastUncertaintySd,
  hoursInWindow,
  MissingHoursError,
  manualDiurnalTemperature,
  phaseWindows,
  sampleClimatology,
  sampleForecast,
  sampleManual,
} from './diurnal.js';
import { fetchClimatology, parseForecast, type SeriesResponse } from './openmeteo.js';
import { allFixtureUrls, fixtureFetchJson, loadFixture, TEST_POINT } from './fixtures.js';
import { atClock, formatLocal, parseLocal, parseLocalDate } from './localtime.js';
import { PHASE_NAMES, type PhaseName } from './types.js';

const fetchJson = fixtureFetchJson(allFixtureUrls());
const forecast = parseForecast(loadFixture('forecast-smokies-elevation-1800.json'));

// ---------------------------------------------------------------------------------------------
// Phase windows
// ---------------------------------------------------------------------------------------------

describe('phaseWindows', () => {
  const day = { date: '2026-11-13', sunrise: '2026-11-13T07:07', sunset: '2026-11-13T17:28' };

  it('lands within ten minutes of the fixed clock windows in the spec', () => {
    const w = phaseWindows(day);
    expect(formatLocal(w.camp_morning.start)).toBe('2026-11-13T06:07'); // spec: 06:00
    expect(formatLocal(w.hiking.start)).toBe('2026-11-13T08:37'); // spec: 08:30
    expect(formatLocal(w.hiking.end)).toBe('2026-11-13T16:28'); // spec: 16:30
    expect(formatLocal(w.camp_evening.end)).toBe('2026-11-13T21:00'); // spec: 21:00
  });

  it('partitions the 24 hours with no gaps and no overlaps', () => {
    const w = phaseWindows(day);
    expect(w.camp_morning.end).toBe(w.hiking.start);
    expect(w.hiking.end).toBe(w.camp_evening.start);
    expect(w.camp_evening.end).toBe(w.sleep.start);
    expect(w.sleep.end - 1440).toBe(w.camp_morning.start);
  });

  it('assigns every hourly sample of the day to exactly one phase', () => {
    const w = phaseWindows(day);
    const partition: PhaseName[] = ['sleep', 'camp_morning', 'hiking', 'camp_evening'];
    const hours = partition.flatMap((p) => hoursInWindow(w[p]));
    expect(hours).toHaveLength(24);
    expect(new Set(hours).size).toBe(24);
  });

  it('puts the break strictly inside the hiking window', () => {
    const w = phaseWindows(day);
    expect(w.day_break.start).toBeGreaterThan(w.hiking.start);
    expect(w.day_break.end).toBeLessThan(w.hiking.end);
  });

  it('moves with the season: a June day starts earlier and ends later', () => {
    const june = phaseWindows({ date: '2026-06-21', sunrise: '2026-06-21T06:12', sunset: '2026-06-21T20:52' });
    const nov = phaseWindows(day);
    expect(june.camp_morning.start - parseLocalDate('2026-06-21')).toBeLessThan(
      nov.camp_morning.start - parseLocalDate('2026-11-13'),
    );
    expect(june.hiking.end - parseLocalDate('2026-06-21')).toBeGreaterThan(nov.hiking.end - parseLocalDate('2026-11-13'));
  });

  it('clamps rather than producing a 20-hour hiking day in the Arctic summer', () => {
    const w = phaseWindows({ date: '2026-06-21', sunrise: '2026-06-21T01:30', sunset: '2026-06-21T23:30' });
    expect(w.hiking.start).toBeGreaterThanOrEqual(atClock(parseLocalDate('2026-06-21'), '07:00'));
    expect(w.hiking.end).toBeLessThanOrEqual(atClock(parseLocalDate('2026-06-21'), '18:00'));
  });

  it('falls back to fixed clock windows on a polar day', () => {
    const w = phaseWindows({ date: '2026-12-21', sunrise: '2026-12-21T00:00', sunset: '2026-12-21T00:00' });
    expect(formatLocal(w.hiking.start)).toBe('2026-12-21T08:30');
    expect(formatLocal(w.hiking.end)).toBe('2026-12-21T16:30');
  });

  it('is fully overridable', () => {
    const w = phaseWindows(day, { ...DEFAULT_PHASE_WINDOWS, bedtime: '22:30' });
    expect(formatLocal(w.sleep.start)).toBe('2026-11-13T22:30');
  });
});

describe('hoursInWindow (the midpoint rule)', () => {
  const base = parseLocalDate('2026-11-13');
  it('keeps an hour whose midpoint is inside and drops one whose midpoint is outside', () => {
    // 08:37 -> 16:28: hour 08 (midpoint 08:30) is out, hour 09 is in, hour 16 (16:30) is out.
    const hours = hoursInWindow({ start: base + 8 * 60 + 37, end: base + 16 * 60 + 28 }).map(formatLocal);
    expect(hours[0]).toBe('2026-11-13T09:00');
    expect(hours[hours.length - 1]).toBe('2026-11-13T15:00');
    expect(hours).toHaveLength(7);
  });

  it('walks a window that crosses midnight', () => {
    const hours = hoursInWindow({ start: base + 21 * 60, end: base + 1440 + 6 * 60 + 7 }).map(formatLocal);
    expect(hours).toHaveLength(9);
    expect(hours[0]).toBe('2026-11-13T21:00');
    expect(hours[2]).toBe('2026-11-13T23:00');
    expect(hours[3]).toBe('2026-11-14T00:00');
    expect(hours[hours.length - 1]).toBe('2026-11-14T05:00');
  });
});

// ---------------------------------------------------------------------------------------------
// Uncertainty model
// ---------------------------------------------------------------------------------------------

describe('forecastUncertaintySd', () => {
  it('grows monotonically with lead time', () => {
    const sds = Array.from({ length: 17 }, (_, d) => forecastUncertaintySd(d));
    for (let i = 1; i < sds.length; i++) expect(sds[i]!).toBeGreaterThanOrEqual(sds[i - 1]!);
  });

  it('reproduces the measured day-1 and day-7 RMSE, inflated', () => {
    expect(forecastUncertaintySd(1)).toBeCloseTo(1.06 * 1.2, 6);
    expect(forecastUncertaintySd(7)).toBeCloseTo(2.83 * 1.2, 6);
  });

  it('lands in the published 3-4 C range at day 10 and stays finite at day 16', () => {
    expect(forecastUncertaintySd(10)).toBeGreaterThan(3);
    expect(forecastUncertaintySd(10)).toBeLessThan(4.5);
    expect(forecastUncertaintySd(16)).toBeLessThan(5);
  });

  it('never exceeds the interannual climatological spread it is bounded by (~4.9 C here)', () => {
    // A forecast can never be worse than guessing the climate mean, so the asymptote must sit
    // under the measured mid-November interannual sd of the 20 ERA5 fixture years.
    expect(forecastUncertaintySd(60)).toBeLessThan(4.9);
    expect(forecastUncertaintySd(16)).toBeLessThan(forecastUncertaintySd(60));
  });

  it('interpolates between measured lead days', () => {
    const half = forecastUncertaintySd(1.5);
    expect(half).toBeGreaterThan(forecastUncertaintySd(1));
    expect(half).toBeLessThan(forecastUncertaintySd(2));
  });

  it('is overridable in one place', () => {
    const cfg = { ...DEFAULT_UNCERTAINTY, verificationInflation: 1 };
    expect(forecastUncertaintySd(1, cfg)).toBeCloseTo(1.06, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// Synthetic-series sampler
// ---------------------------------------------------------------------------------------------

/** A deterministic 3-day series: temperature = the hour of day, everything else constant. */
function syntheticSeries(days = 3): SeriesResponse {
  const time: string[] = [];
  const temp: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`2026-11-${String(13 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
      temp.push(h);
    }
  }
  const n = time.length;
  return {
    latitude: 35.6,
    longitude: -83.43,
    elevation: 1800,
    timezone: 'America/New_York',
    utcOffsetSeconds: -18000,
    hourly: {
      time,
      temperature2m: temp,
      relativeHumidity2m: new Array(n).fill(0.8),
      windSpeed10m: temp.map((h) => h / 10),
      cloudCover: new Array(n).fill(0.25),
      precipitation: new Array(n).fill(0.5),
      precipitationProbability: new Array(n).fill(0.4),
      shortwaveRadiation: new Array(n).fill(100),
    },
    daily: Array.from({ length: days }, (_, d) => ({
      date: `2026-11-${String(13 + d).padStart(2, '0')}`,
      sunrise: `2026-11-${String(13 + d).padStart(2, '0')}T07:07`,
      sunset: `2026-11-${String(13 + d).padStart(2, '0')}T17:28`,
      polar: false,
    })),
  };
}

describe('sampleForecast on a known synthetic series', () => {
  const trip = sampleForecast({
    series: syntheticSeries(),
    today: '2026-11-13',
    uncertainty: { ...DEFAULT_UNCERTAINTY, leadDaySdC: [0], verificationInflation: 1 },
  });

  it('drops the final day, whose night runs off the end of the series', () => {
    expect(trip.days.map((d) => d.date)).toEqual(['2026-11-13', '2026-11-14']);
  });

  it('produces exactly the hours the midpoint rule predicts', () => {
    const p = trip.days[0]!.phases;
    expect(p.camp_morning.sampleHours).toBe(3); // 06,07,08
    expect(p.hiking.sampleHours).toBe(7); // 09..15
    expect(p.camp_evening.sampleHours).toBe(5); // 16..20
    expect(p.sleep.sampleHours).toBe(9); // 21,22,23,00..05
  });

  it('computes exact quantiles over those hours (temperature == hour of day)', () => {
    const hiking = trip.days[0]!.phases.hiking.temperature; // hours 9..15
    expect(hiking.min).toBe(9);
    expect(hiking.max).toBe(15);
    expect(hiking.p50).toBe(12);
    expect(hiking.mean).toBe(12);
    expect(hiking.p10).toBeCloseTo(9 + 0.1 * 6, 10);
    expect(hiking.p90).toBeCloseTo(9 + 0.9 * 6, 10);
  });

  it('handles the sleep window crossing midnight, pulling hours from the next date', () => {
    const sleep = trip.days[0]!.phases.sleep.temperature; // 21,22,23,0,1,2,3,4,5
    expect(sleep.min).toBe(0);
    expect(sleep.max).toBe(23);
    expect(sleep.mean).toBeCloseTo((21 + 22 + 23 + 0 + 1 + 2 + 3 + 4 + 5) / 9, 10);
    expect(trip.days[0]!.phases.sleep.startLocal).toBe('2026-11-13T21:00');
    expect(trip.days[0]!.phases.sleep.endLocal).toBe('2026-11-14T06:07');
  });

  it('keeps day_break inside the hiking range', () => {
    const { hiking, day_break } = trip.days[0]!.phases;
    expect(day_break.temperature.min).toBeGreaterThanOrEqual(hiking.temperature.min);
    expect(day_break.temperature.max).toBeLessThanOrEqual(hiking.temperature.max);
    expect(day_break.sampleHours).toBeLessThan(hiking.sampleHours);
  });

  it('sums precipitation over the window and averages the probability', () => {
    const hiking = trip.days[0]!.phases.hiking;
    expect(hiking.precipitationTotal).toBeCloseTo(7 * 0.5, 10);
    expect(hiking.precipitationProbability).toBeCloseTo(0.4, 10);
  });

  it('averages cloud and humidity as fractions, not percentages', () => {
    const p = trip.days[0]!.phases.hiking;
    expect(p.cloudCover).toBeCloseTo(0.25, 10);
    expect(p.relativeHumidity).toBeCloseTo(0.8, 10);
  });

  it('emits all five phases for every day, tagged as forecast', () => {
    for (const day of trip.days) {
      expect(Object.keys(day.phases).sort()).toEqual([...PHASE_NAMES].sort());
      for (const p of PHASE_NAMES) {
        expect(day.phases[p].source).toBe('forecast');
        expect(day.phases[p].phase).toBe(p);
      }
    }
  });

  it('widens the band with lead time and leaves the median alone', () => {
    const wide = sampleForecast({ series: syntheticSeries(), today: '2026-11-13' });
    const d0 = wide.days[0]!.phases.hiking.temperature;
    const d1 = wide.days[1]!.phases.hiking.temperature;
    expect(d1.p90 - d1.p10).toBeGreaterThan(d0.p90 - d0.p10);
    expect(d1.p50).toBe(d0.p50);
    expect(wide.days[1]!.phases.hiking.uncertaintySd).toBeCloseTo(forecastUncertaintySd(1), 10);
  });

  it('refuses to silently serve climatology dates from the forecast path', () => {
    expect(() =>
      sampleForecast({ series: syntheticSeries(), dates: ['2026-11-13'], today: '2026-10-01' }),
    ).toThrow(/never mixed/);
  });

  it('throws MissingHoursError rather than sampling a partial night when dates are explicit', () => {
    expect(() => sampleForecast({ series: syntheticSeries(), dates: ['2026-11-15'], today: '2026-11-13' })).toThrow(
      MissingHoursError,
    );
  });
});

describe('sampleForecast on the recorded Smokies forecast', () => {
  const trip = sampleForecast({ series: forecast, label: 'AT ridge, Great Smoky Mountains' });

  it('covers 15 of the 16 forecast days (the last night is incomplete)', () => {
    expect(trip.days).toHaveLength(15);
  });

  it('carries the location, the elevation it was computed for, and the attribution', () => {
    expect(trip.location.elevation).toBe(1800);
    expect(trip.location.timezone).toBe('America/New_York');
    expect(trip.location.label).toBe('AT ridge, Great Smoky Mountains');
    expect(trip.attribution).toMatch(/Open-Meteo/);
  });

  it('shows the physical ordering of the phases averaged over the trip', () => {
    // Not asserted per-day on purpose: 13 November 2026 at this point is a cold-advection day
    // whose temperature falls monotonically from midnight, so the morning really is the warm
    // end of it. Over 15 days the diurnal cycle wins.
    const avg = (p: PhaseName) =>
      trip.days.reduce((a, d) => a + d.phases[p].temperature.mean, 0) / trip.days.length;
    expect(avg('camp_morning')).toBeLessThan(avg('day_break'));
    expect(avg('sleep')).toBeLessThan(avg('day_break'));
    expect(avg('camp_evening')).toBeLessThan(avg('hiking'));
  });

  it('has the morning as the coldest phase on most days', () => {
    const coldestIsMorningOrSleep = trip.days.filter((d) => {
      const order = PHASE_NAMES.map((p) => [p, d.phases[p].temperature.mean] as const).sort((a, b) => a[1] - b[1]);
      return order[0]![0] === 'camp_morning' || order[0]![0] === 'sleep';
    }).length;
    expect(coldestIsMorningOrSleep / trip.days.length).toBeGreaterThan(0.75);
  });

  it('never emits a NaN anywhere in the whole trip', () => {
    const bad: string[] = [];
    for (const day of trip.days) {
      for (const p of PHASE_NAMES) {
        const w = day.phases[p];
        for (const [k, v] of Object.entries(w)) {
          if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${day.date}.${p}.${k}`);
          if (v && typeof v === 'object') {
            for (const [k2, v2] of Object.entries(v)) {
              if (typeof v2 === 'number' && !Number.isFinite(v2)) bad.push(`${day.date}.${p}.${k}.${k2}`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps every band internally consistent: min <= p10 <= p50 <= p90 <= max', () => {
    for (const day of trip.days) {
      for (const p of PHASE_NAMES) {
        const d = day.phases[p].temperature;
        expect(d.min).toBeLessThanOrEqual(d.p10);
        expect(d.p10).toBeLessThanOrEqual(d.p50);
        expect(d.p50).toBeLessThanOrEqual(d.p90);
        expect(d.p90).toBeLessThanOrEqual(d.max);
        expect(day.phases[p].cloudCover).toBeGreaterThanOrEqual(0);
        expect(day.phases[p].cloudCover).toBeLessThanOrEqual(1);
        expect(day.phases[p].relativeHumidity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('widens day 14 well beyond day 0', () => {
    const first = trip.days[0]!.phases.sleep.temperature;
    const last = trip.days[14]!.phases.sleep.temperature;
    expect(last.p90 - last.p10).toBeGreaterThan(first.p90 - first.p10 + 3);
  });
});

// ---------------------------------------------------------------------------------------------
// Climatology sampler
// ---------------------------------------------------------------------------------------------

describe('sampleClimatology', () => {
  it('produces the identical shape, tagged as climatology, with honest wide bands', async () => {
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
    const trip = sampleClimatology({ climatology: climo, dates: ['2027-11-20'], today: '2026-11-13' });
    const day = trip.days[0]!;

    expect(day.source).toBe('climatology');
    expect(Object.keys(day.phases).sort()).toEqual([...PHASE_NAMES].sort());
    for (const p of PHASE_NAMES) {
      expect(day.phases[p].source).toBe('climatology');
      expect(day.phases[p].sampleYears).toBe(20);
      // 20 years x 7 window days = 140 samples per hour of day.
      expect(day.phases[p].temperature.sd).toBeGreaterThan(3);
      expect(day.phases[p].shortwaveRadiation).not.toBeNull();
    }
    // The uncertainty is the interannual spread itself, not an added error model.
    expect(day.phases.sleep.uncertaintySd).toBe(0);
    expect(day.phases.sleep.temperature.p90 - day.phases.sleep.temperature.p10).toBeGreaterThan(8);
  });

  it('reports the historical wet-hour share as the precipitation probability', async () => {
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
    const trip = sampleClimatology({ climatology: climo, dates: ['2027-11-20'], today: '2026-11-13' });
    const p = trip.days[0]!.phases.hiking.precipitationProbability!;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------------------------
// Manual path
// ---------------------------------------------------------------------------------------------

describe('manualDiurnalTemperature', () => {
  const sunrise = parseLocal('2026-11-13T07:00');
  const args = { lowC: -2, highC: 10, sunrise };

  it('hits the low exactly at sunrise and the high exactly at the peak', () => {
    expect(manualDiurnalTemperature(sunrise, args)).toBeCloseTo(-2, 9);
    expect(manualDiurnalTemperature(atClock(sunrise, DEFAULT_MANUAL_CURVE.peakClock), args)).toBeCloseTo(10, 9);
  });

  it('stays inside [low, high] everywhere', () => {
    for (let m = 0; m < 1440; m += 5) {
      const t = manualDiurnalTemperature(parseLocalDate('2026-11-13') + m, args);
      expect(t).toBeGreaterThanOrEqual(-2 - 1e-9);
      expect(t).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('rises faster than it falls: the evening decay is the slow side', () => {
    const peak = atClock(sunrise, '15:00');
    const riseSpan = peak - sunrise; // ~8 h
    const fallSpan = sunrise + 1440 - peak; // ~16 h
    expect(fallSpan).toBeGreaterThan(riseSpan);
    // Half the range is shed in well under half the night: fast radiative cooling first.
    let halfAt = 0;
    for (let m = 0; m <= fallSpan; m += 1) {
      if (manualDiurnalTemperature(peak + m, args) <= 4) {
        halfAt = m;
        break;
      }
    }
    expect(halfAt).toBeGreaterThan(0);
    expect(halfAt / fallSpan).toBeLessThan(0.4);
  });

  it('is continuous across midnight', () => {
    const midnight = parseLocalDate('2026-11-14');
    const before = manualDiurnalTemperature(midnight - 1, args);
    const after = manualDiurnalTemperature(midnight + 1, args);
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });

  it('is monotone decreasing through the night', () => {
    const peak = atClock(sunrise, '15:00');
    let prev = Number.POSITIVE_INFINITY;
    for (let m = 0; m <= sunrise + 1440 - peak; m += 10) {
      const t = manualDiurnalTemperature(peak + m, args);
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      prev = t;
    }
  });
});

describe('sampleManual', () => {
  const trip = sampleManual({
    highC: 10,
    lowC: -2,
    dates: ['2026-11-20', '2026-11-21'],
    today: '2026-11-13',
    latitude: 35.6,
    longitude: -83.43,
    elevation: 1800,
    utcOffsetHours: -5,
    timezone: 'America/New_York',
    windSpeedMs: 4,
    cloudCover: 0.1,
    relativeHumidity: 0.6,
  });

  it('emits exactly the same type as the forecast path', () => {
    const manualPhase = trip.days[0]!.phases.hiking;
    const forecastPhase = sampleForecast({ series: syntheticSeries() }).days[0]!.phases.hiking;
    expect(Object.keys(manualPhase).sort()).toEqual(Object.keys(forecastPhase).sort());
  });

  it('is tagged manual and reports no radiation or probability', () => {
    for (const p of PHASE_NAMES) {
      expect(trip.days[0]!.phases[p].source).toBe('manual');
      expect(trip.days[0]!.phases[p].shortwaveRadiation).toBeNull();
      expect(trip.days[0]!.phases[p].precipitationProbability).toBeNull();
    }
  });

  it('recovers the entered high and low across the day, within half a degree', () => {
    // Compare against the undisturbed curve by stripping the uncertainty widening.
    const noUncertainty = sampleManual({
      highC: 10,
      lowC: -2,
      dates: ['2026-11-20'],
      latitude: 35.6,
      longitude: -83.43,
      elevation: 1800,
      utcOffsetHours: -5,
      uncertaintySdC: 0,
    }).days[0]!.phases;
    const mins = PHASE_NAMES.map((p) => noUncertainty[p].temperature.min);
    const maxs = PHASE_NAMES.map((p) => noUncertainty[p].temperature.max);
    expect(Math.min(...mins)).toBeGreaterThanOrEqual(-2);
    expect(Math.min(...mins)).toBeLessThan(-1.5);
    expect(Math.max(...maxs)).toBeLessThanOrEqual(10);
    expect(Math.max(...maxs)).toBeGreaterThan(9.5);
  });

  it('puts the coldest phase in the morning and the warmest in the hiking window', () => {
    const p = trip.days[0]!.phases;
    const means = PHASE_NAMES.map((n) => [n, p[n].temperature.mean] as const).sort((a, b) => a[1] - b[1]);
    expect(means[0]![0]).toBe('camp_morning');
    expect(means[means.length - 1]![0]).toBe('day_break');
  });

  it('passes the constant wind/cloud/humidity through unchanged', () => {
    const p = trip.days[0]!.phases.camp_evening;
    expect(p.windSpeed.mean).toBe(4);
    expect(p.windSpeed.sd).toBe(0);
    expect(p.cloudCover).toBe(0.1);
    expect(p.relativeHumidity).toBe(0.6);
    expect(p.precipitationTotal).toBe(0);
  });

  it('applies the manual uncertainty to the band', () => {
    expect(trip.days[0]!.phases.hiking.uncertaintySd).toBe(DEFAULT_UNCERTAINTY.manualSdC);
  });

  it('anchors the windows to its own computed sunrise, which matches the real one', () => {
    expect(trip.days[0]!.sunrise.slice(11)).toMatch(/^07:1\d$/);
    expect(trip.days[0]!.phases.camp_morning.startLocal.slice(11)).toMatch(/^06:1\d$/);
  });

  it('rejects a low above the high', () => {
    expect(() =>
      sampleManual({ highC: 0, lowC: 5, dates: ['2026-11-20'], latitude: 0, longitude: 0, elevation: 0 }),
    ).toThrow(/must be >=/);
  });
});

describe('the three sources are interchangeable to the consumer', () => {
  it('produce structurally identical TripWeather objects', async () => {
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
    const trips = [
      sampleForecast({ series: forecast }),
      sampleClimatology({ climatology: climo, dates: ['2027-11-20'], today: '2026-11-13' }),
      sampleManual({ highC: 8, lowC: -3, dates: ['2027-11-20'], latitude: 35.6, longitude: -83.43, elevation: 1800 }),
    ];
    const shape = (t: (typeof trips)[number]) => ({
      top: Object.keys(t).sort(),
      loc: Object.keys(t.location).filter((k) => k !== 'label' && k !== 'modelElevation').sort(),
      day: Object.keys(t.days[0]!).sort(),
      phase: Object.keys(t.days[0]!.phases.hiking).sort(),
      dist: Object.keys(t.days[0]!.phases.hiking.temperature).sort(),
    });
    expect(shape(trips[1]!)).toEqual(shape(trips[0]!));
    expect(shape(trips[2]!)).toEqual(shape(trips[0]!));
  });
});
