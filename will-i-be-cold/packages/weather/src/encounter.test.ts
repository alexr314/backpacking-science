/**
 * The aggregation and the encounter curve.
 *
 * Two objects with two different jobs are under test here, and most of the care goes into not
 * confusing them: the pooled **marginal** (what the temperature is at a random exposed moment,
 * which correlation cannot touch) and the **encounter curve** (whether the temperature reaches
 * a value at some point, which is a minimum over correlated samples and is all about
 * correlation).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGGREGATION,
  MEASURED_ERROR_STRUCTURE,
  MEASURED_HOURLY_PROCESS,
  MEASURED_HOURLY_PROCESS_BY_LEAD,
  aggregatePhase,
  checkErrorStructure,
  checkHourlyErrorProcess,
  coldRiskProbability,
  coldRiskTemperature,
  encounterProbability,
  hourlyErrorProcess,
  impliedErrorStructure,
  phaseDistributions,
  processAutocorrelation,
  warmRiskProbability,
  type ErrorStructure,
  type HourlyErrorProcess,
} from './encounter.js';
import { DEFAULT_UNCERTAINTY, sampleClimatology, sampleForecast, sampleManual } from './diurnal.js';
import { allFixtureUrls, fixtureFetchJson, loadFixture, TEST_POINT } from './fixtures.js';
import { fetchClimatology } from './openmeteo.js';
import type { SeriesResponse } from './openmeteo.js';
import type { DayWeather } from './types.js';

/** A deterministic series: temperature = the hour of day, everything else constant. */
function syntheticSeries(days = 6, offsetPerDayC = 0): SeriesResponse {
  const time: string[] = [];
  const temp: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`2026-11-${String(13 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
      temp.push(h + d * offsetPerDayC);
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
      windSpeed10m: new Array(n).fill(1),
      cloudCover: new Array(n).fill(0.25),
      precipitation: new Array(n).fill(0),
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

/** No forecast error at all: the sampler's own uncertainty model switched off. */
const CERTAIN = { ...DEFAULT_UNCERTAINTY, leadDaySdC: [0], saturationSdC: 0, verificationInflation: 1 };

const certainTrip = (days = 6, offsetPerDayC = 0) =>
  sampleForecast({ series: syntheticSeries(days, offsetPerDayC), today: '2026-11-13', uncertainty: CERTAIN });
const uncertainTrip = (days = 6) =>
  sampleForecast({ series: syntheticSeries(days), today: '2026-11-13' });

// =============================================================================================
// Pooling
// =============================================================================================

describe('pooling a phase over the nights of a trip', () => {
  it('returns the same type for one night and for the whole trip', () => {
    const trip = certainTrip();
    const all = aggregatePhase(trip.days, 'camp_evening');
    const one = aggregatePhase([trip.days[0] as DayWeather], 'camp_evening');
    expect(Object.keys(all).sort()).toEqual(Object.keys(one).sort());
    expect(Object.keys(all.temperature).sort()).toEqual(Object.keys(one.temperature).sort());
    expect(all.nights).toBe(trip.days.length);
    expect(one.nights).toBe(1);
    expect(one.dates).toEqual([trip.days[0]!.date]);
    expect(all.hours).toBe(one.hours * trip.days.length);
  });

  it('keeps p10/p50/p90/min/max/mean/sd alongside the bins, so the band can still be drawn', () => {
    const d = aggregatePhase(certainTrip().days, 'camp_evening');
    for (const k of ['p10', 'p50', 'p90', 'min', 'max', 'mean', 'sd'] as const) {
      expect(Number.isFinite(d.temperature[k])).toBe(true);
    }
    expect(d.temperature.p10).toBeLessThanOrEqual(d.temperature.p50);
    expect(d.temperature.p50).toBeLessThanOrEqual(d.temperature.p90);
    expect(d.temperature.min).toBeLessThanOrEqual(d.temperature.p10);
    expect(d.temperature.max).toBeGreaterThanOrEqual(d.temperature.p90);
  });

  it('pooling N identical nights reproduces the single-night distribution exactly', () => {
    // Identical nights means the same hours *and* the same forecast-error sd, so the days are
    // duplicated rather than taken from different lead times.
    const trip = uncertainTrip();
    const night = trip.days[2] as DayWeather;
    const one = aggregatePhase([night], 'camp_evening');
    const five = aggregatePhase([night, night, night, night, night], 'camp_evening');
    for (const k of ['p10', 'p50', 'p90', 'min', 'max', 'mean', 'sd'] as const) {
      expect(five.temperature[k]).toBeCloseTo(one.temperature[k], 9);
    }
    // The histogram is the same shape, with five times the samples in it.
    expect(five.histogram.sampleCount).toBe(one.histogram.sampleCount * 5);
    expect(five.histogram.bins.map((b) => b.from)).toEqual(one.histogram.bins.map((b) => b.from));
    five.histogram.bins.forEach((b, i) => {
      expect(b.fraction).toBeCloseTo(one.histogram.bins[i]!.fraction, 9);
    });
  });

  it('pooling nights with different means widens the distribution', () => {
    // Four degrees of warming per day: the same within-window spread, four very different means.
    const trip = certainTrip(4, 4);
    const nights = trip.days.map((d) => aggregatePhase([d], 'camp_evening'));
    const pooled = aggregatePhase(trip.days, 'camp_evening');
    for (const n of nights) {
      expect(pooled.temperature.sd).toBeGreaterThan(n.temperature.sd);
      expect(pooled.temperature.p90 - pooled.temperature.p10).toBeGreaterThan(
        n.temperature.p90 - n.temperature.p10,
      );
    }
  });

  it('offers the pooled view and the per-night drill-down in one call', () => {
    const trip = certainTrip(4);
    const d = phaseDistributions(trip, 'sleep');
    expect(d.phase).toBe('sleep');
    expect(d.byNight).toHaveLength(trip.days.length);
    expect(d.overall.dates).toEqual(d.byNight.map((n) => n.dates[0]));
    expect(d.overall.hours).toBe(d.byNight.reduce((s, n) => s + n.hours, 0));
  });

  it('refuses a day the sampler did not leave hourly samples on, rather than inventing them', () => {
    const trip = certainTrip(2);
    const stripped = { ...(trip.days[0] as DayWeather) };
    stripped.phases = { ...stripped.phases, camp_evening: { ...stripped.phases.camp_evening } };
    delete stripped.phases.camp_evening.temperatureByHourC;
    expect(() => aggregatePhase([stripped], 'camp_evening')).toThrow(/hourly samples/);
  });
});

// =============================================================================================
// Histogram bins
// =============================================================================================

describe('histogram bins are ready to render', () => {
  it('lands its edges on round display values, every 5 °F by default, computed in SI', () => {
    const h = aggregatePhase(uncertainTrip().days, 'camp_evening').histogram;
    expect(h.unit).toBe('F');
    expect(h.binWidth).toBe(DEFAULT_AGGREGATION.binWidthF);
    expect(h.binWidthK).toBeCloseTo(5 / 1.8, 12);
    for (const b of h.bins) {
      expect(b.from % 5).toBe(0);
      expect(b.to).toBe(b.from + 5);
      // The SI edge really is that round display number, not a rounded Celsius.
      expect(b.fromC * 1.8 + 32).toBeCloseTo(b.from, 9);
      expect(b.toC - b.fromC).toBeCloseTo(5 / 1.8, 12);
    }
  });

  it('counts sum to the sample count and fractions to 1', () => {
    const d = aggregatePhase(uncertainTrip().days, 'camp_evening');
    const counts = d.histogram.bins.reduce((s, b) => s + b.count, 0);
    expect(counts).toBeCloseTo(d.histogram.sampleCount, 6);
    expect(d.histogram.sampleCount).toBe(d.hours);
    expect(d.histogram.bins.reduce((s, b) => s + b.fraction, 0)).toBeCloseTo(1, 9);
  });

  it('is configurable, in °C as well, and still lands on round numbers', () => {
    const d = aggregatePhase(uncertainTrip().days, 'camp_evening', { unit: 'C', binWidth: 2 });
    expect(d.histogram.binWidthK).toBe(2);
    for (const b of d.histogram.bins) {
      expect(b.from % 2).toBe(0);
      expect(b.fromC).toBeCloseTo(b.from, 9);
    }
    expect(d.histogram.bins.reduce((s, b) => s + b.count, 0)).toBeCloseTo(d.histogram.sampleCount, 6);
  });

  it('brackets the whole plausible range: the first and last bin carry the tails', () => {
    const d = aggregatePhase(uncertainTrip().days, 'camp_evening');
    const first = d.histogram.bins[0]!;
    const last = d.histogram.bins[d.histogram.bins.length - 1]!;
    expect(first.fromC).toBeLessThanOrEqual(d.temperature.min);
    expect(last.toC).toBeGreaterThanOrEqual(d.temperature.max);
  });
});

// =============================================================================================
// The encounter curve
// =============================================================================================

describe('the encounter curve answers "will I meet this temperature"', () => {
  it('is bounded in [0,1] and deliberately does NOT sum to 1: it is not a distribution', () => {
    const c = aggregatePhase(uncertainTrip().days, 'camp_evening').encounter;
    for (const p of c.encounter) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // One evening passes through many temperatures, so the curve is a plateau, not a density.
    expect(c.encounter.reduce((s, p) => s + p, 0)).toBeGreaterThan(1);
  });

  it('plateaus at 1 across the range the period really covers, and falls to 0 outside it', () => {
    // With the forecast error switched off, the evening runs from 16 °C to 20 °C exactly, so
    // every temperature in between is passed through with certainty and nothing outside is.
    const c = aggregatePhase([certainTrip().days[0] as DayWeather], 'camp_evening', { unit: 'C', curveStep: 1 })
      .encounter;
    expect(encounterProbability(c, 18)).toBeCloseTo(1, 10);
    expect(encounterProbability(c, 16.5)).toBeCloseTo(1, 10);
    expect(encounterProbability(c, 19.5)).toBeCloseTo(1, 10);
    expect(encounterProbability(c, 14)).toBeCloseTo(0, 10);
    expect(encounterProbability(c, 25)).toBeCloseTo(0, 10);
  });

  it('coldRisk is monotone in T, 0 far below the range and 1 far above it', () => {
    // Monotone NON-DECREASING: P(it gets at least as cold as T) grows as T warms up.
    const d = aggregatePhase(uncertainTrip().days, 'camp_evening');
    const c = d.encounter;
    for (let i = 1; i < c.coldRisk.length; i += 1) {
      expect(c.coldRisk[i] as number).toBeGreaterThanOrEqual((c.coldRisk[i - 1] as number) - 1e-12);
      expect(c.warmRisk[i] as number).toBeLessThanOrEqual((c.warmRisk[i - 1] as number) + 1e-12);
    }
    expect(coldRiskProbability(c, d.temperature.min - 20)).toBe(0);
    expect(coldRiskProbability(c, d.temperature.max + 20)).toBe(1);
    expect(warmRiskProbability(c, d.temperature.min - 20)).toBe(1);
    expect(warmRiskProbability(c, d.temperature.max + 20)).toBe(0);
  });

  it('is deterministic: the same inputs render the same curve every time', () => {
    const trip = uncertainTrip();
    const a = aggregatePhase(trip.days, 'camp_evening').encounter;
    const b = aggregatePhase(trip.days, 'camp_evening').encounter;
    expect(b.coldRisk).toEqual(a.coldRisk);
    expect(b.encounter).toEqual(a.encounter);
    const other = aggregatePhase(trip.days, 'camp_evening', { seed: 7 }).encounter;
    expect(other.coldRisk).not.toEqual(a.coldRisk);
    // A different seed is a different sample of the same curve, not a different curve.
    expect(coldRiskTemperature(other, 0.5)).toBeCloseTo(coldRiskTemperature(a, 0.5), 0);
  });

  it('reads between grid points and clamps outside them', () => {
    const c = aggregatePhase(uncertainTrip().days, 'camp_evening').encounter;
    const i = Math.floor(c.temperaturesC.length / 2);
    const lo = c.temperaturesC[i] as number;
    const hi = c.temperaturesC[i + 1] as number;
    const mid = encounterProbability(c, (lo + hi) / 2);
    const ends = [c.encounter[i] as number, c.encounter[i + 1] as number].sort((x, y) => x - y);
    expect(mid).toBeGreaterThanOrEqual(ends[0] as number);
    expect(mid).toBeLessThanOrEqual(ends[1] as number);
    expect(coldRiskProbability(c, -1e6)).toBe(c.coldRisk[0]);
  });
});

// =============================================================================================
// The correlation structure, which is the whole reason this is a Monte Carlo
// =============================================================================================

describe('the nested error structure is wired the right way round', () => {
  const total = (s: ErrorStructure) =>
    s.tripVarianceFraction + s.nightVarianceFraction + s.hourVarianceFraction;

  it('ships the measured partition, and it is a partition', () => {
    expect(total(MEASURED_ERROR_STRUCTURE)).toBeCloseTo(1, 9);
    expect(() => checkErrorStructure(MEASURED_ERROR_STRUCTURE)).not.toThrow();
    expect(() =>
      checkErrorStructure({ tripVarianceFraction: 0.5, nightVarianceFraction: 0.5, hourVarianceFraction: 0.5 }),
    ).toThrow(/sum to 1/);
  });

  it('more shared variance, at the same total, makes the cold tail LESS extreme', () => {
    // The sanity check. Independent hours give the minimum many separate chances to dip; shared
    // error moves the whole night together, so there is effectively one chance instead of nine.
    const trip = uncertainTrip();
    const independent = aggregatePhase(trip.days, 'sleep', {
      errorStructure: { tripVarianceFraction: 0, nightVarianceFraction: 0, hourVarianceFraction: 1 },
    });
    const shared = aggregatePhase(trip.days, 'sleep', {
      errorStructure: { tripVarianceFraction: 0.5, nightVarianceFraction: 0.5, hourVarianceFraction: 0 },
    });
    // Same marginal either way: correlation cannot touch it.
    expect(shared.temperature.p10).toBeCloseTo(independent.temperature.p10, 9);
    // But a much less extreme 1-in-100 cold outcome.
    expect(coldRiskTemperature(shared.encounter, 0.01)).toBeGreaterThan(
      coldRiskTemperature(independent.encounter, 0.01),
    );
    expect(coldRiskTemperature(shared.encounter, 0.1)).toBeGreaterThan(
      coldRiskTemperature(independent.encounter, 0.1),
    );
  });

  it('pooling more nights can only raise the cold risk at a fixed temperature', () => {
    const trip = uncertainTrip();
    const target = aggregatePhase(trip.days, 'camp_evening').temperature.p10;
    let previous = -1;
    for (let n = 1; n <= trip.days.length; n += 1) {
      const p = coldRiskProbability(aggregatePhase(trip.days.slice(0, n), 'camp_evening').encounter, target);
      expect(p).toBeGreaterThanOrEqual(previous - 0.02); // Monte Carlo noise, 4 000 draws
      previous = p;
    }
    const one = coldRiskProbability(aggregatePhase([trip.days[0] as DayWeather], 'camp_evening').encounter, target);
    const all = coldRiskProbability(aggregatePhase(trip.days, 'camp_evening').encounter, target);
    expect(all).toBeGreaterThan(one);
  });

  it('widens the plateau as nights are pooled: more nights visit more temperatures', () => {
    const trip = certainTrip(5, 3);
    const span = (n: number): number => {
      const c = aggregatePhase(trip.days.slice(0, n), 'camp_evening').encounter;
      const hit = c.temperaturesC.filter((_, i) => (c.encounter[i] as number) > 0.9);
      return hit.length === 0 ? 0 : Math.max(...hit) - Math.min(...hit);
    };
    expect(span(5)).toBeGreaterThan(span(1));
  });

  it('works for a manual high/low too, where the error is the user’s own confidence', () => {
    const trip = sampleManual({
      highC: 10,
      lowC: -5,
      dates: ['2026-11-13', '2026-11-14'],
      latitude: 35.6,
      longitude: -83.43,
      elevation: 1800,
    });
    const d = aggregatePhase(trip.days, 'camp_evening');
    expect(d.sources).toEqual(['manual']);
    expect(coldRiskProbability(d.encounter, d.temperature.p50)).toBeGreaterThan(0.5);
    expect(d.histogram.bins.reduce((s, b) => s + b.count, 0)).toBeCloseTo(d.histogram.sampleCount, 6);
  });
});

// =============================================================================================
// The correlated hourly process: the structure that replaced the exchangeable one
// =============================================================================================

/** The raw measurement the shipped constants are fitted to. */
interface ErrorStructureFixture {
  maxLagHours: number;
  fitMaxLagHours: number;
  pooledProcess: HourlyErrorProcess;
  pooled: ErrorStructure;
  leads: {
    leadDays: number;
    sdC: number;
    acf: number[];
    process: HourlyErrorProcess;
    fit: { maxAbsResidual: number };
  }[];
}

const errorFixture = (): ErrorStructureFixture => loadFixture<ErrorStructureFixture>('error-structure.json');

/** A series that is the same temperature at every hour, so the window min is purely the error. */
function flatSeries(valueC: number, days = 4): SeriesResponse {
  const s = syntheticSeries(days);
  return { ...s, hourly: { ...s.hourly, temperature2m: s.hourly.temperature2m.map(() => valueC) } };
}

/** An uncertainty model with one flat, known sd at every lead, so the analytics are exact. */
const flatSd = (sdC: number) => ({
  ...DEFAULT_UNCERTAINTY,
  leadDaySdC: [sdC],
  saturationSdC: sdC,
  verificationInflation: 1,
});

/**
 * Standard normal CDF, written out independently of the module under test so it is a real check
 * and not a restatement. `Phi(z) = 0.5 * erfc(-z / sqrt(2))`, with Numerical Recipes' erfc
 * Horner-evaluated from the tail coefficient down.
 */
function phi(z: number): number {
  const c = [
    0.17087277, -0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806, 0.09678418, 0.37409196,
    1.00002368, -1.26551223,
  ];
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  let poly = 0;
  for (const k of c) poly = poly * t + k;
  const halfErfc = 0.5 * t * Math.exp(-x * x + poly);
  return z >= 0 ? 1 - halfErfc : halfErfc;
}

/** Variance shares that put everything on one named component. */
function onlyProcess(part: keyof HourlyErrorProcess, ar1 = 0): HourlyErrorProcess {
  const p: HourlyErrorProcess = {
    ar1,
    arVarianceFraction: 0,
    diurnalVarianceFraction: 0,
    semidiurnalVarianceFraction: 0,
    sharedVarianceFraction: 0,
    whiteVarianceFraction: 0,
  };
  return { ...p, [part]: 1 };
}

describe('the fitted hourly process reproduces the measured autocorrelation', () => {
  it('ships exactly the fit that is recorded in fixtures/error-structure.json', () => {
    // The constants are compiled in (this package must run in a browser, so it cannot read the
    // fixture at runtime). This is what keeps them honest: re-run the script and the diff shows.
    const fixture = errorFixture();
    expect(MEASURED_HOURLY_PROCESS_BY_LEAD.map((r) => r.leadDays)).toEqual(fixture.leads.map((l) => l.leadDays));
    MEASURED_HOURLY_PROCESS_BY_LEAD.forEach((row, i) => {
      expect(row.process).toEqual(fixture.leads[i]!.process);
      expect(() => checkHourlyErrorProcess(row.process)).not.toThrow();
    });
    expect(MEASURED_HOURLY_PROCESS).toEqual(fixture.pooledProcess);
    expect(() => checkHourlyErrorProcess(MEASURED_HOURLY_PROCESS)).not.toThrow();
    // The superseded shares are still readable under the keys they always had.
    expect(fixture.pooled.tripVarianceFraction).toBeCloseTo(MEASURED_ERROR_STRUCTURE.tripVarianceFraction, 2);
    expect(fixture.pooled.hourVarianceFraction).toBeCloseTo(MEASURED_ERROR_STRUCTURE.hourVarianceFraction, 2);
  });

  it('matches the measurement at lags 1, 2, 3 and 6, at every lead', () => {
    // THE point of the rewrite. The old model replaced this whole curve with one average.
    const fixture = errorFixture();
    for (const lead of fixture.leads) {
      const process = hourlyErrorProcess(lead.leadDays);
      for (const lag of [1, 2, 3, 6]) {
        const measured = lead.acf[lag - 1] as number;
        const fitted = processAutocorrelation(process, lag);
        expect(Math.abs(fitted - measured), `lead ${lead.leadDays} lag ${lag}: ${fitted} vs ${measured}`).toBeLessThan(
          0.03,
        );
      }
      // And over the whole fitted range, not just the four lags we assert on.
      expect(lead.fit.maxAbsResidual).toBeLessThan(0.05);
      for (let lag = 1; lag <= fixture.fitMaxLagHours; lag += 1) {
        expect(
          Math.abs(processAutocorrelation(process, lag) - (lead.acf[lag - 1] as number)),
          `lead ${lead.leadDays} lag ${lag}`,
        ).toBeLessThan(0.05);
      }
    }
  });

  it('carries the two things an exchangeable model cannot: fast decay and a 24 h revival', () => {
    const fixture = errorFixture();
    const day2 = hourlyErrorProcess(2);
    // Adjacent hours are strongly correlated, and the correlation really does decay fast.
    expect(processAutocorrelation(day2, 1)).toBeGreaterThan(0.8);
    expect(processAutocorrelation(day2, 6)).toBeLessThan(0.15);
    // Negative around lags 9 to 12: too warm this evening means too cold twelve hours later.
    expect(processAutocorrelation(day2, 9)).toBeLessThan(0);
    expect(processAutocorrelation(day2, 12)).toBeLessThan(0);
    // And positive again a day later, which is the shared across-night component.
    expect(processAutocorrelation(day2, 24)).toBeGreaterThan(0.5);
    expect(processAutocorrelation(day2, 24)).toBeGreaterThan(processAutocorrelation(day2, 12));
    // None of which the mean over lags 1 to 9 can express: it is a single number near 0.23.
    const meanShortLag =
      [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((s, L) => s + (fixture.leads[1]!.acf[L - 1] as number), 0) / 9;
    expect(meanShortLag).toBeLessThan(0.35);
    expect(processAutocorrelation(day2, 1)).toBeGreaterThan(meanShortLag * 2);
  });

  it('is 1 at lag 0, symmetric in the lag, and a valid process at every interpolated lead', () => {
    for (const lead of [1, 1.5, 2, 3.4, 7, 9, 40]) {
      const p = hourlyErrorProcess(lead);
      expect(() => checkHourlyErrorProcess(p)).not.toThrow();
      expect(processAutocorrelation(p, 0)).toBe(1);
      expect(processAutocorrelation(p, -3)).toBeCloseTo(processAutocorrelation(p, 3), 12);
    }
    // Clamped outside the measured range, both ends, because there is no measurement out there.
    expect(hourlyErrorProcess(0.2)).toEqual(MEASURED_HOURLY_PROCESS_BY_LEAD[0]!.process);
    expect(hourlyErrorProcess(99)).toEqual(
      MEASURED_HOURLY_PROCESS_BY_LEAD[MEASURED_HOURLY_PROCESS_BY_LEAD.length - 1]!.process,
    );
    // And interpolated in between.
    const mid = hourlyErrorProcess(2.5);
    expect(mid.ar1).toBeCloseTo((0.74 + 0.7325) / 2, 9);
  });

  it('rejects a process that is not a partition, or an out-of-range correlation', () => {
    expect(() => checkHourlyErrorProcess({ ...onlyProcess('whiteVarianceFraction'), ar1: 1 })).toThrow(/ar1/);
    expect(() => checkHourlyErrorProcess({ ...onlyProcess('whiteVarianceFraction'), ar1: -0.1 })).toThrow(/ar1/);
    expect(() =>
      checkHourlyErrorProcess({ ...onlyProcess('whiteVarianceFraction'), sharedVarianceFraction: 0.5 }),
    ).toThrow(/sum to 1/);
    expect(() =>
      checkHourlyErrorProcess({ ...onlyProcess('sharedVarianceFraction'), whiteVarianceFraction: -1 }),
    ).toThrow(/non-negative/);
  });

  it('summarises itself as an exchangeable structure for display, and the summary is a partition', () => {
    for (const lead of [1, 2, 4, 7]) {
      const s = impliedErrorStructure(hourlyErrorProcess(lead));
      expect(() => checkErrorStructure(s)).not.toThrow();
    }
    // The real structure is far less hour-to-hour independent than the superseded shares said.
    expect(impliedErrorStructure(hourlyErrorProcess(7)).hourVarianceFraction).toBeLessThan(
      MEASURED_ERROR_STRUCTURE.hourVarianceFraction,
    );
  });
});

// =============================================================================================
// The simulator really implements the process it claims to
// =============================================================================================

describe('the Monte Carlo draws the process it reports', () => {
  const sd = 2;
  const flatTrip = (days = 4) =>
    sampleForecast({ series: flatSeries(0, days), today: '2026-11-13', uncertainty: flatSd(sd) });
  const opts = { unit: 'C' as const, curveStep: 1, draws: 40000 };

  it('with all the variance shared, the window minimum is one normal draw, exactly', () => {
    // Shared means every hour of the window moves together, so min(window) = base + sd*z and
    // the cold-risk curve is just the normal CDF. No approximation to hide behind.
    const d = aggregatePhase([flatTrip().days[0] as DayWeather], 'sleep', {
      ...opts,
      hourlyProcess: onlyProcess('sharedVarianceFraction'),
    });
    for (const t of [-1, -2, -3, -4]) {
      expect(coldRiskProbability(d.encounter, t)).toBeCloseTo(phi(t / sd), 2);
    }
  });

  it('with all the variance white, it is the minimum of that many independent normals', () => {
    const night = flatTrip().days[0] as DayWeather;
    const d = aggregatePhase([night], 'sleep', { ...opts, hourlyProcess: onlyProcess('whiteVarianceFraction') });
    const hours = d.hours;
    expect(hours).toBeGreaterThan(4);
    for (const t of [-1, -2, -3, -4]) {
      expect(coldRiskProbability(d.encounter, t)).toBeCloseTo(1 - (1 - phi(t / sd)) ** hours, 2);
    }
  });

  it('an AR(1) with phi = 0 IS white noise, which is what makes phi the only knob', () => {
    const night = flatTrip().days[0] as DayWeather;
    const white = aggregatePhase([night], 'sleep', { ...opts, hourlyProcess: onlyProcess('whiteVarianceFraction') });
    const ar0 = aggregatePhase([night], 'sleep', { ...opts, hourlyProcess: onlyProcess('arVarianceFraction', 0) });
    for (const t of [-1, -2, -3, -4]) {
      expect(coldRiskProbability(ar0.encounter, t)).toBeCloseTo(coldRiskProbability(white.encounter, t), 2);
    }
  });

  it('leaves the marginal alone whatever the correlation is: only the curve moves', () => {
    const night = flatTrip().days[0] as DayWeather;
    const a = aggregatePhase([night], 'sleep', { ...opts, hourlyProcess: onlyProcess('whiteVarianceFraction') });
    const b = aggregatePhase([night], 'sleep', { ...opts, hourlyProcess: onlyProcess('arVarianceFraction', 0.95) });
    for (const k of ['p10', 'p50', 'p90', 'mean', 'sd'] as const) {
      expect(b.temperature[k]).toBeCloseTo(a.temperature[k], 9);
    }
    expect(coldRiskTemperature(b.encounter, 0.1)).toBeGreaterThan(coldRiskTemperature(a.encounter, 0.1));
  });

  it('reports which model drew the curve, and the process it used', () => {
    const trip = uncertainTrip(4);
    expect(trip.days).toHaveLength(3);
    const now = aggregatePhase(trip.days, 'sleep').encounter;
    expect(now.errorModel).toBe('correlated-hourly');
    expect(now.hourlyProcess).not.toBeNull();
    expect(now.processLeadDays).toBeCloseTo(
      trip.days.reduce((acc, day) => acc + day.daysOut, 0) / trip.days.length,
      9,
    );
    expect(now.hourlyProcess).toEqual(hourlyErrorProcess(now.processLeadDays as number));
    expect(now.errorStructure).toEqual(impliedErrorStructure(now.hourlyProcess as HourlyErrorProcess));

    const then = aggregatePhase(trip.days, 'sleep', { errorStructure: MEASURED_ERROR_STRUCTURE }).encounter;
    expect(then.errorModel).toBe('exchangeable-nested');
    expect(then.hourlyProcess).toBeNull();
    expect(then.processLeadDays).toBeNull();
    expect(then.errorStructure).toEqual(MEASURED_ERROR_STRUCTURE);

    // An explicit process wins over an explicit exchangeable structure, as documented.
    const both = aggregatePhase(trip.days, 'sleep', {
      hourlyProcess: MEASURED_HOURLY_PROCESS,
      errorStructure: MEASURED_ERROR_STRUCTURE,
    }).encounter;
    expect(both.errorModel).toBe('correlated-hourly');
    expect(both.hourlyProcess).toEqual(MEASURED_HOURLY_PROCESS);
  });
});

// =============================================================================================
// The regression that matters: correlation must shorten the cold tail, not lengthen it
// =============================================================================================

describe('more hour-to-hour correlation, at the same total variance, shortens the cold tail', () => {
  it('is monotone in the AR(1) correlation, which is the parameter that was understated', () => {
    // Total variance is fixed by construction (the shares sum to 1), so this isolates the
    // correlation exactly. Raising phi removes effectively independent chances for the minimum
    // to dip. A flat base temperature puts the whole effect on the error, with no diurnal
    // shape for the minimum to latch onto.
    const trip = sampleForecast({
      series: flatSeries(0, 4),
      today: '2026-11-13',
      uncertainty: { ...DEFAULT_UNCERTAINTY, leadDaySdC: [2], saturationSdC: 2, verificationInflation: 1 },
    });
    const at = (nights: readonly DayWeather[], ar1: number, p: number): number =>
      coldRiskTemperature(
        aggregatePhase(nights, 'sleep', {
          hourlyProcess: onlyProcess('arVarianceFraction', ar1),
          draws: 40000,
          unit: 'C',
          curveStep: 0.25,
        }).encounter,
        p,
      );
    const one = [trip.days[0] as DayWeather];
    for (const p of [0.5, 0.1, 0.01]) {
      for (const nights of [one, trip.days]) {
        const sweep = [0, 0.3, 0.6, 0.8, 0.95].map((ar1) => at(nights, ar1, p));
        for (let i = 1; i < sweep.length; i += 1) {
          expect(sweep[i] as number, `p=${p}, ${nights.length}n, step ${i}: ${sweep.join(', ')}`).toBeGreaterThan(
            sweep[i - 1] as number,
          );
        }
      }
    }
    // And it is a big effect, not a rounding difference. For one nine-hour window the
    // independent minimum sits about 1.5 sd below the mean and the fully correlated one about 0,
    // so at sd 2 the median gap is a degree or more.
    expect(at(one, 0.95, 0.5) - at(one, 0, 0.5)).toBeGreaterThan(1);
    expect(at(one, 0.95, 0.1) - at(one, 0, 0.1)).toBeGreaterThan(1);
    // The far tail gains less, and that is the honest behaviour rather than a shortfall: a more
    // correlated night has fewer independent chances to dip, but its night-level shift is also a
    // WIDER single draw, and at 1-in-100 the two effects nearly cancel. The direction still holds.
    expect(at(one, 0.95, 0.01) - at(one, 0, 0.01)).toBeGreaterThan(0.25);
  });

  it('holds on a real diurnal shape too, where the base temperature moves as well', () => {
    const trip = uncertainTrip(4);
    const at = (ar1: number, p: number): number =>
      coldRiskTemperature(
        aggregatePhase(trip.days, 'sleep', { hourlyProcess: onlyProcess('arVarianceFraction', ar1), draws: 40000 })
          .encounter,
        p,
      );
    for (const p of [0.5, 0.1, 0.01]) {
      expect(at(0.95, p), `p=${p}`).toBeGreaterThan(at(0, p));
    }
  });

  it('the new model is WARMER at the median than the exchangeable one it replaced', () => {
    // The whole point: the old model's within-night correlation of 0.23 came from averaging a
    // decaying autocorrelation, so a nine-hour window got roughly nine independent chances to
    // dip instead of about two, and the cold tail came out too deep.
    const trip = uncertainTrip(4);
    for (const phase of ['sleep', 'camp_evening'] as const) {
      const pooled = {
        then: aggregatePhase(trip.days, phase, { errorStructure: MEASURED_ERROR_STRUCTURE, draws: 40000 }),
        now: aggregatePhase(trip.days, phase, { draws: 40000 }),
      };
      expect(pooled.now.hours).toBeGreaterThan(1);
      // Same marginal. Correlation cannot touch it, so this is a like-for-like comparison.
      for (const k of ['p10', 'p50', 'p90', 'mean', 'sd'] as const) {
        expect(pooled.now.temperature[k]).toBeCloseTo(pooled.then.temperature[k], 9);
      }
      expect(coldRiskTemperature(pooled.now.encounter, 0.5)).toBeGreaterThan(
        coldRiskTemperature(pooled.then.encounter, 0.5),
      );
      // Per night as well as pooled, so it is not an artefact of how the nights are coupled.
      for (const day of trip.days) {
        const then = aggregatePhase([day], phase, { errorStructure: MEASURED_ERROR_STRUCTURE, draws: 40000 });
        const now = aggregatePhase([day], phase, { draws: 40000 });
        expect(coldRiskTemperature(now.encounter, 0.5), `${day.date} ${phase}`).toBeGreaterThan(
          coldRiskTemperature(then.encounter, 0.5),
        );
      }
    }
  });

  it('and it lowers the probability of a given cold threshold being reached', () => {
    const trip = uncertainTrip(4);
    const then = aggregatePhase(trip.days, 'sleep', { errorStructure: MEASURED_ERROR_STRUCTURE, draws: 40000 });
    const now = aggregatePhase(trip.days, 'sleep', { draws: 40000 });
    const target = coldRiskTemperature(then.encounter, 0.5);
    expect(coldRiskProbability(now.encounter, target)).toBeLessThan(
      coldRiskProbability(then.encounter, target) - 0.02,
    );
  });

  it('stays deterministic: same seed, same curve, every run', () => {
    const trip = uncertainTrip(4);
    const a = aggregatePhase(trip.days, 'sleep').encounter;
    const b = aggregatePhase(trip.days, 'sleep').encounter;
    expect(b.coldRisk).toEqual(a.coldRisk);
    expect(b.encounter).toEqual(a.encounter);
    expect(b.warmRisk).toEqual(a.warmRisk);
    expect(b.temperaturesC).toEqual(a.temperaturesC);
    // A different seed is a different sample of the same curve, not a different curve.
    const other = aggregatePhase(trip.days, 'sleep', { seed: 99 }).encounter;
    expect(other.coldRisk).not.toEqual(a.coldRisk);
    expect(coldRiskTemperature(other, 0.5)).toBeCloseTo(coldRiskTemperature(a, 0.5), 0);
    // Including on the per-night drill-down, which is what the panel re-renders most.
    const x = phaseDistributions(trip, 'sleep');
    const y = phaseDistributions(trip, 'sleep');
    expect(y.byNight.map((n) => n.encounter.coldRisk)).toEqual(x.byNight.map((n) => n.encounter.coldRisk));
  });
});

// =============================================================================================
// The marginal mixture's own normal CDF, pinned against known values of Phi
// =============================================================================================

describe('the mixture CDF behind the marginal is a correctly calibrated normal', () => {
  // `normalCdf` is private, so this goes through the public marginal: with a flat series every
  // hour carries the same value, so the pooled mixture IS one normal and the exact quantiles
  // must land on the textbook z values. A miscalibrated erfc (evaluating it at |z| rather than
  // |z| / sqrt(2), which is the easy mistake) moves p10 by half a degree at sd 2, so this is
  // worth a test of its own rather than being left to a comment.
  const sd = 2;
  const marginal = () =>
    aggregatePhase(
      [
        sampleForecast({
          series: flatSeries(0, 4),
          today: '2026-11-13',
          uncertainty: flatSd(sd),
        }).days[0] as DayWeather,
      ],
      'sleep',
      { unit: 'C', curveStep: 1 },
    );

  it('puts p10/p50/p90 exactly where a normal of that sd puts them', () => {
    const d = marginal();
    expect(d.temperature.p50).toBeCloseTo(0, 6);
    expect(d.temperature.p10).toBeCloseTo(-1.2815515655446004 * sd, 4);
    expect(d.temperature.p90).toBeCloseTo(1.2815515655446004 * sd, 4);
    expect(d.temperature.sd).toBeCloseTo(sd, 9);
  });

  it('bins the same normal: every bin fraction is the difference of two Phi values', () => {
    const d = aggregatePhase(
      [
        sampleForecast({ series: flatSeries(0, 4), today: '2026-11-13', uncertainty: flatSd(sd) })
          .days[0] as DayWeather,
      ],
      'sleep',
      { unit: 'C', binWidth: 1 },
    );
    const bins = d.histogram.bins;
    bins.forEach((b, i) => {
      const lower = i === 0 ? 0 : phi(b.fromC / sd);
      const upper = i === bins.length - 1 ? 1 : phi(b.toC / sd);
      expect(b.fraction, `bin ${b.from}..${b.to}`).toBeCloseTo(upper - lower, 6);
    });
  });
});

// =============================================================================================
// Climatology: one historical occasion per night, not a different year at every hour
// =============================================================================================

describe('a climatology night is drawn as one occasion, not hour by hour', () => {
  it('matches the fraction of pooled occasions whose own window minimum is that cold', () => {
    // `PhaseWeather.temperatureByHourC` aligns realisation k to the SAME historical occasion at
    // every hour of the window, precisely so this can be done. Drawing k per hour instead would
    // invent hour-to-hour independence the record does not have, which is the same error as
    // understating the forecast-error correlation and pushes the cold tail the same way.
    const fetchJson = fixtureFetchJson(allFixtureUrls());
    return fetchClimatology(
      {
        latitude: TEST_POINT.latitude,
        longitude: TEST_POINT.longitude,
        elevation: TEST_POINT.assumedTrailElevationMetres,
        targetDate: '2026-11-20',
        years: 20,
        endYear: 2025,
      },
      fetchJson,
    ).then((climatology) => {
      const trip = sampleClimatology({ climatology, dates: ['2027-11-20'], today: '2026-11-13' });
      const night = trip.days[0] as DayWeather;
      // Climatology carries no extra forecast error, so the curve is purely the pooled record.
      expect(night.phases.sleep.uncertaintySd).toBe(0);
      const byHour = night.phases.sleep.temperatureByHourC as readonly (readonly number[])[];
      const occasions = (byHour[0] as readonly number[]).length;
      expect(occasions).toBeGreaterThan(50);
      const occasionMinima = Array.from({ length: occasions }, (_, k) =>
        Math.min(...byHour.map((hour) => hour[k] as number)),
      );
      const curve = aggregatePhase([night], 'sleep', { unit: 'C', curveStep: 1, draws: 40000 }).encounter;
      for (const t of curve.temperaturesC) {
        const expected = occasionMinima.filter((m) => m <= t).length / occasions;
        expect(coldRiskProbability(curve, t), `at ${t} °C`).toBeCloseTo(expected, 1);
      }
    });
  });
});
