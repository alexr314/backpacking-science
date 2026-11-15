/**
 * Mounting without a framework, for a host that is not already running Preact.
 * The Astro path does not need this: `<WillIBeCold client:visible />` is enough.
 */
import { h, render } from 'preact';
import { WillIBeCold, type WillIBeColdProps } from './ui/CampEvening.js';
import { MethodologyPage, type MethodologyPageProps } from './ui/Methodology.js';

export function mountWillIBeCold(target: Element, props: WillIBeColdProps = {}): () => void {
  render(h(WillIBeCold, props), target);
  return () => render(null, target);
}

/**
 * The methodology on its own route, for a host that gives it its own page. The panel's "See our
 * methodology" link is `methodologyHref`; this is what sits at the other end of it.
 */
export function mountMethodology(target: Element, props: MethodologyPageProps = {}): () => void {
  render(h(MethodologyPage, props), target);
  return () => render(null, target);
}

/** @deprecated Use `mountWillIBeCold`. */
export const mountCampEvening = mountWillIBeCold;
