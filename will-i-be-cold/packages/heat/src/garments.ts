/**
 * The `SPEC.md` §4 gear ontology, with clo values, provenance, and the ISO 9920 ensemble rule.
 *
 * ⚠️ **Read this before trusting a number in the catalogue.** ISO 9920's Annex A (the actual
 * garment and ensemble insulation tables) is past the end of every free preview and was never
 * obtained (`docs/STANDARDS.md` §7.2 item 10). So:
 *
 * - Items that exist in ASHRAE 55 / ISO 7730 Annex C's widely-published garment list (briefs,
 *   T-shirt, long-sleeve shirt, trousers, shorts) are marked `ashrae`.
 * - Everything technical and outdoor (fleece, Alpha Direct, puffies, shells) is marked
 *   `estimated`. These are `SPEC.md` §4 / `REFERENCE_warmth_check.md` values, described there
 *   as "standard ASHRAE-style values adjusted for outdoor garments". They are plausible and
 *   internally consistent; they are not measurements.
 *
 * The ensemble rule itself (`I_cl = 0.161 + 0.835·ΣI_clu`) *is* verified standard text.
 */

import { CLO, cloToSI, type SquareMetreKelvinPerWatt } from './units.js';
import {
  ThermalModelError,
  warn,
  type ModelWarning,
  type Provenance,
  type UnverifiedConstant,
} from './types.js';

export type BodyRegion = 'head' | 'torso' | 'legs' | 'hands' | 'feet';
export type LayerSlot = 'inner' | 'outer';

/**
 * What the garment is made of: drives the wet-weather derate (`SPEC.md` §2.7).
 * ⚠️ The derate factors are `estimated`; nothing in `docs/STANDARDS.md` covers wet insulation.
 */
export type GarmentMaterial =
  | 'down'
  | 'synthetic-fill'
  | 'fleece'
  | 'wool'
  | 'synthetic-base'
  | 'shell'
  | 'other';

export interface Garment {
  readonly id: string;
  readonly label: string;
  readonly region: BodyRegion;
  readonly slot: LayerSlot;
  /** Effective insulation of the individual garment, clo (ISO 9920's `I_clu`). */
  readonly clo: number;
  readonly material: GarmentMaterial;
  readonly provenance: Provenance;
  /** True for wind/rain shells: they must sit outermost, and they zero the pumping term. */
  readonly isShell?: boolean;
  /** True for insulated "puffy" layers; SPEC §4 allows two. */
  readonly isPuffy?: boolean;
  /** True if windproof enough to set the internal air velocity to ~0 (ISO 11079 small `a_p`). */
  readonly windproof?: boolean;
  /** Approximate mass, g. Used only for the "carried weight" line in `SPEC.md` §5. */
  readonly grams?: number;
  /**
   * Fraction of this garment's `clo` that can be shed **without taking it off**: unzipped,
   * sleeves pushed up, pit zips open, hood down, worn open. 0 = binary, 1 = the whole
   * contribution is an adjustment. Omitted ⇒ {@link ADJUSTABILITY_DEFAULTS} for its class.
   *
   * ⚠️ **Every value here and in the class table is `estimated`**: see
   * {@link ADJUSTABILITY_DEFAULTS}.
   */
  readonly adjustability?: number;
  readonly note?: string;
}

const g = (
  id: string,
  label: string,
  region: BodyRegion,
  slot: LayerSlot,
  clo: number,
  material: GarmentMaterial,
  provenance: Provenance,
  extra: Partial<Garment> = {},
): Garment => ({ id, label, region, slot, clo, material, provenance, ...extra });

/**
 * `SPEC.md` §4's v1 ontology. Every clo value is traceable to `SPEC.md` §4 or
 * `REFERENCE_warmth_check.md`; the `provenance` field says how much that is worth.
 */
export const GARMENTS: readonly Garment[] = [
  // --- Head ---------------------------------------------------------------------------
  g('sun_hat', 'Sun hat', 'head', 'outer', 0.01, 'other', 'estimated'),
  g('beanie', 'Beanie', 'head', 'outer', 0.1, 'fleece', 'estimated', {
    note: 'REFERENCE_warmth_check.md garment table.',
  }),
  g('balaclava', 'Balaclava', 'head', 'outer', 0.18, 'fleece', 'estimated'),
  g('jacket_hood', 'Hood up (fleece or puffy)', 'head', 'outer', 0.1, 'other', 'estimated', {
    // The *whole* of this garment is an adjustment: the hood is attached to a jacket you are
    // already wearing, so putting it down sheds all of it without removing anything.
    adjustability: 1,
    note: 'REFERENCE_warmth_check.md: "Hood up on a fleece or puffy: +0.1".',
  }),

  // --- Torso, inner -------------------------------------------------------------------
  g('tee', 'T-shirt', 'torso', 'inner', 0.08, 'synthetic-base', 'ashrae', {
    // A T-shirt has no zip, no pit zips and no sleeves to push up. It is the one genuinely
    // binary garment in the catalogue.
    adjustability: 0,
    note: 'ASHRAE 55 / ISO 7730 Annex C garment list: T-shirt 0.08 clo.',
  }),
  g('ls_synthetic', 'Long-sleeve synthetic sun hoodie', 'torso', 'inner', 0.25, 'synthetic-base', 'ashrae', {
    note: 'ASHRAE 55 / ISO 7730 Annex C: long-sleeve shirt 0.25 clo.',
  }),
  g('ls_merino_light', 'Merino base layer, light (150–200 g/m²)', 'torso', 'inner', 0.3, 'wool', 'estimated'),
  g('merino_mid', 'Merino mid-weight', 'torso', 'inner', 0.4, 'wool', 'estimated'),
  g('grid_fleece', 'Grid fleece hoodie (R1-style)', 'torso', 'inner', 0.5, 'fleece', 'estimated'),

  // --- Torso, outer -------------------------------------------------------------------
  g('fleece_200', 'Fleece 200', 'torso', 'outer', 0.5, 'fleece', 'estimated'),
  g('fleece_300', 'Fleece 300', 'torso', 'outer', 0.6, 'fleece', 'estimated'),
  g('alpha_60', 'Polartec Alpha Direct 60 top', 'torso', 'outer', 0.45, 'synthetic-fill', 'estimated'),
  g('alpha_90', 'Polartec Alpha Direct 90 top', 'torso', 'outer', 0.55, 'synthetic-fill', 'estimated'),
  g('synth_puffy_60', 'Synthetic puffy, 60 g/m²', 'torso', 'outer', 0.9, 'synthetic-fill', 'estimated', {
    isPuffy: true,
  }),
  g('synth_puffy_100', 'Synthetic puffy, 100 g/m²', 'torso', 'outer', 1.3, 'synthetic-fill', 'estimated', {
    isPuffy: true,
  }),
  g('down_puffy_2oz', 'Down puffy, ~2 oz fill', 'torso', 'outer', 1.2, 'down', 'estimated', {
    isPuffy: true,
  }),
  g('down_puffy_3oz', 'Hooded down puffy, ~3 oz fill', 'torso', 'outer', 1.8, 'down', 'estimated', {
    isPuffy: true,
    note: 'The "cheapest fix" garment in REFERENCE_warmth_check.md\'s worked example.',
  }),
  g('down_puffy_45oz', 'Down puffy, ~4.5 oz fill', 'torso', 'outer', 2.3, 'down', 'estimated', {
    isPuffy: true,
  }),
  g('wind_shirt', 'Wind shirt', 'torso', 'outer', 0.15, 'shell', 'estimated', {
    isShell: true,
    windproof: true,
  }),
  g('rain_shell', 'Rain shell jacket', 'torso', 'outer', 0.2, 'shell', 'estimated', {
    isShell: true,
    windproof: true,
  }),
  g('ski_shell', 'Mesh-lined ski shell', 'torso', 'outer', 0.4, 'shell', 'estimated', {
    isShell: true,
    windproof: true,
  }),

  // --- Legs, inner --------------------------------------------------------------------
  g('briefs', 'Briefs', 'legs', 'inner', 0.04, 'synthetic-base', 'ashrae', {
    note: 'ASHRAE 55 / ISO 7730 Annex C: underpants 0.04 clo.',
  }),
  g('long_underwear', 'Long underwear bottoms', 'legs', 'inner', 0.3, 'wool', 'estimated'),
  g('alpha_leggings', 'Alpha Direct 90 leggings', 'legs', 'inner', 0.55, 'synthetic-fill', 'estimated'),
  g('fleece_pants_inner', 'Fleece pants (as a base)', 'legs', 'inner', 0.5, 'fleece', 'estimated'),

  // --- Legs, outer --------------------------------------------------------------------
  g('shorts', 'Shorts', 'legs', 'outer', 0.08, 'synthetic-base', 'ashrae'),
  g('tights', 'Running tights', 'legs', 'outer', 0.15, 'synthetic-base', 'estimated'),
  g('hiking_pants', 'Light hiking pants', 'legs', 'outer', 0.25, 'synthetic-base', 'ashrae', {
    note: 'ASHRAE 55 / ISO 7730 Annex C: trousers 0.25 clo.',
  }),
  g('softshell_pants', 'Softshell pants', 'legs', 'outer', 0.35, 'shell', 'estimated'),
  g('fleece_lined_pants', 'Fleece-lined pants', 'legs', 'outer', 0.5, 'fleece', 'estimated'),
  g('rain_pants', 'Rain shell pants', 'legs', 'outer', 0.2, 'shell', 'estimated', {
    isShell: true,
    windproof: true,
  }),
  g('snow_pants', 'Snow pants', 'legs', 'outer', 0.6, 'synthetic-fill', 'estimated', {
    isShell: true,
    windproof: true,
  }),

  // --- Hands --------------------------------------------------------------------------
  // Hands have **one slot**, like the head. A separate inner slot was not pulling its weight:
  // it existed only to let a liner pair sit under a warmer pair, and the layering ladder can
  // show that combination on its own (see `coverage.ts` `handsStack`). Liners are therefore
  // catalogued like every other pair of gloves.
  g('liner_gloves', 'Liner gloves', 'hands', 'outer', 0.05, 'synthetic-base', 'estimated'),
  g('gloves_40', 'Thinsulate 40 g gloves', 'hands', 'outer', 0.1, 'synthetic-fill', 'estimated'),
  g('gloves_100', 'Thinsulate 100 g gloves', 'hands', 'outer', 0.15, 'synthetic-fill', 'estimated'),
  g('mitts', 'Insulated mitts', 'hands', 'outer', 0.25, 'synthetic-fill', 'estimated'),
  g('rain_mitts', 'Rain mitts (over gloves)', 'hands', 'outer', 0.05, 'shell', 'estimated', {
    isShell: true,
    windproof: true,
  }),

  // --- Feet ---------------------------------------------------------------------------
  g('socks_light', 'Light socks', 'feet', 'inner', 0.02, 'wool', 'estimated'),
  g('socks_mid', 'Midweight socks', 'feet', 'inner', 0.03, 'wool', 'estimated'),
  g('socks_heavy', 'Heavy socks', 'feet', 'inner', 0.05, 'wool', 'estimated'),
  g('vbl_socks', 'Vapour-barrier socks', 'feet', 'inner', 0.05, 'shell', 'estimated', {
    note: 'SPEC §2.7: VBL socks restore insulation that would otherwise be lost to sweat.',
  }),
  g('trail_runners', 'Trail runners', 'feet', 'outer', 0.08, 'other', 'estimated'),
  g('boots', 'Hiking boots', 'feet', 'outer', 0.1, 'other', 'estimated', {
    note: 'REFERENCE_warmth_check.md lists "wool socks + hiking boots" combined at 0.10.',
  }),
  g('insulated_boots', 'Insulated winter boots', 'feet', 'outer', 0.3, 'synthetic-fill', 'estimated'),
  g('camp_sandals', 'Camp sandals', 'feet', 'outer', 0, 'other', 'estimated'),
];

const BY_ID: ReadonlyMap<string, Garment> = new Map(GARMENTS.map((x) => [x.id, x]));

export function garment(id: string): Garment {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new ThermalModelError('unknown_garment', `No garment with id "${id}" in the v1 ontology.`);
  }
  return found;
}

export const garmentIds = (): readonly string[] => GARMENTS.map((x) => x.id);

// ---------------------------------------------------------------------------------------
// Adjustability: the fraction of a garment you can shed without taking it off
// ---------------------------------------------------------------------------------------

/**
 * How adjustable a garment is, as a class. Drives {@link ADJUSTABILITY_DEFAULTS}.
 *
 * The distinction that matters is **how much of the garment's insulation depends on it being
 * closed**: a full-zip fleece worn open has lost the still-air layer over the whole chest; a
 * pull-on base layer worn "open" is still a pull-on base layer.
 */
export type GarmentAdjustabilityClass =
  | 'base-layer'
  | 'full-zip-mid'
  | 'insulated-jacket'
  | 'shell'
  | 'pants'
  | 'headwear'
  | 'handwear'
  | 'footwear';

/**
 * ⚠️ **All `estimated`. None of these numbers is in `docs/STANDARDS.md`.**
 *
 * ISO 9920 does tabulate garments worn open versus closed, and ISO 9920 §8.1 states the
 * mechanism in its own words (verbatim, via `docs/STANDARDS.md` §2.6): *"The influence of wind
 * depends on the air permeability of the outer textile layer and on **the types and number of
 * openings**"*. But the table itself is in **Annex A, which `docs/STANDARDS.md` §7.2 item 10
 * records as never obtained** ("ISO 9920 past page 13, including Annexes A–C: the actual
 * garment and ensemble insulation tables"). So the standard supports the *existence* of the
 * open/closed split and gives us no numbers for it.
 *
 * These are therefore our own per-class estimates, every one of them registered in
 * {@link GARMENT_UNVERIFIED_CONSTANTS} and overridable per garment through
 * {@link Garment.adjustability}. The *ordering* is the defensible part and follows from what is
 * physically being adjusted:
 *
 * | class | value | what you are actually doing |
 * |---|---|---|
 * | `base-layer` | 0.05 | push the sleeves up, open a quarter-zip collar. Almost nothing. |
 * | `full-zip-mid` | 0.35 | a full-length zip opened over the whole chest, hood down. |
 * | `insulated-jacket` | 0.30 | main zip, pit zips, hood down, but the loft stays on your arms and back. |
 * | `shell` | 0.15 | **mostly binary**: most of a shell's clo is windproofing, which an open zip does not remove. |
 * | `pants` | 0.10 | roll the cuffs, open side zips. |
 * | `headwear` | 0.30 | push a beanie back off the ears, pull a balaclava down off the face. |
 * | `handwear` | 0 | gloves are binary: taking them off is removal, which is a different rung. |
 * | `footwear` | 0 | binary. |
 *
 * See also {@link DRAPED_ADJUSTABILITY}, which is much larger and for the same reason: a quilt
 * over the shoulders is nearly all adjustment.
 */
export const ADJUSTABILITY_DEFAULTS: Readonly<Record<GarmentAdjustabilityClass, number>> = {
  'base-layer': 0.05,
  'full-zip-mid': 0.35,
  'insulated-jacket': 0.3,
  shell: 0.15,
  pants: 0.1,
  headwear: 0.3,
  handwear: 0,
  footwear: 0,
};

/**
 * ⚠️ **Estimated.** Fraction of a draped bag/quilt's contribution (`SPEC.md` §5's
 * bag-as-blanket) that can be shed without putting it away: let it slide off a shoulder, open
 * it across the front, drape it over the knees only. The brief case for the largest value in
 * the table: a quilt over the shoulders is held on by nothing and is adjustable in a continuum
 * all the way down to "folded on the log next to you".
 */
export const DRAPED_ADJUSTABILITY = 0.6;

/** Which adjustability class a garment falls in, from its own catalogue fields. */
export function adjustabilityClass(item: Garment): GarmentAdjustabilityClass {
  if (item.isShell === true) return 'shell';
  if (item.isPuffy === true) return 'insulated-jacket';
  if (item.region === 'head') return 'headwear';
  if (item.region === 'hands') return 'handwear';
  if (item.region === 'feet') return 'footwear';
  if (item.region === 'legs') return item.slot === 'inner' ? 'base-layer' : 'pants';
  // Torso. A fleece or an active-insulation top is a full-zip mid layer wherever the ontology
  // happens to slot it: `grid_fleece` is catalogued as an inner and is still a full-zip hoodie.
  return item.material === 'fleece' || item.material === 'synthetic-fill'
    ? 'full-zip-mid'
    : 'base-layer';
}

/**
 * Fraction of this garment's clo that can be vented away without removing it: its own
 * {@link Garment.adjustability} when the catalogue states one, otherwise its class default.
 */
export function garmentAdjustability(item: Garment): number {
  const own = item.adjustability;
  if (own !== undefined) return Math.min(1, Math.max(0, own));
  return ADJUSTABILITY_DEFAULTS[adjustabilityClass(item)];
}

/** Clo this garment can shed without being taken off. */
export const garmentVentableClo = (item: Garment): number => item.clo * garmentAdjustability(item);

export const GARMENT_UNVERIFIED_CONSTANTS: readonly UnverifiedConstant[] = [
  ...(Object.keys(ADJUSTABILITY_DEFAULTS) as GarmentAdjustabilityClass[]).map<UnverifiedConstant>(
    (cls) => ({
      id: `garments.adjustability.${cls}`,
      value: ADJUSTABILITY_DEFAULTS[cls],
      units: 'fraction of the garment’s clo',
      provenance: 'estimated',
      note:
        `Fraction of a ${cls.replace(/-/g, ' ')}'s insulation that can be shed without taking it ` +
        'off (unzipped, sleeves up, pit zips, hood down). ISO 9920 tabulates garments worn open ' +
        'vs closed in Annex A, which docs/STANDARDS.md §7.2 item 10 records as never obtained; ' +
        'ISO 9920 §8.1 confirms only that "the types and number of openings" matter. The ' +
        'ordering across classes is physical; the magnitudes are ours. This number sets how far ' +
        'a configuration\'s comfort interval extends upward in temperature: it never moves the ' +
        'cold limit.',
    }),
  ),
  {
    id: 'garments.adjustability.draped',
    value: DRAPED_ADJUSTABILITY,
    units: 'fraction of the drape’s clo',
    provenance: 'estimated',
    note:
      'Fraction of a bag/quilt draped over the shoulders (SPEC §5) that can be shed without ' +
      'putting it away. The largest adjustability in the engine, because a drape is held on by ' +
      'nothing. No measurement exists; REFERENCE_warmth_check.md only calls the drape "leaky".',
  },
];

// ---------------------------------------------------------------------------------------
// Ensemble insulation
// ---------------------------------------------------------------------------------------

/**
 * ISO 9920:2007 **Equation (11)**, verbatim: `I_cl = 0.161 + 0.835·Σ I_clu` [clo].
 *
 * Yields **basic (intrinsic)** insulation, not total: the boundary air layer is not in it
 * (STANDARDS §2.1). The equation is clo-specific: the 0.161 constant has units and the
 * equation is not dimensionally portable, so we convert at the boundary.
 *
 * ⚠️ **Validity, verbatim from the standard: "between 0,2 clo and 1,6 clo".** Expedition
 * layering is 3–5 clo, a factor of 2–3 outside the tested range. Kuklane et al. (2021)
 * independently extended the test to 3.33 clo on one ambulance clothing system and found
 * −18 % to +12 % agreement (mean +0.02 clo, R² = 0.98): encouraging, but one study and one
 * clothing system.
 *
 * ⚠️ Two further caveats, also verbatim: the summations "are based on data with rather uniform
 * insulation distributions over the body … should not be used for extreme situations (e.g.
 * three layers on lower body and only a thin layer on upper body)"; and accuracy is "limited"
 * when the garment values come from tables rather than measurements, which is exactly the
 * case here.
 */
export const ENSEMBLE_RULE = {
  intercept: 0.161,
  slope: 0.835,
  testedMinClo: 0.2,
  testedMaxClo: 1.6,
  /** Kuklane et al. (2021), one study, one clothing system. */
  extendedMaxClo: 3.33,
} as const;

export interface EnsembleResult {
  /** Basic intrinsic insulation of the ensemble, clo. Everything closed up. */
  readonly clo: number;
  /** Same, m²K/W: what `ireq()` wants. */
  readonly rsi: SquareMetreKelvinPerWatt;
  /** `Σ I_clu` before the ensemble rule, clo. */
  readonly sumClo: number;
  /**
   * The same ensemble with **every garment vented as far as it goes** (unzipped, sleeves up,
   * pit zips open, hood down), and nothing taken off. ISO 9920 Eq. (11) applied to the reduced
   * `I_clu` values, so the 0.161 clo intercept survives venting (it is the ensemble-ness, not a
   * garment, and no zip removes it). ⚠️ Rests on `estimated` adjustabilities: see
   * {@link ADJUSTABILITY_DEFAULTS}.
   */
  readonly ventedClo: number;
  readonly ventedRsi: SquareMetreKelvinPerWatt;
  /** `clo − ventedClo`: how much insulation this ensemble can shed without undressing. */
  readonly ventableClo: number;
  /** `Σ I_clu` with every garment vented, clo. */
  readonly ventedSumClo: number;
  readonly garments: readonly Garment[];
  /** True if any garment in the ensemble is windproof enough to zero the pumping term. */
  readonly hasWindproofShell: boolean;
  readonly warnings: readonly ModelWarning[];
}

export interface EnsembleOptions {
  /**
   * `SPEC.md` §2.7: wet fleece/down keeps 0.3–0.5 of its clo, synthetics 0.6–0.7, shells are
   * unaffected. ⚠️ All `estimated`: `docs/STANDARDS.md` has nothing on wet insulation, and
   * `REFERENCE_warmth_check.md` only says "the check assumes dry layers".
   */
  readonly wet?: boolean;
  /** Use ISO 9920 Eq. (12) `I_cl = Σ I_clu` instead ("slightly reduced accuracy"). */
  readonly simpleSummation?: boolean;
}

/** ⚠️ Estimated wet-derate factors (`SPEC.md` §2.7). Nothing measures these. */
export const WET_RETENTION: Readonly<Record<GarmentMaterial, number>> = {
  down: 0.3,
  fleece: 0.4,
  'synthetic-fill': 0.65,
  wool: 0.5,
  'synthetic-base': 0.6,
  shell: 1.0,
  other: 0.6,
};

export function ensembleInsulation(
  garments: readonly Garment[],
  options: EnsembleOptions = {},
): EnsembleResult {
  const warnings: ModelWarning[] = [];
  const effective = (x: Garment): number =>
    x.clo * (options.wet === true ? WET_RETENTION[x.material] : 1);
  const sumClo = garments.reduce((s, x) => s + effective(x), 0);
  const ventedSumClo = garments.reduce(
    (s, x) => s + effective(x) * (1 - garmentAdjustability(x)),
    0,
  );

  if (sumClo < ENSEMBLE_RULE.testedMinClo) {
    warnings.push(
      warn(
        'ensemble_below_tested_range',
        'out-of-range',
        `Σ I_clu is below ISO 9920 Eq. (11)'s tested range of ` +
          `${ENSEMBLE_RULE.testedMinClo}–${ENSEMBLE_RULE.testedMaxClo} clo. The 0.161 clo ` +
          'intercept dominates and the result is not meaningful for a near-nude ensemble. ' +
          '(The figure itself is `sumClo` on the result: it is deliberately not quoted here, ' +
          'so that assessing several ensembles produces one statement of this and not one per ' +
          'ensemble.)',
      ),
    );
  } else if (sumClo > ENSEMBLE_RULE.extendedMaxClo) {
    warnings.push(
      warn(
        'ensemble_far_above_tested_range',
        'out-of-range',
        `Σ I_clu is above even Kuklane et al. (2021)'s independently tested ` +
          `${ENSEMBLE_RULE.extendedMaxClo} clo extension of ISO 9920 Eq. (11) (the standard ` +
          `itself tested only to ${ENSEMBLE_RULE.testedMaxClo} clo). Treat the ensemble ` +
          'insulation as an extrapolation. (The figure itself is `sumClo` on the result.)',
      ),
    );
  } else if (sumClo > ENSEMBLE_RULE.testedMaxClo) {
    warnings.push(
      warn(
        'ensemble_above_tested_range',
        'caution',
        `Σ I_clu is above ISO 9920 Eq. (11)'s stated tested range of ` +
          `${ENSEMBLE_RULE.testedMaxClo} clo. Kuklane et al. (2021) extended it to ` +
          `${ENSEMBLE_RULE.extendedMaxClo} clo at −18 %/+12 % on one clothing system, so this is ` +
          'supported but not by the standard. (The figure itself is `sumClo` on the result.)',
      ),
    );
  }

  const regions = new Set(garments.map((x) => x.region));
  if (regions.has('torso') && !regions.has('legs') && sumClo > 1) {
    warnings.push(
      warn(
        'ensemble_uneven_distribution',
        'caution',
        'ISO 9920 §4.3, verbatim: the summation is "based on data with rather uniform insulation ' +
          'distributions over the body" and "should not be used for extreme situations". This ' +
          'ensemble covers the torso but not the legs.',
      ),
    );
  }

  const rule = (sum: number): number =>
    options.simpleSummation === true ? sum : ENSEMBLE_RULE.intercept + ENSEMBLE_RULE.slope * sum;
  const clo = rule(sumClo);
  const ventedClo = rule(ventedSumClo);

  return {
    clo,
    rsi: cloToSI(clo),
    sumClo,
    ventedClo,
    ventedRsi: cloToSI(ventedClo),
    ventableClo: clo - ventedClo,
    ventedSumClo,
    garments,
    hasWindproofShell: garments.some((x) => x.windproof === true),
    warnings,
  };
}

/**
 * ISO 9920 Equation (13): adjust a *tabulated* ensemble rather than summing garments.
 * The standard recommends this over summation: "The accuracy of the summation of individual
 * garments (4.3) is much less than that of matching the actual ensemble with an ensemble taken
 * from Annex A." We cannot use it (Annex A was never obtained) but it belongs in the API for
 * when a measured ensemble is available.
 */
export function adjustTabulatedEnsemble(tabulatedClo: number, deltaIcluClo: number): number {
  return tabulatedClo + ENSEMBLE_RULE.slope * deltaIcluClo;
}

/**
 * ⚠️ `loft-derived`. `SPEC.md` §2.3's rule of thumb: ~4 clo per inch of still loft, times the
 * fraction of body surface covered. Nothing in `docs/STANDARDS.md` supports the 4 clo/inch
 * figure; it is the standard gear-industry heuristic. Offered for user-supplied garments that
 * are not in the catalogue.
 */
export const CLO_PER_INCH_OF_LOFT = 4;

export function loftDerivedClo(loftInches: number, bodyCoverageFraction: number): number {
  return CLO_PER_INCH_OF_LOFT * loftInches * bodyCoverageFraction;
}

/** A user-supplied garment built from loft, carrying the right provenance automatically. */
export function garmentFromLoft(
  id: string,
  label: string,
  region: BodyRegion,
  slot: LayerSlot,
  loftInches: number,
  bodyCoverageFraction: number,
  material: GarmentMaterial = 'down',
): Garment {
  return {
    id,
    label,
    region,
    slot,
    clo: loftDerivedClo(loftInches, bodyCoverageFraction),
    material,
    provenance: 'loft-derived',
    isPuffy: true,
    note: `${CLO_PER_INCH_OF_LOFT} clo/inch × ${loftInches}" × ${bodyCoverageFraction} coverage (SPEC §2.3 heuristic).`,
  };
}

/** Unit re-export so callers do not have to reach into `units.ts` for one constant. */
export const CLO_IN_SI = CLO;
