/**
 * The entry for the embeddable build (`vite.lib.config.ts`), and the only place the island's
 * stylesheet is pulled into a bundle.
 *
 * The package's normal entries deliberately leave `style.css` to the host: a site already
 * running a bundler imports `@will-i-be-cold/island/style.css` itself, next to its own CSS. An
 * embedding host has no bundler in the loop, so this entry carries the styles with it and the
 * page needs nothing but the two built files.
 */
import './style.css';

export { mountWillIBeCold, mountMethodology } from './mount.js';
export type { WillIBeColdProps } from './ui/CampEvening.js';
export type { MethodologyPageProps } from './ui/Methodology.js';
