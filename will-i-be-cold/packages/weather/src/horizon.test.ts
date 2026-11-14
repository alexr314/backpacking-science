import { describe, expect, it } from 'vitest';
import { addDays, chooseHorizon, chooseHorizons, dateRange, DEFAULT_HORIZON } from './horizon.js';

describe('chooseHorizon', () => {
  const today = '2026-11-13';

  it('uses the forecast for today', () => {
    expect(chooseHorizon(today, today)).toMatchObject({ mode: 'forecast', daysOut: 0, reason: 'within-horizon' });
  });

  it('uses the forecast right up to the last day the API returns (today + 15)', () => {
    expect(chooseHorizon('2026-11-28', today)).toMatchObject({ mode: 'forecast', daysOut: 15 });
  });

  it('switches to climatology the very next day', () => {
    expect(chooseHorizon('2026-11-29', today)).toMatchObject({
      mode: 'climatology',
      daysOut: 16,
      reason: 'beyond-horizon',
    });
  });

  it('reports the last forecastable date for the UI', () => {
    expect(chooseHorizon('2027-01-01', today).lastForecastDate).toBe('2026-11-28');
  });

  it('treats past dates as climatology, explicitly', () => {
    expect(chooseHorizon('2026-11-12', today)).toMatchObject({ mode: 'climatology', daysOut: -1, reason: 'past' });
  });

  it('counts whole calendar days across a month boundary', () => {
    expect(chooseHorizon('2026-12-01', today).daysOut).toBe(18);
  });

  it('counts whole calendar days across a year boundary', () => {
    expect(chooseHorizon('2027-01-02', '2026-12-31').daysOut).toBe(2);
  });

  it('counts across a DST change without gaining or losing a day', () => {
    // US DST ends 2026-11-01. 2026-10-30 -> 2026-11-03 is four calendar days either way.
    expect(chooseHorizon('2026-11-03', '2026-10-30').daysOut).toBe(4);
  });

  it('honours an overridden horizon', () => {
    expect(chooseHorizon('2026-11-20', today, { hourlyForecastDays: 7 }).mode).toBe('climatology');
    expect(chooseHorizon('2026-11-19', today, { hourlyForecastDays: 7 }).mode).toBe('forecast');
  });

  it('rejects a nonsense horizon', () => {
    expect(() => chooseHorizon(today, today, { hourlyForecastDays: 0 })).toThrow(/positive integer/);
  });

  it('defaults to the empirically measured 16 days', () => {
    expect(DEFAULT_HORIZON.hourlyForecastDays).toBe(16);
  });
});

describe('chooseHorizons', () => {
  it('labels each day of a trip that straddles the horizon', () => {
    const trip = dateRange('2026-11-26', '2026-11-30');
    const modes = chooseHorizons(trip, '2026-11-13').map((d) => d.mode);
    expect(modes).toEqual(['forecast', 'forecast', 'forecast', 'climatology', 'climatology']);
  });
});

describe('date helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('builds inclusive ranges and rejects reversed ones', () => {
    expect(dateRange('2026-11-13', '2026-11-15')).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect(dateRange('2026-11-13', '2026-11-13')).toEqual(['2026-11-13']);
    expect(() => dateRange('2026-11-15', '2026-11-13')).toThrow(/before/);
  });
});
