import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const sibling = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * The sibling packages are consumed from source rather than from a built `dist`, so the
 * harness picks up engine changes without a build step and nothing in `packages/heat` or
 * `packages/weather` has to be touched to run this.
 */
export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@will-i-be-cold/heat': sibling('../heat/src/index.ts'),
      '@will-i-be-cold/weather': sibling('../weather/src/index.ts'),
    },
  },
  server: {
    fs: { allow: [sibling('..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  root: here,
});
