/**
 * Shared public types: provenance labelling, warnings, and the one uniform verdict shape
 * that both physical models produce.
 */

import type { Celsius, Fraction, MetresPerSecond, SquareMetreKelvinPerWatt, WattsPerSquareMetre } from './units.js';

/**
 * Where a number came from. This is load-bearing: `docs/STANDARDS.md` is explicit that
 * several things this library needs were never published as measurements, and the product's
 * credibility rests on saying which is which.
 *
 * - `iso11079` / `iso9920` / `iso23537` / `astm-f3340` / `ashrae`: traceable to a standard
 *   or to ASHRAE 55 / ISO 7730 Annex C's published garment table.
 * - `peer-reviewed`: a cited paper, not a standard.
 * - `derived`: computed here from inputs that are themselves `iso*`/`peer-reviewed`.
 * - `loft-derived`: produced by the 4 clo/inch loft rule (`SPEC.md` §2.3), which is itself
 *   `estimated`.
 * - `estimated`: a judgement call. **Not measured, not in any standard.** Every one of these
 *   is listed in the README and is overridable through the model's parameter objects.
 */
export type Provenance =
  | 'iso11079'
  | 'iso9920'
  | 'iso23537'
  | 'astm-f3340'
  | 'ashrae'
  | 'peer-reviewed'
  | 'derived'
  | 'loft-derived'
  | 'estimated';

/** A constant whose value is not traceable to a verified source. */
export interface UnverifiedConstant {
  readonly id: string;
  readonly value: number;
  readonly units: string;
  readonly provenance: Provenance;
  /** Why this number and not another; what would change if it is wrong. */
  readonly note: string;
}

/** Severity of a model warning. `error`-level conditions throw instead of warning. */
export type WarningSeverity = 'info' | 'caution' | 'out-of-range';

export interface ModelWarning {
  readonly code: string;
  readonly severity: WarningSeverity;
  readonly message: string;
}

export const warn = (code: string, severity: WarningSeverity, message: string): ModelWarning => ({
  code,
  severity,
  message,
});

/** Thrown when a model is asked for a number it cannot honestly produce. Never return NaN. */
export class ThermalModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ThermalModelError';
    this.code = code;
  }
}

/** Which physical model produced a verdict. Visible so the UI can render the right caveats. */
export type ThermalModelId = 'iso-11079-ireq' | 'iso-23537-annex-c';

/** The five phases of a backpacking day. Mirrors `@will-i-be-cold/weather`'s `PhaseName`. */
export type PhaseName = 'camp_morning' | 'hiking' | 'day_break' | 'camp_evening' | 'sleep';

export const PHASE_NAMES = [
  'camp_morning',
  'hiking',
  'day_break',
  'camp_evening',
  'sleep',
] as const satisfies readonly PhaseName[];

/** Phases modelled by ISO 11079. Sleep is modelled by ISO 23537: see README §"Two models". */
export const CLOTHED_PHASES = [
  'camp_morning',
  'hiking',
  'day_break',
  'camp_evening',
] as const satisfies readonly PhaseName[];

/**
 * The comfort interval of one configuration: the band of air temperatures in which it works.
 *
 * `coldLimitC` is the honest "threshold of feeling cold" for that model: IREQ_neutral for
 * clothed phases, ISO 23537 T_comf for sleep. `warmLimitC` is a much softer number (see
 * README §"Caveats"); it is `null` when the model declines to give one.
 */
export interface ComfortInterval {
  readonly coldLimitC: Celsius;
  readonly warmLimitC: Celsius | null;
  /**
   * The warm limit with **nothing vented**: everything zipped, sleeves down, hood up.
   *
   * A garment is not binary: it is worn open, half-zipped, sleeves pushed up, pit zips open.
   * So a configuration has a *range* of effective insulation, and its comfort interval runs
   * from the fully-closed cold limit (`coldLimitC`, unchanged by venting: closed is as warm as
   * it gets) up to the fully-vented warm limit (`warmLimitC`). This field is the old,
   * binary-garment warm end, kept because it is what the configuration's own dT/dclo
   * sensitivity is measured on. `null` when the model declines to give one.
   */
  readonly fullyClosedWarmLimitC?: Celsius | null;
  /** Clo this configuration can shed without removing anything. `warmLimitC` is where it goes. */
  readonly ventableClo?: number;
}

export type Verdict = 'too_warm' | 'fine' | 'marginal' | 'cold' | 'dangerous';

/**
 * Duration-limited exposure, ISO 11079 §5.5 / `docs/STANDARDS.md` §1.8.
 *
 * **Reported to one significant figure only, by construction.** The f_cl ambiguity
 * (`docs/STANDARDS.md` §7.1 item 1) moves DLE by up to 5 h for long exposures, and
 * `MODEL.md` §4 notes that DLE answers "when is your core in heat debt", not "when do you
 * feel cold". The raw solver output is deliberately not exported.
 */
export interface DurationLimitedExposure {
  /** Hours, already rounded to one significant figure. `null` means "longer than 8 h". */
  readonly hours: number | null;
  /** Ready to render: `"0.7 h"`, `"2 h"`, `"> 8 h"`. */
  readonly display: string;
  readonly criterion: 'neutral' | 'min';
  /** Always 1. Present so a caller cannot mistake `hours` for a precise number. */
  readonly significantFigures: 1;
}

/** The environment a phase is actually experienced in, after radiant corrections. */
export interface ResolvedConditions {
  /** Air temperature actually used, °C: forecast air temperature plus any shelter offset. */
  readonly airTemperatureC: Celsius;
  /** Mean radiant temperature, °C (`environment.ts`). */
  readonly meanRadiantTemperatureC: Celsius;
  /** Operative temperature, °C. Display only: the models take t_a and t_r separately. */
  readonly operativeTemperatureC: Celsius;
  /** Relative air velocity at the body, m/s. */
  readonly airVelocity: MetresPerSecond;
  readonly relativeHumidity: Fraction;
  readonly metabolicRate: WattsPerSquareMetre;
  /**
   * `ΔT_mrt` contributed by a directional radiant heat source: a campfire. 0 when there is
   * none, which is the default. **Never a metabolic bonus:** it enters as mean radiant
   * temperature and therefore through the operative-temperature path.
   */
  readonly radiantSourceDeltaMrtK?: number;
  /**
   * Operative temperature with any radiant heat source **removed**, °C. Equal to
   * `operativeTemperatureC` when there is no fire.
   *
   * 🔴 **This is the number the extremity verdicts use, deliberately.** A fire is radiantly
   * asymmetric (it heats the side of you that faces it), and a whole-body steady-state balance
   * launders that asymmetry into a comfort it has not earned. The whole-body core balance gets
   * the fire; hands, feet and head do not.
   */
  readonly operativeTemperatureWithoutSourceC?: Celsius;
}

/** ISO 11079 detail. Only meaningful when `model === 'iso-11079-ireq'`. */
export interface IreqDetail {
  readonly model: 'iso-11079-ireq';
  /** Resultant (dynamic) insulation required for thermal neutrality, m²K/W. */
  readonly ireqNeutral: SquareMetreKelvinPerWatt;
  /** Resultant insulation required to merely limit body cooling, m²K/W. */
  readonly ireqMin: SquareMetreKelvinPerWatt;
  /** Basic (static, catalogue) clothing insulation those require, clo. */
  readonly requiredNeutralClo: number;
  readonly requiredMinClo: number;
  /** Basic clothing insulation actually worn, clo. */
  readonly providedClo: number;
  /** `providedClo − requiredNeutralClo`. Positive is headroom. */
  readonly marginClo: number;
  /** Body heat storage rate with the worn ensemble, W/m². Negative = cooling. */
  readonly storageNeutral: WattsPerSquareMetre;
  readonly dleNeutral: DurationLimitedExposure;
  readonly dleMin: DurationLimitedExposure;
}

/** ISO 23537 detail. Only meaningful when `model === 'iso-23537-annex-c'`. */
export interface SleepDetail {
  readonly model: 'iso-23537-annex-c';
  /** Whole-system R_c(1)-equivalent of the user's actual system, m²K/W. */
  readonly systemRc: SquareMetreKelvinPerWatt;
  /** Whole-system R_c(1) the bag's label implies, with the ISO reference mattress. */
  readonly labelRc: SquareMetreKelvinPerWatt;
  /** Over-path (bag + cavity + boundary layer) resistance, m²K/W. Back-solved from the label. */
  readonly overPathRc: SquareMetreKelvinPerWatt;
  /** Under-path (crushed bag + pad) resistance, m²K/W. */
  readonly underPathRc: SquareMetreKelvinPerWatt;
  readonly comfortC: Celsius;
  readonly limitC: Celsius;
  readonly extremeC: Celsius;
  /** What the label would predict, with the ISO reference mattress in place. */
  readonly labelComfortC: Celsius;
  /** `comfortC − labelComfortC`: how many K the user's pad costs (positive = worse). */
  readonly padPenaltyK: number;
}

/** The uniform result. The UI reads `verdict`, `marginK` and `comfort`; nothing else. */
export interface ThermalAssessment {
  readonly model: ThermalModelId;
  readonly verdict: Verdict;
  /**
   * Headroom in kelvin: `airTemperature − coldLimit`. Positive means the configuration is
   * warmer than it needs to be. This is the one number both models can produce honestly,
   * which is why the verdict is derived from it.
   */
  readonly marginK: number;
  readonly comfort: ComfortInterval;
  readonly conditions: ResolvedConditions;
  readonly detail: IreqDetail | SleepDetail;
  readonly warnings: readonly ModelWarning[];
  readonly caveats: readonly string[];
}

/**
 * Verdict bands.
 *
 * `REFERENCE_warmth_check.md` states its thresholds in clo (±0.3 clo is "marginal", below
 * −0.3 clo is "cold"). We keep that number and convert it to kelvin *locally*, using each
 * configuration's own dT/dclo sensitivity, because one clo is worth ~8 K sitting in camp and
 * ~20 K hiking: a single fixed kelvin band would mean different things in different phases.
 */
export const VERDICT_BANDS = {
  /** The reference document's marginal band, in clo. */
  marginalClo: 0.3,
  /** Fallback band in kelvin when a dT/dclo sensitivity is not available (the sleep model). */
  fallbackBandK: 3,
} as const;

export interface VerdictInput {
  /** Air temperature actually experienced, °C. */
  readonly airTemperatureC: Celsius;
  readonly comfort: ComfortInterval;
  /**
   * Kelvin per clo for this configuration, from the width of its own comfort interval.
   * Omit for models that do not express the interval in clo.
   */
  readonly kelvinPerClo?: number;
  /**
   * True when the *survival* criterion is also failing: below ISO 11079's IREQ_min the
   * standard itself says there is "risk of progressive body cooling", and in practice we
   * trigger on its own duration-limited-exposure quantity instead, so the word "dangerous"
   * means something a user can act on rather than firing at every cold lunch stop.
   */
  readonly survivalCriterionFailing?: boolean;
}

export function verdictFrom(input: VerdictInput): Verdict {
  if (input.survivalCriterionFailing === true) return 'dangerous';
  const band =
    input.kelvinPerClo === undefined
      ? VERDICT_BANDS.fallbackBandK
      : Math.max(1, VERDICT_BANDS.marginalClo * input.kelvinPerClo);
  const t = input.airTemperatureC;
  const { coldLimitC, warmLimitC } = input.comfort;
  if (t < coldLimitC - band) return 'cold';
  if (t <= coldLimitC + band) return 'marginal';
  if (warmLimitC !== null && t > warmLimitC) return 'too_warm';
  return 'fine';
}
