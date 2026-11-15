/**
 * The campfire: the roadmap's R8 for the sunset panel, R10's switch, and R16's ignition.
 * `lit` is the same control that puts the radiant source into the model.
 *
 * ONE PARAMETRIC FLAME. The three static flame shapes the scene used to stack (core, mid,
 * outer) are kept, verbatim, as the keyframes of a single shape. Each instance of that shape
 * lives for one period: it grows from nothing into the core silhouette, morphs into the mid
 * one, then into the outer one, and fades out: white, to yellow, to orange, across that life.
 * Several instances run staggered against each other on a loop, so they fold over one
 * another continuously, youngest (small, white) drawn on top of oldest (tall, orange).
 *
 * The three silhouettes have different segment counts (the outer one has two tongues), so
 * each is written here as the same topology: base, up the left side to a tip, a "notch"
 * cubic from that tip to a second tip, down the right side to the base. For the core and mid
 * shapes the notch is a degenerate cubic (all four points on the one tip), so lerping it
 * towards the outer shape opens the dip between the two tongues rather than inventing a
 * fourth silhouette. Interpolation is a straight lerp of the ten control points with a
 * linear (un-eased) interpolation between keyframes; a small sway, proportional to height,
 * keeps the licks from being rigid. Nothing is random: every offset is a fixed table.
 *
 * IGNITION AND EXTINCTION (R16). An instance is drawn only if its current life *began* while
 * the fire was lit. Lighting the fire therefore shows nothing until the next instance is
 * born, and then one more each stagger, so the fire builds in over one period; putting it
 * out stops new births and lets every living instance finish its life and fade on its own
 * time. Nothing is cut short. The logs are the scene's `present` and fade in before the
 * flames, because the flames wait for them.
 *
 * Drawn on `requestAnimationFrame`, writing `d`, `fill` and `opacity` directly onto a handful
 * of `<path>`s and `<circle>`s: no re-render, no layout. `prefers-reduced-motion` gets the
 * static three-flame treatment this replaces, switched rather than grown.
 */

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

type Pt = readonly [number, number];
/** M p0 · C c c p1 · C c c p2 · C c c p0: ten points. */
type Silhouette = readonly [Pt, Pt, Pt, Pt, Pt, Pt, Pt, Pt, Pt, Pt];

const BASE: Pt = [60, 120];

/** Nothing: the whole shape collapsed to the base of the fire. */
const NONE: Silhouette = [BASE, BASE, BASE, BASE, BASE, BASE, BASE, BASE, BASE, BASE];
/** Was `M60 118 C 46 106, 45 84, 59 54 C 73 84, 72 106, 60 118 Z`. */
const CORE: Silhouette = [[60, 118], [46, 106], [45, 84], [59, 54], [59, 54], [59, 54], [59, 54], [73, 84], [72, 106], [60, 118]];
/** Was `M60 120 C 32 102, 30 66, 58 24 C 84 64, 82 102, 60 120 Z`. */
const MID: Silhouette = [[60, 120], [32, 102], [30, 66], [58, 24], [58, 24], [58, 24], [58, 24], [84, 64], [82, 102], [60, 120]];
/** Was `M60 122 C 16 98, 14 54, 48 2 C 48 36, 66 36, 72 14 C 104 54, 102 100, 60 122 Z`. */
const OUT: Silhouette = [[60, 122], [16, 98], [14, 54], [48, 2], [48, 36], [66, 36], [72, 14], [104, 54], [102, 100], [60, 122]];

type Rgb = readonly [number, number, number];
const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** The life of one instance: at `t`, which silhouette and which colour. */
const KEYS: readonly { readonly t: number; readonly shape: Silhouette; readonly colour: Rgb }[] = [
  { t: 0, shape: NONE, colour: rgb('#ffffff') },
  { t: 0.22, shape: CORE, colour: rgb('#fff6dc') },
  { t: 0.5, shape: MID, colour: rgb('#ffc34d') },
  { t: 0.78, shape: OUT, colour: rgb('#ff7a2b') },
  { t: 1, shape: OUT, colour: rgb('#d93a1e') },
];

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

interface FlameFrame {
  readonly d: string;
  readonly fill: string;
  readonly opacity: number;
}

/**
 * The flame at life fraction `t` in [0, 1). `swayPhase` is the instance's own wobble phase in
 * radians; `dx` shifts the whole lick so staggered instances do not stand in one column.
 */
function flameAt(t: number, swayPhase: number, dx: number): FlameFrame {
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1]!.t) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  // Linear between keyframes, deliberately un-eased: constant-rate growth reads calmer
  // than smoothstep, which pauses at every key and makes the loop feel like it breathes.
  const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const sway = 4 * Math.sin(swayPhase);
  const pts = a.shape.map(([ax, ay], k) => {
    const [bx, by] = b.shape[k]!;
    const x = lerp(ax, bx, u);
    const y = lerp(ay, by, u);
    // sway grows with height above the base, so the root stays planted and the tip wanders
    const h = Math.max(0, (BASE[1] - y) / BASE[1]);
    return [x + dx + sway * h * h, y] as const;
  });
  const f = (p: readonly [number, number]): string => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  const d =
    `M ${f(pts[0]!)} C ${f(pts[1]!)}, ${f(pts[2]!)}, ${f(pts[3]!)}` +
    ` C ${f(pts[4]!)}, ${f(pts[5]!)}, ${f(pts[6]!)}` +
    ` C ${f(pts[7]!)}, ${f(pts[8]!)}, ${f(pts[9]!)} Z`;
  const c = a.colour.map((v, k) => Math.round(lerp(v, b.colour[k]!, u)));
  // in over the first tenth, out over the last fifth; the fade is the end of the life
  const opacity = 0.95 * Math.min(1, t / 0.1) * (t < 0.78 ? 1 : 1 - (t - 0.78) / 0.22);
  return { d, fill: `rgb(${c[0]} ${c[1]} ${c[2]})`, opacity };
}

/**
 * One instance per entry: when in the loop it starts (fraction of a period), and its lean.
 * The spawn offsets were 0, -5, 4, -2; the client asked for half the variance in spawn
 * position, so each is scaled by 1/sqrt(2) (variance goes with the square of the spread).
 */
const SPAWN_SPREAD = Math.SQRT1_2;
const INSTANCES: readonly { readonly offset: number; readonly dx: number; readonly phase: number }[] = [
  { offset: 0, dx: 0, phase: 0 },
  { offset: 0.25, dx: -5 * SPAWN_SPREAD, phase: 2.1 },
  { offset: 0.5, dx: 4 * SPAWN_SPREAD, phase: 4.2 },
  { offset: 0.75, dx: -2 * SPAWN_SPREAD, phase: 1.2 },
];
/** Seconds for one flame to live its whole life. */
const PERIOD = 2.8;
/** The whole animation runs at this fraction of its original rate: the client asked for half speed. */
const SPEED = 0.5;

/**
 * Particles: rising, shrinking, fading. Fixed tables, so the fire is the same fire every time.
 * `rise` and `period` were scaled together (x4), which quadruples both how high an ember
 * climbs and how long it lives while leaving its rise *speed* exactly as it was.
 */
/** How many of the embers keep rising once the flame is out. Enough to read as alive, not as a fire. */
const DYING_EMBERS = 3;

const PARTICLES: readonly { readonly x: number; readonly rise: number; readonly r: number; readonly period: number; readonly offset: number; readonly sway: number }[] = [
  { x: 52, rise: 480, r: 2.2, period: 9.6, offset: 0, sway: 5 },
  { x: 70, rise: 560, r: 1.8, period: 12.4, offset: 0.4, sway: -6 },
  { x: 40, rise: 380, r: 1.6, period: 8.0, offset: 0.7, sway: 4 },
  { x: 84, rise: 440, r: 1.9, period: 10.8, offset: 0.15, sway: -4 },
  { x: 60, rise: 640, r: 2.4, period: 13.6, offset: 0.55, sway: 7 },
  { x: 32, rise: 320, r: 1.4, period: 8.8, offset: 0.3, sway: 3 },
  { x: 92, rise: 360, r: 1.5, period: 10.0, offset: 0.85, sway: -5 },
  { x: 64, rise: 500, r: 1.7, period: 11.6, offset: 0.1, sway: -3 },
  { x: 48, rise: 420, r: 1.3, period: 8.4, offset: 0.65, sway: 6 },
];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export interface FireProps {
  readonly uid: string;
  /** Whether the fire is burning. Off: logs and dim embers, no new flames. */
  readonly lit: boolean;
  /** How present the hearth is, 0..1: the logs' opacity. The flames wait for the logs. */
  readonly present: number;
}

/** A life that began inside [ignited, extinguished) is a flame that was lit. */
function wasLit(birth: number, ignited: number | null, extinguished: number | null): boolean {
  if (ignited === null || birth < ignited) return false;
  return extinguished === null || birth < extinguished;
}

export function Fire({ uid, lit, present }: FireProps): JSX.Element {
  const [animate, setAnimate] = useState(() => !reducedMotion());
  const flameRefs = useRef<(SVGPathElement | null)[]>([]);
  const particleRefs = useRef<(SVGCircleElement | null)[]>([]);
  /** The slowed clock the fire runs on, and when it was last lit and put out on that clock. */
  const clock = useRef<{ t0: number; ignited: number | null; extinguished: number | null }>({ t0: 0, ignited: null, extinguished: null });
  const ready = present >= 0.9;
  const burning = lit && ready;
  /** Logs on the ground with no flame on them: the night scene. */
  const emberOnly = ready && !lit;

  // follow the OS setting if it changes while the panel is open
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setAnimate(!mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!animate) return;
    const c = clock.current;
    if (c.t0 === 0) c.t0 = performance.now();
    const now = ((performance.now() - c.t0) / 1000) * SPEED;
    if (burning) {
      c.ignited = now;
      c.extinguished = null;
    } else if (c.ignited !== null && c.extinguished === null) {
      c.extinguished = now;
    }
  }, [animate, burning]);

  useEffect(() => {
    if (!animate) return;
    const c = clock.current;
    if (c.t0 === 0) c.t0 = performance.now();
    let raf = 0;
    const tick = (nowMs: number): void => {
      // every clock below (flame life, sway, embers) reads this one slowed second
      const s = ((nowMs - c.t0) / 1000) * SPEED;
      // The paths are interchangeable, so paint order is handled by writing the oldest
      // instance's frame to the first path and the youngest's to the last: the small white
      // lick is always on top of the tall orange one, with no DOM reordering.
      const order = INSTANCES.map((inst) => ({ inst, t: (s / PERIOD + inst.offset) % 1 })).sort((a, b) => b.t - a.t);
      let anyAlive = false;
      order.forEach(({ inst, t }, z) => {
        const el = flameRefs.current[z];
        if (el === null || el === undefined) return;
        const alive = wasLit(s - t * PERIOD, c.ignited, c.extinguished);
        if (!alive) {
          el.setAttribute('opacity', '0');
          return;
        }
        anyAlive = true;
        const frame = flameAt(t, s * 3.1 + inst.phase, inst.dx);
        el.setAttribute('d', frame.d);
        el.setAttribute('fill', frame.fill);
        el.setAttribute('opacity', frame.opacity.toFixed(3));
      });
      PARTICLES.forEach((pt, i) => {
        const el = particleRefs.current[i];
        if (el === null || el === undefined) return;
        const u = (s / pt.period + pt.offset) % 1;
        const flaming = wasLit(s - u * pt.period, c.ignited, c.extinguished);
        /**
         * A fire that is out is not a fire that is gone. The night scene keeps its logs (the
         * tab asks for the hearth without the flame, and its own caption says "the fire out to
         * a few embers"), and a bed of coals throws the odd spark for hours. So when the hearth
         * is present but unlit, the first few embers still rise: fewer of them, dimmer, and not
         * as far, since there is no column of hot air left to carry them.
         */
        const dying = !flaming && emberOnly && i < DYING_EMBERS;
        if (!flaming && !dying) {
          el.setAttribute('opacity', '0');
          return;
        }
        anyAlive = anyAlive || flaming;
        const rise = flaming ? pt.rise : pt.rise * 0.34;
        const peak = flaming ? 0.85 : 0.4;
        el.setAttribute('cx', (pt.x + pt.sway * Math.sin(u * Math.PI * 2 + i)).toFixed(1));
        el.setAttribute('cy', (112 - u * rise).toFixed(1));
        el.setAttribute('r', (pt.r * (1 - u) * (flaming ? 1 : 0.8)).toFixed(2));
        el.setAttribute('opacity', (peak * (1 - u) * Math.min(1, u * 6)).toFixed(3));
      });
      // keep ticking while lit, or while anything born before it went out is still living
      if (burning || emberOnly || anyAlive || (c.extinguished !== null && s - c.extinguished < 14)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, burning, emberOnly]);

  const emberStyle = { transition: 'opacity 1800ms ease' };

  return (
    <g opacity={present}>
      {/* logs */}
      <g>
        <rect x={10} y={110} width={100} height={14} rx={7} fill="#2a1d21" transform="rotate(-7 60 117)" />
        <rect x={16} y={114} width={88} height={12} rx={6} fill="#1b1318" transform="rotate(9 60 120)" />
        <rect x={30} y={100} width={62} height={11} rx={5.5} fill="#3d2621" transform="rotate(-20 60 106)" />
        {/* embers in the log pile: a bed of coals when lit, a few dull points when not */}
        <ellipse cx={60} cy={116} rx={26} ry={6} fill="#ff7a2b" opacity={burning ? 0.55 : 0.16} style={emberStyle} />
        <ellipse cx={60} cy={116} rx={14} ry={3.5} fill="#ffc34d" opacity={burning ? 0.7 : 0.1} style={emberStyle} />
        {(
          [
            [48, 115, 2.2, 0.5],
            [63, 118, 1.7, 0.42],
            [74, 113, 1.4, 0.36],
          ] as const
        ).map(([cx, cy, r, o]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#ff7a2b" opacity={burning ? 0 : o} style={emberStyle} />
        ))}
      </g>
      {animate ? (
        <>
          <g>
            {INSTANCES.map((_, i) => (
              <path
                key={i}
                ref={(el) => {
                  flameRefs.current[i] = el;
                }}
                d=""
                fill="#fff"
                opacity="0"
              />
            ))}
          </g>
          {PARTICLES.map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                particleRefs.current[i] = el;
              }}
              cx={60}
              cy={112}
              r={0}
              fill="#ffc34d"
              opacity="0"
            />
          ))}
        </>
      ) : burning ? (
        <>
          {/* the three keyframes at rest, outermost first: the pre-animation flame */}
          <path
            d="M60 122 C 16 98, 14 54, 48 2 C 48 36, 66 36, 72 14 C 104 54, 102 100, 60 122 Z"
            fill={`url(#${uid}-flame-out)`}
            opacity="0.95"
          />
          <path d="M60 120 C 32 102, 30 66, 58 24 C 84 64, 82 102, 60 120 Z" fill={`url(#${uid}-flame-mid)`} />
          <path d="M60 118 C 46 106, 45 84, 59 54 C 73 84, 72 106, 60 118 Z" fill={`url(#${uid}-flame-core)`} />
          {(
            [
              [34, 44, 1.9, 0.5],
              [88, 32, 1.5, 0.45],
              [74, 8, 2.2, 0.55],
              [44, -6, 1.6, 0.35],
              [98, 60, 1.7, 0.3],
              [20, 72, 1.4, 0.28],
              [82, -18, 1.3, 0.22],
            ] as const
          ).map(([cx, cy, r, o]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#ffc34d" opacity={o} />
          ))}
        </>
      ) : null}
    </g>
  );
}
