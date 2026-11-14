/**
 * Sunrise and sunset, for the manual path only.
 *
 * In forecast and climatology mode we use the `daily=sunrise,sunset` values the API already
 * returns. Manual mode has no API call, so it needs its own sun times to anchor the phase
 * windows: otherwise "camp evening starts at sunset" would have to fall back to a fixed clock
 * time and the manual output would stop matching the forecast output.
 *
 * This is the standard low-precision sunrise equation (Meeus, *Astronomical Algorithms*, as
 * tabulated on the Wikipedia "Sunrise equation" page), good to about a minute at mid latitudes,
 * which is far inside the hour we quantise everything to anyway. `solar.test.ts` checks it against
 * the recorded Open-Meteo sunrise/sunset for the Smokies fixture.
 */

import { formatLocal, parseLocalDate, type LocalMinutes } from './localtime.js';

const RAD = Math.PI / 180;
/** Solar disc centre at −0.833° accounts for refraction plus the semi-diameter of the disc. */
const SOLAR_ZENITH_DEG = -0.833;
const OBLIQUITY_DEG = 23.4397;
const J2000 = 2451545.0;

function daysFromCivilUtc(dateIso: string): number {
  // parseLocalDate returns naive minutes since 1970-01-01T00:00; divide out to whole days.
  return parseLocalDate(dateIso) / 1440;
}

export interface SunTimes {
  /** Naive local `YYYY-MM-DDTHH:mm`. */
  sunrise: string;
  sunset: string;
  /** True when the sun never rises or never sets on that date: both times collapse to local noon. */
  polar: boolean;
}

/**
 * @param dateIso       local calendar date, `YYYY-MM-DD`
 * @param latitude      degrees north
 * @param longitude     degrees east (negative for west)
 * @param utcOffsetHours the location's offset from UTC on that date. If omitted we use the
 *                       longitudinal mean (`longitude / 15`), which is the right answer for solar
 *                       time and within half an hour of civil time nearly everywhere.
 */
export function sunTimes(
  dateIso: string,
  latitude: number,
  longitude: number,
  utcOffsetHours?: number,
): SunTimes {
  const offset = utcOffsetHours ?? longitude / 15;
  const jDate = daysFromCivilUtc(dateIso) + 2440587.5 - offset / 24 + 0.5;

  const lw = -longitude;
  const n = Math.round(jDate - J2000 - 0.0009 - lw / 360);
  const jStar = J2000 + 0.0009 + lw / 360 + n;
  const M = (357.5291 + 0.98560028 * (jStar - J2000)) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDelta = Math.sin(lambda * RAD) * Math.sin(OBLIQUITY_DEG * RAD);
  const cosDelta = Math.sqrt(1 - sinDelta * sinDelta);

  const cosOmega =
    (Math.sin(SOLAR_ZENITH_DEG * RAD) - Math.sin(latitude * RAD) * sinDelta) / (Math.cos(latitude * RAD) * cosDelta);

  const dayStart = parseLocalDate(dateIso);
  if (cosOmega > 1 || cosOmega < -1) {
    const noon = formatLocal(dayStart + 12 * 60);
    return { sunrise: noon, sunset: noon, polar: true };
  }

  const omega = Math.acos(cosOmega) / RAD;
  const jRise = jTransit - omega / 360;
  const jSet = jTransit + omega / 360;

  return {
    sunrise: formatLocal(julianToLocalMinutes(jRise, offset, dayStart)),
    sunset: formatLocal(julianToLocalMinutes(jSet, offset, dayStart)),
    polar: false,
  };
}

function julianToLocalMinutes(julian: number, offsetHours: number, dayStart: LocalMinutes): LocalMinutes {
  const minutesSinceEpochUtc = (julian - 2440587.5) * 1440;
  const local = Math.round(minutesSinceEpochUtc + offsetHours * 60);
  // Keep the result on the requested local date: the equation can land a few minutes either side
  // of midnight at extreme latitudes.
  return Math.min(Math.max(local, dayStart), dayStart + 1439);
}
