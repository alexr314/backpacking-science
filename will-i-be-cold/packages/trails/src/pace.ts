/**
 * How fast you walk, and therefore where you are at any hour of the trip.
 *
 * THE SPEED MODEL IS TOBLER'S, NOT NAISMITH'S.
 *
 *     W = 6 exp(-3.5 |S + 0.05|)   km/h,  S = dh/dx, the tangent of the slope angle
 *
 * Tobler (1993) fitted this to Imhof's measured figures for hikers on paths. Naismith's rule
 * (1892) is the better-known alternative and is worse here for three reasons: it is a flat base
 * speed plus a penalty per unit of climb, so it is a straight line where the data is a curve; it
 * treats descent as free, which anyone who has come off Katahdin knows is false and which
 * matters because a southbound and a northbound day over the same ground should not take the
 * same time; and it has no maximum. Tobler peaks at S = -0.05, a 5% downhill, which is the
 * empirical fact that a gentle descent is faster than the flat. Langmuir's corrections patch
 * the descent hole in Naismith, but then you are fitting a piecewise rule to a smooth one.
 *
 * The function is for an unladen walker on a path. A backpacker with a week of food is slower,
 * so `fitness` scales the whole curve: it is one number, it is the thing a user actually knows
 * about themselves ("I do about 2 miles an hour"), and it is calibrated by `fitnessFor` from a
 * pace the walker reports on ground they remember.
 *
 * Every speed here is metres per second. Nothing in this module knows what a mile is.
 */

/** Tobler's hiking function for an unladen walker, metres per second, from the slope `dh/dx`. */
export function toblerSpeed(slope: number): number {
  return (6000 / 3600) * Math.exp(-3.5 * Math.abs(slope + 0.05));
}

/** The slope at which Tobler is fastest: a 5% descent, not the flat. */
export const FASTEST_SLOPE = -0.05;
/** Tobler's own top speed, m/s, which is what `fitness` is a fraction of. */
export const TOBLER_PEAK = toblerSpeed(FASTEST_SLOPE);

export interface PaceModel {
  /**
   * A scale on Tobler, 1 being an unladen walker on a path. A backpacker under load is
   * typically 0.5 to 0.75; `fitnessFor` turns a remembered pace into this number.
   */
  readonly fitness: number;
  /** Hours in the day actually spent moving, which is not the same as hours between camps. */
  readonly movingHoursPerDay: number;
}

export const DEFAULT_PACE: PaceModel = { fitness: 0.62, movingHoursPerDay: 7.5 };

/**
 * The `fitness` that reproduces a remembered pace on remembered ground. Given "I walked 12 miles
 * with 3,000 feet of climb in 7 hours", this is what turns that into the one number the model
 * needs, instead of asking the walker to guess a multiplier on a function they have never seen.
 */
export function fitnessFor(distanceM: number, climbM: number, seconds: number): number {
  if (distanceM <= 0 || seconds <= 0) return DEFAULT_PACE.fitness;
  // the average slope of a there-and-back-ish day is climb spread over the distance
  const slope = climbM / distanceM;
  const unladen = (toblerSpeed(slope) + toblerSpeed(-slope)) / 2;
  const actual = distanceM / seconds;
  return Math.min(1.5, Math.max(0.15, actual / unladen));
}

/** The time, in seconds, to walk from one point of a profile to the next. */
function segmentSeconds(distanceM: number, riseM: number, fitness: number): number {
  if (distanceM <= 0) return 0;
  const speed = toblerSpeed(riseM / distanceM) * fitness;
  return distanceM / Math.max(speed, 0.05);
}

/** A sampled profile: cumulative metres along, and elevation at each. */
export interface Profile {
  readonly along: ArrayLike<number>;
  readonly ele: ArrayLike<number>;
}

/**
 * Walking time in seconds from `fromM` to `toM` along a profile, integrated segment by segment.
 * Direction matters: the same ground walked the other way is a different integral, which is the
 * whole reason for preferring Tobler.
 */
export function walkSeconds(profile: Profile, fromM: number, toM: number, fitness: number): number {
  const forward = toM >= fromM;
  const lo = forward ? fromM : toM;
  const hi = forward ? toM : fromM;
  const n = profile.along.length;
  let seconds = 0;
  let prevAlong = lo;
  let prevEle = elevationAt(profile, lo);
  for (let i = 0; i < n; i += 1) {
    const a = profile.along[i]!;
    if (a <= lo) continue;
    if (a >= hi) break;
    const e = profile.ele[i]!;
    seconds += segmentSeconds(a - prevAlong, forward ? e - prevEle : prevEle - e, fitness);
    prevAlong = a;
    prevEle = e;
  }
  const endEle = elevationAt(profile, hi);
  seconds += segmentSeconds(hi - prevAlong, forward ? endEle - prevEle : prevEle - endEle, fitness);
  return seconds;
}

/** Linear interpolation of elevation at a distance along the profile. */
export function elevationAt(profile: Profile, metres: number): number {
  const n = profile.along.length;
  if (n === 0) return 0;
  if (metres <= profile.along[0]!) return profile.ele[0]!;
  if (metres >= profile.along[n - 1]!) return profile.ele[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile.along[mid]! <= metres) lo = mid;
    else hi = mid;
  }
  const d0 = profile.along[lo]!;
  const d1 = profile.along[hi]!;
  const t = d1 > d0 ? (metres - d0) / (d1 - d0) : 0;
  return profile.ele[lo]! + (profile.ele[hi]! - profile.ele[lo]!) * t;
}

/**
 * How far you get from `fromM` in `seconds` of walking, in the given direction. Inverts
 * `walkSeconds` by marching the profile, which is exact to the segment rather than iterative.
 */
export function advance(profile: Profile, fromM: number, seconds: number, forward: boolean, fitness: number): number {
  const n = profile.along.length;
  const end = forward ? profile.along[n - 1]! : profile.along[0]!;
  let left = seconds;
  let at = fromM;
  let ele = elevationAt(profile, at);
  const step = forward ? 1 : -1;
  let i = indexFor(profile, fromM) + (forward ? 1 : 0);
  while (i >= 0 && i < n) {
    const a = profile.along[i]!;
    if (forward ? a <= at : a >= at) { i += step; continue; }
    const e = profile.ele[i]!;
    const d = Math.abs(a - at);
    // the rise is always destination minus origin: `advance` marches in the direction of
    // travel, unlike `walkSeconds`, which always walks the profile from low to high and so has
    // to flip the sign itself. Getting this backwards made a climb read as a descent and put
    // the walker a kilometre past where they would actually be.
    const t = segmentSeconds(d, e - ele, fitness);
    if (t >= left) return at + step * d * (t > 0 ? left / t : 0);
    left -= t;
    at = a;
    ele = e;
    i += step;
  }
  return end;
}

function indexFor(profile: Profile, metres: number): number {
  const n = profile.along.length;
  let lo = 0;
  let hi = n - 1;
  if (metres <= profile.along[0]!) return 0;
  if (metres >= profile.along[n - 1]!) return n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile.along[mid]! <= metres) lo = mid;
    else hi = mid;
  }
  return lo;
}
