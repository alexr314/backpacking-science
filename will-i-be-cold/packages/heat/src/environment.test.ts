import { describe, expect, it } from 'vitest';
import {
  LI_COIMBRA_NIGHT,
  MARTIN_BERDAHL_OPAQUE_FACTOR,
  OCCUPIED_DOUBLE_WALL_TENT_AIR_OFFSET_K,
  SHELTERS,
  netLongwaveToSky,
  operativeWeightingFactor,
  resolveEnvironment,
  skyTemperature,
} from './environment.js';

const night = (over: Partial<Parameters<typeof resolveEnvironment>[0]> = {}) =>
  resolveEnvironment({
    airTemperature: 10,
    relativeHumidity: 0.6,
    cloudCover: 0,
    windSpeed: 0.1,
    shelter: 'open',
    ...over,
  });

describe('clear-sky emissivity uses STANDARDS §6.4’s recommended model', () => {
  it('is Li, Jiang & Coimbra’s nighttime recalibration, not Swinbank or Brunt', () => {
    expect(LI_COIMBRA_NIGHT).toEqual({ a: 0.633, b: 0.057 });
    // STANDARDS §6.4 is blunt that Swinbank / Idso & Jackson "are not recommended for future use".
    const s = skyTemperature({ airTemperature: 10, relativeHumidity: 0.6, cloudCover: 0 });
    expect(s.clearSkyEmissivity).toBeGreaterThan(0.69);
    expect(s.clearSkyEmissivity).toBeLessThan(0.82);
  });

  it('puts the clear-sky depression in STANDARDS §6.5’s 15–27 K band', () => {
    for (const [t, rh] of [
      [10, 0.6],
      [0, 0.7],
      [-5, 0.7],
      [20, 0.5],
    ] as const) {
      const s = skyTemperature({ airTemperature: t, relativeHumidity: rh, cloudCover: 0 });
      expect(s.depressionK).toBeGreaterThan(12);
      expect(s.depressionK).toBeLessThan(30);
    }
  });

  it('rejects the "clear sky ≈ −70 °C" folklore (STANDARDS §7.3 item 18)', () => {
    const s = skyTemperature({ airTemperature: 0, relativeHumidity: 0.7, cloudCover: 0 });
    expect(s.skyTemperatureC).toBeGreaterThan(-40);
  });

  it('is monotone in cloud cover and nearly cancelled by full overcast', () => {
    const clear = skyTemperature({ airTemperature: 10, relativeHumidity: 0.6, cloudCover: 0 });
    const half = skyTemperature({ airTemperature: 10, relativeHumidity: 0.6, cloudCover: 0.5 });
    const overcast = skyTemperature({ airTemperature: 10, relativeHumidity: 0.6, cloudCover: 1 });
    expect(half.depressionK).toBeLessThan(clear.depressionK);
    expect(overcast.depressionK).toBeLessThan(half.depressionK);
    // STANDARDS §6.6: full opaque overcast removes ~80–85 % of the clear-sky penalty.
    expect(1 - overcast.depressionK / clear.depressionK).toBeGreaterThan(0.7);
    expect(MARTIN_BERDAHL_OPAQUE_FACTOR).toBe(0.784);
  });

  it('exposes the EnergyPlus cloud form too, and it really is much weaker (§6.6, unresolved)', () => {
    const mb = skyTemperature({
      airTemperature: 10,
      relativeHumidity: 0.6,
      cloudCover: 1,
      cloudModel: 'martin-berdahl',
    });
    const ep = skyTemperature({
      airTemperature: 10,
      relativeHumidity: 0.6,
      cloudCover: 1,
      cloudModel: 'energyplus',
    });
    expect(ep.depressionK).toBeGreaterThan(mb.depressionK * 2);
  });

  it('keeps Berdahl & Martin as a dew-point cross-check and warns outside its stated range', () => {
    const s = skyTemperature({
      airTemperature: -30,
      relativeHumidity: 0.5,
      cloudCover: 0,
      model: 'berdahl-martin',
    });
    expect(s.warnings.map((w) => w.code)).toContain('sky_berdahl_martin_out_of_range');
  });
});

describe('STANDARDS §6.8’s headline number', () => {
  it('a clear night in the open costs roughly 5–6 K of operative temperature', () => {
    const env = night();
    expect(env.airTemperatureC - env.operativeTemperatureC).toBeGreaterThan(3.5);
    expect(env.airTemperatureC - env.operativeTemperatureC).toBeLessThan(8);
    // and ~9–11 K of mean radiant temperature
    expect(-env.radiantOffsetK).toBeGreaterThan(7);
    expect(-env.radiantOffsetK).toBeLessThan(14);
  });

  it('and the same night overcast costs almost nothing', () => {
    const overcast = night({ cloudCover: 1 });
    expect(overcast.airTemperatureC - overcast.operativeTemperatureC).toBeLessThan(1.5);
  });

  it('wind collapses the radiant penalty on operative temperature (η/(1+η), §6.8)', () => {
    const still = night({ windSpeed: 0.1 });
    const windy = night({ windSpeed: 8 });
    const stillPenalty = still.airTemperatureC - still.operativeTemperatureC;
    const windyPenalty = windy.airTemperatureC - windy.operativeTemperatureC;
    expect(windyPenalty).toBeLessThan(stillPenalty);
  });
});

describe('shelters', () => {
  it('🔴 a tent is modelled COLDER than ambient air, which is what was measured (§6.10)', () => {
    const env = night({ shelter: 'tent' });
    expect(SHELTERS.tent.airOffsetK).toBe(-1.0);
    expect(env.airTemperatureC).toBeCloseTo(9.0, 6);
    expect(env.caveats.join(' ')).toMatch(/below\s+ambient|\*below\*/i);
  });

  it('…but it removes essentially all of the radiant penalty, which is its real benefit', () => {
    const open = night({ shelter: 'open' });
    const tent = night({ shelter: 'tent' });
    expect(Math.abs(tent.radiantOffsetK)).toBeLessThan(0.2);
    expect(Math.abs(open.radiantOffsetK)).toBeGreaterThan(5);
    // Net: operative temperature inside the tent still beats the open sky.
    expect(tent.operativeTemperatureC).toBeGreaterThan(open.operativeTemperatureC);
  });

  it('offers Seeber’s occupied-tent offset as an explicit opt-in, not the default', () => {
    const occupied = night({ shelter: 'tent', occupiedTent: true });
    expect(OCCUPIED_DOUBLE_WALL_TENT_AIR_OFFSET_K).toBe(1.1);
    expect(occupied.airTemperatureC).toBeCloseTo(11.1, 6);
  });

  it('forest keeps the radiant benefit and models wind separately from air temperature', () => {
    const forest = night({ shelter: 'forest', windSpeed: 5 });
    const open = night({ shelter: 'open', windSpeed: 5 });
    expect(Math.abs(forest.radiantOffsetK)).toBeLessThan(Math.abs(open.radiantOffsetK));
    expect(forest.airVelocity).toBeLessThan(open.airVelocity);
    // Karlsson (2000): forest air can be colder; we do NOT fold that into one warm offset.
    expect(SHELTERS.forest.airOffsetK).toBe(0);
  });

  it('sky view factor is monotone in the radiant penalty', () => {
    let previous = -Infinity;
    for (const svf of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const env = night({ skyViewFactorOverride: svf });
      expect(-env.radiantOffsetK).toBeGreaterThan(previous);
      previous = -env.radiantOffsetK;
    }
  });
});

describe('operative temperature', () => {
  it('reproduces the ASHRAE 55-2023 / ISO 7730 A-table', () => {
    expect(operativeWeightingFactor(0.1)).toBe(0.5);
    expect(operativeWeightingFactor(0.4)).toBe(0.6);
    expect(operativeWeightingFactor(0.8)).toBe(0.7);
    // Above 1.0 m/s the published table stops; we say so rather than extrapolating it.
    expect(Number.isNaN(operativeWeightingFactor(3))).toBe(true);
  });

  it('flags that the A-table ceiling has been passed', () => {
    const env = night({ windSpeed: 6 });
    expect(env.caveats.join(' ')).toMatch(/A-table/);
  });

  it('is bounded by air and radiant temperature', () => {
    const env = night();
    const lo = Math.min(env.airTemperatureC, env.meanRadiantTemperatureC);
    const hi = Math.max(env.airTemperatureC, env.meanRadiantTemperatureC);
    expect(env.operativeTemperatureC).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(env.operativeTemperatureC).toBeLessThanOrEqual(hi + 1e-9);
  });
});

describe('solar', () => {
  it('warms mean radiant temperature when the forecast reports shortwave, and says it is estimated', () => {
    const dark = resolveEnvironment({
      airTemperature: 0,
      relativeHumidity: 0.6,
      cloudCover: 0.2,
      windSpeed: 2,
      shortwaveRadiation: null,
    });
    const sunny = resolveEnvironment({
      airTemperature: 0,
      relativeHumidity: 0.6,
      cloudCover: 0.2,
      windSpeed: 2,
      shortwaveRadiation: 400,
    });
    expect(sunny.meanRadiantTemperatureC).toBeGreaterThan(dark.meanRadiantTemperatureC + 5);
    expect(sunny.caveats.join(' ')).toMatch(/estimated projected-area fraction/);
  });
});

describe('diagnostics', () => {
  it('net longwave to a clear sky is in the measured ballpark (STANDARDS §6.5)', () => {
    const s = skyTemperature({ airTemperature: 0, relativeHumidity: 0.7, cloudCover: 0 });
    const net = netLongwaveToSky(0, s.skyTemperatureC);
    // FAO: −80 W/m² typical on a radiation-frost night over the half-sky view factor.
    expect(net).toBeGreaterThan(30);
    expect(net).toBeLessThan(80);
  });
});
