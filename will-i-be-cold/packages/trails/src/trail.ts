/**
 * A trail, decoded, and the arithmetic of being somewhere along it.
 *
 * The asset on disk is delta-encoded integers (see `tools/build-trail.mjs`); this decodes it
 * once into flat arrays and adds the one index everything else needs: cumulative distance, so a
 * position can be named by how far along the trail it is rather than by a point index, which
 * would change the moment the tolerance changed.
 *
 * Distances are metres and elevations are metres throughout, as everywhere else in this repo.
 * The miles belong to the interface.
 */

/** The shape the build tool emits. */
export interface TrailAsset {
  readonly slug: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly metres: number;
  readonly points: number;
  readonly toleranceM: number;
  readonly osmRelation: number;
  readonly osmSnapshot: string;
  readonly built: string;
  readonly licence: { readonly centreline: string; readonly elevation: string };
  readonly encoding: 'delta';
  readonly lon: readonly number[];
  readonly lat: readonly number[];
  readonly ele: readonly number[];
}

/** A point on the trail: where it is, how high, and how far along. */
export interface TrailPoint {
  readonly longitude: number;
  readonly latitude: number;
  /** Metres above sea level, from the 90 m DEM the asset was built against. */
  readonly elevation: number;
  /** Metres from the trail's `from` end. */
  readonly along: number;
}

export interface Trail {
  readonly slug: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  /** Total length, metres. */
  readonly metres: number;
  readonly osmSnapshot: string;
  readonly licence: TrailAsset['licence'];
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly ele: Float64Array;
  /** Cumulative metres from the `from` end, same length as the coordinate arrays. */
  readonly along: Float64Array;
}

const R_EARTH = 6371008.8;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle metres between two lon/lat pairs. */
export function haversine(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const p1 = rad(aLat);
  const p2 = rad(bLat);
  const dp = p2 - p1;
  const dl = rad(bLon - aLon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class TrailDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrailDataError';
  }
}

/** Undo the delta encoding and build the cumulative-distance index. */
export function decodeTrail(asset: TrailAsset): Trail {
  const n = asset.lon.length;
  if (n < 2) throw new TrailDataError(`Trail "${asset.slug}" has ${n} points.`);
  if (asset.lat.length !== n || asset.ele.length !== n) {
    throw new TrailDataError(`Trail "${asset.slug}" has mismatched arrays: ${n}/${asset.lat.length}/${asset.ele.length}.`);
  }
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const ele = new Float64Array(n);
  const along = new Float64Array(n);
  let x = 0;
  let y = 0;
  let e = 0;
  for (let i = 0; i < n; i += 1) {
    x += asset.lon[i]!;
    y += asset.lat[i]!;
    e += asset.ele[i]!;
    lon[i] = x * 1e-5;
    lat[i] = y * 1e-5;
    ele[i] = e;
    along[i] = i === 0 ? 0 : along[i - 1]! + haversine(lon[i - 1]!, lat[i - 1]!, lon[i]!, lat[i]!);
  }
  return {
    slug: asset.slug,
    name: asset.name,
    from: asset.from,
    to: asset.to,
    metres: along[n - 1]!,
    osmSnapshot: asset.osmSnapshot,
    licence: asset.licence,
    lon,
    lat,
    ele,
    along,
  };
}

/** The index of the last point at or before `metres`. Binary search; the array is monotone. */
function indexAt(trail: Trail, metres: number): number {
  const a = trail.along;
  let lo = 0;
  let hi = a.length - 1;
  if (metres <= 0) return 0;
  if (metres >= a[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! <= metres) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Where you are `metres` along the trail, interpolated between the two points either side. */
export function pointAt(trail: Trail, metres: number): TrailPoint {
  const clamped = Math.min(Math.max(metres, 0), trail.metres);
  const i = indexAt(trail, clamped);
  const d0 = trail.along[i]!;
  const d1 = trail.along[i + 1]!;
  const t = d1 > d0 ? (clamped - d0) / (d1 - d0) : 0;
  return {
    longitude: trail.lon[i]! + (trail.lon[i + 1]! - trail.lon[i]!) * t,
    latitude: trail.lat[i]! + (trail.lat[i + 1]! - trail.lat[i]!) * t,
    elevation: trail.ele[i]! + (trail.ele[i + 1]! - trail.ele[i]!) * t,
    along: clamped,
  };
}

/** The nearest point on the trail to a dropped pin, for turning a map click into a trail mile. */
export function nearestAlong(trail: Trail, longitude: number, latitude: number): TrailPoint {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < trail.lon.length; i += 1) {
    const d = haversine(longitude, latitude, trail.lon[i]!, trail.lat[i]!);
    if (d < bestD) { bestD = d; best = i; }
  }
  return pointAt(trail, trail.along[best]!);
}

/** Total climb and descent, metres, over a span of the trail. */
export function reliefBetween(trail: Trail, fromM: number, toM: number): { readonly climb: number; readonly descent: number } {
  const lo = Math.min(fromM, toM);
  const hi = Math.max(fromM, toM);
  let climb = 0;
  let descent = 0;
  let prev = pointAt(trail, lo).elevation;
  const i0 = indexAt(trail, lo) + 1;
  const i1 = indexAt(trail, hi);
  for (let i = i0; i <= i1; i += 1) {
    const e = trail.ele[i]!;
    const d = e - prev;
    if (d > 0) climb += d;
    else descent -= d;
    prev = e;
  }
  const end = pointAt(trail, hi).elevation;
  const d = end - prev;
  if (d > 0) climb += d;
  else descent -= d;
  return { climb, descent };
}
