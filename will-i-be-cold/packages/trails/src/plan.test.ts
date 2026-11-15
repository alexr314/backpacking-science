/**
 * Planning a walk: the properties that have to hold whatever the trail looks like.
 */
import { describe, expect, it } from 'vitest';
import { decodeTrail, type TrailAsset } from './trail.js';
import { forecastPoints, planRoute, RoutePlanError } from './plan.js';
import { DEFAULT_PACE } from './pace.js';

/** 60 km of trail running north, rolling between 500 m and 1,500 m. */
function trail(): ReturnType<typeof decodeTrail> {
  const n = 60;
  const lon: number[] = [];
  const lat: number[] = [];
  const ele: number[] = [];
  let prevE = 0;
  for (let i = 0; i <= n; i += 1) {
    lon.push(i === 0 ? -8300000 : 0);
    lat.push(i === 0 ? 3500000 : 900);
    const e = Math.round(1000 + 500 * Math.sin(i / 4));
    ele.push(i === 0 ? e : e - prevE);
    prevE = e;
  }
  const asset: TrailAsset = {
    slug: 'test', name: 'Test Trail', from: 'South', to: 'North', metres: 0, points: n + 1, toleranceM: 10,
    osmRelation: 1, osmSnapshot: 'x', built: 'x',
    licence: { centreline: 'x', elevation: 'x' }, encoding: 'delta', lon, lat, ele,
  };
  return decodeTrail(asset);
}

const spec = { startM: 0, endM: 0, startDate: '2026-11-16', startHour: 8, pace: DEFAULT_PACE };

describe('planRoute', () => {
  it('covers exactly the ground asked for', () => {
    const t = trail();
    const p = planRoute(t, { ...spec, endM: 40000 });
    expect(p.distance).toBeCloseTo(40000, 6);
    const walked = p.days.reduce((s, d) => s + d.distance, 0);
    expect(walked).toBeCloseTo(40000, 0);
    expect(p.days[0]!.start.along).toBeCloseTo(0, 6);
    expect(p.days[p.days.length - 1]!.camp.along).toBeCloseTo(40000, 0);
  });

  it('hands each day off to the next without a gap', () => {
    const p = planRoute(trail(), { ...spec, endM: 50000 });
    for (let i = 1; i < p.days.length; i += 1) {
      expect(p.days[i]!.start.along).toBeCloseTo(p.days[i - 1]!.camp.along, 6);
    }
  });

  it('dates the days consecutively from the start', () => {
    const p = planRoute(trail(), { ...spec, endM: 50000 });
    expect(p.days[0]!.date).toBe('2026-11-16');
    expect(p.days[1]!.date).toBe('2026-11-17');
    expect(p.nights).toBe(p.days.length - 1);
  });

  it('only the last day arrives, and it is the short one', () => {
    const p = planRoute(trail(), { ...spec, endM: 50000 });
    expect(p.days.filter((d) => d.arrives)).toHaveLength(1);
    expect(p.days[p.days.length - 1]!.arrives).toBe(true);
    for (const d of p.days.slice(0, -1)) {
      expect(d.movingSeconds).toBeCloseTo(DEFAULT_PACE.movingHoursPerDay * 3600, 6);
    }
  });

  it('walks further per day when the walker is faster', () => {
    const t = trail();
    const slow = planRoute(t, { ...spec, endM: 50000, pace: { ...DEFAULT_PACE, fitness: 0.4 } });
    const fast = planRoute(t, { ...spec, endM: 50000, pace: { ...DEFAULT_PACE, fitness: 0.9 } });
    expect(fast.days.length).toBeLessThan(slow.days.length);
    expect(fast.days[0]!.distance).toBeGreaterThan(slow.days[0]!.distance);
  });

  it('knows which way it is going, and the ground is the same either way', () => {
    const t = trail();
    const north = planRoute(t, { ...spec, startM: 5000, endM: 45000 });
    const south = planRoute(t, { ...spec, startM: 45000, endM: 5000 });
    expect(north.direction).toBe('northbound');
    expect(south.direction).toBe('southbound');
    expect(north.distance).toBeCloseTo(south.distance, 6);
    // climb one way is descent the other
    expect(north.climb).toBeCloseTo(south.climb, 6);
  });

  it('puts the midday point between the day start and camp', () => {
    const p = planRoute(trail(), { ...spec, endM: 50000 });
    for (const d of p.days) {
      const lo = Math.min(d.start.along, d.camp.along);
      const hi = Math.max(d.start.along, d.camp.along);
      expect(d.midday.along).toBeGreaterThanOrEqual(lo - 1);
      expect(d.midday.along).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('gives every day a real elevation, which is the point of the exercise', () => {
    const p = planRoute(trail(), { ...spec, endM: 50000 });
    const heights = p.days.map((d) => Math.round(d.camp.elevation));
    expect(new Set(heights).size).toBeGreaterThan(1);
    for (const h of heights) expect(h).toBeGreaterThan(400);
  });

  it('refuses a route it cannot plan', () => {
    const t = trail();
    expect(() => planRoute(t, { ...spec, endM: 0 })).toThrow(RoutePlanError);
    expect(() => planRoute(t, { ...spec, startM: -1, endM: 1000 })).toThrow(RoutePlanError);
    expect(() => planRoute(t, { ...spec, endM: t.metres + 1 })).toThrow(RoutePlanError);
    expect(() => planRoute(t, { ...spec, endM: 1000, pace: { ...DEFAULT_PACE, fitness: 0 } })).toThrow(RoutePlanError);
  });
});

describe('forecastPoints', () => {
  it('asks for two points a day, camps first', () => {
    const p = planRoute(trail(), { ...spec, endM: 40000 });
    const pts = forecastPoints(p);
    expect(pts).toHaveLength(p.days.length * 2);
    expect(pts[0]!.along).toBeCloseTo(p.days[0]!.camp.along, 6);
  });
});
