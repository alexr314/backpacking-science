/**
 * Mounting without a framework, for a host that is not already running Preact.
 * The Astro path does not need this: `<WillIBeCold client:visible />` is enough.
 */
import { h, render } from 'preact';
import { WillIBeCold, type WillIBeColdProps } from './ui/CampEvening.js';

export function mountWillIBeCold(target: Element, props: WillIBeColdProps = {}): () => void {
  render(h(WillIBeCold, props), target);
  return () => render(null, target);
}

/** @deprecated Use `mountWillIBeCold`. */
export const mountCampEvening = mountWillIBeCold;
