/**
 * Colour mixing for the scene, in OKLab.
 *
 * The sky, the ridges and the clouds are keyframed by the sun's altitude and interpolated
 * between keyframes; mixing in sRGB turns a violet-to-amber crossfade grey in the middle,
 * and OKLab does not. Every function here is pure and takes `#rrggbb`.
 */

type Lab = readonly [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToLab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 0xff) / 255);
  const g = toLinear(((n >> 8) & 0xff) / 255);
  const b = toLinear((n & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function labToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const ch = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, toSrgb(v))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(bb)}`;
}

const cache = new Map<string, Lab>();
function lab(hex: string): Lab {
  let v = cache.get(hex);
  if (v === undefined) {
    v = hexToLab(hex);
    cache.set(hex, v);
  }
  return v;
}

/** `a` at u = 0, `b` at u = 1. */
export function mixHex(a: string, b: string, u: number): string {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const x = lab(a);
  const y = lab(b);
  return labToHex([x[0] + (y[0] - x[0]) * u, x[1] + (y[1] - x[1]) * u, x[2] + (y[2] - x[2]) * u]);
}

/**
 * The colour pulled toward grey: chroma scaled down by `u` (1 is fully grey) with its
 * lightness nudged by `dL`. The overcast sky is built from this: the same ridges and ground,
 * their colour drained rather than replaced.
 */
export function greyHex(hex: string, u: number, dL = 0): string {
  if (u <= 0 && dL === 0) return hex;
  const [L, a, b] = lab(hex);
  const k = 1 - Math.max(0, Math.min(1, u));
  return labToHex([L + dL, a * k, b * k]);
}

/**
 * A keyframed colour: `[key, hex]` pairs sorted by key, evaluated at `at` by piecewise OKLab
 * interpolation, clamped at the ends.
 */
export function keyedHex(frames: readonly (readonly [number, string])[], at: number): string {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) return '#000000';
  if (at <= first[0]) return first[1];
  if (at >= last[0]) return last[1];
  for (let i = 1; i < frames.length; i++) {
    const hi = frames[i]!;
    if (at <= hi[0]) {
      const lo = frames[i - 1]!;
      return mixHex(lo[1], hi[1], (at - lo[0]) / (hi[0] - lo[0]));
    }
  }
  return last[1];
}
