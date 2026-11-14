/**
 * ISO 23537-1: sleeping-bag thermal ratings, solved in both directions.
 *
 * Why this exists as a separate model: ISO 11079's validity floors are M ≥ 58 W/m² and
 * v_ar ≥ 0.4 m/s. A sleeping person is ~45 W/m² at ~0.05 m/s: outside the standard on both
 * axes (`docs/STANDARDS.md` §1.9, §7.4 item 23; `MODEL.md` §6(iv)). ISO 23537 exists precisely
 * because IREQ does not cover sleep.
 *
 * 🔴 **The structural fact `SPEC.md` §2.5 gets wrong.** ISO 23537-1:2022 cl. 3.6 Note 2: the
 * rated `R_c(1)` is the **whole system**, meaning shell, fill, cavity air, the boundary layer, *the
 * mattress underneath*, and the garments worn. A reference mattress of `R_ct = 0.85 m²K/W`
 * (≈ imperial R 4.83) and a base layer of `R_ct` 0.040–0.060 are already inside the number on
 * the label. **Adding a pad's R-value on top of a bag's rating double-counts.** So SPEC's
 * "two independent floors" is wrong; what replaces it is the *delta* model below
 * (`MODEL.md` §6, "The structural finding").
 */

import {
  CLO,
  RSI_PER_IMPERIAL_R,
  celsiusToFahrenheit,
  deltaFahrenheitToKelvin,
  imperialRToSI,
  saturationVapourPressurePa,
  siToClo,
  siToImperialR,
  type Celsius,
  type SquareMetreKelvinPerWatt,
  type WattsPerSquareMetre,
} from './units.js';
import { ThermalModelError, warn, type ModelWarning, type UnverifiedConstant } from './types.js';

// ---------------------------------------------------------------------------------------
// ISO 23537-1:2022 Table 1, the normative conversion
// ---------------------------------------------------------------------------------------

/** One row of ISO 23537-1:2022 Table 1 (STANDARDS §3.1), reproduced from the ISO preview. */
export interface RatingTableRow {
  readonly rc: SquareMetreKelvinPerWatt;
  readonly extremeC: Celsius;
  readonly limitC: Celsius;
  readonly comfortC: Celsius;
}

/**
 * ISO 23537-1:2022 Table 1 verbatim. §4.1 requires **linear interpolation** between rows.
 *
 * Validity: 0.500 ≤ R_c(1) ≤ 1.420 m²K/W (3.23–9.16 clo). The table stops at
 * T_lim = −19.5 °C because the 2022 scope covers only bags rated to −20 °C and warmer:
 * **deep-winter bags are out of scope of the standard itself.**
 */
export const ISO_23537_TABLE_1: readonly RatingTableRow[] = [
  { rc: 0.5, extremeC: 5.0, limitC: 14.2, comfortC: 17.2 },
  { rc: 0.54, extremeC: 2.8, limitC: 12.7, comfortC: 15.9 },
  { rc: 0.58, extremeC: 0.6, limitC: 11.2, comfortC: 14.6 },
  { rc: 0.62, extremeC: -1.5, limitC: 9.7, comfortC: 13.3 },
  { rc: 0.66, extremeC: -3.7, limitC: 8.1, comfortC: 12.0 },
  { rc: 0.7, extremeC: -5.8, limitC: 6.6, comfortC: 10.7 },
  { rc: 0.74, extremeC: -7.9, limitC: 5.1, comfortC: 9.4 },
  { rc: 0.78, extremeC: -10.1, limitC: 3.6, comfortC: 8.1 },
  { rc: 0.82, extremeC: -12.2, limitC: 2.2, comfortC: 6.9 },
  { rc: 0.86, extremeC: -14.3, limitC: 0.7, comfortC: 5.6 },
  { rc: 0.9, extremeC: -16.3, limitC: -0.8, comfortC: 4.3 },
  { rc: 0.94, extremeC: -18.4, limitC: -2.3, comfortC: 3.1 },
  { rc: 0.98, extremeC: -20.5, limitC: -3.7, comfortC: 1.8 },
  { rc: 1.02, extremeC: -22.5, limitC: -5.2, comfortC: 0.6 },
  { rc: 1.06, extremeC: -24.5, limitC: -6.7, comfortC: -0.7 },
  { rc: 1.1, extremeC: -26.5, limitC: -8.1, comfortC: -1.9 },
  { rc: 1.14, extremeC: -28.5, limitC: -9.5, comfortC: -3.1 },
  { rc: 1.18, extremeC: -30.5, limitC: -11.0, comfortC: -4.4 },
  { rc: 1.22, extremeC: -32.5, limitC: -12.4, comfortC: -5.6 },
  { rc: 1.26, extremeC: -34.4, limitC: -13.8, comfortC: -6.8 },
  { rc: 1.3, extremeC: -36.4, limitC: -15.2, comfortC: -8.0 },
  { rc: 1.34, extremeC: -38.3, limitC: -16.7, comfortC: -9.2 },
  { rc: 1.38, extremeC: -40.2, limitC: -18.1, comfortC: -10.4 },
  { rc: 1.42, extremeC: -42.2, limitC: -19.5, comfortC: -11.6 },
];

export const TABLE_1_RANGE = {
  minRc: 0.5,
  maxRc: 1.42,
} as const;

/** Which of the three temperatures a label states. */
export type RatingKind = 'comfort' | 'limit' | 'extreme';

/**
 * Which temperature a brand's label states.
 *
 * 🔴 **This must be an explicit input and is never guessed.** US brands overwhelmingly label
 * by `T_lim`, European brands by `T_comf`; STANDARDS §3.6 cites one real bag that is "12 °F"
 * and "23 °F" simultaneously. Guessing here is a ±6 K error on the headline number.
 *
 * Also: `T_comf` and `T_ext` are computed for the standard **woman**, `T_lim` for the standard
 * **man** (STANDARDS §3.4). The three numbers on a label are not three points on one person's
 * curve, and this library says so in its caveats.
 */
export type LabelRatingType = Extract<RatingKind, 'comfort' | 'limit'>;

/** ISO 23537-1 §4.1 linear interpolation of Table 1: R_c(1) → the three temperatures. */
export function interpolateTable1(rc: SquareMetreKelvinPerWatt): RatingTableRow {
  const rows = ISO_23537_TABLE_1;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) {
    throw new ThermalModelError('sleep_table_empty', 'ISO 23537 Table 1 is empty.');
  }
  if (rc <= first.rc) return first;
  if (rc >= last.rc) return last;
  for (let i = 1; i < rows.length; i++) {
    const hi = rows[i];
    const lo = rows[i - 1];
    if (hi === undefined || lo === undefined) continue;
    if (rc <= hi.rc) {
      const f = (rc - lo.rc) / (hi.rc - lo.rc);
      return {
        rc,
        extremeC: lo.extremeC + f * (hi.extremeC - lo.extremeC),
        limitC: lo.limitC + f * (hi.limitC - lo.limitC),
        comfortC: lo.comfortC + f * (hi.comfortC - lo.comfortC),
      };
    }
  }
  return last;
}

// ---------------------------------------------------------------------------------------
// Annex C: the physiological model behind the table
// ---------------------------------------------------------------------------------------

/**
 * ISO 23537-1 Annex C parameter sets (STANDARDS §3.2).
 *
 * ⚠️ The mean skin temperatures are **fitted**, not sourced: the literal Annex C text was never
 * obtained (STANDARDS §7.1 item 4). They are the values that reproduce all 72 cells of the
 * standard's own normative Table 1 to < 0.1 K, found independently twice during the research
 * phase. That is strong corroboration of the equations, but `t_sk` itself is `derived`.
 *
 * ⚠️ STANDARDS §3.2 also notes the peer-reviewed reproduction [T4] garbles the bullet labels,
 * attaching the shivering term to T_comf and the 0.9 factor to T_ext: physiologically
 * backwards. The assignment below is the corrected one.
 */
export interface AnnexCParameters {
  /** Basal (recumbent) metabolic heat production, W/m². */
  readonly basalMetabolicRate: WattsPerSquareMetre;
  /** Shivering metabolic heat production, W/m². */
  readonly shiveringMetabolicRate: WattsPerSquareMetre;
  /** Multiplier applied to R_c to get R_c,eff: the relaxed-posture penalty. */
  readonly effectiveResistanceFactor: number;
  /** Water-vapour permeability index used in `R_e,eff = 60·R_c,eff/i_m`. */
  readonly permeabilityIndex: number;
  /** Mean skin temperature, °C. **Fitted, not sourced.** */
  readonly meanSkinTemperature: Celsius;
  /** Which "standard person" the criterion is defined for (STANDARDS §3.4). */
  readonly referencePerson: 'standard woman' | 'standard man';
}

export const ANNEX_C_PARAMETERS: Readonly<Record<RatingKind, AnnexCParameters>> = {
  comfort: {
    basalMetabolicRate: 44.4,
    shiveringMetabolicRate: 0,
    effectiveResistanceFactor: 0.9,
    permeabilityIndex: 0.5,
    meanSkinTemperature: 32.85,
    referencePerson: 'standard woman',
  },
  limit: {
    basalMetabolicRate: 47.5,
    shiveringMetabolicRate: 0,
    effectiveResistanceFactor: 1.0,
    permeabilityIndex: 0.54,
    meanSkinTemperature: 32.85,
    referencePerson: 'standard man',
  },
  extreme: {
    basalMetabolicRate: 44.4,
    shiveringMetabolicRate: 25.4,
    effectiveResistanceFactor: 1.0,
    permeabilityIndex: 0.54,
    meanSkinTemperature: 32.55,
    referencePerson: 'standard woman',
  },
};

/** Skin wettedness in Annex C, fixed at 0.06 (STANDARDS §3.2). */
export const ANNEX_C_SKIN_WETTEDNESS = 0.06;

/** Chamber relative humidity the Annex C reconstruction assumes, 0..1 (STANDARDS §3.2/§3.5). */
export const ANNEX_C_RELATIVE_HUMIDITY = 0.5;

/**
 * The Annex C steady-state residual, W/m²: `M − (H_c + H_e + H_res)` with ΔS = 0.
 *
 *     H_c   = (t_sk − t_a)/R_c,eff                                        (C.3)
 *     H_e   = w(p_sd − p_a)/R_e,eff,  R_e,eff = 60·R_c,eff/i_m            (C.4)
 *     H_res = M[0.5524 − 0.00144(t_a + 273) − 0.00632·p_a/(t_a + 273)]    (C.5)
 *
 * Pressures in **Pa** (Annex C's own unit). Zero at a rating temperature.
 */
export function annexCResidual(
  rc: SquareMetreKelvinPerWatt,
  airTemperature: Celsius,
  p: AnnexCParameters,
  relativeHumidity = ANNEX_C_RELATIVE_HUMIDITY,
): WattsPerSquareMetre {
  const m = p.basalMetabolicRate + p.shiveringMetabolicRate;
  const rcEff = p.effectiveResistanceFactor * rc;
  const reEff = (60 * rcEff) / p.permeabilityIndex;
  const pa = relativeHumidity * saturationVapourPressurePa(airTemperature);
  const dry = (p.meanSkinTemperature - airTemperature) / rcEff;
  const evaporative =
    (ANNEX_C_SKIN_WETTEDNESS * (saturationVapourPressurePa(p.meanSkinTemperature) - pa)) / reEff;
  const respiratory =
    m * (0.5524 - 0.00144 * (airTemperature + 273) - (0.00632 * pa) / (airTemperature + 273));
  return m - (dry + evaporative + respiratory);
}

/** R_c → rating temperature, by solving Annex C. Monotone, so bisect. */
export function annexCTemperature(
  rc: SquareMetreKelvinPerWatt,
  kind: RatingKind,
  relativeHumidity = ANNEX_C_RELATIVE_HUMIDITY,
): Celsius {
  if (!(rc > 0) || !Number.isFinite(rc)) {
    throw new ThermalModelError('sleep_bad_rc', `R_c must be a positive finite number; got ${rc}.`);
  }
  const p = ANNEX_C_PARAMETERS[kind];
  let lo = -120;
  let hi = 40;
  if (annexCResidual(rc, hi, p, relativeHumidity) < 0) {
    throw new ThermalModelError(
      'sleep_no_temperature',
      `ISO 23537 Annex C has no solution at or below +40 °C for R_c = ${rc.toFixed(3)} m²K/W.`,
    );
  }
  if (annexCResidual(rc, lo, p, relativeHumidity) > 0) {
    throw new ThermalModelError(
      'sleep_temperature_below_domain',
      `ISO 23537 Annex C solution for R_c = ${rc.toFixed(3)} m²K/W lies below −120 °C.`,
    );
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (annexCResidual(rc, mid, p, relativeHumidity) > 0) hi = mid;
    else lo = mid;
  }
  const t = (lo + hi) / 2;
  if (!Number.isFinite(t)) {
    throw new ThermalModelError('sleep_non_finite', 'ISO 23537 Annex C produced a non-finite value.');
  }
  return t;
}

/** Rating temperature → R_c, the inverse direction. Monotone decreasing, so bisect. */
export function annexCResistance(
  temperature: Celsius,
  kind: RatingKind,
  relativeHumidity = ANNEX_C_RELATIVE_HUMIDITY,
): SquareMetreKelvinPerWatt {
  const p = ANNEX_C_PARAMETERS[kind];
  let lo = 1e-3;
  let hi = 20;
  if (annexCResidual(lo, temperature, p, relativeHumidity) > 0) {
    throw new ThermalModelError(
      'sleep_rc_below_domain',
      `A rating of ${temperature.toFixed(1)} °C needs essentially no insulation; ` +
        'this is outside the modelled domain.',
    );
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (annexCResidual(mid, temperature, p, relativeHumidity) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------------------
// The sleep-system model: two parallel paths, calibrated against the label
// ---------------------------------------------------------------------------------------

/**
 * ISO 23537-1 reference mattress: `R_ct = (0.85 ± 0.06) m²K/W` per ISO 11092; imperial
 * **R 4.83** (0.85/0.1761102 = 4.827). Normative, both the 2016 and 2022 editions
 * (STANDARDS §3.5, §4.7). This is *inside* every published bag rating.
 */
export const REFERENCE_MATTRESS_RSI: SquareMetreKelvinPerWatt = 0.85;
export const REFERENCE_MATTRESS_IMPERIAL_R = REFERENCE_MATTRESS_RSI / RSI_PER_IMPERIAL_R;

/**
 * ISO 23537-1 reference base layer: a two-piece long-sleeve suit of `R_ct` 0.040–0.060 m²K/W
 * plus knee socks (STANDARDS §3.5). We use the midpoint. Clothing worn in the bag only counts
 * for what it adds *beyond* this.
 */
export const REFERENCE_BASE_LAYER_RSI: SquareMetreKelvinPerWatt = 0.05;

/**
 * ⚠️ **Estimated.** Fraction of body surface on the down-path (pressed into the mattress) for
 * a supine sleeper.
 *
 * No published figure exists in `docs/STANDARDS.md`; §6.7 notes that even *angular* factors
 * for a supine person do not exist in the reachable literature. 0.35 is our estimate for the
 * compressed, pad-facing share of a supine body. At the reference configuration it makes the
 * under-path carry ~43 % of total heat loss, which is consistent with the field rule of thumb
 * that the pad is "about half your warmth".
 *
 * **Sensitivity:** this is the single most influential estimated number in the sleep model.
 * Raising it to 0.45 roughly doubles the modelled penalty for an under-spec pad; lowering it
 * to 0.25 roughly halves it. Overridable via `SleepSystemParameters`.
 */
export const DEFAULT_UNDER_BODY_AREA_FRACTION = 0.35;

/**
 * ⚠️ **Estimated.** Residual resistance of the bag's own insulation where the sleeper's weight
 * has crushed it flat, m²K/W. `REFERENCE_warmth_check.md` says the underside "counts ~0";
 * 0.02 m²K/W (≈ 0.13 clo ≈ imperial R 0.11) is "nearly zero but not zero".
 */
export const DEFAULT_CRUSHED_BAG_RSI: SquareMetreKelvinPerWatt = 0.02;

/**
 * ⚠️ **Estimated.** Head share of body surface, used only when the hood is *not* used, to
 * split the head out as a third parallel path. 0.07 is the usual anatomical segment share
 * (the burns "rule of nines" gives 9 % for head+neck; DuBois segment tables give ~7 %).
 * Not in `docs/STANDARDS.md`.
 */
export const DEFAULT_HEAD_AREA_FRACTION = 0.07;

/**
 * ⚠️ **Estimated.** How much of a garment's catalogue insulation survives being worn inside a
 * bag. Over-path: the bag compresses the garment and the garment compresses the bag's loft,
 * so some is lost. Under-path: almost all of it is crushed.
 *
 * `REFERENCE_warmth_check.md` says "Puffy worn inside the quilt in bed: add its full clo",
 * which is the optimistic end; we discount it.
 */
export const DEFAULT_IN_BAG_CLOTHING_EFFICIENCY = { over: 0.75, under: 0.25 } as const;

/**
 * ⚠️ **Estimated.** Resistance lost from the over-path when a bag has no draft collar, or it
 * is not used, m²K/W. The ISO test cinches everything closed, so the rating assumes it is used.
 */
export const DEFAULT_NO_DRAFT_COLLAR_PENALTY_RSI: SquareMetreKelvinPerWatt = 0.06;

/**
 * ⚠️ **Estimated.** Fraction of the over-path left when a sleeper vents the bag to shed heat.
 * Used only for the warm end of the comfort interval. ISO 23537's `T_max` (from the separate
 * `R_c(2)` "arms outside" test) would be the right number, but the 2022 edition demoted it to
 * informative Annex F and we never obtained it (STANDARDS §3.1, §3.5).
 */
export const DEFAULT_VENTED_OVER_PATH_FRACTION = 0.5;

/**
 * Still-air boundary resistance on a bare head outside a hood, m²K/W.
 * ISO 9920 §6's static value, 0.7 clo = 0.109 m²K/W (STANDARDS §2.5). `iso9920`.
 */
export const STATIC_BOUNDARY_RSI: SquareMetreKelvinPerWatt = 0.109;

/**
 * ⚠️ **Empirical, not physics.** Quilt label corrections from `SPEC.md` §2.5 /
 * `REFERENCE_warmth_check.md`: cottage makers run ~3 °F optimistic, direct-import ~10 °F.
 * Expressed as kelvin *added to the label temperature* (a warmer true rating = a worse bag).
 * No measurement backs these; they are field folklore, carried because the product's audience
 * expects them, and clearly labelled as such in the result.
 */
export const QUILT_LABEL_CORRECTION_K = {
  none: 0,
  cottage: deltaFahrenheitToKelvin(3),
  'direct-import': deltaFahrenheitToKelvin(10),
} as const;

export type QuiltProvenance = keyof typeof QUILT_LABEL_CORRECTION_K;

/**
 * ⚠️ **Empirical.** Fraction of the over-path resistance you get from a bag draped over your
 * shoulders while sitting in camp. Calibrated so a US-labelled 20 °F bag gives ≈ +2.5 clo,
 * which is the one data point available (`REFERENCE_warmth_check.md`'s "same quilt draped over
 * you as a blanket while sitting (leaky): +2.5"). Nothing measures this.
 */
export const DEFAULT_BAG_DRAPE_EFFICIENCY = 0.32;

export const SLEEP_UNVERIFIED_CONSTANTS: readonly UnverifiedConstant[] = [
  {
    id: 'sleep.underBodyAreaFraction',
    value: DEFAULT_UNDER_BODY_AREA_FRACTION,
    units: 'fraction of body surface',
    provenance: 'estimated',
    note:
      'No published supine area split exists (STANDARDS §6.7 notes even angular factors for a ' +
      'supine person do not). Dominates the modelled pad penalty: 0.25 halves it, 0.45 doubles it.',
  },
  {
    id: 'sleep.crushedBagRsi',
    value: DEFAULT_CRUSHED_BAG_RSI,
    units: 'm²K/W',
    provenance: 'estimated',
    note: 'REFERENCE_warmth_check.md says the crushed underside "counts ~0"; this is "nearly zero".',
  },
  {
    id: 'sleep.headAreaFraction',
    value: DEFAULT_HEAD_AREA_FRACTION,
    units: 'fraction of body surface',
    provenance: 'estimated',
    note: 'Anatomical segment share; used only to split the head out when no hood is used.',
  },
  {
    id: 'sleep.inBagClothingEfficiency.over',
    value: DEFAULT_IN_BAG_CLOTHING_EFFICIENCY.over,
    units: 'fraction',
    provenance: 'estimated',
    note:
      'Clothing inside a bag compresses the bag loft and is itself compressed. ' +
      'REFERENCE_warmth_check.md assumes 1.0 (full clo); we discount.',
  },
  {
    id: 'sleep.inBagClothingEfficiency.under',
    value: DEFAULT_IN_BAG_CLOTHING_EFFICIENCY.under,
    units: 'fraction',
    provenance: 'estimated',
    note: 'Clothing on the pad-facing side is crushed along with the bag.',
  },
  {
    id: 'sleep.noDraftCollarPenaltyRsi',
    value: DEFAULT_NO_DRAFT_COLLAR_PENALTY_RSI,
    units: 'm²K/W',
    provenance: 'estimated',
    note: 'The ISO R_c(1) test cinches the bag closed; a missing or unused draft collar leaks.',
  },
  {
    id: 'sleep.ventedOverPathFraction',
    value: DEFAULT_VENTED_OVER_PATH_FRACTION,
    units: 'fraction',
    provenance: 'estimated',
    note:
      "Stands in for ISO 23537's T_max (from R_c(2)), which 2022 demoted to informative Annex F " +
      'and which was never obtained. Only affects the warm end of the sleep comfort interval.',
  },
  {
    id: 'sleep.quiltLabelCorrection.cottage',
    value: 3,
    units: '°F added to the label',
    provenance: 'estimated',
    note: 'SPEC §2.5 / REFERENCE_warmth_check.md field folklore. Not physics, not measured.',
  },
  {
    id: 'sleep.quiltLabelCorrection.directImport',
    value: 10,
    units: '°F added to the label',
    provenance: 'estimated',
    note: 'SPEC §2.5 / REFERENCE_warmth_check.md field folklore. Not physics, not measured.',
  },
  {
    id: 'sleep.bagDrapeEfficiency',
    value: DEFAULT_BAG_DRAPE_EFFICIENCY,
    units: 'fraction of over-path',
    provenance: 'estimated',
    note: "Calibrated to REFERENCE_warmth_check.md's single '+2.5 clo draped' data point.",
  },
];

// ---------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------

export interface BagSpec {
  readonly kind: 'bag' | 'quilt';
  /** The temperature printed on the label, °C. */
  readonly ratingC: Celsius;
  /**
   * Which temperature that is. **Required: never inferred.** US brands label `limit`,
   * European brands `comfort` (STANDARDS §3.6).
   */
  readonly ratingType: LabelRatingType;
  /** Empirical label correction for quilts (`SPEC.md` §2.5). Ignored for `kind: 'bag'`. */
  readonly quiltProvenance?: QuiltProvenance;
  /** Hood drawn over the head and cinched, as the ISO R_c(1) test does. Default: bags yes, quilts no. */
  readonly hoodUsed?: boolean;
  /** Draft collar present and used. Default: bags yes, quilts no. */
  readonly draftCollar?: boolean;
}

export interface PadSpec {
  /** Imperial R-value from the hangtag (ASTM F3340-22 §3.2.9). */
  readonly imperialR: number;
  readonly label?: string;
}

export interface SleepSystemParameters {
  readonly underBodyAreaFraction?: number;
  readonly crushedBagRsi?: SquareMetreKelvinPerWatt;
  readonly headAreaFraction?: number;
  readonly inBagClothingEfficiency?: { readonly over: number; readonly under: number };
  readonly noDraftCollarPenaltyRsi?: SquareMetreKelvinPerWatt;
  readonly ventedOverPathFraction?: number;
  readonly relativeHumidity?: number;
}

export interface SleepSystemInput {
  readonly bag: BagSpec;
  /** The pads actually carried. Empty means sleeping on bare ground: modelled, and warned about. */
  readonly pads: readonly PadSpec[];
  /**
   * Clothing worn inside the bag, as catalogue clo. Only the excess over ISO 23537's reference
   * base layer (0.05 m²K/W ≈ 0.32 clo) counts: the label already includes that much.
   */
  readonly clothingInsideClo?: number;
  /** Headwear worn, catalogue clo, used only when the hood is not. */
  readonly headwearClo?: number;
  /**
   * Ground surface temperature minus air temperature, K.
   *
   * Default 0, which is `SPEC.md` §2.5's explicit v1 choice ("treat T_ground = T_a (night
   * minimum)"). ⚠️ It is also conservative: soil a few centimetres down carries the day's
   * heat and is usually *warmer* than the night-time air minimum in autumn, so a positive
   * offset is often the truth. Nothing in `docs/STANDARDS.md` quantifies it, so the default
   * stays at the SPEC's choice rather than at a number we made up.
   *
   * It enters as a conductance-weighted shift of the whole system's effective ambient
   * temperature, which reduces exactly to Annex C when the offset is 0.
   */
  readonly groundTemperatureOffsetK?: number;
  readonly parameters?: SleepSystemParameters;
}

export interface SleepSystemResult {
  /** Whole-system R_c(1)-equivalent of the user's actual system, m²K/W. */
  readonly systemRc: SquareMetreKelvinPerWatt;
  /** Whole-system R_c(1) the label implies, with the ISO reference mattress in place. */
  readonly labelRc: SquareMetreKelvinPerWatt;
  /** Over-path resistance, back-solved from the label, m²K/W. */
  readonly overPathRc: SquareMetreKelvinPerWatt;
  /** Under-path resistance with the user's actual pads, m²K/W. */
  readonly underPathRc: SquareMetreKelvinPerWatt;
  /** Under-path resistance with the ISO reference mattress, m²K/W. */
  readonly referenceUnderPathRc: SquareMetreKelvinPerWatt;
  readonly comfortC: Celsius;
  readonly limitC: Celsius;
  readonly extremeC: Celsius;
  /** What the label alone would predict, i.e. with the reference mattress. */
  readonly labelComfortC: Celsius;
  readonly labelLimitC: Celsius;
  /** `comfortC − labelComfortC`: kelvin of optimism in the label for *this* user's pad. */
  readonly padPenaltyK: number;
  /** Total pad R the user carries, imperial, and the reference it is measured against. */
  readonly padImperialR: number;
  readonly referencePadImperialR: number;
  /** The warm end: comfort temperature with the bag vented. */
  readonly ventedComfortC: Celsius;
  /** Share of total heat loss going down through the pad, 0..1. */
  readonly underPathHeatShare: number;
  readonly warnings: readonly ModelWarning[];
  readonly caveats: readonly string[];
}

function parallelSystemRc(
  paths: readonly { areaFraction: number; rsi: SquareMetreKelvinPerWatt }[],
): SquareMetreKelvinPerWatt {
  let conductance = 0;
  for (const p of paths) {
    if (p.rsi <= 0) {
      throw new ThermalModelError(
        'sleep_zero_path_resistance',
        'A parallel heat path has zero or negative resistance; the system would be infinitely cold.',
      );
    }
    conductance += p.areaFraction / p.rsi;
  }
  return 1 / conductance;
}

/**
 * Solve the whole sleep system.
 *
 * The method, which is the correction `MODEL.md` §6 asks for:
 *
 * 1. Convert the label to a whole-system `R_c(1)` through Annex C **in the direction the label
 *    states** (`T_lim` for US brands, `T_comf` for EU brands).
 * 2. Split the body into two parallel paths: over (bag loft + cavity + boundary layer) and
 *    under (crushed bag + mattress). Then back-solve the over-path such that the parallel combination
 *    with the **ISO reference mattress** reproduces the label's `R_c(1)`.
 * 3. Re-solve with the user's actual pads, plus any clothing worn, hood/draft-collar state.
 * 4. Run Annex C forward to get this user's comfort / limit / extreme temperatures.
 *
 * Most backpackers carry less than R 4.83, so for most users step 3 is a penalty: the label is
 * optimistic before the bag is even unpacked, and `padPenaltyK` says by how much.
 */
export function solveSleepSystem(input: SleepSystemInput): SleepSystemResult {
  const warnings: ModelWarning[] = [];
  const caveats: string[] = [];
  const p = input.parameters ?? {};
  const underArea = p.underBodyAreaFraction ?? DEFAULT_UNDER_BODY_AREA_FRACTION;
  const crushed = p.crushedBagRsi ?? DEFAULT_CRUSHED_BAG_RSI;
  const headArea = p.headAreaFraction ?? DEFAULT_HEAD_AREA_FRACTION;
  const clothingEff = p.inBagClothingEfficiency ?? DEFAULT_IN_BAG_CLOTHING_EFFICIENCY;
  const collarPenalty = p.noDraftCollarPenaltyRsi ?? DEFAULT_NO_DRAFT_COLLAR_PENALTY_RSI;
  const ventFraction = p.ventedOverPathFraction ?? DEFAULT_VENTED_OVER_PATH_FRACTION;
  const rh = p.relativeHumidity ?? ANNEX_C_RELATIVE_HUMIDITY;

  if (underArea <= 0 || underArea >= 1) {
    throw new ThermalModelError(
      'sleep_bad_area_fraction',
      `underBodyAreaFraction must be strictly between 0 and 1; got ${underArea}.`,
    );
  }

  // --- 1. Label → whole-system R_c(1) -------------------------------------------------
  const quiltProvenance = input.bag.kind === 'quilt' ? (input.bag.quiltProvenance ?? 'none') : 'none';
  if (input.bag.kind === 'quilt' && input.bag.quiltProvenance === undefined) {
    warnings.push(
      warn(
        'sleep_quilt_provenance_unspecified',
        'caution',
        "Quilt label provenance not given; no optimism correction applied. SPEC §2.5's " +
          '−3 °F (cottage) / −10 °F (direct-import) corrections are empirical field folklore, ' +
          'not measurements: set `quiltProvenance` deliberately.',
      ),
    );
  }
  const labelCorrectionK = QUILT_LABEL_CORRECTION_K[quiltProvenance];
  if (labelCorrectionK !== 0) {
    caveats.push(
      `Quilt label corrected by +${labelCorrectionK.toFixed(1)} K (${quiltProvenance}). ` +
        'This is an empirical correction from SPEC §2.5, not physics: nothing measures it.',
    );
  }
  const effectiveLabelC = input.bag.ratingC + labelCorrectionK;
  const labelRc = annexCResistance(effectiveLabelC, input.bag.ratingType, rh);

  if (labelRc < TABLE_1_RANGE.minRc || labelRc > TABLE_1_RANGE.maxRc) {
    warnings.push(
      warn(
        'sleep_outside_table_1',
        'out-of-range',
        `The label implies R_c(1) = ${labelRc.toFixed(3)} m²K/W, outside ISO 23537 Table 1's ` +
          `validated range ${TABLE_1_RANGE.minRc}–${TABLE_1_RANGE.maxRc} m²K/W. The 2022 edition's ` +
          'scope covers only bags rated to −20 °C and warmer; deep-winter bags are out of scope ' +
          'of the standard itself.',
      ),
    );
  }

  // --- 2. Back-solve the over-path against the reference mattress ----------------------
  const referenceUnderPathRc = crushed + REFERENCE_MATTRESS_RSI;
  const referenceUnderConductance = underArea / referenceUnderPathRc;
  const residualConductance = 1 / labelRc - referenceUnderConductance;
  if (residualConductance <= 0) {
    throw new ThermalModelError(
      'sleep_over_path_unsolvable',
      `A bag rated ${input.bag.ratingC} °C (${input.bag.ratingType}) is too warm to be explained ` +
        `by this parallel model: the reference mattress alone already conducts more heat than the ` +
        `whole rated system. Reduce underBodyAreaFraction (currently ${underArea}).`,
    );
  }
  const overPathRc = (1 - underArea) / residualConductance;

  // --- 3. Re-solve with the user's actual system ---------------------------------------
  const padImperialR = input.pads.reduce((s, pad) => s + pad.imperialR, 0);
  if (input.pads.length === 0) {
    warnings.push(
      warn(
        'sleep_no_pad',
        'caution',
        'No sleeping pad given. The model is being run with bare ground under you, which is far ' +
          'outside anything ISO 23537 tested.',
      ),
    );
  }
  if (input.pads.length > 1) {
    caveats.push(
      'Stacked pad R-values are added. ASTM F3340 says nothing about stacking, and ' +
        '`docs/STANDARDS.md` §4.6 found **no published measurement anywhere** of a stacked pair ' +
        'against the sum of its parts: additivity is asserted by Therm-a-Rest, NEMO and the ' +
        "standard's own authors, and never published as data. Their one qualifier: it holds " +
        'only if there is no air gap between the pads.',
    );
    warnings.push(
      warn(
        'sleep_pad_additivity_unmeasured',
        'caution',
        'Pad R-value additivity is an unmeasured assumption (STANDARDS §4.6, §7.1 item 6).',
      ),
    );
  }

  const extraClothingRsi = Math.max(0, (input.clothingInsideClo ?? 0) * CLO - REFERENCE_BASE_LAYER_RSI);
  const hoodUsed = input.bag.hoodUsed ?? input.bag.kind === 'bag';
  const draftCollar = input.bag.draftCollar ?? input.bag.kind === 'bag';

  let userOverPath = overPathRc + extraClothingRsi * clothingEff.over;
  if (!draftCollar) {
    userOverPath = Math.max(1e-3, userOverPath - collarPenalty);
    caveats.push(
      'No draft collar, or not used. The ISO R_c(1) test cinches the bag fully closed, so the ' +
        'label assumes one; the penalty applied here is estimated, not measured.',
    );
  }
  const userUnderPath = crushed + imperialRToSI(padImperialR) + extraClothingRsi * clothingEff.under;

  const paths: { areaFraction: number; rsi: SquareMetreKelvinPerWatt }[] = [];
  if (hoodUsed) {
    paths.push({ areaFraction: underArea, rsi: userUnderPath });
    paths.push({ areaFraction: 1 - underArea, rsi: userOverPath });
  } else {
    const headRsi = (input.headwearClo ?? 0) * CLO + STATIC_BOUNDARY_RSI;
    paths.push({ areaFraction: underArea, rsi: userUnderPath });
    paths.push({ areaFraction: headArea, rsi: headRsi });
    paths.push({ areaFraction: 1 - underArea - headArea, rsi: userOverPath });
    caveats.push(
      'No hood over the head. ISO 23537 measures R_c(1) with the hood drawn over the head and ' +
        'cinched as far as the cords allow, so a quilt (or an unused hood) loses a path the ' +
        'rating assumed was closed. Head area fraction is estimated.',
    );
  }

  const systemRc = parallelSystemRc(paths);

  // The ground is not necessarily at air temperature. Weight the two ambient temperatures by
  // the conductance of the path that sees each: with a zero offset this is exactly Annex C.
  const totalConductance = paths.reduce((sum, path) => sum + path.areaFraction / path.rsi, 0);
  const underPathHeatShare = underArea / userUnderPath / totalConductance;
  const groundOffsetK = input.groundTemperatureOffsetK ?? 0;
  const ambientShiftK = underPathHeatShare * groundOffsetK;

  // --- 4. Forward through Annex C -------------------------------------------------------
  const comfortC = annexCTemperature(systemRc, 'comfort', rh) - ambientShiftK;
  const limitC = annexCTemperature(systemRc, 'limit', rh) - ambientShiftK;
  const extremeC = annexCTemperature(systemRc, 'extreme', rh) - ambientShiftK;
  const labelComfortC = annexCTemperature(labelRc, 'comfort', rh);
  const labelLimitC = annexCTemperature(labelRc, 'limit', rh);

  const ventedPaths = paths.map((path) =>
    path.rsi === userOverPath ? { ...path, rsi: userOverPath * ventFraction } : path,
  );
  const ventedComfortC = annexCTemperature(parallelSystemRc(ventedPaths), 'comfort', rh) - ambientShiftK;

  caveats.push(
    'ISO 23537 computes T_comf and T_ext for a "standard woman" and T_lim for a "standard man" ' +
      '(STANDARDS §3.4). The three numbers on a label are not three points on one person\'s curve.',
    'R_c(1) is the whole system: bag, cavity air, boundary layer, the reference mattress ' +
      '(R_ct 0.85 m²K/W ≈ R 4.83) and a base layer. A pad R-value is never added on top of a ' +
      'bag rating; this model takes the difference from the reference instead.',
  );

  if (padImperialR < REFERENCE_MATTRESS_IMPERIAL_R - 0.05) {
    warnings.push(
      warn(
        'sleep_pad_below_reference',
        'info',
        `Your pads total R ${padImperialR.toFixed(1)}, below the R ${REFERENCE_MATTRESS_IMPERIAL_R.toFixed(2)} ` +
          'reference mattress baked into the bag rating. The label is optimistic for you before ' +
          'the bag is even unpacked.',
      ),
    );
  }

  return {
    systemRc,
    labelRc,
    overPathRc,
    underPathRc: userUnderPath,
    referenceUnderPathRc,
    comfortC,
    limitC,
    extremeC,
    labelComfortC,
    labelLimitC,
    padPenaltyK: comfortC - labelComfortC,
    padImperialR,
    referencePadImperialR: REFERENCE_MATTRESS_IMPERIAL_R,
    ventedComfortC,
    underPathHeatShare,
    warnings,
    caveats,
  };
}

/**
 * The bag as a blanket over your shoulders while sitting in camp: a *clothed*-phase term, so
 * it returns catalogue clo for the ISO 11079 side of the engine.
 *
 * ⚠️ Empirical. See {@link DEFAULT_BAG_DRAPE_EFFICIENCY}.
 */
export function bagAsBlanketClo(bag: BagSpec, efficiency = DEFAULT_BAG_DRAPE_EFFICIENCY): number {
  const system = solveSleepSystem({ bag, pads: [{ imperialR: REFERENCE_MATTRESS_IMPERIAL_R }] });
  return siToClo(system.overPathRc * efficiency);
}

/** Convenience: total pad resistance, both ways. */
export function padResistance(pads: readonly PadSpec[]): {
  imperialR: number;
  rsi: SquareMetreKelvinPerWatt;
  clo: number;
} {
  const imperialR = pads.reduce((s, p) => s + p.imperialR, 0);
  const rsi = imperialRToSI(imperialR);
  return { imperialR, rsi, clo: siToClo(rsi) };
}

/** Round-trip helper for the UI: °C → °F on a rating. */
export const ratingInFahrenheit = (c: Celsius): number => celsiusToFahrenheit(c);

/** Exposed so tests can assert the reference mattress really is R 4.83. */
export const referenceMattressImperialR = (): number => siToImperialR(REFERENCE_MATTRESS_RSI);
