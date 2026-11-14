/**
 * Measure an element's content width in CSS pixels.
 *
 * The chart and the scene are drawn in real pixels rather than scaled through a `viewBox`,
 * because a scaled viewBox shrinks the axis labels with the chart: at 360 px wide a 1000-unit
 * viewBox renders 12 px type at 4 px. Measuring instead keeps every label at its stated size.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export function useMeasure<T extends HTMLElement>(fallback = 900): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = (w: number): void => setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    update(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) update(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/** A box in another element's coordinates. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where an element lands inside a larger one: a grid cell's place on a backdrop that spans
 * the whole page. Both are watched for size changes; the box is in CSS pixels from the outer
 * element's top-left corner.
 */
export function useBoxWithin<T extends HTMLElement, U extends HTMLElement>(outer: RefObject<U>, fallback: Box): [RefObject<T>, Box] {
  const ref = useRef<T>(null);
  const [span, setSpan] = useState<Box>(fallback);

  useEffect(() => {
    const el = ref.current;
    const out = outer.current;
    if (el === null || out === null) return;
    const update = (): void => {
      const a = el.getBoundingClientRect();
      const b = out.getBoundingClientRect();
      const next = { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
      setSpan((prev) =>
        Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5
          ? prev
          : next,
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(out);
    return () => ro.disconnect();
  }, [outer]);

  return [ref, span];
}
