/**
 * The encounter probability curve beside the thermometer, and the cold-risk curve that prices
 * a gap.
 *
 *   P_encounter(T) = P(the temperature passes through T at some point in the phase)
 *   P_cold(T)      = P(the phase's minimum is at or below T)
 *
 * Neither is a distribution. `P_encounter` is a probability *per temperature*, each value
 * independently in [0, 1]; a single evening passes through many temperatures, so it is near
 * 1 across the bulk of the evening's range (a mesa), falling off at the cold end and the warm
 * end. It is never normalised and never stacked. `P_cold` is monotone and saturating, and is
 * what answers "how likely is it to get colder than my gear can handle".
 *
 * THE SEAM. The chart and the headline consume `EncounterCurves` and nothing else. These come
 * from the weather package's seeded Monte Carlo over a fitted ARMA(1,1) plus diurnal-harmonic
 * forecast-error process. The old `deriveEncounter` placeholder has been removed: it modelled
 * the window error as one normal shift, which cannot saturate the way a real encounter curve
 * does, and its hand-rolled normal CDF was wrong by up to 0.08 in probability.
 */

import {
  aggregatePhase,
  type DayWeather,
  type EncounterCurve,
  type PhaseDistribution,
  type PhaseName,
} from '@will-i-be-cold/weather';

export interface CurvePoint {
  readonly tC: number;
  /** A probability, 0..1. */
  readonly p: number;
}

export interface EncounterCurves {
  /** P(the temperature passes through T), sampled on a fine grid of °C, cold to warm. */
  readonly encounter: readonly CurvePoint[];
  /** P(the phase's minimum is at or below T), same grid. Monotone, saturating. */
  readonly coldRisk: readonly CurvePoint[];
  readonly source: 'measured';
  /**
   * How many nights were pooled. One for the per-night view. Pooling more nights widens the
   * mesa, because the trip visits more temperatures than any single evening does.
   */
  readonly nights: number;
}

/**
 * The standard normal CDF, via the Abramowitz and Stegun 7.1.26 approximation to erf.
 *
 * Note the `/ Math.SQRT2`. A and S 7.1.26 approximates **erf**, and `Phi(z) = (1 + erf(z/sqrt2))/2`.
 * An earlier copy of this fed `z` straight in, which overstated `Phi(1)` as 0.921 against a true
 * 0.841: an error of 0.08 in probability, hidden behind a comment advertising 1.5e-7. The weather
 * package had the same slip in its own copy. If you touch this, keep the test that pins it.
 */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/**
 * The real curves, from the weather package's seeded Monte Carlo over a fitted ARMA(1,1) plus
 * diurnal-harmonic forecast-error process. Pass one day for tonight, or the whole trip for the
 * pooled view; the return shape is identical either way.
 */
export function encounterFrom(days: readonly DayWeather[], phase: PhaseName): EncounterCurves {
  const dist = aggregatePhase(days, phase);
  return { ...fromEncounterCurve(dist.encounter), nights: dist.nights };
}

/** The curves of a distribution already aggregated (`phaseDistributions`' `overall` or one of its `byNight`). */
export function encounterOf(dist: PhaseDistribution): EncounterCurves {
  return { ...fromEncounterCurve(dist.encounter), nights: dist.nights };
}

function fromEncounterCurve(c: EncounterCurve): Omit<EncounterCurves, 'nights'> {
  const encounter: CurvePoint[] = [];
  const coldRisk: CurvePoint[] = [];
  for (let i = 0; i < c.temperaturesC.length; i += 1) {
    const tC = c.temperaturesC[i];
    if (tC === undefined) continue;
    encounter.push({ tC, p: c.encounter[i] ?? 0 });
    coldRisk.push({ tC, p: c.coldRisk[i] ?? 0 });
  }
  return { encounter, coldRisk, source: 'measured' };
}

/** Linear interpolation on a curve; clamps to the ends outside the grid. */
export function curveAt(curve: readonly CurvePoint[], tC: number): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (tC <= first.tC) return first.p;
  if (tC >= last.tC) return last.p;
  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid]!.tC <= tC) lo = mid;
    else hi = mid;
  }
  const a = curve[lo]!;
  const b = curve[hi]!;
  const u = (tC - a.tC) / (b.tC - a.tC);
  return a.p + (b.p - a.p) * u;
}
