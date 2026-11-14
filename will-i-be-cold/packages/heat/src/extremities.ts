/**
 * Local comfort for hands, feet and head: `SPEC.md` §2.4.
 *
 * 🔴 **Say this out loud, because it is the weakest part of the engine.**
 * `docs/STANDARDS.md` contains **nothing rigorous on local cooling**. ISO 11079's full title
 * ends "… and local cooling effects", but its Annexes A–F are past the end of every public
 * preview (STANDARDS §7.2 item 9), so the standard's own local-cooling criteria (wind-chill
 * index, finger/toe temperature limits, contact-cooling limits) were never obtained. Nothing
 * else in the document covers extremities at all.
 *
 * So this module is an **explicit heuristic**, not a standard. It is built from a local
 * steady-state balance, which gives it the right *shape* (colder air and lower blood flow both
 * raise the requirement), and the inputs to that balance (local skin-temperature thresholds,
 * local heat fluxes, segment area fractions) are **estimated by us**. Every result carries
 * `rigour: 'heuristic'`, and the verdicts are deliberately coarse.
 *
 * The one thing it is *not* is dressed up: no clause numbers, no claimed validation.
 */

import { CLO, clamp, type Celsius, type SquareMetreKelvinPerWatt, type WattsPerSquareMetre } from './units.js';
import type { ModelWarning, UnverifiedConstant, Verdict } from './types.js';
import { warn } from './types.js';
import { STATIC_BOUNDARY_RSI } from './sleep.js';

export type ExtremityPart = 'hands' | 'feet' | 'head';

/**
 * Per-part heuristic parameters. **All `estimated`.**
 *
 * `areaFraction` turns whole-body catalogue clo (which is area-weighted: that is what ISO
 * 9920's `I_clu` means) into *local* insulation: `I_local = I_clu / areaFraction`.
 *
 * `targetSkinC` is the local skin temperature below which people report the part as "cold".
 * `fluxVasoconstricted` / `fluxOpen` are the local heat fluxes per unit *local* area, which is
 * where the physiology lives: hands and feet shut down under vasoconstriction (flux falls, so
 * the insulation needed to hold the target rises), while the head does not vasoconstrict and
 * keeps a high flux throughout.
 *
 * **Calibration sanity check, not a validation:** at an operative temperature of 0 °C the
 * heuristic says liner gloves (0.05 clo whole-body ≈ 1.0 clo local) are not enough and
 * insulated mitts (0.25 clo ≈ 5 clo local) are about the threshold; it says a beanie
 * (0.10 clo ≈ 1.4 clo local) is about the threshold for the head; and it says trail runners
 * plus midweight socks leave the feet short. Those all match field experience. That is the
 * only evidence there is for these numbers.
 */
export interface ExtremityParameters {
  readonly areaFraction: number;
  readonly targetSkinC: Celsius;
  readonly fluxVasoconstricted: WattsPerSquareMetre;
  readonly fluxOpen: WattsPerSquareMetre;
  readonly note: string;
}

export const EXTREMITY_PARAMETERS: Readonly<Record<ExtremityPart, ExtremityParameters>> = {
  hands: {
    areaFraction: 0.05,
    targetSkinC: 20,
    fluxVasoconstricted: 25,
    fluxOpen: 70,
    note:
      'Both hands ≈ 5 % of body surface. 20 °C is around where people call hands cold; manual ' +
      'dexterity is commonly said to go at ~15 °C and numbness below that. Flux range spans ' +
      'full vasoconstriction to warm, working hands. All estimated.',
  },
  feet: {
    areaFraction: 0.07,
    targetSkinC: 21,
    fluxVasoconstricted: 25,
    fluxOpen: 55,
    note:
      'Both feet ≈ 7 % of body surface. Feet vasoconstrict like hands but sit in a boot that ' +
      'traps sweat, so the open-flux end is lower. All estimated.',
  },
  head: {
    areaFraction: 0.07,
    targetSkinC: 30,
    fluxVasoconstricted: 85,
    fluxOpen: 110,
    note:
      'Head ≈ 7 % of body surface. The head is the part that does **not** vasoconstrict much: ' +
      'flux stays high, which is why a bare head loses heat out of proportion to its area and ' +
      'why a beanie is the best clo-per-gram in the pack. All estimated.',
  },
};

/**
 * ⚠️ Estimated. Whole-body comfort margin (clo) at which the extremities are considered fully
 * perfused. Below zero margin they are fully vasoconstricted. The linear ramp between is a
 * modelling convenience, not a physiological curve.
 */
export const VASOCONSTRICTION_MARGIN_CLO = 0.5;

/**
 * ⚠️ Estimated. Extra local flux from working the part (swinging arms, walking), as a fraction
 * of the open-vs-constricted span, per met above resting.
 */
export const ACTIVITY_PERFUSION_PER_MET = 0.25;

export const EXTREMITY_UNVERIFIED_CONSTANTS: readonly UnverifiedConstant[] = (
  ['hands', 'feet', 'head'] as const
).flatMap((part) => {
  const p = EXTREMITY_PARAMETERS[part];
  return [
    {
      id: `extremities.${part}.areaFraction`,
      value: p.areaFraction,
      units: 'fraction of body surface',
      provenance: 'estimated' as const,
      note: p.note,
    },
    {
      id: `extremities.${part}.targetSkinC`,
      value: p.targetSkinC,
      units: '°C',
      provenance: 'estimated' as const,
      note: 'Local skin temperature taken as the threshold of "cold". No source in docs/STANDARDS.md.',
    },
    {
      id: `extremities.${part}.fluxVasoconstricted`,
      value: p.fluxVasoconstricted,
      units: 'W/m² of local area',
      provenance: 'estimated' as const,
      note: 'Local heat flux under full vasoconstriction. No source in docs/STANDARDS.md.',
    },
  ];
});

/**
 * ⚠️ Estimated. The marginal band, in clo of *local* insulation. 0.5 local clo is roughly the
 * difference between liner gloves and light gloves: about the smallest change a person
 * notices on a hand.
 */
export const LOCAL_MARGINAL_BAND_CLO = 0.5;

/** ⚠️ Estimated. How many marginal bands above the requirement counts as "too warm". */
export const VERDICT_BAND_MULTIPLES = { tooWarm: 8 } as const;

export interface ExtremityInput {
  readonly part: ExtremityPart;
  /** Operative temperature at the body, °C (from `environment.ts`). */
  readonly operativeTemperatureC: Celsius;
  /** Catalogue clo actually worn on that part (whole-body-equivalent, as ISO 9920 defines it). */
  readonly wornClo: number;
  /**
   * The whole-body comfort margin in clo from the core model. Drives vasoconstriction: this
   * is the coupling `SPEC.md` §2.4 asks for ("vasoconstriction shuts them down when the core
   * is marginal"), and it is why extremity verdicts are reported *independently* of the core
   * verdict but not *independently* of the core state.
   */
  readonly coreMarginClo: number;
  /** Metabolic rate, met. Working hands are warmer hands. */
  readonly met: number;
  /** Wind reaching the part, m/s. Shrinks the boundary layer. */
  readonly airVelocity?: number;
  /** A windproof shell/mitt over the part removes the wind penalty. */
  readonly windproof?: boolean;
}

export interface ExtremityResult {
  readonly part: ExtremityPart;
  /** Always `'heuristic'`. There is no standard behind this number. */
  readonly rigour: 'heuristic';
  readonly verdict: Verdict;
  /** Local insulation required to hold the target skin temperature, m²K/W of local area. */
  readonly requiredLocalRsi: SquareMetreKelvinPerWatt;
  /** The same expressed as whole-body catalogue clo, so it can be compared to the ontology. */
  readonly requiredClo: number;
  readonly wornClo: number;
  readonly marginClo: number;
  /** Local heat flux assumed, W/m² of local area. */
  readonly localFlux: WattsPerSquareMetre;
  readonly warnings: readonly ModelWarning[];
  readonly caveat: string;
}

const HEURISTIC_CAVEAT =
  'Extremity verdicts are a heuristic, not a standard. docs/STANDARDS.md contains nothing ' +
  "rigorous on local cooling (ISO 11079's local-cooling annexes were never obtained), so the " +
  'local skin-temperature thresholds, local heat fluxes and segment area fractions here are all ' +
  'estimated. Treat them as a flag worth acting on, not as a number.';

/**
 * Local boundary-layer resistance, m²K/W. Still air uses ISO 9920's static 0.109 m²K/W; wind
 * shrinks it on the same `1/(h_c + h_r)` basis the whole-body model uses. ⚠️ Applying a
 * whole-body boundary-layer correlation to a hand is itself an approximation.
 */
function localBoundaryRsi(airVelocity: number, windproof: boolean): SquareMetreKelvinPerWatt {
  if (windproof) return STATIC_BOUNDARY_RSI;
  const v = Math.max(0.05, airVelocity);
  const hc = v <= 1 ? 3.5 + 5.2 * v : 8.7 * Math.pow(v, 0.6);
  const hr = 4.0; // local radiant coefficient at near-freezing; see ireq.ts for why not 4.7.
  return 1 / (hc + hr);
}

export function assessExtremity(input: ExtremityInput): ExtremityResult {
  const p = EXTREMITY_PARAMETERS[input.part];
  const warnings: ModelWarning[] = [];

  const perfusion = clamp(
    clamp(input.coreMarginClo / VASOCONSTRICTION_MARGIN_CLO, 0, 1) +
      ACTIVITY_PERFUSION_PER_MET * Math.max(0, input.met - 1.1),
    0,
    1,
  );
  const localFlux = p.fluxVasoconstricted + perfusion * (p.fluxOpen - p.fluxVasoconstricted);

  const boundary = localBoundaryRsi(input.airVelocity ?? 0.1, input.windproof === true);
  const totalRequired = (p.targetSkinC - input.operativeTemperatureC) / localFlux;
  const requiredLocalRsi = Math.max(0, totalRequired - boundary);
  const requiredClo = (requiredLocalRsi / CLO) * p.areaFraction;

  const marginClo = input.wornClo - requiredClo;
  // Thresholds are stated in *local* clo and scaled by area fraction, so "marginal" means the
  // same thing on a hand as on a head. ⚠️ The multipliers are estimated like everything else here.
  const band = LOCAL_MARGINAL_BAND_CLO * p.areaFraction;
  // ⚠️ This model never returns `dangerous`. Frostbite and contact-cooling limits live in
  // ISO 11079's local-cooling annexes, which `docs/STANDARDS.md` §7.2 item 9 records as never
  // obtained, so there is no criterion here to justify the word, and a heuristic should not
  // invent one. `cold` is as far as it goes.
  let verdict: Verdict;
  if (marginClo < -band) verdict = 'cold';
  else if (marginClo <= band) verdict = 'marginal';
  else if (marginClo > VERDICT_BAND_MULTIPLES.tooWarm * band) verdict = 'too_warm';
  else verdict = 'fine';

  if (input.coreMarginClo < 0 && verdict !== 'fine') {
    warnings.push(
      warn(
        'extremity_core_coupled',
        'info',
        // Deliberately names no single part: this fires for hands, feet and head together, and
        // three copies of one sentence differing only by body part reads as a bug. The per-part
        // verdict already says which parts are cold; `coverage()` dedupes identical warnings.
        `Your core is already short by ${(-input.coreMarginClo).toFixed(1)} clo, so the model has ` +
          'your extremities vasoconstricted. Fixing the core insulation is usually the fix, not ' +
          'more gloves, socks or a warmer hat.',
      ),
    );
  }

  return {
    part: input.part,
    rigour: 'heuristic',
    verdict,
    requiredLocalRsi,
    requiredClo,
    wornClo: input.wornClo,
    marginClo,
    localFlux,
    warnings,
    caveat: HEURISTIC_CAVEAT,
  };
}

/** All three parts at once. */
export function assessExtremities(
  base: Omit<ExtremityInput, 'part' | 'wornClo'>,
  wornClo: Readonly<Record<ExtremityPart, number>>,
): readonly ExtremityResult[] {
  return (['hands', 'feet', 'head'] as const).map((part) =>
    assessExtremity({ ...base, part, wornClo: wornClo[part] }),
  );
}
