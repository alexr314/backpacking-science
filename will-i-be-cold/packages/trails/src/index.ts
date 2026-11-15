/**
 * Long trails: a centreline with its elevation profile, and the arithmetic of walking it.
 *
 * The assets in `data/` are built by `tools/build-trail.mjs` and carry their own licence
 * notices, which must travel with the data: the centrelines are derived from OpenStreetMap
 * under ODbL 1.0 and the elevations are Open-Meteo's under CC BY 4.0.
 */
export {
  decodeTrail,
  haversine,
  nearestAlong,
  pointAt,
  reliefBetween,
  TrailDataError,
  type Trail,
  type TrailAsset,
  type TrailPoint,
} from './trail.js';

export {
  advance,
  DEFAULT_PACE,
  elevationAt,
  FASTEST_SLOPE,
  fitnessFor,
  TOBLER_PEAK,
  toblerSpeed,
  walkSeconds,
  type PaceModel,
  type Profile,
} from './pace.js';
