# `@will-i-be-cold/weather`

Keyless Open-Meteo client and per-phase temperature sampler for **Will I Be Cold?**

It does four things:

1. talks to the four free Open-Meteo endpoints (geocoding, elevation, 16-day hourly forecast,
   ERA5 archive) from the browser, with no API key and no backend;
2. decides, per date, whether an honest answer is a *forecast* or a *climatology*;
3. turns either of those (or a typed-in high/low) into **per-phase temperature distributions**,
   which is the only thing the heat-balance engine ever sees;
4. pools a phase over the nights of a trip and answers the question the panel actually asks:
   **will I meet this temperature at some point?** (§4).

All three sources emit the identical `TripWeather` type, so the physics cannot tell them apart.

```ts
import {
  createFetchJson, geocode, lookupElevations, fetchForecast, fetchClimatology,
  chooseHorizon, sampleForecast, sampleClimatology, sampleManual,
  phaseDistributions, coldRiskProbability,
} from '@will-i-be-cold/weather';

const fetchJson = createFetchJson();

const [place] = await geocode({ name: 'Gatlinburg' }, fetchJson);   // -> "Gatlinburg, Tennessee, United States"
const [elevation] = await lookupElevations([{ latitude: 35.60, longitude: -83.43 }], fetchJson); // 1446 m (90 m DEM)

const series = await fetchForecast({ latitude: 35.60, longitude: -83.43, elevation: 1800 }, fetchJson);
const trip = sampleForecast({ series, label: place.label });

trip.days[0].phases.camp_morning.temperature; // { p10, p50, p90, min, max, mean, sd } in °C

const { overall, byNight } = phaseDistributions(trip, 'camp_evening');
coldRiskProbability(overall.encounter, -1.1);  // P(it reaches 30 °F at some point on the trip)
```

---

## 1. Empirical findings

Every number below was measured against the live free tier on **2026-11-13**, not taken from the
docs. The raw recordings are in `fixtures/`, with the exact URL and fetch timestamp of each in
`fixtures/manifest.json`. Re-record with `npm run record`.

### 1.1 Hourly horizon: 16 days, 384 hours, no nulls

`forecast_days=16` returns exactly **384 hourly values** (16 × 24) for every variable we ask for
- temperature, humidity, wind, cloud, precipitation, **precipitation probability** and shortwave
radiation: with **zero nulls** anywhere in the horizon. `forecast_days=17` is refused outright:

```
{"reason":"Forecast days is invalid. Allowed range 0 to 16.","error":true}
```

The default with no `forecast_days` is 7 days / 168 hours. So the last forecastable date is
**today + 15**, which is what `DEFAULT_HORIZON.hourlyForecastDays = 16` encodes. Note that PoP is
*not* truncated at day 7 as it is on some providers; it runs the full 16 days.

### 1.2 `elevation=` works, and it is worth 2–3 °C on a Smokies ridge

At the project's test point (35.60 N, 83.43 W: AT ridge, real trail height ≈ 1800 m) Open-Meteo's
own terrain is **1446 m**, a 354 m error. Comparing two otherwise identical 16-day requests:

| | reported `elevation` | mean Δ vs default | range of Δ |
|---|---|---|---|
| no `elevation=` | 1446 m | - | - |
| `elevation=1800` | 1800 m | **−2.37 °C** | −2.0 … −3.5 °C |

The implied lapse rate is **−6.7 °C/km**, sitting sensibly between the saturated (≈ −5) and dry
(≈ −9.8) adiabatic rates: i.e. this is a real lapse correction, not a constant offset: the
largest corrections land on the clear, well-mixed hours.

Two further behaviours worth knowing:

- Passing `elevation=` **also changes which grid cell you get** (−83.434 → −83.467 here):
  Open-Meteo picks the cell whose model terrain is closest to the elevation you asked for. So the
  parameter is doing more than arithmetic.
- Relative humidity moves too (up to 11 points), wind and precipitation barely.
- Sunrise/sunset are *unchanged* by `elevation=`.

Consequence for the product: `ForecastRequest.elevation` is **mandatory** in the type and at
runtime. There is no accidental way to get valley weather for a ridge.

### 1.3 Rate limits, cost accounting, and whether we fit

From https://open-meteo.com/en/terms, and confirmed by the `X-RateLimit-*` response headers
(which are CORS-exposed, so the browser can read them):

| limit | free tier |
|---|---|
| per minute | 600 calls |
| per hour | 5 000 calls |
| per day | 10 000 calls |
| per month | 300 000 calls |

Limits are applied **per IP address and application**. For a static browser tool that is a
feature, not a problem: each visitor's browser spends its *own* IP budget, so there is no shared
quota to exhaust. (The same note in Open-Meteo's terms warns that serverless hosts: Vercel,
Netlify Functions, Render: get rate-limited *early* because many users share an egress IP. That
is a direct argument against ever proxying this through a Netlify function.)

A "call" is fractional: >10 variables or >2 weeks of data for one location costs more than 1.0.
Measured costs for our actual requests:

| request | `X-RateLimit-Cost` | bytes |
|---|---|---|
| 16-day forecast, 7 hourly vars + daily sun | **1.03** | ~75 kB |
| geocoding, elevation | 1.0 | <1 kB |
| one climatology year (7 days, 6 vars) | **1.0** | ~8 kB |
| 30 years as ONE 1996–2025 range, 1 var | **78.3** | **6.2 MB** |

That last row is why `climatologyUrls()` issues **one small request per year** rather than one
long range: 20 years costs 20 calls and ~160 kB instead of ~52 calls and 4 MB. A climatology
lookup is therefore the expensive operation in the app (20 calls) and is well worth caching in
`localStorage` keyed by (rounded lat/lon, elevation, month-day).

A full session (geocode + elevation + forecast ≈ 3 calls, or + climatology ≈ 23) is nowhere near
600/min unless a single user hammers the UI. No backend needed.

### 1.4 CORS: all four endpoints are open

`access-control-allow-origin: *` on `api.open-meteo.com` (forecast + elevation),
`archive-api.open-meteo.com` and `geocoding-api.open-meteo.com`, with
`access-control-expose-headers` covering the rate-limit headers. No preflight problems, no key,
no proxy. **The "no backend" assumption holds.** The one caveat is licensing, not technology , 
see §4.

### 1.5 Timezones: naive local, 24 hours per day, always

With `timezone=auto` the API returns `utc_offset_seconds` plus wall-clock timestamps with **no
offset and no `Z`** (`"2026-11-13T07:00"`). Critically, Open-Meteo applies **one fixed offset for
the whole response**, so a local date is *always* exactly 24 labelled hours: verified against
both US DST transitions (2024-03-10 and 2024-11-03 in `America/New_York`): 24 hourly labels on
each, no 23-hour or 25-hour day.

That means phase-window arithmetic can be plain integer minute arithmetic, with no DST cases.
It also means these strings **must never be passed to `new Date()`**, which would reinterpret
them in the *viewer's* timezone and silently shift every window for anyone planning a trip from
another country. `src/localtime.ts` does the arithmetic on the strings instead, and
`openmeteo.test.ts` pins the behaviour down.

Edge case: during polar night/day, `sunrise` and `sunset` both degenerate to `T00:00` rather than
`null`. `DailySun.polar` flags it and the sampler falls back to fixed clock windows.

### 1.6 Why ERA5 and not the Climate (CMIP6) endpoint

The brief allowed either. ERA5, because:

- `climate-api.open-meteo.com/v1/climate` serves **daily variables only**: a request with
  `hourly=temperature_2m` comes back with no `hourly` block at all. We need a per-hour-of-day
  shape to build phase windows, so it cannot do the job even in principle.
- It also serves *bias-corrected CMIP6 projections*: a model's opinion about a future climate.
  For "what is 20 November usually like up there", the honest answer is the observed record, not
  a downscaled scenario.
- `archive-api.open-meteo.com/v1/archive` (ERA5 / ERA5-Land) is hourly, goes back to **1940**, is
  current to **today** (ERA5T), honours the same `elevation=` lapse correction, and is on the
  free tier. Confirmed: a 1940-01-01 request returns data; a request through 2026-11-13 returns
  data with no trailing nulls.

ERA5 has no probability-of-precipitation field (requesting it returns `"undefined"` units and all
nulls), so `PhaseWeather.precipitationProbability` in climatology mode is computed instead as the
**share of pooled historical hours with ≥ 0.1 mm**: which is what a probability means here
anyway.

---

## 2. The phase-window rule

Windows are anchored to that date's **actual sunrise and sunset** (from `daily=sunrise,sunset`,
or from `src/solar.ts` in manual mode), then clamped to clock bounds so they stay sane at high
latitude. The four non-overlapping windows **partition the 24 hours exactly**: no gaps, no
double counting:

| phase | window | default |
|---|---|---|
| `sleep` | bedtime → wake (next day) | `21:00` → wake |
| `camp_morning` | wake → hiking start | `sunrise − 1 h`, clamped to 04:30–08:00 |
| `hiking` | hiking start → hiking end | `sunrise + 1.5 h` (07:00–09:30) → `sunset − 1 h` (14:30–18:00) |
| `day_break` | *inside* hiking, 1 h trimmed from each end | - |
| `camp_evening` | hiking end → bedtime | → `21:00` |

On the Smokies on 13 November 2026 (sunrise 07:07, sunset 17:28) that gives wake **06:07**,
hiking **08:37–16:28**, camp evening **16:28–21:00**, sleep **21:00–06:07**, within ten minutes
of the fixed clock windows in SPEC §3, but self-adjusting for date and latitude.

Two deliberate deviations from the spec text, both to avoid holes in the day:

- **`camp_evening` starts when hiking stops, not at sunset.** The hour between arriving in camp
  and sunset is spent standing around at ~1.6 MET, not walking at 3.0, so it belongs to the camp
  phase. Starting at sunset would leave that hour in no phase at all.
- **`day_break` is a sub-window of `hiking`, trimmed by one hour at each end.** You do not stop
  for lunch twenty minutes after setting off, nor in the last push to camp. It overlaps `hiking`
  by design; the two differ downstream in metabolic rate, not in air temperature.

**Which hours count: the midpoint rule.** An hour labelled `09:00` covers 09:00–10:00, so it
belongs to the window containing `09:30`. A window of 08:37–16:28 therefore takes hours 09…15
(seven samples). This is what makes the partition exact. One honest caveat: Open-Meteo's
`precipitation` is the sum over the *preceding* hour while temperature and wind are instantaneous,
so rain is effectively offset by up to an hour relative to the window. At this resolution that is
noise, but it is not nothing.

Polar days (no sunrise or no sunset) fall back to fixed 06:00 / 08:30 / 16:30 / 21:00.
Everything in `DEFAULT_PHASE_WINDOWS` is overridable.

---

## 3. The uncertainty model

A phase's temperature band combines **two independent sources of spread**:

- **(a) within-window variation**: the real spread of the hourly values across the window
  (a hiking day is genuinely warmer at 14:00 than at 09:00); and
- **(b) forecast error**: how wrong the model is likely to be, which grows with lead time.

They are independent, so the standard deviations combine **in quadrature**:

```
sd_total = sqrt(sd_within² + sd_lead²)
```

and the quantiles are widened outwards from the empirical ones (exact if the hourly sample is
itself Gaussian, conservative otherwise):

```
p10' = p10 − 1.2816·sd_lead      p90' = p90 + 1.2816·sd_lead
min' = min − 1.6449·sd_lead      max' = max + 1.6449·sd_lead
p50, mean unchanged              (the error model is unbiased by construction)
```

### 3.1 Where `sd_lead` comes from: measured, not assumed

`scripts/verify-leadtime.mjs` measures it against **our own data source at our own test point**.
Open-Meteo's Previous Model Runs API serves, for each past hour, what the forecast for that hour
looked like in the run issued *N* days earlier (`temperature_2m_previous_dayN`). Scoring those
against the latest estimate for the same hour, at 35.60 N / 83.43 W / `elevation=1800`, over
**2 208 hourly pairs (13 Aug – 12 Nov 2026)**:

| lead (days) | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| bias (°C) | +0.35 | +0.10 | +0.12 | +0.07 | +0.08 | +0.18 | +0.08 |
| MAE (°C) | 0.84 | 1.62 | 1.67 | 1.68 | 1.69 | 1.83 | 2.18 |
| **RMSE (°C)** | **1.06** | **2.05** | **2.08** | **2.14** | **2.22** | **2.36** | **2.83** |

Raw output in `fixtures/leadtime-verification.json`; reproduce with `npm run verify-leadtime`.

Two adjustments on top of that table, both named and overridable in `DEFAULT_UNCERTAINTY`:

1. **`verificationInflation = 1.2`.** The truth field above is the model's *own latest analysis*,
   not station observations, so it cannot see the model's standing bias against reality; and a
   1–11 km grid in the southern Appalachians verifies worse than the flat-terrain average. Both
   make the table a **lower bound**. Published verification against independent truth puts global
   2 m temperature RMSE materially higher: ECMWF IFS HRES and the current data-driven models sit
   around **2.8–3.7 K at day 10** (Rasp et al., *WeatherBench 2: A Benchmark for the Next
   Generation of Data-Driven Global Weather Models*, **JAMES 16 (2024)**, e2023MS004019,
   [doi:10.1029/2023MS004019](https://doi.org/10.1029/2023MS004019)). 1.2 brings our day-10 value
   into that range from below.
2. **`saturationSdC = 4.0`, `saturationTauDays = 6`.** Past day 7 we have no measurement, so the
   curve relaxes exponentially towards a ceiling. The ceiling is physically bounded above by the
   *climatological* spread (a forecast can never be worse than guessing the climate mean) and
   at this point in mid-November the interannual standard deviation, measured over the 20 ERA5
   years in `fixtures/archive/`, is **4.6–5.1 °C** (hour-of-day range; mean 4.9). 4.0 °C is a
   defensible asymptote under that. The resulting curve is:

   | lead (days) | 0 | 1 | 2 | 5 | 7 | 10 | 13 | 16 |
   |---|---|---|---|---|---|---|---|---|
   | `sd_lead` (°C) | 0.84 | 1.27 | 2.46 | 2.66 | 3.40 | 3.95 | 4.28 | 4.49 |

   Note the day-16 value (4.49 °C) sits just under the climatological 4.9 °C, so the band does
   **not jump** when a trip crosses the horizon into climatology mode. That continuity is a
   deliberate consequence of bounding the asymptote by the climatological spread, and it is the
   honest shape: at two weeks out you are most of the way back to "it's November up there".

### 3.2 Climatology mode

No error model is applied, because none is needed: the pooled sample for a phase is every
(year × window-day × hour-in-window) ERA5 observation (20 years × 7 days × *k* hours) so the
empirical quantiles *already* contain the full interannual spread. `uncertaintySd` is therefore
`0` and `climatologyExtraSdC` defaults to `0`; adding a forecast error on top would be double
counting. Bands come out ~9–15 °C wide p10–p90, which is the honest width.

### 3.3 Manual mode

`manualSdC = 2.0 °C`, i.e. "the user's high/low is good to about ±2.5 °C at p10/p90". SPEC §3
suggests ±3 °F for a remembered forecast and ±10 °F for a guess; 2.0 °C sits between them and is
a single overridable constant.

### 3.4 Wind

**Not modelled.** `PhaseWeather.windSpeed` carries the within-window spread only, and
`windUncertaintyModelled` is `false` on every phase so the UI cannot pretend otherwise. Wind
forecast error grows with lead time too, and should be added before the forecast band is used to
drive the `I_a` term at long leads.

---

## 4. Aggregating a phase: the marginal, and the encounter curve

A phase window is a handful of hours on one day, and a trip is several of those. `encounter.ts`
pools them, and it answers **two different questions with two different objects**. Mixing them up
is the easiest mistake available here, so they are named so that you cannot.

### 4.1 The marginal: "what is it like out there?"

> *What is the temperature at a random moment I am exposed during this phase?*

That is a **mixture** over (night, hour within the window, forecast error), and
`PhaseDistribution.temperature` is its marginal: `p10/p50/p90/min/max/mean/sd`, plus a
ready-made `histogram`. Because it is a marginal of a mixture, **correlation between hours and
between nights cannot affect it**. Correlation would only matter if we were aggregating *within*
the window, asking for the window's mean or its minimum. So this view needs no correlation model
and does not have one.

> ⚠️ **It therefore does not answer "will I be cold at some point tonight."** That question is a
> minimum over correlated samples, and a marginal cannot tell you about it: 10 % of *exposed
> hours* below 30 °F is not a 10 % chance of *seeing* 30 °F. The encounter curve below is what
> answers it, and it is the primary read.

The quantiles are the exact mixture quantiles, from the mixture's own CDF, rather than
`describeSample`'s trick of shifting the empirical quantiles outward by `Z90 · sd`: that trick is
a deliberately conservative approximation for one window with one error sd, and it has no
well-defined meaning for a mixture whose nights carry different sds.

**Histogram bins** come with the output so the UI never re-bins raw samples. Edges land on round
numbers **in the display unit** (every 5 °F by default, configurable, `2 °C` in SI mode) and are
computed in SI, so `fromC` is the exact SI equivalent of a round display number rather than a
rounded Celsius. Counts are fractional, because each sample is itself a distribution once
forecast error is folded in, and the two outermost bins are closed on the outside so the counts
sum exactly to the sample count.

### 4.2 The encounter curve: "will I meet this temperature?"

    encounterProbability(T) = P( min(period) <= T <= max(period) )
    coldRiskProbability(T)  = P( min(period) <= T )

`encounterProbability(T)` is the probability the temperature **passes through** T at some point
in the period.

> ⚠️ **It is not a distribution.** It is not normalised, it is not a density, and summing it over
> the grid gives far more than 1, because one evening visits many temperatures. Each value is its
> own probability in [0, 1]. Drawn, it is a plateau near 1 across the bulk of the period's range
> with a falling limb at each end: near certain you pass through 45 °F this evening, near
> impossible you pass through 5 °F. Do not draw it as a histogram and do not normalise it.

`coldRiskProbability(T)` is what **prices a coverage gap**. If the gear fails below 30 °F, the
risk of that gap is the probability the temperature *gets* below 30 °F, not the probability it
passes through exactly 30 °F. It is monotone non-decreasing in T, from 0 well below the coldest
plausible value to 1 well above the warmest. (Note the direction: a *warmer* threshold is
*easier* to reach, so the curve rises to the right.) The two curves nearly coincide on the cold
limb, because `P(max >= T)` is essentially 1 for any T below the usual daytime high; they
separate only at the warm end. `warmRiskProbability(T) = P(max >= T)` is the mirror, and
`coldRiskTemperature(curve, p)` inverts the cold limb ("the 1-in-100 cold outcome is 7 °F").

### 4.3 How the correlation is modelled

Forecast error is a **correlated process in clock time**. Each night's error sd scales a sum of
five unit-variance pieces whose variance shares add to 1:

    T(t) = forecast(t) + sigma(night) * [ sqrt(w_shared)      * z
                                        + sqrt(w_diurnal)     * diurnal(t)
                                        + sqrt(w_semidiurnal) * semidiurnal(t)
                                        + sqrt(w_ar)          * a(t)
                                        + sqrt(w_white)       * eps(t) ]

`z` is one flat offset shared by the whole trip (the model has the airmass slightly wrong for days
on end); `diurnal` and `semidiurnal` are random-amplitude, random-phase 24 h and 12 h harmonics,
also drawn once per trip; `a` is one stationary **AR(1)** chain in absolute clock time with lag-1
correlation `phi`, so it decays across the gap between one night's window and the next instead of
restarting; `eps` is hour-to-hour white noise. The implied autocorrelation, `processAutocorrelation`,
is what gets fitted to the measurement lag by lag:

    rho(L) = w_shared + w_diurnal*cos(2 pi L/24) + w_semidiurnal*cos(2 pi L/12) + w_ar*phi^L

This matters enormously and in one direction: **understating the hour-to-hour correlation gives
the minimum many more effectively independent chances to dip, and badly overstates the risk of
extreme cold.**

The curve is built by **seeded Monte Carlo**. Each draw samples the components, takes the minimum
and the maximum over the hours (and nights) the period spans, and accumulates the two indicators
over a temperature grid; one pass gives both curves. That handles any correlation structure
exactly and avoids fragile analytic approximations. The RNG is `mulberry32` with a fixed default
seed, so the panel renders identically every time; `draws` (4 000) and `seed` are options.

### 4.4 Where the structure comes from: measured, not assumed

`npm run verify-error-structure` re-measures it, from the **same** 2 208 hourly forecast/analysis
pairs per lead as the lead-time table (§3.1): Previous Model Runs API, our test point, errors
scored against the latest estimate for the same hour. It estimates the **full autocorrelation
function by lag**, per lead, and fits the process above to lags 1 to 24 by weighted least squares
under `w >= 0, sum(w) <= 1`.

| lead (d) | sd | lag 1 | 2 | 3 | 6 | 9 | 12 | 18 | 24 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.00 | 0.77 | 0.58 | 0.46 | 0.31 | 0.21 | 0.22 | 0.23 | 0.36 |
| 2 | 2.04 | 0.88 | 0.69 | 0.51 | 0.05 | -0.21 | -0.24 | -0.03 | 0.64 |
| 3 | 2.07 | 0.87 | 0.69 | 0.52 | 0.06 | -0.16 | -0.18 | -0.01 | 0.58 |
| 7 | 2.86 | 0.92 | 0.80 | 0.68 | 0.37 | 0.22 | 0.16 | 0.15 | 0.30 |

Two things no exchangeable model can express. Adjacent hours are strongly correlated and the
correlation **decays fast**, reaching roughly zero by lag 6 and going negative at lags 9 to 12.
And there is a strong **24 h periodic component**, the signature of a diurnal amplitude or timing
error: too warm in the evening implies too cold about twelve hours later and too warm again a day
later. The 12 h harmonic is what takes the curve through zero near lag 6 and holds lag 18 near
zero; without it the fit at lag 6 is off by about 0.15. The flat shared term is what makes lag 24
larger in size than lag 12.

The fit reproduces the measurement at lags 1, 2, 3 and 6 to within 0.03 at every lead, and over
the whole of lags 1 to 24 to within 0.05. Where it misses, it misses *low* at lag 1 (by 0.01 to
0.03), because the shares are constrained to sum to at most 1: too little correlation errs on the
pessimistic side of the cold tail, which is the safe direction.

Raw table, measured and fitted autocorrelations and residuals: `fixtures/error-structure.json`.
The per-lead fits are `MEASURED_HOURLY_PROCESS_BY_LEAD`; `hourlyErrorProcess(leadDays)`
interpolates between them and **clamps** outside the measured range, because there is no
measurement past day 7. The trend with lead is towards *more* correlation, so clamping understates
it at longer leads and again errs pessimistic.

Three honest limits, the first two the same ones §3.1 carries: truth is the model's own latest
analysis rather than station observations, and correlations are taken about the mean, so the
model's standing bias against reality is excluded from these numbers rather than inflating them;
the measurement is one point and one season; and the fit is to lags up to 24 h, so nothing is
claimed about how a trip longer than two nights couples at lags of 48 h and beyond.

#### The superseded exchangeable split

Before this, the error was decomposed into three exchangeable buckets,
`e(night, hour) = b_trip + b_night + e_hour`, with the within-night correlation estimated as the
**mean** correlation of hourly pairs at lags up to 9 h. That is the wrong summary: it collapsed an
autocorrelation running 0.88, 0.69, 0.51, ..., 0.05 at lag 6, -0.21 at lag 9 into a single
exchangeable 0.23, so a nine-hour window got roughly nine independent chances to dip instead of
about two and the cold tail came out materially too deep. On a three-night Smokies trip at day 8
to 10 lead it put the 50 % cold risk 2.5 °F colder than the measured structure does.

The shares are still in `fixtures/error-structure.json` under the keys they always had, and
`MEASURED_ERROR_STRUCTURE` / `checkErrorStructure` / the `errorStructure` option still work:
passing `errorStructure` switches the simulation back to the exchangeable model, which remains the
clean way to ask "what if the hours really were exchangeable?". `EncounterCurve.errorModel` says
which model drew a given curve, `EncounterCurve.hourlyProcess` carries the process it used, and
`EncounterCurve.errorStructure` carries the exchangeable shares: what was simulated on the
exchangeable path, and `impliedErrorStructure(...)`, a deliberately **lossy display summary**, on
the default one.

### 4.5 Both scopes, one type

```ts
import { phaseDistributions, aggregatePhase, coldRiskProbability } from '@will-i-be-cold/weather';

const { overall, byNight } = phaseDistributions(trip, 'camp_evening');

overall.temperature.p10;                       // the marginal band, °C
overall.histogram.bins;                        // ready-made 5 °F bins
coldRiskProbability(overall.encounter, -1.1);  // P(it gets to 30 °F at some point this trip)
byNight[0].encounter;                          // the same object for one night
aggregatePhase(trip.days.slice(0, 3), 'sleep'); // or any subset of nights
```

`aggregatePhase` returns the same `PhaseDistribution` for one night and for fifteen, exactly as
`sampleForecast` and `sampleManual` return the same `TripWeather`. The pooled view is the default
the panel shows; the per-night list is the drill-down.

Worked numbers, the Smokies `camp_evening` from the recorded fixture: over the first three
nights, `p10/p50/p90` is 17/21/26 °F, `coldRiskProbability` is 50 % at 15 °F, 10 % at 11 °F and
1 % at 7 °F, and `encounterProbability` exceeds 0.9 from 19 °F to 25 °F. The first night alone is
a flat evening (22 °F for five hours straight) with the whole trip's smallest forecast error, so
its plateau never reaches 0.9 at all: its peak encounter probability is 0.78, at 21 °F. That is
the curve being honest rather than being forced to 1.

---

## 5. Licence, attribution and the commercial-use problem

**Attribution is a licence term, and the link is part of it.** From
https://open-meteo.com/en/licence (checked 2026-11-13): API data are offered under
**CC BY 4.0**, and *"You must include a link next to any location Open-Meteo data are displayed,
for example: `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>`"*. The
package exports `OPEN_METEO_ATTRIBUTION_HTML` with exactly that markup and puts the plain string
on every `TripWeather.attribution`. Rendering the text without the anchor does **not** satisfy it.

Upstream providers are credited by Open-Meteo itself; two are worth knowing about:

- **ERA5 / elevation data** come from Copernicus C3S, under the Copernicus licence.
- **UK Met Office** data in the `best_match` model pool is **CC-BY-SA**, not CC-BY. We do not
  redistribute raw data (we publish derived distributions on a page), so this is unlikely to bite,
  but it is the one share-alike source in the pool.
- The **server** code is AGPLv3. Irrelevant unless we self-host it.

### ⚠️ The free tier is non-commercial only

This is the one finding that could affect the project, and it is legal rather than technical.
Open-Meteo's terms restrict the free API to **non-commercial use**, defined as:

> Private or non-profit websites or apps that do not have subscriptions or advertising …
> Voluntary donations, including contributions through a tip jar, are permitted.

and explicitly **commercial**:

> Websites or apps that have subscriptions or display advertisements. Commercial products or
> promotional activities.

A personal site with no ads and no subscription is squarely inside the free tier, donations
included. It stops being so if the site carries advertising, or if the tool becomes
"promotional activity" for a monetised product. A monetised YouTube channel that *links to* a
free, ad-free tool is a judgement call worth making deliberately rather than by default. The
commercial route is the Standard plan (`customer-api.open-meteo.com` + `&apikey=`, identical
syntax): but note the Standard plan **excludes the Historical Weather API**, which our
climatology fallback needs; that requires Professional or higher. Worth knowing before pricing it.

Because this is a per-origin decision rather than a code decision, `DEFAULT_ENDPOINTS` is
overridable on every client function, so swapping in `customer-api.open-meteo.com` or a proxy is
a one-line change at the call site.

---

## 6. API surface

### `src/types.ts`: the published contract

`TripWeather` → `DayWeather[]` → `Record<PhaseName, PhaseWeather>` → `Distribution`.
SI throughout: °C, m/s, metres, mm, W/m²; cloud, humidity and probability are **0..1 fractions,
never percent**. Timestamps are naive local wall-clock strings. See the file's comments; it is
written to be read by the physics engine's author.

### `src/openmeteo.ts`

`createFetchJson` · `geocode` · `lookupElevations` · `fetchForecast` · `fetchClimatology` ·
`buildClimatology` · pure `parse*` / `*Url` functions for every endpoint ·
`OpenMeteoApiError` / `OpenMeteoShapeError` · `DEFAULT_ENDPOINTS`.

Every network call goes through one injectable `FetchJson`. Responses are *parsed*, not cast:
a short series, a `null` where a number belongs, a gap or duplicate in the hourly timestamps, a
percentage outside 0..100, a negative accumulation, an implausible temperature, or a **unit
change** (the cheapest guard against the server quietly reverting wind to km/h) all throw.
Nothing in this package can hand the physics engine a `NaN`.

### `src/horizon.ts`

`chooseHorizon(targetDate, today)` → `{ mode, daysOut, lastForecastDate, reason }`. Forecast for
`0 ≤ daysOut ≤ 15`, climatology otherwise. Past dates are `climatology` / `reason: 'past'` , 
deliberately *not* silently served as ERA5 actuals, because that needs a different UI affordance.
`sampleForecast` throws rather than serving a beyond-horizon date, so the two can never be mixed
within a day.

### `src/diurnal.ts`

`sampleForecast` · `sampleClimatology` · `sampleManual`: all returning `TripWeather` ·
`phaseWindows` · `hoursInWindow` · `forecastUncertaintySd` · `manualDiurnalTemperature` ·
`DEFAULT_PHASE_WINDOWS` / `DEFAULT_UNCERTAINTY` / `DEFAULT_MANUAL_CURVE`.

**The manual diurnal curve.** Minimum at sunrise, maximum at 15:00, asymmetric:

- *Rise* (sunrise → peak): a half-cosine, `T = low + range·(1 − cos(π·s))/2`. Smooth, with zero
  derivative at both ends: the standard form for daily temperature interpolation.
- *Fall* (peak → next sunrise): a normalised exponential decay,
  `f(s) = (e^(−s/τ) − e^(−1/τ)) / (1 − e^(−1/τ))` with `s` the elapsed fraction of the night and
  `τ = 0.35`. It is exactly 1 at the peak and exactly 0 at the next sunrise, and sheds half the
  range in the first ~quarter of the night.

The asymmetry is the physical one: clear-sky radiative cooling is fastest right after sunset and
flattens towards dawn, which is why the pre-dawn hours hover near the minimum. The night is also
simply longer than the rise, so "slower evening decay than morning rise" falls out twice over.

### `src/encounter.ts`

`aggregatePhase(days, phase, options?)` → `PhaseDistribution` (same type for one night and for a
whole trip) · `phaseDistributions(trip, phase, options?)` → `{ overall, byNight }` ·
`encounterProbability` / `coldRiskProbability` / `warmRiskProbability` / `coldRiskTemperature` ·
`MEASURED_HOURLY_PROCESS_BY_LEAD` / `MEASURED_HOURLY_PROCESS` / `hourlyErrorProcess` /
`processAutocorrelation` / `checkHourlyErrorProcess` / `impliedErrorStructure` /
`MEASURED_ERROR_STRUCTURE` / `checkErrorStructure` / `DEFAULT_AGGREGATION`. See §4.

### `src/solar.ts`

Sunrise/sunset for the manual path (low-precision Meeus sunrise equation). Tested against the
recorded Open-Meteo values for all 16 Smokies days: **agrees to within 4 minutes**, which is far
inside the hour everything is quantised to.

---

## 7. Tests

```
npm test            # 146 offline tests, 7 files, ~0.6 s, no network
npm run test:live   # + 4 live schema-drift tests (WIBC_LIVE=1)
npm run build       # tsc, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm run record      # re-record fixtures/ from the live APIs
npm run verify-leadtime   # re-measure the uncertainty constants
npm run verify-error-structure   # re-measure the error autocorrelation by lag, and refit
```

Offline and deterministic, against the recorded fixtures in `fixtures/` (27 verbatim responses +
a manifest giving each one's exact URL and fetch time). Fixtures are **never** regenerated by the
test run, so a shape change arrives as a reviewable diff.

Coverage worth knowing about:

- **Contract tests**: truncated series, a `null` punched into the middle of one, a missing or
  duplicated hour in the time axis, a changed unit, an out-of-range percentage, a negative
  accumulation, sunrise on the wrong date, a `results`-less geocoding response, the API error
  envelope. Each asserts a *loud, specific* failure.
- **Timezone**: naive-local format, exactly 24 hourly labels per local date (the DST pin-down),
  sunrise/sunset on their own date.
- **`elevation=`**: the delta, its sign, its magnitude and the implied lapse rate are all
  asserted against the two recorded fixtures.
- **Sampler**: a synthetic series whose temperature *equals the hour of day*, so the expected
  quantiles are arithmetic; the midnight-crossing `sleep` window; the exact phase partition; a
  manual high/low recovering its own high and low; and a structural-equality check that all three
  sources emit the same shape.
- **Aggregation and the encounter curve**: pooling N identical nights reproduces the
  single-night distribution exactly; pooling nights with different means widens it; bin edges
  land on round display values and the counts sum to the sample count; the encounter curve is
  bounded in [0,1] and deliberately does **not** sum to 1; it plateaus at 1 across the range the
  period really covers and falls to 0 outside it; `coldRisk` is monotone and saturates at both
  ends; pooling more nights can only raise the cold risk at a fixed temperature; and the
  correlation structure is pinned the right way round, with more *shared* variance at the same
  total giving a **less** extreme cold tail.
- **House style**: `prose.test.ts` walks every string the package can hand out (the exported
  constants, two whole sampled trips, an aggregated phase, and the error messages) and fails on
  an em dash, or on a spaced hyphen or en dash standing in for one.
- **Live (opt-in)**: `WIBC_LIVE=1` re-fetches the forecast, geocoding, elevation and archive and
  checks they still match the fixture shape. Off by default so CI never depends on a third party;
  schema drift is caught deliberately.

---

## 8. Things that were guessed rather than measured

Flagged honestly, in rough order of how much they matter:

1. **Lead-time error beyond day 7.** The Previous Model Runs API only goes back 7 days, so days
   8–16 are an extrapolation (`saturationSdC` / `saturationTauDays`), sanity-checked against the
   published global figure and bounded by the measured climatological spread. It is a model, not
   a measurement.
2. **`verificationInflation = 1.2`.** A judgement call about how much an analysis-based
   verification under-reports true error in complex terrain. The right fix is a verification
   against a nearby station (e.g. the Mount Le Conte or Newfound Gap observations): worth doing
   before the tool ships publicly.
3. **Wind forecast error is not modelled at all** (§3.4).
4. **The error autocorrelation is measured (§4.4), but at one point and over one season**,
   against the same analysis-based truth field as the lead-time table, and only out to lag 24 h.
   The *shape* (strong, fast-decaying correlation between adjacent hours, a sign change around
   lags 9 to 12, a 24 h revival, and more correlation at longer lead) is the robust part; the
   exact shares and `phi` are one measurement, and the fit is clamped at the day-7 row beyond the
   measured range. Both the process and the superseded exchangeable split are options on every
   call.
5. **`breakInsetHours = 1`**: the "you don't stop for lunch in the first hour" rule is reasonable
   but arbitrary. SPEC §3 says "3 × 30 min in that window" without saying when.
6. **`manualSdC = 2.0 °C`**: interpolated between the two numbers in SPEC §3.
7. **Climatology wet threshold, 0.1 mm/h**: the conventional "measurable precipitation" cutoff,
   not derived from anything.
8. **`ELEVATION_BATCH_LIMIT = 100`**: from Open-Meteo's docs; the batching mechanism itself was
   verified with three coordinates, the exact ceiling was not probed.
9. **20 years of climatology**: long enough for a stable mean, short enough that a warming trend
   does not dominate. Not tuned.
