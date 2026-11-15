/**
 * Tobler's hiking function, pinned to the paper, and the integrals built on it.
 *
 * Tobler, W. (1993), "Three presentations on geographical analysis and modeling", NCGIA
 * Technical Report 93-1, §1: W = 6 exp(-3.5 |S + 0.05|) km/h.
 */
import { describe, expect, it } from 'vitest';
import { advance, DEFAULT_PACE, elevationAt, FASTEST_SLOPE, fitnessFor, TOBLER_PEAK, toblerSpeed, walkSeconds, type Profile } from './pace.js';

const kmh = (ms: number): number => (ms * 3600) / 1000;

describe('Tobler', () => {
  it('walks the flat at 5.04 km/h', () => {
    // 6 exp(-0.175) = 5.0366
    expect(kmh(toblerSpeed(0))).toBeCloseTo(5.0366, 3);
  });

  it('peaks at a 5% descent, not on the flat', () => {
    expect(kmh(TOBLER_PEAK)).toBeCloseTo(6, 10);
    expect(FASTEST_SLOPE).toBe(-0.05);
    expect(toblerSpeed(FASTEST_SLOPE)).toBeGreaterThan(toblerSpeed(0));
  });

  it('is slower uphill than downhill at the same gradient', () => {
    for (const s of [0.1, 0.2, 0.3]) {
      expect(toblerSpeed(s)).toBeLessThan(toblerSpeed(-s));
    }
  });

  it('punishes a steep descent too, which is the point of preferring it to Naismith', () => {
    // Naismith unmodified would call any descent free; Tobler has -0.4 slower than the flat
    expect(toblerSpeed(-0.4)).toBeLessThan(toblerSpeed(0));
  });

  it('falls off either side of the peak monotonically', () => {
    const up = [0, 0.05, 0.1, 0.2, 0.4].map((s) => toblerSpeed(FASTEST_SLOPE + s));
    const down = [0, 0.05, 0.1, 0.2, 0.4].map((s) => toblerSpeed(FASTEST_SLOPE - s));
    for (let i = 1; i < up.length; i += 1) {
      expect(up[i]!).toBeLessThan(up[i - 1]!);
      expect(down[i]!).toBeLessThan(down[i - 1]!);
    }
  });
});

describe('fitnessFor', () => {
  it('turns a remembered day into the one number the model needs', () => {
    // 12 miles, 3000 ft of climb, 7 hours: a normal loaded day
    const f = fitnessFor(12 * 1609.344, 3000 * 0.3048, 7 * 3600);
    expect(f).toBeGreaterThan(0.4);
    expect(f).toBeLessThan(1);
  });

  it('is monotone in the time taken', () => {
    const d = 20000;
    const c = 800;
    expect(fitnessFor(d, c, 5 * 3600)).toBeGreaterThan(fitnessFor(d, c, 8 * 3600));
  });

  it('falls back rather than dividing by zero', () => {
    expect(fitnessFor(0, 0, 3600)).toBe(DEFAULT_PACE.fitness);
    expect(fitnessFor(1000, 0, 0)).toBe(DEFAULT_PACE.fitness);
  });
});

/** A profile that climbs 500 m over 10 km and comes back down over the next 10 km. */
const hill: Profile = {
  along: [0, 5000, 10000, 15000, 20000],
  ele: [200, 450, 700, 450, 200],
};

describe('walkSeconds', () => {
  it('takes longer up the hill than down it', () => {
    // the same half of the profile, walked each way: out climbs 200 to 700, back descends it
    const up = walkSeconds(hill, 0, 10000, 1);
    const down = walkSeconds(hill, 10000, 0, 1);
    expect(up).toBeGreaterThan(down);
  });

  it('is not the same walked backwards, which Naismith would miss', () => {
    const there = walkSeconds(hill, 0, 20000, 1);
    const back = walkSeconds(hill, 20000, 0, 1);
    // symmetric profile walked either way is the same here, so check an asymmetric span
    expect(there).toBeCloseTo(back, 6);
    expect(walkSeconds(hill, 0, 10000, 1)).not.toBeCloseTo(walkSeconds(hill, 10000, 0, 1), 1);
  });

  it('scales inversely with fitness', () => {
    expect(walkSeconds(hill, 0, 20000, 0.5)).toBeCloseTo(2 * walkSeconds(hill, 0, 20000, 1), 6);
  });

  it('adds up over a split', () => {
    const whole = walkSeconds(hill, 0, 20000, 0.7);
    const parts = walkSeconds(hill, 0, 7000, 0.7) + walkSeconds(hill, 7000, 20000, 0.7);
    expect(parts).toBeCloseTo(whole, 6);
  });

  it('is zero over no distance', () => {
    expect(walkSeconds(hill, 8000, 8000, 1)).toBe(0);
  });
});

describe('advance', () => {
  it('inverts walkSeconds', () => {
    for (const target of [3000, 9000, 15000, 19000]) {
      const t = walkSeconds(hill, 0, target, 0.65);
      expect(advance(hill, 0, t, true, 0.65)).toBeCloseTo(target, 0);
    }
  });

  it('inverts it backwards too', () => {
    const t = walkSeconds(hill, 18000, 6000, 0.65);
    expect(advance(hill, 18000, t, false, 0.65)).toBeCloseTo(6000, 0);
  });

  it('stops at the end of the trail rather than running past it', () => {
    expect(advance(hill, 0, 100 * 3600, true, 1)).toBe(20000);
    expect(advance(hill, 20000, 100 * 3600, false, 1)).toBe(0);
  });
});

describe('elevationAt', () => {
  it('interpolates between samples', () => {
    expect(elevationAt(hill, 2500)).toBeCloseTo(325, 6);
  });
  it('clamps outside the profile', () => {
    expect(elevationAt(hill, -100)).toBe(200);
    expect(elevationAt(hill, 99999)).toBe(200);
  });
});
