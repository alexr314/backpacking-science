/** Small, dependency-free summary statistics. All functions reject empty input loudly. */

import type { Distribution } from './types.js';

/**
 * Linear-interpolated quantile (the "type 7" / `numpy.percentile` default).
 * Chosen because it is the convention every reviewer will reach for, and because with
 * only ~3–9 hourly samples per phase the nearest-rank alternative is visibly chunky.
 */
export function quantile(sortedAscending: readonly number[], q: number): number {
  const n = sortedAscending.length;
  if (n === 0) throw new RangeError('quantile of an empty sample');
  if (!(q >= 0 && q <= 1)) throw new RangeError(`quantile q must be in [0,1], got ${q}`);
  if (n === 1) return sortedAscending[0]!;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAscending[lo]!;
  return sortedAscending[lo]! + (pos - lo) * (sortedAscending[hi]! - sortedAscending[lo]!);
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('mean of an empty sample');
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** Sample (n−1) standard deviation; 0 for a single sample. */
export function sd(xs: readonly number[]): number {
  const n = xs.length;
  if (n === 0) throw new RangeError('sd of an empty sample');
  if (n === 1) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / (n - 1));
}

/** z for the 90th percentile of a standard normal: the half-width of a p10..p90 band in sds. */
export const Z90 = 1.2815515655446004;
/** z for the 95th percentile: used to widen `min`/`max` rather than the quantiles. */
export const Z95 = 1.6448536269514722;

/**
 * Summarise a sample, optionally widening it by an independent uncertainty.
 *
 * `uncertaintySd` is the standard deviation of an error that applies to the *whole window*
 * (e.g. "the model's day-7 temperature is off by 2.8 °C"), independent of the within-window
 * spread. Combining the two:
 *
 *  - `sd` adds them in quadrature: sqrt(sd_within² + sd_uncertainty²).
 *  - `p10`/`p90` shift outwards by Z90·sd_uncertainty. (Convolving the empirical hourly
 *    distribution with a Gaussian exactly would need the full convolution; shifting the
 *    quantiles is the standard conservative approximation and is exact when the hourly
 *    sample is itself Gaussian.)
 *  - `min`/`max` shift outwards by Z95·sd_uncertainty.
 *  - `mean` and `p50` are unchanged: the error model is unbiased by construction.
 */
export function describe(sample: readonly number[], uncertaintySd = 0): Distribution {
  if (sample.length === 0) throw new RangeError('describe() of an empty sample');
  if (!Number.isFinite(uncertaintySd) || uncertaintySd < 0) {
    throw new RangeError(`uncertaintySd must be a non-negative finite number, got ${uncertaintySd}`);
  }
  for (const x of sample) {
    if (!Number.isFinite(x)) throw new RangeError(`non-finite value in sample: ${x}`);
  }
  const sorted = [...sample].sort((a, b) => a - b);
  const within = sd(sorted);
  return {
    p10: quantile(sorted, 0.1) - Z90 * uncertaintySd,
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9) + Z90 * uncertaintySd,
    min: sorted[0]! - Z95 * uncertaintySd,
    max: sorted[sorted.length - 1]! + Z95 * uncertaintySd,
    mean: mean(sorted),
    sd: Math.sqrt(within * within + uncertaintySd * uncertaintySd),
  };
}
