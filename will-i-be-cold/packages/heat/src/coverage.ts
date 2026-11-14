/**
 * `coverage()`: the public export. Pure, no I/O, no randomness, deterministic.
 *
 * For each phase of the day it builds a **layering ladder** from the gear you actually own
 * ({@link layeringLadder}), computes each rung's comfort interval, and reports how much of the
 * expected temperature band those intervals cover.
 *
 * **Gaps are the product.** They are first-class in the return type: `CoverageReport.gaps`
 * is a flat list with a one-line fix attached to each, not something the caller derives.
 *
 * ## Why "Goldilocks" gaps went away
 *
 * The panel used to report things like *"25–26 °F falls between two of your configurations"*.
 * That was an artefact of treating a garment as binary: worn or not. A real garment is
 * **continuously adjustable**: worn open, zipped or unzipped, sleeves pushed up, pit zips, hood
 * up or down. So a configuration does not have a rectangular comfort interval; it has an
 * **envelope**, from fully closed at the cold end to fully vented at the warm end, and coverage
 * here is computed against the union of those envelopes. The cold limit is unchanged (fully
 * closed is as warm as it gets), and only the warm limit moves (`garments.ts`
 * `ADJUSTABILITY_DEFAULTS`, `types.ts` `ComfortInterval`).
 *
 * Interior gaps that close under venting therefore vanish **because the physics closed them**,
 * not because they were suppressed. An interior gap that *survives* is real (a base layer and
 * an expedition parka and nothing between is not bridged by a zip), and is reported with its
 * own severity, {@link GapSeverity}`'nothing_between'`, in its own words.
 */

import { celsiusToFahrenheit, type Celsius } from './units.js';
import {
  ThermalModelError,
  type ModelWarning,
  type PhaseName,
  type ThermalAssessment,
  type Verdict,
} from './types.js';
import { PHASE_NAMES } from './types.js';
import { GARMENTS, GARMENT_UNVERIFIED_CONSTANTS, garment, type Garment } from './garments.js';
import {
  PHASE_METABOLIC_RATE_MET,
  TOO_WARM_HEADROOM_CLO,
  assess,
  clothedColdLimit,
  metToWm2,
  type ClothedConfiguration,
  type PhaseConditions,
  type SleepConfiguration,
} from './assess.js';
import {
  bagAsBlanketClo,
  solveSleepSystem,
  type BagSpec,
  type PadSpec,
  type SleepSystemInput,
} from './sleep.js';
import { IREQ_UNVERIFIED_CONSTANTS } from './ireq.js';
import { SLEEP_UNVERIFIED_CONSTANTS } from './sleep.js';
import { ENVIRONMENT_UNVERIFIED_CONSTANTS } from './environment.js';
import { EXTREMITY_UNVERIFIED_CONSTANTS, assessExtremities, type ExtremityResult } from './extremities.js';
import type { UnverifiedConstant } from './types.js';

/** Every `estimated`/unverified constant the engine ships, in one place for the caveats panel. */
export const UNVERIFIED_CONSTANTS: readonly UnverifiedConstant[] = [
  ...IREQ_UNVERIFIED_CONSTANTS,
  ...SLEEP_UNVERIFIED_CONSTANTS,
  ...ENVIRONMENT_UNVERIFIED_CONSTANTS,
  ...EXTREMITY_UNVERIFIED_CONSTANTS,
  ...GARMENT_UNVERIFIED_CONSTANTS,
];

// ---------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------

export interface SleepGear {
  readonly bag: BagSpec;
  readonly pads: readonly PadSpec[];
}

export interface GearInventory {
  /** Garment ids from the v1 ontology, or whole `Garment` objects for custom items. */
  readonly garments: readonly (string | Garment)[];
  readonly sleep?: SleepGear;
}

/** The temperature band for one phase. Structurally compatible with the weather package's `Distribution`. */
export interface TemperatureBand {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly min?: number;
  readonly max?: number;
}

export interface PhasePlan {
  readonly phase: PhaseName;
  /** Everything but the temperature, which comes from `tempDistributions`. */
  readonly conditions: Omit<PhaseConditions, 'airTemperature'>;
  /** Override `SPEC.md` §2.6's default metabolic rate for this phase, met. */
  readonly met?: number;
  /** `SPEC.md` §5: a quilt draped over the shoulders in camp counts, and people really do it. */
  readonly bagAsBlanket?: boolean;
  /** For the sleep phase: catalogue clo of what is worn inside the bag. */
  readonly clothingInsideBagClo?: number;
}

export interface CoverageOptions {
  /**
   * Which part of the distribution must be covered. `'p10-p90'` (default) is the honest
   * planning band; `'min-max'` is the paranoid one.
   */
  readonly band?: 'p10-p90' | 'min-max';
  /** Cap on candidate ensembles per phase. Default 8. */
  readonly maxCandidates?: number;
  /**
   * Unit for the human-readable `fix.text` and `verdict` strings. Default `'F'` (SPEC §9).
   * Every numeric field in the report stays SI regardless.
   */
  readonly units?: TemperatureUnit;
}

// ---------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------

export interface CandidateEnsemble {
  readonly id: string;
  /** Full name, e.g. `Grid fleece hoodie (R1-style) + shell + rain pants`. */
  readonly label: string;
  /**
   * The same ensemble named by how it *differs* from the lightest candidate in this phase:
   * `base only`, `+ beanie`, `+ rain shell jacket + rain shell pants`. Candidates in a phase
   * share most of their garments, so the full labels all start with the same words and are
   * near-unreadable stacked in a chart; this is what a UI should put on a bar.
   */
  readonly shortLabel: string;
  readonly garments: readonly Garment[];
  /** Catalogue clo with everything closed up. */
  readonly clo: number;
  readonly assessment: ThermalAssessment;
  /**
   * The slice of the phase band this candidate covers, °C: the **vented-to-closed envelope**
   * intersected with the band, so it already includes the temperatures you reach by opening
   * zips rather than changing clothes. Empty if it covers none of it.
   */
  readonly coveredC: readonly Span[];
  /**
   * Clo this rung can shed without taking anything off (unzipped, sleeves up, pit zips, hood
   * down, drape loosened). 0 for the sleep candidate. ⚠️ Rests on `estimated` adjustabilities.
   */
  readonly ventableClo: number;
  /** Catalogue clo with everything opened as far as it goes: `clo − ventableClo`. */
  readonly ventedClo: number;
  /**
   * `[ventedClo, clo]`: this rung's insulation range, fully open to fully closed, ready for a
   * hover label next to the clo figure.
   *
   * It lives here rather than in the caveats on purpose. The venting caveat states the
   * *mechanism* once per phase and quotes no number, because a caveats panel that printed the
   * same paragraph once per candidate with a different clo figure in each read as a bug and
   * buried the caveats that say different things. The number is per-candidate information and
   * belongs on the candidate.
   */
  readonly ventingCloRange: readonly [number, number];
  /**
   * The slice of the band this rung covers that **no lighter rung covers**: why it is on the
   * ladder at all. Rungs with nothing here are dropped before the report is built (the client's
   * Pareto idea), so this is non-empty for every candidate returned *unless* no rung covers any
   * of the band, in which case the whole ladder is returned and every entry is empty.
   */
  readonly uniquelyCoversC: readonly Span[];
}

export interface Span {
  readonly fromC: Celsius;
  readonly toC: Celsius;
}

export type FixKind = 'wear' | 'add-garment' | 'add-pad' | 'wear-in-bag' | 'shed' | 'none';

export interface Fix {
  readonly kind: FixKind;
  /**
   * The line the UI prints next to the red gap. One or two short sentences, in plain words:
   * what to do, and how far it gets you. No model vocabulary, and no clo figure unless the
   * figure is part of the decision.
   */
  readonly text: string;
  /**
   * The same advice compressed to one clause, for the headline sentence, which has already
   * said what the problem is and only needs the action. Falls back to {@link Fix.text}.
   */
  readonly short?: string;
  /** Ontology id of the item to wear or buy, when there is one. */
  readonly itemId?: string;
  /** Extra catalogue clo this fix supplies. */
  readonly deltaClo?: number;
  /** Extra pad R this fix supplies (sleep gaps). */
  readonly deltaImperialR?: number;
  /** Where the fix moves the cold limit to, °C. */
  readonly coversToC?: Celsius;
  /** True if the item is already in the inventory: a free fix. */
  readonly alreadyOwned?: boolean;
}

/**
 * What kind of hole in the coverage this is.
 *
 * - `'cold'`: **unchanged in meaning**: below the coldest configuration you own. Nothing you
 *   can put on reaches down here; you will freeze.
 * - `'too_warm'`: **unchanged in meaning**: above the warmest end of the lightest
 *   configuration you own, *even with it fully vented*. You would be sweating.
 * - `'nothing_between'`: an **interior** gap: your kit brackets this range but nothing you own
 *   sits *in* it, and venting does not bridge it. A base layer and an expedition parka and
 *   nothing between is the archetype. This is a hole in the ladder, not a cold risk, and it is
 *   deliberately worded differently.
 *
 * Interior gaps that *do* close once venting is modelled never appear, not because they are
 * suppressed, but because the physics closed them. See the module docstring.
 */
export type GapSeverity = Extract<Verdict, 'cold' | 'too_warm'> | 'nothing_between';

export interface CoverageGap {
  readonly phase: PhaseName;
  readonly fromC: Celsius;
  readonly toC: Celsius;
  /** See {@link GapSeverity}. `'cold'` and `'too_warm'` mean exactly what they did before. */
  readonly severity: GapSeverity;
  readonly fix: Fix;
}

export interface PhaseCoverage {
  readonly phase: PhaseName;
  readonly band: Span;
  readonly model: ThermalAssessment['model'];
  readonly candidates: readonly CandidateEnsemble[];
  /** The candidate whose interval best fits the band's cold end. */
  readonly best: CandidateEnsemble | null;
  /**
   * The union of every candidate's vented-to-closed envelope, °C: the full span this kit can
   * be comfortable across in this phase, *before* intersecting with the band. `null` when no
   * candidate could be assessed.
   */
  readonly envelope?: Span | null;
  readonly covered: readonly Span[];
  readonly gaps: readonly CoverageGap[];
  /** Fraction of the band covered by some configuration you own, 0..1. */
  readonly coveredFraction: number;
  readonly extremities: readonly ExtremityResult[];
  readonly warnings: readonly ModelWarning[];
  readonly caveats: readonly string[];
}

export interface CoverageReport {
  readonly phases: readonly PhaseCoverage[];
  /** Every gap across every phase, flattened. This is the product. */
  readonly gaps: readonly CoverageGap[];
  /** One sentence for the top of the page. */
  readonly verdict: string;
  readonly warnings: readonly ModelWarning[];
  readonly caveats: readonly string[];
  readonly unverifiedConstants: readonly UnverifiedConstant[];
}

// ---------------------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------------------

const resolveGarment = (x: string | Garment): Garment => (typeof x === 'string' ? garment(x) : x);

const warmest = (xs: readonly Garment[]): Garment | undefined =>
  xs.length === 0 ? undefined : xs.reduce((a, b) => (b.clo > a.clo ? b : a));
const lightest = (xs: readonly Garment[]): Garment | undefined =>
  xs.length === 0 ? undefined : xs.reduce((a, b) => (b.clo < a.clo ? b : a));

interface Wardrobe {
  readonly all: readonly Garment[];
  readonly torsoInner: readonly Garment[];
  readonly torsoMid: readonly Garment[];
  readonly torsoPuffy: readonly Garment[];
  readonly torsoShell: readonly Garment[];
  readonly legsInner: readonly Garment[];
  readonly legsOuter: readonly Garment[];
  readonly legsShell: readonly Garment[];
  readonly head: readonly Garment[];
  /** One slot, like the head: there is no hands inner any more. See {@link handsStack}. */
  readonly hands: readonly Garment[];
  readonly feetInner: readonly Garment[];
  readonly feetOuter: readonly Garment[];
}

function wardrobe(inventory: GearInventory): Wardrobe {
  const all = inventory.garments.map(resolveGarment);
  const pick = (f: (x: Garment) => boolean): Garment[] => all.filter(f);
  return {
    all,
    torsoInner: pick((x) => x.region === 'torso' && x.slot === 'inner'),
    torsoMid: pick(
      (x) => x.region === 'torso' && x.slot === 'outer' && x.isShell !== true && x.isPuffy !== true,
    ),
    torsoPuffy: pick((x) => x.region === 'torso' && x.isPuffy === true),
    torsoShell: pick((x) => x.region === 'torso' && x.isShell === true),
    legsInner: pick((x) => x.region === 'legs' && x.slot === 'inner'),
    legsOuter: pick((x) => x.region === 'legs' && x.slot === 'outer' && x.isShell !== true),
    legsShell: pick((x) => x.region === 'legs' && x.isShell === true),
    head: pick((x) => x.region === 'head'),
    hands: pick((x) => x.region === 'hands'),
    feetInner: pick((x) => x.region === 'feet' && x.slot === 'inner'),
    feetOuter: pick((x) => x.region === 'feet' && x.slot === 'outer'),
  };
}

const compact = (xs: readonly (Garment | undefined)[]): Garment[] =>
  xs.filter((x): x is Garment => x !== undefined);

/**
 * Hands, with one slot.
 *
 * Hands used to have an inner slot and an outer slot, so a liner pair and a warm pair were
 * two different kinds of thing. They are not: they are both gloves, and the single thing the
 * inner slot bought us was letting a liner sit under mitts. The ladder can show that itself,
 * so hands now work like the head: one slot, and the ladder decides what goes on it.
 *
 * Gloves still **stack**, which is where hands differ from the head. You wear one hat; you do
 * wear liners under mitts, and that combination is warmer than either pair alone. So the ladder
 * considers up to two pairs: the warmest pair you own, plus the next warmest worn under it, in
 * that layering order. A shell pair (rain mitts) goes outside whatever it is paired with,
 * whatever its clo, because that is the only way it is ever worn.
 *
 * Returned skin-outwards, so the rungs add the thin pair first and the warm pair after it.
 */
export function handsStack(hands: readonly Garment[]): Garment[] {
  const ranked = [...hands].sort((a, b) => b.clo - a.clo || a.id.localeCompare(b.id));
  const top = ranked[0];
  if (top === undefined) return [];
  const under = ranked[1];
  if (under === undefined) return [top];
  return under.isShell === true ? [top, under] : [under, top];
}

interface Rung {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Garment[];
}

/**
 * **The layering ladder: a nested chain, built the way people actually dress.**
 *
 * The old generator enumerated combinations, which produced outfits nobody would wear (a shell
 * over a bare base layer but no fleece, a lighter base layer than the one in the next rung) and
 * labels that read oddly. This builds a **monotonic chain** instead: rung 0 is the minimum
 * sensible outfit, and **each rung is the previous rung plus exactly one garment**, added in
 * layering order from the skin outwards: base, mid, insulation, then the shell outermost.
 *
 * `SPEC.md` §4's allowed-combination rules still hold, and nesting makes most of them automatic:
 * one inner per region (the chain commits to one and never swaps it), outers stack, a shell goes
 * outermost (it is the last torso addition), at most two puffies, rain pants over anything.
 *
 * **Which base layer the chain commits to.** The warmest inner you own, not the lightest. A
 * nested chain cannot swap base layers (swapping is not adding), so it has to choose, and the
 * warm one is the one you would actually wear when it matters. The warm end of the band is
 * covered by *venting* instead, which is both how layering really works and the reason the
 * adjustability model had to land first.
 *
 * Rungs that earn nothing are dropped afterwards, in {@link coverage}, against the band.
 */
function layeringLadder(w: Wardrobe): Rung[] {
  const torsoInner = warmest(w.torsoInner);
  // The pants you are wearing. Legs are not optional, so they are in the minimum outfit; a
  // long-underwear bottom is an *addition* under them, which is what makes it a rung.
  const legsBase = warmest(w.legsOuter) ?? warmest(w.legsInner);
  const legsInner = warmest(w.legsInner);
  const socks = warmest(w.feetInner);
  const shoes = warmest(w.feetOuter);
  const mid = warmest(w.torsoMid);
  const puffy = warmest(w.torsoPuffy);
  const secondPuffy = w.torsoPuffy
    .filter((x) => x !== puffy)
    .reduce<Garment | undefined>((a, b) => (a === undefined || b.clo > a.clo ? b : a), undefined);
  const head = warmest(w.head);
  const hands = handsStack(w.hands);
  const shell = warmest(w.torsoShell);
  const legsShell = warmest(w.legsShell);

  const start = compact([torsoInner, legsBase, socks, shoes]);

  // Skin outwards. Head and hands are not on that axis; they sit after the body insulation and
  // before the shells, which is the order people reach in: hat, then mid, then puffy, then
  // gloves, then the shell over everything.
  const additions = compact([
    legsInner,
    head,
    mid,
    puffy,
    secondPuffy,
    ...hands,
    shell,
    legsShell,
  ]);

  const worn = new Map(start.map((x) => [x.id, x]));
  const rungs: Rung[] = [];
  const push = (id: string): void => {
    const items = [...worn.values()];
    if (items.length === 0) return;
    // The label is derived from what the ensemble actually contains, never from the rung of the
    // ladder it came from: a "+ fleece" rung collapses to the base ensemble for someone who
    // owns no fleece, and a label that still said "+ fleece" would be a lie.
    rungs.push({ id, label: describeEnsemble(items), items });
  };

  push('rung_0');
  for (const add of additions) {
    if (worn.has(add.id)) continue;
    worn.set(add.id, add);
    push(`rung_${rungs.length}`);
  }
  return rungs;
}

/**
 * `maxCandidates` is a display cap, not physics. When more rungs survive the Pareto filter than
 * the caller wants bars for, drop the ones that earn the least: the narrowest unique slice,
 * never the lightest or the one that reaches furthest down, which are the ends of the envelope
 * and the references the fixes are computed against.
 */
function thinLadder(rungs: readonly CandidateEnsemble[], limit: number): CandidateEnsemble[] {
  const out = [...rungs];
  while (out.length > limit) {
    const lightestClo = Math.min(...out.map((c) => c.clo));
    const coldestLimit = Math.min(...out.map((c) => c.assessment.comfort.coldLimitC));
    let worst = -1;
    let worstWidth = Number.POSITIVE_INFINITY;
    for (let i = 0; i < out.length; i += 1) {
      const c = out[i] as CandidateEnsemble;
      if (c.clo === lightestClo || c.assessment.comfort.coldLimitC === coldestLimit) continue;
      const width = totalWidth(c.uniquelyCoversC);
      if (width < worstWidth) {
        worstWidth = width;
        worst = i;
      }
    }
    if (worst < 0) break;
    out.splice(worst, 1);
  }
  return out;
}

/**
 * Names each candidate by its delta from the lightest one. Everything the candidates have in
 * common is dropped, so what is left is exactly the decision the user is making.
 */
function shortLabels(items: readonly (readonly Garment[])[]): string[] {
  if (items.length === 0) return [];
  const ids = items.map((g) => new Set(g.map((x) => x.id)));
  const common = [...(ids[0] as Set<string>)].filter((id) => ids.every((set) => set.has(id)));
  const commonSet = new Set(common);
  return items.map((garments) => {
    const delta = garments.filter((x) => !commonSet.has(x.id));
    if (delta.length === 0) return 'base only';
    // Warmest first: the reason you would reach for this combination leads the label.
    const names = [...delta]
      .sort((a, b) => b.clo - a.clo)
      .map((x) => x.label.toLowerCase());
    return `+ ${names.join(' + ')}`;
  });
}

/** A short, honest name for an ensemble, built from its contents. */
function describeEnsemble(items: readonly Garment[]): string {
  const has = (f: (x: Garment) => boolean): boolean => items.some(f);
  const inner = items.find((x) => x.region === 'torso' && x.slot === 'inner');
  const parts = [inner?.label ?? 'Base layers'];
  if (has((x) => x.region === 'torso' && x.slot === 'outer' && x.isShell !== true && x.isPuffy !== true))
    parts.push('fleece');
  if (has((x) => x.isPuffy === true)) parts.push('puffy');
  if (has((x) => x.region === 'torso' && x.isShell === true)) parts.push('shell');
  if (has((x) => x.region === 'legs' && x.isShell === true)) parts.push('rain pants');
  if (has((x) => x.region === 'head')) parts.push('hat');
  if (has((x) => x.region === 'hands')) parts.push('gloves');
  return parts.join(' + ');
}

// ---------------------------------------------------------------------------------------
// Span arithmetic
// ---------------------------------------------------------------------------------------

function intersect(a: Span, b: Span): Span | null {
  const fromC = Math.max(a.fromC, b.fromC);
  const toC = Math.min(a.toC, b.toC);
  return toC > fromC ? { fromC, toC } : null;
}

function union(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((x, y) => x.fromC - y.fromC);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && s.fromC <= last.toC + 1e-9) {
      out[out.length - 1] = { fromC: last.fromC, toC: Math.max(last.toC, s.toC) };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Every part of `spans` that no span in `remove` covers. */
function difference(spans: readonly Span[], remove: readonly Span[]): Span[] {
  return union(spans).flatMap((s) => subtract(s, remove));
}

const totalWidth = (spans: readonly Span[]): number =>
  spans.reduce((s, x) => s + (x.toC - x.fromC), 0);

function subtract(band: Span, covered: readonly Span[]): Span[] {
  const gaps: Span[] = [];
  let cursor = band.fromC;
  for (const c of union(covered)) {
    if (c.toC <= band.fromC || c.fromC >= band.toC) continue;
    if (c.fromC > cursor + 1e-6) gaps.push({ fromC: cursor, toC: Math.min(c.fromC, band.toC) });
    cursor = Math.max(cursor, c.toC);
    if (cursor >= band.toC) break;
  }
  if (cursor < band.toC - 1e-6) gaps.push({ fromC: cursor, toC: band.toC });
  return gaps;
}

// ---------------------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------------------

/**
 * A garment's name as prose: lower case, and with the catalogue's trailing qualifier moved into
 * parentheses, because the labels are written for a picker rather than for a sentence.
 * `Down puffy, ~4.5 oz fill` reads badly mid-sentence and `down puffy (~4.5 oz fill)` does not.
 * A qualifier that already ends in its own parenthesis is trimmed rather than nested.
 */
function itemName(item: Garment, qualifier?: string): string {
  const label = item.label.toLowerCase();
  const qualifiers: string[] = [];
  // Pull a trailing parenthesis off first, so nothing ever ends up nested or doubled.
  const paren = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
  let head = paren === null ? label : (paren[1] ?? label);
  const comma = head.indexOf(', ');
  if (comma >= 0) {
    qualifiers.push(head.slice(comma + 2));
    head = head.slice(0, comma);
  }
  if (paren !== null && (paren[2] ?? '').length > 0) qualifiers.push(paren[2] as string);
  if (qualifier !== undefined && qualifier.length > 0) qualifiers.push(qualifier);
  return qualifiers.length === 0 ? head : `${head} (${qualifiers.join(', ')})`;
}

/**
 * Temperature unit for the human-readable strings in {@link Fix} and the one-sentence verdict.
 * °F is the product default (SPEC §9); SI is used everywhere else in this library.
 */
export type TemperatureUnit = 'F' | 'C';

/**
 * Formats temperatures for prose. A *range* is rendered with a single unit suffix
 * (`18–40 °F`), never by concatenating two fully-qualified points: doing the latter
 * produced strings like `-8 °C (18 °F)–4 °C (40 °F)`.
 */
export interface TempFormat {
  /** A single temperature, e.g. `18 °F`. */
  point(c: Celsius): string;
  /** A closed range, e.g. `18–40 °F`, with one unit suffix and a true minus-free en dash. */
  range(fromC: Celsius, toC: Celsius): string;
}

export function temperatureFormatter(unit: TemperatureUnit = 'F'): TempFormat {
  const to = (c: Celsius): number => (unit === 'F' ? celsiusToFahrenheit(c) : c);
  const n = (c: Celsius): string => {
    const v = Math.round(to(c));
    // Avoid "-0", and use a real minus sign so "−8–−4 °F" stays readable.
    return v === 0 ? '0' : v < 0 ? `\u2212${Math.abs(v)}` : String(v);
  };
  const suffix = unit === 'F' ? '°F' : '°C';
  return {
    point: (c) => `${n(c)} ${suffix}`,
    // "to" rather than an en dash only when a *displayed* value is negative, so the dash is
    // never mistaken for a minus sign. Decided on the converted number, not the Celsius input:
    // -8..4 °C is 18-39 °F, which wants the dash.
    range: (a, b) => {
      const negative = Math.round(to(a)) < 0 || Math.round(to(b)) < 0;
      return negative ? `${n(a)} to ${n(b)} ${suffix}` : `${n(a)}\u2013${n(b)} ${suffix}`;
    },
  };
}

/** Extra catalogue clo needed on top of `config` for its cold limit to reach `targetC`. */
function extraCloNeeded(
  config: ClothedConfiguration,
  conditions: PhaseConditions,
  targetC: Celsius,
): number | null {
  const limitWith = (extra: number): number =>
    clothedColdLimit({ ...config, extraClo: (config.extraClo ?? 0) + extra }, conditions);
  try {
    if (limitWith(0) <= targetC) return 0;
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 20 && limitWith(hi) > targetC; i++) hi *= 1.7;
    if (limitWith(hi) > targetC) return null;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (limitWith(mid) <= targetC) hi = mid;
      else lo = mid;
    }
    return hi;
  } catch {
    return null;
  }
}

function clothedFix(
  fmt: TempFormat,
  config: ClothedConfiguration,
  conditions: PhaseConditions,
  worn: readonly Garment[],
  owned: readonly Garment[],
  gap: Span,
): Fix {
  const need = extraCloNeeded(config, conditions, gap.fromC);
  if (need === null) {
    return {
      kind: 'none',
      text: `Nothing you could put on reaches ${fmt.point(gap.fromC)} at this activity level.`,
      short: `Nothing you could put on reaches ${fmt.point(gap.fromC)}.`,
    };
  }
  const wornIds = new Set(worn.map((x) => x.id));
  const unusedOwned = owned.filter((x) => !wornIds.has(x.id) && x.clo >= need);
  const fromOwned = lightest(unusedOwned);
  if (fromOwned !== undefined) {
    return {
      kind: 'wear',
      text: `Put on the ${itemName(fromOwned)} you already have. That covers you down to ${fmt.point(gap.fromC)}.`,
      short: `Put on the ${itemName(fromOwned)} you already have.`,
      itemId: fromOwned.id,
      deltaClo: fromOwned.clo,
      coversToC: gap.fromC,
      alreadyOwned: true,
    };
  }
  const insulating = GARMENTS.filter(
    (x) => x.region === 'torso' && x.slot === 'outer' && x.isShell !== true && !wornIds.has(x.id),
  );
  const buy = lightest(insulating.filter((x) => x.clo >= need));
  if (buy !== undefined) {
    return {
      kind: 'add-garment',
      // The clo figure stays: it is what you would shop on if you wanted a different jacket.
      text: `A ${itemName(buy, `+${buy.clo.toFixed(1)} clo`)} would cover it, down to ${fmt.point(gap.fromC)}.`,
      short: `A ${itemName(buy)} would cover it.`,
      itemId: buy.id,
      deltaClo: buy.clo,
      coversToC: gap.fromC,
      alreadyOwned: false,
    };
  }
  // No single garment closes it. Name the warmest thing that exists, say how far it gets, and
  // be honest about the shortfall rather than returning a shrug.
  const best = warmest(insulating);
  if (best !== undefined) {
    const reached = (() => {
      try {
        return clothedColdLimit(
          { ...config, extraClo: (config.extraClo ?? 0) + best.clo },
          conditions,
        );
      } catch {
        return null;
      }
    })();
    const stops =
      reached === null
        ? 'does not get you all the way'
        : `still stops at ${fmt.point(reached)}`;
    const lead = `A ${itemName(best)} is the warmest single layer there is, and it ${stops}.`;
    return {
      kind: 'add-garment',
      text:
        `${lead} Reaching ${fmt.point(gap.fromC)} needs +${need.toFixed(1)} clo, more than any ` +
        'one layer carries.',
      short: lead,
      itemId: best.id,
      deltaClo: best.clo,
      ...(reached !== null ? { coversToC: reached } : {}),
      alreadyOwned: false,
    };
  }
  return {
    kind: 'none',
    text: `Reaching ${fmt.point(gap.fromC)} needs about +${need.toFixed(1)} clo, and there is nothing left to add.`,
    short: `Nothing left to add reaches ${fmt.point(gap.fromC)}.`,
    deltaClo: need,
  };
}

/**
 * An **interior** gap: your kit brackets this range and nothing you own sits in it. Distinct
 * language from a cold gap on purpose ("nothing you own sits in this range", not "you will
 * freeze"), because the failure is a hole in the ladder, and the user is standing between two
 * rungs with one too cold and the other too hot *even wide open*.
 */
function nothingBetweenFix(
  fmt: TempFormat,
  gap: Span,
  conditions: PhaseConditions,
  /** The lighter rung: comfortable only *above* the gap, i.e. too cold inside it. */
  lighter: { label: string; config: ClothedConfiguration; garments: readonly Garment[] } | null,
  /** The warmer rung: comfortable only *below* the gap, i.e. too warm inside it even vented. */
  warmer: { label: string } | null,
  owned: readonly Garment[],
): Fix {
  const between =
    lighter === null || warmer === null
      ? ''
      : ` Your ${lighter.label.toLowerCase()} is too cold there even closed up, and your ` +
        `${warmer.label.toLowerCase()} too warm even wide open.`;
  const lead = `Nothing you own fits ${fmt.range(gap.fromC, gap.toC)}.${between}`;

  const need = lighter === null ? null : extraCloNeeded(lighter.config, conditions, gap.fromC);
  if (need === null || lighter === null) {
    return {
      kind: 'none',
      text: `${lead} Nothing we know of bridges it.`,
      short: 'Nothing we know of bridges it.',
    };
  }
  // A bridging layer has to land *in* the gap, not jump over it: too much insulation and you
  // are back at the rung that was already too warm here, which is the gap, not the fix. The
  // ceiling is where the lighter rung reaches the top of the gap plus the too-warm headroom.
  const needAtTop = extraCloNeeded(lighter.config, conditions, gap.toC) ?? 0;
  const ceiling = needAtTop + TOO_WARM_HEADROOM_CLO;
  const bridges = (x: Garment): boolean => x.clo >= need && x.clo <= ceiling;

  const wornIds = new Set(lighter.garments.map((x) => x.id));
  const fromOwned = lightest(owned.filter((x) => !wornIds.has(x.id) && bridges(x)));
  if (fromOwned !== undefined) {
    return {
      kind: 'wear',
      text: `${lead} The ${itemName(fromOwned)} you left off bridges it.`,
      short: `The ${itemName(fromOwned)} you left off bridges it.`,
      itemId: fromOwned.id,
      deltaClo: fromOwned.clo,
      coversToC: gap.fromC,
      alreadyOwned: true,
    };
  }
  const candidates = GARMENTS.filter(
    (x) => x.region === 'torso' && x.slot === 'outer' && x.isShell !== true && !wornIds.has(x.id),
  );
  const buy = lightest(candidates.filter(bridges));
  if (buy !== undefined) {
    return {
      kind: 'add-garment',
      text: `${lead} A ${itemName(buy, `+${buy.clo.toFixed(1)} clo`)} bridges it.`,
      short: `A ${itemName(buy)} bridges it.`,
      itemId: buy.id,
      deltaClo: buy.clo,
      coversToC: gap.fromC,
      alreadyOwned: false,
    };
  }
  return {
    kind: 'none',
    text: `${lead} Bridging it takes a mid layer of about +${need.toFixed(1)} clo, and you own none.`,
    short: `A mid layer of about +${need.toFixed(1)} clo would bridge it.`,
    deltaClo: need,
  };
}

function tooWarmFix(fmt: TempFormat, gap: Span, worn: readonly Garment[]): Fix {
  const sheddable = worn.filter((x) => x.isShell !== true && x.slot === 'outer');
  const shed = warmest(sheddable);
  return shed === undefined
    ? {
        kind: 'shed',
        text: `Above ${fmt.point(gap.fromC)} you will be sweating in the lightest thing you own.`,
        short: `You will be sweating above ${fmt.point(gap.fromC)} whatever you do.`,
      }
    : {
        kind: 'shed',
        text: `Take the ${itemName(shed)} off above ${fmt.point(gap.fromC)}, before you sweat into it.`,
        short: `Take the ${itemName(shed)} off above ${fmt.point(gap.fromC)}.`,
        itemId: shed.id,
        deltaClo: -shed.clo,
      };
}

function sleepFix(
  fmt: TempFormat,
  system: SleepSystemInput,
  conditions: PhaseConditions,
  gap: Span,
  owned: readonly Garment[],
): Fix {
  const comfortWith = (input: SleepSystemInput): number =>
    assess({ kind: 'sleep', system: input }, { ...conditions, airTemperature: gap.fromC }).comfort
      .coldLimitC;

  // 1. Free fix: wear what you already own inside the bag.
  const puffy = warmest(owned.filter((x) => x.isPuffy === true));
  if (puffy !== undefined) {
    const withPuffy: SleepSystemInput = {
      ...system,
      clothingInsideClo: (system.clothingInsideClo ?? 0) + puffy.clo,
    };
    if (comfortWith(withPuffy) <= gap.fromC) {
      return {
        kind: 'wear-in-bag',
        text: `Wear the ${itemName(puffy)} in the bag. That covers you down to ${fmt.point(gap.fromC)}.`,
        short: `Wear the ${itemName(puffy)} in the bag.`,
        itemId: puffy.id,
        deltaClo: puffy.clo,
        coversToC: gap.fromC,
        alreadyOwned: true,
      };
    }
  }

  // 2. A warmer pad. Most users are below the ISO reference mattress, so this is usually the
  //    biggest single lever and the one the label hid from them.
  const currentR = system.pads.reduce((s, p) => s + p.imperialR, 0);
  let lo = 0;
  let hi = 12;
  const withExtraR = (extra: number): number =>
    comfortWith({ ...system, pads: [...system.pads, { imperialR: extra, label: 'extra' }] });
  if (withExtraR(hi) <= gap.fromC) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (withExtraR(mid) <= gap.fromC) hi = mid;
      else lo = mid;
    }
    return {
      kind: 'add-pad',
      // The R numbers are the decision here: a pad is what you would buy, and the rating on the
      // bag assumed a warmer one than most people carry.
      text:
        `Put another R ${hi.toFixed(1)} of pad under you and you are covered down to ` +
        `${fmt.point(gap.fromC)}. You carry R ${currentR.toFixed(1)}; the rating on the bag ` +
        'assumes R 4.8.',
      short: `Put another R ${hi.toFixed(1)} of pad under you.`,
      deltaImperialR: hi,
      coversToC: gap.fromC,
      alreadyOwned: false,
    };
  }

  return {
    kind: 'none',
    text: `Only a warmer bag covers ${fmt.range(gap.fromC, gap.toC)}. No pad gets you there.`,
    short: 'Only a warmer bag covers it.',
  };
}

// ---------------------------------------------------------------------------------------
// coverage()
// ---------------------------------------------------------------------------------------

/**
 * Compute per-phase coverage of the expected temperature band by the gear you own.
 *
 * @param gear      what the user owns
 * @param phases    the phases to assess, with their non-temperature conditions
 * @param tempDistributions  the temperature band per phase (the weather package's
 *                           `Distribution` satisfies `TemperatureBand` structurally)
 */
export function coverage(
  gear: GearInventory,
  phases: readonly PhasePlan[],
  tempDistributions: Readonly<Partial<Record<PhaseName, TemperatureBand>>>,
  options: CoverageOptions = {},
): CoverageReport {
  const w = wardrobe(gear);
  const maxCandidates = options.maxCandidates ?? 8;
  const useMinMax = options.band === 'min-max';
  const fmt = temperatureFormatter(options.units ?? 'F');

  const phaseResults: PhaseCoverage[] = [];
  const allGaps: CoverageGap[] = [];
  const allWarnings: ModelWarning[] = [];
  const allCaveats = new Set<string>();

  for (const plan of phases) {
    const dist = tempDistributions[plan.phase];
    if (dist === undefined) {
      throw new ThermalModelError(
        'coverage_missing_distribution',
        `No temperature distribution supplied for phase "${plan.phase}".`,
      );
    }
    const band: Span = useMinMax
      ? { fromC: dist.min ?? dist.p10, toC: dist.max ?? dist.p90 }
      : { fromC: dist.p10, toC: dist.p90 };
    if (!(band.toC > band.fromC)) {
      throw new ThermalModelError(
        'coverage_degenerate_band',
        `Phase "${plan.phase}" has a degenerate temperature band [${band.fromC}, ${band.toC}].`,
      );
    }

    const conditions: PhaseConditions = { ...plan.conditions, airTemperature: dist.p50 };
    // The same phase with the campfire taken out: what the extremities are judged in. Built by
    // omitting the key rather than setting it to `undefined`: `exactOptionalPropertyTypes`.
    const { campfire: _campfire, ...withoutFire } = conditions;
    const conditionsWithoutFire: PhaseConditions = withoutFire;
    const fireOn = conditions.campfire?.on === true;
    const phaseWarnings: ModelWarning[] = [];
    const phaseCaveats = new Set<string>();

    if (plan.phase === 'sleep') {
      const sleepGear = gear.sleep;
      if (sleepGear === undefined) {
        throw new ThermalModelError(
          'coverage_no_sleep_gear',
          'The sleep phase was requested but `gear.sleep` is missing. A bag rating and its ' +
            'ratingType (comfort or limit) are required: the engine never guesses which a ' +
            'label states.',
        );
      }
      const system: SleepSystemInput = {
        bag: sleepGear.bag,
        pads: sleepGear.pads,
        ...(plan.clothingInsideBagClo !== undefined
          ? { clothingInsideClo: plan.clothingInsideBagClo }
          : {}),
      };
      const config: SleepConfiguration = { kind: 'sleep', system };
      const assessment = assess(config, conditions);
      phaseWarnings.push(...assessment.warnings);
      assessment.caveats.forEach((c) => phaseCaveats.add(c));

      const interval: Span = {
        fromC: assessment.comfort.coldLimitC,
        toC: assessment.comfort.warmLimitC ?? band.toC,
      };
      const covered = compactSpan(intersect(interval, band));
      const sleepClo =
        assessment.detail.model === 'iso-23537-annex-c' ? assessment.detail.systemRc / 0.155 : 0;
      const candidate: CandidateEnsemble = {
        id: 'sleep_system',
        label: `${sleepGear.bag.kind === 'quilt' ? 'Quilt' : 'Bag'} + pads`,
        // Sleep has a single candidate, so there is no delta to name it by.
        shortLabel: `${sleepGear.bag.kind === 'quilt' ? 'Quilt' : 'Bag'} + pads`,
        garments: [],
        clo: sleepClo,
        // A bag's venting *is* already in its interval: `assessSleep` takes the warm end from
        // the vented-bag comfort temperature plus SLEEP_VENT_HEADROOM_K. There is no second
        // clo-denominated venting term to report here.
        ventableClo: 0,
        ventedClo: sleepClo,
        ventingCloRange: [sleepClo, sleepClo],
        assessment,
        coveredC: covered,
        uniquelyCoversC: covered,
      };
      const gaps = subtract(band, covered).map<CoverageGap>((gapSpan) => ({
        phase: plan.phase,
        fromC: gapSpan.fromC,
        toC: gapSpan.toC,
        severity: gapSpan.toC <= interval.fromC + 1e-6 ? 'cold' : 'too_warm',
        fix:
          gapSpan.toC <= interval.fromC + 1e-6
            ? sleepFix(fmt, system, conditions, gapSpan, w.all)
            : {
                kind: 'shed',
                text: `Above ${fmt.point(gapSpan.fromC)} you will be venting the bag all night.`,
                short: `You will be venting the bag all night above ${fmt.point(gapSpan.fromC)}.`,
              },
      }));
      allGaps.push(...gaps);
      phaseResults.push({
        phase: plan.phase,
        band,
        model: assessment.model,
        candidates: [candidate],
        best: candidate,
        envelope: interval,
        covered,
        gaps,
        coveredFraction: coveredFraction(band, covered),
        extremities: [],
        warnings: dedupeWarnings(phaseWarnings),
        caveats: [...phaseCaveats],
      });
      allWarnings.push(...phaseWarnings);
      phaseCaveats.forEach((c) => allCaveats.add(c));
      continue;
    }

    // --- clothed phases ----------------------------------------------------------------
    const met = plan.met ?? PHASE_METABOLIC_RATE_MET[plan.phase];
    const metabolicRate = metToWm2(met);
    const drapeClo =
      plan.bagAsBlanket === true && gear.sleep !== undefined ? bagAsBlanketClo(gear.sleep.bag) : 0;

    const configFor = (items: readonly Garment[]): ClothedConfiguration => ({
      kind: 'clothed',
      garments: items,
      metabolicRate,
      ...(drapeClo > 0 ? { extraClo: drapeClo } : {}),
    });

    const built = layeringLadder(w);
    const assessed: CandidateEnsemble[] = [];
    for (const c of built) {
      let assessment: ThermalAssessment;
      try {
        assessment = assess(configFor(c.items), conditions);
      } catch (error) {
        if (error instanceof ThermalModelError) {
          phaseWarnings.push({
            code: 'coverage_candidate_failed',
            severity: 'caution',
            message: `Candidate "${c.label}" could not be assessed: ${error.message}`,
          });
          continue;
        }
        throw error;
      }
      // The envelope: fully closed at the cold end, fully vented at the warm end. Coverage is
      // computed against this, so an interior "gap" that venting closes never appears: the
      // physics closed it, we did not suppress it.
      const interval: Span = {
        fromC: assessment.comfort.coldLimitC,
        toC: assessment.comfort.warmLimitC ?? band.toC + 100,
      };
      const ventableClo = assessment.comfort.ventableClo ?? 0;
      const clo = assessment.detail.model === 'iso-11079-ireq' ? assessment.detail.providedClo : 0;
      assessed.push({
        id: c.id,
        label: c.label + (drapeClo > 0 ? ' + bag draped' : ''),
        shortLabel: '',
        garments: c.items,
        clo,
        ventableClo,
        ventedClo: clo - ventableClo,
        ventingCloRange: [clo - ventableClo, clo],
        assessment,
        coveredC: compactSpan(intersect(interval, band)),
        uniquelyCoversC: [],
      });
    }

    // --- the Pareto filter -------------------------------------------------------------
    // A rung earns its place by covering a slice of the band that no *lighter* rung covers.
    // Nesting gives the ladder its naturalness; this gives it its non-redundancy. (A slice
    // covered only by this rung is necessarily covered by no lighter one, so this subsumes
    // plain set-theoretic uniqueness.)
    for (const c of assessed) {
      const lighter = assessed.filter((o) => o !== c && o.clo < c.clo).flatMap((o) => o.coveredC);
      (c as { uniquelyCoversC: readonly Span[] }).uniquelyCoversC = difference(c.coveredC, lighter);
    }
    const anyCoverage = assessed.some((c) => c.coveredC.length > 0);
    // Nothing in the kit reaches the band at all: there is nothing to discriminate on, so keep
    // the whole ladder and let the gap speak. (The rung with the lowest cold limit always
    // survives the filter when there *is* coverage, so the cold-gap fix always has its
    // reference configuration.)
    let evaluated = anyCoverage
      ? assessed.filter((c) => c.uniquelyCoversC.length > 0)
      : [...assessed];
    if (evaluated.length > maxCandidates) evaluated = thinLadder(evaluated, maxCandidates);

    // Name each candidate by its delta from the lightest, now that the full set is known. With
    // a nested chain the common prefix is exactly the lightest surviving rung, so the deltas
    // are the garments you add to it and nothing else.
    {
      const short = shortLabels(evaluated.map((c) => c.garments));
      for (let i = 0; i < evaluated.length; i += 1) {
        const suffix = drapeClo > 0 ? ' + bag draped' : '';
        const base = short[i] ?? 'base only';
        // Never collapse to a bare "+ bag draped": that reads as a quilt over a naked person.
        (evaluated[i] as { shortLabel: string }).shortLabel = `${base}${suffix}`;
      }
    }
    // Warnings and caveats follow the rungs that survived, so a pruned rung cannot leave a
    // warning behind with nothing in the report to attach it to.
    for (const c of evaluated) {
      phaseWarnings.push(...c.assessment.warnings);
      c.assessment.caveats.forEach((x) => phaseCaveats.add(x));
    }

    // Pruning cannot change what is covered (a rung is only dropped when a *lighter* rung
    // already covers everything it does), so `covered` is the same either way. But it can drop
    // the rung that defines an end of the envelope, so **the gap classification is computed
    // against the whole ladder, not against the survivors.** Otherwise pruning a rung that is
    // too warm for the band would turn an interior gap into a false "cold".
    const covered = union(assessed.flatMap((c) => c.coveredC));
    // The configuration that reaches furthest down is the reference for a cold gap, not the
    // one with the most clo, which is the same thing in every ordinary kit but is not what the
    // question asks.
    const coldest = (xs: readonly CandidateEnsemble[]): CandidateEnsemble | null =>
      xs.reduce<CandidateEnsemble | null>(
        (a, b) =>
          a === null || b.assessment.comfort.coldLimitC < a.assessment.comfort.coldLimitC ? b : a,
        null,
      );
    const coldestCandidate = coldest(assessed);
    const lightestCandidate = assessed.reduce<CandidateEnsemble | null>(
      (a, b) => (a === null || b.clo < a.clo ? b : a),
      null,
    );
    const coldestLimit =
      coldestCandidate === null
        ? Number.POSITIVE_INFINITY
        : coldestCandidate.assessment.comfort.coldLimitC;
    const warmestLimit = assessed.reduce(
      (a, c) => Math.max(a, c.assessment.comfort.warmLimitC ?? Number.POSITIVE_INFINITY),
      Number.NEGATIVE_INFINITY,
    );
    const envelope: Span | null =
      assessed.length === 0 || !Number.isFinite(coldestLimit)
        ? null
        : { fromC: coldestLimit, toC: warmestLimit };

    const gaps = subtract(band, covered).map<CoverageGap>((gapSpan) => {
      // Exterior, cold: below everything you own, fully closed. Unchanged in meaning.
      if (gapSpan.toC <= coldestLimit + 1e-6 && coldestCandidate !== null) {
        return {
          phase: plan.phase,
          fromC: gapSpan.fromC,
          toC: gapSpan.toC,
          severity: 'cold',
          fix: clothedFix(
            fmt,
            configFor(coldestCandidate.garments),
            conditions,
            coldestCandidate.garments,
            w.all,
            gapSpan,
          ),
        };
      }
      // Exterior, warm: above the lightest thing you own with everything open. Unchanged.
      if (gapSpan.fromC >= warmestLimit - 1e-6) {
        return {
          phase: plan.phase,
          fromC: gapSpan.fromC,
          toC: gapSpan.toC,
          severity: 'too_warm',
          fix: tooWarmFix(fmt, gapSpan, lightestCandidate?.garments ?? []),
        };
      }
      // Interior, and it survived venting. Real, and reported in its own words.
      // The *lighter* rung brackets the gap from above in temperature (it is comfortable only
      // warmer than the gap, so inside the gap it is too cold); the *warmer* rung brackets it
      // from below (inside the gap it is too warm even with everything open).
      const lighter = assessed
        .filter((c) => c.assessment.comfort.coldLimitC >= gapSpan.toC - 1e-6)
        .reduce<CandidateEnsemble | null>((a, b) => (a === null || b.clo < a.clo ? b : a), null);
      const warmer = assessed
        .filter(
          (c) =>
            (c.assessment.comfort.warmLimitC ?? Number.POSITIVE_INFINITY) <= gapSpan.fromC + 1e-6,
        )
        .reduce<CandidateEnsemble | null>((a, b) => (a === null || b.clo > a.clo ? b : a), null);
      return {
        phase: plan.phase,
        fromC: gapSpan.fromC,
        toC: gapSpan.toC,
        severity: 'nothing_between',
        fix: nothingBetweenFix(
          fmt,
          gapSpan,
          conditions,
          lighter === null
            ? null
            : {
                label: lighter.label,
                config: configFor(lighter.garments),
                garments: lighter.garments,
              },
          warmer === null ? null : { label: warmer.label },
          w.all,
        ),
      };
    });
    allGaps.push(...gaps);

    // `best` and the extremity reference are the coldest-reaching *displayed* rung, so a caller
    // that renders `best` always has a labelled candidate from `candidates` in its hand.
    const bestCandidate = coldest(evaluated);
    const reference = bestCandidate ?? evaluated[0] ?? coldestCandidate ?? null;
    // 🔴 **The extremity verdicts are computed as if there were no fire, and that is the whole
    // point.** A campfire is radiantly asymmetric: it heats the side of you that faces it,
    // and a whole-body steady-state balance would launder that into warm hands it has not
    // earned. The fire reaches the extremities by two routes and both are closed here: the
    // operative temperature they are judged against, *and* the core margin that drives
    // vasoconstriction (a warmer core really does open peripheral perfusion, but not on the
    // strength of a number that assumed your back was as warm as your front). So the reference
    // candidate is re-assessed with the fire taken out. No fire ⇒ identical, and no re-solve.
    const extremityReference =
      reference === null
        ? null
        : fireOn
          ? (() => {
              try {
                return assess(configFor(reference.garments), conditionsWithoutFire);
              } catch {
                return reference.assessment;
              }
            })()
          : reference.assessment;
    const extremities =
      reference === null || extremityReference === null
        ? []
        : assessExtremities(
            {
              operativeTemperatureC:
                extremityReference.conditions.operativeTemperatureWithoutSourceC ??
                extremityReference.conditions.operativeTemperatureC,
              coreMarginClo:
                extremityReference.detail.model === 'iso-11079-ireq'
                  ? extremityReference.detail.marginClo
                  : 0,
              met,
              airVelocity: extremityReference.conditions.airVelocity,
              windproof: reference.garments.some((x) => x.windproof === true),
            },
            // 🔴 **Judged against the warmest you OWN for that part, not against whatever the
            // core ladder happens to be wearing.** The candidate ladder drops rungs that do not
            // uniquely cover a slice of the band, and a beanie or a pair of liners adds so
            // little whole-body clo that its rung is almost always redundant. The surviving
            // candidate therefore often carries no headwear and no handwear at all, and reading
            // the extremities off it reported 0.00 clo for someone holding gloves in their pack.
            // That defeats the entire reason SPEC §2.4 judges extremities separately: a cold
            // hand is a local budget, not a consequence of the whole-body optimum. Nobody leaves
            // a beanie in the pack while their head is cold, so the honest question is whether
            // your warmest owned option for that part is enough.
            {
              hands: bestOwnedClo(w, 'hands'),
              feet: bestOwnedClo(w, 'feet'),
              head: bestOwnedClo(w, 'head'),
            },
          );
    extremities.forEach((e) => {
      phaseWarnings.push(...e.warnings);
      phaseCaveats.add(e.caveat);
    });

    phaseResults.push({
      phase: plan.phase,
      band,
      model: 'iso-11079-ireq',
      candidates: evaluated,
      best: bestCandidate,
      envelope,
      covered,
      gaps,
      coveredFraction: coveredFraction(band, covered),
      extremities,
      warnings: dedupeWarnings(phaseWarnings),
      caveats: [...phaseCaveats],
    });
    allWarnings.push(...phaseWarnings);
    phaseCaveats.forEach((c) => allCaveats.add(c));
  }

  return {
    phases: phaseResults,
    gaps: allGaps,
    verdict: oneSentenceVerdict(fmt, phaseResults, allGaps, useMinMax ? 'min-max' : 'p10-p90'),
    warnings: dedupeWarnings(allWarnings),
    caveats: [...allCaveats],
    unverifiedConstants: UNVERIFIED_CONSTANTS,
  };
}

/**
 * The warmest insulation the wardrobe can put on one body region: the best inner plus the best
 * outer where the region has both slots, otherwise the best single item. Used for the extremity
 * verdicts, which ask "is what you own enough for this part", not "what did the core ladder pick".
 */
function bestOwnedClo(w: Wardrobe, region: 'hands' | 'feet' | 'head'): number {
  const warmestOf = (items: readonly Garment[]): number =>
    items.reduce((best, g) => (g.clo > best ? g.clo : best), 0);
  if (region === 'feet') return warmestOf(w.feetInner) + warmestOf(w.feetOuter);
  if (region === 'hands') return handsStack(w.hands).reduce((sum, g) => sum + g.clo, 0);
  return warmestOf(w.head);
}

function sumClo(garments: readonly Garment[], region: Garment['region']): number {
  return garments.filter((x) => x.region === region).reduce((s, x) => s + x.clo, 0);
}

const compactSpan = (s: Span | null): Span[] => (s === null ? [] : [s]);

/**
 * Collapse warnings that say the same thing.
 *
 * A phase assesses several candidates, and most model warnings are properties of the *phase*:
 * the ensemble rule being outside its tested range, a short duration-limited exposure, a
 * validity-range clamp, so they arrive once per candidate. Four copies of one sentence read as
 * a bug and bury the warnings that say something different. Warning text no longer carries
 * per-candidate numbers (those live on the candidate), so identical text really is a duplicate.
 */
function dedupeWarnings(warnings: readonly ModelWarning[]): ModelWarning[] {
  const seen = new Set<string>();
  const out: ModelWarning[] = [];
  for (const w of warnings) {
    const key = `${w.code}\u0000${w.severity}\u0000${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

function coveredFraction(band: Span, covered: readonly Span[]): number {
  const width = band.toC - band.fromC;
  if (width <= 0) return 1;
  const inside = union(covered).reduce((s, c) => {
    const i = intersect(c, band);
    return s + (i === null ? 0 : i.toC - i.fromC);
  }, 0);
  return Math.min(1, inside / width);
}

/**
 * When the phase happens, phrased to drop straight into a sentence after a temperature:
 * "warm enough below 40 °F **in camp in the evening**". The preposition is part of the label so
 * that one sentence shape works for all five phases.
 */
const PHASE_LABEL: Readonly<Record<PhaseName, string>> = {
  camp_morning: 'in camp in the morning',
  hiking: 'while hiking',
  day_break: 'at a break on the trail',
  camp_evening: 'in camp in the evening',
  sleep: 'asleep',
};

/**
 * The headline: one short sentence saying what the problem is, then the fix in one clause.
 *
 * Rules it follows, because the first version broke all of them:
 *
 * - **Lead with the consequence, not the derivation.** "Nothing you own is warm enough below
 *   40 °F in camp in the evening", not "you are short in camp in the evening, the biggest gap
 *   is 18 to 40 °F".
 * - **No model vocabulary.** No ontology, no ensembles, no comfort intervals, and no clo
 *   figure unless the number is part of the decision. The caveats panel is where a standard
 *   gets named; the headline is not.
 * - **Short sentences**, readable in one pass. The fix contributes its {@link Fix.short} form,
 *   which is the action without the arithmetic; the full version stays on the gap.
 * - **Never stronger than the model supports.** A hole between two of your layers is not a
 *   cold risk and does not get cold-risk words; a kit that only fails at the warm end says so
 *   rather than claiming full coverage.
 */
function oneSentenceVerdict(
  fmt: TempFormat,
  phases: readonly PhaseCoverage[],
  gaps: readonly CoverageGap[],
  band: 'p10-p90' | 'min-max',
): string {
  if (phases.length === 0) return 'Nothing assessed.';
  const advice = (gap: CoverageGap): string => gap.fix.short ?? gap.fix.text;
  const widest = (xs: readonly CoverageGap[]): CoverageGap =>
    xs.reduce((a, b) => (b.toC - b.fromC > a.toC - a.fromC ? b : a));

  const cold = gaps.filter((g) => g.severity === 'cold');
  if (cold.length > 0) {
    const worst = widest(cold);
    // The other short phases are named in the order the day runs, and only if there are any.
    const others = [
      ...new Set(
        [...cold]
          .sort((a, b) => PHASE_NAMES.indexOf(a.phase) - PHASE_NAMES.indexOf(b.phase))
          .filter((g) => g.phase !== worst.phase)
          .map((g) => PHASE_LABEL[g.phase]),
      ),
    ];
    // Naming four phases in a row is longer than the sentence it is attached to, so the clause
    // collapses once there are more than two: the headline's job is the shape of the problem,
    // and the per-phase panel is right there underneath it.
    const alsoWhere =
      others.length === 0
        ? ''
        : others.length === 1
          ? ` Same ${others[0] as string}.`
          : others.length === 2
            ? ` Same ${others[0] as string} and ${others[1] as string}.`
            : others.length === phases.length - 1
              ? ' Same in every other phase.'
              : ` Same in ${others.length} other phases.`;
    return (
      `Nothing you own is warm enough below ${fmt.point(worst.toC)} ` +
      `${PHASE_LABEL[worst.phase]}.${alsoWhere} ${advice(worst)}`
    );
  }

  // No cold gap. An interior hole is a dressing problem, not a cold risk, and is worded as one.
  const interior = gaps.filter((g) => g.severity === 'nothing_between');
  if (interior.length > 0) {
    const worst = widest(interior);
    return (
      `Nothing you own fits ${fmt.range(worst.fromC, worst.toC)} ${PHASE_LABEL[worst.phase]}: ` +
      `you have warmer and you have lighter, nothing in between. ${advice(worst)}`
    );
  }

  // Only the warm end fails. Still a gap, so the headline does not claim the kit is covered.
  const warm = gaps.filter((g) => g.severity === 'too_warm');
  if (warm.length > 0) {
    const worst = widest(warm);
    return (
      'You will not be cold, but nothing you own is light enough above ' +
      `${fmt.point(worst.fromC)} ${PHASE_LABEL[worst.phase]}. ${advice(worst)}`
    );
  }
  // Name the band that was actually checked. The default one is p10 to p90, so "the whole
  // temperature range" overclaimed: a tail below p10 costs coverage nothing, and the chance of
  // *dipping* below the kit's limit at some point in a multi-day trip is far higher than 10 %
  // even when every phase is fully covered. Saying "the middle 80 %" lets that risk figure sit
  // beside this sentence without the two contradicting each other.
  return band === 'min-max'
    ? 'Your kit covers every phase, across the whole temperature range you expect.'
    : 'Your kit covers every phase, across the middle 80% of the temperatures you expect.';
}
