/**
 * The tab shell's vocabulary: one gear tab, then the five times of day in the order they are
 * lived. Each phase carries the words the shared phase tab speaks in, and the point in the
 * scene's parameter space it asks for: where the sun is, how the figure is posed, which props
 * are out. The scene tweens between those points when the tab changes (`Scene.tsx`).
 *
 * Names are chosen so that none can be misread: the stop in the middle of the day is a
 * "Lunch stop", never a "day break", which reads as dawn.
 */

import type { PhaseName } from '@will-i-be-cold/heat';
import type { Pose } from '../ui/Figure.js';

export type TabId = 'trip' | 'gear' | PhaseName;

/** How the tab talks about its period, in the few places the shared tab needs a word for it. */
export interface PhaseVoice {
  /** "tonight", "this morning": a when, at the end of a sentence. */
  readonly period: string;
  /** "of tonight", "of the hike": the share of the period a gap covers. */
  readonly share: string;
  /** The settings row's label. */
  readonly settings: string;
  /** How the character is posed, for the figure's label. */
  readonly posture: string;
}

export interface PhaseTab {
  readonly phase: PhaseName;
  /** Short, for the tab strip. */
  readonly label: string;
  /** Long, for a heading. */
  readonly title: string;
  /** The engine's own phrase for this phase, as it appears in its verdict sentence. */
  readonly enginePhrase: string;
  /** The words for one night of this phase. */
  readonly voice: PhaseVoice;
  /**
   * The words for the phase pooled over every night of the trip: "on some evening of the
   * trip", never "tonight", so the headline cannot claim one night when it is showing three.
   */
  readonly pooledVoice: PhaseVoice;
  /** Where in the day the scene is: sun progress on [0, 2), 0 sunrise, 1 sunset (`Sky.ts`). */
  readonly sun: number;
  readonly pose: Pose;
  /** Which of the scene's props are out. The campfire's flames follow the tab's own toggle. */
  readonly props: { readonly hearth: number; readonly log: number; readonly packBack: number; readonly packGround: number; readonly bag: number; readonly pole: number };
  /** One line for the scene's screen-reader caption. */
  readonly caption: string;
  readonly built: boolean;
}

export const PHASE_TABS: readonly PhaseTab[] = [
  {
    phase: 'camp_morning',
    label: 'Camp morning',
    title: 'Camp, before the sun',
    enginePhrase: 'camp in the morning',
    voice: { period: 'this morning', share: 'of the morning', settings: 'This morning', posture: 'seated at the fire ring in the cold of first light' },
    pooledVoice: { period: 'on some morning of the trip', share: "of the trip's mornings", settings: 'Mornings', posture: 'seated at the fire ring in the cold of first light' },
    sun: 1.95,
    pose: 'seated',
    props: { hearth: 1, log: 1, packBack: 0, packGround: 0, bag: 0, pole: 0 },
    caption: 'A seated figure at a fire ring before dawn: the sun still below the ridges, a pale band of first light on the horizon, the last stars fading.',
    built: true,
  },
  {
    phase: 'hiking',
    label: 'Hiking',
    title: 'On the trail',
    enginePhrase: 'while hiking',
    voice: { period: 'on the trail', share: 'of the hike', settings: 'On the trail', posture: 'walking with a pack, mid-stride' },
    pooledVoice: { period: 'on some day of the trip', share: "of the trip's hiking", settings: 'On the trail', posture: 'walking with a pack, mid-stride' },
    sun: 0.42,
    pose: 'walking',
    props: { hearth: 0, log: 0, packBack: 1, packGround: 0, bag: 0, pole: 1 },
    caption: 'A figure walking with a pack and a trekking pole under a high sun, white clouds over blue ridges.',
    built: true,
  },
  {
    phase: 'day_break',
    label: 'Lunch stop',
    title: 'A stop on the trail',
    enginePhrase: 'at a break on the trail',
    voice: { period: 'at the stop', share: 'of the stop', settings: 'At the stop', posture: 'sat down on a log for a break, pack on the ground' },
    pooledVoice: { period: 'at some stop on the trip', share: "of the trip's stops", settings: 'At the stops', posture: 'sat down on a log for a break, pack on the ground' },
    sun: 0.6,
    pose: 'seated',
    props: { hearth: 0, log: 1, packBack: 0, packGround: 1, bag: 0, pole: 0 },
    caption: 'A figure sat on a log beside their pack in the early afternoon, the sun high and a little west.',
    built: true,
  },
  {
    phase: 'camp_evening',
    label: 'Camp evening',
    title: 'Camp, after the sun goes',
    enginePhrase: 'camp in the evening',
    voice: { period: 'tonight', share: 'of tonight', settings: 'Tonight', posture: 'seated at the fire' },
    pooledVoice: { period: 'on some evening of the trip', share: "of the trip's evenings", settings: 'Evenings', posture: 'seated at the fire' },
    sun: 1.0,
    pose: 'seated',
    props: { hearth: 1, log: 1, packBack: 0, packGround: 0, bag: 0, pole: 0 },
    caption: 'A seated figure beside a campfire under a sunset sky spanning the page, cloud bands lit from below, ridgelines fading into haze.',
    built: true,
  },
  {
    phase: 'sleep',
    label: 'Sleep',
    title: 'In the bag',
    enginePhrase: 'asleep',
    voice: { period: 'overnight', share: 'of the night', settings: 'Overnight', posture: 'lying in the sleeping bag on a pad' },
    pooledVoice: { period: 'on some night of the trip', share: "of the trip's nights", settings: 'Nights', posture: 'lying in the sleeping bag on a pad' },
    sun: 1.5,
    pose: 'lying',
    props: { hearth: 1, log: 0, packBack: 0, packGround: 0, bag: 1, pole: 0 },
    caption: 'A figure lying in a sleeping bag on a pad under a moon and stars, the fire out to a few embers.',
    built: true,
  },
];

/** The voice for one night, or for the trip pooled when more than one night is on screen. */
export function voiceFor(tab: PhaseTab, nightsShown: number): PhaseVoice {
  return nightsShown > 1 ? tab.pooledVoice : tab.voice;
}

export function phaseTab(phase: PhaseName): PhaseTab {
  const t = PHASE_TABS.find((x) => x.phase === phase);
  if (t === undefined) throw new Error(`No tab for phase "${phase}".`);
  return t;
}
