import { describe as vDescribe, expect, it } from 'vitest';
import { describe as summarise, mean, quantile, sd, Z90, Z95 } from './stats.js';

vDescribe('quantile', () => {
  it('matches the linear-interpolation (numpy default) convention', () => {
    const xs = [1, 2, 3, 4];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(4);
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(quantile(xs, 0.1)).toBeCloseTo(1.3, 10);
    expect(quantile(xs, 0.9)).toBeCloseTo(3.7, 10);
  });

  it('handles a single sample', () => {
    expect(quantile([7], 0.1)).toBe(7);
  });

  it('rejects an empty sample and an out-of-range q', () => {
    expect(() => quantile([], 0.5)).toThrow(/empty/);
    expect(() => quantile([1], 1.5)).toThrow(/\[0,1\]/);
  });
});

vDescribe('sd / mean', () => {
  it('uses the n-1 sample standard deviation', () => {
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
    expect(mean([2, 4, 6])).toBe(4);
  });
  it('returns 0 for a single sample rather than NaN', () => {
    expect(sd([3])).toBe(0);
  });
});

vDescribe('describe (the quadrature combination)', () => {
  const sample = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('summarises without widening when there is no uncertainty', () => {
    const d = summarise(sample);
    expect(d.p50).toBe(5);
    expect(d.min).toBe(0);
    expect(d.max).toBe(10);
    expect(d.mean).toBe(5);
    expect(d.sd).toBeCloseTo(sd(sample), 12);
  });

  it('adds the two independent spreads in quadrature', () => {
    const within = sd(sample);
    const d = summarise(sample, 4);
    expect(d.sd).toBeCloseTo(Math.sqrt(within * within + 16), 12);
    expect(d.sd).toBeGreaterThan(within);
    expect(d.sd).toBeLessThan(within + 4); // strictly less than adding linearly
  });

  it('pushes p10/p90 out by Z90 sds and min/max by Z95, leaving the centre alone', () => {
    const plain = summarise(sample);
    const wide = summarise(sample, 2);
    expect(wide.p10).toBeCloseTo(plain.p10 - Z90 * 2, 10);
    expect(wide.p90).toBeCloseTo(plain.p90 + Z90 * 2, 10);
    expect(wide.min).toBeCloseTo(plain.min - Z95 * 2, 10);
    expect(wide.max).toBeCloseTo(plain.max + Z95 * 2, 10);
    expect(wide.p50).toBe(plain.p50);
    expect(wide.mean).toBe(plain.mean);
  });

  it('refuses a non-finite sample value rather than producing NaN', () => {
    expect(() => summarise([1, Number.NaN])).toThrow(/non-finite/);
    expect(() => summarise([1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
  });

  it('refuses a negative or non-finite uncertainty', () => {
    expect(() => summarise([1, 2], -1)).toThrow(/non-negative/);
    expect(() => summarise([1, 2], Number.NaN)).toThrow(/non-negative/);
  });

  it('refuses an empty sample', () => {
    expect(() => summarise([])).toThrow(/empty/);
  });
});
