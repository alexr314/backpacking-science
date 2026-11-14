import { describe, expect, it } from 'vitest';
import { sunTimes } from './solar.js';
import { loadFixture } from './fixtures.js';
import { parseLocal } from './localtime.js';

interface ForecastFixture {
  latitude: number;
  longitude: number;
  utc_offset_seconds: number;
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

describe('sunTimes', () => {
  it('reproduces Open-Meteo sunrise/sunset for the Smokies to within a few minutes', () => {
    const f = loadFixture<ForecastFixture>('forecast-smokies-elevation-1800.json');
    const offset = f.utc_offset_seconds / 3600;
    let worst = 0;
    for (let i = 0; i < f.daily.time.length; i++) {
      const got = sunTimes(f.daily.time[i]!, f.latitude, f.longitude, offset);
      const dRise = Math.abs(parseLocal(got.sunrise) - parseLocal(f.daily.sunrise[i]!));
      const dSet = Math.abs(parseLocal(got.sunset) - parseLocal(f.daily.sunset[i]!));
      worst = Math.max(worst, dRise, dSet);
    }
    // Open-Meteo also applies an elevation correction to the horizon; a couple of minutes is fine
    // when every phase window is quantised to the hour anyway.
    expect(worst).toBeLessThanOrEqual(4);
  });

  it('puts the solstice day length at the right extreme in both hemispheres', () => {
    const north = sunTimes('2026-06-21', 51.5, -0.13, 1); // London, BST
    const dayLength = (parseLocal(north.sunset) - parseLocal(north.sunrise)) / 60;
    expect(dayLength).toBeGreaterThan(16.5);
    expect(dayLength).toBeLessThan(17.0);

    const south = sunTimes('2026-06-21', -33.87, 151.21, 10); // Sydney, AEST
    const southLength = (parseLocal(south.sunset) - parseLocal(south.sunrise)) / 60;
    expect(southLength).toBeGreaterThan(9.5);
    expect(southLength).toBeLessThan(10.2);
  });

  it('flags polar night and polar day instead of returning nonsense', () => {
    const night = sunTimes('2026-12-21', 78.2, 15.6, 1); // Longyearbyen
    expect(night.polar).toBe(true);
    const day = sunTimes('2026-06-21', 78.2, 15.6, 2);
    expect(day.polar).toBe(true);
  });

  it('falls back to the longitudinal mean when no offset is given', () => {
    const withOffset = sunTimes('2026-11-13', 35.6, -83.43, -83.43 / 15);
    const without = sunTimes('2026-11-13', 35.6, -83.43);
    expect(without).toEqual(withOffset);
  });
});
