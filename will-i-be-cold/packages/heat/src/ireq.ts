/**
 * ISO 11079:2007, IREQ (required clothing insulation), DLE and recovery time.
 *
 * This is the model for the four **clothed** phases. It is *not* valid for sleep: its
 * metabolic-rate floor is M ≥ 58 W/m² and its air-velocity floor is v_ar ≥ 0.4 m/s, and a
 * sleeping person is outside both (`docs/STANDARDS.md` §1.9, §7.4 item 23). See `sleep.ts`.
 *
 * Everything in this file is traceable to `docs/STANDARDS.md` §1. The three places where the
 * standard is ambiguous or self-contradictory are called out at the constant that embodies
 * the choice: `F_CL_COEFFICIENT`, `RE_T_INCLUDES_FCL` and `DEFAULT_WALKING_SPEED_FLOOR`.
 */

import {
  CLO,
  ISO_KELVIN_OFFSET,
  STEFAN_BOLTZMANN,
  clamp,
  saturationVapourPressureKPa,
  siToClo,
  toSignificantFigures,
  vapourPressureKPa,
  type Celsius,
  type Fraction,
  type Kilopascals,
  type MetresPerSecond,
  type SquareMetreKelvinPerWatt,
  type WattsPerSquareMetre,
} from './units.js';
import {
  ThermalModelError,
  warn,
  type DurationLimitedExposure,
  type ModelWarning,
  type UnverifiedConstant,
} from './types.js';

// ---------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------

/** Clothing surface emissivity, ISO 11079 Eq. (5) linearisation (STANDARDS §1.6). */
export const CLOTHING_EMISSIVITY = 0.95;

/**
 * Effective radiating area fraction A_r/A_Du = 0.77.
 *
 * ⚠️ **0.77, not the 0.70/0.73 familiar from ISO 7730.** ISO 11079's reference program
 * hard-codes 0.77, consistent with ISO 9920 §6's "0,77 for a standing subject": IREQ assumes
 * a standing, working person (STANDARDS §1.6).
 */
export const RADIATING_AREA_FRACTION = 0.77;

/** Static boundary-layer insulation used by ISO 11079, m²K/W (STANDARDS §1.6). */
export const STATIC_AIR_INSULATION: SquareMetreKelvinPerWatt = 0.085;

/** Moisture permeability index used by ISO 11079's Annex F program (STANDARDS §1.4). */
export const PERMEABILITY_INDEX = 0.38;

/** 1/L, the reciprocal Lewis relation as ISO 9920 rounds it, kPa/K (STANDARDS §1.4). */
export const INVERSE_LEWIS = 0.06;

/**
 * ⚠️ **The f_cl ambiguity.** ISO 11079's *body text* says `f_cl = 1 + 1.97·I_cl`; its own
 * normative Annex F program says `1 + 1.197·I_cl` (STANDARDS §1.6, §7.1 item 1). `1.197`
 * looks like a transposition of `1.97`, but it is what the Annex F program and all three
 * independent ports compute, and it is what reproduces the standard's own Table F.1.
 *
 * We ship 1.197. IREQ is nearly insensitive to the choice; **DLE is not**: differences of up
 * to 5 h are reported for long exposures. That is why `DurationLimitedExposure` is capped at
 * one significant figure.
 *
 * Overridable via `IreqOptions.fclCoefficient` if you want to see the other branch.
 */
export const F_CL_COEFFICIENT = 1.197;

/** ISO 11079's body-text value, for sensitivity analysis. Not the default. */
export const F_CL_COEFFICIENT_BODY_TEXT = 1.97;

/**
 * Limiting body heat debt Q_lim = 144 kJ/m² = 40 Wh/m² (STANDARDS §1.8).
 * The 2007 revision changed the unit, not the value.
 */
export const Q_LIM_WATT_HOURS: number = 40;

/** ISO 11079 validity limits (STANDARDS §1.9). */
export const IREQ_VALIDITY = {
  maxAirTemperatureC: 10,
  minMetabolicRate: 58,
  maxMetabolicRate: 400,
  minAirVelocity: 0.4,
  maxAirVelocity: 18,
  maxWalkingSpeed: 1.2,
} as const;

/**
 * ⚠️ Walking-speed floor used when `walkingSpeed` is not given.
 *
 * STANDARDS §1.7 gives the default as `v_w = 0.0052·(M − 58)` capped at 1.2 m/s. STANDARDS
 * §1.10 reports Table F.1 was run with `clamp(0.0052(M − 58), 0.5, 1.2)`: i.e. with an
 * additional 0.5 m/s *floor* that §1.7 does not mention. The floor is what reproduces
 * Table F.1 (without it, the back-calculated I_cl column misses by up to 0.27 clo), so we
 * ship it, as an overridable constant.
 *
 * `estimated` in the sense that no source states it as a rule; it is inferred from the
 * reference-value conditions.
 */
export const DEFAULT_WALKING_SPEED_FLOOR: MetresPerSecond = 0.5;

/**
 * ⚠️ Does the air layer get divided by f_cl inside R_e,T,r?
 *
 * STANDARDS §1.4 / §7.1 item 3: ISO 11079's Annex F ports sum `I_a,r + I_cl,r`; the
 * peer-reviewed rendering and ISO 9920 Eq. (27) use `I_a,r/f_cl + I_cl,r`. Unresolved. We
 * follow the Annex F ports (`false`) because that is what reproduces Table F.1.
 */
export const RE_T_INCLUDES_FCL = false;

/**
 * Air permeability of common outer layers, l·m⁻²·s⁻¹ (ISO 9237), for ISO 11079 §1.7's
 * correction. The *bracket* value spans a factor ~2.7 across this range, so this is a
 * first-order input, not a refinement (STANDARDS §1.7).
 *
 * The three anchor values (1 / 50 / 500) are the ones STANDARDS §1.7 itself works through;
 * the intermediate labels are ours. `estimated` where noted.
 */
export const AIR_PERMEABILITY = {
  /** Membrane hardshell, near-windproof. STANDARDS §1.7's worked "membrane" case. */
  windproofMembrane: 1,
  /** Tightly-woven windshirt. `estimated`, interpolated between the two anchors. */
  windshirt: 8,
  /** Ordinary woven fabric. STANDARDS §1.7's worked "ordinary woven" case. */
  ordinaryWoven: 50,
  /** Open fleece, no shell. STANDARDS §1.7's worked "open fleece" case. */
  openFleece: 500,
} as const;

/**
 * Default air permeability when no shell flag is given: 8 l·m⁻²·s⁻¹.
 *
 * This is the value ISO 11079's own Table F.1 conditions use (STANDARDS §1.10), so it is the
 * standard's reference clothing rather than a guess.
 */
export const DEFAULT_AIR_PERMEABILITY = 8;

/** Every constant in this module that is not traceable to a verified source. */
export const IREQ_UNVERIFIED_CONSTANTS: readonly UnverifiedConstant[] = [
  {
    id: 'ireq.fclCoefficient',
    value: F_CL_COEFFICIENT,
    units: '1/(m²K/W)',
    provenance: 'iso11079',
    note:
      "ISO 11079's body text says 1.97, its own normative Annex F program says 1.197. We ship " +
      '1.197 (three independent ports agree, and it reproduces Table F.1). IREQ barely moves; ' +
      'DLE moves by up to 5 h, which is why DLE is capped at one significant figure.',
  },
  {
    id: 'ireq.walkingSpeedFloor',
    value: DEFAULT_WALKING_SPEED_FLOOR,
    units: 'm/s',
    provenance: 'estimated',
    note:
      'STANDARDS §1.7 gives v_w = 0.0052(M−58) capped at 1.2 with no floor; §1.10 reports the ' +
      'Table F.1 runs used a 0.5 m/s floor. We ship the floor because it is what reproduces the ' +
      'table. Affects DLE and the back-calculated I_cl, not IREQ itself.',
  },
  {
    id: 'ireq.reTIncludesFcl',
    value: RE_T_INCLUDES_FCL ? 1 : 0,
    units: 'boolean',
    provenance: 'iso11079',
    note:
      'STANDARDS §7.1 item 3: Annex F ports sum I_a,r + I_cl,r; ISO 9920 Eq. (27) divides the ' +
      'air layer by f_cl. Unresolved in the literature. We follow Annex F.',
  },
  {
    id: 'ireq.airPermeability.windshirt',
    value: AIR_PERMEABILITY.windshirt,
    units: 'l/(m²·s)',
    provenance: 'estimated',
    note:
      'STANDARDS §1.7 anchors a_p at 1 (membrane), 50 (ordinary woven) and 500 (open fleece). ' +
      'The windshirt value is interpolated by us; it coincides with the a_p = 8 used in the ' +
      "standard's own Table F.1 reference conditions.",
  },
];

// ---------------------------------------------------------------------------------------
// Heat-transfer coefficients
// ---------------------------------------------------------------------------------------

/**
 * Radiative heat transfer coefficient, W/m²K: ISO 11079 Eq. (5) linearisation.
 *
 * 🔴 **Never hard-code 4.7.** 4.7 is a separate conventional *indoor* whole-body constant;
 * the linearisation gives 4.18 at a 20 °C mean and 2.69 at −20 °C for ISO 11079's geometry
 * (STANDARDS §5.5). A hard-coded 4.7 overestimates radiant loss by ~75 % at −20 °C: squarely
 * in this library's domain. This function is called *inside* the IREQ iteration because it
 * depends on the clothing surface temperature the iteration is solving for.
 */
export function radiativeCoefficient(tcl: Celsius, tr: Celsius): number {
  const k = CLOTHING_EMISSIVITY * STEFAN_BOLTZMANN * RADIATING_AREA_FRACTION;
  if (Math.abs(tcl - tr) < 1e-9) {
    return 4 * k * Math.pow(ISO_KELVIN_OFFSET + (tcl + tr) / 2, 3);
  }
  return (
    (k * (Math.pow(tcl + ISO_KELVIN_OFFSET, 4) - Math.pow(tr + ISO_KELVIN_OFFSET, 4))) / (tcl - tr)
  );
}

/**
 * The ISO 7933 / ISO 9920 convective pair, W/m²K: `max(2.38·|Δt|^0.25, 3.5 + 5.2·v, 8.7·v^0.6)`
 * with the two forced branches meeting *exactly* at v = 1 m/s (STANDARDS §5.3).
 *
 * ⚠️ **This is NOT used inside IREQ**, and must not be: ISO 11079 derives h_c by subtraction
 * from the dynamic boundary-layer insulation (`convectiveCoefficientIso11079`), and
 * substituting an explicit correlation double-counts the wind (STANDARDS §1.6, §5.4).
 * It is exported because `environment.ts` needs an h_c to form the operative-temperature
 * weighting, and because it is the right answer to "what is h_c for a human body?".
 *
 * Note the coefficient is **8.7, not 8.3**. 8.3·v^0.6 is Mitchell (1974) via the ASHRAE
 * Handbook, for motionless subjects, and `SPEC.md` §2.1's `0.1 ≤ v < 1` bounds for it are not
 * published anywhere (STANDARDS §5.2, §7.3 item 22).
 */
export function convectiveCoefficientIso9920(
  airVelocity: MetresPerSecond,
  skinMinusAir?: number,
): number {
  const forced = airVelocity <= 1 ? 3.5 + 5.2 * airVelocity : 8.7 * Math.pow(airVelocity, 0.6);
  const natural = skinMinusAir === undefined ? 0 : 2.38 * Math.pow(Math.abs(skinMinusAir), 0.25);
  return Math.max(forced, natural);
}

/** ISO 11079's own h_c: `1/I_a,r − h_r` (STANDARDS §1.6). Wind enters only through I_a,r. */
export function convectiveCoefficientIso11079(
  dynamicAirInsulation: SquareMetreKelvinPerWatt,
  hr: number,
): number {
  return 1 / dynamicAirInsulation - hr;
}

/**
 * Resultant boundary-layer insulation, m²K/W (STANDARDS §1.6):
 * `I_a,r = 0.092·exp(−0.15·v_ar − 0.22·v_w) − 0.0045`.
 */
export function dynamicAirInsulation(
  airVelocity: MetresPerSecond,
  walkingSpeed: MetresPerSecond,
): SquareMetreKelvinPerWatt {
  return 0.092 * Math.exp(-0.15 * airVelocity - 0.22 * walkingSpeed) - 0.0045;
}

/**
 * ISO 11079's **own** wind/walking correction bracket (STANDARDS §1.7):
 *
 *     corr = 0.54·exp(−0.15·v_ar − 0.22·v_w)·a_p^0.075 − 0.06·ln(a_p) + 0.5
 *
 * ⚠️ Use this, **not** ISO 9920 §8.2's. ISO 9920's correction is only validated to
 * I_cl ≤ 1.4 clo and v_ar ≤ 3.5 m/s (useless for expedition layering in wind), and its
 * cold-weather variant containing `a_p` is `UNVERIFIED: do not ship` because the two
 * renderings obtained place `a_p^0.144` differently (STANDARDS §2.6, §7.1 item 2).
 */
export function insulationCorrectionFactor(
  airVelocity: MetresPerSecond,
  walkingSpeed: MetresPerSecond,
  airPermeability: number,
): number {
  return (
    0.54 * Math.exp(-0.15 * airVelocity - 0.22 * walkingSpeed) * Math.pow(airPermeability, 0.075) -
    0.06 * Math.log(airPermeability) +
    0.5
  );
}

/** ISO 11079's default walking speed when the caller does not know it (STANDARDS §1.7/§1.10). */
export function defaultWalkingSpeed(metabolicRate: WattsPerSquareMetre): MetresPerSecond {
  return clamp(
    0.0052 * (metabolicRate - 58),
    DEFAULT_WALKING_SPEED_FLOOR,
    IREQ_VALIDITY.maxWalkingSpeed,
  );
}

// ---------------------------------------------------------------------------------------
// Basic ↔ resultant insulation
// ---------------------------------------------------------------------------------------

export interface DynamicContext {
  readonly airVelocity: MetresPerSecond;
  readonly walkingSpeed: MetresPerSecond;
  readonly airPermeability: number;
  readonly fclCoefficient: number;
}

/**
 * Basic (static, catalogue) intrinsic insulation → resultant (wind- and motion-corrected).
 *
 * `I_T = I_cl + I_a/f_cl`; `I_T,r = I_T·corr`; `I_cl,r = I_T,r − I_a,r/f_cl` (STANDARDS §1.7),
 * with `f_cl = 1 + k·I_cl,r` evaluated on the **resultant** insulation, which is what the
 * peer-reviewed rendering states and what reproduces Table F.1's back-calculated column.
 * Solved as a fixed point (contraction; converges in a handful of iterations).
 */
export function resultantInsulation(
  basic: SquareMetreKelvinPerWatt,
  ctx: DynamicContext,
): SquareMetreKelvinPerWatt {
  const corr = insulationCorrectionFactor(ctx.airVelocity, ctx.walkingSpeed, ctx.airPermeability);
  const iar = dynamicAirInsulation(ctx.airVelocity, ctx.walkingSpeed);
  let resultant = basic;
  for (let i = 0; i < 100; i++) {
    const fcl = 1 + ctx.fclCoefficient * resultant;
    const next = (basic + STATIC_AIR_INSULATION / fcl) * corr - iar / fcl;
    if (Math.abs(next - resultant) < 1e-13) return next;
    resultant = next;
  }
  return resultant;
}

/** The exact inverse of {@link resultantInsulation}: resultant → basic catalogue insulation. */
export function basicInsulation(
  resultant: SquareMetreKelvinPerWatt,
  ctx: DynamicContext,
): SquareMetreKelvinPerWatt {
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (resultantInsulation(mid, ctx) > resultant) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------------------
// The balance
// ---------------------------------------------------------------------------------------

/** The two physiological criterion sets of ISO 11079 Annex B (STANDARDS §1.3). */
export type IreqCriterion = 'neutral' | 'min';

export interface CriterionValues {
  /** Mean skin temperature, °C. */
  readonly meanSkinTemperature: Celsius;
  /** Skin wettedness, dimensionless. */
  readonly skinWettedness: Fraction;
}

export function criterionValues(
  criterion: IreqCriterion,
  metabolicRate: WattsPerSquareMetre,
): CriterionValues {
  return criterion === 'neutral'
    ? { meanSkinTemperature: 35.7 - 0.0285 * metabolicRate, skinWettedness: 0.001 * metabolicRate }
    : { meanSkinTemperature: 33.34 - 0.0354 * metabolicRate, skinWettedness: 0.06 };
}

/** Respiratory heat losses, W/m²: **ISO 11079's forms, not Fanger's** (STANDARDS §1.5). */
export interface RespiratoryLosses {
  readonly convective: WattsPerSquareMetre;
  readonly evaporative: WattsPerSquareMetre;
  readonly expiredAirTemperature: Celsius;
  readonly expiredAirVapourPressure: Kilopascals;
}

/**
 * `C_res = 0.0014·M·(t_ex − t_a)`, `E_res = 0.0173·M·(p_ex − p_a)` with
 * `t_ex = 29 + 0.2·t_a` and `p_ex = p_s(t_ex)`.
 *
 * ⚠️ The widely-copied Fanger forms (fixed 34 °C and 5.87 kPa) are ISO 7730, valid in moderate
 * environments only. At −20 °C they overstate `C_res` by ~20 % and `E_res` by ~85 %
 * (STANDARDS §1.5; `MODEL.md` §6(i)).
 */
export function respiratoryLosses(
  metabolicRate: WattsPerSquareMetre,
  airTemperature: Celsius,
  ambientVapourPressure: Kilopascals,
): RespiratoryLosses {
  const tex = 29 + 0.2 * airTemperature;
  const pex = saturationVapourPressureKPa(tex);
  return {
    convective: 0.0014 * metabolicRate * (tex - airTemperature),
    evaporative: 0.0173 * metabolicRate * (pex - ambientVapourPressure),
    expiredAirTemperature: tex,
    expiredAirVapourPressure: pex,
  };
}

interface BalanceContext {
  readonly airTemperature: Celsius;
  readonly radiantTemperature: Celsius;
  readonly metabolicRate: WattsPerSquareMetre;
  readonly work: WattsPerSquareMetre;
  readonly ambientVapourPressure: Kilopascals;
  readonly respiratory: RespiratoryLosses;
  readonly dynamicAir: SquareMetreKelvinPerWatt;
  readonly fclCoefficient: number;
}

interface BalanceTerms {
  readonly balance: WattsPerSquareMetre;
  readonly clothingSurfaceTemperature: Celsius;
  readonly radiative: WattsPerSquareMetre;
  readonly convective: WattsPerSquareMetre;
  readonly evaporativeSkin: WattsPerSquareMetre;
  readonly hr: number;
  readonly hc: number;
  readonly fcl: number;
}

/**
 * One evaluation of the ISO 11079 balance at a trial resultant insulation and a given body
 * heat storage rate `S`.
 *
 * `R + C = M − W − E_res − C_res − E − S` (Eq. 7) with
 * `t_cl = t_sk − I_cl,r·(M − W − E_res − C_res − E − S)` (Eq. 9).
 * For IREQ, `S = 0` (steady state, Eq. 1 reduced per §5.4). For DLE, `S` is the unknown.
 */
function evaluate(
  ctx: BalanceContext,
  resultant: SquareMetreKelvinPerWatt,
  criterion: CriterionValues,
  storage: WattsPerSquareMetre,
): BalanceTerms {
  const fcl = 1 + ctx.fclCoefficient * resultant;
  const airTerm = RE_T_INCLUDES_FCL ? ctx.dynamicAir / fcl : ctx.dynamicAir;
  const evaporativeResistance = (INVERSE_LEWIS / PERMEABILITY_INDEX) * (airTerm + resultant);
  const saturatedSkin = saturationVapourPressureKPa(criterion.meanSkinTemperature);
  const evaporativeSkin =
    (criterion.skinWettedness * (saturatedSkin - ctx.ambientVapourPressure)) /
    evaporativeResistance;
  const available =
    ctx.metabolicRate -
    ctx.work -
    ctx.respiratory.evaporative -
    ctx.respiratory.convective -
    evaporativeSkin;
  const tcl = criterion.meanSkinTemperature - resultant * (available - storage);
  const hr = radiativeCoefficient(tcl, ctx.radiantTemperature);
  const hc = convectiveCoefficientIso11079(ctx.dynamicAir, hr);
  const radiative = fcl * hr * (tcl - ctx.radiantTemperature);
  const convective = fcl * hc * (tcl - ctx.airTemperature);
  return {
    balance: available - radiative - convective,
    clothingSurfaceTemperature: tcl,
    radiative,
    convective,
    evaporativeSkin,
    hr,
    hc,
    fcl,
  };
}

const SOLVER = {
  /** Balance tolerance, W/m². ISO 11079 Annex F uses 0.01; we are stricter. */
  toleranceWattsPerSquareMetre: 1e-6,
  maxBracketExpansions: 400,
  /** 80 halvings of [0, 10] m²K/W is far below double precision; the balance tolerance binds. */
  bisections: 80,
  /** Largest resultant insulation we will look for, m²K/W (≈ 65 clo). */
  maxInsulation: 10,
} as const;

/**
 * Solve the balance for IREQ at a given criterion. Monotone in insulation, so bracket + bisect.
 *
 * @throws ThermalModelError if no bracket exists: never returns NaN.
 */
function solveIreq(ctx: BalanceContext, criterion: CriterionValues): SquareMetreKelvinPerWatt {
  let lo = 1e-6;
  if (evaluate(ctx, lo, criterion, 0).balance > 0) {
    // Warmer than neutrality with no clothing at all. The requirement is zero, not negative.
    return 0;
  }
  let hi = 0.01;
  let bracketed = false;
  for (let i = 0; i < SOLVER.maxBracketExpansions; i++) {
    const b = evaluate(ctx, hi, criterion, 0).balance;
    if (!Number.isFinite(b)) {
      throw new ThermalModelError(
        'ireq_non_finite',
        `ISO 11079 balance evaluated to a non-finite value at I_cl,r = ${hi} m²K/W.`,
      );
    }
    if (b > 0) {
      bracketed = true;
      break;
    }
    hi *= 1.4;
    if (hi > SOLVER.maxInsulation) break;
  }
  if (!bracketed) {
    throw new ThermalModelError(
      'ireq_no_convergence',
      `ISO 11079 IREQ did not converge: no insulation up to ${SOLVER.maxInsulation} m²K/W ` +
        `(${siToClo(SOLVER.maxInsulation).toFixed(0)} clo) balances the heat budget at ` +
        `t_a = ${ctx.airTemperature} °C, M = ${ctx.metabolicRate} W/m².`,
    );
  }
  for (let i = 0; i < SOLVER.bisections; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate(ctx, mid, criterion, 0).balance > 0) hi = mid;
    else lo = mid;
  }
  const answer = (lo + hi) / 2;
  if (!Number.isFinite(answer)) {
    throw new ThermalModelError('ireq_non_finite', 'ISO 11079 IREQ produced a non-finite value.');
  }
  return answer;
}

/**
 * Solve for the body heat storage rate `S` with the insulation actually worn
 * (ISO/TR 11079 Eqs. 12–13, STANDARDS §1.8). Monotone decreasing in `S`, so bisect.
 */
function solveStorage(
  ctx: BalanceContext,
  resultant: SquareMetreKelvinPerWatt,
  criterion: CriterionValues,
): WattsPerSquareMetre {
  const g = (s: number): number => evaluate(ctx, resultant, criterion, s).balance - s;
  let lo = -2000;
  let hi = 2000;
  if (!Number.isFinite(g(lo)) || !Number.isFinite(g(hi))) {
    throw new ThermalModelError('dle_non_finite', 'ISO 11079 storage solve produced a non-finite value.');
  }
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function dle(storage: WattsPerSquareMetre, criterion: IreqCriterion): DurationLimitedExposure {
  if (storage >= 0) {
    return { hours: null, display: '> 8 h', criterion, significantFigures: 1 };
  }
  const raw = Q_LIM_WATT_HOURS / -storage;
  if (raw > 8) {
    // STANDARDS §1.8: the standard's own Table F.1 reports "more than 8" and says not to
    // present DLE beyond 8 h as precise.
    return { hours: null, display: '> 8 h', criterion, significantFigures: 1 };
  }
  const hours = toSignificantFigures(raw, 1);
  return { hours, display: `${hours} h`, criterion, significantFigures: 1 };
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export interface IreqInput {
  /** Air temperature, °C. */
  readonly airTemperature: Celsius;
  /** Mean radiant temperature, °C. Defaults to `airTemperature` if omitted. */
  readonly radiantTemperature?: Celsius;
  /** Relative air velocity at the body, m/s. */
  readonly airVelocity: MetresPerSecond;
  /** Relative humidity, 0..1. */
  readonly relativeHumidity: Fraction;
  /** Metabolic rate, **W/m²** (not met). */
  readonly metabolicRate: WattsPerSquareMetre;
  /** Effective mechanical power, W/m². ~0 for walking on trail. */
  readonly work?: WattsPerSquareMetre;
  /** Basic (catalogue) intrinsic clothing insulation actually worn, m²K/W. */
  readonly clothingInsulation: SquareMetreKelvinPerWatt;
  /**
   * Walking speed, m/s. Omit to use ISO 11079's default `0.0052·(M − 58)` with the floor and
   * cap described at {@link DEFAULT_WALKING_SPEED_FLOOR}.
   */
  readonly walkingSpeed?: MetresPerSecond;
  /**
   * Air permeability of the outer layer, l·m⁻²·s⁻¹ (ISO 9237). Prefer `windproofShell`.
   * Defaults to {@link DEFAULT_AIR_PERMEABILITY}.
   */
  readonly airPermeability?: number;
  /**
   * `true` models a windproof shell as the outermost layer: i.e. the effective internal air
   * velocity goes to ~0 by way of a membrane-grade `a_p` of 1 l·m⁻²·s⁻¹ (STANDARDS §1.7).
   * Ignored if `airPermeability` is given explicitly.
   */
  readonly windproofShell?: boolean;
}

export interface IreqOptions {
  /**
   * What to do when an input is outside ISO 11079's stated validity range.
   * `'throw'` (default) refuses; `'warn'` clamps and records a warning.
   *
   * The metabolic-rate floor is the one that matters: a sleeping person is at ~45 W/m²,
   * and IREQ has nothing honest to say there. Use `sleep.ts`.
   */
  readonly onOutOfRange?: 'throw' | 'warn';
  /** Override the f_cl coefficient. See {@link F_CL_COEFFICIENT}. */
  readonly fclCoefficient?: number;
  /**
   * Skip the two body-heat-storage solves (and therefore DLE/recovery). Used by the
   * comfort-interval search in `assess.ts`, which calls `ireq` tens of times per candidate and
   * only ever reads `marginClo`. `storageNeutral`/`storageMin` come back as 0 and both DLE
   * fields report "> 8 h": do not read them when this is set.
   */
  readonly skipDurationLimitedExposure?: boolean;
}

export interface IreqResult {
  /** Required **resultant** insulation for thermal neutrality, m²K/W (ISO 11079 Eq. 8). */
  readonly ireqNeutral: SquareMetreKelvinPerWatt;
  /** Required resultant insulation to merely limit body cooling, m²K/W. */
  readonly ireqMin: SquareMetreKelvinPerWatt;
  /** The same two, converted back to basic (catalogue) clothing insulation, clo. */
  readonly requiredNeutralClo: number;
  readonly requiredMinClo: number;
  /** Basic insulation actually worn, clo. */
  readonly providedClo: number;
  /** `providedClo − requiredNeutralClo`. */
  readonly marginClo: number;
  /** Resultant insulation of what is worn, m²K/W. */
  readonly resultantWorn: SquareMetreKelvinPerWatt;
  /** Body heat storage rate against each criterion, W/m². Negative = cooling. */
  readonly storageNeutral: WattsPerSquareMetre;
  readonly storageMin: WattsPerSquareMetre;
  readonly dleNeutral: DurationLimitedExposure;
  readonly dleMin: DurationLimitedExposure;
  /** Clothing surface temperature at the neutral criterion with the worn ensemble, °C. */
  readonly clothingSurfaceTemperature: Celsius;
  /** h_r and h_c as the iteration actually computed them, W/m²K. */
  readonly radiativeCoefficient: number;
  readonly convectiveCoefficient: number;
  readonly respiratory: RespiratoryLosses;
  readonly walkingSpeed: MetresPerSecond;
  readonly airPermeability: number;
  readonly warnings: readonly ModelWarning[];
}

function checkValidity(
  input: IreqInput,
  mode: 'throw' | 'warn',
): { airVelocity: MetresPerSecond; metabolicRate: WattsPerSquareMetre; warnings: ModelWarning[] } {
  const warnings: ModelWarning[] = [];
  const fail = (code: string, message: string): void => {
    if (mode === 'throw') throw new ThermalModelError(code, message);
    warnings.push(warn(code, 'out-of-range', message));
  };

  let { airVelocity, metabolicRate } = input;

  if (metabolicRate < IREQ_VALIDITY.minMetabolicRate) {
    fail(
      'ireq_metabolic_rate_below_floor',
      `ISO 11079 is valid only for M ≥ ${IREQ_VALIDITY.minMetabolicRate} W/m²; got ` +
        `${metabolicRate.toFixed(1)} W/m² (${(metabolicRate / 58.15).toFixed(2)} met). A sleeping ` +
        'person is ~45 W/m² and is outside this model on both the metabolic and the ' +
        'air-velocity axis: use the ISO 23537 sleep model instead (see sleep.ts).',
    );
    metabolicRate = IREQ_VALIDITY.minMetabolicRate;
  }
  if (metabolicRate > IREQ_VALIDITY.maxMetabolicRate) {
    fail(
      'ireq_metabolic_rate_above_ceiling',
      `ISO 11079 is valid only for M ≤ ${IREQ_VALIDITY.maxMetabolicRate} W/m²; got ${metabolicRate.toFixed(1)}.`,
    );
    metabolicRate = IREQ_VALIDITY.maxMetabolicRate;
  }
  if (airVelocity < IREQ_VALIDITY.minAirVelocity) {
    // Always a warning, never a throw: a still night is a normal product input, and running
    // the model at the 0.4 m/s floor errs safe (it overestimates the requirement: §1.9).
    warnings.push(
      warn(
        'ireq_air_velocity_below_floor',
        'out-of-range',
        `ISO 11079's validity range starts at v_ar = ${IREQ_VALIDITY.minAirVelocity} m/s; ` +
          `${airVelocity.toFixed(2)} m/s was requested. Evaluated at the floor, which ` +
          'overestimates the required insulation (errs safe) but is an extrapolation.',
      ),
    );
    airVelocity = IREQ_VALIDITY.minAirVelocity;
  }
  if (airVelocity > IREQ_VALIDITY.maxAirVelocity) {
    fail(
      'ireq_air_velocity_above_ceiling',
      `ISO 11079 is validated to v_ar ≤ ${IREQ_VALIDITY.maxAirVelocity} m/s; got ${airVelocity.toFixed(1)}.`,
    );
    airVelocity = IREQ_VALIDITY.maxAirVelocity;
  }
  if (input.airTemperature > IREQ_VALIDITY.maxAirTemperatureC) {
    warnings.push(
      warn(
        'ireq_air_temperature_above_ceiling',
        'out-of-range',
        `ISO 11079 is a cold-stress model, stated valid to t_a ≤ ${IREQ_VALIDITY.maxAirTemperatureC} °C ` +
          `(one field study extends it to 15 °C); got ${input.airTemperature.toFixed(1)} °C. The ` +
          'result is an extrapolation and the "too warm" side of the verdict is not a heat-stress model.',
      ),
    );
  }
  return { airVelocity, metabolicRate, warnings };
}

/**
 * Solve ISO 11079 for the required clothing insulation, the margin against what is worn, and
 * the duration-limited exposure.
 *
 * @throws ThermalModelError when an input is outside the standard's validity range (unless
 *         `options.onOutOfRange === 'warn'`), or when the solver cannot converge. It never
 *         returns NaN.
 */
export function ireq(input: IreqInput, options: IreqOptions = {}): IreqResult {
  const mode = options.onOutOfRange ?? 'throw';
  const fclCoefficient = options.fclCoefficient ?? F_CL_COEFFICIENT;
  const { airVelocity, metabolicRate, warnings } = checkValidity(input, mode);

  const radiantTemperature = input.radiantTemperature ?? input.airTemperature;
  const work = input.work ?? 0;
  const walkingSpeed = clamp(
    input.walkingSpeed ?? defaultWalkingSpeed(metabolicRate),
    0,
    IREQ_VALIDITY.maxWalkingSpeed,
  );
  const airPermeability =
    input.airPermeability ??
    (input.windproofShell ? AIR_PERMEABILITY.windproofMembrane : DEFAULT_AIR_PERMEABILITY);

  if (airPermeability <= 0) {
    throw new ThermalModelError(
      'ireq_bad_air_permeability',
      'Air permeability must be > 0 l·m⁻²·s⁻¹ (the correction contains ln(a_p)).',
    );
  }
  if (input.clothingInsulation < 0) {
    throw new ThermalModelError('ireq_negative_insulation', 'Clothing insulation must be ≥ 0.');
  }

  const ambientVapourPressure = vapourPressureKPa(input.airTemperature, input.relativeHumidity);
  const respiratory = respiratoryLosses(metabolicRate, input.airTemperature, ambientVapourPressure);
  const dynamicAir = dynamicAirInsulation(airVelocity, walkingSpeed);

  const ctx: BalanceContext = {
    airTemperature: input.airTemperature,
    radiantTemperature,
    metabolicRate,
    work,
    ambientVapourPressure,
    respiratory,
    dynamicAir,
    fclCoefficient,
  };
  const dyn: DynamicContext = { airVelocity, walkingSpeed, airPermeability, fclCoefficient };

  const neutral = criterionValues('neutral', metabolicRate);
  const min = criterionValues('min', metabolicRate);

  const ireqNeutral = solveIreq(ctx, neutral);
  const ireqMin = solveIreq(ctx, min);

  const resultantWorn = resultantInsulation(input.clothingInsulation, dyn);
  const skipDle = options.skipDurationLimitedExposure === true;
  const storageNeutral = skipDle ? 0 : solveStorage(ctx, resultantWorn, neutral);
  const storageMin = skipDle ? 0 : solveStorage(ctx, resultantWorn, min);
  const terms = evaluate(ctx, resultantWorn, neutral, storageNeutral);

  const requiredNeutralClo = siToClo(basicInsulation(ireqNeutral, dyn));
  const requiredMinClo = siToClo(basicInsulation(ireqMin, dyn));
  const providedClo = siToClo(input.clothingInsulation);

  return {
    ireqNeutral,
    ireqMin,
    requiredNeutralClo,
    requiredMinClo,
    providedClo,
    marginClo: providedClo - requiredNeutralClo,
    resultantWorn,
    storageNeutral,
    storageMin,
    dleNeutral: dle(storageNeutral, 'neutral'),
    dleMin: dle(storageMin, 'min'),
    clothingSurfaceTemperature: terms.clothingSurfaceTemperature,
    radiativeCoefficient: terms.hr,
    convectiveCoefficient: terms.hc,
    respiratory,
    walkingSpeed,
    airPermeability,
    warnings,
  };
}

/**
 * Recovery time, h, from ISO/TR 11079 §5.5 (STANDARDS §1.8): the same calculation as DLE but
 * the *recovery* conditions substituted, using the positive heat storage rate they produce.
 * Returns `null` if the recovery conditions do not actually produce net heat gain.
 */
export function recoveryTime(
  recoveryConditions: IreqInput,
  options: IreqOptions = {},
): DurationLimitedExposure {
  const result = ireq(recoveryConditions, { onOutOfRange: 'warn', ...options });
  if (result.storageNeutral <= 0) {
    return { hours: null, display: '> 8 h', criterion: 'neutral', significantFigures: 1 };
  }
  const raw = Q_LIM_WATT_HOURS / result.storageNeutral;
  if (raw > 8) return { hours: null, display: '> 8 h', criterion: 'neutral', significantFigures: 1 };
  const hours = toSignificantFigures(raw, 1);
  return { hours, display: `${hours} h`, criterion: 'neutral', significantFigures: 1 };
}

/**
 * Invert IREQ: the coldest air temperature at which `clothingInsulation` still meets the
 * neutral criterion. This is the `T_cold` end of a candidate ensemble's comfort interval.
 *
 * Bisection on air temperature over [−60, +40] °C. `radiantOffsetK` is applied to t_r so the
 * night-sky penalty travels with the search (t_r = t_a + offset).
 *
 * @throws ThermalModelError if no root exists in range (e.g. a 10-clo ensemble, which is
 *         comfortable below −60 °C).
 */
export function coldLimitForInsulation(
  base: Omit<IreqInput, 'airTemperature' | 'radiantTemperature'>,
  radiantOffsetK: number,
  options: IreqOptions = {},
): Celsius {
  const opts: IreqOptions = { onOutOfRange: 'warn', ...options };
  const f = (ta: Celsius): number => {
    const r = ireq(
      { ...base, airTemperature: ta, radiantTemperature: ta + radiantOffsetK },
      opts,
    );
    return r.marginClo;
  };
  let lo = -60;
  let hi = 40;
  if (f(hi) < 0) {
    throw new ThermalModelError(
      'ireq_no_cold_limit',
      'This ensemble does not reach thermal neutrality even at +40 °C.',
    );
  }
  if (f(lo) > 0) {
    throw new ThermalModelError(
      'ireq_cold_limit_below_domain',
      'This ensemble is still comfortable at −60 °C; the cold limit is outside the modelled domain.',
    );
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** `clo` is a presentation unit; this is the only place the IREQ module leaks it. */
export const CLO_UNIT = CLO;
