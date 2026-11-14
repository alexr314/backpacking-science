/**
 * Operative temperature, mean radiant temperature, and night-sky radiant cooling.
 *
 * This is where the library most differs from indoor thermal comfort. A forecast gives air
 * temperature; a person lying in the open on a clear night experiences an operative
 * temperature roughly **5–6 K below it**, and that penalty largely disappears under overcast
 * or a forest canopy (`docs/STANDARDS.md` §6.8). It is the single largest correction in the
 * model and it is invisible on a thermometer.
 *
 * Everything here follows STANDARDS §6's own recommendation (§6.4) rather than the more
 * familiar models, three of which §6.4 explicitly says not to use.
 */

import {
  ISO_KELVIN_OFFSET,
  STEFAN_BOLTZMANN,
  clamp,
  saturationVapourPressureKPa,
  type Celsius,
  type Fraction,
  type MetresPerSecond,
  type WattsPerSquareMetre,
} from './units.js';
import { warn, type ModelWarning, type UnverifiedConstant } from './types.js';
import {
  CLOTHING_EMISSIVITY,
  convectiveCoefficientIso9920,
  radiativeCoefficient,
} from './ireq.js';

/**
 * ⭐ Recommended clear-sky emissivity, **nighttime** form (STANDARDS §6.4):
 *
 *     ε_sky,c = 0.633 + 0.057·√P_w        (P_w in hPa)
 *
 * Li, Jiang & Coimbra (2017) recalibrated 15 models against 7 NOAA SURFRAD stations; this is
 * the most accurate, the simplest, and the only one explicitly fitted to night (rRMSE 4.37 %
 * for the all-day form vs ~10 % for Brunt/Swinbank/Idso with original coefficients).
 *
 * ⚠️ STANDARDS §6.4 is blunt that **Swinbank, Idso & Jackson and Ruckstuhl "are not
 * recommended for future use"**: they carry roughly twice the error of the others. They are
 * implemented here only so the README's sensitivity discussion can be reproduced.
 */
export const LI_COIMBRA_NIGHT = { a: 0.633, b: 0.057 } as const;
export const LI_COIMBRA_DAY = { a: 0.598, b: 0.057 } as const;
export const LI_COIMBRA_ALL_DAY = { a: 0.618, b: 0.056 } as const;

export type SkyEmissivityModel = 'li-coimbra-night' | 'li-coimbra-day' | 'berdahl-martin';

/**
 * Berdahl & Martin (1984) Eq. (2), the dew-point-input alternative kept as a cross-check:
 * `ε = 0.711 + 0.56(T_dp/100) + 0.73(T_dp/100)²`, `T_dp` in °C, plus the +0.013 night term
 * (their Eq. 3 at local midnight). Validity: T_dp in [−20, +30] °C (STANDARDS §6.3).
 */
export const BERDAHL_MARTIN_NIGHT_OFFSET = 0.013;

/**
 * Cloud correction. Three published forms, and STANDARDS §6.6 says it is **unresolved** which
 * is right: EnergyPlus removes only ~15 % of the clear-sky gap at full overcast while
 * Martin–Berdahl / Crawford–Duchon remove 80–85 %. Measured corroboration (three independent
 * datasets, §6.6) sits with the stronger forms, so Martin–Berdahl is the default.
 */
export type CloudModel = 'martin-berdahl' | 'crawford-duchon' | 'energyplus';

/** Martin & Berdahl's all-opaque simplification: `C = 0.784·n_opaque` (STANDARDS §6.6). */
export const MARTIN_BERDAHL_OPAQUE_FACTOR = 0.784;

/**
 * Shelter presets: sky view factor, what the obstruction radiates at, and the air-temperature
 * offset inside it.
 *
 * 🔴 **The tent row is probably not what you expect, and it follows the document.**
 * STANDARDS §6.10: *an unoccupied tent at night under a clear sky sits at or slightly BELOW
 * outside air temperature*: −1.2 K and −0.9 K in two independent peer-reviewed Phoenix
 * campaigns, −2.2 K in a cold-weather field study. **A tent is not a passive air-warming
 * device; its benefit is radiant** (§6.8's measured table shows a plain tent raising T_mrt by
 * ≈ +4.3 K at essentially unchanged air temperature).
 *
 * The occupied case is kinder (+1.1 K for a double-wall, single-source and not peer-reviewed),
 * and `occupiedTentAirOffsetK` is available for it, but the default is the measured one.
 */
export interface ShelterPreset {
  /** Fraction of the upper hemisphere that is open sky, 0..1. */
  readonly skyViewFactor: Fraction;
  /** Obstruction temperature relative to air, K. */
  readonly obstructionOffsetK: number;
  /** Air temperature inside the shelter relative to the forecast, K. */
  readonly airOffsetK: number;
  /** Fraction of the forecast wind that reaches the body. */
  readonly windFactor: Fraction;
  readonly note: string;
}

export type ShelterKind = 'open' | 'partial_canopy' | 'forest' | 'tarp' | 'three_sided' | 'tent';

export const SHELTERS: Readonly<Record<ShelterKind, ShelterPreset>> = {
  open: {
    skyViewFactor: 1,
    obstructionOffsetK: 0,
    airOffsetK: 0,
    windFactor: 1,
    note: 'Open level terrain. STANDARDS §6.7: F_sky = F_ground = 0.5 by the half-space argument.',
  },
  partial_canopy: {
    skyViewFactor: 0.5,
    obstructionOffsetK: -0.4,
    airOffsetK: 0,
    windFactor: 0.7,
    note:
      'Scattered trees. Canopy radiates at ≈ air temperature at night: needle temperatures ' +
      'measured 0.4 °C cooler than air (Musselman & Pomeroy 2017; STANDARDS §6.9).',
  },
  forest: {
    skyViewFactor: 0.2,
    obstructionOffsetK: -0.4,
    airOffsetK: 0,
    windFactor: 0.4,
    note:
      'Closed canopy. STANDARDS §6.9: minimum air temperature in forest ran ~3 °C warmer than a ' +
      'clearcut (≈6 °C on clear nights), but Karlsson (2000) found forest *air* up to 3 °C ' +
      'COLDER than extensive open ground. The radiative and aerodynamic terms are modelled ' +
      'separately here and deliberately not folded into one "forest is warmer" offset.',
  },
  tarp: {
    skyViewFactor: 0.4,
    obstructionOffsetK: 0,
    airOffsetK: 0,
    windFactor: 0.5,
    note: 'Flat tarp. Sky view factor estimated; fabric assumed to radiate at air temperature.',
  },
  three_sided: {
    skyViewFactor: 0.3,
    obstructionOffsetK: 0,
    airOffsetK: 0,
    windFactor: 0.3,
    note: 'Three-sided shelter / lean-to. All values estimated; SPEC §2.5 suggests 0.5 m/s inside.',
  },
  tent: {
    skyViewFactor: 0,
    obstructionOffsetK: 0,
    airOffsetK: -1.0,
    windFactor: 0.05,
    note:
      'Tent, unoccupied-equivalent. STANDARDS §6.10: two peer-reviewed campaigns measured tent ' +
      'air 0.9–1.2 K BELOW ambient on clear nights. The benefit is radiant, not thermal: T_mrt ' +
      'rises ≈4.3 K because the fly blocks the sky. Occupied double-wall tents measured +1.1 K ' +
      '(single-source, not peer-reviewed): see `occupiedTentAirOffsetK`.',
  },
};

/**
 * ⚠️ **Single-source, not peer-reviewed.** Seeber (2024), 23 overnights: an occupied
 * double-wall tent ran +1.1 K over ambient (transient +2.2 K), a single-wall −0.6 to +0.6 K
 * (STANDARDS §6.10). Offered as an override, not the default.
 */
export const OCCUPIED_DOUBLE_WALL_TENT_AIR_OFFSET_K = 1.1;

/**
 * ⚠️ **Estimated.** Projected-area fraction used to turn downwelling shortwave into a radiant
 * gain. `SPEC.md` §2.2's "+5 K daytime clear" is a flat guess; this at least scales with the
 * forecast's own shortwave field. STANDARDS §6.7 gives α_k = 0.7 and ε_p = 0.97 from the
 * six-direction method, which are used here; the 0.25 projected-area fraction is ours.
 */
export const SHORTWAVE_ABSORPTIVITY = 0.7;
export const BODY_LONGWAVE_EMISSIVITY = 0.97;
export const DEFAULT_PROJECTED_AREA_FRACTION = 0.25;

/**
 * ASHRAE 55-2023 Normative Appendix A §A1 / ISO 7730: `t_o = A·t_a + (1 − A)·t_r` with `A`
 * read off air speed (STANDARDS §6.1).
 *
 * ⚠️ Both standards' validity conditions are violated outdoors on a clear night: `A = 0.5`
 * assumes `V_a < 0.2 m/s` **and** a small `|t_a − t_r|`, and the night-sky gap is 5–12 K. The
 * `A`-table is used against the actual wind rather than defaulting to the midpoint, and this
 * is flagged. Operative temperature is a display quantity here: the models themselves take
 * `t_a` and `t_r` separately, which avoids the issue entirely.
 */
export function operativeWeightingFactor(airSpeed: MetresPerSecond): number {
  if (airSpeed < 0.2) return 0.5;
  if (airSpeed <= 0.6) return 0.6;
  if (airSpeed <= 1.0) return 0.7;
  // Above the published table. Fall back to the h-form, which is what the A-form approximates.
  return Number.NaN;
}

// ---------------------------------------------------------------------------------------
// Campfire: a directional radiant source
// ---------------------------------------------------------------------------------------

/**
 * **The one place the campfire's numbers live**: `docs/CAMPFIRE.md` §9.2, the recommended
 * parameter block, with its per-line confidence labels preserved in
 * {@link ENVIRONMENT_UNVERIFIED_CONSTANTS}.
 *
 * The mechanism: a fire is a radiant source, so it raises **mean radiant temperature**, which
 * feeds the operative-temperature path in this module and enters both physical models as `t_r`.
 * It is **never** a metabolic bonus: sitting by a fire does not make you produce more heat.
 *
 *     E(r)   = χ_rad·Q̇ / (4π·[r² + (z_t − z_s)²])        (CAMPFIRE.md F1, point source)
 *     Δt_o   = f·E / (h_c + h_r)                           (F2)
 *     Δt̄_r   = f·E / h_r                                   (F2, diagnostic)
 *     f      = (α_fire/ε)·(A_p/A_D)
 *
 * 🔴 **`h_r` cancels out of `Δt_o`, but only if the same `h_r` is used in both places**
 * (CAMPFIRE.md §6.3). `h_r` is the largest single parameter uncertainty in the chain and it has
 * no effect on the answer provided the code does not hard-code one here while the thermal model
 * computes another. So `Δt_o` is computed first, from the engine's own `h_c` and `h_r`, and
 * `Δt̄_r` is derived from it: the order the document asks for. Hard-coding `h_r = 4.7` here
 * would understate the benefit by 28 % or overstate it by 38 %.
 *
 * **Design result: `Δt_o ≈ 2 K` at 1.2 m in still air** (`Δt̄_r ≈ 3.8 K`). Wind matters more
 * than distance: at 2 m/s the same fire is worth 0.81 K, because `h_c` triples (§8.2).
 */
export const CAMPFIRE = {
  /**
   * ⚠️ **Our estimate, `single-source`.** Heat release rate, kW, inverted from the client's
   * 0.3 m flame height through Heskestad's correlation. CAMPFIRE.md §10 item 1: **no published
   * HRR measurement of an actual campfire exists**, and the correlation's own source says it
   * applies to fuels "which do not have substantial in-depth combustion", i.e. not wood. This
   * is the single weakest link in the chain.
   */
  heatReleaseRateKw: 10,
  /** Our estimate; fuel-bed diameter is the dominant term (CAMPFIRE.md §2.5). */
  heatReleaseRateRangeKw: [7, 16],
  /**
   * **Measured** (Yu 2014, 22 & 47 kW free-burning spruce-pine wood cribs). 🔴 Do **not** use
   * 0.3–0.4: those are large liquid-pool numbers, the wrong regime, and would roughly double
   * the fire's benefit (CAMPFIRE.md §3.3).
   */
  radiativeFraction: 0.15,
  radiativeFractionRange: [0.15, 0.25],
  /** Equivalent point-source height = L_f/2, m. Convention, `verified` (NUREG-1805 §5.3.1). */
  sourceHeightM: 0.15,
  /** Receiver's radiative centroid, m. Measured convention (ISO 7726 Table 5; ASHRAE 55 §3). */
  receiverHeightM: { seated: 0.6, standing: 1.1 },
  /** `A_p/A_D`, frontal, horizontal source. **Measured**: ASHRAE 55 SolarCal §C1/§C4. */
  projectedAreaFraction: { seated: 0.202, standing: 0.254 },
  /** `f_p` alone, for the Δt_pr asymmetry conversion (CAMPFIRE.md §7.5). ASHRAE 55 §C4. */
  planeProjectedAreaFactor: { seated: 0.29, standing: 0.35 },
  /**
   * ⚠️ **Our estimate**, from a measured spectral split of a wood flame (CAMPFIRE.md §5.3).
   * Note it is **not** 0.95: a flame radiates partly in the near-IR, where skin and clothing
   * are less absorbing than they are in the long-wave.
   */
  fireAbsorptivity: 0.84,
  /** Design distance, m: the client's "about a metre and a bit" (CAMPFIRE.md §1). */
  defaultDistanceM: 1.2,
  /**
   * **Measured criterion** (L/D > 2.5, Modak 1977 via NUREG-1805 §5.5): below this the point
   * source is invalid and over-predicts. `E` is clamped here and a warning is raised; the model
   * never extrapolates closer.
   */
  minValidDistanceM: 0.75,
  /** **Measured**: Watanabe et al. (2023) found "no thermal effect … at 4 m and above". */
  negligibleDistanceM: 4,
  /** Above this the `8.3·v^0.6` family is out of range; the benefit is flagged unreliable. */
  maxValidWindSpeed: 4,
  /**
   * ASHRAE 55 Table 5-10's warm-wall radiant-asymmetry limit, K of plane radiant temperature:
   * equivalently Δt̄_r ≈ 7.0 K for a seated person (CAMPFIRE.md §7.4, §7.5). Kept so the
   * provenance of the threshold is not lost, and reported on {@link CampfireEffect}, but
   * **deliberately not raised as a warning**: see `asymmetryExceedsLimit`.
   */
  asymmetryLimitK: 23,
} as const;

export type CampfirePosture = 'seated' | 'standing';

/**
 * An optional radiant heat source at a phase: in practice, a camp fire. **Default off.**
 *
 * Everything is optional: `{ on: true }` is the `docs/CAMPFIRE.md` design case, a seated person
 * 1.2 m from a ~10 kW wood fire. `deltaMrtK` is the escape hatch for a caller who has measured
 * the mean-radiant-temperature rise and wants the model to use it verbatim.
 */
export interface RadiantSourceInput {
  /** `false` (or omitting the whole object) is off. */
  readonly on: boolean;
  /** Horizontal distance from the fire axis, m. Default {@link CAMPFIRE.defaultDistanceM}. */
  readonly distanceM?: number;
  /** Default `'seated'`: a campfire is something you sit by. */
  readonly posture?: CampfirePosture;
  /** Override the radiative power `χ_rad·Q̇`, kW. Default 0.15 × 10 kW = 1.5 kW. */
  readonly radiativePowerKw?: number;
  /** Override `Δt̄_r` directly, K. Takes precedence over the irradiance model. */
  readonly deltaMrtK?: number;
}

/** What a radiant source does, in full. All zero and `on: false` when there is no fire. */
export interface CampfireEffect {
  readonly on: boolean;
  readonly posture: CampfirePosture;
  /** Horizontal distance used, m: already clamped to `minValidDistanceM` for the irradiance. */
  readonly distanceM: number;
  /** Slant distance point source → receiver centroid, m: `√(r² + (z_t − z_s)²)`. */
  readonly slantDistanceM: number;
  /** Irradiance at the receiver, W/m² (F1). */
  readonly irradiance: WattsPerSquareMetre;
  /** `f = (α_fire/ε)·(A_p/A_D)`. */
  readonly absorbedFraction: number;
  /** `Δt_o = f·E/(h_c + h_r)`, K: the quantity the document says to compute first. */
  readonly deltaOperativeK: number;
  /** `Δt̄_r`, K: derived from `Δt_o`, so `h_r` cancels exactly. Added to mean radiant temp. */
  readonly deltaMeanRadiantK: number;
  /** `Δt_pr = (ε/f_p)·Δt̄_r`, K: plane radiant asymmetry, for the ASHRAE 55 limit. */
  readonly planeRadiantAsymmetryK: number;
  /**
   * True when `planeRadiantAsymmetryK` exceeds {@link CAMPFIRE.asymmetryLimitK}.
   *
   * **Reported, never warned about.** ASHRAE 55's warm-wall limit is about office occupants who
   * cannot move away from a radiant surface. A warm front and a cool back is the *point* of
   * sitting by a fire, and raising a flag would tell the user something is wrong when nothing
   * is. The asymmetry's real consequence is enforced where it matters instead: the extremities
   * receive none of the fire's benefit.
   */
  readonly asymmetryExceedsLimit: boolean;
  readonly warnings: readonly ModelWarning[];
}

const NO_FIRE: CampfireEffect = {
  on: false,
  posture: 'seated',
  distanceM: Number.NaN,
  slantDistanceM: Number.NaN,
  irradiance: 0,
  absorbedFraction: 0,
  deltaOperativeK: 0,
  deltaMeanRadiantK: 0,
  planeRadiantAsymmetryK: 0,
  asymmetryExceedsLimit: false,
  warnings: [],
};

/** The heat-transfer coefficients the fire's conversion must share with the rest of the model. */
export interface CampfireContext {
  /** `h_c`, W/m²K: the engine's own. */
  readonly convectiveCoefficient: number;
  /** `h_r`, W/m²K: the engine's own, computed from temperature, never 4.7. */
  readonly radiativeCoefficient: number;
  /** Air velocity at the body, m/s. Only used to decide whether to flag unreliability. */
  readonly airVelocity: MetresPerSecond;
}

/**
 * `docs/CAMPFIRE.md` §9, implemented. Returns the fire's whole effect, or {@link NO_FIRE}.
 *
 * `Δt_o` is computed first and `Δt̄_r` derived from it, which is what makes the `h_r`
 * cancellation of §6.3 exact rather than approximate.
 */
export function campfireEffect(
  source: RadiantSourceInput | undefined,
  ctx: CampfireContext,
): CampfireEffect {
  if (source === undefined || source.on !== true) return NO_FIRE;

  const posture = source.posture ?? 'seated';
  const warnings: ModelWarning[] = [];
  const hc = ctx.convectiveCoefficient;
  const hr = ctx.radiativeCoefficient;
  const fp = CAMPFIRE.planeProjectedAreaFactor[posture];
  const f = (CAMPFIRE.fireAbsorptivity / CLOTHING_EMISSIVITY) * CAMPFIRE.projectedAreaFraction[posture];

  const requested = Math.max(0, source.distanceM ?? CAMPFIRE.defaultDistanceM);
  const rise = CAMPFIRE.receiverHeightM[posture] - CAMPFIRE.sourceHeightM;
  const slant = (r: number): number => Math.sqrt(r * r + rise * rise);

  // Edge: beyond 4 m there is no measurable effect at all (Watanabe et al. 2023).
  if (requested > CAMPFIRE.negligibleDistanceM) {
    return {
      ...NO_FIRE,
      on: true,
      posture,
      distanceM: requested,
      slantDistanceM: slant(requested),
      absorbedFraction: f,
    };
  }

  // Edge: closer than 0.75 m the point source is invalid (L/D < 2.5) and over-predicts. Clamp
  // the irradiance to its 0.75 m value rather than extrapolating into a regime it cannot model.
  let effectiveR = requested;
  if (requested < CAMPFIRE.minValidDistanceM) {
    effectiveR = CAMPFIRE.minValidDistanceM;
    warnings.push(
      warn(
        'campfire_too_close_for_point_source',
        'out-of-range',
        `At ${requested.toFixed(2)} m the point-source model is outside its validity criterion ` +
          `(L/D > 2.5, i.e. r ≥ ${CAMPFIRE.minValidDistanceM} m) and over-predicts. The ` +
          `irradiance is clamped to its ${CAMPFIRE.minValidDistanceM} m value; it is not ` +
          'extrapolated closer. docs/CAMPFIRE.md §9.3.',
      ),
    );
  }

  const radiativePowerW =
    (source.radiativePowerKw ?? CAMPFIRE.radiativeFraction * CAMPFIRE.heatReleaseRateKw) * 1000;
  const d = slant(effectiveR);
  const irradiance = radiativePowerW / (4 * Math.PI * d * d);

  // Δt_o first (§6.3), then Δt̄_r from it, so the h_r in the operative blend is the same h_r.
  const override = source.deltaMrtK;
  const deltaMeanRadiantK =
    override !== undefined ? Math.max(0, override) : (f * irradiance) / hr;
  const deltaOperativeK = (hr * deltaMeanRadiantK) / (hc + hr);
  const planeRadiantAsymmetryK = (CLOTHING_EMISSIVITY / fp) * deltaMeanRadiantK;

  if (ctx.airVelocity > CAMPFIRE.maxValidWindSpeed) {
    warnings.push(
      warn(
        'campfire_wind_out_of_range',
        'out-of-range',
        `Air velocity ${ctx.airVelocity.toFixed(1)} m/s is above the ${CAMPFIRE.maxValidWindSpeed} m/s ` +
          "ceiling of the h_c correlation the fire's benefit is divided by, so that benefit is " +
          'unreliable here. Wind matters more than distance for a fire: at 2 m/s the 1.2 m ' +
          'benefit is already down from 2.0 K to 0.8 K. docs/CAMPFIRE.md §8.',
      ),
    );
  }

  // The radiant asymmetry is computed and reported, and **deliberately not warned about.**
  // docs/CAMPFIRE.md §7.4 recommends flagging it above ASHRAE 55 Table 5-10's 23 K warm-wall
  // limit, and that limit is a real, verified number from a real standard: kept here so the
  // provenance is not lost. But ASHRAE 55 is about people who cannot move away from a warm
  // wall in an office. Sitting by a fire with a warm front and a cool back is the *point* of
  // sitting by a fire, not a fault condition, and an alarm here would tell a user something is
  // wrong when nothing is. So `asymmetryExceedsLimit` is available to a caller that wants it,
  // the one-sidedness is stated factually in CAMPFIRE_CAVEAT alongside the other caveats, and
  // no ModelWarning is raised. (The *consequence* of the asymmetry is still enforced, in the
  // place where it actually matters: the extremities get none of the benefit.)
  const asymmetryExceedsLimit = planeRadiantAsymmetryK > CAMPFIRE.asymmetryLimitK;

  return {
    on: true,
    posture,
    distanceM: effectiveR,
    slantDistanceM: d,
    irradiance,
    absorbedFraction: f,
    deltaOperativeK,
    deltaMeanRadiantK,
    planeRadiantAsymmetryK,
    asymmetryExceedsLimit,
    warnings,
  };
}

/**
 * `Δt̄_r` a radiant source contributes, K: the increment added to mean radiant temperature.
 * 0 when off or absent. Convenience wrapper over {@link campfireEffect}.
 */
export const radiantSourceDeltaMrtK = (
  source: RadiantSourceInput | undefined,
  ctx: CampfireContext,
): number => campfireEffect(source, ctx).deltaMeanRadiantK;

/**
 * The caveat the fire puts on every result that used it. Stated once, here, so the engine and
 * the UI quote the same words.
 */
export const CAMPFIRE_CAVEAT =
  'A campfire warms the side of you that faces it. It is modelled as a rise in mean radiant ' +
  'temperature only: it feeds the operative temperature and never the metabolic rate, because ' +
  'sitting by a fire does not make you produce more heat. The model credits your whole-body ' +
  'balance with it and credits nothing to your hands, feet or head: Watanabe et al. (2023) ' +
  'measured a real campfire and found no rise at all on the back-facing sensor at any distance, ' +
  'and the A_p/A_D = 0.202 the benefit is computed from is a whole-body average that says ' +
  'nothing about how it is distributed between your shins and your back. ⚠️ The weakest link in ' +
  'the chain is the fire itself: there is no published heat-release-rate measurement of an ' +
  'actual campfire, so the 10 kW is inferred by inverting a flame-height correlation whose own ' +
  'source says it does not apply to fuels with substantial in-depth combustion, i.e. not wood. ' +
  'docs/CAMPFIRE.md §10 item 1.';

export const ENVIRONMENT_UNVERIFIED_CONSTANTS: readonly UnverifiedConstant[] = [
  // --- Campfire, docs/CAMPFIRE.md §9.2 ------------------------------------------------
  // Only the lines that document labels as **our estimate** appear here. The measured and
  // standard-sourced parameters (χ_rad, A_p/A_D, f_p, z_s, z_t, ε, the 0.75 m validity
  // criterion, the 4 m cutoff, the 23 K asymmetry limit) are not estimates and are documented
  // on CAMPFIRE itself with their sources.
  {
    id: 'environment.campfire.heatReleaseRateKw',
    value: CAMPFIRE.heatReleaseRateKw,
    units: 'kW',
    provenance: 'estimated',
    note:
      '🔴 The weakest link in the campfire chain, and the one that sets its magnitude. ' +
      'docs/CAMPFIRE.md §10 item 1: no published heat-release-rate measurement of an actual ' +
      'campfire or fire pit exists in anything reachable. 10 kW is inferred by inverting ' +
      "Heskestad's flame-height correlation from a 0.3 m flame, and that correlation's own " +
      'source (NIST) says it applies to fuels "which do not have substantial in-depth ' +
      `combustion", i.e. not wood. Range ${CAMPFIRE.heatReleaseRateRangeKw[0]}–` +
      `${CAMPFIRE.heatReleaseRateRangeKw[1]} kW, driven mostly by fuel-bed diameter, which the ` +
      'user never tells us. Moves the fire\'s benefit roughly in proportion.',
  },
  {
    id: 'environment.campfire.fireAbsorptivity',
    value: CAMPFIRE.fireAbsorptivity,
    units: 'fraction',
    provenance: 'estimated',
    note:
      'α_fire, the body/clothing absorptivity for a wood flame\'s spectrum, in f = (α_fire/ε)·' +
      '(A_p/A_D). docs/CAMPFIRE.md §5.3 derives 0.84 from a measured spectral split; it is our ' +
      'estimate, not a measurement, and notably **not** 0.95: a flame radiates partly in the ' +
      'near-IR where skin and clothing absorb less than they do in the long-wave. ±0.05 here is ' +
      '±6 % on the fire\'s benefit.',
  },
  {
    id: 'environment.campfire.deltaOperativeAtDesignDistanceK',
    value: 2,
    units: 'K',
    provenance: 'estimated',
    note:
      'The design-case result rather than an input: Δt_o ≈ 2.0 K (Δt̄_r ≈ 3.8 K) for a seated ' +
      `person ${CAMPFIRE.defaultDistanceM} m from the design fire in still air ` +
      '(docs/CAMPFIRE.md §6.4). Labelled "our estimate" there because it inherits the heat-' +
      'release-rate and absorptivity estimates above; the bracket is 1.4–5.3 K. The engine ' +
      'computes this from the irradiance model and the engine\'s own h_c and h_r rather than ' +
      'carrying it as a constant: it is registered here so the number itself is auditable. ' +
      'Wind matters more than distance: at 2 m/s the same fire is worth 0.81 K.',
  },
  {
    id: 'environment.campfire.extremityAllocation',
    value: 0,
    units: 'fraction of the benefit',
    provenance: 'peer-reviewed',
    note:
      'Share of the fire\'s radiant benefit allocated to the hands/feet/head verdicts: zero. ' +
      'docs/CAMPFIRE.md §9.2 labels the allocation an engineering judgement, but the behaviour ' +
      'it encodes is measured: Watanabe et al. (2023) instrumented a real campfire and found no ' +
      'rise at all on the back-facing sensor at any distance. It will be wrong in the other ' +
      'direction for hands deliberately held out to the fire; fixing that needs per-segment ' +
      'projected-area factors toward a near-horizontal source, which §10 item 14 records as ' +
      'not found.',
  },
  {
    id: 'environment.shelter.tarp.skyViewFactor',
    value: SHELTERS.tarp.skyViewFactor,
    units: 'fraction',
    provenance: 'estimated',
    note: 'No measurement available; a flat tarp blocks most but not all of the upper hemisphere.',
  },
  {
    id: 'environment.shelter.three_sided.skyViewFactor',
    value: SHELTERS.three_sided.skyViewFactor,
    units: 'fraction',
    provenance: 'estimated',
    note: 'No measurement available.',
  },
  {
    id: 'environment.shelter.windFactor',
    value: SHELTERS.tent.windFactor,
    units: 'fraction',
    provenance: 'estimated',
    note:
      'Fraction of forecast wind reaching the body inside each shelter. SPEC §2.5 suggests ' +
      '~0 in a tent and 0.5 m/s in a three-sided shelter; the fractions here are ours.',
  },
  {
    id: 'environment.projectedAreaFraction',
    value: DEFAULT_PROJECTED_AREA_FRACTION,
    units: 'fraction',
    provenance: 'estimated',
    note:
      'Turns downwelling shortwave into a radiant gain. Replaces SPEC §2.2\'s flat "+5 K ' +
      'daytime clear" with something that at least scales with the forecast; the number itself ' +
      'is a judgement call.',
  },
  {
    id: 'environment.tentFabricSubAmbient',
    value: 0,
    units: 'K',
    provenance: 'estimated',
    note:
      'STANDARDS §6.10 calls quantified tent-fly surface depression "the single biggest ' +
      'empirical gap for this product" and estimates 2–5 K sub-ambient without measurement. We ' +
      'ship 0 K (fly at air temperature), which is what §6.8\'s measured tent T_mrt supports, ' +
      'and do not invent a depression.',
  },
];

// ---------------------------------------------------------------------------------------

export interface SkyInput {
  readonly airTemperature: Celsius;
  readonly relativeHumidity: Fraction;
  /** Total cloud cover, 0..1. Treated as opaque cloud (the forecast does not separate them). */
  readonly cloudCover: Fraction;
  readonly model?: SkyEmissivityModel;
  readonly cloudModel?: CloudModel;
}

export interface SkyResult {
  readonly clearSkyEmissivity: number;
  readonly skyEmissivity: number;
  /** Effective sky temperature, °C. */
  readonly skyTemperatureC: Celsius;
  /** `t_a − t_sky`, K. 15–27 K is the normal clear-sky range (STANDARDS §6.5). */
  readonly depressionK: number;
  readonly warnings: readonly ModelWarning[];
}

function dewPointC(airTemperature: Celsius, relativeHumidity: Fraction): Celsius {
  // Magnus inverse, consistent to ~0.3 K with the saturation curve used elsewhere.
  const rh = clamp(relativeHumidity, 0.01, 1);
  const gamma = Math.log(rh) + (17.625 * airTemperature) / (243.04 + airTemperature);
  return (243.04 * gamma) / (17.625 - gamma);
}

/** Clear-sky and all-sky emissivity, and the resulting effective sky temperature. */
export function skyTemperature(input: SkyInput): SkyResult {
  const warnings: ModelWarning[] = [];
  const model = input.model ?? 'li-coimbra-night';
  const cloudModel = input.cloudModel ?? 'martin-berdahl';
  const ta = input.airTemperature;
  const taK = ta + 273.15;

  // P_w in hPa: p_s(t_a) is in kPa, RH is a fraction, 1 kPa = 10 hPa.
  const pwHectopascals = input.relativeHumidity * saturationVapourPressureKPa(ta) * 10;

  let clear: number;
  if (model === 'berdahl-martin') {
    const tdp = dewPointC(ta, input.relativeHumidity);
    if (tdp < -20 || tdp > 30) {
      warnings.push(
        warn(
          'sky_berdahl_martin_out_of_range',
          'out-of-range',
          `Berdahl & Martin is stated useful for dew points in [−20, +30] °C; got ${tdp.toFixed(1)} °C.`,
        ),
      );
    }
    clear =
      0.711 + 0.56 * (tdp / 100) + 0.73 * Math.pow(tdp / 100, 2) + BERDAHL_MARTIN_NIGHT_OFFSET;
  } else {
    const c = model === 'li-coimbra-day' ? LI_COIMBRA_DAY : LI_COIMBRA_NIGHT;
    clear = c.a + c.b * Math.sqrt(pwHectopascals);
  }
  clear = clamp(clear, 0.4, 1);

  const n = clamp(input.cloudCover, 0, 1);
  let sky: number;
  switch (cloudModel) {
    case 'crawford-duchon':
      sky = clear + n * (1 - clear);
      break;
    case 'energyplus': {
      const tenths = n * 10;
      sky =
        clear * (1 + 0.0224 * tenths - 0.0035 * tenths ** 2 + 0.00028 * tenths ** 3);
      break;
    }
    case 'martin-berdahl':
    default:
      sky = clear + MARTIN_BERDAHL_OPAQUE_FACTOR * n * (1 - clear);
      break;
  }
  sky = clamp(sky, 0, 1);

  const skyK = Math.pow(sky, 0.25) * taK;
  return {
    clearSkyEmissivity: clear,
    skyEmissivity: sky,
    skyTemperatureC: skyK - 273.15,
    depressionK: ta - (skyK - 273.15),
    warnings,
  };
}

export interface EnvironmentInput {
  /** Forecast 2 m air temperature, °C. */
  readonly airTemperature: Celsius;
  readonly relativeHumidity: Fraction;
  readonly cloudCover: Fraction;
  /** Forecast 10 m wind speed, m/s. */
  readonly windSpeed: MetresPerSecond;
  readonly shelter?: ShelterKind;
  /** Override a preset's sky view factor (e.g. a measured SVF). */
  readonly skyViewFactorOverride?: Fraction;
  /** Ground surface temperature, °C. Defaults to air temperature (`SPEC.md` §2.5). */
  readonly groundTemperature?: Celsius;
  /** Downwelling shortwave, W/m². `null`/omitted = night or unknown; no solar term applied. */
  readonly shortwaveRadiation?: WattsPerSquareMetre | null;
  /** Use Seeber's occupied double-wall tent offset instead of the measured unoccupied one. */
  readonly occupiedTent?: boolean;
  readonly skyModel?: SkyEmissivityModel;
  readonly cloudModel?: CloudModel;
  readonly projectedAreaFraction?: number;
  /** A campfire or other directional radiant source. Omitted ⇒ off. See {@link CAMPFIRE}. */
  readonly radiantSource?: RadiantSourceInput;
}

export interface EnvironmentResult {
  /** Air temperature at the body after any shelter offset, °C. */
  readonly airTemperatureC: Celsius;
  readonly meanRadiantTemperatureC: Celsius;
  readonly operativeTemperatureC: Celsius;
  /** Wind actually reaching the body, m/s. */
  readonly airVelocity: MetresPerSecond;
  readonly sky: SkyResult;
  readonly skyViewFactor: Fraction;
  /** `meanRadiantTemperatureC − airTemperatureC`, K. Negative on a clear night. */
  readonly radiantOffsetK: number;
  /** `Δt̄_r` from the campfire, K. 0 when there is none. */
  readonly radiantSourceDeltaMrtK: number;
  /** The campfire's whole effect: irradiance, `Δt_o`, asymmetry. Always present. */
  readonly campfire: CampfireEffect;
  /** Mean radiant temperature with the campfire removed, °C. */
  readonly meanRadiantTemperatureWithoutSourceC: Celsius;
  /** Operative temperature with the campfire removed, °C: what the extremities are judged on. */
  readonly operativeTemperatureWithoutSourceC: Celsius;
  /** `radiantOffsetK` with the campfire removed, K. */
  readonly radiantOffsetWithoutSourceK: number;
  readonly warnings: readonly ModelWarning[];
  readonly caveats: readonly string[];
}

/**
 * Resolve a forecast into what the body actually experiences: air temperature at the body,
 * mean radiant temperature, operative temperature, and the wind that reaches you.
 *
 * `T_mrt = (0.5·T_upper⁴ + 0.5·T_ground⁴)^¼`: STANDARDS §6.8's headline form. §6.7 derives
 * `F_sky = F_ground = 0.5` for open level terrain from the half-space argument, and notes
 * that the *standing* angular factors give the same 0.5 exactly, so posture barely matters in
 * the open. 🔴 It also records a real gap: **no published angular factors exist for a supine
 * person**, so under partial obstruction (canopy, tent) a lying person is penalised more than
 * this model says.
 */
export function resolveEnvironment(input: EnvironmentInput): EnvironmentResult {
  const warnings: ModelWarning[] = [];
  const caveats: string[] = [];
  const shelterKind = input.shelter ?? 'open';
  const shelter = SHELTERS[shelterKind];
  const svf = clamp(input.skyViewFactorOverride ?? shelter.skyViewFactor, 0, 1);

  const airOffsetK =
    shelterKind === 'tent' && input.occupiedTent === true
      ? OCCUPIED_DOUBLE_WALL_TENT_AIR_OFFSET_K
      : shelter.airOffsetK;
  const airTemperatureC = input.airTemperature + airOffsetK;
  const airVelocity = Math.max(0, input.windSpeed * shelter.windFactor);

  const sky = skyTemperature({
    airTemperature: airTemperatureC,
    relativeHumidity: input.relativeHumidity,
    cloudCover: input.cloudCover,
    ...(input.skyModel !== undefined ? { model: input.skyModel } : {}),
    ...(input.cloudModel !== undefined ? { cloudModel: input.cloudModel } : {}),
  });
  warnings.push(...sky.warnings);

  const groundC = input.groundTemperature ?? airTemperatureC;
  const obstructionC = airTemperatureC + shelter.obstructionOffsetK;

  const k = (c: Celsius): number => c + 273.15;
  const upperK4 = svf * Math.pow(k(sky.skyTemperatureC), 4) + (1 - svf) * Math.pow(k(obstructionC), 4);
  let mrtK4 = 0.5 * upperK4 + 0.5 * Math.pow(k(groundC), 4);

  const sw = input.shortwaveRadiation ?? null;
  if (sw !== null && sw > 0) {
    const fp = input.projectedAreaFraction ?? DEFAULT_PROJECTED_AREA_FRACTION;
    const absorbed = SHORTWAVE_ABSORPTIVITY * fp * svf * sw;
    mrtK4 += absorbed / (BODY_LONGWAVE_EMISSIVITY * STEFAN_BOLTZMANN);
    caveats.push(
      'The solar term uses an estimated projected-area fraction, not a measured one: it ' +
        'replaces SPEC §2.2\'s flat "+5 K daytime" with something that scales with the forecast, ' +
        'but it is still a judgement call.',
    );
  }

  const meanRadiantTemperatureWithoutSourceC = Math.pow(mrtK4, 0.25) - 273.15;

  // Operative temperature. Prefer the h-form (STANDARDS §6.1); the A-table is a coarse
  // approximation of exactly this, and above 1 m/s the table stops.
  //
  // 🔴 `h_r` is evaluated **once**, on the fire-free mean radiant temperature, and reused for
  // the fire's conversion and for both operative temperatures. That is not an optimisation:
  // docs/CAMPFIRE.md §6.3 shows `h_r` cancels out of the fire's `Δt_o` *provided the same h_r
  // is used in both places*, and `h_r` is the largest single parameter uncertainty in the
  // campfire chain. Recomputing it against the raised `t_r` would break the cancellation.
  const hc = convectiveCoefficientIso9920(Math.max(airVelocity, 0.05));
  const hr = radiativeCoefficient(airTemperatureC, meanRadiantTemperatureWithoutSourceC);
  const operative = (mrtC: Celsius): Celsius =>
    (hc * airTemperatureC + hr * mrtC) / (hc + hr);

  // The campfire. `Δt̄_r` is by definition a rise in mean radiant temperature, so it is added
  // here and nowhere else; everything downstream (operative temperature, and `t_r` as the two
  // physical models consume it) picks it up for free. It is never added to M.
  const fire = campfireEffect(input.radiantSource, {
    convectiveCoefficient: hc,
    radiativeCoefficient: hr,
    airVelocity,
  });
  warnings.push(...fire.warnings);
  const fireDeltaMrtK = fire.deltaMeanRadiantK;
  const meanRadiantTemperatureC = meanRadiantTemperatureWithoutSourceC + fireDeltaMrtK;

  const operativeTemperatureC = operative(meanRadiantTemperatureC);
  const operativeTemperatureWithoutSourceC =
    fireDeltaMrtK === 0 ? operativeTemperatureC : operative(meanRadiantTemperatureWithoutSourceC);

  const radiantOffsetK = meanRadiantTemperatureC - airTemperatureC;
  const radiantOffsetWithoutSourceK = meanRadiantTemperatureWithoutSourceC - airTemperatureC;
  if (fire.on) caveats.push(CAMPFIRE_CAVEAT);

  if (svf > 0.5 && sky.depressionK > 8) {
    caveats.push(
      `Clear-sky radiant loss is costing ${(-radiantOffsetWithoutSourceK).toFixed(1)} K of mean radiant ` +
        `temperature here (sky at ${sky.skyTemperatureC.toFixed(0)} °C). STANDARDS §6.8: a clear ` +
        'night costs a person in the open roughly 5–6 K of operative temperature versus the ' +
        'forecast air temperature, and roughly 4–5 K versus the same night overcast.',
    );
  }
  if (shelterKind === 'tent' && input.occupiedTent !== true) {
    caveats.push(
      'Tent air is modelled 1 K *below* ambient, which is what two peer-reviewed campaigns ' +
        "measured on clear nights (STANDARDS §6.10). A tent's benefit is radiant, not thermal.",
    );
  }
  if (Number.isNaN(operativeWeightingFactor(airVelocity))) {
    caveats.push(
      "Wind exceeds the ASHRAE 55 / ISO 7730 operative-temperature A-table's 1.0 m/s ceiling; " +
        'the h_c/h_r form is used instead. The models themselves take t_a and t_r separately, so ' +
        'this affects the displayed operative temperature only.',
    );
  }

  return {
    airTemperatureC,
    meanRadiantTemperatureC,
    operativeTemperatureC,
    airVelocity,
    sky,
    skyViewFactor: svf,
    radiantOffsetK,
    radiantSourceDeltaMrtK: fireDeltaMrtK,
    campfire: fire,
    meanRadiantTemperatureWithoutSourceC,
    operativeTemperatureWithoutSourceC,
    radiantOffsetWithoutSourceK,
    warnings,
    caveats,
  };
}

/** Net longwave loss from a body surface at `surfaceC` to the sky, W/m². Diagnostic. */
export function netLongwaveToSky(
  surfaceC: Celsius,
  skyC: Celsius,
  viewFactor = 0.5,
  emissivity = BODY_LONGWAVE_EMISSIVITY,
): WattsPerSquareMetre {
  const k = (c: Celsius): number => c + ISO_KELVIN_OFFSET;
  return emissivity * STEFAN_BOLTZMANN * viewFactor * (Math.pow(k(surfaceC), 4) - Math.pow(k(skyC), 4));
}
