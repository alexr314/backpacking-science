# "Will I Be Cold?": spec v0 (2026-11-13)

Public-facing calculator for Alex's personal site; first of a suite of camping tools. Companion to a
moderately technical YouTube explainer on the physics of staying warm. Second tool: the gear
Pareto-frontier explorer.

## 1. The thesis (what makes it different)

Every existing "layering guide" is a lookup table. This is a **heat-balance model** with a real
standard behind it (ISO 11079 IREQ for cold stress; ISO 9920 for garment insulation; ISO 23537 for
bags; ASTM F3340 for pads), driven by a **temperature distribution** rather than a point forecast,
and it reports **coverage**: for each phase of the day, does *some* configuration of the gear you
own keep you comfortable across the whole range of temperatures you might see? Gaps are the output.

## 2. Physics engine

### 2.1 Steady-state heat balance (the core)
Per unit skin area, W/m²:

    M − W = (T_sk − T_a) / (I_cl + I_a)  +  E_sk  + C_res + E_res

- `M` metabolic rate (W/m²); `W` external work ≈ 0 for walking on trail (uphill: a few %).
- `T_sk` mean skin temperature; comfort target 33 °C sedentary, lower (31–32) at high M.
- `I_cl` intrinsic clothing insulation (m²K/W; 1 clo = 0.155).
- `I_a` boundary air-layer insulation, **wind-dependent**: this is where wind chill lives:
  `I_a ≈ 1/(h_c + h_r)`, `h_c ≈ 8.3·v^0.6` (ISO 7730 forced-convection form; v in m/s, ≥ 0.1),
  `h_r ≈ 4.7` W/m²K.
  Still air I_a ≈ 0.11 m²K/W (0.7 clo); at 5 m/s it's ≈ 0.04 (0.25 clo).
  > ⚠️ **AMENDED: see §10.2.** `8.3·v^0.6` is Mitchell (1974), not ISO, and `h_r = 4.7` is an
  > indoor convention that is ~75 % wrong at −20 °C.
- Wind also **pumps** air through permeable clothing: ISO 9920 gives a correction
  `I_cl,eff = I_cl · exp(−0.281·(v−0.15) + 0.044·(v−0.15)² ...)` style factors; a windproof outer
  layer sets the effective v inside to ~0. Model: shells are a flag that zeros the pumping term.
  > ⚠️ **AMENDED: see §10.1.** We use ISO 11079's own air-permeability correction, not ISO 9920's,
  > and a shell recovers only ~40 % of the wind penalty, not "most of it".
- `E_sk` evaporative loss: at rest ~10% of M (insensible); while sweating it's the regulator. For
  the cold-side calculation we assume no sweating; for the warm side ("will I overheat") we compare
  required evaporation against the clothing's evaporative resistance (R_et): v1 can skip this and
  flag "too warm" when required I_cl < 0.3 clo.
- `C_res + E_res` respiratory ≈ 0.0014·M·(34−T_a) + 0.0173·M·(5.87−p_a). Small but real at −10 °C.
  > ⚠️ **AMENDED: see §10.2.** Those are ISO 7730/Fanger's brackets. ISO 11079 uses expired-air
  > temperature `t_ex = 29 + 0.2·t_a`; Fanger's `E_res` is ~85 % too large at −20 °C. And the term
  > is **not** small: it is ~22 % of M and is the single largest error in the reference model.

**IREQ** (ISO 11079) is exactly "solve for I_cl such that balance holds at T_sk target." We compute
IREQ_min (survival-ish, T_sk 30 °C) and IREQ_neutral (comfort). Comfort ⇔ ensemble I_cl ≥ IREQ_neutral.
Report margin in clo. "Too warm" ⇔ I_cl > IREQ_neutral + ~0.5 and sweating implied.

### 2.2 Radiation (why night in a clearing is colder than the thermometer)
Mean radiant temperature ≠ air temperature: clear-sky effective temperature is 15–25 °C below air
at night; a tent or tree canopy brings T_mrt back near T_a; a campfire raises it on one side.
v1: `T_op = (h_c·T_a + h_r·T_mrt)/(h_c+h_r)` with T_mrt = T_a − ΔT_sky, ΔT_sky = 0 (tent/forest),
8 K (partial sky), 15 K (open clear sky). Sun during the day: +ΔT solar on the sunlit side; v1 uses
+5 K daytime-clear.

### 2.3 Ensemble insulation from garments (ISO 9920)
Garment clo values (I_clu) are *contributions to the whole-body ensemble*, already area-weighted,
so **summing is correct** for a full ensemble: `I_cl ≈ 0.835·Σ I_clu + 0.161` (ISO 9920 eq.). The
0.835 accounts for compression of overlapping layers. Air trapped between layers is already in
the garment values. Loft-based estimate for anything not in the table: ~4 clo per inch of still
loft × fractional body coverage.

### 2.4 Local comfort (the per-body-part layer)
Whole-body balance says nothing about cold hands/feet, which is what people actually complain about.
Track **extremity sub-budgets** separately: hands, feet, head each have a required local insulation
vs T_op at a given M (vasoconstriction shuts them down when the core is marginal). v1: three simple
lookups (hand/foot/head clo needed vs T_op at low/high M) and flag "cold hands" independently of
the core verdict. This is the honest version of the "dress the doll by body part" UI: the parts
*display* separately but the core verdict sums them; extremities get their own verdicts.

### 2.5 Sleep
> 🔴 **AMENDED: see §10.3. "Two independent floors" is wrong**: an ISO 23537 rating already
> contains a reference mattress, so a pad's R must never be added on top of it.

Two independent floors (under: pad R; over: bag/quilt clo). 1 R (ASTM imperial) ≈ 1.14 clo.
- `I_over = I_bag + I_worn` (clothing inside the bag adds nearly fully if the bag isn't compressed).
- `I_under = 1.14·ΣR_pads + ~0.3` (crushed bag bottom + ground coupling); ground is a conductive
  sink at ~soil temperature, not air: in v1 treat T_ground = T_a (night minimum), tent floor +1 K.
- Required at M = 0.8 MET (47 W/m²) with T_sk 33 °C: matches ISO 23537 comfort ratings (test mat
  R ≈ 4.8). Bag rating → clo: comfort T_c gives `I_bag = (33 − T_c)/(0.155·47) − I_a,still`.
- Quilts: maker rating −3 °F for cottage, −10 °F for direct-import, then same formula.
- Puffy worn in bag, hood/beanie, draft collar: additive terms with discounts.
- Wind inside a tent ≈ 0; in a 3-sided shelter use 0.5 m/s; cowboy camping use forecast v.

### 2.6 Metabolic rates (MET → W/m²; 1 MET = 58.2)
| Phase | MET | notes |
|---|---|---|
| Hiking, pack, rolling | 3.0 | scale by grade: +0.5 per 10% uphill, slower descents 2.5 |
| Hiking, steep climb | 4.5 | |
| Standing/lunch stop | 1.3 | |
| Camp chores, cooking | 1.6 | |
| Sitting in camp | 1.1 | |
| Asleep | 0.8 | |
Allow a user "runs hot/cold" slider: ±10% on M (equivalently ±1.5 °C on comfort).

### 2.7 Wet
Wet fleece/down: multiply I_clu by 0.3–0.5; synthetics 0.6–0.7; vapor-barrier socks restore.
v1: a per-phase "it rained today" toggle that applies the factor to non-shell outer layers.

## 3. Temperature model

Inputs (manual mode): daytime high, nighttime low, optional wind, sky (clear/overcast), shelter
type (tent/3-sided/open). Build a diurnal curve (sinusoid with min at ~06:00, max at ~15:00; skew
toward a slower evening drop) and sample each phase's time window → a **distribution** per phase,
widened by a user-set uncertainty (±3 °F "forecast" / ±10 °F "guess from climate").

Phases and windows (local solar time; auto-shift by latitude/date for sunrise/sunset):
- **Hiking** 08:30–16:30, M 3.0, sun + wind exposure high
- **Day break** 3 × 30 min in that window, M 1.3, sun, wind
- **Camp evening** sunset → 21:00, M 1.1–1.6, no sun, wind moderate (tent/shelter), **bag-as-blanket toggle** (+2.5 clo, leaky)
- **Camp morning** 06:00–08:30, M 1.3, coldest air + no sun; often the worst phase (people forget it)
- **Sleep** 21:00–06:00, M 0.8, pad + bag

Forecast mode (v2): lat/lon or place → Open-Meteo (free, no key, 16-day hourly incl. wind, cloud,
elevation-corrected via their elevation param). Beyond 16 d: Open-Meteo climate/ERA5 normals →
mean ± 1.5σ bands, honestly wide. Elevation lapse: −3.5 °F/1,000 ft dry, −3.0 wet, applied from
station elevation to trail elevation.

Route mode (v3): pick a named trail + start/end + dates → sample the trail's elevation profile
(OSM relation + DEM), assume a pace model (~2 mph + 30 min per 1,000 ft) → position(t) →
elevation(t) → T(t), wind(t) per phase → per-phase distributions. Output the ribbon plot: elevation
/ temperature / wind vs real datetime, with phase bands coloured (sleep dark blue, camp light blue,
hiking yellow), fuzzy to show uncertainty.

## 4. Gear ontology (v1)

Body regions × layer slots. Each slot holds 0–1 garment (no duplicates). Required slots marked *.

| Region | Inner (left of figure) | Outer (right) |
|---|---|---|
| Head | - | beanie · sun hat · balaclava · hood (from jacket) |
| Torso* | tee (0.08) · LS synthetic (0.25) · LS merino light (0.3) · merino mid (0.4) · grid fleece hoodie (0.5) | fleece 200 (0.5) · fleece 300 (0.6) · Alpha 90 (0.55) · synthetic puffy 60 g (0.9) · 100 g (1.3) · down puffy 2 oz (1.2) · 3 oz (1.8) · 4.5 oz (2.3) · wind shirt (0.15) · rain shell (0.2) · mesh-lined ski shell (0.4) |
| Legs* | briefs (0.04) · long underwear (0.3) · Alpha/Senchi leggings (0.55) · fleece pants (0.5) | shorts (0.08) · running tights (0.15) · light hiking pants (0.25) · softshell pants (0.35) · fleece-lined pants (0.5) · rain pants (0.2) · snow pants (0.6) |
| Hands | liner (0.05) | Thinsulate 40 g (0.1) · 100 g (0.15) · mitts (0.25) · rain mitts (+0.05) |
| Feet* | socks light/mid/heavy (0.02/0.03/0.05) · VBL socks | trail runners (0.08) · boots (0.1) · insulated boots (0.3) · camp sandals (0) |
| Sleep | bag/quilt by comfort rating · pad(s) by R · worn inside bag = any of the above | |

Multiple outer torso items allowed (fleece + puffy + shell): ""outer" is a stack, ordered; inner is
one. Compression factor via the 0.835 ensemble rule. Future: brand lookup → measured/estimated clo.

Allowed-combination rules: a shell goes outermost; two puffies allowed; rain pants over anything;
no shorts under rain pants in the sleep phase (silly but fine); sandals ⇒ socks optional.

## 5. Outputs

Four panels (day hiking / day break / evening camp / night sleep), plus the morning-camp panel if we
decide to show five (I'd show it: it's where people get cold).

Per panel:
- Expected temperature band (p10–p90) on a horizontal thermometer axis.
- For each *candidate ensemble* (auto-generated from the owned gear: a handful of sensible
  combinations: base only, +fleece, +shell, +puffy, +everything), a comfort interval [T_cold, T_warm]
  drawn as a bar. Dressed-doll thumbnail on each bar.
- **Coverage**: union of bars vs the temperature band. Uncovered span → red gap with "!" and a
  one-line fix ("wear the puffy inside the bag: +1.8 clo → covered to 12 °F"; "you have nothing for
  20–28 °F at a lunch stop: add a 3 oz-fill puffy").
- Extremity flags (cold hands/feet/head) separately.
- Wind and wet toggles per panel.

Global: a single sentence verdict and a "what to buy / what to leave home" list, since the same
model answers both. Optional: carried weight of the chosen kit.

## 6. Build plan

- **v1 (ship):** manual high/low + wind/sky, gear picker with the table above, five panels, coverage
  gaps and fixes, sleep system module. Static site (Svelte or plain TS + SVG), no backend. The
  physics in one `heat.ts` with tests against ISO 11079 worked examples and against the Smokies
  numbers from this trip.
- **v2:** place/date → Open-Meteo hourly; honest climate bands beyond 16 d; elevation input.
- **v3:** route mode (named trails, elevation profiles, pace model, ribbon plot).
- **Suite sibling:** Pareto-frontier gear explorer (price × weight × warmth), seeded from `products.csv`.

## 7. The video (outline)
1. Why "20 °F bag" is a lie and what ISO comfort means (manikin, R-4.8 mat).
2. Heat balance on one slide: M, T_sk, I_cl, I_a. Where wind chill actually comes from (I_a + pumping).
3. Clo: what it is, why it adds, 4 clo/inch, why fill power × fill weight predicts jacket warmth.
4. The pad side: R-value, why it's independent, 1 R ≈ 1.14 clo, ground vs air.
5. Radiation at night: why a clear sky is colder than the thermometer.
6. MET: why you're fine at 30 °F in a tee while hiking and freezing at lunch.
7. The tool: dress the doll, see the gaps, fix them. Link.

## 8. Infrastructure (2026-11-13)
- **Host:** Alex's personal site, Astro 2 + Tailwind + KaTeX (`~/projects/personal_website/personal-website`),
  deployed on Netlify behind Cloudflare. v1 is a static island on that site (an Astro page mounting
  a Svelte/Preact/vanilla-TS island); no backend. KaTeX already there → the physics write-up page
  can show the real equations.
- **Weather (v2):** Open-Meteo is keyless and CORS-friendly → still no backend. If rate limits or
  caching ever bite, a tiny proxy goes on the Hetzner box **under `hetzner_policy.md`** (own
  `/srv/will-i-be-cold`, own compose project, own cloudflared container, 127.0.0.1 port from the
  registry; Alex deploys, agents only prepare). Home server: not relevant.
- **Route mode (v3):** trail geometry + DEM sampling is a build-time job (precompute per-trail
  elevation profiles into static JSON), not a runtime service.
- **Repo:** new repo `will-i-be-cold` (library + demo), consumed by the site as a package or copied
  island. Open-source the physics (`heat.ts`): it's the credibility for the video.

## 9. Decisions (Alex, 2026-11-13)
- **v1 includes place/date forecasting.** Manual high/low stays as a fallback, not the default.
- **Place = a point, not a town.** Open-Meteo forecasts any lat/lon (1–11 km model grid) and accepts
  an `elevation=` parameter to lapse-correct from model terrain to the real elevation; the keyless
  Open-Meteo Geocoding API resolves place names, and the Open-Meteo Elevation API (90 m DEM) gives
  terrain height for any coordinate. So the UI is: search a place *or* drop a pin on a map, we
  fetch the DEM elevation for the pin, and the forecast is already for that elevation. No
  valley-proxy-minus-a-few-degrees. For a route, v1 can take 2–3 pins (start / high camp / end).
- **Horizon:** ≤ 16 days → hourly forecast (temp, wind, cloud, precip). Beyond → Open-Meteo
  Climate / ERA5-based normals for the date window at that point, shown as wide bands and labelled
  as climatology, not forecast.
- **Packaging:** separate open-source repo (`heat.ts` + tests + README), consumed by an Astro
  island on the personal site. °F default, °C toggle, SI inside.
- **Gear:** v1 generic categories; **brand database is the first post-launch step** (shared with
  the Pareto-frontier tool; seed from `~/personal/backpacking/gear_research/products.csv`).
- **Build approach:** delegate the weather/geocoding client and the physics library to separate
  subagents with contract tests; UI after both are green.

---

## 10. Amendments after implementation (2026-11-13)

Written against `docs/STANDARDS.md` (verified standard text + citations) and the shipped engine in
`packages/heat`. Each item below corrects something stated earlier in this spec. Rationale and
derivations are in `packages/heat/MODEL.md` §6.

### 10.1 A windproof shell recovers ~40 % of the wind penalty, not "most of it"

§2.1 modelled shells as a flag that zeroes the pumping term, and
`REFERENCE_warmth_check.md` says a rain shell "restores most of" the wind penalty. Both overstate it.

We use **ISO 11079's own** wind/walking correction rather than ISO 9920's, because ISO 9920's
cold-weather air-permeability term could not be verified from any obtainable source, while three
independent ports agree on ISO 11079's:

    I_T,r = I_T · [ 0.54·exp(−0.15·v_ar − 0.22·v_w)·a_p^0.075 − 0.06·ln(a_p) + 0.5 ]

with `a_p` the outer fabric's air permeability (l·m⁻²·s⁻¹, ISO 9237). Evaluated at v_ar = 2 m/s,
the bracket is 0.90 / 0.80 / 0.76 at a_p = 1 / 50 / 500: a **1.18× spread**. (`STANDARDS.md` §1.7's
prose asserts 0.90 / 0.64 / 0.33 and "a factor ~2.7"; that contradicts the equation it prints
directly above it, and is wrong. The equation is right: it reproduces ISO 11079 Table F.1.)

Engine output, hiking at 30 °F and 3.0 MET:

| condition | required insulation |
|---|---|
| calm (0.3 m/s) | 1.20 clo |
| 5 m/s, open fabric | 1.90 clo |
| 5 m/s, windproof shell | 1.62 clo |

**Most of the wind penalty is the boundary layer `I_a` collapsing, and no garment restores that.**
The shell buys back only the pumping share: 00.28 of 0.70 clo. Worth saying plainly in the tool
and the video: the thing people buy for wind fixes 40 % of wind.

### 10.2 Corrected coefficients

- **Respiratory.** §2.1's brackets are ISO 7730/Fanger's. ISO 11079 uses temperature-dependent
  expired air: `C_res = 0.0014·M·(t_ex − t_a)`, `E_res = 0.0173·M·(p_ex − p_a)`,
  `t_ex = 29 + 0.2·t_a`, `p_ex = p_s(t_ex)`. Coefficients unchanged; brackets wrong. Fanger's
  `E_res` is ~85 % too large at −20 °C. **This term is not "small but real": it is ~22 % of M and
  the single largest error in the reference model.**
- **`h_r`.** Never hard-code 4.7; that is an indoor convention. The Stefan–Boltzmann linearisation
  gives 3.8–4.0 at 20 °C and **2.5 at −20 °C**. Compute it from `t_cl` and `t_r` inside the solver.
- **`h_c`.** `8.3·v^0.6` is Mitchell (1974) via ASHRAE, valid 0.2–4 m/s: not ISO, and not valid on
  §2.1's stated 0.1–1 range. ISO 7933/9920 use `8.7·v^0.6`, meeting `3.5 + 5.2·v` exactly at
  v = 1 m/s (both = 8.7).

### 10.3 Sleep is not "two independent floors": and IREQ cannot model it

**Two separate corrections to §2.5.**

**(a) IREQ is out of validity for sleep.** ISO 11079's floors are `M ≥ 58 W/m²` and
`v_ar ≥ 0.4 m/s`. Sleeping is ~45 W/m² at ~0.05 m/s: outside on both axes. The engine therefore
runs **two models**: ISO 11079 IREQ for the four clothed phases, **ISO 23537 Annex C** for sleep.
Calling IREQ at sleeping metabolic rates throws rather than returning a number.

**(b) An ISO 23537 rating already contains a mattress.** ISO 23537-1:2022 cl. 3.6 Note 2: the rated
insulation "includes … air volume in the cavity … boundary air layer … **mattress underneath the
sleeping bag and garments worn by the sleeping bag user**." The reference mat is
`R_ct = 0.85 m²K/W` ≈ **US R-value 4.83**, plus a base layer at `R_ct` 0.040–0.060.

So **adding a pad's R-value on top of a bag's rating double-counts.** The correct model is the
**delta**: two parallel paths (over = bag; under = crushed bag + pad + ground), back-solve the
over-path from the label with the reference mat in place, then re-solve with the user's real pad.
Most backpackers carry less than R 4.83, so for most users the label is optimistic before the bag
leaves the stuff sack: and the tool quantifies by how much. An R 4.2 pad currently costs 1.9 K.

**(c) Label semantics are a required input, not a guess.** US brands label by `T_lim`, EU brands by
`T_comf`. A US "20 °F bag" means `T_lim = −6.7 °C` → `R_c = 1.061 m²K/W` → **`T_comf = 30.8 °F`**.
This reproduces `REFERENCE_warmth_check.md`'s "comfort rating is 31–32 °F" from ISO 23537's own
normative Table 1, so that line survives as a regression vector.

### 10.4 The reference model's error is not a constant

`REFERENCE_warmth_check.md`'s `clo_req = (33 − T_a)/(0.155·M)` deletes two terms that pull in
opposite directions and scale differently, so its error **changes sign across the MET range**:
it is pessimistic while moving and optimistic while still, understating the sleeping requirement
by a near-constant ×1.48 (= 1.26 respiratory/evaporative × 1.11 posture × 1.06 metabolic rate).

Its *verdicts* are kept as regression tests; its *bag clo numbers* are not, because they were
back-derived from the formula itself and therefore cannot test it. One verdict does move: camp
evening with the quilt draped goes from **fine (+0.6)** to **marginal (−0.30)**: the quilt's
contribution agrees to 0.02 clo, and the whole gap is the respiratory and evaporative terms.

### 10.5 DLE is a safety metric, not a comfort metric

ISO 11079's `DLE = Q_lim/|S|` with `Q_lim = 40 Wh/m²` answers "when is your core in heat debt",
not "when do you notice". Felt discomfort at a lunch stop is skin and extremity cooling on a
time constant of minutes. Ship DLE as a separate safety line, surfaced only when short, and do
not market it as "minutes until you feel cold": that needs a transient skin model v1 does not have.

Report DLE to **one significant figure**: ISO 11079 gives `f_cl = 1.97` in its body text but
`1.197` in its own normative Annex F program. IREQ is insensitive to the difference; DLE differs
by up to 5 h. The engine ships 1.197 and registers the ambiguity.

### 10.6 The most influential number in the engine is ours, not a standard's

`sleep.underBodyAreaFraction = 0.35`: the fraction of body surface on the under-path while supine.
No published supine area split could be found. It sets the magnitude of the entire pad-delta
feature: 0.25 halves it, 0.45 doubles it. The **direction** is certain, the **size** is our
estimate. It is registered in `UNVERIFIED_CONSTANTS`, overridable, and must be surfaced in the
tool's caveats rather than presented as a derived result.
