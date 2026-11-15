/**
 * Z's rising off a sleeping head.
 *
 * Built the way the fire's embers are, for the same reasons: a fixed table of instances on
 * staggered loops, drawn by writing attributes on a handful of nodes inside one
 * `requestAnimationFrame`, with no re-render and no layout. Nothing is random here either, so
 * the scene looks the same every time it is opened and a screenshot is a usable artefact.
 *
 * Each Z rises, drifts, tips a little, shrinks and fades. It fades in quickly at the bottom so
 * none of them pops into existence at full strength, which is the embers' trick as well.
 *
 * `prefers-reduced-motion` gets a single still Z at the top of its arc rather than nothing: the
 * point of the detail is to say "this figure is asleep", and that reads perfectly well held
 * still. Taking it away entirely would lose the meaning along with the movement.
 */

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** One Z's life: where it leans, how far it climbs, how long it takes and where in the loop it starts. */
const ZS: readonly { readonly dx: number; readonly rise: number; readonly size: number; readonly period: number; readonly offset: number; readonly tilt: number }[] = [
  { dx: 13, rise: 84, size: 20, period: 5.2, offset: 0, tilt: 14 },
  { dx: 21, rise: 104, size: 16, period: 6.6, offset: 0.38, tilt: -10 },
  { dx: 7, rise: 68, size: 13, period: 4.4, offset: 0.72, tilt: 18 },
];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export interface SleepersProps {
  readonly uid: string;
  /** How present the sleeper is, 0..1. The Z's arrive with the bag and leave with it. */
  readonly present: number;
  /** Scene units per figure unit, so the Z's are the right size against whoever is asleep. */
  readonly scale: number;
}

export function Sleepers({ uid, present, scale }: SleepersProps): JSX.Element {
  const [animate, setAnimate] = useState(() => !reducedMotion());
  const refs = useRef<(SVGTextElement | null)[]>([]);
  const t0 = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setAnimate(!mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!animate) return;
    if (t0.current === 0) t0.current = performance.now();
    let raf = 0;
    const tick = (nowMs: number): void => {
      const s = (nowMs - t0.current) / 1000;
      ZS.forEach((z, i) => {
        const el = refs.current[i];
        if (el === null || el === undefined) return;
        const u = ((s / z.period + z.offset) % 1 + 1) % 1;
        const k = z.size * scale * (1 - 0.55 * u);
        // drift is widest at the top of the climb, so the trio opens out as it goes
        const x = z.dx * scale * u;
        const y = -z.rise * scale * u;
        el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(z.tilt * u).toFixed(1)})`);
        el.setAttribute('font-size', Math.max(1, k).toFixed(2));
        el.setAttribute('opacity', (0.85 * (1 - u) * Math.min(1, u * 5)).toFixed(3));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, scale]);

  if (!animate) {
    const z = ZS[0]!;
    return (
      <g opacity={present * 0.6} aria-hidden="true">
        <text
          x={z.dx * scale * 0.5}
          y={-z.rise * scale * 0.5}
          font-size={(z.size * scale * 0.75).toFixed(2)}
          fill="#dfe6f5"
          font-weight="700"
          text-anchor="middle"
        >
          Z
        </text>
      </g>
    );
  }

  return (
    <g opacity={present} aria-hidden="true">
      {ZS.map((_, i) => (
        <text
          key={`${uid}-z-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          x={0}
          y={0}
          fill="#dfe6f5"
          font-weight="700"
          text-anchor="middle"
          opacity="0"
        >
          Z
        </text>
      ))}
    </g>
  );
}
