/**
 * Move a value toward a target over time.
 *
 * The scene is one world evaluated at a point in a parameter space (sun progress, pose
 * geometry, which props are present), so a transition between two tabs is a path through that
 * space rather than code per pair of tabs. This hook walks the path: whenever `target` changes
 * it starts again *from wherever the value is now*, so a tab change mid-transition turns
 * smoothly instead of jumping back. `lerp(a, b, u)` is the caller's, because some fields are
 * cyclic (the sun's progress) and some are whole geometries.
 *
 * A new target with a duration of 0 is a *retarget*: if a walk is under way it is redirected
 * (same start, same clock, new destination) rather than cut short, and only when nothing is
 * moving does it snap. The scene needs this because a tab's cell is re-measured a frame after
 * the tab changes, and that re-measure must not end the walk the tab change began.
 *
 * `prefers-reduced-motion` cuts straight to the destination.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function useTween<T>(target: T, lerp: (a: T, b: T, u: number) => T, durationMs: number, same: (a: T, b: T) => boolean): T {
  const [value, setValue] = useState<T>(target);
  const live = useRef<T>(target);
  const run = useRef<{ from: T; to: T; t0: number; ms: number } | null>(null);
  // Read at the moment a new target arrives, so a caller can ask for a retarget (duration 0)
  // for one change without disturbing a walk already under way.
  const duration = useRef(durationMs);
  duration.current = durationMs;

  useEffect(() => {
    const ms = duration.current;
    if (same(live.current, target)) {
      run.current = null;
      return;
    }
    const inFlight = run.current;
    if (reducedMotion() || (ms <= 0 && inFlight === null)) {
      live.current = target;
      run.current = null;
      setValue(target);
      return;
    }
    // a retarget mid-walk keeps the walk's start and clock and swaps its destination
    run.current = ms <= 0 && inFlight !== null ? { ...inFlight, to: target } : { from: live.current, to: target, t0: performance.now(), ms };
    let raf = 0;
    const tick = (now: number): void => {
      const r = run.current;
      if (r === null) return;
      const u = Math.min(1, (now - r.t0) / r.ms);
      const next = u >= 1 ? r.to : lerp(r.from, r.to, easeInOut(u));
      live.current = next;
      setValue(next);
      if (u < 1) raf = requestAnimationFrame(tick);
      else run.current = null;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `lerp` and `same` are stable module functions in every caller; the duration is read
    // through its ref so that changing it never restarts a walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
