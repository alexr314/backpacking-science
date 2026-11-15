/**
 * The character.
 *
 * Drawn in a fixed local coordinate system per pose and placed by whoever mounts it, so the
 * geometry below never has to think about the viewport. Four poses: `standing` for the gear
 * tab, where the anatomy has to be readable while garments are chosen; `seated` for camp and
 * the lunch stop; `walking` for the trail; `lying` (the standing figure on its side) for the
 * bag. All four share one topology so a scene can morph between them (see `PoseGeometry`).
 * Two views: `split` (`SPEC.md` §4's split made literal, inner layers
 * clipped to the left half and outer layers to the right, with a hairline down the centre)
 * and `dressed`, the character as a scene would actually see them, outer stack over inner.
 * Both take an *outfit* (`Outfit` in `model/kit.ts`): one configuration, never the whole
 * inventory. The gear tab hands it the warmest outfit the engine built, or a hovered preview.
 *
 * Every part is one path plus a base stroke width: closed paths are silhouettes, two-point
 * paths are round-capped limbs. A garment with no art of its own is that same path drawn
 * fatter. A garment in `GARMENT_ART` instead contributes *pieces* read off the pose at draw
 * time (a trunk at its loft, sleeves to a given length, a boot's collar up the shin) plus flat
 * detail over them, so a tee leaves the forearm bare, a puffy is literally more loft than a
 * wind shirt and shows its baffles, and a beanie is a beanie, not a tinted head. The halo, the
 * rim light and the hover ring are built from the same pieces, so they hug whatever is worn.
 *
 * The head and the hands have only an outer slot, so they are never split: the divide starts
 * at the neck, and their garments draw whole in both views.
 */

import type { JSX } from 'preact';
import type { Garment } from '@will-i-be-cold/heat';
import { garmentById, layerRank, slotFor, slotsOf, type Outfit, type Region, type Slot } from '../model/kit.js';

export type FigureView = 'split' | 'dressed';

interface Part {
  readonly d: string;
  /** Base stroke width at skin level: a few units for silhouettes, a limb's girth for capsules. */
  readonly w: number;
  /** A closed path is filled as well as stroked; an open one is a round-capped capsule. */
  readonly closed: boolean;
  /** A capsule's ends are round unless it is a band cut square across a limb (a cuff, a boot's collar). */
  readonly cap?: 'butt';
}

/**
 * ONE TOPOLOGY FOR EVERY POSE. A pose is a set of numbers, not a set of path strings: each
 * region has a fixed list of parts, each part is either a closed `blob` (a run of cubic
 * segments) or an open `line` (a round-capped polyline), and every pose has the same parts
 * with the same number of segments or points. That is what makes a pose morph a lerp of two
 * number lists rather than a special case per pair, which is the same reason the flame's
 * keyframes share ten control points (`Fire.tsx`).
 *
 * The shapes are still *written* as path strings, because that is how they were drawn and
 * signed off; `parsePath` turns them into segment lists and `matchTopology` subdivides the
 * shorter blob of any pair until the counts agree, so the seated and standing figures keep
 * their exact silhouettes and still correspond point for point.
 */
export interface BlobPart {
  readonly kind: 'blob';
  /** `x0 y0` then `c1x c1y c2x c2y px py` per segment; the last segment lands on the start. */
  readonly pts: readonly number[];
  readonly w: number;
}

export interface LinePart {
  readonly kind: 'line';
  /** `x y` pairs. */
  readonly pts: readonly number[];
  readonly w: number;
}

export type GeomPart = BlobPart | LinePart;

export interface PoseGeometry {
  readonly w: number;
  readonly h: number;
  readonly body: Readonly<Record<Region, readonly GeomPart[]>>;
  readonly anchors: Readonly<Record<Region, Readonly<Record<Slot, readonly [number, number]>>>>;
  readonly headTop: readonly [number, number];
  readonly ankles: readonly { readonly x: number; readonly y: number; readonly hw: number; readonly rise: number }[];
  readonly neckY: number;
  /** Where a trekking pole is held, when this pose holds one. The scene hangs the pole off it. */
  readonly grip?: readonly [number, number];
  /** Where the pack rides, when the pose wants it somewhere other than square on the back. */
  readonly pack?: { readonly x: number; readonly kx: number; readonly deg: number };
}

/** A pose as a scene or the gear tab sees it: geometry plus the few things that are not numbers. */
export interface PoseSpec {
  readonly w: number;
  readonly h: number;
  readonly body: Readonly<Record<Region, readonly Part[]>>;
  /**
   * Where a callout's leader line lands, per region and slot, in local coordinates. Inner
   * anchors sit on the left half (next to skin), outer on the right (layered on top), so the
   * callout columns on the gear tab read the same way the split figure does.
   */
  readonly anchors: PoseGeometry['anchors'];
  /** The crown of the skull, where headwear art is placed from. */
  readonly headTop: readonly [number, number];
  /**
   * One per foot, in `body.feet` order: where the leg meets the foot, the half-width of a sock
   * cuff there, and how far up the leg a cuff of ordinary height reaches in this pose.
   */
  readonly ankles: PoseGeometry['ankles'];
  /** Where a trekking pole is held, when this pose holds one. */
  readonly grip?: readonly [number, number];
  /** Where the pack rides, when the pose wants it somewhere other than square on the back. */
  readonly pack?: { readonly x: number; readonly kx: number; readonly deg: number };
  /** Where the neck meets the torso: the split view's divide starts here, so the head stays whole. */
  readonly neckY: number;
  /** Whether a sock's cuff shows above the shoe. Seated, the ankle is tucked and it reads wrong. */
  readonly sockCuff: boolean;
  /** Draws whatever the figure rests on (the ground shadow) under everything. */
  readonly prop: JSX.Element | null;
  readonly geometry: PoseGeometry;
}

/** The subset of SVG path grammar the figure is drawn in: M, L/l, C/c, Z. */
function parsePath(d: string): { closed: boolean; start: readonly [number, number]; segs: number[][]; line: number[] } {
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+/g) ?? [];
  let cmd = '';
  let i = 0;
  let x = 0;
  let y = 0;
  let start: readonly [number, number] = [0, 0];
  const segs: number[][] = [];
  const line: number[] = [];
  let closed = false;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') closed = true;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const base: readonly [number, number] = rel ? [x, y] : [0, 0];
    if (cmd === 'M' || cmd === 'm') {
      x = base[0] + num();
      y = base[1] + num();
      start = [x, y];
      line.push(x, y);
      cmd = rel ? 'l' : 'L';
    } else if (cmd === 'L' || cmd === 'l') {
      const nx = base[0] + num();
      const ny = base[1] + num();
      segs.push([x + (nx - x) / 3, y + (ny - y) / 3, x + (2 * (nx - x)) / 3, y + (2 * (ny - y)) / 3, nx, ny]);
      line.push(nx, ny);
      x = nx;
      y = ny;
    } else if (cmd === 'C' || cmd === 'c') {
      const c1x = base[0] + num();
      const c1y = base[1] + num();
      const c2x = base[0] + num();
      const c2y = base[1] + num();
      const nx = base[0] + num();
      const ny = base[1] + num();
      segs.push([c1x, c1y, c2x, c2y, nx, ny]);
      x = nx;
      y = ny;
    } else {
      throw new Error(`Unsupported path command "${cmd}" in "${d}".`);
    }
  }
  return { closed, start, segs, line };
}

function blob(d: string, w: number): BlobPart {
  const p = parsePath(d);
  if (!p.closed) throw new Error(`A blob must be a closed path: "${d}".`);
  const segs = [...p.segs];
  const last = segs[segs.length - 1];
  // close back onto the start point if the path did not land there itself
  if (last !== undefined && (Math.abs(last[4]! - p.start[0]) > 0.01 || Math.abs(last[5]! - p.start[1]) > 0.01)) {
    const [lx, ly] = [last[4]!, last[5]!];
    const [sx, sy] = p.start;
    segs.push([lx + (sx - lx) / 3, ly + (sy - ly) / 3, lx + (2 * (sx - lx)) / 3, ly + (2 * (sy - ly)) / 3, sx, sy]);
  }
  return { kind: 'blob', pts: [p.start[0], p.start[1], ...segs.flat()], w };
}

function line(d: string, w: number): LinePart {
  const p = parsePath(d);
  return { kind: 'line', pts: p.line, w };
}

/** The chord length of segment `k` of a blob, as a cheap "which segment is longest". */
function chord(pts: readonly number[], k: number): number {
  const [px, py] = k === 0 ? [pts[0]!, pts[1]!] : [pts[2 + (k - 1) * 6 + 4]!, pts[2 + (k - 1) * 6 + 5]!];
  const qx = pts[2 + k * 6 + 4]!;
  const qy = pts[2 + k * 6 + 5]!;
  return Math.hypot(qx - px, qy - py);
}

/** Split the longest segment at its midpoint (de Casteljau) until the blob has `n` segments. */
function subdivide(part: BlobPart, n: number): BlobPart {
  let pts = [...part.pts];
  while ((pts.length - 2) / 6 < n) {
    const count = (pts.length - 2) / 6;
    let k = 0;
    let best = -1;
    for (let j = 0; j < count; j++) {
      const c = chord(pts, j);
      if (c > best) {
        best = c;
        k = j;
      }
    }
    const o = 2 + k * 6;
    const [p0x, p0y] = k === 0 ? [pts[0]!, pts[1]!] : [pts[o - 2]!, pts[o - 1]!];
    const [c1x, c1y, c2x, c2y, p1x, p1y] = [pts[o]!, pts[o + 1]!, pts[o + 2]!, pts[o + 3]!, pts[o + 4]!, pts[o + 5]!];
    const m = (a: number, b: number): number => (a + b) / 2;
    const ax = m(p0x, c1x);
    const ay = m(p0y, c1y);
    const bx = m(c1x, c2x);
    const by = m(c1y, c2y);
    const cx = m(c2x, p1x);
    const cy = m(c2y, p1y);
    const dx = m(ax, bx);
    const dy = m(ay, by);
    const ex = m(bx, cx);
    const ey = m(by, cy);
    const fx = m(dx, ex);
    const fy = m(dy, ey);
    pts = [...pts.slice(0, o), ax, ay, dx, dy, fx, fy, ex, ey, cx, cy, p1x, p1y, ...pts.slice(o + 6)];
  }
  return { ...part, pts };
}

const REGION_LIST: readonly Region[] = ['head', 'torso', 'legs', 'hands', 'feet'];

/** Give every pose the same segment count per blob, so any pair of them can be lerped. */
function matchTopology(poses: Readonly<Record<string, PoseGeometry>>): Record<string, PoseGeometry> {
  const names = Object.keys(poses);
  const out: Record<string, PoseGeometry> = {};
  for (const name of names) out[name] = poses[name]!;
  for (const r of REGION_LIST) {
    const counts = names.map((n) => poses[n]!.body[r].length);
    if (new Set(counts).size !== 1) throw new Error(`Poses disagree on the number of ${r} parts.`);
    for (let k = 0; k < counts[0]!; k++) {
      const kinds = new Set(names.map((n) => poses[n]!.body[r][k]!.kind));
      if (kinds.size !== 1) throw new Error(`Poses disagree on the kind of ${r} part ${k}.`);
      if (kinds.has('line')) {
        const lens = new Set(names.map((n) => poses[n]!.body[r][k]!.pts.length));
        if (lens.size !== 1) throw new Error(`Poses disagree on the points of ${r} line ${k}.`);
        continue;
      }
      const n = Math.max(...names.map((m) => (poses[m]!.body[r][k]!.pts.length - 2) / 6));
      for (const m of names) {
        const g = out[m]!;
        const parts = [...g.body[r]];
        parts[k] = subdivide(parts[k] as BlobPart, n);
        out[m] = { ...g, body: { ...g.body, [r]: parts } };
      }
    }
  }
  return out;
}

const SEATED_GEOMETRY: PoseGeometry = {
  w: 300,
  h: 380,
  body: {
    head: [
      blob('M150 24 c18 0 28 13 28 32 c0 21 -11 36 -28 36 c-17 0 -28 -15 -28 -36 c0 -19 10 -32 28 -32 Z', 4),
      line('M150 86 L 150 93 L 150 100', 22),
    ],
    torso: [
      blob(
        'M150 94 c27 0 45 10 51 26 l7 50 c3 20 -2 32 -8 36 c-11 7 -30 10 -50 10 c-20 0 -39 -3 -50 -10 ' +
          'c-6 -4 -11 -16 -8 -36 l7 -50 c6 -16 24 -26 51 -26 Z',
        5,
      ),
      line('M107 112 L 90 172 L 102 212', 22),
      line('M193 112 L 210 172 L 198 212', 22),
    ],
    legs: [
      // thighs out to the knees, shins down to the ankles on the log: the lap, as two capsules
      line('M136 206 L 86 234 L 86 258', 30),
      line('M164 206 L 214 234 L 214 258', 30),
      blob('M150 200 c24 0 36 9 36 20 c0 10 -12 16 -36 16 c-24 0 -36 -6 -36 -16 c0 -11 12 -20 36 -20 Z', 5),
    ],
    hands: [
      blob('M102 218 c11 -1 18 6 18 14 c0 9 -8 15 -19 15 c-11 0 -19 -6 -19 -14 c0 -8 9 -14 20 -15 Z', 4),
      blob('M198 218 c-11 -1 -18 6 -18 14 c0 9 8 15 19 15 c11 0 19 -6 19 -14 c0 -8 -9 -14 -20 -15 Z', 4),
    ],
    feet: [
      blob('M84 266 c13 -4 24 1 26 9 c2 8 -8 15 -23 16 c-15 1 -25 -3 -25 -10 c0 -7 9 -12 22 -15 Z', 4),
      blob('M216 266 c-13 -4 -24 1 -26 9 c-2 8 8 15 23 16 c15 1 25 -3 25 -10 c0 -7 -9 -12 -22 -15 Z', 4),
    ],
  },
  anchors: {
    head: { inner: [128, 52], outer: [176, 52] },
    torso: { inner: [118, 150], outer: [184, 150] },
    legs: { inner: [100, 228], outer: [200, 228] },
    hands: { inner: [101, 232], outer: [199, 232] },
    feet: { inner: [86, 278], outer: [214, 278] },
  },
  headTop: [150, 24],
  ankles: [
    { x: 85, y: 265, hw: 15, rise: 22 },
    { x: 215, y: 265, hw: 15, rise: 22 },
  ],
  neckY: 98,
};

/**
 * Standing, arms a little out from the sides so each limb is its own readable shape, feet
 * planted. The same proportions as the seated figure, unfolded.
 */
const STANDING_GEOMETRY: PoseGeometry = {
  w: 300,
  h: 500,
  body: {
    head: [
      blob('M150 22 c18 0 28 13 28 32 c0 21 -11 36 -28 36 c-17 0 -28 -15 -28 -36 c0 -19 10 -32 28 -32 Z', 4),
      line('M150 84 L 150 93 L 150 102', 22),
    ],
    torso: [
      blob(
        'M150 96 c30 0 50 10 55 28 l4 46 c2 16 -3 28 -8 34 l-7 48 c-9 7 -25 10 -44 10 ' +
          'c-19 0 -35 -3 -44 -10 l-7 -48 c-5 -6 -10 -18 -8 -34 l4 -46 c5 -18 25 -28 55 -28 Z',
        5,
      ),
      line('M103 118 L 88 200 L 84 262', 22),
      line('M197 118 L 212 200 L 216 262', 22),
    ],
    legs: [
      line('M130 252 L 124 352 L 121 448', 30),
      line('M170 252 L 176 352 L 179 448', 30),
      // the seat joins the two legs to the torso's hem so no skin gap opens between them
      blob('M150 246 c16 0 24 6 24 14 c0 6 -8 10 -24 10 c-16 0 -24 -4 -24 -10 c0 -8 8 -14 24 -14 Z', 5),
    ],
    hands: [
      blob('M84 268 c10 -1 17 6 17 15 c0 9 -8 16 -18 16 c-10 0 -18 -7 -18 -16 c0 -9 8 -15 19 -15 Z', 4),
      blob('M216 268 c-10 -1 -17 6 -17 15 c0 9 8 16 18 16 c10 0 18 -7 18 -16 c0 -9 -8 -15 -19 -15 Z', 4),
    ],
    feet: [
      blob('M121 458 c-16 -1 -30 5 -32 13 c-1 7 10 11 26 11 c13 0 22 -3 24 -9 l2 -14 Z', 4),
      blob('M179 458 c16 -1 30 5 32 13 c1 7 -10 11 -26 11 c-13 0 -22 -3 -24 -9 l-2 -14 Z', 4),
    ],
  },
  anchors: {
    head: { inner: [130, 48], outer: [172, 48] },
    torso: { inner: [120, 170], outer: [182, 170] },
    legs: { inner: [125, 340], outer: [176, 340] },
    hands: { inner: [83, 284], outer: [217, 284] },
    feet: { inner: [106, 474], outer: [194, 474] },
  },
  headTop: [150, 22],
  ankles: [
    { x: 121, y: 461, hw: 20, rise: 26 },
    { x: 179, y: 461, hw: 20, rise: 26 },
  ],
  neckY: 100,
};

/**
 * Mid-stride: the standing figure with one leg planted ahead and the other trailing on its
 * toe, the arms swung against them, and a lean into the hill. The pack and the trekking pole
 * are the scene's, drawn in this frame.
 */
const WALKING_GEOMETRY: PoseGeometry = {
  ...STANDING_GEOMETRY,
  body: {
    ...STANDING_GEOMETRY.body,
    torso: [
      STANDING_GEOMETRY.body.torso[0]!,
      line('M103 118 L 80 190 L 96 252', 22),
      line('M197 118 L 222 184 L 244 232', 22),
    ],
    legs: [
      line('M130 252 L 102 346 L 92 446', 30),
      line('M170 252 L 196 338 L 212 426', 30),
      STANDING_GEOMETRY.body.legs[2]!,
    ],
    hands: [
      blob('M96 258 c10 -1 17 6 17 15 c0 9 -8 16 -18 16 c-10 0 -18 -7 -18 -16 c0 -9 8 -15 19 -15 Z', 4),
      blob('M244 238 c-10 -1 -17 6 -17 15 c0 9 8 16 18 16 c10 0 18 -7 18 -16 c0 -9 -8 -15 -19 -15 Z', 4),
    ],
    feet: [
      blob('M92 456 c-16 -1 -30 5 -32 13 c-1 7 10 11 26 11 c13 0 22 -3 24 -9 l2 -14 Z', 4),
      // the trailing foot, heel lifted: the same shape pitched onto its toe
      blob('M212 436 c16 -4 30 2 34 11 c2 7 -8 13 -24 12 c-13 -1 -22 -5 -23 -11 l-1 -13 Z', 4),
    ],
  },
  anchors: {
    ...STANDING_GEOMETRY.anchors,
    hands: { inner: [95, 274], outer: [245, 254] },
    feet: { inner: [78, 472], outer: [226, 452] },
  },
  ankles: [
    { x: 92, y: 459, hw: 20, rise: 26 },
    { x: 212, y: 438, hw: 20, rise: 26 },
  ],
};

/**
 * Rigid transform of a part's control points: rotate `deg` about `(ax, ay)`, then translate.
 * Poses that are variations of another are built with this rather than drawn fresh, which keeps
 * the topology identical for free: the same parts, the same segment counts, the same order.
 */
interface Rigid {
  readonly dx?: number;
  readonly dy?: number;
  /** Clockwise, SVG's sense, applied about `(ax, ay)` after the scale. */
  readonly deg?: number;
  /** Scale about `(ax, ay)`: `kx` under 1 is what turns a front-on part edge-on. */
  readonly kx?: number;
  readonly ky?: number;
  readonly ax?: number;
  readonly ay?: number;
}

function rigid(x: number, y: number, o: Rigid): [number, number] {
  const { dx = 0, dy = 0, deg = 0, kx = 1, ky = 1, ax = 0, ay = 0 } = o;
  const px = (x - ax) * kx;
  const py = (y - ay) * ky;
  if (deg === 0) return [ax + px + dx, ay + py + dy];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  return [ax + px * c - py * sn + dx, ay + px * sn + py * c + dy];
}

/** The same rigid transform on every control point of a part: blobs and polylines alike are pairs. */
function xform<T extends GeomPart>(part: T, o: Rigid): T {
  const pts: number[] = [];
  for (let i = 0; i < part.pts.length; i += 2) {
    const [x, y] = rigid(part.pts[i]!, part.pts[i + 1]!, o);
    pts.push(x, y);
  }
  return { ...part, pts };
}

/** A limb straight from its joints, so a pose can be written as positions rather than a path string. */
const poly = (pts: readonly (readonly [number, number])[], w: number): LinePart => ({
  kind: 'line',
  pts: pts.flatMap(([x, y]) => [x, y]),
  w,
});

/** The centre of a part, for placing a hand or a foot at a joint rather than by eye. */
function centreOf(part: GeomPart): [number, number] {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (let i = 0; i < part.pts.length; i += 2) {
    lo = [Math.min(lo[0]!, part.pts[i]!), Math.min(lo[1]!, part.pts[i + 1]!)];
    hi = [Math.max(hi[0]!, part.pts[i]!), Math.max(hi[1]!, part.pts[i + 1]!)];
  }
  return [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2];
}

/** Put a blob's centre at a point. */
function centreAt(part: BlobPart, x: number, y: number): BlobPart {
  const [cx, cy] = centreOf(part);
  return xform(part, { dx: x - cx, dy: y - cy });
}

const matched = matchTopology({
  seated: SEATED_GEOMETRY,
  standing: STANDING_GEOMETRY,
  walking: WALKING_GEOMETRY,
});

export type Pose = 'standing' | 'seated' | 'walking' | 'lying';

/**
 * Lying in the bag is the standing geometry turned on its side by whoever mounts it (the
 * scene rotates the group), so a morph into the bag is the stand-up morph plus a rotation.
 */
export const GEOMETRY: Readonly<Record<Pose, PoseGeometry>> = {
  seated: matched['seated']!,
  standing: matched['standing']!,
  walking: matched['walking']!,
  lying: matched['standing']!,
};


/**
 * The drawn extents of a pose, in the scene's own sense: the points rotated by the lean the
 * scene will apply, each expanded by half its stroke, because a limb is a capsule of width `w`
 * about its centreline and the ink reaches `w / 2` past the points.
 *
 * This exists so the scene can stand a pose on the ground by measuring it rather than by a
 * constant per pose picked by eye. Those constants had drifted: the seated figure floated, the
 * walker's boots cut below the ground line and the sleeper sat above it, so the one plane every
 * pose shares was the one thing the scene did not actually share.
 */
export function extentsOf(g: PoseGeometry, deg = 0): { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const region of REGION_LIST) {
    for (const part of g.body[region]) {
      const h = part.w / 2;
      for (let i = 0; i < part.pts.length; i += 2) {
        const x = part.pts[i]!;
        const y = part.pts[i + 1]!;
        const rx = x * c - y * sn;
        const ry = x * sn + y * c;
        if (rx - h < minX) minX = rx - h;
        if (rx + h > maxX) maxX = rx + h;
        if (ry - h < minY) minY = ry - h;
        if (ry + h > maxY) maxY = ry + h;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------------------------
// The walk, in profile
// ---------------------------------------------------------------------------------------------

/**
 * THE HIKER WALKS, AND THE WALK IS COMPUTED RATHER THAN DRAWN.
 *
 * The trail pose was a single mid-stride snapshot, drawn front-on. This is the cycle, and the
 * figure is turned side-on for it (the trunk, hips and head scaled edge-on about the spine), for
 * the reason the client gave: in profile there is a direction of travel, which is what makes a
 * walk read as going somewhere rather than marching on the spot.
 *
 * It is built from joint ANGLES, not from keyframe positions, and that choice is the whole
 * point. Interpolating positions is what made every other transition in this scene stretch and
 * shrink its limbs: a knee lerped between two places cuts the chord, so the thigh it belongs to
 * gets shorter on the way. Here the thigh is 100 units long at every phase of the cycle because
 * it is placed by `hip + L * (sin t, cos t)` and `L` is a constant. A bone cannot change length
 * if its length is never interpolated.
 *
 * The bob falls out of the same construction. The hip sits at a fixed local point, so the foot
 * is further below it at mid-stance (the leg vertical) than at contact (the legs splayed), and
 * since the scene stands a pose by its lowest ink, the body is lifted at mid-stance and dropped
 * at contact. The rise and fall is the geometry being honest, not a sine added on top.
 */

/** The spine's x in the figure's own frame: both hips and both shoulders sit on it, side-on. */
const SPINE_X = 150;
const HIP_Y = 252;
const SHOULDER_Y = 118;
/** Bone lengths, read off the standing figure so the walker is the same person. */
const THIGH = 100;
const SHIN = 96;
const UPPER_ARM = 83;
const FOREARM = 62;

/** How far the thigh swings from vertical, and how far the knee folds through the swing. */
const THIGH_SWING = 26;
const KNEE_FOLD = 62;
/** Knees are never locked, even at stance. */
const KNEE_REST = 5;
/** The arms swing against the legs, and the elbow keeps a little bend. */
const ARM_SWING = 19;
const ELBOW_BEND = 20;
/** The foot pitches up at heel strike and down at toe off. */
const FOOT_PITCH = 17;
/** The trunk leans into the hill and the pack. */
const TRUNK_LEAN = 7;
/** How far the body is squashed edge-on: the trunk and hips more than the head. */
const PROFILE_KX = 0.62;
const HEAD_KX = 0.82;

const rad = (deg: number): number => (deg * Math.PI) / 180;
/** A joint placed from its parent by a length and an angle off vertical, `+` leaning forward. */
const joint = (x: number, y: number, len: number, deg: number): [number, number] => [x + len * Math.sin(rad(deg)), y + len * Math.cos(rad(deg))];

/** One leg's thigh, shin and foot angles at a phase. `phase` runs 0 to 1 over a full stride. */
function legAt(phase: number): { knee: [number, number]; ankle: [number, number]; thigh: number; shin: number; foot: number } {
  const t = phase * 2 * Math.PI;
  const thigh = THIGH_SWING * Math.cos(t);
  // the knee folds through the swing and is quietest under the body at stance
  const fold = KNEE_REST + KNEE_FOLD * Math.max(0, -Math.sin(t - 0.6));
  const shin = thigh - fold;
  const knee = joint(SPINE_X, HIP_Y, THIGH, thigh);
  const ankle = joint(knee[0], knee[1], SHIN, shin);
  return { knee, ankle, thigh, shin, foot: -FOOT_PITCH * Math.cos(t) };
}

/** One arm, swung against the leg of the same side. */
function armAt(phase: number): { elbow: [number, number]; wrist: [number, number] } {
  const t = phase * 2 * Math.PI;
  const upper = ARM_SWING * Math.cos(t);
  const bend = ELBOW_BEND * (1 + Math.max(0, Math.cos(t))) * 0.6;
  const elbow = joint(SPINE_X, SHOULDER_Y, UPPER_ARM, upper);
  // the forearm hinges FORWARD off the elbow, which is what puts the elbow behind the hand.
  // Subtracting the bend instead swung the forearm back and left the elbow leading the arm
  // down the trail, which is not a joint people have.
  const wrist = joint(elbow[0], elbow[1], FOREARM, upper + bend);
  return { elbow, wrist };
}

/**
 * The walker at a point in its stride, in the matched topology so it drops straight into the
 * scene. `phase` is 0 to 1 and wraps; the far side of the body runs half a stride behind the
 * near side, and each arm runs opposite the leg it shares a hip with.
 */
export function walkCycleAt(phase: number): PoseGeometry {
  const base = GEOMETRY.walking;
  const spine: Rigid = { kx: PROFILE_KX, ax: SPINE_X, ay: HIP_Y };
  const lean: Rigid = { deg: TRUNK_LEAN, ax: SPINE_X, ay: HIP_Y };
  const edgeOn = <T extends GeomPart>(part: T, kx = PROFILE_KX): T => xform(xform(part, { ...spine, kx }), lean);

  const near = legAt(phase);
  const far = legAt(phase + 0.5);
  const nearArm = armAt(phase + 0.5);
  const farArm = armAt(phase);
  // the trunk carries the shoulders, so the arms are written in the leaned frame too
  const sh = rigid(SPINE_X, SHOULDER_Y, lean);
  const leaned = ([x, y]: [number, number]): [number, number] => rigid(x, y, lean);

  const arm = (a: { elbow: [number, number]; wrist: [number, number] }): LinePart => poly([sh, leaned(a.elbow), leaned(a.wrist)], 22);
  const leg = (l: ReturnType<typeof legAt>): LinePart => poly([[SPINE_X, HIP_Y], l.knee, l.ankle], 30);
  const foot = (l: ReturnType<typeof legAt>, blob: BlobPart): BlobPart => {
    const [cx, cy] = centreOf(blob);
    const [ax, ay] = l.ankle;
    return xform(xform(blob, { dx: ax - cx + 6, dy: ay - cy + 14 }), { deg: l.foot, ax, ay: ay + 14 });
  };
  const hand = (a: { wrist: [number, number] }, blob: BlobPart): BlobPart => {
    const [wx, wy] = leaned(a.wrist);
    return centreAt(blob, wx, wy + 8);
  };

  return {
    w: base.w,
    h: base.h,
    body: {
      head: [edgeOn(base.body.head[0]!, HEAD_KX), poly([leaned([SPINE_X, 84]), leaned([SPINE_X, 93]), leaned([SPINE_X, 102])], 22)],
      // the far arm first, so it sits behind the near one
      torso: [edgeOn(base.body.torso[0]!), arm(farArm), arm(nearArm)],
      // the far leg first, for the same reason
      legs: [leg(far), leg(near), edgeOn(base.body.legs[2]!)],
      hands: [hand(farArm, base.body.hands[0]! as BlobPart), hand(nearArm, base.body.hands[1]! as BlobPart)],
      feet: [foot(far, base.body.feet[0]! as BlobPart), foot(near, base.body.feet[1]! as BlobPart)],
    },
    anchors: {
      head: { inner: [SPINE_X - 34, 52], outer: [SPINE_X + 30, 52] },
      torso: { inner: [SPINE_X - 30, 170], outer: [SPINE_X + 34, 170] },
      legs: { inner: [near.knee[0] - 26, near.knee[1]], outer: [near.knee[0] + 26, near.knee[1]] },
      hands: { inner: [leaned(nearArm.wrist)[0] - 24, leaned(nearArm.wrist)[1]], outer: [leaned(nearArm.wrist)[0] + 24, leaned(nearArm.wrist)[1]] },
      feet: { inner: [near.ankle[0] - 26, near.ankle[1] + 16], outer: [near.ankle[0] + 26, near.ankle[1] + 16] },
    },
    headTop: rigid(SPINE_X, 22, lean),
    ankles: [
      { x: far.ankle[0], y: far.ankle[1] + 2, hw: 18, rise: 26 },
      { x: near.ankle[0], y: near.ankle[1] + 2, hw: 18, rise: 26 },
    ],
    neckY: rigid(SPINE_X, 100, lean)[1],
    /**
     * Side-on the pack is behind him, not wrapped around him. Left at the front-on figure's
     * width it straddled the narrowed trunk and showed past both shoulders, which reads as a
     * pack worn on the wrong side as much as on both.
     */
    pack: { x: SPINE_X - 30, kx: 0.5, deg: TRUNK_LEAN },
    grip: ((): readonly [number, number] => {
      const [wx, wy] = leaned(nearArm.wrist);
      return [wx, wy + 8];
    })(),
  };
}

/** A full stride, in seconds. Loaded, on a climb, unhurried: the first pass at half this read as a trot. */
export const STRIDE_SECONDS = 1.84;

/** Non-numeric pose facts, by pose. */
const POSE_FACTS: Readonly<Record<Pose, { sockCuff: boolean; prop: JSX.Element | null }>> = {
  seated: { sockCuff: false, prop: null },
  standing: {
    sockCuff: true,
    prop: (
      <g>
        <ellipse cx={150} cy={482} rx={118} ry={12} fill="#07090f" opacity="0.5" />
      </g>
    ),
  },
  walking: { sockCuff: true, prop: null },
  lying: { sockCuff: false, prop: null },
};

export function pathOf(part: GeomPart): string {
  const p = part.pts;
  const f = (v: number): string => v.toFixed(1);
  if (part.kind === 'line') {
    let d = `M ${f(p[0]!)} ${f(p[1]!)}`;
    for (let i = 2; i < p.length; i += 2) d += ` L ${f(p[i]!)} ${f(p[i + 1]!)}`;
    return d;
  }
  let d = `M ${f(p[0]!)} ${f(p[1]!)}`;
  for (let i = 2; i < p.length; i += 6) {
    d += ` C ${f(p[i]!)} ${f(p[i + 1]!)}, ${f(p[i + 2]!)} ${f(p[i + 3]!)}, ${f(p[i + 4]!)} ${f(p[i + 5]!)}`;
  }
  return `${d} Z`;
}

/** A drawable spec from a geometry (possibly an interpolated one) and the facts of the pose it is nearest. */
export function specOf(geometry: PoseGeometry, facts: { sockCuff: boolean; prop: JSX.Element | null }): PoseSpec {
  const body = {} as Record<Region, Part[]>;
  for (const r of REGION_LIST) body[r] = geometry.body[r].map((part) => ({ d: pathOf(part), w: part.w, closed: part.kind === 'blob' }));
  return {
    w: geometry.w,
    h: geometry.h,
    body,
    anchors: geometry.anchors,
    headTop: geometry.headTop,
    ankles: geometry.ankles,
    neckY: geometry.neckY,
    ...(geometry.grip === undefined ? {} : { grip: geometry.grip }),
    ...(geometry.pack === undefined ? {} : { pack: geometry.pack }),
    sockCuff: facts.sockCuff,
    prop: facts.prop,
    geometry,
  };
}

export const POSES: Readonly<Record<Pose, PoseSpec>> = {
  seated: specOf(GEOMETRY.seated, POSE_FACTS.seated),
  standing: specOf(GEOMETRY.standing, POSE_FACTS.standing),
  walking: specOf(GEOMETRY.walking, POSE_FACTS.walking),
  lying: specOf(GEOMETRY.lying, POSE_FACTS.lying),
};

const lerpN = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerpList = (a: readonly number[], b: readonly number[], u: number): number[] => a.map((v, i) => lerpN(v, b[i] ?? v, u));

/** `a` at u = 0, `b` at u = 1; both must come from `GEOMETRY` (or from this function). */
export function lerpGeometry(a: PoseGeometry, b: PoseGeometry, u: number): PoseGeometry {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const body = {} as Record<Region, GeomPart[]>;
  for (const r of REGION_LIST) {
    body[r] = a.body[r].map((part, k) => {
      const other = b.body[r][k]!;
      return { ...part, pts: lerpList(part.pts, other.pts, u), w: lerpN(part.w, other.w, u) };
    });
  }
  const anchors = {} as Record<Region, Record<Slot, readonly [number, number]>>;
  for (const r of REGION_LIST) {
    anchors[r] = {
      inner: [lerpN(a.anchors[r].inner[0], b.anchors[r].inner[0], u), lerpN(a.anchors[r].inner[1], b.anchors[r].inner[1], u)],
      outer: [lerpN(a.anchors[r].outer[0], b.anchors[r].outer[0], u), lerpN(a.anchors[r].outer[1], b.anchors[r].outer[1], u)],
    };
  }
  return {
    w: lerpN(a.w, b.w, u),
    h: lerpN(a.h, b.h, u),
    body,
    anchors,
    headTop: [lerpN(a.headTop[0], b.headTop[0], u), lerpN(a.headTop[1], b.headTop[1], u)],
    ankles: a.ankles.map((k, i) => {
      const o = b.ankles[i] ?? k;
      return { x: lerpN(k.x, o.x, u), y: lerpN(k.y, o.y, u), hw: lerpN(k.hw, o.hw, u), rise: lerpN(k.rise, o.rise, u) };
    }),
    neckY: lerpN(a.neckY, b.neckY, u),
  };
}

export const sameGeometry = (a: PoseGeometry, b: PoseGeometry): boolean => a === b;

/** The facts (`sockCuff`, `prop`) for a scene figure: the pose it is heading to. */
export const poseFacts = (pose: Pose): { sockCuff: boolean; prop: JSX.Element | null } => POSE_FACTS[pose];

/** The vertical line that divides inner (left) from outer (right) in the split view. */
const SPLIT_X = 150;

const REGION_ORDER: readonly Region[] = ['legs', 'feet', 'torso', 'hands', 'head'];

/**
 * Illustration colour by fabric. Deliberately desaturated and mid-value: these are scene
 * colours, not an encoding; nothing quantitative is carried by a garment's hue. Mid-value
 * matters: the figure stands on a near-black ground, and the outermost garment has to read at
 * full confidence with its seams and collar legible on it, however many layers are under it.
 */
const MATERIAL_FILL: Readonly<Record<Garment['material'], string>> = {
  down: '#b8742f',
  'synthetic-fill': '#2a7f98',
  fleece: '#71489a',
  wool: '#92506a',
  'synthetic-base': '#4a6a98',
  shell: '#2f5f90',
  other: '#4b5570',
};

/**
 * Same-material garments that should not be the same colour: a wind shirt is not a ski shell.
 * A multiplier on the material fill's value, so the palette stays one family per fabric.
 */
const GARMENT_TINT: Readonly<Partial<Record<string, number>>> = {
  wind_shirt: 1.35,
  rain_shell: 1.0,
  ski_shell: 0.78,
  fleece_300: 0.82,
  grid_fleece: 1.15,
  alpha_60: 1.25,
  alpha_90: 1.05,
  synth_puffy_60: 0.95,
  synth_puffy_100: 0.8,
  down_puffy_2oz: 1.05,
  down_puffy_45oz: 0.85,
  ls_synthetic: 1.2,
  ls_merino_light: 1.15,
  merino_mid: 0.9,
  long_underwear: 1.3,
  fleece_pants_inner: 0.85,
  briefs: 0.72,
  tights: 0.72,
  hiking_pants: 0.8,
  shorts: 1.1,
  softshell_pants: 1.2,
  fleece_lined_pants: 0.9,
  snow_pants: 0.9,
  gloves_100: 0.85,
  mitts: 0.75,
  rain_mitts: 1.3,
  trail_runners: 1.35,
  insulated_boots: 0.75,
  camp_sandals: 1.1,
};

// Two shades lighter than the original #6d4b33: same hue (25 deg) and saturation (36 %),
// lightness lifted 31 % -> 44 % so the figure reads warm rather than silhouetted.
const SKIN = '#996948';
/** A near-black halo under everything, so the figure separates from whatever is behind it. */
const HALO = '#150f24';

/** `#rrggbb` scaled towards black (factor < 1) or white-ish (factor > 1, clamped). */
function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number): string =>
    Math.min(255, Math.round(((n >> shift) & 0xff) * factor))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** The scene colour of one garment. */
function fillOf(g: Garment): string {
  const tint = GARMENT_TINT[g.id];
  const base = MATERIAL_FILL[g.material];
  return tint === undefined ? base : shade(base, tint);
}

/** How far a layer's own loft reaches on the arms and legs relative to the trunk: limbs bulk less. */
const ARM_LOFT = 0.75;
const LEG_LOFT = 0.85;

export interface ArtContext {
  readonly pose: PoseSpec;
  /** The garment's scene colour, so art and tinted regions agree on palette. */
  readonly fill: string;
  /**
   * How far outside the skin this layer's surface sits: its own loft on top of every layer
   * under it, so a shell over a puffy is fatter than a shell over a tee.
   */
  readonly inflation: number;
  /** The colour of whatever is just inside this layer (the layer under it, or the skin): what a collar opens onto. */
  readonly under: string;
  /** Every colour under this layer, nearest first and the skin last: a collar opens onto the whole stack. */
  readonly unders: readonly string[];
  /** The loft of the sleeve at the wrist and of the trouser leg at the ankle, for cuffs and collars that go over them. */
  readonly sleeve: number;
  readonly trouser: number;
}

/**
 * A garment that should read instantly: the roadmap's R7. `pieces` are its silhouette in the
 * figure's local coordinates, stroked exactly like body parts, and they take part in the halo,
 * the rim light and the hover ring, so a short sleeve leaves a bare forearm with a bare
 * forearm's outline. `draw` is flat detail over the pieces (baffles, a zip, a collar).
 * Either may be omitted: a hat is `draw` only (it halos itself), a plain top is `pieces` only.
 */
export interface GarmentArt {
  /** The garment's own loft, in place of the clo-derived guess. */
  readonly loft?: number;
  /** Whether it reaches the wrist (a top) or the ankle (trousers): what a glove's cuff or a boot's collar has to go over. A tint always does. */
  readonly reaches?: boolean;
  readonly pieces?: (ctx: ArtContext) => readonly Part[];
  readonly draw?: (ctx: ArtContext) => JSX.Element;
}

// ---------------------------------------------------------------------------------------
// Geometry helpers for garment art. Everything is read off the pose's geometry at draw time,
// so a shape built here follows a mid-morph figure point for point.
// ---------------------------------------------------------------------------------------

function asBlob(part: GeomPart | undefined, what: string): BlobPart {
  if (part === undefined || part.kind !== 'blob') throw new Error(`Expected ${what} to be a blob.`);
  return part;
}

function asLine(part: GeomPart | undefined, what: string): LinePart {
  if (part === undefined || part.kind !== 'line') throw new Error(`Expected ${what} to be a line.`);
  return part;
}

type Side = 0 | 1;
const SIDES: readonly Side[] = [0, 1];

const trunkOf = (pose: PoseSpec): BlobPart => asBlob(pose.geometry.body.torso[0], 'the trunk');
const armOf = (pose: PoseSpec, i: Side): LinePart => asLine(pose.geometry.body.torso[1 + i], 'an arm');
const legOf = (pose: PoseSpec, i: Side): LinePart => asLine(pose.geometry.body.legs[i], 'a leg');
const seatOf = (pose: PoseSpec): BlobPart => asBlob(pose.geometry.body.legs[2], 'the seat');
const handOf = (pose: PoseSpec, i: Side): BlobPart => asBlob(pose.geometry.body.hands[i], 'a hand');
const footOf = (pose: PoseSpec, i: Side): BlobPart => asBlob(pose.geometry.body.feet[i], 'a foot');

const piece = (d: string, w: number, closed: boolean): Part => ({ d, w, closed });
/** A band across a limb: square-ended, running `extra` past the line's end so it tucks under what follows. */
const band = (pts: readonly number[], s0: number, s1: number, extra: number, w: number): Part => ({
  d: polyPath(polySliceExt(pts, s0, s1, extra)),
  w,
  closed: false,
  cap: 'butt',
});

/**
 * A band whose width runs from `w0` where it starts to `w1` where it ends: a gauntlet that
 * flares over a sleeve and narrows into the hand. A closed outline built from the limb's
 * offsets, so it follows a bent or mid-morph limb like everything else.
 */
function taperedBand(pts: readonly number[], s0: number, s1: number, extra: number, w0: number, w1: number): Part {
  const slice = polySliceExt(pts, s0, s1, extra);
  const n = slice.length / 2;
  const total = polyLength(slice) || 1;
  const left: number[] = [];
  const right: number[][] = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0) acc += Math.hypot(slice[k * 2]! - slice[k * 2 - 2]!, slice[k * 2 + 1]! - slice[k * 2 - 1]!);
    const hw = (w0 + (w1 - w0) * (acc / total)) / 2;
    const prev = Math.max(0, k - 1);
    const next = Math.min(n - 1, k + 1);
    const dx = slice[next * 2]! - slice[prev * 2]!;
    const dy = slice[next * 2 + 1]! - slice[prev * 2 + 1]!;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    left.push(slice[k * 2]! + nx * hw, slice[k * 2 + 1]! + ny * hw);
    right.push([slice[k * 2]! - nx * hw, slice[k * 2 + 1]! - ny * hw]);
  }
  return { d: `${polyPath([...left, ...right.reverse().flat()])} Z`, w: 3, closed: true };
}

function polyLength(pts: readonly number[]): number {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return total;
}

interface PolyPoint {
  readonly x: number;
  readonly y: number;
  /** Unit tangent, in the direction the line is drawn. */
  readonly tx: number;
  readonly ty: number;
}

/** The point at arc length `s` along a polyline (clamped to its ends), with the tangent there. */
function polyAt(pts: readonly number[], s: number): PolyPoint {
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2]!;
    const y0 = pts[i - 1]!;
    const x1 = pts[i]!;
    const y1 = pts[i + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (s <= acc + len || i + 2 >= pts.length) {
      const u = len === 0 ? 0 : Math.min(1, Math.max(0, (s - acc) / len));
      return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, tx: len === 0 ? 0 : (x1 - x0) / len, ty: len === 0 ? 1 : (y1 - y0) / len };
    }
    acc += len;
  }
  return { x: pts[0] ?? 0, y: pts[1] ?? 0, tx: 0, ty: 1 };
}

/** The stretch of a polyline between two arc lengths, as flat points. */
function polySlice(pts: readonly number[], s0: number, s1: number): number[] {
  const a = polyAt(pts, s0);
  const b = polyAt(pts, s1);
  const out = [a.x, a.y];
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    acc += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
    if (acc > s0 && acc < s1) out.push(pts[i]!, pts[i + 1]!);
  }
  out.push(b.x, b.y);
  return out;
}

/** `polySlice` continued straight on past the line's end by `extra`. */
function polySliceExt(pts: readonly number[], s0: number, s1: number, extra: number): number[] {
  const out = polySlice(pts, s0, s1);
  if (extra > 0) {
    const end = polyAt(pts, s1);
    out.push(end.x + end.tx * extra, end.y + end.ty * extra);
  }
  return out;
}

function polyPath(pts: readonly number[]): string {
  const f = (v: number): string => v.toFixed(1);
  let d = `M ${f(pts[0] ?? 0)} ${f(pts[1] ?? 0)}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L ${f(pts[i]!)} ${f(pts[i + 1]!)}`;
  return d;
}

/** A polyline shifted sideways by `d`: positive is to the +x side of a line drawn downwards. */
function polyOffset(pts: readonly number[], d: number): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const prev = Math.max(0, k - 1);
    const next = Math.min(n - 1, k + 1);
    const dx = pts[next * 2]! - pts[prev * 2]!;
    const dy = pts[next * 2 + 1]! - pts[prev * 2 + 1]!;
    const len = Math.hypot(dx, dy) || 1;
    out.push(pts[k * 2]! + (dy / len) * d, pts[k * 2 + 1]! - (dx / len) * d);
  }
  return out;
}

/** Points along a blob's outline, `per` to a segment, in drawing order. */
function blobSamples(blob: BlobPart, per = 6): number[] {
  const p = blob.pts;
  const out: number[] = [];
  let x0 = p[0]!;
  let y0 = p[1]!;
  for (let i = 2; i < p.length; i += 6) {
    const [c1x, c1y, c2x, c2y, x1, y1] = [p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!, p[i + 4]!, p[i + 5]!];
    for (let k = 1; k <= per; k++) {
      const t = k / per;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const e = t * t * t;
      out.push(a * x0 + b * c1x + c * c2x + e * x1, a * y0 + b * c1y + c * c2y + e * y1);
    }
    x0 = x1;
    y0 = y1;
  }
  return out;
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function boundsOf(samples: readonly number[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < samples.length; i += 2) {
    const x = samples[i]!;
    const y = samples[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/** Where the horizontal line at `y` crosses a closed outline: its leftmost and rightmost x. */
function chordAt(samples: readonly number[], y: number): readonly [number, number] | null {
  const n = samples.length / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = samples[i * 2]!;
    const y0 = samples[i * 2 + 1]!;
    const x1 = samples[j * 2]!;
    const y1 = samples[j * 2 + 1]!;
    if (y0 <= y !== y1 <= y) {
      const x = x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

function centroidOf(samples: readonly number[]): readonly [number, number] {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < samples.length; i += 2) {
    sx += samples[i]!;
    sy += samples[i + 1]!;
  }
  const n = samples.length / 2;
  return [sx / n, sy / n];
}

/** The blob's path, moved by (dx, dy). */
function shiftedPath(blob: BlobPart, dx: number, dy: number): string {
  return pathOf({ ...blob, pts: blob.pts.map((v, i) => v + (i % 2 === 0 ? dx : dy)) });
}

/** A short bar across a limb at arc length `s`: a cuff, a baffle seam, a lace. */
function tickAt(pts: readonly number[], s: number, half: number): string {
  const p = polyAt(pts, s);
  const f = (v: number): string => v.toFixed(1);
  return `M ${f(p.x + p.ty * half)} ${f(p.y - p.tx * half)} L ${f(p.x - p.ty * half)} ${f(p.y + p.tx * half)}`;
}

/** A thin line in the garment's own key: the one stroke style every piece of detail shares. */
function Detail({ d, stroke, w, opacity, dash }: { d: string; stroke: string; w: number; opacity?: number | undefined; dash?: string | undefined }): JSX.Element {
  return <path d={d} fill="none" stroke={stroke} stroke-width={w} stroke-linecap="round" stroke-linejoin="round" opacity={opacity} stroke-dasharray={dash} />;
}

// ---------------------------------------------------------------------------------------
// Tops
// ---------------------------------------------------------------------------------------

interface TopStyle {
  readonly loft: number;
  /** Sleeve length as a share of the arm; 1 reaches the wrist. */
  readonly sleeve: number;
  /** How far short of the wrist a long sleeve stops, so the layer under it shows a cuff. */
  readonly cuffGap: number;
  /** How far the hem hangs below the trunk; base layers hang out under what goes over them. */
  readonly hem: number;
  /** Crew neck; quarter zip; full zip; full zip with a stand collar; a shell's open collar. */
  readonly neck: 'crew' | 'quarter' | 'zip' | 'stand' | 'open';
  /** A hood, down, bunched behind the neck. */
  readonly hood: boolean;
  /** Spacing of horizontal baffle seams; 0 for none. Down is stitched finer than synthetic. */
  readonly baffles: number;
  readonly texture: 'none' | 'fuzz' | 'grid' | 'waffle';
  /** A slick highlight down the lit side: a shell, not a knit. */
  readonly sheen: boolean;
  /** A ribbed or elastic band at the sleeve's end. */
  readonly cuff: boolean;
  readonly pockets: boolean;
}

const BASE_TOP: TopStyle = {
  loft: 3,
  sleeve: 1,
  cuffGap: 0,
  hem: 6,
  neck: 'crew',
  hood: false,
  baffles: 0,
  texture: 'none',
  sheen: false,
  cuff: true,
  pockets: false,
};
const MID_TOP: TopStyle = { ...BASE_TOP, loft: 5, cuffGap: 3, hem: 0, neck: 'zip' };
const PUFFY_TOP: TopStyle = { ...MID_TOP, neck: 'stand', cuffGap: 5 };
const SHELL_TOP: TopStyle = { ...MID_TOP, loft: 3, cuffGap: 7, neck: 'open', sheen: true };

/** Where a sleeve's path ends along the arm. The round cap adds the sleeve's half-width past it. */
function sleeveEnd(ctx: ArtContext, s: TopStyle, length: number): number {
  return s.sleeve < 1 ? length * s.sleeve : length - s.cuffGap - ctx.inflation * ARM_LOFT;
}

function topPieces(ctx: ArtContext, s: TopStyle): Part[] {
  const trunk = trunkOf(ctx.pose);
  const w = trunk.w + 2 * ctx.inflation;
  const out = [piece(pathOf(trunk), w, true)];
  if (s.hem > 0) out.push(piece(shiftedPath(trunk, 0, s.hem), w, true));
  for (const i of SIDES) {
    const arm = armOf(ctx.pose, i);
    out.push(piece(polyPath(polySlice(arm.pts, 0, sleeveEnd(ctx, s, polyLength(arm.pts)))), arm.w + 2 * ctx.inflation * ARM_LOFT, false));
  }
  return out;
}

function topDecor(ctx: ArtContext, s: TopStyle): JSX.Element {
  const { pose, fill, inflation } = ctx;
  const trunk = trunkOf(pose);
  const samples = blobSamples(trunk);
  const b = boundsOf(samples);
  const top = b.minY - inflation;
  const bottom = b.maxY + inflation + s.hem;
  const cx = (b.minX + b.maxX) / 2;
  const dark = shade(fill, 0.58);
  const light = shade(fill, 1.55);
  const f = (v: number): string => v.toFixed(1);
  const trunkW = trunk.w + 2 * inflation;
  const armW = 22 + 2 * inflation * ARM_LOFT;
  const sleeves = SIDES.map((i) => {
    const arm = armOf(pose, i);
    return { pts: arm.pts, w: arm.w + 2 * inflation * ARM_LOFT, end: sleeveEnd(ctx, s, polyLength(arm.pts)) };
  });
  // a row across the trunk at y, kept just inside the inflated outline
  const row = (y: number): string | null => {
    const c = chordAt(samples, Math.min(b.maxY - 0.5, Math.max(b.minY + 0.5, y)));
    return c === null ? null : `M ${f(c[0] - inflation)} ${f(y)} L ${f(c[1] + inflation)} ${f(y)}`;
  };
  const rows = (from: number, to: number, step: number): string[] => {
    const out: string[] = [];
    for (let y = from; y < to; y += step) {
      const r = row(y);
      if (r !== null) out.push(r);
    }
    return out;
  };
  const zipTo = (y0: number): JSX.Element => <Detail d={`M ${f(cx)} ${f(y0)} L ${f(cx)} ${f(bottom - 5)}`} stroke={light} w={1.8} opacity={0.9} />;
  // the opening shows what is under this layer: that layer's colour, and its own smaller
  // opening onto the one beneath it. Two steps, each outlined, so they read as two collars
  // rather than as stripes; anything deeper is hidden the way it would be.
  const opening = (shape: (hw: number, depth: number) => string, hw: number, depth: number): JSX.Element => (
    <g>
      {ctx.unders.slice(0, 2).map((c, k) => (
        <path key={k} d={shape(hw * (1 - 0.5 * k), depth * (1 - 0.5 * k))} fill={c} stroke={HALO} stroke-width="1.4" stroke-linejoin="round" />
      ))}
    </g>
  );
  const arc = (hw: number, depth: number): string => `M ${f(cx - hw)} ${f(top + 0.5)} Q ${f(cx)} ${f(top + 0.5 + depth)} ${f(cx + hw)} ${f(top + 0.5)} Z`;
  const vee = (hw: number, depth: number): string => `M ${f(cx - hw)} ${f(top + 0.5)} L ${f(cx)} ${f(top + 0.5 + depth)} L ${f(cx + hw)} ${f(top + 0.5)} Z`;
  const neck = ((): JSX.Element => {
    switch (s.neck) {
      case 'crew':
        return opening(arc, 10, 9);
      case 'quarter':
        return (
          <g>
            {opening(arc, 9, 8)}
            <Detail d={`M ${f(cx)} ${f(top + 5)} L ${f(cx)} ${f(top + 28)}`} stroke={light} w={1.6} opacity={0.75} />
          </g>
        );
      case 'zip':
        return (
          <g>
            {opening(vee, 8, 13)}
            {zipTo(top + 13)}
          </g>
        );
      case 'stand':
        return (
          <g>
            <Detail d={`M ${f(cx - 17)} ${f(top + 2)} Q ${f(cx)} ${f(top + 12)} ${f(cx + 17)} ${f(top + 2)}`} stroke={dark} w={4} />
            {opening(vee, 6.5, 10)}
            {zipTo(top + 10)}
          </g>
        );
      case 'open':
        return (
          <g>
            {opening(vee, 12, 18)}
            <Detail d={`M ${f(cx - 12)} ${f(top + 1)} L ${f(cx - 21)} ${f(top + 11)} M ${f(cx + 12)} ${f(top + 1)} L ${f(cx + 21)} ${f(top + 11)}`} stroke={dark} w={1.6} />
            {zipTo(top + 18)}
          </g>
        );
    }
  })();
  return (
    <g>
      {s.texture === 'fuzz' && (
        // a dashed fringe just inside every piece's edge: the nap of the fabric
        <g>
          {[piece(pathOf(trunk), trunkW, true), ...(s.hem > 0 ? [piece(shiftedPath(trunk, 0, s.hem), trunkW, true)] : []), ...sleeves.map((sl) => piece(polyPath(polySlice(sl.pts, 0, sl.end)), sl.w, false))].map(
            (p, i) => (
              <g key={i}>
                <Stroked part={p} fill={light} inflation={0.5} opacity={0.75} dash="1.5 3.2" />
                <Stroked part={{ ...p, w: p.w - 3 }} fill={fill} inflation={0} />
              </g>
            ),
          )}
        </g>
      )}
      {s.texture === 'grid' && rows(top + 18, bottom - 6, 7).map((d, i) => <Detail key={`g${i}`} d={d} stroke={light} w={1.4} opacity={0.45} dash="1.6 3" />)}
      {s.texture === 'waffle' && rows(top + 18, bottom - 6, 6).map((d, i) => <Detail key={`w${i}`} d={d} stroke={light} w={1.3} opacity={0.35} dash="2 2.4" />)}
      {s.baffles > 0 && (
        <g>
          {rows(top + 16, bottom - 7, s.baffles).map((d, i) => (
            <Detail key={`b${i}`} d={d} stroke={dark} w={1.8} opacity={0.95} />
          ))}
          {sleeves.map((sl, i) => {
            const ticks: string[] = [];
            for (let at = 14; at < sl.end - 5; at += s.baffles) ticks.push(tickAt(sl.pts, at, sl.w / 2 - 2));
            return <Detail key={`sb${i}`} d={ticks.join(' ')} stroke={dark} w={1.8} opacity={0.95} />;
          })}
        </g>
      )}
      {s.sheen && (
        <g>
          <Detail
            d={polyPath(
              rows(top + 20, bottom - 8, 10).flatMap((_, k) => {
                const y = top + 20 + k * 10;
                const c = chordAt(samples, Math.min(b.maxY - 0.5, Math.max(b.minY + 0.5, y)));
                return c === null ? [] : [c[1] + inflation - 4.5, y];
              }),
            )}
            stroke={shade(fill, 1.9)}
            w={2.8}
            opacity={0.6}
          />
          {sleeves.slice(1).map((sl, i) => (
            <Detail key={`sh${i}`} d={polyPath(polyOffset(polySlice(sl.pts, 12, sl.end - 2), armW / 2 - 3.5))} stroke={shade(fill, 1.9)} w={2.4} opacity={0.6} />
          ))}
        </g>
      )}
      {s.pockets && (
        <Detail d={`M ${f(cx - 31)} ${f(top + 48)} L ${f(cx - 15)} ${f(top + 48)} M ${f(cx + 15)} ${f(top + 48)} L ${f(cx + 31)} ${f(top + 48)}`} stroke={dark} w={2} />
      )}
      {s.hood && (
        <path
          d={`M ${f(cx - 25)} ${f(top + 8)} C ${f(cx - 27)} ${f(top - 8)}, ${f(cx + 27)} ${f(top - 8)}, ${f(cx + 25)} ${f(top + 8)} C ${f(cx + 20)} ${f(top + 13)}, ${f(cx - 20)} ${f(top + 13)}, ${f(cx - 25)} ${f(top + 8)} Z`}
          fill={shade(fill, 0.85)}
          stroke={HALO}
          stroke-width="2.5"
          stroke-linejoin="round"
          paint-order="stroke"
        />
      )}
      {neck}
      {s.cuff && sleeves.map((sl, i) => <Detail key={`c${i}`} d={tickAt(sl.pts, sl.end - 1, sl.w / 2 - 1)} stroke={dark} w={s.loft >= 7 ? 5 : 3.5} />)}
    </g>
  );
}

const top = (s: TopStyle): GarmentArt => ({ loft: s.loft, reaches: s.sleeve >= 1, pieces: (ctx) => topPieces(ctx, s), draw: (ctx) => topDecor(ctx, s) });

// ---------------------------------------------------------------------------------------
// Trousers
// ---------------------------------------------------------------------------------------

interface PantsStyle {
  readonly loft: number;
  /** Leg length as a share of the leg; 1 reaches the ankle. */
  readonly length: number;
  /** How far short of the ankle a full leg stops. */
  readonly hemGap: number;
  /** Nothing; a ribbed base-layer cuff; a lighter lining showing at the hem; a plain turned hem. */
  readonly cuff: 'none' | 'rib' | 'lined' | 'hem';
  readonly texture: 'none' | 'fuzz' | 'waffle';
  readonly sheen: boolean;
  /** A thin stripe down the outside of each leg. */
  readonly stripe: boolean;
  readonly baffles: number;
}

const BASE_PANTS: PantsStyle = { loft: 3, length: 1, hemGap: 0, cuff: 'none', texture: 'none', sheen: false, stripe: false, baffles: 0 };

function legEnd(ctx: ArtContext, s: PantsStyle, length: number): number {
  return s.length < 1 ? length * s.length : length - s.hemGap - ctx.inflation * LEG_LOFT;
}

function pantsPieces(ctx: ArtContext, s: PantsStyle): Part[] {
  const seat = seatOf(ctx.pose);
  const out = [piece(pathOf(seat), seat.w + 2 * ctx.inflation, true)];
  for (const i of SIDES) {
    const leg = legOf(ctx.pose, i);
    out.push(piece(polyPath(polySlice(leg.pts, 0, legEnd(ctx, s, polyLength(leg.pts)))), leg.w + 2 * ctx.inflation * LEG_LOFT, false));
  }
  return out;
}

function pantsDecor(ctx: ArtContext, s: PantsStyle): JSX.Element {
  const { pose, fill, inflation } = ctx;
  const dark = shade(fill, 0.58);
  const light = shade(fill, 1.55);
  const legs = SIDES.map((i) => {
    const leg = legOf(pose, i);
    return { pts: leg.pts, w: leg.w + 2 * inflation * LEG_LOFT, end: legEnd(ctx, s, polyLength(leg.pts)) };
  });
  return (
    <g>
      {s.texture === 'fuzz' &&
        legs.map((lg, i) => {
          const p = piece(polyPath(polySlice(lg.pts, 0, lg.end)), lg.w, false);
          return (
            <g key={`f${i}`}>
              <Stroked part={p} fill={light} inflation={0.5} opacity={0.75} dash="1.5 3.2" />
              <Stroked part={{ ...p, w: p.w - 3 }} fill={fill} inflation={0} />
            </g>
          );
        })}
      {s.texture === 'waffle' &&
        legs.map((lg, i) => {
          const ticks: string[] = [];
          for (let at = 12; at < lg.end - 4; at += 6.5) ticks.push(tickAt(lg.pts, at, lg.w / 2 - 2));
          return <Detail key={`w${i}`} d={ticks.join(' ')} stroke={light} w={1.3} opacity={0.35} dash="2 2.4" />;
        })}
      {s.baffles > 0 &&
        legs.map((lg, i) => {
          const ticks: string[] = [];
          for (let at = 16; at < lg.end - 6; at += s.baffles) ticks.push(tickAt(lg.pts, at, lg.w / 2 - 2));
          return <Detail key={`b${i}`} d={ticks.join(' ')} stroke={dark} w={1.6} opacity={0.85} />;
        })}
      {s.sheen &&
        legs.slice(1).map((lg, i) => (
          <Detail key={`sh${i}`} d={polyPath(polyOffset(polySlice(lg.pts, 10, lg.end - 4), lg.w / 2 - 3.5))} stroke={shade(fill, 1.9)} w={2.4} opacity={0.6} />
        ))}
      {s.stripe &&
        legs.map((lg, i) => (
          <Detail key={`s${i}`} d={polyPath(polyOffset(polySlice(lg.pts, 8, lg.end - 2), (i === 0 ? -1 : 1) * (lg.w / 2 - 3)))} stroke={light} w={1.6} opacity={0.7} />
        ))}
      {s.cuff === 'rib' && legs.map((lg, i) => <Detail key={`r${i}`} d={tickAt(lg.pts, lg.end - 1, lg.w / 2 - 1)} stroke={dark} w={4} />)}
      {s.cuff === 'hem' && legs.map((lg, i) => <Detail key={`h${i}`} d={tickAt(lg.pts, lg.end + 1, lg.w / 2 - 2)} stroke={dark} w={2.2} opacity={0.8} />)}
      {s.cuff === 'lined' && legs.map((lg, i) => <Detail key={`l${i}`} d={tickAt(lg.pts, lg.end + 1.5, lg.w / 2 - 1)} stroke={shade(fill, 1.7)} w={4.5} />)}
    </g>
  );
}

const pants = (s: PantsStyle): GarmentArt => ({ loft: s.loft, reaches: s.length >= 1, pieces: (ctx) => pantsPieces(ctx, s), draw: (ctx) => pantsDecor(ctx, s) });

// ---------------------------------------------------------------------------------------
// Handwear and footwear
// ---------------------------------------------------------------------------------------

interface GloveStyle {
  readonly loft: number;
  /** How far up the forearm the cuff reaches, over the sleeve. */
  readonly cuffLen: number;
  /** Separate fingers drawn in; a mitt has none. */
  readonly fingers: boolean;
  readonly thumb: boolean;
  readonly sheen: boolean;
}

/** Where the hand points: from the wrist through the hand's middle, and how far the hand reaches that way. */
function handFrame(pose: PoseSpec, i: Side): { cx: number; cy: number; dx: number; dy: number; reach: number } {
  const samples = blobSamples(handOf(pose, i));
  const [cx, cy] = centroidOf(samples);
  const arm = armOf(pose, i).pts;
  const wx = arm[arm.length - 2]!;
  const wy = arm[arm.length - 1]!;
  const len = Math.hypot(cx - wx, cy - wy) || 1;
  const dx = (cx - wx) / len;
  const dy = (cy - wy) / len;
  let reach = 0;
  for (let k = 0; k < samples.length; k += 2) reach = Math.max(reach, (samples[k]! - cx) * dx + (samples[k + 1]! - cy) * dy);
  return { cx, cy, dx, dy, reach };
}

function gloveCuffWidth(ctx: ArtContext): number {
  return 22 + 2 * (ctx.sleeve + 1.5 + ctx.inflation * 0.4);
}

function glovePieces(ctx: ArtContext, s: GloveStyle): Part[] {
  const out: Part[] = [];
  for (const i of SIDES) {
    const hand = handOf(ctx.pose, i);
    out.push(piece(pathOf(hand), hand.w + 2 * ctx.inflation, true));
    const arm = armOf(ctx.pose, i).pts;
    const len = polyLength(arm);
    // a gauntlet flares a little over the sleeve, then narrows into the hand
    const flare = s.cuffLen > 12 ? 5 : 1;
    out.push(taperedBand(arm, len - s.cuffLen, len, 6, gloveCuffWidth(ctx) + flare, hand.w + 2 * ctx.inflation + 32));
  }
  return out;
}

function gloveDecor(ctx: ArtContext, s: GloveStyle): JSX.Element {
  const { pose, fill, inflation } = ctx;
  const dark = shade(fill, 0.62);
  const f = (v: number): string => v.toFixed(1);
  return (
    <g>
      {SIDES.map((i) => {
        const h = handFrame(pose, i);
        const px = -h.dy;
        const py = h.dx;
        const tipX = h.cx + h.dx * (h.reach + inflation);
        const tipY = h.cy + h.dy * (h.reach + inflation);
        const fingerLen = Math.min(11, h.reach * 0.55);
        const fingers = [-1, 0, 1].map((k) => {
          const sx = tipX - h.dx * 2.5 + px * k * 5.5;
          const sy = tipY - h.dy * 2.5 + py * k * 5.5;
          return `M ${f(sx)} ${f(sy)} L ${f(sx - h.dx * fingerLen)} ${f(sy - h.dy * fingerLen)}`;
        });
        // the thumb sits on the side of the hand nearest the body
        const toBody = Math.sign(px * (SPLIT_X - h.cx)) || 1;
        const thumbX = h.cx + px * toBody * (h.reach * 0.75 + inflation) - h.dx * 3;
        const thumbY = h.cy + py * toBody * (h.reach * 0.75 + inflation) - h.dy * 3;
        const arm = armOf(pose, i).pts;
        const len = polyLength(arm);
        return (
          <g key={i}>
            {s.thumb && <circle cx={thumbX} cy={thumbY} r={5 + inflation * 0.25} fill={fill} stroke={HALO} stroke-width="2.2" paint-order="stroke" />}
            {s.fingers && <Detail d={fingers.join(' ')} stroke={dark} w={1.6} opacity={0.9} />}
            {s.sheen && <Detail d={polyPath(polyOffset(polySlice(arm, len - s.cuffLen + 3, len - 1), (i === 0 ? -1 : 1) * (gloveCuffWidth(ctx) / 2 - 3.5)))} stroke={shade(fill, 1.9)} w={2} opacity={0.45} />}
            {s.cuffLen > 8 && <Detail d={tickAt(arm, len - s.cuffLen + 1.5, gloveCuffWidth(ctx) / 2 - 1)} stroke={dark} w={3} opacity={0.9} />}
          </g>
        );
      })}
    </g>
  );
}

const gloves = (s: GloveStyle): GarmentArt => ({ loft: s.loft, pieces: (ctx) => glovePieces(ctx, s), draw: (ctx) => gloveDecor(ctx, s) });

interface ShoeStyle {
  readonly loft: number;
  /** How far up the leg the shoe's collar reaches; 0 for a low shoe. */
  readonly collar: number;
  readonly collarLoft: number;
  /** A dark rubber sole, or a light foam one. */
  readonly sole: 'dark' | 'light';
  /** Lace bars across the collar. */
  readonly laces: number;
  /** A pale fur rim at the top of the collar. */
  readonly fur: boolean;
}

/** The foot's underside, as the run of outline points past its midline, so a pitched foot keeps its sole. */
function solePath(foot: BlobPart, drop: number): string {
  const samples = blobSamples(foot, 8);
  const b = boundsOf(samples);
  const cut = (b.minY + b.maxY) / 2 + (b.maxY - b.minY) * 0.22;
  const n = samples.length / 2;
  // rotate so the run starts at the topmost point, then take the one stretch below the cut
  let start = 0;
  for (let k = 0; k < n; k++) if (samples[k * 2 + 1]! < samples[start * 2 + 1]!) start = k;
  const run: number[] = [];
  for (let k = 0; k < n; k++) {
    const idx = (start + k) % n;
    const y = samples[idx * 2 + 1]!;
    if (y > cut) run.push(samples[idx * 2]!, y + drop);
  }
  return run.length >= 4 ? polyPath(run) : '';
}

function shoePieces(ctx: ArtContext, s: ShoeStyle): Part[] {
  const out: Part[] = [];
  for (const i of SIDES) {
    const foot = footOf(ctx.pose, i);
    out.push(piece(pathOf(foot), foot.w + 2 * ctx.inflation, true));
    if (s.collar > 0) {
      const leg = legOf(ctx.pose, i).pts;
      const len = polyLength(leg);
      out.push(band(leg, len - s.collar, len, 6, 30 + 2 * s.collarLoft));
    }
  }
  return out;
}

function shoeDecor(ctx: ArtContext, s: ShoeStyle): JSX.Element {
  const { pose, fill, inflation } = ctx;
  const dark = shade(fill, 0.55);
  return (
    <g>
      {SIDES.map((i) => {
        const foot = footOf(pose, i);
        const leg = legOf(pose, i).pts;
        const len = polyLength(leg);
        const laces: string[] = [];
        for (let k = 0; k < s.laces; k++) laces.push(tickAt(leg, len - s.collar + 4 + k * 6, 15 + s.collarLoft - 4));
        return (
          <g key={i}>
            <Detail d={solePath(foot, inflation - 1.5)} stroke={s.sole === 'dark' ? dark : shade(fill, 1.6)} w={3} opacity={0.95} />
            {s.collar === 0 && s.laces > 0 && <Detail d={solePath(foot, -(inflation + 9))} stroke={shade(fill, 1.6)} w={1.6} opacity={0.6} />}
            {s.collar > 0 && laces.length > 0 && <Detail d={laces.join(' ')} stroke={dark} w={1.8} opacity={0.9} />}
            {s.fur && <Detail d={tickAt(leg, len - s.collar + 1.5, 15 + s.collarLoft - 1)} stroke={shade(fill, 1.8)} w={5} />}
          </g>
        );
      })}
    </g>
  );
}

const shoes = (s: ShoeStyle): GarmentArt => ({ loft: s.loft, pieces: (ctx) => shoePieces(ctx, s), draw: (ctx) => shoeDecor(ctx, s) });

// ---------------------------------------------------------------------------------------
// Socks and headwear: self-contained drawings (they halo themselves)
// ---------------------------------------------------------------------------------------

/** How one kind of sock departs from the pose's ordinary stocking. */
interface SockStyle {
  /** How far the foot swells past the bare foot's outline: bulk, not insulation. */
  readonly loft: number;
  /** Cuff height as a multiple of the pose's ordinary rise. */
  readonly rise: number;
  /** Added to the cuff's half-width. */
  readonly girth: number;
  /** Height of the ribbed band at the top of the cuff; 0 for none. */
  readonly band: number;
  /** A slick highlight down the cuff, for a sock that is a bag rather than a knit. */
  readonly sheen: boolean;
}

/**
 * A stocking on each foot: the pose's foot shape swollen a little, with a cuff rising up the
 * ankle from it. Drawn as one silhouette (halo first under both pieces, then the colour over
 * both) so no outline cuts between cuff and foot. A pose that tucks the ankle (`sockCuff`
 * false) gets the swollen foot alone.
 */
function stocking({ pose, fill }: ArtContext, s: SockStyle): JSX.Element {
  return (
    <g stroke-linejoin="round" stroke-linecap="round">
      {pose.ankles.map((a, i) => {
        const foot = pose.body.feet[i];
        if (foot === undefined) return null;
        const hw = a.hw + s.girth;
        const top = a.y - a.rise * s.rise;
        const crown = `M ${a.x - hw} ${top + 4} Q ${a.x - hw} ${top} ${a.x - hw + 4} ${top} L ${a.x + hw - 4} ${top} Q ${a.x + hw} ${top} ${a.x + hw} ${top + 4}`;
        const cuff = `${crown} L ${a.x + hw} ${a.y + 6} L ${a.x - hw} ${a.y + 6} Z`;
        const band = `${crown} L ${a.x + hw} ${top + s.band} L ${a.x - hw} ${top + s.band} Z`;
        const withCuff = pose.sockCuff;
        return (
          <g key={i}>
            {withCuff && <path d={cuff} fill={HALO} stroke={HALO} stroke-width="5" />}
            <path d={foot.d} fill={HALO} stroke={HALO} stroke-width={foot.w + s.loft * 2 + 5} />
            {withCuff && <path d={cuff} fill={fill} />}
            <path d={foot.d} fill={fill} stroke={fill} stroke-width={foot.w + s.loft * 2} />
            {withCuff && s.band > 0 && <path d={band} fill={shade(fill, 0.78)} stroke={HALO} stroke-width="3" paint-order="stroke" />}
            {withCuff && s.sheen && (
              <path
                d={`M ${a.x - hw + 5} ${top + 6} L ${a.x - hw + 5} ${a.y - 2}`}
                fill="none"
                stroke={shade(fill, 1.6)}
                stroke-width="2"
                opacity="0.7"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Real shapes for garments that should read instantly: the roadmap's R7. Keyed by garment
 * id; a garment with no entry falls back to the tinted region, so the catalogue can grow
 * without any of this changing. Each entry draws in the figure's local coordinates, read off
 * the pose at draw time (`pose.headTop`, the arm and leg lines, the trunk's outline), in the
 * same flat, simplified register as the body, with a `HALO`-coloured outline for separation.
 * Layering is geometric: layers are drawn skin outwards, and what shows of a lower layer is
 * whatever the one over it leaves uncovered (a base layer's cuffs past a jacket's shorter
 * sleeves, its hem under the jacket's, its colour in the open collar).
 */
export const GARMENT_ART: Readonly<Partial<Record<string, GarmentArt>>> = {
  // torso, next to skin: a tee is the one that leaves the forearm bare
  tee: top({ ...BASE_TOP, sleeve: 0.42, hem: 4, cuff: false }),
  ls_synthetic: top({ ...BASE_TOP, neck: 'quarter', hood: true, hem: 7 }),
  ls_merino_light: top({ ...BASE_TOP, hem: 5 }),
  merino_mid: top({ ...BASE_TOP, loft: 4, neck: 'quarter', hem: 5 }),
  grid_fleece: top({ ...BASE_TOP, loft: 5, neck: 'zip', hood: true, texture: 'grid', hem: 3 }),
  // torso, on top: fleece is nap, a puffy is baffles and loft, a shell is a sheen
  fleece_200: top({ ...MID_TOP, loft: 5, neck: 'stand', texture: 'fuzz' }),
  fleece_300: top({ ...MID_TOP, loft: 6.5, neck: 'stand', texture: 'fuzz' }),
  alpha_60: top({ ...MID_TOP, loft: 4, hood: true, texture: 'waffle' }),
  alpha_90: top({ ...MID_TOP, loft: 5, hood: true, texture: 'waffle' }),
  synth_puffy_60: top({ ...PUFFY_TOP, loft: 7.5, baffles: 16 }),
  synth_puffy_100: top({ ...PUFFY_TOP, loft: 9, baffles: 16 }),
  down_puffy_2oz: top({ ...PUFFY_TOP, loft: 8.5, baffles: 11 }),
  down_puffy_3oz: top({ ...PUFFY_TOP, loft: 10.5, baffles: 11, hood: true }),
  down_puffy_45oz: top({ ...PUFFY_TOP, loft: 13, baffles: 11 }),
  wind_shirt: top({ ...SHELL_TOP, loft: 2.5, neck: 'quarter', cuffGap: 6 }),
  rain_shell: top({ ...SHELL_TOP, loft: 3.5, hood: true }),
  ski_shell: top({ ...SHELL_TOP, loft: 5, hood: true, pockets: true }),
  // legs, next to skin
  briefs: pants({ ...BASE_PANTS, loft: 2, length: 0.1 }),
  long_underwear: pants({ ...BASE_PANTS, cuff: 'rib' }),
  alpha_leggings: pants({ ...BASE_PANTS, loft: 3.5, texture: 'waffle' }),
  fleece_pants_inner: pants({ ...BASE_PANTS, loft: 5, texture: 'fuzz' }),
  // legs, on top: shorts leave the lower leg bare the way the tee leaves the forearm
  shorts: pants({ ...BASE_PANTS, length: 0.42, cuff: 'hem' }),
  tights: pants({ ...BASE_PANTS, loft: 2.5, hemGap: 1, stripe: true }),
  hiking_pants: pants({ ...BASE_PANTS, loft: 4, hemGap: 3, cuff: 'hem' }),
  softshell_pants: pants({ ...BASE_PANTS, loft: 4.5, hemGap: 2, sheen: true }),
  fleece_lined_pants: pants({ ...BASE_PANTS, loft: 6, hemGap: 3, cuff: 'lined' }),
  rain_pants: pants({ ...BASE_PANTS, loft: 4, hemGap: 1, sheen: true }),
  snow_pants: pants({ ...BASE_PANTS, loft: 7, sheen: true, baffles: 15 }),
  // hands: gloves have fingers, mitts a thumb and nothing else
  liner_gloves: gloves({ loft: 1.5, cuffLen: 6, fingers: true, thumb: false, sheen: false }),
  gloves_40: gloves({ loft: 3, cuffLen: 10, fingers: true, thumb: false, sheen: false }),
  gloves_100: gloves({ loft: 4.5, cuffLen: 16, fingers: true, thumb: false, sheen: false }),
  mitts: gloves({ loft: 6, cuffLen: 18, fingers: false, thumb: true, sheen: false }),
  rain_mitts: gloves({ loft: 4, cuffLen: 26, fingers: false, thumb: true, sheen: true }),
  // feet: a stocking each, the heavier the knit the taller and bulkier; the VBL is a slick bag
  socks_light: { draw: (ctx) => stocking(ctx, { loft: 2, rise: 0.75, girth: -1, band: 4, sheen: false }) },
  socks_mid: { draw: (ctx) => stocking(ctx, { loft: 3.5, rise: 1, girth: 0, band: 6, sheen: false }) },
  socks_heavy: { draw: (ctx) => stocking(ctx, { loft: 5, rise: 1.3, girth: 2, band: 8, sheen: false }) },
  vbl_socks: { draw: (ctx) => stocking(ctx, { loft: 2.5, rise: 1.15, girth: -1, band: 0, sheen: true }) },
  // shoes: a boot has a collar up the ankle, a runner is low with a light sole, a sandal is a sole and a strap
  trail_runners: shoes({ loft: 2.5, collar: 0, collarLoft: 0, sole: 'light', laces: 1, fur: false }),
  boots: shoes({ loft: 4, collar: 14, collarLoft: 6, sole: 'dark', laces: 2, fur: false }),
  insulated_boots: shoes({ loft: 6, collar: 26, collarLoft: 8, sole: 'dark', laces: 2, fur: true }),
  camp_sandals: {
    loft: 1.5,
    pieces: (ctx) => SIDES.map((i) => piece(pathOf(footOf(ctx.pose, i)), footOf(ctx.pose, i).w + 2 * ctx.inflation, true)),
    draw: ({ pose, fill, under, inflation }) => (
      <g>
        {SIDES.map((i) => {
          const foot = footOf(pose, i);
          const samples = blobSamples(foot);
          const b = boundsOf(samples);
          const cy = (b.minY + b.maxY) / 2 - 1;
          const c = chordAt(samples, cy);
          return (
            <g key={i}>
              <Stroked part={{ d: pathOf(foot), w: foot.w + 2 * (inflation - 1.5), closed: true }} fill={under} inflation={0} />
              {c !== null && <Detail d={`M ${(c[0] - 1).toFixed(1)} ${cy.toFixed(1)} L ${(c[1] + 1).toFixed(1)} ${cy.toFixed(1)}`} stroke={fill} w={4} />}
            </g>
          );
        })}
      </g>
    ),
  },
  beanie: {
    draw: ({ pose, fill }) => {
      const [cx, cy] = pose.headTop;
      // a dome a little looser than the skull, a folded cuff across the brow, a bobble on top
      return (
        <g transform={`translate(${cx} ${cy})`} stroke={HALO} stroke-width="5" stroke-linejoin="round" paint-order="stroke">
          <circle cx={0} cy={-11} r={6.5} fill={shade(fill, 1.25)} />
          <path d="M -32 30 C -33 4, -17 -8, 0 -8 C 17 -8, 33 4, 32 30 Z" fill={fill} />
          <path d="M -33 20 C -14 16, 14 16, 33 20 L 33 32 C 14 28, -14 28, -33 32 Z" fill={shade(fill, 0.78)} />
        </g>
      );
    },
  },
  balaclava: {
    draw: ({ pose, fill }) => {
      const [cx, cy] = pose.headTop;
      // the whole head and the neck covered; only an oval of face left open (even-odd hole)
      return (
        <g transform={`translate(${cx} ${cy})`} stroke={HALO} stroke-width="5" stroke-linejoin="round" paint-order="stroke">
          <path
            d={
              'M 0 -5 C 20 -5, 33 9, 33 34 C 33 58, 24 72, 15 76 L 15 80 C 15 85, -15 85, -15 80 L -15 76 C -24 72, -33 58, -33 34 C -33 9, -20 -5, 0 -5 Z ' +
              'M 0 20 C 10 20, 16 27, 16 38 C 16 50, 9 57, 0 57 C -9 57, -16 50, -16 38 C -16 27, -10 20, 0 20 Z'
            }
            fill={fill}
            fill-rule="evenodd"
          />
        </g>
      );
    },
  },
  sun_hat: {
    draw: ({ pose, fill }) => {
      const [cx, cy] = pose.headTop;
      // a soft crown on the head and a wide brim around it; the brim's underside is shaded
      return (
        <g transform={`translate(${cx} ${cy})`} stroke={HALO} stroke-width="5" stroke-linejoin="round" paint-order="stroke">
          <path d="M -26 24 L -23 -4 C -23 -9, 23 -9, 23 -4 L 26 24 Z" fill={fill} />
          <path d="M -48 22 C -48 14, 48 14, 48 22 C 48 30, -48 30, -48 22 Z" fill={shade(fill, 0.78)} />
          <path d="M -48 22 C -48 16, 48 16, 48 22 L 48 23 C 48 18, -48 18, -48 23 Z" fill={fill} />
        </g>
      );
    },
  },
  jacket_hood: {
    draw: ({ pose, fill }) => {
      const [cx, cy] = pose.headTop;
      // a hood up: loose around the whole head, pointed a little at the crown, open at the face
      return (
        <g transform={`translate(${cx} ${cy})`} stroke={HALO} stroke-width="5" stroke-linejoin="round" paint-order="stroke">
          <path
            d={
              'M 2 -14 C 26 -12, 40 10, 40 40 C 40 62, 36 78, 32 90 L -32 90 C -36 78, -40 62, -40 40 C -40 10, -26 -12, 2 -14 Z ' +
              'M 0 16 C 13 16, 21 26, 21 40 C 21 56, 12 66, 0 66 C -12 66, -21 56, -21 40 C -21 26, -13 16, 0 16 Z'
            }
            fill={fill}
            fill-rule="evenodd"
          />
        </g>
      );
    },
  },
};

/** How fat a layer draws: its art's own loft, else a guess from its class. A puffy lofts; a shell is a skin. */
function thickness(g: Garment): number {
  const own = GARMENT_ART[g.id]?.loft;
  if (own !== undefined) return own;
  if (g.isShell === true) return 3;
  if (g.isPuffy === true) return 4.5 + g.clo * 3.2;
  return Math.min(8, Math.max(3, 2.5 + g.clo * 7));
}

/** Enough slack past the fattest piece for the light mask. */
const MASK_SLACK = 4;

interface LayerDraw {
  readonly garment: Garment;
  readonly fill: string;
  /** Cumulative inflation, skin outwards, at this layer's surface. */
  readonly inflation: number;
  /** The fills of the layers under this one, nearest first, then the skin. */
  readonly unders: readonly string[];
  readonly art: GarmentArt | undefined;
}

/** A region's whole stack, skin outwards. */
function layerDraws(ids: readonly string[]): LayerDraw[] {
  const sorted = [...ids].map(garmentById).sort((a, b) => layerRank(a) - layerRank(b));
  let acc = 0;
  let unders: readonly string[] = [SKIN];
  return sorted.map((garment) => {
    acc += thickness(garment);
    const fill = fillOf(garment);
    const draw: LayerDraw = { garment, fill, inflation: acc, unders, art: GARMENT_ART[garment.id] };
    unders = [fill, ...unders];
    return draw;
  });
}

const regionIds = (kit: Outfit, region: Region): string[] => [...kit[region].inner, ...kit[region].outer];

/** The inflation at the end of the limb: the outermost layer that gets there (a tee does not reach the wrist). */
function limbEndInflation(kit: Outfit, region: Region): number {
  const reaching = layerDraws(regionIds(kit, region)).filter((d) => d.art?.reaches !== false);
  return reaching.length === 0 ? 0 : reaching[reaching.length - 1]!.inflation;
}

function Stroked({
  part,
  fill,
  inflation,
  opacity,
  dash,
}: {
  part: Part;
  fill: string;
  inflation: number;
  opacity?: number | undefined;
  dash?: string | undefined;
}): JSX.Element {
  return (
    <path
      d={part.d}
      fill={part.closed && dash === undefined ? fill : 'none'}
      stroke={fill}
      stroke-width={part.w + inflation * 2}
      stroke-linejoin="round"
      stroke-linecap={part.cap ?? 'round'}
      opacity={opacity}
      stroke-dasharray={dash}
    />
  );
}

/** One layer, resolved against a pose: what it draws and the silhouette it adds. */
interface ResolvedLayer {
  readonly draw: LayerDraw;
  readonly ctx: ArtContext;
  /** Its silhouette: real pieces for art, the region's parts inflated for a tint (and for self-drawn art, so its halo matches). */
  readonly pieces: readonly Part[];
}

/** One clipped half (or the whole) of a region: the layers shown there. */
interface RegionHalf {
  readonly clip: string | null;
  readonly layers: readonly ResolvedLayer[];
}

function resolve(draw: LayerDraw, pose: PoseSpec, parts: readonly Part[], sleeve: number, trouser: number): ResolvedLayer {
  const ctx: ArtContext = { pose, fill: draw.fill, inflation: draw.inflation, under: draw.unders[0] ?? SKIN, unders: draw.unders, sleeve, trouser };
  const pieces = draw.art?.pieces?.(ctx) ?? parts.map((p) => ({ ...p, w: p.w + 2 * draw.inflation }));
  return { draw, ctx, pieces };
}

/** Everything in a half, drawn in stack order: a layer's pieces in its colour, then its detail. */
function Layers({ half }: { half: RegionHalf }): JSX.Element {
  return (
    <g clip-path={half.clip === null ? undefined : `url(#${half.clip})`}>
      {half.layers.map((l) => (
        <g key={l.draw.garment.id}>
          {l.draw.art?.pieces !== undefined || l.draw.art === undefined
            ? l.pieces.map((p, i) => <Stroked key={i} part={p} fill={l.draw.fill} inflation={0} />)
            : null}
          {l.draw.art?.draw?.(l.ctx)}
        </g>
      ))}
    </g>
  );
}

/** Every silhouette in a half, skin included, stroked one way: the halo, the rim, the masks. */
function Silhouette({
  half,
  skin,
  fill,
  inflation,
  opacity,
}: {
  half: RegionHalf;
  skin: readonly Part[];
  fill: string;
  inflation: number;
  opacity?: number | undefined;
}): JSX.Element {
  return (
    <g clip-path={half.clip === null ? undefined : `url(#${half.clip})`}>
      {[...skin, ...half.layers.flatMap((l) => l.pieces)].map((p, i) => (
        <Stroked key={i} part={p} fill={fill} inflation={inflation} opacity={opacity} />
      ))}
    </g>
  );
}

export interface SlotRef {
  readonly region: Region;
  readonly slot: Slot;
}

export interface FigureProps {
  /** What the character has on: one configuration, not the inventory. */
  readonly kit: Outfit;
  /** A pose by name, or a spec (a scene mid-morph hands in an interpolated one). */
  readonly pose: Pose | PoseSpec;
  readonly view: FigureView;
  /** Which slot is emphasised: its region is ringed. `null` for none. */
  readonly selected: SlotRef | null;
  readonly hovered: SlotRef | null;
  /**
   * In the split view each half of a region is its own target (left half picks the inner
   * slot, right half the outer), so the figure is a second route into the same choices the
   * callouts offer. Absent, the figure is decoration and takes no pointer events.
   */
  readonly onSelectSlot?: (slot: SlotRef) => void;
  readonly onHoverSlot?: (slot: SlotRef | null) => void;
  readonly describeSlot?: (slot: SlotRef) => string;
  /** Whether the firelight falls on the figure from the right (the scene) or not (the studio). */
  readonly lit: boolean;
  /**
   * Contour rings in a given colour around whole regions: the extremity verdicts drawn on the
   * body they are about (`VISUAL_ROADMAP.md` R17). Same ring as hover and selection, in the
   * verdict's colour.
   */
  readonly outlines?: Readonly<Partial<Record<Region, string>>>;
  /** Unique within the document, so two mounted panels cannot share a clip id. */
  readonly uid: string;
}

export function Figure({
  kit,
  pose,
  view,
  selected,
  hovered,
  onSelectSlot,
  onHoverSlot,
  describeSlot,
  lit,
  outlines,
  uid,
}: FigureProps): JSX.Element {
  const spec = typeof pose === 'string' ? POSES[pose] : pose;
  const body = spec.body;
  const split = view === 'split';
  const interactive = onSelectSlot !== undefined;
  const whole = (r: Region): boolean => slotsOf(r).length === 1;

  // the loft the sleeves and trouser legs end with: gloves and boots sit over them
  const sleeve = limbEndInflation(kit, 'torso') * ARM_LOFT;
  const trouser = limbEndInflation(kit, 'legs') * LEG_LOFT;

  // each region's stack resolved against this pose, split into the halves the view shows
  const halves = {} as Record<Region, readonly RegionHalf[]>;
  for (const r of REGION_ORDER) {
    const draws = layerDraws(regionIds(kit, r));
    const res = (ds: readonly LayerDraw[]): ResolvedLayer[] => ds.map((d) => resolve(d, spec, body[r], sleeve, trouser));
    halves[r] =
      split && !whole(r)
        ? [
            { clip: `${uid}-left`, layers: res(draws.filter((d) => slotFor(d.garment) === 'inner')) },
            { clip: `${uid}-right`, layers: res(draws.filter((d) => slotFor(d.garment) !== 'inner')) },
          ]
        : [{ clip: null, layers: res(draws) }];
  }

  return (
    <g>
      <defs>
        <clipPath id={`${uid}-left`}>
          <rect x={-40} y={-40} width={SPLIT_X + 40} height={spec.h + 80} />
        </clipPath>
        <clipPath id={`${uid}-right`}>
          <rect x={SPLIT_X} y={-40} width={spec.w - SPLIT_X + 40} height={spec.h + 80} />
        </clipPath>
        {/* a mask, not a clip path: clip paths ignore strokes, and every limb here IS a stroke */}
        <mask id={`${uid}-bodymask`} maskUnits="userSpaceOnUse" x={-40} y={-40} width={spec.w + 80} height={spec.h + 80}>
          {REGION_ORDER.map((r) => halves[r].map((h, i) => <Silhouette key={`${r}-${i}`} half={h} skin={body[r]} fill="#fff" inflation={MASK_SLACK} />))}
        </mask>
        {/*
          One mask per region for the hover/selection ring: everything *inside* the garment
          stack is knocked out, so the ring that survives is a thin contour just outside it.
          A plain stroke would straddle the path and read as a blob over the clothes.
        */}
        {REGION_ORDER.map((r) => (
          <mask
            key={`ringmask-${r}`}
            id={`${uid}-ringmask-${r}`}
            maskUnits="userSpaceOnUse"
            x={-60}
            y={-60}
            width={spec.w + 120}
            height={spec.h + 120}
          >
            <rect x={-60} y={-60} width={spec.w + 120} height={spec.h + 120} fill="#fff" />
            {halves[r].map((h, i) => (
              <Silhouette key={i} half={h} skin={body[r]} fill="#000" inflation={3.5} />
            ))}
          </mask>
        ))}
        {/* user space, not the bounding box: the light has to land on the figure, not on the layer box */}
        <linearGradient id={`${uid}-firelight`} gradientUnits="userSpaceOnUse" x1={126} y1={0} x2={250} y2={50}>
          <stop offset="0" stop-color="#ff8a3a" stop-opacity="0" />
          <stop offset="0.5" stop-color="#ff9d45" stop-opacity={lit ? 0.16 : 0.05} />
          <stop offset="1" stop-color="#ffb55e" stop-opacity={lit ? 0.42 : 0.12} />
        </linearGradient>
        {/* the rim fades in across the fire side, so it reads as light and not as an outline */}
        <linearGradient id={`${uid}-rim`} gradientUnits="userSpaceOnUse" x1={150} y1={0} x2={244} y2={40}>
          <stop offset="0" stop-color="#ff9f52" stop-opacity="0" />
          <stop offset="0.55" stop-color="#ff9a45" stop-opacity={lit ? 0.4 : 0.14} />
          <stop offset="1" stop-color="#ffc277" stop-opacity={lit ? 0.9 : 0.32} />
        </linearGradient>
        <linearGradient id={`${uid}-shadeside`} gradientUnits="userSpaceOnUse" x1={40} y1={0} x2={170} y2={0}>
          <stop offset="0" stop-color="#0b0e26" stop-opacity="0.3" />
          <stop offset="0.5" stop-color="#0b0e26" stop-opacity="0.06" />
          <stop offset="1" stop-color="#0b0e26" stop-opacity="0" />
        </linearGradient>
      </defs>

      {spec.prop}

      {/* a dark halo one step outside whatever is outermost at each point: separation from whatever is behind */}
      {REGION_ORDER.map((r) => halves[r].map((h, i) => <Silhouette key={`halo-${r}-${i}`} half={h} skin={body[r]} fill={HALO} inflation={3.5} />))}

      {/*
        The rim light. Drawn between the halo and the garments and clipped to the lit side, so
        the warm band that survives is exactly the contour of whatever is outermost there.
      */}
      <g clip-path={`url(#${uid}-right)`}>
        {REGION_ORDER.map((r) => {
          const h = halves[r][halves[r].length - 1];
          return h === undefined ? null : <Silhouette key={`rim-${r}`} half={h} skin={body[r]} fill={`url(#${uid}-rim)`} inflation={1.3} />;
        })}
      </g>

      {/* skin / silhouette under everything */}
      {REGION_ORDER.map((r) => body[r].map((part, i) => <Stroked key={`skin-${r}-${i}`} part={part} fill={SKIN} inflation={0} />))}

      {/* garments: split view clips inner left and outer right; dressed view stacks them whole */}
      {REGION_ORDER.map((r) => (
        <g key={`layers-${r}`}>
          {halves[r].map((h, i) => (
            <Layers key={i} half={h} />
          ))}
        </g>
      ))}

      {/* the light source is to the right: warm on that side, cold shade away from it */}
      <g mask={`url(#${uid}-bodymask)`}>
        <rect x={-40} y={-40} width={spec.w + 80} height={spec.h + 80} fill={`url(#${uid}-shadeside)`} />
        <rect x={-40} y={-40} width={spec.w + 80} height={spec.h + 80} fill={`url(#${uid}-firelight)`} />
      </g>

      {/* the inner | outer divide: a hairline down the body in the split view, from the neck, since the head is one slot */}
      {split && (
        <line x1={SPLIT_X} y1={spec.neckY} x2={SPLIT_X} y2={spec.h * 0.92} stroke="#f5f2ea" stroke-opacity="0.3" stroke-width="1" />
      )}

      {/* hover/selection rings, and in the split view the per-slot hit targets, last so they sit above the art */}
      {REGION_ORDER.map((r) => {
        const emphasised = selected?.region === r || hovered?.region === r;
        const outline = outlines?.[r];
        return (
          <g key={`hit-${r}`}>
            {outline !== undefined && !emphasised && (
              <g mask={`url(#${uid}-ringmask-${r})`} style={{ pointerEvents: 'none' }}>
                {halves[r].map((h, i) => (
                  <Silhouette key={`oglow-${i}`} half={h} skin={body[r]} fill={outline} inflation={15} opacity={0.18} />
                ))}
                {halves[r].map((h, i) => (
                  <Silhouette key={`oring-${i}`} half={h} skin={body[r]} fill={outline} inflation={6} opacity={0.95} />
                ))}
              </g>
            )}
            {emphasised && (
              <g mask={`url(#${uid}-ringmask-${r})`} style={{ pointerEvents: 'none' }}>
                {halves[r].map((h, i) => (
                  <Silhouette key={`glow-${i}`} half={h} skin={body[r]} fill="#ffd9a0" inflation={20} opacity={selected?.region === r ? 0.22 : 0.14} />
                ))}
                {halves[r].map((h, i) => (
                  <Silhouette key={`ring-${i}`} half={h} skin={body[r]} fill="#f5f2ea" inflation={6.5} opacity={selected?.region === r ? 0.95 : 0.65} />
                ))}
              </g>
            )}
            {interactive &&
              slotsOf(r).map((slot) => {
                const ref: SlotRef = { region: r, slot };
                const clip = whole(r) ? null : slot === 'inner' ? `${uid}-left` : `${uid}-right`;
                return (
                  <g
                    key={`hit-${r}-${slot}`}
                    role="button"
                    tabindex={0}
                    aria-pressed={selected?.region === r && selected.slot === slot}
                    aria-label={describeSlot?.(ref)}
                    clip-path={clip === null ? undefined : `url(#${clip})`}
                    onClick={() => onSelectSlot(ref)}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectSlot(ref);
                      }
                    }}
                    onMouseEnter={() => onHoverSlot?.(ref)}
                    onMouseLeave={() => onHoverSlot?.(null)}
                    onFocus={() => onHoverSlot?.(ref)}
                    onBlur={() => onHoverSlot?.(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {body[r].map((part, i) => (
                      <path
                        key={`hitpath-${r}-${slot}-${i}`}
                        className="wibc-region-hit"
                        d={part.d}
                        stroke-width={part.w + 26}
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      />
                    ))}
                  </g>
                );
              })}
          </g>
        );
      })}
    </g>
  );
}
