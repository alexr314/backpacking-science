/**
 * Test-only fixture loader. Fixtures are verbatim recordings of real Open-Meteo responses;
 * `fixtures/manifest.json` records the exact URL and UTC timestamp of every one of them.
 * Re-record with `npm run record`: never from the test run, so a shape change is a reviewable diff.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export interface FixtureManifest {
  recordedAtUtc: string;
  testPoint: { latitude: number; longitude: number; assumedTrailElevationMetres: number };
  attribution: string;
  climatologyYears: number[];
  files: Record<string, { url: string; httpStatus: number; fetchedAtUtc: string; note: string }>;
}

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

export function manifest(): FixtureManifest {
  return loadFixture<FixtureManifest>('manifest.json');
}

/**
 * Canonical form of a URL: query parameters sorted by name. The recorder and the client build
 * the same requests but not necessarily in the same parameter order, and a fixture should match
 * on *what was asked for*, not on the order the string happened to be assembled in.
 */
export function canonicalUrl(url: string): string {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${u.origin}${u.pathname}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** A `FetchJson` that serves the recorded fixtures by URL and throws on anything else. */
export function fixtureFetchJson(map: Record<string, string>): (url: string) => Promise<unknown> {
  const canonical: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) canonical[canonicalUrl(k)] = v;
  return async (url: string) => {
    const file = canonical[canonicalUrl(url)];
    if (!file) {
      throw new Error(`no fixture recorded for URL:\n  ${canonicalUrl(url)}\nknown:\n  ${Object.keys(canonical).join('\n  ')}`);
    }
    return loadFixture(file);
  };
}

/** URL -> fixture-file map for every recorded response, straight from the manifest. */
export function allFixtureUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [file, meta] of Object.entries(manifest().files)) out[meta.url] = file;
  return out;
}

export const CLIMATOLOGY_YEARS = manifest().climatologyYears;
export const TEST_POINT = manifest().testPoint;
