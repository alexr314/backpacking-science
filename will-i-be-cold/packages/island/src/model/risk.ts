/**
 * The risk the headline quotes, and the one threshold it is quoted at.
 *
 * THE BUG THIS FIXES. A phase tab shows the trip pooled, or one of its nights. The engine's
 * comfort limit for the warmest thing you own moves with each scope's wind, cloud and
 * humidity: on the fixture's camp morning the per-night limits were 3.8, 2.1 and −12.2 °F
 * against a pooled 2.3 °F, because the third night is calm and clear and the same kit holds
 * fourteen degrees colder. Each tab was quoting a probability at a *different* temperature,
 * so "45 % for the trip" sat beside "8 %, 15 %, 7 %" for its nights and the client, rightly,
 * said that cannot be: the pooled risk is a union over the nights and can never exceed their
 * sum.
 *
 * THE RULE. Within a phase the trip-level (pooled) comfort limit is the anchor, and every
 * figure, pooled or per night, is the cold-risk curve read at that one temperature. Then
 * stepping through the nights compares like with like, and the union bound is a property of
 * the numbers rather than a hope:
 *
 *     max_n P(min_n <= T)  <=  P(min_trip <= T)  <=  sum_n P(min_n <= T)
 *
 * `checkUnionBound` asserts exactly that, with a tolerance for the Monte Carlo behind the
 * curves (4 000 draws: a standard error of about 0.008 at p = 0.5). The per-night limit is
 * still shown, as the secondary fact it is ("on a calm, clear night your kit holds to −12 °F");
 * it just no longer moves the number being compared.
 *
 * THE HEADLINE METRIC. "100 % covered" measured the share of the p10 to p90 band some
 * configuration covers, so a tail below p10 counted for nothing and the tick sat above a 37 %
 * chance of being too cold. The honest headline is a probability: the chance you are
 * comfortable, `1 − P(colder than the kit handles) − P(warmer than the lightest outfit, fully
 * open)`, so the three numbers on screen are one statement. The tick is kept only while the
 * cold risk is at most `TICK_MAX_COLD_RISK`.
 *
 * Every probability here is the weather package's own curve read by its own readers; nothing
 * is re-derived.
 */

import type { PhaseCoverage, Span } from '@will-i-be-cold/heat';
import { coldRiskProbability, warmRiskProbability, type PhaseDistribution } from '@will-i-be-cold/weather';

// ---------------------------------------------------------------------------------------------
// The anchor: where the kit runs out, for the scope that sets the threshold
// ---------------------------------------------------------------------------------------------

/** The two temperatures a phase's risk is measured at, °C. Fixed for the phase across every scope. */
export interface Anchor {
  /** The comfort limit of the warmest configuration the engine built; `null` when it built none. */
  readonly coldC: number | null;
  /** The warm limit of the lightest configuration, fully open; `null` when open-ended or none. */
  readonly warmC: number | null;
}

/** Where the warmest thing you own runs out: the coldest comfort limit among the candidates. */
export function kitColdLimitC(phase: PhaseCoverage): number | null {
  const colds = phase.candidates.map((c) => c.assessment.comfort.coldLimitC).filter((x) => Number.isFinite(x));
  return colds.length === 0 ? null : Math.min(...colds);
}

/** Where the lightest thing you own, fully open, becomes too warm; `null` when any candidate is open-ended. */
export function kitWarmLimitC(phase: PhaseCoverage): number | null {
  if (phase.candidates.length === 0) return null;
  const warms: number[] = [];
  for (const c of phase.candidates) {
    const w = c.assessment.comfort.warmLimitC;
    if (w === null) return null;
    warms.push(w);
  }
  return Math.max(...warms);
}

export function anchorOf(phase: PhaseCoverage): Anchor {
  return { coldC: kitColdLimitC(phase), warmC: kitWarmLimitC(phase) };
}

// ---------------------------------------------------------------------------------------------
// Risk at the anchor
// ---------------------------------------------------------------------------------------------

export interface ScopeRisk {
  /** P(the period's minimum is at or below the cold anchor): the chance of colder than the kit handles. */
  readonly cold: number;
  /** P(the period's maximum is at or above the warm anchor); 0 when the kit is open-ended at the top. */
  readonly warm: number;
  /** `1 − cold − warm`, floored at 0: the chance the whole period stays inside what you own. */
  readonly comfortable: number;
}

/** One scope's curves read at the phase's anchor. `cold` is 1 when nothing could be built: you own nothing for it. */
export function riskAt(dist: PhaseDistribution, anchor: Anchor): ScopeRisk {
  const cold = anchor.coldC === null ? 1 : coldRiskProbability(dist.encounter, anchor.coldC);
  const warm = anchor.warmC === null ? 0 : warmRiskProbability(dist.encounter, anchor.warmC);
  return { cold, warm, comfortable: Math.max(0, 1 - cold - warm) };
}

// ---------------------------------------------------------------------------------------------
// The union bound, checked
// ---------------------------------------------------------------------------------------------

/**
 * Slack allowed on the union bound for Monte Carlo noise: the pooled and per-night curves are
 * separate seeded runs of 4 000 draws, so each probability carries a standard error of up to
 * about 0.008; 0.02 is two and a half of those.
 */
export const UNION_BOUND_TOLERANCE = 0.02;

export interface UnionBoundCheck {
  /** P(min over the trip <= anchor). */
  readonly pooled: number;
  /** P(min over night n <= anchor), in trip order. */
  readonly nights: readonly number[];
  /** `max(nights)`: the pooled risk can be no smaller than its riskiest night. */
  readonly lower: number;
  /** `min(1, sum(nights))`: and no larger than the nights summed. */
  readonly upper: number;
  readonly holds: boolean;
}

/**
 * `max_n p_n <= p_pooled <= sum_n p_n`, within `UNION_BOUND_TOLERANCE`. This is the property
 * the client reached for when he said the pooled figure "cannot be" above the per-night sum,
 * and holding the threshold fixed is what makes it true of the numbers on screen.
 */
export function checkUnionBound(pooled: number, nights: readonly number[], tolerance = UNION_BOUND_TOLERANCE): UnionBoundCheck {
  const lower = nights.length === 0 ? 0 : Math.max(...nights);
  const upper = Math.min(1, nights.reduce((a, b) => a + b, 0));
  const holds = pooled >= lower - tolerance && pooled <= upper + tolerance;
  return { pooled, nights, lower, upper, holds };
}

// ---------------------------------------------------------------------------------------------
// The verdict mark, by probability
// ---------------------------------------------------------------------------------------------

/**
 * The tick stays only while the chance of colder than the kit handles is at most this. 10 %
 * is chosen to match the planning band already in use: the engine covers p10 to p90, so a
 * kit the engine calls covered already accepts the 10 % tail below p10. Above it, the mark
 * is a caution up to `WARN_MAX_COLD_RISK`, and a warning beyond.
 */
export const TICK_MAX_COLD_RISK = 0.1;
export const WARN_MAX_COLD_RISK = 0.25;

export type RiskLevel = 'fine' | 'marginal' | 'cold';

export function riskLevel(cold: number): RiskLevel {
  if (cold <= TICK_MAX_COLD_RISK) return 'fine';
  if (cold <= WARN_MAX_COLD_RISK) return 'marginal';
  return 'cold';
}

// ---------------------------------------------------------------------------------------------
// The fixed axis
// ---------------------------------------------------------------------------------------------

/**
 * The thermometer's axis runs from the lowest temperature whose encounter probability is at
 * least this, to the highest, over every phase and every scope of the trip. One number, so it
 * is easy to dial: the client asked for 2 %.
 */
export const AXIS_FLOOR_PROBABILITY = 0.02;

/**
 * The fixed axis for a trip, °C, over the curves given (every phase, pooled and per night).
 * Fixed across tabs so that what moves is the data, never the scale. `null` if no curve
 * reaches the floor anywhere, which cannot happen for a real forecast.
 */
export function encounterAxis(dists: readonly PhaseDistribution[], floor = AXIS_FLOOR_PROBABILITY): Span | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of dists) {
    const c = d.encounter;
    for (let i = 0; i < c.temperaturesC.length; i += 1) {
      if ((c.encounter[i] ?? 0) < floor) continue;
      const t = c.temperaturesC[i]!;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return { fromC: lo, toC: hi };
}
