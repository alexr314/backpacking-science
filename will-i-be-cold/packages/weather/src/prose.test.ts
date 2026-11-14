/**
 * The house style, as a test: **no em dash, anywhere a user can see**. It is a standing client
 * rule, it is not negotiable, and a rule that is only written down gets broken. So this walks
 * every string the package can hand out (the published contract's constants, a whole sampled
 * `TripWeather`, an aggregated phase, and the error messages) and fails on a U+2014. It also
 * rejects the two usual ways of pretending to obey: a spaced hyphen or a spaced en dash
 * standing in for the same dash. An en dash *between numbers* is what ranges are built from
 * and is fine.
 */
import { describe, expect, it } from 'vitest';
import * as api from './index.js';
import { sampleForecast, sampleManual } from './diurnal.js';
import { aggregatePhase, phaseDistributions, checkErrorStructure } from './encounter.js';
import { parseForecast, OpenMeteoShapeError, OpenMeteoApiError } from './openmeteo.js';
import { loadFixture } from './fixtures.js';
import { MissingHoursError } from './diurnal.js';

/** U+2014, written as an escape so that even this file does not contain one. */
const EM_DASH = '\u2014';

function strings(value: unknown, path = '$', seen = new Set<unknown>()): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value !== 'object' || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`, seen));
  return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`, seen));
}

const forecastTrip = () => sampleForecast({ series: parseForecast(loadFixture('forecast-smokies-elevation-1800.json')) });
const manualTrip = () =>
  sampleManual({
    highC: 8,
    lowC: -6,
    dates: ['2026-11-13', '2026-11-14'],
    latitude: 35.6,
    longitude: -83.43,
    elevation: 1800,
    label: 'Smokies ridge',
  });

describe('no em dash, anywhere a user can see', () => {
  it('has none in anything exported from the package root', () => {
    const found = strings(api, '$api');
    expect(found.length).toBeGreaterThan(10);
    for (const [path, s] of found) expect(s, path).not.toContain(EM_DASH);
  });

  it('has none anywhere in a sampled trip, forecast or manual', () => {
    for (const trip of [forecastTrip(), manualTrip()]) {
      const found = strings(trip);
      expect(found.length).toBeGreaterThan(50);
      for (const [path, s] of found) expect(s, path).not.toContain(EM_DASH);
    }
  });

  it('has none in an aggregated phase, pooled or per night', () => {
    const d = phaseDistributions(forecastTrip(), 'camp_evening');
    for (const [path, s] of strings(d)) expect(s, path).not.toContain(EM_DASH);
  });

  it('has none in the error messages either', () => {
    const messages: string[] = [];
    const capture = (f: () => unknown): void => {
      try {
        f();
      } catch (e) {
        messages.push(e instanceof Error ? e.message : String(e));
      }
    };
    capture(() => sampleManual({ ...manualTripOptions(), highC: -10, lowC: 10 }));
    capture(() =>
      sampleForecast({
        series: parseForecast(loadFixture('forecast-smokies-elevation-1800.json')),
        dates: ['2026-11-13'],
        today: '2026-10-01',
      }),
    );
    capture(() => aggregatePhase([], 'sleep'));
    capture(() => aggregatePhase(forecastTrip().days, 'sleep', { draws: 0 }));
    capture(() =>
      aggregatePhase(forecastTrip().days, 'sleep', {
        errorStructure: { tripVarianceFraction: 1, nightVarianceFraction: 1, hourVarianceFraction: 1 },
      }),
    );
    capture(() => parseForecast({ nonsense: true }));
    capture(() => checkErrorStructure({ tripVarianceFraction: -1, nightVarianceFraction: 1, hourVarianceFraction: 1 }));
    expect(messages.length).toBe(7);
    for (const m of messages) expect(m).not.toContain(EM_DASH);
    expect(new MissingHoursError('2026-11-13', 'sleep', ['2026-11-13T21:00']).message).not.toContain(EM_DASH);
    expect(new OpenMeteoShapeError('bad shape', 'hourly.time').message).not.toContain(EM_DASH);
    expect(
      new OpenMeteoApiError('upstream said no', 'https://api.open-meteo.com/v1/forecast', 400).message,
    ).not.toContain(EM_DASH);
  });

  it('does not cheat by substituting a lookalike dash', () => {
    const trip = forecastTrip();
    const prose = [trip.attribution, manualTrip().attribution, ...strings(api, '$api').map(([, s]) => s)];
    for (const s of prose) {
      expect(s).not.toMatch(/\S - \S/);
      expect(s).not.toMatch(/\s–\s/);
    }
  });
});

function manualTripOptions() {
  return {
    highC: 8,
    lowC: -6,
    dates: ['2026-11-13'],
    latitude: 35.6,
    longitude: -83.43,
    elevation: 1800,
  };
}
