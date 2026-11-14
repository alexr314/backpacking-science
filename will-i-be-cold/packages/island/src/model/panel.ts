/**
 * The panel's calls into the physics engine, one per phase.
 *
 * Everything the UI draws (the band, every bar, every gap, every caveat, the extremity flags,
 * the sleep system's two floors) comes out of `coverage()` and `solveSleepSystem()`. Nothing
 * downstream computes a temperature, a clo value or a verdict of its own.
 *
 * Each phase runs as its own single-phase `coverage()` call rather than one five-phase call,
 * because the engine's verdict sentence is written for the set of phases it was given and the
 * tab wants the sentence for *this* phase alone.
 */

import {
  coverage,
  fahrenheitToCelsius,
  HIKING_MET_BY_GRADE,
  PHASE_METABOLIC_RATE_MET,
  REFERENCE_MATTRESS_IMPERIAL_R,
  QUILT_LABEL_CORRECTION_K,
  solveSleepSystem,
  SLEEP_VENT_HEADROOM_K,
  type BagSpec,
  type LabelRatingType,
  type PadSpec,
  type QuiltProvenance,
  type CoverageReport,
  type GearInventory,
  type PhaseCoverage,
  type PhaseName,
  type PhasePlan,
  type ShelterKind,
  type SleepGear,
  type SleepSystemInput,
  type SleepSystemResult,
} from '@will-i-be-cold/heat';
import type { PhaseWeather } from '@will-i-be-cold/weather';
import { garmentById, kitGarments, type Kit } from './kit.js';

export type Activity = 'sitting' | 'standing' | 'chores' | 'rolling' | 'steepClimb' | 'descent';

/**
 * Metabolic rates, met. The phase defaults and the hiking grades are the engine's own
 * (`PHASE_METABOLIC_RATE_MET`, `HIKING_MET_BY_GRADE`); camp chores is `SPEC.md` §2.6's 1.6.
 */
export const ACTIVITY_MET: Readonly<Record<Activity, number>> = {
  sitting: PHASE_METABOLIC_RATE_MET.camp_evening,
  standing: PHASE_METABOLIC_RATE_MET.day_break,
  chores: 1.6,
  rolling: HIKING_MET_BY_GRADE.rolling,
  steepClimb: HIKING_MET_BY_GRADE.steepClimb,
  descent: HIKING_MET_BY_GRADE.descent,
};

export const ACTIVITY_LABEL: Readonly<Record<Activity, string>> = {
  sitting: 'Sitting still',
  standing: 'Up and about',
  chores: 'Cooking, chores',
  rolling: 'Rolling trail',
  steepClimb: 'Steep climb',
  descent: 'Descending',
};

export interface ShelterOption {
  readonly value: ShelterKind;
  readonly label: string;
}

const SHELTER_LABEL: Readonly<Record<ShelterKind, string>> = {
  open: 'Open sky',
  partial_canopy: 'Partial canopy',
  forest: 'Under forest',
  tarp: 'Tarp',
  three_sided: 'Shelter',
  tent: 'In the tent',
};

const shelters = (kinds: readonly ShelterKind[], labels: Partial<Record<ShelterKind, string>> = {}): ShelterOption[] =>
  kinds.map((value) => ({ value, label: labels[value] ?? SHELTER_LABEL[value] }));

/** Every shelter the engine knows, in the camp-evening order. */
export const SHELTER_OPTIONS: readonly ShelterOption[] = shelters(['open', 'partial_canopy', 'forest', 'tarp', 'three_sided', 'tent']);

/** Which controls a phase's settings row offers, and what it calls them. */
export interface PhaseControls {
  readonly shelter: { readonly label: string; readonly options: readonly ShelterOption[] };
  /** The activities on offer; `null` for sleep, whose metabolic rate is the standard's. */
  readonly activities: readonly Activity[] | null;
  readonly campfire: boolean;
  readonly bagDraped: boolean;
  readonly wet: boolean;
  /** The sleep system's own inputs: what is worn inside, and the bag opened as a blanket. */
  readonly sleep: boolean;
}

export const PHASE_CONTROLS: Readonly<Record<PhaseName, PhaseControls>> = {
  camp_morning: {
    shelter: { label: 'Where you are', options: SHELTER_OPTIONS },
    activities: ['standing', 'chores', 'sitting'],
    campfire: true,
    bagDraped: true,
    wet: true,
    sleep: false,
  },
  hiking: {
    // the trail's exposure: the engine's shelter presets carry both the wind and the sky
    shelter: {
      label: 'Exposure',
      options: shelters(['open', 'partial_canopy', 'forest'], { open: 'Open ridge, full sun and wind', partial_canopy: 'Mixed cover', forest: 'Under forest' }),
    },
    activities: ['rolling', 'steepClimb', 'descent'],
    campfire: false,
    bagDraped: false,
    wet: true,
    sleep: false,
  },
  day_break: {
    shelter: {
      label: 'Where you stop',
      options: shelters(['open', 'partial_canopy', 'forest', 'three_sided'], { open: 'In the open', three_sided: 'A trail shelter' }),
    },
    activities: ['standing', 'sitting'],
    campfire: false,
    bagDraped: false,
    wet: true,
    sleep: false,
  },
  camp_evening: {
    shelter: { label: 'Where you sit', options: SHELTER_OPTIONS },
    activities: ['sitting', 'chores'],
    campfire: true,
    bagDraped: true,
    wet: true,
    sleep: false,
  },
  sleep: {
    shelter: { label: 'Where you sleep', options: shelters(['tent', 'tarp', 'three_sided', 'open'], { open: 'Under the open sky' }) },
    activities: null,
    campfire: false,
    bagDraped: false,
    wet: false,
    sleep: true,
  },
};

/** One phase's conditions. Fields a phase does not offer are simply not consulted. */
export interface PhaseSettings {
  readonly shelter: ShelterKind;
  readonly activity: Activity;
  /** `SPEC.md` §2.7's "it rained today" toggle. */
  readonly wet: boolean;
  /** `SPEC.md` §3: the bag-as-blanket toggle, a clothed-phase term. */
  readonly bagDraped: boolean;
  /**
   * The campfire (`docs/CAMPFIRE.md`, `CAMPFIRE` in the engine): a radiant source worth about
   * +2 K of operative temperature at 1.2 m, seated. One control with two effects: the model
   * gains the source, and the scene's fire lights or goes out.
   */
  readonly campfire: boolean;
  /** Sleep: garment ids worn inside the bag, from the inventory. */
  readonly wornInside: readonly string[];
  /** Sleep: the bag unzipped and spread over you as a blanket, so its hood and draft collar are not in play. */
  readonly asBlanket: boolean;
}

/**
 * Where each phase starts. The two camp phases start with the bag already draped: the client
 * reaches for it every time at those hours, so off was the wrong default ("that's basically
 * always needed, at least for my configurations"). Only the two phases whose `PHASE_CONTROLS`
 * offer the toggle can carry it; the engine ignores `bagDraped` elsewhere.
 */
export const DEFAULT_SETTINGS: Readonly<Record<PhaseName, PhaseSettings>> = {
  camp_morning: { shelter: 'forest', activity: 'standing', wet: false, bagDraped: true, campfire: false, wornInside: [], asBlanket: false },
  hiking: { shelter: 'open', activity: 'rolling', wet: false, bagDraped: false, campfire: false, wornInside: [], asBlanket: false },
  day_break: { shelter: 'open', activity: 'standing', wet: false, bagDraped: false, campfire: false, wornInside: [], asBlanket: false },
  camp_evening: { shelter: 'forest', activity: 'sitting', wet: false, bagDraped: true, campfire: true, wornInside: [], asBlanket: false },
  sleep: { shelter: 'tent', activity: 'sitting', wet: false, bagDraped: false, campfire: false, wornInside: [], asBlanket: false },
};

export interface PanelInputs {
  readonly kit: Kit;
  readonly settings: PhaseSettings;
  /** The bag and the pads. Read by the sleep phase, and by the clothed phases' bag-as-blanket term. Default: `SLEEP_GEAR`. */
  readonly sleepGear?: SleepGear;
  /**
   * Unit for the engine's prose (`report.verdict`, `gap.fix.text`). Follows the panel's
   * °F/°C toggle so the sentences agree with the axis. Numbers stay SI regardless.
   */
  readonly unit?: 'F' | 'C';
}

/**
 * The sleep system the panel starts on, from `packages/heat/README.md`'s worked example: a
 * US-labelled "20 °F" bag (labelled by `T_lim`, as US brands do) on an R 4.2 insulated air
 * pad. The sleep tab's controls replace it; it is state, not a constant, from there on.
 */
export const SLEEP_GEAR: SleepGear = {
  bag: { kind: 'bag', ratingC: fahrenheitToCelsius(20), ratingType: 'limit' },
  pads: [{ imperialR: 4.2, label: 'insulated air pad' }],
};

/**
 * Which temperature the label states. **Required, never guessed** (`BagSpec.ratingType`): US
 * brands label by the limit, EU brands by the comfort, and one real bag is "12 °F" and "23 °F"
 * at once depending on which. The control offers exactly these two and no "unknown".
 */
export const RATING_TYPE_OPTIONS: readonly { readonly value: LabelRatingType; readonly label: string; readonly hint: string }[] = [
  { value: 'limit', label: 'US label: limit rating', hint: 'The number US brands print: ISO 23537 T_lim, the standard man curled up, not yet shivering.' },
  { value: 'comfort', label: 'EU label: comfort rating', hint: 'The number EU brands print: ISO 23537 T_comf, the standard woman relaxed and comfortable.' },
];

/** The quilt label corrections the engine knows, with the °F each adds, read from the engine's table. */
export const QUILT_PROVENANCE_OPTIONS: readonly { readonly value: QuiltProvenance; readonly label: string }[] = (
  Object.keys(QUILT_LABEL_CORRECTION_K) as QuiltProvenance[]
).map((value) => {
  const addedF = Math.round((QUILT_LABEL_CORRECTION_K[value] * 9) / 5);
  const who = value === 'none' ? 'As printed, no correction' : value === 'cottage' ? 'Cottage maker' : 'Direct import';
  return { value, label: addedF === 0 ? who : `${who}: label read ${addedF} °F warmer` };
});

/** A pad added to the stack starts at this R until the user types the hangtag's number. */
export const NEW_PAD: PadSpec = { imperialR: 2, label: 'second pad' };

/** The sleep gear as this tab's settings make it: the bag opened as a blanket loses its hood and collar. */
export function sleepGearFor(settings: PhaseSettings, gear: SleepGear = SLEEP_GEAR): SleepGear {
  const bag: BagSpec = settings.asBlanket ? { ...gear.bag, hoodUsed: false, draftCollar: false } : gear.bag;
  return { bag, pads: gear.pads };
}

/**
 * Catalogue clo of what is worn inside the bag: a plain sum, which is how the engine's own
 * sleep fix adds a puffy (`sleepFix` in `coverage.ts`). The engine then counts only the excess
 * over ISO 23537's reference base layer.
 */
export function clothingInsideClo(ids: readonly string[]): number {
  return ids.reduce((s, id) => s + garmentById(id).clo, 0);
}

export interface PanelResult {
  readonly report: CoverageReport;
  readonly phase: PhaseCoverage;
}

export function assessPhase(phase: PhaseName, inputs: PanelInputs, weather: PhaseWeather): PanelResult {
  const s = inputs.settings;
  const controls = PHASE_CONTROLS[phase];
  const gear: GearInventory = { garments: kitGarments(inputs.kit), sleep: sleepGearFor(s, inputs.sleepGear) };

  const plan: PhasePlan = {
    phase,
    conditions: {
      relativeHumidity: weather.relativeHumidity,
      cloudCover: weather.cloudCover,
      windSpeed: weather.windSpeed.p50,
      shelter: s.shelter,
      shortwaveRadiation: weather.shortwaveRadiation,
      wet: controls.wet ? s.wet : false,
      ...(controls.campfire ? { campfire: { on: s.campfire, posture: 'seated' as const } } : {}),
    },
    ...(controls.activities !== null ? { met: ACTIVITY_MET[s.activity] } : {}),
    ...(controls.bagDraped ? { bagAsBlanket: s.bagDraped } : {}),
    ...(controls.sleep ? { clothingInsideBagClo: clothingInsideClo(s.wornInside) } : {}),
  };

  const report = coverage(gear, [plan], { [phase]: weather.temperature }, {
    band: 'p10-p90',
    maxCandidates: 5,
    units: inputs.unit ?? 'F',
  });
  const result = report.phases[0];
  if (result === undefined) throw new Error('coverage() returned no phase.');
  return { report, phase: result };
}

/** The camp-evening assessment under the default settings: what the methodology page quotes. */
export function assessCampEvening(kit: Kit, weather: PhaseWeather, unit: 'F' | 'C' = 'F'): PanelResult {
  return assessPhase('camp_evening', { kit, settings: DEFAULT_SETTINGS.camp_evening, unit }, weather);
}

/**
 * The sleep system solved twice: on the pad you carry, and on the ISO reference mattress the
 * label assumes. The second is what the label alone would promise; the difference between
 * them is the pad delta (`packages/heat/MODEL.md` §6, `SPEC.md` §10.3).
 */
export interface SleepSystemView {
  readonly input: SleepSystemInput;
  /** On your pad. */
  readonly yours: SleepSystemResult;
  /** On the reference mattress, R 4.83, that is inside the rating. */
  readonly onLabelMat: SleepSystemResult;
  readonly referencePadImperialR: number;
  /** The engine's headroom above the vented comfort temperature before "too warm". */
  readonly ventHeadroomK: number;
}

export function sleepSystemView(settings: PhaseSettings, sleepGear: SleepGear = SLEEP_GEAR): SleepSystemView {
  const gear = sleepGearFor(settings, sleepGear);
  const clo = clothingInsideClo(settings.wornInside);
  const input: SleepSystemInput = { bag: gear.bag, pads: gear.pads, ...(clo > 0 ? { clothingInsideClo: clo } : {}) };
  return {
    input,
    yours: solveSleepSystem(input),
    onLabelMat: solveSleepSystem({ ...input, pads: [{ imperialR: REFERENCE_MATTRESS_IMPERIAL_R, label: 'ISO reference mattress' }] }),
    referencePadImperialR: REFERENCE_MATTRESS_IMPERIAL_R,
    ventHeadroomK: SLEEP_VENT_HEADROOM_K,
  };
}
