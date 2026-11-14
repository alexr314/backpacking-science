/**
 * Dev-harness entry only. The site mounts `WillIBeCold` directly; see `src/index.ts`.
 * `/methodology` mounts the methodology page on its own, the way a site route would.
 */
import './style.css';
import { render } from 'preact';
import { WillIBeCold } from './ui/CampEvening.js';
import { MethodologyPage } from './ui/Methodology.js';
import type { TabId } from './model/tabs.js';

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing from index.html');
if (location.pathname.replace(/\/$/, '') === '/methodology') {
  render(<MethodologyPage backHref="/?tab=evening" />, root);
} else {
  const tab = new URLSearchParams(location.search).get('tab');
  const byName: Record<string, TabId> = {
    trip: 'trip',
    gear: 'gear',
    morning: 'camp_morning',
    hiking: 'hiking',
    lunch: 'day_break',
    evening: 'camp_evening',
    sleep: 'sleep',
  };
  render(<WillIBeCold tab={byName[tab ?? 'gear'] ?? 'gear'} />, root);
}
