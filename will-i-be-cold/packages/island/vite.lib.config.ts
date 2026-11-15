/**
 * The embeddable build, for a host that is not running Preact itself.
 *
 * `vite.config.ts` builds the standalone dev harness (its own `index.html`, its own page). This
 * one builds the island as two files a plain `<script>` and `<link>` can load: Preact is bundled
 * in, nothing is left external, and the only global it defines is `WillIBeCold.mount`.
 *
 * That is what lets the Astro 2 site embed it without adding `@astrojs/preact` and without the
 * site's build ever needing to see this repository: the two built files are copied across.
 */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const sibling = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@will-i-be-cold/heat': sibling('../heat/src/index.ts'),
      '@will-i-be-cold/weather': sibling('../weather/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: sibling('./src/embed.ts'),
      name: 'WillIBeCold',
      formats: ['iife'],
      fileName: () => 'will-i-be-cold.js',
      cssFileName: 'will-i-be-cold',
    },
  },
});
