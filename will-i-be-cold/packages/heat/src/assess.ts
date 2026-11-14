/**
 * The uniform front door: one assessment type, two physical models behind it.
 *
 * `assess()` dispatches on the configuration (a clothed ensemble goes to ISO 11079 IREQ, a
 * sleep system goes to ISO 23537 Annex C), and returns the same `ThermalAssessment` either
 * way. The UI reads `verdict`, `marginK` and `comfort` and never needs to know which model
 * ran; `model` is there so the caveats panel can say which standard is being quoted.
 */

import {
  MET,
  metToWattsPerSquareMetre,
  type Celsius,
  type Fraction,
  type MetresPerSecond,
  type WattsPerSquareMetre,
} from './units.js';
import {
  ThermalModelError,
  verdictFrom,
  warn,
  type ModelWarning,
  type PhaseName,
  type ThermalAssessment,
  type Verdict,
} from './types.js';
import { AIR_PERMEABILITY, IREQ_VALIDITY, ireq } from './ireq.js';
import {
  DRAPED_ADJUSTABILITY,
  ensembleInsulation,
  type EnsembleOptions,
  type Garment,
} from './garments.js';
import {
  CAMPFIRE_CAVEAT,
  resolveEnvironment,
  type RadiantSourceInput,
  type ShelterKind,
} from './environment.js';
import { solveSleepSystem, type SleepSystemInput } from './sleep.js';

/**
 * `SPEC.md` §2.6 metabolic rates, met. Sleep is 0.8 met, which is *below* ISO 11079's 1.0 met
 * floor: that is exactly why sleep uses a different model.
 */
export const PHASE_METABOLIC_RATE_MET: Readonly<Record<PhaseName, number>> = {
  hiking: 3.0,
  day_break: 1.3,
  camp_evening: 1.1,
  camp_morning: 1.3,
  sleep: 0.8,
};

/** `SPEC.md` §2.6: scale by grade, +0.5 met per 10 % uphill, 2.5 met descending. */
export const HIKING_MET_BY_GRADE = { rolling: 3.0, steepClimb: 4.5, descent: 2.5 } as const;

export interface PhaseConditions {
  /** Forecast 2 m air temperature, °C. */
  readonly airTemperature: Celsius;
  readonly relativeHumidity: Fraction;
  readonly cloudCover: Fraction;
  /** Forecast 10 m wind speed, m/s. */
  readonly windSpeed: MetresPerSecond;
  readonly shelter?: ShelterKind;
  readonly shortwaveRadiation?: WattsPerSquareMetre | null;
  /** `SPEC.md` §2.7's "it rained today" toggle. */
  readonly wet?: boolean;
  readonly occupiedTent?: boolean;
  /**
   * An optional **radiant heat source**: a campfire. **Off by default**: omitting it, or
   * passing `{ on: false }`, is no fire.
   *
   * It raises mean radiant temperature and therefore operative temperature
   * (`SPEC.md` §2.2: "a campfire raises T_mrt on one side"); it is **not** a metabolic bonus.
   * Its benefit reaches the whole-body core balance and is **withheld from the extremity
   * verdicts**: see {@link CAMPFIRE_CAVEAT}. The numbers are `docs/CAMPFIRE.md` §9.2's
   * recommended parameter block; `CAMPFIRE` in `environment.ts` is the single place they live.
   * The design case is a seated person 1.2 m from a ~10 kW wood fire: **Δt_o ≈ 2 K**.
   */
  readonly campfire?: RadiantSourceInput;
}

export interface ClothedConfiguration {
  readonly kind: 'clothed';
  readonly garments: readonly Garment[];
  /** Metabolic rate, W/m². Must be ≥ 58 (ISO 11079's floor). */
  readonly metabolicRate: WattsPerSquareMetre;
  /** Mechanical work, W/m². ~0 on trail; a few per cent of M uphill. */
  readonly work?: WattsPerSquareMetre;
  /** Extra catalogue clo not in `garments`: e.g. a bag draped over the shoulders in camp. */
  readonly extraClo?: number;
  /**
   * Fraction of `extraClo` that can be shed without putting it away. Defaults to
   * {@link DRAPED_ADJUSTABILITY}, because the only thing `extraClo` is used for today is a bag
   * or quilt draped over the shoulders: the most adjustable item in the model. Pass 0 for an
   * `extraClo` that is genuinely binary.
   */
  readonly extraCloAdjustability?: number;
  readonly ensembleOptions?: EnsembleOptions;
}

export interface SleepConfiguration {
  readonly kind: 'sleep';
  readonly system: SleepSystemInput;
}

export type Configuration = ClothedConfiguration | SleepConfiguration;

/** Sum of the catalogue clo a clothed configuration provides, after the ensemble rule. */
export function configurationClo(config: ClothedConfiguration): number {
  const options: EnsembleOptions = config.ensembleOptions ?? {};
  return ensembleInsulation(config.garments, options).clo + (config.extraClo ?? 0);
}

/** Clo the configuration's `extraClo` (a drape) can shed without being put away. */
const extraVentableClo = (config: ClothedConfiguration): number =>
  (config.extraClo ?? 0) * (config.extraCloAdjustability ?? DRAPED_ADJUSTABILITY);

/**
 * Clo this configuration can shed **without removing a garment**: unzipped, sleeves up, pit
 * zips open, hood down, drape loosened. The width by which venting extends the configuration's
 * comfort interval *upward in temperature*; it never moves the cold limit.
 *
 * ⚠️ Rests on `estimated` per-class adjustabilities (`garments.ts`
 * `ADJUSTABILITY_DEFAULTS`). `conditions` is taken because the wet derate changes the answer.
 */
export function configurationVentableClo(
  config: ClothedConfiguration,
  conditions?: Pick<PhaseConditions, 'wet'>,
): number {
  const options: EnsembleOptions = {
    ...(conditions?.wet !== undefined ? { wet: conditions.wet } : {}),
    ...(config.ensembleOptions ?? {}),
  };
  return ensembleInsulation(config.garments, options).ventableClo + extraVentableClo(config);
}

function clothedAssessmentAt(
  config: ClothedConfiguration,
  conditions: PhaseConditions,
  airTemperature: Celsius,
  fast: boolean,
): { marginClo: number; ventableClo: number; assessment?: ThermalAssessment } {
  const env = resolveEnvironment({
    airTemperature,
    relativeHumidity: conditions.relativeHumidity,
    cloudCover: conditions.cloudCover,
    windSpeed: conditions.windSpeed,
    ...(conditions.shelter !== undefined ? { shelter: conditions.shelter } : {}),
    ...(conditions.shortwaveRadiation !== undefined
      ? { shortwaveRadiation: conditions.shortwaveRadiation }
      : {}),
    ...(conditions.occupiedTent !== undefined ? { occupiedTent: conditions.occupiedTent } : {}),
    ...(conditions.campfire !== undefined ? { radiantSource: conditions.campfire } : {}),
  });

  const ensembleOptions: EnsembleOptions = {
    ...(conditions.wet !== undefined ? { wet: conditions.wet } : {}),
    ...(config.ensembleOptions ?? {}),
  };
  const ensemble = ensembleInsulation(config.garments, ensembleOptions);
  const totalClo = ensemble.clo + (config.extraClo ?? 0);
  const ventableClo = ensemble.ventableClo + extraVentableClo(config);

  const result = ireq(
    {
      airTemperature: env.airTemperatureC,
      radiantTemperature: env.meanRadiantTemperatureC,
      airVelocity: env.airVelocity,
      relativeHumidity: conditions.relativeHumidity,
      metabolicRate: config.metabolicRate,
      ...(config.work !== undefined ? { work: config.work } : {}),
      clothingInsulation: totalClo * 0.155,
      // `ireq()`'s own default is a_p = 8, the standard's Table F.1 reference clothing. Here
      // we choose per ensemble instead: membrane-grade when a windproof shell is outermost,
      // ordinary woven otherwise. (STANDARDS §1.7's worked bracket values overstate how much
      // this matters: see the test in ireq.test.ts, but the direction is right.)
      airPermeability: ensemble.hasWindproofShell
        ? AIR_PERMEABILITY.windproofMembrane
        : AIR_PERMEABILITY.ordinaryWoven,
    },
    { onOutOfRange: 'warn', ...(fast ? { skipDurationLimitedExposure: true } : {}) },
  );

  if (fast) return { marginClo: result.marginClo, ventableClo };

  const warnings: ModelWarning[] = [...ensemble.warnings, ...env.warnings, ...result.warnings];
  const caveats: string[] = [...env.caveats];
  if (ensemble.hasWindproofShell) {
    caveats.push(
      'A windproof shell is modelled as the outermost layer: ISO 11079 §1.7 handles this through ' +
        'air permeability (a_p = 1 l·m⁻²·s⁻¹, membrane-grade), which nearly removes the ' +
        'wind-pumping loss. ISO 9920\'s cold-weather a_p correction is marked "do not ship" in ' +
        'docs/STANDARDS.md §7.1 and is not used.',
    );
  }
  if (conditions.wet === true) {
    caveats.push(
      'Wet derate applied. SPEC §2.7\'s retention factors are estimated: docs/STANDARDS.md has ' +
        'nothing on wet insulation, and REFERENCE_warmth_check.md only says "the check assumes ' +
        'dry layers". Wet changes everything and this model barely models it.',
    );
  }
  caveats.push(
    'Steady state only. ISO 11079 drops the storage term for IREQ; the verdict is "where you ' +
      'settle", not "how you feel in the first ten minutes".',
    'Person-to-person variation in required insulation is roughly ±1 clo at the same conditions. ' +
      'The margin here is a model, not a measurement of you.',
  );
  if (result.dleNeutral.hours !== null) {
    caveats.push(
      `Duration-limited exposure is reported to one significant figure only: ISO 11079's own f_cl ` +
        'ambiguity (body text 1.97 vs Annex F 1.197) moves DLE by up to 5 h. It also answers ' +
        '"when is your core in heat debt", not "when do you feel cold", and a field validation ' +
        'study found its skin-temperature criteria were not met at −14 and −22 °C.',
    );
  }

  const assessment: ThermalAssessment = {
    model: 'iso-11079-ireq',
    verdict: 'fine', // replaced by the caller once the cold limit is known
    marginK: 0,
    comfort: { coldLimitC: Number.NaN, warmLimitC: null },
    conditions: {
      airTemperatureC: env.airTemperatureC,
      meanRadiantTemperatureC: env.meanRadiantTemperatureC,
      operativeTemperatureC: env.operativeTemperatureC,
      airVelocity: env.airVelocity,
      relativeHumidity: conditions.relativeHumidity,
      metabolicRate: config.metabolicRate,
      radiantSourceDeltaMrtK: env.radiantSourceDeltaMrtK,
      operativeTemperatureWithoutSourceC: env.operativeTemperatureWithoutSourceC,
    },
    detail: {
      model: 'iso-11079-ireq',
      ireqNeutral: result.ireqNeutral,
      ireqMin: result.ireqMin,
      requiredNeutralClo: result.requiredNeutralClo,
      requiredMinClo: result.requiredMinClo,
      providedClo: result.providedClo,
      marginClo: result.marginClo,
      storageNeutral: result.storageNeutral,
      dleNeutral: result.dleNeutral,
      dleMin: result.dleMin,
    },
    warnings,
    caveats,
  };
  return { marginClo: result.marginClo, ventableClo, assessment };
}

/**
 * ⚠️ Estimated. How much insulation above IREQ_neutral counts as "too warm".
 *
 * `SPEC.md` §2.1 suggests "~0.5 clo", but `REFERENCE_warmth_check.md` calls ±0.3 clo
 * *marginal* and anything above +0.3 clo *fine*, so a 0.5 clo ceiling would leave a 0.2 clo
 * sliver of "fine" and call a comfortable hiker overheated. v1 does not model sweating at all
 * (SPEC §2.1 itself defers the evaporative side), so the warm end of every comfort interval is
 * deliberately soft and generous. 1.0 clo is our choice, not the SPEC's.
 */
export const TOO_WARM_HEADROOM_CLO = 1.0;

const SEARCH: { minC: Celsius; maxC: Celsius; iterations: number } = {
  minC: -60,
  maxC: 40,
  iterations: 44,
};

/**
 * The coldest air temperature at which a clothed configuration still meets IREQ_neutral.
 *
 * The environment is re-resolved at every trial temperature, so the night-sky radiant penalty
 * and the sky emissivity's own temperature dependence travel with the search rather than being
 * frozen at the forecast value.
 *
 * @throws ThermalModelError if the root lies outside [−60, +40] °C.
 */
export function clothedColdLimit(
  config: ClothedConfiguration,
  conditions: PhaseConditions,
  headroomClo = 0,
): Celsius {
  const f = (t: Celsius): number =>
    clothedAssessmentAt(config, conditions, t, true).marginClo - headroomClo;
  if (f(SEARCH.maxC) < 0) {
    throw new ThermalModelError(
      'cold_limit_above_domain',
      `This configuration does not reach thermal neutrality even at +${SEARCH.maxC} °C.`,
    );
  }
  if (f(SEARCH.minC) > 0) {
    throw new ThermalModelError(
      'cold_limit_below_domain',
      `This configuration is still comfortable at ${SEARCH.minC} °C, outside the modelled domain.`,
    );
  }
  let lo = SEARCH.minC;
  let hi = SEARCH.maxC;
  for (let i = 0; i < SEARCH.iterations; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The warm end: where the ensemble carries `TOO_WARM_HEADROOM_CLO` more than it needs, after
 * shedding `ventedClo` without taking anything off.
 *
 * **Why extra headroom is the same thing as venting.** `ireq()`'s `marginClo` is
 * `providedClo − requiredNeutralClo`, and `requiredNeutralClo` does not depend on what is worn
 * (it falls out of the balance; the only ensemble input to it is air permeability, and venting a
 * jacket does not change whether a windproof shell is on). So
 * `margin_vented(t) = margin_closed(t) − ventedClo` exactly, and the temperature at which the
 * *vented* ensemble has `TOO_WARM_HEADROOM_CLO` to spare is the temperature at which the
 * *closed* ensemble has `TOO_WARM_HEADROOM_CLO + ventedClo` to spare. One bisection, no
 * approximation, and no second ensemble solve.
 */
function clothedWarmLimit(
  config: ClothedConfiguration,
  conditions: PhaseConditions,
  ventedClo = 0,
): Celsius | null {
  try {
    return clothedColdLimit(config, conditions, TOO_WARM_HEADROOM_CLO + ventedClo);
  } catch {
    return null;
  }
}

/** Assess one configuration against one set of conditions. */
export function assess(config: Configuration, conditions: PhaseConditions): ThermalAssessment {
  return config.kind === 'clothed'
    ? assessClothed(config, conditions)
    : assessSleep(config, conditions);
}

function assessClothed(
  config: ClothedConfiguration,
  conditions: PhaseConditions,
): ThermalAssessment {
  if (config.metabolicRate < IREQ_VALIDITY.minMetabolicRate) {
    throw new ThermalModelError(
      'clothed_metabolic_rate_below_floor',
      `A clothed phase was assessed at M = ${config.metabolicRate.toFixed(1)} W/m², below ` +
        `ISO 11079's ${IREQ_VALIDITY.minMetabolicRate} W/m² floor. If this is sleep, use a ` +
        'SleepConfiguration; if it is a very low-activity clothed phase, raise M to the floor ' +
        'deliberately and record the extrapolation.',
    );
  }
  const base = clothedAssessmentAt(config, conditions, conditions.airTemperature, false);
  const built = base.assessment;
  if (built === undefined) {
    throw new ThermalModelError('assess_internal', 'Clothed assessment failed to build a result.');
  }

  let coldLimitC: number;
  const warnings = [...built.warnings];
  try {
    coldLimitC = clothedColdLimit(config, conditions);
  } catch (error) {
    coldLimitC = error instanceof ThermalModelError && error.code === 'cold_limit_below_domain'
      ? SEARCH.minC
      : SEARCH.maxC;
    warnings.push(
      warn(
        'cold_limit_outside_domain',
        'out-of-range',
        `The comfort interval's cold end is outside the modelled −60…+40 °C domain; clamped to ` +
          `${coldLimitC} °C.`,
      ),
    );
  }
  // Two warm ends, because a garment is not binary. `fullyClosedWarmLimitC` is where this
  // ensemble gets too warm with everything zipped up; `warmLimitC` is where it gets too warm
  // *even with everything opened*, which is the real top of the comfort interval and the number
  // coverage is computed against. The cold limit is untouched by venting: fully closed is as
  // warm as it gets, and that is the whole asymmetry.
  const ventableClo = base.ventableClo;
  const fullyClosedWarmLimitC = clothedWarmLimit(config, conditions);
  const warmLimitC =
    ventableClo > 0 ? clothedWarmLimit(config, conditions, ventableClo) : fullyClosedWarmLimitC;
  const marginK = built.conditions.airTemperatureC - coldLimitC;

  // The *closed* interval's width is TOO_WARM_HEADROOM_CLO expressed in kelvin, which gives
  // this configuration's own dT/dclo sensitivity for free. Measured on the closed interval on
  // purpose: it is a local sensitivity, and the vented interval spans a much wider clo range.
  const kelvinPerClo =
    fullyClosedWarmLimitC === null
      ? undefined
      : (fullyClosedWarmLimitC - coldLimitC) / TOO_WARM_HEADROOM_CLO;

  // No `dangerous` verdict comes out of the clothed model, deliberately. "Dangerous" is a
  // duration-dependent claim and the model is not told how long the phase lasts; ISO 11079's
  // own answer to that question is DLE, which `MODEL.md` §4 says to ship as a *separate*
  // safety line surfaced only when it is short, and which a field validation study found did
  // not meet its own skin-temperature criteria at −14 and −22 °C. So a short DLE_min raises a
  // warning here and never silently becomes a verdict word.
  const dleMin = built.detail.model === 'iso-11079-ireq' ? built.detail.dleMin : null;
  if (dleMin !== null && dleMin.hours !== null && dleMin.hours <= SHORT_DLE_WARNING_HOURS) {
    warnings.push(
      warn(
        'short_duration_limited_exposure',
        'caution',
        // No per-configuration number here either: several candidates would otherwise emit the
        // same sentence with a different hour count each. The figure is on each candidate, at
        // `detail.dleMin.display`.
        `ISO 11079 duration-limited exposure against the *min* criterion is ` +
          `${SHORT_DLE_WARNING_HOURS} h or less here: i.e. standing still runs the full ` +
          '40 Wh/m² body heat debt inside that time. DLE is an index, not a physiological ' +
          'prediction, and is reported to one significant figure only; each configuration ' +
          'carries its own value at `detail.dleMin`.',
      ),
    );
  }

  const comfort = { coldLimitC, warmLimitC, fullyClosedWarmLimitC, ventableClo };
  const caveats = [...built.caveats];
  if (ventableClo > 0.02) {
    // ⚠️ **No per-configuration number in this string, on purpose.** A caveats panel showing
    // several candidates would otherwise print this same paragraph once per candidate, differing
    // only in its clo figure, which reads as a bug and buries the caveats that say different
    // things. The mechanism goes here; the number goes on the candidate (`comfort.ventableClo`,
    // and `CandidateEnsemble.ventingCloRange` for a hover label).
    caveats.push(
      'Garments are modelled as adjustable, not binary: a configuration can shed some of its ' +
        'insulation without anything being taken off (unzipped, sleeves pushed up, pit zips ' +
        'open, hood down), so its comfort interval runs upward past where the same garments ' +
        'fully closed would be too warm. The cold end is unaffected, because fully closed is as ' +
        'warm as it gets. The per-garment-class adjustabilities behind that are estimated, not ' +
        'measured: ISO 9920 tabulates garments worn open versus closed in Annex A, which ' +
        'docs/STANDARDS.md §7.2 item 10 records as never obtained.',
    );
  }

  return {
    ...built,
    warnings,
    caveats,
    verdict: verdictFrom({
      airTemperatureC: built.conditions.airTemperatureC,
      comfort,
      ...(kelvinPerClo !== undefined ? { kelvinPerClo } : {}),
    }),
    marginK,
    comfort,
  };
}

/**
 * ⚠️ Estimated threshold. `DLE_min` at or below this many hours raises a warning. One hour is
 * a judgement call: ISO 11079 publishes the index and no verdict words at all.
 */
export const SHORT_DLE_WARNING_HOURS = 1;

/**
 * Sleep deliberately ignores `conditions.campfire`. You are in a bag inside a shelter; the fire
 * is outside it and is not warming the bag's outer surface in any way this model could claim to
 * know. Passing a fire for the sleep phase is a no-op rather than a quiet bonus.
 */
function assessSleep(config: SleepConfiguration, conditions: PhaseConditions): ThermalAssessment {
  const env = resolveEnvironment({
    airTemperature: conditions.airTemperature,
    relativeHumidity: conditions.relativeHumidity,
    cloudCover: conditions.cloudCover,
    windSpeed: conditions.windSpeed,
    shelter: conditions.shelter ?? 'tent',
    ...(conditions.shortwaveRadiation !== undefined
      ? { shortwaveRadiation: conditions.shortwaveRadiation }
      : {}),
    ...(conditions.occupiedTent !== undefined ? { occupiedTent: conditions.occupiedTent } : {}),
  });

  const system = solveSleepSystem(config.system);

  // ISO 23537's chamber has t_r = t_a (an enclosed test room), so the rating temperatures are
  // air temperatures with no radiant penalty baked in. Outdoors there is one; we charge the
  // radiant offset against the air temperature the system is compared to. Under a tent fly
  // this is ≈0 by construction, which is the point of §6.10.
  const effectiveAirC = env.airTemperatureC + env.radiantOffsetK * SLEEP_RADIANT_COUPLING;

  const marginK = effectiveAirC - system.comfortC;
  const warnings: ModelWarning[] = [...env.warnings, ...system.warnings];
  const caveats: string[] = [...env.caveats, ...system.caveats];

  caveats.push(
    'Sleep uses ISO 23537 Annex C, not ISO 11079. IREQ\'s validity floors are M ≥ 58 W/m² and ' +
      'v_ar ≥ 0.4 m/s; a sleeping person is ~45 W/m² at ~0.05 m/s and is outside the standard on ' +
      'both axes.',
    'The Annex C mean skin temperature is a fitted value, not a sourced constant: the literal ' +
      'Annex C text was never obtained. It reproduces all 72 cells of the standard\'s own ' +
      'normative Table 1 to better than 0.1 K, which is strong corroboration of the equations.',
  );
  if (env.skyViewFactor > 0.2) {
    caveats.push(
      'No published angular/view factors exist for a supine person (docs/STANDARDS.md §6.7). ' +
        'F_sky = 0.5 is a first-principles half-space result that happens to match the standing ' +
        'factors in open terrain; under partial obstruction a lying person loses more sky than ' +
        'this model charges them for.',
    );
  }

  return {
    model: 'iso-23537-annex-c',
    verdict: verdictFrom({
      airTemperatureC: effectiveAirC,
      comfort: {
        coldLimitC: system.comfortC,
        warmLimitC: system.ventedComfortC + SLEEP_VENT_HEADROOM_K,
      },
      survivalCriterionFailing: effectiveAirC < system.extremeC,
    }),
    marginK,
    comfort: { coldLimitC: system.comfortC, warmLimitC: system.ventedComfortC + SLEEP_VENT_HEADROOM_K },
    conditions: {
      airTemperatureC: env.airTemperatureC,
      meanRadiantTemperatureC: env.meanRadiantTemperatureC,
      operativeTemperatureC: env.operativeTemperatureC,
      airVelocity: env.airVelocity,
      relativeHumidity: conditions.relativeHumidity,
      metabolicRate: metToWattsPerSquareMetre(PHASE_METABOLIC_RATE_MET.sleep),
      radiantSourceDeltaMrtK: 0,
      operativeTemperatureWithoutSourceC: env.operativeTemperatureWithoutSourceC,
    },
    detail: {
      model: 'iso-23537-annex-c',
      systemRc: system.systemRc,
      labelRc: system.labelRc,
      overPathRc: system.overPathRc,
      underPathRc: system.underPathRc,
      comfortC: system.comfortC,
      limitC: system.limitC,
      extremeC: system.extremeC,
      labelComfortC: system.labelComfortC,
      padPenaltyK: system.padPenaltyK,
    },
    warnings,
    caveats,
  };
}

/**
 * ⚠️ Estimated. How much of the mean-radiant-temperature offset a person inside a sleeping bag
 * actually feels. ISO 23537's chamber has t_r = t_a, so a rating temperature is an air
 * temperature; outdoors the bag's outer surface sees the sky. A bag's outer shell is well
 * insulated from the sleeper, so the coupling is weaker than for bare clothing, but there is
 * no measurement of how much weaker. 1.0 would charge the full radiant penalty; we use 0.6.
 * Under a tent fly the offset is ≈0 anyway, which is where most users are.
 */
export const SLEEP_RADIANT_COUPLING = 0.6;

/**
 * ⚠️ Estimated. Extra headroom above the vented-bag comfort temperature before "too warm".
 * ISO 23537's `T_max` would be the right number; the 2022 edition demoted it to informative
 * Annex F and it was never obtained.
 */
export const SLEEP_VENT_HEADROOM_K = 4;

/** Convenience: met → W/m² at the project's standard 58.15 W/m² per met. */
export const metToWm2 = (met: number): WattsPerSquareMetre => met * MET;

/** Re-exported for callers building their own candidate ladders. */
export type { Verdict };
