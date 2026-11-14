/**
 * One sky, evaluated at a time of day.
 *
 * The scene is not five gradients; it is one parameterised sky, so a tab change is a move
 * along a parameter and the transition falls out of it (`VISUAL_ROADMAP.md` R15). The
 * parameter is **sun progress** `p`, cyclic on [0, 2): 0 sunrise, 0.5 noon, 1 sunset, 1.5
 * midnight. The sun's altitude is `sin(p·π)`, and every colour here is keyed by that altitude,
 * with a rising/setting split so that a dawn is colder and greyer than the dusk at the same
 * altitude. The sunset keyframe (altitude 0, setting) is the evening palette exactly as it was
 * signed off; nothing here redesigns it.
 *
 * Everything is a pure function of `p`. Interpolation is in OKLab (`lib/color.ts`).
 */

import { greyHex, keyedHex, mixHex } from '../lib/color.js';

/** The sun's altitude for a progress value, in [-1, 1]. */
export const altitudeOf = (p: number): number => Math.sin(p * Math.PI);

/** Progress wrapped onto [0, 2). */
export const wrapProgress = (p: number): number => ((p % 2) + 2) % 2;

/** The shortest-path lerp between two progress values on the 2-cycle. */
export function lerpProgress(a: number, b: number, u: number): number {
  const d = wrapProgress(b - a);
  const step = d > 1 ? d - 2 : d;
  return wrapProgress(a + step * u);
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the palette comes from the rising set rather than the setting set. 1 through
 * the night's second half and the morning, 0 through the afternoon and the evening, crossing
 * at noon and at midnight where the two sets coincide anyway.
 */
export function risingWeight(p: number): number {
  const q = wrapProgress(p);
  if (q < 0.42) return 1;
  if (q < 0.58) return 1 - smooth(0.42, 0.58, q);
  if (q < 1.42) return 0;
  if (q < 1.58) return smooth(1.42, 1.58, q);
  return 1;
}

/**
 * Where each sky stop sits, as a fraction of the horizon height (0 the zenith, 1 the
 * horizon, beyond 1 the bright band continuing below it to the ground).
 */
export const SKY_STOP_FRACTIONS: readonly number[] = [0, 0.233, 0.467, 0.667, 0.833, 0.967, 1.067, 1.15, 1.25, 1.667];

type Palette = readonly string[];
type Frames = readonly (readonly [number, Palette])[];

const NIGHT: Palette = ['#0b0f18', '#0b1026', '#0c1430', '#0f1a3e', '#122049', '#162752', '#1a2d5a', '#1f3462', '#253b6a', '#253b6a'];
const DUSK: Palette = ['#0b0f18', '#0f1238', '#231a54', '#3a1f5e', '#4f2460', '#672b5a', '#853a52', '#a24e4a', '#c4734b', '#c4734b'];
/** The evening, verbatim. */
const SUNSET: Palette = ['#0b0f18', '#15184a', '#3a1f5e', '#6e2a64', '#a93353', '#d9552f', '#f58b38', '#ffc370', '#ffe0a4', '#ffe0a4'];
const GOLDEN: Palette = ['#0b0f18', '#172658', '#2a4886', '#4b6ea8', '#7b94c0', '#aeb0c2', '#d4b89a', '#edc88e', '#fbdaa4', '#fbdaa4'];
/**
 * The day. Midday has to look like midday: a light blue that is bright where the ridges stand
 * against it, with the zenith a deep blue rather than the ground's black (the one palette
 * whose top is not the data ground; the headline and the conditions line stand on their own
 * dark panel over it).
 */
const MID: Palette = ['#184288', '#2a66b6', '#5c9ad8', '#8bbde8', '#aed3f0', '#c4e0f5', '#d4e9f8', '#e0eff9', '#e9f4fb', '#e9f4fb'];
const HIGH: Palette = ['#1b4a94', '#2e72c2', '#66a6e0', '#93c5ec', '#b4d8f3', '#cae4f7', '#d9ecf9', '#e4f2fb', '#ecf6fc', '#ecf6fc'];
/**
 * The blue hour before sunrise: the deep, cold blue the hiking tab used to wear, which suits
 * a cold early hour better than it suited midday. Black at the zenith, the last stars in it.
 */
const DAWN: Palette = ['#0b0f18', '#0f2c64', '#1b4e9a', '#3072bf', '#5295d3', '#7ab2df', '#9dc8e8', '#bad8ee', '#d0e5f2', '#d0e5f2'];
const SUNRISE: Palette = ['#0b0f18', '#141a4c', '#2b2e6a', '#4a4480', '#705a86', '#9a7282', '#c48e7c', '#e2b088', '#f4d2a4', '#f4d2a4'];
const MORNING_GOLDEN: Palette = ['#0b0f18', '#162458', '#2a4688', '#4a6ca8', '#7a92c0', '#acb0c4', '#d2bca0', '#ecca94', '#f8dcaa', '#f8dcaa'];

const SKY_SETTING: Frames = [
  [-1, NIGHT],
  [-0.4, NIGHT],
  [-0.17, DUSK],
  [0, SUNSET],
  [0.13, GOLDEN],
  [0.5, MID],
  [1, HIGH],
];
const SKY_RISING: Frames = [
  [-1, NIGHT],
  [-0.4, NIGHT],
  [-0.17, DAWN],
  [0, SUNRISE],
  [0.13, MORNING_GOLDEN],
  [0.5, MID],
  [1, HIGH],
];

type Pair = readonly [string, string];
type PairFrames = readonly (readonly [number, readonly Pair[]])[];

/** Ridges far to near, crest then base. The sunset row is the evening verbatim. */
const RIDGES_SETTING: PairFrames = [
  [-1, [['#243356', '#182542'], ['#1b2846', '#121c36'], ['#141d36', '#0e1428'], ['#0f1526', '#0b0f1c']]],
  [-0.4, [['#243356', '#182542'], ['#1b2846', '#121c36'], ['#141d36', '#0e1428'], ['#0f1526', '#0b0f1c']]],
  [-0.17, [['#7a6a9a', '#574a76'], ['#5c4a7a', '#3c3160'], ['#3d2f58', '#261e42'], ['#241d3c', '#141228']]],
  [0, [['#c194b2', '#8e6189'], ['#8c5b86', '#59386a'], ['#55356a', '#2e1f48'], ['#2a1e42', '#15122a']]],
  [0.13, [['#aab4c8', '#7f8ba6'], ['#7f8fac', '#58678a'], ['#56688a', '#394a66'], ['#344360', '#1c2436']]],
  [0.5, [['#6c98bd', '#4b779c'], ['#4d79a0', '#34577a'], ['#375d7d', '#223e58'], ['#27425e', '#142334']]],
  [1, [['#6f9bbf', '#4e7a9e'], ['#4f7ca2', '#36597c'], ['#39607f', '#24405a'], ['#28435f', '#152435']]],
];
const RIDGES_RISING: PairFrames = [
  [-1, [['#243356', '#182542'], ['#1b2846', '#121c36'], ['#141d36', '#0e1428'], ['#0f1526', '#0b0f1c']]],
  [-0.4, [['#243356', '#182542'], ['#1b2846', '#121c36'], ['#141d36', '#0e1428'], ['#0f1526', '#0b0f1c']]],
  [-0.17, [['#8aa6bf', '#5f82a0'], ['#5f82a0', '#426383'], ['#415f7e', '#2b445c'], ['#2a405a', '#172636']]],
  [0, [['#b8a2b6', '#8a7793'], ['#8d7694', '#5f5474'], ['#5e4d6e', '#3a324e'], ['#332c46', '#19182c']]],
  [0.13, [['#aab4c8', '#7f8ba6'], ['#7f8fac', '#58678a'], ['#56688a', '#394a66'], ['#344360', '#1c2436']]],
  [0.5, [['#6c98bd', '#4b779c'], ['#4d79a0', '#34577a'], ['#375d7d', '#223e58'], ['#27425e', '#142334']]],
  [1, [['#6f9bbf', '#4e7a9e'], ['#4f7ca2', '#36597c'], ['#39607f', '#24405a'], ['#28435f', '#152435']]],
];

/** Cloud colour by tier (0 high and dark, 3 low and lit), body then lit side. */
const CLOUDS_SETTING: PairFrames = [
  [-1, [['#101634', '#1a2248'], ['#121a3a', '#20294f'], ['#141c3e', '#263058'], ['#161f42', '#2a355e']]],
  [-0.4, [['#101634', '#1a2248'], ['#121a3a', '#20294f'], ['#141c3e', '#263058'], ['#161f42', '#2a355e']]],
  [-0.17, [['#231a48', '#4c3470'], ['#3a2050', '#7c3f62'], ['#4e2648', '#a0584e'], ['#5a2f48', '#b87050']]],
  [0, [['#2d1a4e', '#6a3f7e'], ['#4a2358', '#c35a76'], ['#7a2f4e', '#f29a58'], ['#8c3a4e', '#f7b36a']]],
  [0.13, [['#6a7aa0', '#d8dde8'], ['#7a88aa', '#e6e4e6'], ['#8a92ae', '#f2e2cc'], ['#9298b2', '#f8e4c6']]],
  [0.5, [['#7f9ab8', '#f4f8fc'], ['#86a0bc', '#f6f9fc'], ['#8ea6c0', '#f8fafc'], ['#92aac2', '#fafcfe']]],
  [1, [['#7f9ab8', '#f4f8fc'], ['#86a0bc', '#f6f9fc'], ['#8ea6c0', '#f8fafc'], ['#92aac2', '#fafcfe']]],
];
const CLOUDS_RISING: PairFrames = [
  [-1, [['#101634', '#1a2248'], ['#121a3a', '#20294f'], ['#141c3e', '#263058'], ['#161f42', '#2a355e']]],
  [-0.4, [['#101634', '#1a2248'], ['#121a3a', '#20294f'], ['#141c3e', '#263058'], ['#161f42', '#2a355e']]],
  [-0.17, [['#3e4f70', '#8c9fbb'], ['#4a5d80', '#a3b4cc'], ['#56698a', '#b6c5d8'], ['#5e7190', '#c4d1e2']]],
  [0, [['#2e2a58', '#6a5a8a'], ['#4c3a68', '#b08090'], ['#6a4a6a', '#e0a080'], ['#785270', '#f0b888']]],
  [0.13, [['#6a7aa0', '#d8dde8'], ['#7a88aa', '#e6e4e6'], ['#8a92ae', '#f2e2cc'], ['#9298b2', '#f8e4c6']]],
  [0.5, [['#7f9ab8', '#f4f8fc'], ['#86a0bc', '#f6f9fc'], ['#8ea6c0', '#f8fafc'], ['#92aac2', '#fafcfe']]],
  [1, [['#7f9ab8', '#f4f8fc'], ['#86a0bc', '#f6f9fc'], ['#8ea6c0', '#f8fafc'], ['#92aac2', '#fafcfe']]],
];

const CONIFER: readonly (readonly [number, string])[] = [
  [-1, '#090c18'],
  [-0.4, '#090c18'],
  [-0.17, '#0f1626'],
  [0, '#140f26'],
  [0.13, '#1a2a30'],
  [0.5, '#15302c'],
  [1, '#15302c'],
];

const GROUND: Frames = [
  [-1, ['#0e1228', '#0c1020', '#0b0f18']],
  [-0.4, ['#0e1228', '#0c1020', '#0b0f18']],
  [-0.17, ['#14102c', '#0e1122', '#0b0f18']],
  [0, ['#171030', '#0f1124', '#0b0f18']],
  [0.13, ['#19222e', '#101822', '#0b0f18']],
  [0.5, ['#17282c', '#0f1a20', '#0b0f18']],
  [1, ['#17282c', '#0f1a20', '#0b0f18']],
];

/** The sun's disc and its glow: amber on the horizon, white and small when high. */
const SUN_DISC: readonly (readonly [number, string])[] = [
  [-0.2, '#ffd9a0'],
  [0, '#fff4cd'],
  [0.3, '#fffbe8'],
  [1, '#ffffff'],
];
const GLOW_CORE: readonly (readonly [number, string])[] = [
  [-0.3, '#ff9a4a'],
  [0, '#fff0c0'],
  [0.4, '#fffaf0'],
  [1, '#ffffff'],
];
const GLOW_MID: readonly (readonly [number, string])[] = [
  [-0.3, '#e0603a'],
  [0, '#ffb55e'],
  [0.4, '#ffe0b0'],
  [1, '#f0f6ff'],
];
const GLOW_OUT: readonly (readonly [number, string])[] = [
  [-0.3, '#b04030'],
  [0, '#ff8a3a'],
  [0.4, '#ffd090'],
  [1, '#dceeff'],
];

function paletteAt(frames: Frames, at: number): string[] {
  const n = frames[0]![1].length;
  const out: string[] = [];
  for (let k = 0; k < n; k++) out.push(keyedHex(frames.map(([a, pal]) => [a, pal[k]!] as const), at));
  return out;
}

function pairsAt(frames: PairFrames, at: number): Pair[] {
  const n = frames[0]![1].length;
  const out: Pair[] = [];
  for (let k = 0; k < n; k++) {
    out.push([
      keyedHex(frames.map(([a, pairs]) => [a, pairs[k]![0]] as const), at),
      keyedHex(frames.map(([a, pairs]) => [a, pairs[k]![1]] as const), at),
    ]);
  }
  return out;
}

const blendPalette = (a: readonly string[], b: readonly string[], u: number): string[] =>
  a.map((c, i) => (u <= 0 ? c : u >= 1 ? b[i]! : keyedHex([[0, c], [1, b[i]!]], u)));
const blendPairs = (a: readonly Pair[], b: readonly Pair[], u: number): Pair[] =>
  a.map((c, i) => [blendPalette([c[0]], [b[i]![0]], u)[0]!, blendPalette([c[1]], [b[i]![1]], u)[0]!]);

export interface SkyFrame {
  readonly altitude: number;
  readonly stops: readonly string[];
  readonly ridges: readonly Pair[];
  readonly cloudTiers: readonly Pair[];
  readonly conifer: string;
  readonly ground: readonly string[];
  readonly sunDisc: string;
  readonly glow: readonly [string, string, string];
  /** 1 for a sunset, 0 once the sun is well up: how much of the disc's glow is drawn. */
  readonly glowStrength: number;
  /** How visible the sun is: 1 above the horizon, fading as it drops behind the ridges. */
  readonly sunVisible: number;
  /** +1 clouds lit from below (low sun), -1 lit from above (high sun), crossing smoothly. */
  readonly cloudLitSign: number;
  /** 0 by day, 1 in full night. */
  readonly dark: number;
  /** The moon and stars' visibility. */
  readonly moonAlpha: number;
  readonly starAlpha: number;
  /** How far the sky has closed over: 0 clear, 1 one grey sheet (`overcastAt`). */
  readonly overcast: number;
  /** The sheet's colour at its top and along its underside. */
  readonly sheet: Pair;
}

export function skyAt(p: number): SkyFrame {
  const a = altitudeOf(p);
  const r = risingWeight(p);
  const stops = blendPalette(paletteAt(SKY_SETTING, a), paletteAt(SKY_RISING, a), r);
  const ridges = blendPairs(pairsAt(RIDGES_SETTING, a), pairsAt(RIDGES_RISING, a), r);
  const cloudTiers = blendPairs(pairsAt(CLOUDS_SETTING, a), pairsAt(CLOUDS_RISING, a), r);
  const dark = 1 - smooth(-0.45, -0.12, a);
  return {
    altitude: a,
    stops,
    ridges,
    cloudTiers,
    conifer: keyedHex(CONIFER, a),
    ground: paletteAt(GROUND, a),
    sunDisc: keyedHex(SUN_DISC, a),
    glow: [keyedHex(GLOW_CORE, a), keyedHex(GLOW_MID, a), keyedHex(GLOW_OUT, a)],
    glowStrength: 1 - 0.55 * smooth(0.05, 0.6, a),
    sunVisible: smooth(-0.1, 0.02, a),
    cloudLitSign: 1 - 2 * smooth(0.08, 0.38, a),
    dark,
    // out once the sun is well under: the moon from 0.08 below the horizon, the stars a little later
    moonAlpha: smooth(0.08, 0.3, -a) * 0.95,
    starAlpha: smooth(0.08, 0.42, -a),
    overcast: 0,
    sheet: SHEET_NIGHT,
  };
}

/*
 * THE OVERCAST. "It rained today" closes the sky: the cloud bands grow, grey and merge under
 * one sheet, and everything else keeps its shape with the colour drained out of it. Keyed by
 * the sun's altitude only through `light`, so the same overcast is a pale grey at midday, a
 * dim one at dusk and a near-black lid at night. The value structure survives it: the sheet
 * is darkest at its top and the band of sky under it stays the brightest thing.
 */
const OVERCAST_DAY: Palette = ['#3a414c', '#4a525e', '#5a6370', '#6b7582', '#7d8794', '#8e98a4', '#9ca6b1', '#a8b1bb', '#b3bcc5', '#b3bcc5'];
const OVERCAST_NIGHT: Palette = ['#0b0f18', '#0f131b', '#13181f', '#171c24', '#1b212a', '#1f2630', '#242b35', '#28303a', '#2c343f', '#2c343f'];
const SHEET_DAY: Pair = ['#434a55', '#6e7885'];
const SHEET_NIGHT: Pair = ['#0c1017', '#1b212b'];
const OVERCAST_CLOUD_DAY: Pair = ['#687280', '#98a1ad'];
const OVERCAST_CLOUD_NIGHT: Pair = ['#151a22', '#242b35'];

/** `frame` with the sky closed over by `u` in [0, 1]. */
export function overcastAt(frame: SkyFrame, u: number): SkyFrame {
  if (u <= 0.001) return frame;
  const light = smooth(-0.45, 0.3, frame.altitude);
  const ramp = OVERCAST_DAY.map((c, i) => mixHex(OVERCAST_NIGHT[i]!, c, light));
  const cloud: Pair = [mixHex(OVERCAST_CLOUD_NIGHT[0], OVERCAST_CLOUD_DAY[0], light), mixHex(OVERCAST_CLOUD_NIGHT[1], OVERCAST_CLOUD_DAY[1], light)];
  const k = 0.9 * u;
  return {
    ...frame,
    stops: frame.stops.map((c, i) => mixHex(c, ramp[i]!, k)),
    // the far ridges lift into the haze a little; the near ones only lose their colour
    ridges: frame.ridges.map(([crest, base], i) => [greyHex(crest, 0.85 * u, (0.035 * u * (3 - i)) / 3), greyHex(base, 0.85 * u, (0.02 * u * (3 - i)) / 3)]),
    cloudTiers: frame.cloudTiers.map(([body, lit]) => [mixHex(body, cloud[0], k), mixHex(lit, cloud[1], k)]),
    conifer: greyHex(frame.conifer, 0.5 * u),
    ground: frame.ground.map((c) => greyHex(c, 0.5 * u)),
    glowStrength: frame.glowStrength * (1 - 0.8 * u),
    sunVisible: frame.sunVisible * (1 - 0.92 * u),
    cloudLitSign: frame.cloudLitSign * (1 - 0.7 * u),
    moonAlpha: frame.moonAlpha * (1 - 0.9 * u),
    starAlpha: frame.starAlpha * (1 - 0.95 * u),
    overcast: u,
    sheet: [mixHex(SHEET_NIGHT[0], SHEET_DAY[0], light), mixHex(SHEET_NIGHT[1], SHEET_DAY[1], light)],
  };
}

/**
 * A fixed star field: deterministic positions from a tiny hash, as fractions of the sky's
 * width and horizon height. The scene rotates the whole field about a point above the stage
 * as the night goes on, so the stars turn into place rather than switching on.
 */
export const STARS: readonly { readonly x: number; readonly y: number; readonly r: number; readonly a: number }[] = (() => {
  const out: { x: number; y: number; r: number; a: number }[] = [];
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 90; i++) {
    const x = next();
    const y = next() * 1.15;
    const r = 0.5 + next() * 1.3;
    const a = 0.35 + next() * 0.6;
    out.push({ x, y, r, a });
  }
  return out;
})();
