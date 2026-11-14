#!/usr/bin/env node
/**
 * Measure, rather than assume, HOW FORECAST ERROR IS CORRELATED IN TIME, and write the result to
 * fixtures/error-structure.json.
 *
 *   node scripts/verify-error-structure.mjs
 *
 * Why this exists, and why it was rewritten. The encounter curve (`encounter.ts`) asks "will the
 * temperature reach T at some point tonight", which is a **minimum over correlated hours**.
 * Understate the correlation and the minimum gets many more effectively independent chances to
 * dip, so the cold tail comes out too deep. The first version of this script collapsed the
 * whole structure into one number: the mean correlation of hourly error pairs at lags up to 9 h.
 * That is the wrong summary. The measured autocorrelation is 0.77 to 0.92 at lag 1, decays to
 * roughly zero by lag 6, goes NEGATIVE around lags 9 to 12, and comes back strongly positive at
 * lag 24. Averaging that to 0.25 to 0.51 throws away everything that matters.
 *
 * So this script now estimates and persists the full autocorrelation function by lag, per lead,
 * and fits a process that can actually carry that shape.
 *
 * Method. Same source as `verify-leadtime.mjs`: the Previous Model Runs API, which serves for
 * every past hour what the run issued N days earlier said about it. Errors are scored against
 * the latest estimate for the same hour. Then, per lead:
 *
 *   - sigma_total      sd of the hourly error about its own mean
 *   - rho(L)           the plain autocorrelation of the hourly error series at lag L, over every
 *                      pair of hours exactly L hours apart, L = 1 .. 30
 *
 * The fitted process. Four components, all unit variance, with variance shares summing to 1:
 *
 *     e(t) / sigma = sqrt(w_shared) * z
 *                  + sqrt(w_diurnal)     * ( g1*cos(2 pi t/24) + g2*sin(2 pi t/24) )
 *                  + sqrt(w_semidiurnal) * ( h1*cos(2 pi t/12) + h2*sin(2 pi t/12) )
 *                  + sqrt(w_ar)          * a(t),  a(t) = AR(1) with lag-1 correlation phi
 *                  + sqrt(w_white)       * eps(t)
 *
 * z, g1, g2, h1, h2 are drawn once per trip; a(t) is one stationary AR(1) chain in absolute
 * clock time; eps is independent hour to hour. The implied autocorrelation is
 *
 *     rho(L) = w_shared + w_diurnal*cos(2 pi L/24) + w_semidiurnal*cos(2 pi L/12) + w_ar*phi^L
 *
 * for L >= 1, and 1 at L = 0. Each term is there because the data demands it:
 *
 *   - w_ar * phi^L      the fast decay from lag 1 to lag 3. Together with w_white this is an
 *                       ARMA(1,1): an AR(1) plus a nugget, which is what lets rho(1) sit well
 *                       below 1 while the ratio rho(2)/rho(1) still reports the real decay rate.
 *   - w_diurnal         the 24 h periodic part. cos(2 pi L/24) is +1 at lag 24 and -1 at lag 12,
 *                       which is exactly the measured sign pattern: a forecast that is too warm
 *                       in the evening is too cold about twelve hours later, and too warm again
 *                       a day later. This is a diurnal amplitude or timing error, not noise.
 *   - w_semidiurnal     the 12 h periodic part, -1 at lag 6 and lag 18, +1 at lag 12 and 24. It
 *                       is what takes the correlation through zero near lag 6 and holds lag 18
 *                       near zero. Without it the fit at lag 6 is off by about 0.15.
 *   - w_shared          a flat offset shared by the whole trip: the model has the airmass
 *                       slightly wrong for several days running. It is what makes lag 24
 *                       (+0.30 to +0.64) larger in size than lag 12 (-0.24 to +0.22).
 *
 * Fitting. Grid search on phi; for each phi the four shares solve a convex quadratic programme
 * (weighted least squares on rho(1..24) subject to w >= 0 and sum(w) <= 1), solved exactly by
 * enumerating active sets. Lags 1 to 9 and lag 24 carry weight 4 and the rest weight 1: a phase
 * window is at most about ten hours, so lags 1 to 9 are what the minimum actually sees, and lag
 * 24 is what couples one night of a trip to the next. The rest of the curve is still fitted, at
 * low weight, so the shape stays honest.
 *
 * The old nested exchangeable shares (f_trip, f_night, f_hour) are still computed and still
 * written, under the same keys as before, so the old numbers stay readable and comparable. They
 * are no longer what the curve consumes.
 *
 * CAVEAT, as in verify-leadtime.mjs: truth here is the model's own latest analysis, not station
 * observations, so the standing bias against reality is invisible. Correlations are computed
 * about the mean, so that bias drops out of these numbers rather than inflating them.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_LEAD = 7;
const PAST_DAYS = 92;
/** Longest lag the autocorrelation is reported at. Past a day the signal is gone. */
const MAX_LAG_H = 30;
/** Longest lag the process is fitted over: one full diurnal cycle. */
const FIT_MAX_LAG_H = 24;
/** Longest lag counted as "within one night" by the OLD exchangeable summary, kept for reference. */
const WITHIN_NIGHT_MAX_LAG_H = 9;
/** Lags that a phase window actually sees, plus the lag that couples adjacent nights. */
const PRIORITY_LAGS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 24]);
const PRIORITY_WEIGHT = 4;

const vars = ['temperature_2m', ...Array.from({ length: MAX_LEAD }, (_, i) => `temperature_2m_previous_day${i + 1}`)];
const url =
  `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=35.6&longitude=-83.43` +
  `&hourly=${vars.join(',')}&past_days=${PAST_DAYS}&forecast_days=0&timezone=auto&elevation=1800`;

const d = await fetch(url).then((r) => r.json());
if (d.error) throw new Error(d.reason);

const h = d.hourly;
const truth = h.temperature_2m;
const dateOf = (stamp) => stamp.slice(0, 10);
const hourOf = (stamp) => Number(stamp.slice(11, 13));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x, places = 4) => +x.toFixed(places);

// =============================================================================================
// A small exact solver for the fit
// =============================================================================================

/** Solve `A x = b` for a tiny dense system by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return Array.from({ length: n }, (_, i) => m[i][n] / m[i][i]);
}

/**
 * Weighted least squares for the four variance shares at a fixed `phi`, subject to
 * `w >= 0` and `sum(w) <= 1`. Convex, so enumerating every active set and keeping the
 * best feasible solution finds the global optimum, deterministically.
 */
function fitShares(rho, phi) {
  const rows = [];
  const ys = [];
  const ws = [];
  for (let L = 1; L <= FIT_MAX_LAG_H; L++) {
    rows.push([1, Math.cos((2 * Math.PI * L) / 24), Math.cos((2 * Math.PI * L) / 12), Math.pow(phi, L)]);
    ys.push(rho[L - 1]);
    ws.push(PRIORITY_LAGS.has(L) ? PRIORITY_WEIGHT : 1);
  }
  const K = 4;
  const A = Array.from({ length: K }, () => new Array(K).fill(0));
  const bb = new Array(K).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < K; j++) {
      bb[j] += ws[i] * rows[i][j] * ys[i];
      for (let k = 0; k < K; k++) A[j][k] += ws[i] * rows[i][j] * rows[i][k];
    }
  }
  const sse = (w) => {
    let s = 0;
    for (let i = 0; i < rows.length; i++) {
      let p = 0;
      for (let j = 0; j < K; j++) p += rows[i][j] * w[j];
      s += ws[i] * (p - ys[i]) ** 2;
    }
    return s;
  };

  let best = null;
  for (let mask = 0; mask < 1 << K; mask++) {
    const free = [];
    for (let j = 0; j < K; j++) if (mask & (1 << j)) free.push(j);
    for (const capped of [false, true]) {
      if (free.length === 0 && capped) continue;
      const n = free.length + (capped ? 1 : 0);
      if (n === 0) {
        const w = new Array(K).fill(0);
        const s = sse(w);
        if (!best || s < best.sse) best = { w, sse: s };
        continue;
      }
      const M = Array.from({ length: n }, () => new Array(n).fill(0));
      const r = new Array(n).fill(0);
      free.forEach((j, a) => {
        free.forEach((k, b) => {
          M[a][b] = A[j][k];
        });
        r[a] = bb[j];
        if (capped) {
          M[a][free.length] = 1;
          M[free.length][a] = 1;
        }
      });
      if (capped) r[free.length] = 1;
      const x = solve(M, r);
      if (x === null || x.some((v) => !Number.isFinite(v))) continue;
      const w = new Array(K).fill(0);
      let ok = true;
      free.forEach((j, a) => {
        w[j] = x[a];
        if (w[j] < -1e-9) ok = false;
      });
      if (!ok) continue;
      const total = w.reduce((a, b) => a + b, 0);
      if (total > 1 + 1e-9) continue;
      const clamped = w.map((v) => Math.max(0, v));
      const s = sse(clamped);
      if (!best || s < best.sse) best = { w: clamped, sse: s };
    }
  }
  return best;
}

/** The fitted process's own autocorrelation at lag `L` (hours). `L = 0` is 1 by construction. */
function processRho(p, L) {
  if (L === 0) return 1;
  return (
    p.sharedVarianceFraction +
    p.diurnalVarianceFraction * Math.cos((2 * Math.PI * L) / 24) +
    p.semidiurnalVarianceFraction * Math.cos((2 * Math.PI * L) / 12) +
    p.arVarianceFraction * Math.pow(p.ar1, L)
  );
}

// =============================================================================================
// Per lead: the measured autocorrelation, the fitted process, and the old shares
// =============================================================================================

const leads = [];
for (let lead = 1; lead <= MAX_LEAD; lead++) {
  const f = h[`temperature_2m_previous_day${lead}`];
  /** The error series, aligned to h.time, with null where either side is missing. */
  const err = h.time.map((_, i) => (truth[i] == null || f[i] == null ? null : f[i] - truth[i]));
  const present = err.filter((x) => x !== null);
  const m = mean(present);
  const totalVar = mean(present.map((x) => (x - m) ** 2));

  // The plain autocorrelation of the error series, lag by lag. Open-Meteo emits exactly 24
  // evenly spaced hourly labels per local date, so index distance IS hour distance.
  const acf = [];
  const acfPairs = [];
  for (let L = 1; L <= MAX_LAG_H; L++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i + L < err.length; i++) {
      if (err[i] === null || err[i + L] === null) continue;
      s += (err[i] - m) * (err[i + L] - m);
      n += 1;
    }
    acf.push(round(s / n / totalVar));
    acfPairs.push(n);
  }

  // The fit: grid on phi, exact QP on the shares.
  let best = null;
  for (let phi = 0; phi <= 0.99 + 1e-9; phi += 0.0025) {
    const got = fitShares(acf, phi);
    if (got && (!best || got.sse < best.sse)) best = { ...got, phi: round(phi, 4) };
  }
  const shares = best.w;
  const white = Math.max(0, 1 - shares.reduce((a, b) => a + b, 0));
  const process = {
    ar1: best.phi,
    arVarianceFraction: round(shares[3]),
    diurnalVarianceFraction: round(shares[1]),
    semidiurnalVarianceFraction: round(shares[2]),
    sharedVarianceFraction: round(shares[0]),
    whiteVarianceFraction: round(white),
  };
  // Make the rounded shares a partition again, absorbing the rounding into the white term.
  const drift =
    1 -
    (process.arVarianceFraction +
      process.diurnalVarianceFraction +
      process.semidiurnalVarianceFraction +
      process.sharedVarianceFraction +
      process.whiteVarianceFraction);
  process.whiteVarianceFraction = round(Math.max(0, process.whiteVarianceFraction + drift), 6);

  const fittedAcf = [];
  let maxAbsResidual = 0;
  let sumSqResidual = 0;
  for (let L = 1; L <= MAX_LAG_H; L++) {
    const p = processRho(process, L);
    fittedAcf.push(round(p));
    if (L <= FIT_MAX_LAG_H) {
      const res = Math.abs(p - acf[L - 1]);
      maxAbsResidual = Math.max(maxAbsResidual, res);
      sumSqResidual += res * res;
    }
  }

  // ---------------------------------------------------------------------------------------
  // The OLD exchangeable summary, kept so the previous numbers stay readable.
  // ---------------------------------------------------------------------------------------
  const byDate = new Map();
  for (let i = 0; i < err.length; i++) {
    if (err[i] === null) continue;
    const key = dateOf(h.time[i]);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push({ hour: hourOf(h.time[i]), err: err[i] });
  }
  let wSum = 0;
  let wN = 0;
  for (const rows of byDate.values()) {
    for (let a = 0; a < rows.length; a++) {
      for (let b = a + 1; b < rows.length; b++) {
        if (Math.abs(rows[a].hour - rows[b].hour) > WITHIN_NIGHT_MAX_LAG_H) continue;
        wSum += (rows[a].err - m) * (rows[b].err - m);
        wN += 1;
      }
    }
  }
  const dates = [...byDate.keys()].sort();
  const dailyMean = new Map(dates.map((k) => [k, mean(byDate.get(k).map((r) => r.err))]));
  let aSum = 0;
  let aN = 0;
  for (let i = 0; i + 1 < dates.length; i++) {
    const t0 = Date.parse(`${dates[i]}T00:00Z`);
    const t1 = Date.parse(`${dates[i + 1]}T00:00Z`);
    if (t1 - t0 !== 86400000) continue;
    aSum += (dailyMean.get(dates[i]) - m) * (dailyMean.get(dates[i + 1]) - m);
    aN += 1;
  }
  const rhoWithin = wSum / wN / totalVar;
  const rhoAcross = aSum / aN / totalVar;
  const fTrip = Math.max(0, Math.min(1, rhoAcross));
  const fNight = Math.max(0, Math.min(1 - fTrip, rhoWithin - fTrip));
  const fHour = Math.max(0, 1 - fTrip - fNight);

  leads.push({
    leadDays: lead,
    n: present.length,
    days: dates.length,
    sdC: round(Math.sqrt(totalVar), 3),
    /** rho at lag 1, 2, ... MAX_LAG_H hours. acf[L - 1] is lag L. */
    acf,
    acfPairs,
    process,
    fit: {
      fitMaxLagHours: FIT_MAX_LAG_H,
      fittedAcf,
      maxAbsResidual: round(maxAbsResidual),
      rmsResidual: round(Math.sqrt(sumSqResidual / FIT_MAX_LAG_H)),
      residualAtKeyLags: Object.fromEntries(
        [1, 2, 3, 6, 9, 12, 18, 24].map((L) => [L, round(fittedAcf[L - 1] - acf[L - 1])]),
      ),
    },
    // Legacy exchangeable summary. Superseded by `process`; kept readable, not consumed.
    rhoWithinNight: round(rhoWithin),
    rhoAcrossNights: round(rhoAcross),
    tripVarianceFraction: round(fTrip),
    nightVarianceFraction: round(fNight),
    hourVarianceFraction: round(fHour),
  });
}

const pooled = {
  tripVarianceFraction: round(mean(leads.map((l) => l.tripVarianceFraction))),
  nightVarianceFraction: round(mean(leads.map((l) => l.nightVarianceFraction))),
  hourVarianceFraction: round(mean(leads.map((l) => l.hourVarianceFraction))),
};

const pooledProcessRaw = {
  ar1: mean(leads.map((l) => l.process.ar1)),
  arVarianceFraction: mean(leads.map((l) => l.process.arVarianceFraction)),
  diurnalVarianceFraction: mean(leads.map((l) => l.process.diurnalVarianceFraction)),
  semidiurnalVarianceFraction: mean(leads.map((l) => l.process.semidiurnalVarianceFraction)),
  sharedVarianceFraction: mean(leads.map((l) => l.process.sharedVarianceFraction)),
  whiteVarianceFraction: mean(leads.map((l) => l.process.whiteVarianceFraction)),
};
const pooledProcess = {
  ar1: round(pooledProcessRaw.ar1),
  arVarianceFraction: round(pooledProcessRaw.arVarianceFraction),
  diurnalVarianceFraction: round(pooledProcessRaw.diurnalVarianceFraction),
  semidiurnalVarianceFraction: round(pooledProcessRaw.semidiurnalVarianceFraction),
  sharedVarianceFraction: round(pooledProcessRaw.sharedVarianceFraction),
  whiteVarianceFraction: 0,
};
pooledProcess.whiteVarianceFraction = round(
  Math.max(
    0,
    1 -
      pooledProcess.arVarianceFraction -
      pooledProcess.diurnalVarianceFraction -
      pooledProcess.semidiurnalVarianceFraction -
      pooledProcess.sharedVarianceFraction,
  ),
  6,
);

const out = {
  url,
  computedAtUtc: new Date().toISOString(),
  method:
    'Autocorrelation function of 2 m temperature forecast error, by lag in hours, per lead day. ' +
    `acf[L-1] is the plain lag-L autocorrelation over every pair of hours exactly L hours apart, ` +
    `L = 1 .. ${MAX_LAG_H}, taken about the series mean. ` +
    'Each lead is then fitted with a four-component unit-variance process: a trip-wide flat ' +
    'offset, a 24 h harmonic, a 12 h harmonic, a stationary AR(1) in absolute clock time, and ' +
    'hour-to-hour white noise, so that ' +
    'rho(L) = w_shared + w_diurnal*cos(2pi L/24) + w_semidiurnal*cos(2pi L/12) + w_ar*phi^L. ' +
    `Weighted least squares on lags 1 .. ${FIT_MAX_LAG_H} (weight ${PRIORITY_WEIGHT} on the lags a ` +
    'phase window sees, 1 to 9, and on lag 24, weight 1 elsewhere), subject to non-negative ' +
    'shares summing to at most 1. The legacy exchangeable shares (tripVarianceFraction, ' +
    'nightVarianceFraction, hourVarianceFraction, from rho_within_night at lags <= ' +
    `${WITHIN_NIGHT_MAX_LAG_H} h) are still computed and kept readable, but they collapse a ` +
    'decaying and sign-changing autocorrelation into one number and are no longer consumed.',
  caveat:
    'Truth is the model analysis, not station observations. Correlations are taken about the mean, ' +
    'so the standing bias against reality is excluded from these numbers rather than inflating them. ' +
    'One point, one season, 92 days.',
  point: { latitude: 35.6, longitude: -83.43, elevationMetres: 1800, timezone: d.timezone },
  windowLocal: { from: h.time[0], to: h.time[h.time.length - 1] },
  maxLagHours: MAX_LAG_H,
  fitMaxLagHours: FIT_MAX_LAG_H,
  withinNightMaxLagHours: WITHIN_NIGHT_MAX_LAG_H,
  leads,
  pooledProcess,
  pooled,
};
await writeFile(join(HERE, '..', 'fixtures', 'error-structure.json'), `${JSON.stringify(out, null, 2)}\n`);

for (const l of leads) {
  const at = (L) => `${l.acf[L - 1].toFixed(2)}/${l.fit.fittedAcf[L - 1].toFixed(2)}`;
  console.log(
    `lead ${l.leadDays}  sd ${l.sdC.toFixed(2)} C  phi ${l.process.ar1.toFixed(3)}  ` +
      `shares ar ${l.process.arVarianceFraction.toFixed(3)} d24 ${l.process.diurnalVarianceFraction.toFixed(3)} ` +
      `d12 ${l.process.semidiurnalVarianceFraction.toFixed(3)} shared ${l.process.sharedVarianceFraction.toFixed(3)} ` +
      `white ${l.process.whiteVarianceFraction.toFixed(3)}  ` +
      `meas/fit L1 ${at(1)} L2 ${at(2)} L3 ${at(3)} L6 ${at(6)} L9 ${at(9)} L12 ${at(12)} L24 ${at(24)}  ` +
      `maxres ${l.fit.maxAbsResidual.toFixed(3)}`,
  );
}
console.log(JSON.stringify({ pooledProcess, pooled }, null, 2));
