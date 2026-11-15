/**
 * From "I am walking this trail between these two points on these dates" to "here is where you
 * are, and how high, at each phase of each day". That is the whole job of this module, and it is
 * what lets the forecast be made for the ground you are actually standing on.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The panel already insists that a forecast is made for a
 * point and a height, never the nearest town, because Open-Meteo lapse-corrects from its model
 * terrain to the elevation you give it, and at the Smokies test point that correction is worth
 * 2 to 3.5 degrees. Until now the whole trip shared one point. On a trail it should not: a day
 * that ends on a ridge and a day that ends in a gap are different nights, and the gap is both
 * colder by lapse rate and colder again by cold-air drainage. Giving each night its own point
 * and its own height is the difference between modelling a trip and modelling a place.
 *
 * TWO POINTS PER DAY, NOT FIVE. Each day is sampled at its camp and at its midpoint by walking
 * time. Camp carries the evening, the night and the next morning; the midpoint carries the day's
 * walking and the lunch stop. Open-Meteo takes many locations in one request, so a week is still
 * one call, but there is no sense asking for five points a day when the phases come in two
 * groups and the trail between them is a smooth interpolation anyway.
 */

import { pointAt, reliefBetween, type Trail, type TrailPoint } from './trail.js';
import { advance, walkSeconds, type PaceModel } from './pace.js';

/** Which way along the trail, since the same ground is a different walk each way. */
export type Direction = 'northbound' | 'southbound';

export interface RouteSpec {
  /** Metres along the trail where the walk starts, from the trail's `from` end. */
  readonly startM: number;
  /** Metres along where it ends. May be less than `startM`: that is a southbound walk. */
  readonly endM: number;
  /** First morning, `YYYY-MM-DD`. */
  readonly startDate: string;
  /** Hour of the day walking begins, local, e.g. 8 for 08:00. */
  readonly startHour: number;
  readonly pace: PaceModel;
}

/** One day of the walk, with the points its phases are forecast at. */
export interface RouteDay {
  /** `YYYY-MM-DD`, the date of the day's walking. */
  readonly date: string;
  /** Where the day starts: the previous night's camp, or the trailhead on day one. */
  readonly start: TrailPoint;
  /** Where the day ends and the night is spent. */
  readonly camp: TrailPoint;
  /** Halfway through the day by walking time, which is where the lunch stop and the trail are. */
  readonly midday: TrailPoint;
  /** Metres walked. */
  readonly distance: number;
  readonly climb: number;
  readonly descent: number;
  /** Seconds actually moving, before any breaks. */
  readonly movingSeconds: number;
  /** True when this is the last day and the walk ends mid-afternoon rather than at dusk. */
  readonly arrives: boolean;
}

export interface RoutePlan {
  readonly trail: string;
  readonly direction: Direction;
  readonly days: readonly RouteDay[];
  /** Metres from `startM` to `endM`. */
  readonly distance: number;
  readonly climb: number;
  readonly descent: number;
  /** The nights, which is one fewer than the sample points and is what the weather is pooled over. */
  readonly nights: number;
}

export class RoutePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutePlanError';
  }
}

/** `YYYY-MM-DD` plus whole days, in UTC so no local DST shift can move a date. */
function addDays(date: string, days: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/** The most days a plan may run to, so a bad pace cannot spin out a thru-hike's worth of days. */
const MAX_DAYS = 60;

/**
 * Walk the trail day by day, spending `movingHoursPerDay` on the move, and record where each day
 * starts, breaks and camps. The last day is short: you arrive when you arrive.
 */
export function planRoute(trail: Trail, spec: RouteSpec): RoutePlan {
  const { startM, endM, pace } = spec;
  if (!Number.isFinite(startM) || !Number.isFinite(endM)) throw new RoutePlanError('Route endpoints must be numbers.');
  if (startM < 0 || endM < 0 || startM > trail.metres || endM > trail.metres) {
    throw new RoutePlanError(`Route runs outside ${trail.name}, which is ${(trail.metres / 1000).toFixed(0)} km long.`);
  }
  if (startM === endM) throw new RoutePlanError('The route starts and ends in the same place.');
  if (pace.fitness <= 0) throw new RoutePlanError('Pace fitness must be positive.');
  if (pace.movingHoursPerDay <= 0) throw new RoutePlanError('A walking day must have some hours in it.');

  const forward = endM > startM;
  const profile = { along: trail.along, ele: trail.ele };
  const perDay = pace.movingHoursPerDay * 3600;

  const days: RouteDay[] = [];
  let at = startM;
  for (let d = 0; d < MAX_DAYS; d += 1) {
    const remaining = walkSeconds(profile, at, endM, pace.fitness);
    const arrives = remaining <= perDay;
    const seconds = arrives ? remaining : perDay;
    const to = arrives ? endM : advance(profile, at, seconds, forward, pace.fitness);
    const half = advance(profile, at, seconds / 2, forward, pace.fitness);
    const relief = reliefBetween(trail, at, to);
    days.push({
      date: addDays(spec.startDate, d),
      start: pointAt(trail, at),
      camp: pointAt(trail, to),
      midday: pointAt(trail, half),
      distance: Math.abs(to - at),
      climb: relief.climb,
      descent: relief.descent,
      movingSeconds: seconds,
      arrives,
    });
    at = to;
    if (arrives) break;
  }
  if (days.length === MAX_DAYS && !days[days.length - 1]!.arrives) {
    throw new RoutePlanError(`That route needs more than ${MAX_DAYS} days at this pace. Shorten it, or walk for longer each day.`);
  }

  const whole = reliefBetween(trail, startM, endM);
  return {
    trail: trail.slug,
    direction: forward ? 'northbound' : 'southbound',
    days,
    distance: Math.abs(endM - startM),
    climb: whole.climb,
    descent: whole.descent,
    nights: Math.max(0, days.length - 1),
  };
}

/**
 * The distinct points a plan needs forecasts for, in a stable order: each day's camp, then each
 * day's midday. One request covers all of them.
 */
export function forecastPoints(plan: RoutePlan): readonly TrailPoint[] {
  return [...plan.days.map((d) => d.camp), ...plan.days.map((d) => d.midday)];
}
