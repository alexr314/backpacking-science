/**
 * Decoding a trail and addressing a position on it. The fixture is synthetic on purpose: these
 * are properties of the arithmetic, not of the Appalachian Trail, and a test that needs a 1 MB
 * asset to run is a test nobody runs.
 */
import { describe, expect, it } from 'vitest';
import { decodeTrail, haversine, nearestAlong, pointAt, reliefBetween, TrailDataError, type TrailAsset } from './trail.js';

/** A straight line due north from 35 N, climbing 100 m per step, delta-encoded as the tool emits. */
function fixture(steps = 5): TrailAsset {
  const lon: number[] = [];
  const lat: number[] = [];
  const ele: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    lon.push(i === 0 ? -8300000 : 0);
    lat.push(i === 0 ? 3500000 : 1000);
    ele.push(i === 0 ? 500 : 100);
  }
  return {
    slug: 'test', name: 'Test Trail', from: 'A', to: 'B', metres: 0, points: steps + 1, toleranceM: 10,
    osmRelation: 1, osmSnapshot: 'x', built: 'x',
    licence: { centreline: 'x', elevation: 'x' }, encoding: 'delta', lon, lat, ele,
  };
}

describe('decodeTrail', () => {
  it('undoes the delta encoding', () => {
    const t = decodeTrail(fixture());
    expect(t.lon[0]).toBeCloseTo(-83, 6);
    expect(t.lat[0]).toBeCloseTo(35, 6);
    expect(t.lat[1]).toBeCloseTo(35.01, 6);
    expect(t.ele[0]).toBe(500);
    expect(t.ele[5]).toBe(1000);
  });

  it('builds a monotone cumulative distance', () => {
    const t = decodeTrail(fixture());
    expect(t.along[0]).toBe(0);
    for (let i = 1; i < t.along.length; i += 1) expect(t.along[i]!).toBeGreaterThan(t.along[i - 1]!);
    // 0.01 degrees of latitude is about 1.11 km
    expect(t.along[1]!).toBeCloseTo(1111, -1);
    expect(t.metres).toBeCloseTo(t.along[5]!, 9);
  });

  it('refuses a trail it cannot use', () => {
    expect(() => decodeTrail({ ...fixture(), lon: [1], lat: [1], ele: [1] })).toThrow(TrailDataError);
    expect(() => decodeTrail({ ...fixture(), ele: [1, 2] })).toThrow(TrailDataError);
  });
});

describe('pointAt', () => {
  it('interpolates between the points either side', () => {
    const t = decodeTrail(fixture());
    const half = pointAt(t, t.along[1]! / 2);
    expect(half.elevation).toBeCloseTo(550, 0);
    expect(half.latitude).toBeCloseTo(35.005, 4);
  });

  it('clamps to the ends', () => {
    const t = decodeTrail(fixture());
    expect(pointAt(t, -500).along).toBe(0);
    expect(pointAt(t, 1e9).along).toBeCloseTo(t.metres, 6);
    expect(pointAt(t, 1e9).elevation).toBe(1000);
  });

  it('agrees with the index it was built from', () => {
    const t = decodeTrail(fixture());
    for (let i = 0; i < 6; i += 1) {
      expect(pointAt(t, t.along[i]!).elevation).toBeCloseTo(t.ele[i]!, 6);
    }
  });
});

describe('reliefBetween', () => {
  it('adds up a pure climb', () => {
    const t = decodeTrail(fixture());
    const r = reliefBetween(t, 0, t.metres);
    expect(r.climb).toBeCloseTo(500, 6);
    expect(r.descent).toBeCloseTo(0, 6);
  });

  it('is the same either way round, since it is about the ground not the walk', () => {
    const t = decodeTrail(fixture());
    const a = reliefBetween(t, 1000, 4000);
    const b = reliefBetween(t, 4000, 1000);
    expect(a.climb).toBeCloseTo(b.climb, 6);
  });

  it('counts both directions on a profile that goes over a top', () => {
    const asset = fixture();
    const ele = [...asset.ele];
    ele[4] = -100;
    ele[5] = -100;
    const t = decodeTrail({ ...asset, ele });
    const r = reliefBetween(t, 0, t.metres);
    expect(r.climb).toBeCloseTo(300, 6);
    expect(r.descent).toBeCloseTo(200, 6);
  });
});

describe('nearestAlong', () => {
  it('snaps a pin to the trail', () => {
    const t = decodeTrail(fixture());
    const p = nearestAlong(t, -83.02, 35.0301);
    expect(p.along).toBeCloseTo(t.along[3]!, 0);
  });
});

describe('haversine', () => {
  it('matches a known degree of latitude', () => {
    // one degree of latitude is 111.19 km on a sphere of this radius
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111195, -2);
  });
  it('is zero for a point against itself', () => {
    expect(haversine(-83, 35, -83, 35)).toBe(0);
  });
});
