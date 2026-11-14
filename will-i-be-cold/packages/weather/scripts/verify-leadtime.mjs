#!/usr/bin/env node
/**
 * Measure, rather than assume, how Open-Meteo's 2 m temperature error grows with lead time
 * at our test point, and write the result to fixtures/leadtime-verification.json.
 *
 *   node scripts/verify-leadtime.mjs
 *
 * Method: the Previous Model Runs API serves, for every past hour, what the forecast for that
 * hour looked like in the run issued N days earlier (`temperature_2m_previous_dayN`, N = 1..7).
 * `temperature_2m` on the same request is the latest best estimate for that hour. We score each
 * lead against the latest estimate.
 *
 * CAVEAT (stated in the README too): the truth field here is the model's own latest analysis,
 * not station observations. That removes the model's standing bias against reality and makes
 * these numbers a LOWER bound on true error. DEFAULT_UNCERTAINTY therefore applies an explicit
 * inflation factor on top.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_LEAD = 7;
const PAST_DAYS = 92;

const vars = ['temperature_2m', ...Array.from({ length: MAX_LEAD }, (_, i) => `temperature_2m_previous_day${i + 1}`)];
const url =
  `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=35.6&longitude=-83.43` +
  `&hourly=${vars.join(',')}&past_days=${PAST_DAYS}&forecast_days=0&timezone=auto&elevation=1800`;

const d = await fetch(url).then((r) => r.json());
if (d.error) throw new Error(d.reason);

const h = d.hourly;
const truth = h.temperature_2m;
const leads = [];
for (let lead = 1; lead <= MAX_LEAD; lead++) {
  const f = h[`temperature_2m_previous_day${lead}`];
  const errs = [];
  for (let i = 0; i < truth.length; i++) {
    if (truth[i] == null || f[i] == null) continue;
    errs.push(f[i] - truth[i]);
  }
  const n = errs.length;
  const bias = errs.reduce((a, b) => a + b, 0) / n;
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / n;
  const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / n);
  leads.push({ leadDays: lead, n, biasC: +bias.toFixed(3), maeC: +mae.toFixed(3), rmseC: +rmse.toFixed(3) });
}

const out = {
  url,
  computedAtUtc: new Date().toISOString(),
  method:
    'RMSE of the forecast issued N days earlier against Open-Meteo best_match latest estimate for the same hour.',
  caveat:
    'Truth is the model analysis, not station observations; this is a lower bound on true error. ' +
    'See DEFAULT_UNCERTAINTY.verificationInflation.',
  point: { latitude: 35.6, longitude: -83.43, elevationMetres: 1800, timezone: d.timezone },
  windowLocal: { from: h.time[0], to: h.time[h.time.length - 1] },
  leads,
};
await writeFile(join(HERE, '..', 'fixtures', 'leadtime-verification.json'), JSON.stringify(out, null, 2) + '\n');
console.table(leads);
