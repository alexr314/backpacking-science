/**
 * The illustration: one world, at whatever time of day the tab is.
 *
 * All flat, layered shapes and SVG gradients: no raster assets, no external requests. The
 * composition does the contrast work for the rest of the panel: the sky is bright at the
 * horizon and the foreground falls to near-black, so the quantitative layer underneath it
 * inherits a dark ground without a card being dropped over the art.
 *
 * ONE SCENE, PARAMETERISED (`VISUAL_ROADMAP.md` R15). There are not five scenes. There is a
 * `SceneTarget`: the sun's progress through the day (`Sky.ts`), which pose the figure is in,
 * which props are present (the hearth, the log, the pack, the bag, the pole) and whether the
 * sky has closed over. Each tab is one target, and `useTween` walks from wherever the scene
 * is to the new one: the sun climbs or sets and the sky follows it, the moon and the stars
 * turn into place, the figure's geometry lerps between poses because every pose shares one
 * topology (`Figure.tsx`), and a prop fades. `prefers-reduced-motion` cuts straight to the
 * destination.
 *
 * ONE WORLD, FIXED. The landscape (the ridges, the trees, the clearing, the cloud field, the
 * sun's and the moon's arcs, the fire ring) is drawn in stage coordinates: fractions of the
 * full width and height the backdrop spans, and nothing else. It is the same geometry on
 * every tab, so a tab change moves the light and the figure through a world that stays put.
 * The tables below were drawn inside a frame (`FRAME_X`, `FRAME_W`) that is itself a fixed
 * fraction of the stage. The tab's measured `vignette` (the tableau cell the figure must
 * land in) positions nothing in the world; it only keeps the figure inside that cell.
 *
 * THE VALUE STRUCTURE is the point. The zenith is the darkest part of any sky, the horizon the
 * bright band, and the foreground falls to the data surface. The landscape is pushed up by
 * `LIFT` of the stage (R18) so the figure and the fire stand on a band of dark ground rather
 * than against the ridges; that ground is also where the extremity callouts sit (R17).
 *
 * THE CLOUDS DRIFT, slowly, east (left), the whole field on a loop; it is drawn twice, one
 * period apart, and the CSS animation (`style.css`, `.wibc-clouds`) carries it by exactly
 * that period, so the wrap is invisible. The quiet end of the register: a few pixels a
 * second. Reduced motion stills it.
 *
 * THE OVERCAST. "It rained today" closes the sky: the bands grow, grey and merge under one
 * sheet whose lumpy underside hangs over the ridges, the sun and the moon go to a pale patch,
 * and the land loses its colour (`Sky.ts` `overcastAt`). It is one number in the target, so
 * it tweens like everything else.
 *
 * THE FIRE IS A SWITCH. `lit` is the same control that puts the campfire into the physics;
 * the flames grow in and die out on their own clock (`Fire.tsx`), and the bloom on the
 * clearing follows them.
 */

import type { JSX } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import type { Verdict } from '@will-i-be-cold/heat';
import { Figure, GEOMETRY, GETTING_DOWN, extentsOf, lerpGeometry, poseFacts, specOf, type Pose, type PoseGeometry } from './Figure.js';
import { Fire } from './Fire.js';
import { SKY_STOP_FRACTIONS, STARS, lerpProgress, overcastAt, skyAt } from './Sky.js';
import type { Outfit, Region } from '../model/kit.js';
import type { Box } from '../lib/useMeasure.js';
import { useTween } from '../lib/useTween.js';

/** How far up the stage the landscape is pushed, as a fraction of its height (R18). */
const LIFT = 0.27;
/** The horizon's height before the lift: the sun sets here, and the ridges stand on it. */
const HORIZON = 0.6;
/**
 * The frame the little scene's tables were drawn in, as fractions of the stage width: the
 * tableau's scene cell on the signed-off camp-evening tab. Fixed here, so the world no longer
 * follows whichever cell a tab happens to measure.
 */
const FRAME_X = 0.41;
const FRAME_W = 0.4607;
/** The world's ground line, the fraction of the stage height the figure and the fire stand on. */
/**
 * The ground plane, as a fraction of the stage. One line for every tab: the figure, the fire and
 * the mat all stand on it, so it must clear the tallest controls any tab puts over the stage.
 * The sleep tab's cell is the tightest (its bottom sits at 0.809 of the stage), so this stays
 * below that. Letting each tab clamp this to its own cell is what used to move the ground, and
 * the body with it, by 48 px between tabs.
 */
const GROUND = 0.8;
/** The little scene's unit: what the figure and the fire are scaled by. */
const UNIT = 0.55;
/** The clouds' drift speed, stage pixels per second. */
const DRIFT_PX_PER_S = 9;

/**
 * Ridge profiles as y-fractions across the width, far to near. Fixed arrays, so the scene is
 * deterministic; no randomness anywhere in this panel.
 */
const RIDGES: readonly (readonly number[])[] = [
  [0.7, 0.6, 0.655, 0.52, 0.595, 0.555, 0.47, 0.585, 0.53, 0.625, 0.555, 0.64, 0.585, 0.69],
  [0.76, 0.715, 0.775, 0.635, 0.72, 0.66, 0.735, 0.6, 0.69, 0.645, 0.745, 0.665, 0.725, 0.765],
  [0.825, 0.785, 0.815, 0.735, 0.795, 0.745, 0.805, 0.725, 0.79, 0.75, 0.805, 0.765, 0.815, 0.83],
  [0.885, 0.86, 0.88, 0.835, 0.87, 0.828, 0.862, 0.822, 0.858, 0.838, 0.872, 0.845, 0.878, 0.89],
];

/**
 * Clouds as flat-based bands of rounded swells with tapered ends: stratocumulus lying along
 * the horizon, the flat-shape register of the ridges but soft where they are sharp. Each one
 * is a dark body over a lit side, lit from below while the sun is low and from above once it
 * is high (`Sky.ts` `cloudLitSign`). `tier` picks its colours: 0 high and dark, 3 low and lit.
 *
 * `peaks` are crest heights as fractions of `th`, left to right; the first and last are the
 * tapered ends. Fractions of the frame for position and length, of the horizon height for
 * the base.
 */
interface CloudBand {
  readonly x: number;
  readonly y: number;
  readonly len: number;
  readonly th: number;
  readonly peaks: readonly number[];
  readonly tier: 0 | 1 | 2 | 3;
  readonly o: number;
}

const CLOUDS: readonly CloudBand[] = [
  // in the frame
  { x: 0.58, y: 0.235, len: 0.3, th: 0.06, peaks: [0.2, 0.7, 0.45, 1, 0.6, 0.25], tier: 0, o: 0.75 },
  { x: 0.1, y: 0.355, len: 0.34, th: 0.075, peaks: [0.15, 0.6, 1, 0.45, 0.8, 0.9, 0.3], tier: 1, o: 0.9 },
  { x: 0.54, y: 0.315, len: 0.28, th: 0.065, peaks: [0.2, 1, 0.5, 0.8, 0.3], tier: 1, o: 0.85 },
  { x: 0.4, y: 0.45, len: 0.42, th: 0.05, peaks: [0.15, 0.5, 1, 0.45, 0.85, 0.6, 0.2], tier: 2, o: 0.9 },
  { x: -0.02, y: 0.505, len: 0.26, th: 0.045, peaks: [0.3, 0.8, 0.5, 1, 0.3], tier: 3, o: 0.85 },
  // past its left edge: low along the horizon only, the upper sky there is where the title sits
  { x: -0.44, y: 0.49, len: 0.22, th: 0.04, peaks: [0.3, 1, 0.55, 0.8, 0.25], tier: 3, o: 0.8 },
  { x: -0.82, y: 0.455, len: 0.3, th: 0.045, peaks: [0.2, 0.7, 1, 0.5, 0.85, 0.3], tier: 2, o: 0.8 },
  { x: -1.28, y: 0.3, len: 0.26, th: 0.055, peaks: [0.2, 0.8, 0.45, 1, 0.5, 0.25], tier: 1, o: 0.85 },
  { x: -1.4, y: 0.5, len: 0.2, th: 0.04, peaks: [0.3, 0.9, 0.5, 1, 0.3], tier: 3, o: 0.75 },
  // past its right edge
  { x: 1.0, y: 0.275, len: 0.24, th: 0.06, peaks: [0.2, 1, 0.5, 0.8, 0.3], tier: 1, o: 0.85 },
  { x: 1.06, y: 0.47, len: 0.3, th: 0.045, peaks: [0.2, 0.6, 1, 0.5, 0.8, 0.3], tier: 2, o: 0.85 },
  { x: 1.56, y: 0.5, len: 0.22, th: 0.04, peaks: [0.3, 0.8, 0.5, 1, 0.3], tier: 3, o: 0.8 },
];

/**
 * The underside of the overcast sheet: swell depths as fractions of its thickness, evenly
 * spaced over one drift period. The first and last are equal and every tangent is level, so
 * the two copies join without a seam.
 */
const SHEET_SWELLS: readonly number[] = [0.45, 0.8, 0.5, 1, 0.6, 0.35, 0.9, 0.55, 0.75, 0.4, 0.85, 0.5, 0.7, 0.45];
/** The sheet's base, as a fraction of the horizon height, and its thickness as a fraction of the stage height. */
const SHEET_BASE = 0.33;
const SHEET_TH = 0.08;

/** A run of cubic segments through `pts` with level tangents at every point. */
function swells(pts: readonly (readonly [number, number])[]): string {
  const first = pts[0];
  if (first === undefined) return '';
  let d = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = (b[0] - a[0]) * 0.5;
    d += ` C ${(a[0] + dx).toFixed(1)} ${a[1].toFixed(1)} ${(b[0] - dx).toFixed(1)} ${b[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return d;
}

/**
 * The crest path of a cloud band, left end to right end; the caller closes it along the base.
 * Cubic segments with level tangents at every peak, so the top is a run of rounded swells
 * (cloud, not rock) over a dead-flat base.
 */
function cloudCrest(x0: number, baseY: number, len: number, th: number, peaks: readonly number[]): string {
  const n = peaks.length;
  return swells([
    [x0 - len * 0.08, baseY],
    ...peaks.map((p, i) => [x0 + (i / (n - 1)) * len, baseY - p * th] as const),
    [x0 + len * 1.08, baseY],
  ]);
}

/** The sheet's underside over `[x0, x0 + len]`, closed up to `top`: swells hanging below a flat base. */
function sheetPath(x0: number, baseY: number, len: number, th: number, top: number): string {
  const n = SHEET_SWELLS.length;
  const d = swells(SHEET_SWELLS.map((p, i) => [x0 + (i / (n - 1)) * len, baseY + p * th] as const));
  return `${d} L ${(x0 + len).toFixed(1)} ${top.toFixed(1)} L ${x0.toFixed(1)} ${top.toFixed(1)} Z`;
}

/**
 * A ridgeline through evenly spaced peaks, closed down to `bottom`. Segments are straight with
 * only the crests eased, which is what makes these read as mountains rather than as dunes.
 *
 * The profile is anchored so that peak `i` lands at `x0 + i * step`, and continues past both
 * ends of the array to cover `[0, w]` by running the profile back and forth (ping-pong, so no
 * seam): the frame gets the ridge it always had, and the rest of the width gets more of the
 * same range at the same steepness, whatever the aspect of the page.
 */
function ridgePath(ys: readonly number[], w: number, h: number, bottom: number, x0: number, step: number): string {
  const n = ys.length;
  const period = 2 * (n - 1);
  const at = (i: number): number => {
    const j = ((i % period) + period) % period;
    return ys[j < n ? j : period - j]! * h;
  };
  const iMin = Math.floor(-x0 / step) - 1;
  const iMax = Math.ceil((w - x0) / step) + 1;
  const pts: (readonly [number, number])[] = [];
  for (let i = iMin; i <= iMax; i++) pts.push([x0 + i * step, at(i)]);
  const first = pts[0];
  if (first === undefined) return '';
  let d = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const ease = (cur[0] - prev[0]) * 0.18;
    d +=
      ` L ${(prev[0] + ease).toFixed(1)} ${(prev[1] + (cur[1] - prev[1]) * 0.18).toFixed(1)}` +
      ` L ${(cur[0] - ease).toFixed(1)} ${(cur[1] - (cur[1] - prev[1]) * 0.18).toFixed(1)}` +
      ` Q ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} ${(cur[0] + ease * 0.5).toFixed(1)} ${(cur[1] + Math.abs(cur[1] - prev[1]) * 0.08).toFixed(1)}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` L ${(w + 2).toFixed(1)} ${last[1].toFixed(1)} L ${(w + 2).toFixed(1)} ${(bottom + 2).toFixed(1)} L ${-2} ${(bottom + 2).toFixed(1)} Z`;
  return d;
}

/** [x, baseline y, height]: x as a fraction of the frame's width (past its edges allowed), y and height of the scene height. */
const CONIFERS: readonly [number, number, number][] = [
  [0.035, 0.895, 0.2],
  [0.085, 0.905, 0.14],
  [0.125, 0.885, 0.1],
  [0.82, 0.885, 0.13],
  [0.875, 0.9, 0.21],
  [0.935, 0.89, 0.15],
  [0.975, 0.905, 0.24],
  [0.69, 0.875, 0.08],
  // past the frame's left edge, the forest the thermometer stands under
  [-0.03, 0.9, 0.16],
  [-0.085, 0.905, 0.11],
  [-0.2, 0.895, 0.21],
  [-0.26, 0.905, 0.13],
  [-0.4, 0.9, 0.17],
  [-0.47, 0.895, 0.24],
  [-0.56, 0.905, 0.12],
  [-0.7, 0.9, 0.19],
  [-0.79, 0.895, 0.14],
  [-0.93, 0.9, 0.22],
  [-1.04, 0.905, 0.15],
  [-1.2, 0.895, 0.2],
  [-1.33, 0.9, 0.13],
  [-1.5, 0.9, 0.23],
  // and past its right edge
  [1.02, 0.9, 0.16],
  [1.08, 0.895, 0.22],
  [1.19, 0.905, 0.12],
  [1.3, 0.9, 0.2],
  [1.42, 0.895, 0.15],
  [1.55, 0.9, 0.24],
  [1.7, 0.905, 0.13],
];

/** A flat three-tier conifer: wide skirt, narrower middle, a spire. */
function conifer(x: number, baseY: number, height: number): string {
  const halfW = height * 0.3;
  const tiers = [0, 0.3, 0.58].map((t) => {
    const y = baseY - height * t;
    const topY = baseY - height * (t + 0.44);
    const hw = halfW * (1 - t * 0.75);
    return `M ${x - hw} ${y} L ${x} ${topY} L ${x + hw} ${y} Z`;
  });
  return `${tiers.join(' ')} M ${x - height * 0.035} ${baseY} L ${x + height * 0.035} ${baseY} L ${x + height * 0.03} ${baseY + height * 0.07} L ${x - height * 0.03} ${baseY + height * 0.07} Z`;
}

/** The moon as a waxing crescent: the lit limb toward the west, where the sun went. */
function crescent(cx: number, cy: number, r: number): string {
  const inner = r * 1.3;
  return `M ${cx.toFixed(1)} ${(cy - r).toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 1 ${cx.toFixed(1)} ${(cy + r).toFixed(1)} A ${inner.toFixed(1)} ${inner.toFixed(1)} 0 0 0 ${cx.toFixed(1)} ${(cy - r).toFixed(1)} Z`;
}

/** The tableau cell the figure must land in, in the backdrop's own pixels. It positions nothing else. */
export type Vignette = Box;

/**
 * What a tab asks the scene to be. Every field is either a number in [0, 1] (how present a
 * prop is) or a pose name; the scene tweens toward it.
 */
export interface SceneTarget {
  /** Sun progress, cyclic on [0, 2): 0 sunrise, 0.5 noon, 1 sunset, 1.5 midnight (`Sky.ts`). */
  readonly p: number;
  readonly pose: Pose;
  /** The fire ring is there (logs, embers). */
  readonly hearth: number;
  /** The flames are burning: the campfire toggle. */
  readonly lit: boolean;
  /** The log the figure sits on. */
  readonly log: number;
  /** The pack on the figure's back (walking) or on the ground beside them (resting). */
  readonly packBack: number;
  readonly packGround: number;
  /** The sleeping bag and pad around the figure. */
  readonly bag: number;
  /** A trekking pole in hand. */
  readonly pole: number;
  /** The sky closed over: the "it rained today" toggle. */
  readonly overcast: number;
}

/** An extremity verdict to draw on the figure: a leader to the body part, a label, a ring. */
export interface SceneAnnotation {
  readonly region: Extract<Region, 'hands' | 'feet' | 'head'>;
  readonly verdict: Verdict;
  readonly label: string;
  readonly detail: string;
  readonly colour: string;
}

export interface SceneProps {
  /** The full width the backdrop spans. */
  readonly width: number;
  /** The full height the backdrop spans; the tableau is laid over all of it. */
  readonly height: number;
  readonly vignette: Vignette;
  readonly kit: Outfit;
  readonly target: SceneTarget;
  /** Clicking the character is the shortcut to the gear tab. */
  readonly onFigureClick: () => void;
  readonly figureLabel: string;
  readonly caption: string;
  readonly annotations?: readonly SceneAnnotation[];
  readonly uid: string;
}

/** Everything the scene draws from, all numbers, so a transition is one lerp. */
interface Live {
  readonly p: number;
  readonly geometry: PoseGeometry;
  readonly fx: number;
  readonly fy: number;
  readonly scale: number;
  readonly angle: number;
  readonly hearth: number;
  readonly log: number;
  readonly packBack: number;
  readonly packGround: number;
  readonly bag: number;
  readonly pole: number;
  readonly overcast: number;
}

const ln = (a: number, b: number, u: number): number => a + (b - a) * u;

function blendLive(a: Live, b: Live, u: number): Live {
  return {
    p: lerpProgress(a.p, b.p, u),
    geometry: lerpGeometry(a.geometry, b.geometry, u),
    fx: ln(a.fx, b.fx, u),
    fy: ln(a.fy, b.fy, u),
    scale: ln(a.scale, b.scale, u),
    angle: ln(a.angle, b.angle, u),
    hearth: ln(a.hearth, b.hearth, u),
    log: ln(a.log, b.log, u),
    packBack: ln(a.packBack, b.packBack, u),
    packGround: ln(a.packGround, b.packGround, u),
    bag: ln(a.bag, b.bag, u),
    pole: ln(a.pole, b.pole, u),
    overcast: ln(a.overcast, b.overcast, u),
  };
}

function sameLive(a: Live, b: Live): boolean {
  return (
    a.p === b.p &&
    a.geometry === b.geometry &&
    a.fx === b.fx &&
    a.fy === b.fy &&
    a.scale === b.scale &&
    a.angle === b.angle &&
    a.hearth === b.hearth &&
    a.log === b.log &&
    a.packBack === b.packBack &&
    a.packGround === b.packGround &&
    a.bag === b.bag &&
    a.pole === b.pole &&
    a.overcast === b.overcast
  );
}

/**
 * GETTING DOWN TO THE MAT, AND BACK UP.
 *
 * Lying down used to be one lerp: the seated figure morphing into the standing one turned on
 * its side, which the client rightly called "just sort of morphs". The real motion is a
 * sequence (`GETTING_DOWN` in `Figure.tsx`, where the poses and his description of them live),
 * so the walk between those two targets passes through three fixed stops instead of going
 * straight. Each leg is still an ordinary `blendLive`, which is what keeps the garment art,
 * the props and the sky coming along: only the path through the space changed, not the space.
 *
 * Non-geometric fields (the fire, the log, the bag, the sun) are not pinned at the stops. A
 * stop takes them at its own fraction of the motion, so they still run smoothly end to end
 * while the body takes the scenic route.
 */
interface DownStop {
  readonly geometry: PoseGeometry;
  readonly fx: number;
  readonly fy: number;
  readonly scale: number;
  /** Fraction of the whole motion spent reaching this stop from the one before. */
  readonly w: number;
}

/**
 * The four legs: turn, down onto the knees, reach the hand to the ground, fold out flat. The
 * turn is quick and the two that carry weight are slow, which is how the motion actually goes.
 */
const DOWN_LEGS: readonly number[] = [0.16, 0.3, 0.24, 0.3];

/** The stops for a move onto the mat or off it, already placed; empty when neither end is lying. */
function downRoute(from: Pose, to: Pose, world: World): readonly DownStop[] {
  const down = to === 'lying' && from !== 'lying';
  const up = from === 'lying' && to !== 'lying';
  if (!down && !up) return [];
  const order = down ? [0, 1, 2] : [2, 1, 0];
  // the weight of the leg arriving at each stop: read forwards going down, backwards coming up
  const weights = down ? [DOWN_LEGS[0]!, DOWN_LEGS[1]!, DOWN_LEGS[2]!] : [DOWN_LEGS[3]!, DOWN_LEGS[2]!, DOWN_LEGS[1]!];
  return order.map((i, n) => {
    const geometry = GETTING_DOWN[i]!;
    // every stop stands on the same ground at the same spot, so getting down is the body folding
    // rather than the body travelling
    return { geometry, ...stand(geometry, 0, world), w: weights[n]! };
  });
}

/** A field that runs on its own schedule: 0 before `from`, 1 after `to`, smooth between. */
function ramp(u: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (u - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Two props do not belong on the body's clock, and the order they take is the order a person
 * does them in. Going down, the log goes early (you are off it as soon as you turn and kneel)
 * and the bag comes late (it is what you get into once you are flat). Getting up, both
 * reverse: the bag comes off first, and the log is there to sit on at the end.
 *
 * Left on the straight blend, going down the bag faded in over the middle of the motion and
 * covered the whole descent, so the choreography was invisible: it looked from the outside
 * exactly like the morph it replaced. Getting up, the bag stayed on to the end and swung
 * upright with the figure, which is worse than either.
 */
const EARLY: readonly [number, number] = [0, 0.2];
const LATE: readonly [number, number] = [0.76, 1];

/** `a` at u = 0 and `b` at u = 1, by way of the route; with no stops, the plain blend. */
function lerpAlong(route: { readonly down: boolean; readonly stops: readonly DownStop[] }, a: Live, b: Live, u: number): Live {
  const { down, stops } = route;
  if (stops.length === 0) return blendLive(a, b, u);
  if (u <= 0) return a;
  if (u >= 1) return b;
  const logAt = down ? EARLY : LATE;
  const bagAt = down ? LATE : EARLY;
  const scheduled = (v: Live): Live => ({
    ...v,
    log: ln(a.log, b.log, ramp(u, logAt[0], logAt[1])),
    bag: ln(a.bag, b.bag, ramp(u, bagAt[0], bagAt[1])),
  });
  const legs = [...stops.map((st) => st.w), Math.max(0.05, 1 - stops.reduce((t, st) => t + st.w, 0))];
  const total = legs.reduce((t, x) => t + x, 0);
  let acc = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const seg = legs[i]! / total;
    const last = i === legs.length - 1;
    if (u <= acc + seg || last) {
      const t = seg <= 0 ? 1 : Math.min(1, (u - acc) / seg);
      // a stop's own Live: the stop's body, everything else taken at the stop's point in the motion
      const at = (st: DownStop, f: number): Live => ({ ...blendLive(a, b, f), geometry: st.geometry, fx: st.fx, fy: st.fy, scale: st.scale, angle: 0 });
      const prev = i === 0 ? a : at(stops[i - 1]!, acc);
      const next = last ? b : at(stops[i]!, acc + seg);
      return scheduled(blendLive(prev, next, t));
    }
    acc += seg;
  }
  return b;
}

/** The stage's fixed frame for the little scene: where the figure, the fire and the clearing are. */
interface World {
  readonly w: number;
  readonly h: number;
  /** A frame fraction to a stage x. */
  readonly sx: (f: number) => number;
  /** The ground line the figure and the fire stand on. */
  readonly groundY: number;
  readonly unit: number;
  readonly narrow: boolean;
}

/**
 * ONE GROUND, ONE SIZE, ONE SPOT.
 *
 * Every pose used to carry its own placement constants and its own scale: the walker was drawn
 * at 0.9 and the sleeper at 0.7, the sleeper sat at a tenth of the way across the frame while
 * everyone else stood at four tenths, and each pose's distance to the ground had been chosen by
 * eye. Measured, the boots cut 40 px below the ground line while the sleeper floated 39 px above
 * it, the body changed size by 30 % between tabs and slid 89 px sideways. That is what reads as
 * the character "shifting around" from tab to tab, and it is a worse problem than any amount of
 * roughness inside a single transition: the eye is tracking a body that will not hold still.
 *
 * So the scene now has one plane. Every pose is measured (`extentsOf`, with the lean it will be
 * drawn at), stood with its lowest ink exactly on `groundY`, drawn at one scale, and centred on
 * one spot. The figure changes shape between tabs and nothing else, and because the sleeper no
 * longer travels to its own corner, the mat can simply materialise flat on the ground underneath
 * it (see the pad, below) rather than swinging in attached to the body.
 */
const LEAN: Readonly<Record<Pose, number>> = { seated: 0, standing: 0, walking: -3, lying: -90 };

/** Where the body is centred, as a frame fraction. The one spot every pose is drawn on. */
const FIGURE_CX = 0.44;
const FIGURE_CX_NARROW = 0.4;

function placement(pose: Pose, world: World): { fx: number; fy: number; scale: number; angle: number } {
  const angle = LEAN[pose];
  return { ...stand(GEOMETRY[pose], angle, world), angle };
}

/**
 * Stand any geometry on the ground at the figure's spot. A point `p` is drawn at
 * `(fx, fy) + scale * R(p)`, so the lowest ink lands on the ground when `fy = groundY - scale *
 * maxY`, and the body is centred when `fx = centre - scale * (minX + maxX) / 2`. Transition
 * poses go through the same function, which is why the descent neither sinks nor drifts.
 */
function stand(geometry: PoseGeometry, angle: number, world: World): { fx: number; fy: number; scale: number } {
  const { sx, groundY, unit, narrow } = world;
  const scale = (unit * (narrow ? 0.56 : 0.62)) / GEOMETRY.seated.h;
  const e = extentsOf(geometry, angle);
  return {
    fx: sx(narrow ? FIGURE_CX_NARROW : FIGURE_CX) - scale * ((e.minX + e.maxX) / 2),
    fy: groundY - scale * e.maxY,
    scale,
  };
}

const GLOW_MS = 3600;
const SCENE_MS = 1500;
/** Getting down to the mat is four legs, not one, so it is given the time to read as a motion. */
const GET_DOWN_MS = 2800;
const lerpGlow = (a: number, b: number, u: number): number => ln(a, b, u);
const sameN = (a: number, b: number): boolean => a === b;

export function Scene(props: SceneProps): JSX.Element {
  const { width: w, height: h, uid, target } = props;
  const narrow = w < 900;
  const lift = LIFT * h;
  /** The horizon, where the sun sets, after the lift. */
  const hz = HORIZON * h - lift;
  /**
   * The sky gradient runs over a taller span than the lifted horizon, so the open sky above
   * the ridges shows the same zenith-to-red run it did before the lift; the sun's glow
   * carries the orange at the horizon itself.
   */
  const skyH = hz * 1.45;

  // the world: the frame is a fixed fraction of the stage; the cell only keeps the figure inside itself
  const { y: vy, h: vh } = props.vignette;
  const world = useMemo<World>(
    () => ({
      w,
      h,
      sx: (f: number): number => w * (FRAME_X + f * FRAME_W),
      // one plane for every tab. Clamping this to the tab's own measured cell moved the ground
      // 48 px between the sleep tab and the rest, which moved the whole body with it.
      groundY: GROUND * h,
      unit: Math.min(UNIT * h, 440),
      narrow,
    }),
    [w, h, vy, vh, narrow],
  );
  const { sx, groundY, unit } = world;

  const liveTarget = useMemo<Live>(() => {
    const place = placement(target.pose, world);
    return {
      p: target.p,
      geometry: GEOMETRY[target.pose],
      ...place,
      hearth: target.hearth,
      log: target.log,
      packBack: target.packBack,
      packGround: target.packGround,
      bag: target.bag,
      pole: target.pole,
      overcast: target.overcast,
    };
  }, [target, world]);
  // a new tab target walks; a re-measured cell (the same target, moved) retargets the walk in flight or snaps at rest
  const lastTarget = useRef(target);
  const walk = lastTarget.current !== target;
  const fromPose = lastTarget.current.pose;
  lastTarget.current = target;
  /**
   * The path this walk takes. Only a move onto the mat or off it has stops; everything else is
   * the straight blend it always was.
   *
   * IT HAS TO OUTLIVE THE RENDER THAT STARTED IT. The cell is re-measured a frame after a tab
   * change, which hands `useTween` a new value and re-fires its effect with *this* render's
   * lerp. Held in a local, the route was already empty by then and the straight blend quietly
   * took the walk back over: the stops were built correctly and never reached the screen. In a
   * ref it survives, and the retarget keeps the original clock. The placements are rebuilt on
   * those renders because the re-measure is exactly when the world has moved under them.
   */
  const routeRef = useRef<{ from: Pose; to: Pose; down: boolean; stops: readonly DownStop[] }>({ from: target.pose, to: target.pose, down: true, stops: [] });
  if (walk) {
    routeRef.current = { from: fromPose, to: target.pose, down: target.pose === 'lying', stops: downRoute(fromPose, target.pose, world) };
  } else if (routeRef.current.stops.length > 0) {
    routeRef.current = { ...routeRef.current, stops: downRoute(routeRef.current.from, routeRef.current.to, world) };
  }
  const lerpRouted = (a: Live, b: Live, u: number): Live => lerpAlong(routeRef.current, a, b, u);
  const ms = routeRef.current.stops.length > 0 ? GET_DOWN_MS : SCENE_MS;
  const live = useTween(liveTarget, lerpRouted, walk ? ms : 0, sameLive);
  const glow = useTween(target.lit && target.hearth > 0.5 ? 1 : 0, lerpGlow, GLOW_MS, sameN);

  const sky = overcastAt(skyAt(live.p), live.overcast);
  const spec = specOf(live.geometry, poseFacts(target.pose));
  const lit = glow > 0.5 || sky.altitude > 0.05;

  // --- the sun and the moon on one arc, east (left) to west (right) ----------------------
  const xWest = sx(narrow ? 0.72 : 0.76);
  const xEast = w - xWest;
  const arcTop = hz - 0.17 * h;
  const q = live.p <= 1 ? live.p : 2 - live.p; // the sun's x goes back under the ground overnight
  const sunX = ln(xEast, xWest, q);
  const sunY = hz - sky.altitude * (hz - arcTop);
  // the moon, half a cycle behind the sun: up in the east at sunset, highest at midnight, down in the west at dawn;
  // its arc is lower and shifted west so that at midnight it stands clear of the headline
  const mq = Math.min(1, (((live.p - 1) % 2) + 2) % 2);
  const moonX = ln(xEast + 0.45 * (xWest - xEast), xWest + 0.12 * (xWest - xEast), mq);
  const moonY = hz - Math.sin(mq * Math.PI) * (hz - arcTop) * 0.55;
  const moonR = Math.max(8, h * 0.026);
  const starAngle = (live.p - 1.5) * 22;

  // --- the fire: a fixed place in the world ----------------------------------------------
  /**
   * The mat is part of the camp, not part of the body. Drawn inside the figure's transform it
   * swung up off the ground with him whenever he got up, which is the single thing that most
   * destroyed the sense that there was a ground at all. Here it lies flat where the sleeper
   * will lie, in scene coordinates, and simply fades in and out.
   */
  const mat = useMemo(() => {
    const lie = placement('lying', world);
    const e = extentsOf(GEOMETRY.lying, -90);
    return {
      x: lie.fx + lie.scale * e.minX - 10,
      y: world.groundY - 10,
      w: lie.scale * (e.maxX - e.minX) + 20,
      h: 12,
    };
  }, [world]);
  const fireScale = (unit * (narrow ? 0.22 : 0.3)) / 130;
  const fireCx = sx(narrow ? 0.8 : 0.68);
  const fireX = fireCx - 60 * fireScale;
  const fireY = groundY - unit * 0.08 - 130 * fireScale;
  const fireCy = fireY + 100 * fireScale;

  // --- the figure ----------------------------------------------------------------------
  const { fx, fy, scale: s, angle } = live;
  const rad = (angle * Math.PI) / 180;
  const toScene = (x: number, y: number): readonly [number, number] => [
    fx + s * (x * Math.cos(rad) - y * Math.sin(rad)),
    fy + s * (x * Math.sin(rad) + y * Math.cos(rad)),
  ];
  const figureTransform = `translate(${fx.toFixed(1)} ${fy.toFixed(1)}) rotate(${angle.toFixed(2)}) scale(${s.toFixed(4)})`;
  // the pool of dusk under the figure follows its body's centre
  const [poolX, poolY] = toScene(150, spec.h * 0.5);
  const poolR = spec.h * s * 0.5;
  // the log is where the seated figure's seat is, whichever pose is passing through
  const seat = placement('seated', world);
  const logTransform = `translate(${seat.fx.toFixed(1)} ${seat.fy.toFixed(1)}) scale(${seat.scale.toFixed(4)})`;

  /** Peak spacing that gives the frame the ridge it always had; the rest of the width continues it. */
  const ridgeStep = (FRAME_W * w) / (RIDGES[0]!.length - 1);
  const ridgeX0 = sx(0);
  const bottom = h + lift;

  // --- the cloud field: one period wide, drawn twice, drifting by one period --------------
  const period = 1.5 * w;
  const oc = live.overcast;
  const sheetBaseY = SHEET_BASE * (hz / HORIZON) + lift;
  const sheetTh = SHEET_TH * h;
  const cloudField = CLOUDS.map((c) => {
    // the cloud band scales to the lifted horizon rather than translating with the ridges,
    // so the highest clouds stay out of the tab bar's way and the lowest stay on the horizon
    const len0 = c.len * FRAME_W * w;
    const len = len0 * (1 + 0.5 * oc);
    const x0 = sx(c.x) - 0.25 * len0 * oc;
    const th = Math.max(8, c.th * h * 0.8) * (1 + 1.3 * oc);
    const baseY = c.y * (hz / HORIZON) + lift;
    const crest = cloudCrest(x0, baseY, len, th, c.peaks);
    /*
     * Lit from below while the sun is low: the lit colour is the whole silhouette, and
     * the body is the same silhouette lifted, so the sun's colour shows as a band along
     * the underside that follows the bumps of the crest. With the sun high the body drops
     * instead and the lit side is the top. Overcast, the lighting goes flat.
     */
    const liftPx = th * (0.3 + c.y * 0.4) * sky.cloudLitSign;
    const [body, litSide] = sky.cloudTiers[c.tier]!;
    return { key: `${c.x}-${c.y}`, crest, liftPx, body, litSide, o: c.o + (1 - c.o) * oc };
  });
  const renderClouds = (copy: number): JSX.Element => (
    <g key={copy} transform={`translate(${(copy * period).toFixed(1)} 0)`}>
      {oc > 0.001 && (
        <path d={sheetPath(-0.25 * w, sheetBaseY, period, sheetTh, -2)} fill={`url(#${uid}-sheet)`} opacity={oc} />
      )}
      {cloudField.map((c) => (
        <g key={c.key} opacity={c.o}>
          <path d={`${c.crest} Z`} fill={c.litSide} />
          <path d={`${c.crest} Z`} fill={c.body} transform={`translate(0 ${(-c.liftPx).toFixed(1)})`} />
        </g>
      ))}
    </g>
  );

  // --- extremity callouts, on the figure's left --------------------------------------------
  const outlines: Partial<Record<Region, string>> = {};
  const callouts = (props.annotations ?? [])
    .map((a) => {
      const [ax, ay] = toScene(...spec.anchors[a.region].inner);
      if (a.verdict !== 'fine') outlines[a.region] = a.colour;
      return { ...a, ax, ay };
    })
    .sort((a, b) => a.ay - b.ay);
  const figureLeft = Math.min(toScene(-20, 0)[0], toScene(-20, spec.h)[0]);
  const labelRight = figureLeft - 28;
  // labels keep 24 px apart, pushed down from their anchor's height when they would collide
  let lastY = Number.NEGATIVE_INFINITY;
  const placed = callouts.map((c) => {
    const y = Math.max(c.ay, lastY + 24);
    lastY = y;
    return { ...c, ly: y };
  });

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={props.caption} className="wibc-scene-svg">
      <defs>
        <linearGradient id={`${uid}-sky`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={skyH * SKY_STOP_FRACTIONS[SKY_STOP_FRACTIONS.length - 1]!}>
          {/* the night's zenith starts at the data ground's own colour, so the chrome above it has no seam */}
          {sky.stops.map((c, i) => (
            <stop key={i} offset={(SKY_STOP_FRACTIONS[i]! / SKY_STOP_FRACTIONS[SKY_STOP_FRACTIONS.length - 1]!).toFixed(3)} stop-color={c} />
          ))}
        </linearGradient>
        <linearGradient id={`${uid}-sheet`} gradientUnits="userSpaceOnUse" x1="0" y1={lift} x2="0" y2={sheetBaseY + sheetTh}>
          <stop offset="0" stop-color={sky.sheet[0]} />
          <stop offset="1" stop-color={sky.sheet[1]} />
        </linearGradient>
        <radialGradient id={`${uid}-sunglow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color={sky.glow[0]} stop-opacity={0.92 * sky.glowStrength} />
          <stop offset="0.3" stop-color={sky.glow[1]} stop-opacity={0.45 * sky.glowStrength} />
          <stop offset="0.65" stop-color={sky.glow[2]} stop-opacity={0.16 * sky.glowStrength} />
          <stop offset="1" stop-color={sky.glow[2]} stop-opacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-moonglow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#dfe6f5" stop-opacity="0.5" />
          <stop offset="0.35" stop-color="#b9c6e4" stop-opacity="0.14" />
          <stop offset="1" stop-color="#9fb0d8" stop-opacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-fireglow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ffb259" stop-opacity="0.55" />
          <stop offset="0.35" stop-color="#ff8a3a" stop-opacity="0.22" />
          <stop offset="1" stop-color="#ff7a2b" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-flame-out`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#d93a1e" />
          <stop offset="0.5" stop-color="#ff7a2b" />
          <stop offset="1" stop-color="#ffc34d" stop-opacity="0.6" />
        </linearGradient>
        <linearGradient id={`${uid}-flame-mid`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ff7a2b" />
          <stop offset="0.6" stop-color="#ffc34d" />
          <stop offset="1" stop-color="#fff1c2" stop-opacity="0.9" />
        </linearGradient>
        <linearGradient id={`${uid}-flame-core`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ffd27a" />
          <stop offset="0.7" stop-color="#fff1c2" />
          <stop offset="1" stop-color="#ffffff" />
        </linearGradient>
        <linearGradient id={`${uid}-ground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={sky.ground[0]} />
          <stop offset="0.5" stop-color={sky.ground[1]} />
          <stop offset="1" stop-color={sky.ground[2]} />
        </linearGradient>
        {RIDGES.map((ys, i) => (
          <linearGradient key={i} id={`${uid}-ridge-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={(Math.min(...ys) - 0.02).toString()} stop-color={sky.ridges[i]![0]} />
            <stop offset={(Math.min(...ys) + 0.22).toString()} stop-color={sky.ridges[i]![1]} />
          </linearGradient>
        ))}
        <radialGradient id={`${uid}-figurepool`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#0d0a1c" stop-opacity="0.62" />
          <stop offset="0.55" stop-color="#0d0a1c" stop-opacity="0.34" />
          <stop offset="1" stop-color="#0d0a1c" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b0f18" stop-opacity="0" />
          <stop offset="1" stop-color="#0b0f18" stop-opacity="1" />
        </linearGradient>
        <linearGradient id={`${uid}-bagshade`} gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="240" y2="0">
          <stop offset="0" stop-color="#1e2f4e" />
          <stop offset="0.55" stop-color="#34507f" />
          <stop offset="1" stop-color="#2a4066" />
        </linearGradient>
      </defs>

      {/* sky, the whole width */}
      <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-sky)`} />

      {/* the stars turn into place as the night goes on; below the horizon the ridges hide them */}
      {sky.starAlpha > 0.01 && (
        <g transform={`rotate(${starAngle.toFixed(2)} ${(w * 0.5).toFixed(1)} ${(-0.9 * h).toFixed(1)})`} opacity={sky.starAlpha}>
          {STARS.map((st, i) => (
            <circle key={i} cx={st.x * w} cy={st.y * hz} r={st.r} fill="#e9eefb" opacity={st.a} />
          ))}
        </g>
      )}

      {/* the sun: its glow across the sky, and its disc */}
      <ellipse
        cx={sunX}
        cy={sunY}
        rx={FRAME_W * w * ln(0.42, 0.3, Math.max(0, sky.altitude))}
        ry={h * ln(0.44, 0.3, Math.max(0, sky.altitude))}
        fill={`url(#${uid}-sunglow)`}
        opacity={Math.max(0, 1 - Math.max(0, -sky.altitude - 0.02) / 0.3) * (1 - 0.75 * oc)}
      />
      <circle cx={sunX} cy={sunY} r={Math.max(10, h * 0.035)} fill={sky.sunDisc} opacity={0.95 * sky.sunVisible} />

      {/* the moon, half a day behind the sun, a crescent with the old moon faint in its arms */}
      {sky.moonAlpha > 0.01 && (
        <g opacity={sky.moonAlpha}>
          <ellipse cx={moonX} cy={moonY} rx={FRAME_W * w * 0.18} ry={h * 0.16} fill={`url(#${uid}-moonglow)`} />
          <circle cx={moonX} cy={moonY} r={moonR} fill="#e9edf6" opacity="0.13" />
          <path d={crescent(moonX, moonY, moonR)} fill="#e9edf6" />
        </g>
      )}

      {/* the landscape, pushed up so the figure has dark ground to stand on */}
      <g transform={`translate(0 ${(-lift).toFixed(1)})`}>
        {/* the cloud field, drifting east: two copies one period apart, carried by one period */}
        <g className="wibc-clouds" style={`--wibc-drift: ${(-period).toFixed(1)}px; animation-duration: ${(period / DRIFT_PX_PER_S).toFixed(1)}s`}>
          {renderClouds(0)}
          {renderClouds(1)}
        </g>

        {/* ridgelines, far to near; the Smokies get their name from this haze */}
        {RIDGES.map((ys, i) => (
          <path key={`ridge-${i}`} d={ridgePath(ys, w, h, bottom, ridgeX0, ridgeStep)} fill={`url(#${uid}-ridge-${i})`} />
        ))}

        {/* conifers on the near ridge; the default shelter in this panel is "under forest" */}
        {CONIFERS.map(([cx, cy, ch], i) => (
          <path key={`tree-${i}`} d={conifer(sx(cx), cy * h, ch * h)} fill={sky.conifer} opacity={0.92} />
        ))}

        {/* the foreground the data sits on: the clearing's swell in the frame, levelling off either side */}
        <path
          d={
            `M -2 ${h * 0.885} Q ${sx(0) * 0.5} ${h * 0.905} ${sx(0)} ${h * 0.9} ` +
            `Q ${sx(0.3)} ${h * 0.855} ${sx(0.56)} ${h * 0.895} Q ${sx(0.82)} ${h * 0.935} ${sx(1)} ${h * 0.875} ` +
            `Q ${sx(1) + (w - sx(1)) * 0.5} ${h * 0.86} ${w + 2} ${h * 0.885} L ${w + 2} ${bottom + 2} L -2 ${bottom + 2} Z`
          }
          fill={`url(#${uid}-ground)`}
        />
      </g>

      {/* firelight thrown across the clearing; out, only the embers' faint warmth is left */}
      <ellipse cx={fireCx} cy={fireCy} rx={unit * 0.62} ry={unit * 0.34} fill={`url(#${uid}-fireglow)`} opacity={live.hearth * (0.14 + 0.86 * glow)} />

      {/* the pack set down beside the log at the lunch stop */}
      {live.packGround > 0.01 && (
        <g transform={`${logTransform} translate(318 0)`} opacity={live.packGround}>
          <ellipse cx={-10} cy={292} rx={56} ry={9} fill="#07090f" opacity="0.5" />
          <path d="M -58 286 C -62 236, -52 190, -12 186 C 30 184, 42 226, 40 286 Z" fill="#2c3a2e" />
          <path d="M -48 240 C -40 226, 20 224, 32 240 L 30 258 C 16 250, -36 250, -46 258 Z" fill="#1f2a22" />
          <rect x={-18} y={196} width={36} height={14} rx={7} fill="#1f2a22" />
        </g>
      )}

      {/* the log they are sitting on, and the shadow it casts away from the fire */}
      {live.log > 0.01 && (
        <g transform={logTransform} opacity={live.log}>
          <ellipse cx={150} cy={296} rx={120} ry={14} fill="#07090f" opacity="0.55" />
          <rect x={58} y={252} width={184} height={28} rx={14} fill="#241a22" />
          <rect x={58} y={252} width={184} height={10} rx={5} fill="#352630" />
        </g>
      )}

      {/* the figure needs to separate from the ridgeline behind it: a pool of dusk, not a halo */}
      <ellipse cx={poolX} cy={poolY} rx={poolR * 1.04} ry={poolR} fill={`url(#${uid}-figurepool)`} />

      {/* the mat, flat on the ground where the sleeper lies, under everything the body does */}
      {live.bag > 0.01 && (
        <g opacity={live.bag}>
          <rect x={mat.x} y={mat.y} width={mat.w} height={mat.h} rx={mat.h / 2} fill="#3a2e22" />
          <rect x={mat.x + 6} y={mat.y + 3} width={Math.max(0, mat.w - 12)} height={4} rx={2} fill="#5a4833" opacity="0.8" />
        </g>
      )}

      <g
        transform={figureTransform}
        className="wibc-scene-figure"
        role="button"
        tabindex={0}
        aria-label={props.figureLabel}
        onClick={props.onFigureClick}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onFigureClick();
          }
        }}
      >
        {/* the pack on the back, drawn behind the torso; it shows past the shoulders and sides */}
        {live.packBack > 0.01 && (
          <g opacity={live.packBack}>
            <path d="M 94 86 C 92 60, 208 60, 206 86 L 214 236 C 214 252, 86 252, 86 236 Z" fill="#2c3a2e" />
            <path d="M 100 92 C 110 80, 190 80, 200 92 L 204 128 C 180 118, 120 118, 96 128 Z" fill="#1f2a22" />
            <rect x={96} y={182} width={108} height={14} rx={7} fill="#1f2a22" />
          </g>
        )}
        <Figure kit={props.kit} pose={spec} view="dressed" selected={null} hovered={null} lit={lit} outlines={outlines} uid={`${uid}-scene`} />
        {/* the bag, over everything but the face: a mummy from the shoulders down and a hood round the head */}
        {live.bag > 0.01 && (
          <g opacity={live.bag}>
            <path
              d="M 150 100 C 196 100, 232 110, 236 150 L 232 300 C 230 380, 214 470, 196 510 C 180 526, 120 526, 104 510 C 86 470, 70 380, 68 300 L 64 150 C 68 110, 104 100, 150 100 Z"
              fill={`url(#${uid}-bagshade)`}
              stroke="#150f24"
              stroke-width="5"
              paint-order="stroke"
              stroke-linejoin="round"
            />
            {[180, 250, 320, 390, 455].map((yy) => (
              <path key={yy} d={`M 74 ${yy} C 110 ${yy + 10}, 190 ${yy + 10}, 226 ${yy}`} fill="none" stroke="#1e2f4e" stroke-width="3" opacity="0.7" />
            ))}
            <path
              d={
                'M 150 0 C 200 0, 226 30, 226 62 C 226 92, 206 112, 150 112 C 94 112, 74 92, 74 62 C 74 30, 100 0, 150 0 Z ' +
                'M 150 18 C 176 18, 190 36, 190 58 C 190 82, 172 96, 150 96 C 128 96, 110 82, 110 58 C 110 36, 124 18, 150 18 Z'
              }
              fill="#34507f"
              fill-rule="evenodd"
              stroke="#150f24"
              stroke-width="5"
              paint-order="stroke"
              stroke-linejoin="round"
            />
          </g>
        )}
        {/* a trekking pole in the leading hand */}
        {live.pole > 0.01 && (
          <g opacity={live.pole}>
            <line x1={246} y1={244} x2={266} y2={478} stroke="#8d97b0" stroke-width="4" stroke-linecap="round" />
            <line x1={246} y1={244} x2={266} y2={478} stroke="#150f24" stroke-width="7" stroke-linecap="round" opacity="0.5" />
            <line x1={246} y1={244} x2={266} y2={478} stroke="#8d97b0" stroke-width="3.5" stroke-linecap="round" />
            <circle cx={262} cy={458} r={7} fill="#3c4257" />
          </g>
        )}
        {/* one hit target over the whole character */}
        <rect x={-20} y={-10} width={spec.w + 40} height={spec.h} fill="transparent" />
      </g>

      {/* THE EXTREMITY VERDICTS, on the body they are about: a leader, a label, a ring (R17) */}
      {placed.length > 0 && (
        <g className="wibc-callouts-scene" role="list" aria-label="Hands, feet and head, judged separately">
          {placed.map((c) => (
            <g key={c.region} role="listitem" aria-label={`${c.label}: ${c.detail}`}>
              <path
                d={`M ${c.ax.toFixed(1)} ${c.ay.toFixed(1)} L ${(labelRight + 14).toFixed(1)} ${c.ly.toFixed(1)} L ${(labelRight + 6).toFixed(1)} ${c.ly.toFixed(1)}`}
                fill="none"
                stroke={c.verdict === 'fine' ? 'var(--ink-3)' : c.colour}
                stroke-width="1"
                opacity="0.9"
              />
              <circle cx={c.ax} cy={c.ay} r="2.5" fill={c.verdict === 'fine' ? 'var(--ink-3)' : c.colour} />
              <text
                x={labelRight}
                y={c.ly + 4}
                text-anchor="end"
                font-size="12.5"
                font-weight="600"
                fill={c.verdict === 'fine' ? 'var(--ink-2)' : c.colour}
                stroke="#0b0f18"
                stroke-width="4"
                paint-order="stroke"
                stroke-linejoin="round"
              >
                {c.label}
              </text>
              <text x={labelRight} y={c.ly + 18} text-anchor="end" font-size="10.5" fill="var(--ink-3)" stroke="#0b0f18" stroke-width="3" paint-order="stroke">
                {c.detail}
              </text>
            </g>
          ))}
        </g>
      )}

      {live.hearth > 0.01 && (
        <g transform={`translate(${fireX} ${fireY}) scale(${fireScale})`}>
          <Fire uid={uid} lit={target.lit} present={live.hearth} />
        </g>
      )}

      {/* the scene dissolves into the data ground, the whole width; one continuous surface, no seam */}
      <rect x="0" y={h - 30} width={w} height={30} fill={`url(#${uid}-fade)`} />
    </svg>
  );
}
