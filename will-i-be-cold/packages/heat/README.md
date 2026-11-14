# `@will-i-be-cold/heat`

The physics engine behind **Will I Be Cold?**: a steady-state thermal model for backpackers
that answers *"for each phase of the day, does some configuration of the gear I own keep me
comfortable across the whole range of temperatures I might see?"*

It is a real heat balance, not a lookup table. Every constant in it is traceable to a standard,
a peer-reviewed paper, or (where neither exists) to a **named, documented, overridable
parameter that says out loud that it is a guess**. The list of those guesses is in
[Unverified constants](#unverified-constants), and reading it is the honest way to judge how
much to trust any particular number.

Pure TypeScript. No I/O, no randomness, no dependencies. SI units internally; clo, imperial
R-value and °F exist only as conversions at the boundary.

```bash
npm test        # 308 tests
npm run build
```

---

## Two models, not one, and why

**This is the central design decision.** ISO 11079 (the cold-stress standard that gives you
IREQ) states two validity floors:

| Limit | ISO 11079 | A sleeping person |
|---|---|---|
| Metabolic rate | **M ≥ 58 W/m²** (1 met) | ~45 W/m² (0.76–0.82 met) |
| Relative air velocity | **v_ar ≥ 0.4 m/s** | ~0.05–0.1 m/s in a tent |

A sleeping person is outside the standard **on both axes at once**, and the reference
implementation returns `NaN` below the velocity floor rather than extrapolate. ISO 23537 exists
precisely because IREQ does not cover sleep. So the engine carries two models:

| Phase | Model | Module |
|---|---|---|
| `hiking`, `day_break`, `camp_evening`, `camp_morning` | **ISO 11079** IREQ + DLE | [`src/ireq.ts`](src/ireq.ts) |
| `sleep` | **ISO 23537-1 Annex C** | [`src/sleep.ts`](src/sleep.ts) |

Both produce the same `ThermalAssessment`: same fields, same verdict vocabulary, same
`marginK` scale: so the UI never has to know which one ran. The `model` field says which one
did, so the caveats panel can quote the right standard. Asking for a clothed assessment at a
sleeping metabolic rate **throws**, with a message pointing at the sleep model; it does not
quietly return a number.

---

## The public API

```ts
import { coverage } from '@will-i-be-cold/heat';

const report = coverage(gear, phases, temperatureDistributions);
report.gaps;      // ← the product: every uncovered span, with a one-line fix
report.verdict;   // one sentence for the top of the page
```

| Export | What it does |
|---|---|
| `coverage(gear, phases, tempDistributions, options?)` | Generates candidate ensembles from owned gear, computes each one's comfort interval, returns per-phase coverage of the expected band plus **first-class gaps with fixes**. |
| `assess(configuration, conditions)` | One configuration against one set of conditions → `ThermalAssessment`. Dispatches to IREQ or ISO 23537. |
| `ireq(input, options?)` | The full ISO 11079 balance: IREQ_neutral, IREQ_min, margin, DLE. |
| `recoveryTime(recoveryConditions)` | ISO/TR 11079 §5.5 recovery time. |
| `solveSleepSystem(input)` | Bag label + pads + clothing → this user's comfort / limit / extreme temperatures and the kelvin of optimism in the label. |
| `annexCTemperature(Rc, kind)` / `annexCResistance(t, kind)` | ISO 23537 Annex C, both directions. |
| `interpolateTable1(Rc)` | The normative ISO 23537-1 §4.1 lookup. |
| `ensembleInsulation(garments, options?)` | ISO 9920 Eq. (11), with validity-range warnings. Returns the ensemble **closed and fully vented**. |
| `garmentAdjustability(g)` / `adjustabilityClass(g)` | How much of a garment you can shed without taking it off, and which class that comes from. |
| `configurationVentableClo(config, conditions?)` | Clo a clothed configuration can shed without undressing. |
| `campfireEffect(source, ctx)` | `docs/CAMPFIRE.md` §9: irradiance, `Δt_o`, `Δt̄_r`, the radiant-asymmetry flag. |
| `resolveEnvironment(input)` | Operative temperature, mean radiant temperature, night-sky cooling, shelter effects. |
| `skyTemperature(input)` | Sky emissivity and effective sky temperature on their own. |
| `assessExtremities(base, worn)` | Hands / feet / head, **heuristic**, independent of the core verdict. |
| `UNVERIFIED_CONSTANTS` | Every estimated number the engine ships, with a note on each. |

Types worth knowing: `ThermalAssessment`, `ComfortInterval`, `CoverageGap`, `GapSeverity`,
`Fix`, `DurationLimitedExposure`, `ModelWarning`, `Provenance`, `ThermalModelError`,
`RadiantSourceInput`, `CampfireEffect`, `GarmentAdjustabilityClass`.

### Errors and warnings

The engine **never returns `NaN`**. Anything it cannot compute honestly raises a
`ThermalModelError` with a code and an explanation. Anything it can compute but shouldn't be
fully trusted comes back as a `ModelWarning` on the result: including every validity-range
violation, the pad-additivity assumption, and the ISO 9920 ensemble rule being used outside its
tested range.

**Each caveat and warning is said once.** The caveats list is the one place the tool tells people
what the model does not know, so it is kept readable on purpose. A phase assesses several
candidates, and most warnings are properties of the *phase*, so they used to arrive once per
candidate: four near-identical paragraphs differing only in a clo figure or an hour count, which
reads as a bug and buries the caveats that say something different. So **no caveat or warning text
carries a per-candidate number**; the numbers live on the candidate
(`CandidateEnsemble.ventingCloRange`, `assessment.detail.dleMin`, `EnsembleResult.sumClo`) where a
UI can show them next to the bar they belong to, and `coverage()` deduplicates identical
warnings per phase and across the report. Genuinely different warnings, such as the three
per-part extremity notes, are untouched.

---

## Every equation, and where it comes from

All clause references are to [`docs/STANDARDS.md`](../../docs/STANDARDS.md), which carries the
primary sources, URLs and confidence labels.

### ISO 11079:2007, IREQ (`src/ireq.ts`)

| Quantity | Form | Source |
|---|---|---|
| Heat balance | `M − W = E_res + C_res + E + K + R + C + S`, with `K = S = 0` for IREQ | Eq. (1), §5.3.1 / §5.4: STANDARDS §1.1 |
| IREQ | `IREQ = (t̄_sk − t_cl)/(R + C)` | Eq. (8): STANDARDS §1.2 |
| Iteration | `t_cl = t̄_sk − IREQ·(M − W − E_res − C_res − E)`, bisect to balance | Eq. (9): STANDARDS §1.2 |
| Neutral criterion | `t̄_sk = 35.7 − 0.0285·M`, `w = 0.001·M` | Annex B: STANDARDS §1.3 |
| Min criterion | `t̄_sk = 33.34 − 0.0354·M`, `w = 0.06` | Annex B: STANDARDS §1.3 |
| Skin evaporation | `E = w(p_sk,s − p_a)/R_e,T,r`, `R_e,T,r = (0.06/0.38)(I_a,r + I_cl,r)` | Eq. (4): STANDARDS §1.4 |
| **Respiration** | `C_res = 0.0014·M(t_ex − t_a)`, `E_res = 0.0173·M(p_ex − p_a)`, **`t_ex = 29 + 0.2·t_a`**, `p_ex = p_s(t_ex)` | Annex A: STANDARDS §1.5 |
| **h_r** | `ε σ (A_r/A_Du)·[(t_cl+273)⁴ − (t_r+273)⁴]/(t_cl − t_r)`, ε = 0.95, **A_r/A_Du = 0.77** | Eq. (5): STANDARDS §1.6 |
| h_c | `1/I_a,r − h_r`: **by subtraction, never an explicit correlation** | STANDARDS §1.6, §5.4 |
| Boundary layer | `I_a,r = 0.092·e^(−0.15 v_ar − 0.22 v_w) − 0.0045`; static `I_a = 0.085` | STANDARDS §1.6 |
| Wind/walking correction | `I_T,r = I_T·[0.54 e^(−0.15 v_ar − 0.22 v_w)·a_p^0.075 − 0.06 ln a_p + 0.5]` | **ISO 11079's own**, STANDARDS §1.7 |
| Clothing area factor | `f_cl = 1 + 1.197·I_cl,r` | Annex F: STANDARDS §1.6 |
| DLE / recovery | `D_lim = \|Q_lim\|/\|S\|`, `Q_lim = 144 kJ/m² = 40 Wh/m²` | STANDARDS §1.8 |
| Validity | t_a ≤ 10 °C, 58 ≤ M ≤ 400 W/m², 0.4 ≤ v_ar ≤ 18 m/s, v_w ≤ 1.2 m/s | STANDARDS §1.9 |

Three choices inside that table are worth stating plainly, because the familiar version is
wrong in this domain:

1. **Respiration is ISO 11079's, not Fanger's.** The textbook forms fix expired air at 34 °C
   and 5.87 kPa. At −20 °C that overstates `C_res` by ~20 % and `E_res` by ~85 %.
2. **`h_r` is computed inside the iteration, never hard-coded to 4.7.** 4.7 W/m²K is an indoor
   whole-body convention; the linearisation gives 4.18 at a 20 °C mean and **2.69 at −20 °C**.
   A hard-coded 4.7 overestimates radiant loss by ~75 % at −20 °C.
3. **The wind correction is ISO 11079's, not ISO 9920's.** ISO 9920's is validated only to
   `I_cl ≤ 1.4 clo` and `v_ar ≤ 3.5 m/s`, which excludes essentially every winter ensemble, and
   its cold-weather variant containing `a_p` is marked *"UNVERIFIED: do not ship"* in
   STANDARDS §7.1 because the two available renderings place `a_p^0.144` differently.

The ISO 7933 / ISO 9920 convective pair: `max(2.38|Δt|^0.25, 3.5 + 5.2 v, 8.7 v^0.6)`, the two
forced branches meeting *exactly* at v = 1 m/s: is exported as `convectiveCoefficientIso9920`
for the operative-temperature calculation, and is deliberately **not** used inside IREQ, where
it would double-count the wind. Note 8.7, not the 8.3 of `SPEC.md` §2.1: `8.3 v^0.6` is
Mitchell (1974) via the ASHRAE Handbook, for motionless subjects, and its circulating
`0.1 ≤ v < 1` bounds are not published anywhere.

### ISO 23537-1: sleeping bags (`src/sleep.ts`)

| Quantity | Form | Source |
|---|---|---|
| Rating conversion | **Table 1 + linear interpolation** (there is no published regression | §4.1) STANDARDS §3.1 |
| Annex C balance | `M_B + M_S = H_c + H_e + H_res`, ΔS = 0 | C.1–C.2: STANDARDS §3.2 |
| Dry | `H_c = (t_sk − t_a)/R_c,eff` | C.3 |
| Evaporative | `H_e = w(p_sd − p_a)/R_e,eff`, `R_e,eff = 60·R_c,eff/i_m`, `w = 0.06` | C.4 |
| Respiratory | `H_res = M[0.5524 − 0.00144(t_a+273) − 0.00632 p_a/(t_a+273)]` | C.5 |
| T_comf | M_B 44.4 W/m², no shivering, **R_c,eff = 0.9 R_c**, i_m 0.50, standard **woman** | STANDARDS §3.2, §3.4 |
| T_lim | M_B 47.5 W/m², no shivering, R_c,eff = R_c, i_m 0.54, standard **man** | STANDARDS §3.2, §3.4 |
| T_ext | M_B 44.4 + **M_S 25.4 W/m²** shivering, R_c,eff = R_c, i_m 0.54, standard woman | STANDARDS §3.2 |
| Reference mattress | `R_ct = 0.85 m²K/W` ≈ **imperial R 4.83** | §Test setup: STANDARDS §3.5 |
| Reference base layer | two-piece suit, `R_ct` 0.040–0.060 m²K/W | STANDARDS §3.5 |
| Pad R | ASTM F3340-22; `1 R = 0.1761102 m²K/W = 1.13619 clo` | STANDARDS §4.5 |

Two structural facts drive everything in this module:

**`R_c(1)` is the whole system, not the bag.** ISO 23537-1:2022 clause 3.6 Note 2 says the
rated insulation "includes the effects of the shell fabrics and filling materials, air volume
in the cavity inside the sleeping bag, boundary air layer on the outer face of the sleeping
bag, **mattress underneath the sleeping bag and garments worn by the sleeping bag user**".
So `SPEC.md` §2.5's "two independent floors: add the pad's R to the bag's clo" **double-counts
the pad**. What replaces it is the delta model:

1. Convert the label to a whole-system `R_c(1)` through Annex C, **in the direction the label
   states**.
2. Split the body into parallel paths: *over* (bag loft + cavity + boundary layer) and *under*
   (crushed bag + mattress): and back-solve the over-path so that the parallel combination
   with the **ISO reference mattress** reproduces the label's `R_c(1)`.
3. Re-solve with the user's actual pads, clothing worn inside, and hood / draft-collar state.
4. Run Annex C forward for this user's comfort / limit / extreme temperatures.

Most backpackers carry less than R 4.83, so for most users step 3 is a penalty: the label was
optimistic before the bag came out of the stuff sack: and `padPenaltyK` says by how much.

**`ratingType` is a required input and is never guessed.** US brands label by `T_lim`, European
brands by `T_comf`. STANDARDS §3.6 cites one real bag that is "12 °F" and "23 °F"
simultaneously. Guessing is a ~6 K error on the headline number. And because `T_comf`/`T_ext`
are computed for a "standard woman" while `T_lim` is computed for a "standard man", the three
numbers on a label are **not three points on one person's curve**; the engine says so in its
caveats.

### ISO 9920:2007, ensembles (`src/garments.ts`)

`I_cl = 0.161 + 0.835·Σ I_clu` [clo]: Eq. (11) verbatim, yielding **basic (intrinsic)**
insulation, not total. The equation is clo-specific: the 0.161 constant has units.

Its stated validity, verbatim, is **0.2–1.6 clo**. Expedition layering is 3–5 clo. Kuklane et
al. (2021) independently extended the test to 3.33 clo on one ambulance clothing system and
found −18 %/+12 % agreement. So the engine warns in three tiers (below 0.2, above 1.6, above
3.33) and also reproduces the standard's own warning that the summation "should not be used
for extreme situations (e.g. three layers on lower body and only a thin layer on upper body)".

ISO 9920 Annex A (the actual garment tables) is past the end of every free preview and was
never obtained. So the catalogue's `provenance` field matters: only five entries (briefs,
T-shirt, long-sleeve shirt, trousers, shorts) carry `'ashrae'`, because those really are in the
published ASHRAE 55 / ISO 7730 Annex C list. Every technical outdoor garment (fleece, Alpha
Direct, puffies, shells) is marked `'estimated'`.

#### Slots: one per region, except where layers really stack

A garment carries a `region` (head, torso, legs, hands, feet) and a `slot` (`inner` or
`outer`). The slot exists to stop the ladder putting two base layers on one region, so a region
only needs both slots when something really is worn *under* something else and the two are
different kinds of thing: a base layer under a fleece, long underwear under trousers, socks
inside boots.

**Hands have one slot, like the head.** A separate `hands`/`inner` slot held exactly one
garment, the liner gloves, and bought exactly one thing: liners worn under mitts. That is a
real combination and it is warmer than either pair alone, but it is a *ladder* fact, not an
ontology fact, so the ladder is where it now lives (`handsStack` in `coverage.ts`, and the
rung list below). `liner_gloves` is therefore catalogued as `hands`/`outer` like every other
pair of gloves, and `GARMENTS` has no `hands`/`inner` entry at all.

⚠️ **A deliberate deviation from `SPEC.md` §4**, which lists a hands inner slot. Nothing
observable was lost: a liner under mitts still totals 0.30 clo, and `coverage.test.ts` pins
that number so the deviation cannot quietly become a regression.

#### A garment is not binary: adjustability

A garment is **continuously adjustable**: worn open, zipped or unzipped, sleeves pushed up, pit
zips, hood up or down, a quilt draped loosely or wrapped tight. So a configuration does not have
one insulation value; it has a **range**, and therefore a comfort **envelope** rather than a
rectangle:

```
          fully closed                              fully vented
   ──────────┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■├──────────
         coldLimitC                                    warmLimitC
                          fullyClosedWarmLimitC ┤
```

**The cold limit does not move.** Fully closed is as warm as a given set of garments gets, so
venting extends the interval *upward in temperature only*. That asymmetry is the whole point:
`ComfortInterval.warmLimitC` is now the vented warm end, `fullyClosedWarmLimitC` is the old
binary one (kept, because the configuration's own dT/dclo sensitivity is measured on it), and
`ventableClo` is how much it can shed.

`ensembleInsulation()` applies Eq. (11) to the reduced `I_clu` values, so the **0.161 clo
intercept survives venting**: it is the ensemble-ness, not a garment, and no zip removes it.

⚠️ **The adjustability values are all `estimated`, and here is exactly why.** ISO 9920 *does*
tabulate garments worn open versus closed, and §8.1 states the mechanism verbatim: "the
influence of wind depends on the air permeability of the outer textile layer and on **the types
and number of openings**". But the table is in **Annex A, which `docs/STANDARDS.md` §7.2 item 10
records as never obtained**. So the standard supports the existence of the open/closed split and
gives us no numbers for it. The *ordering* across classes is physical; the magnitudes are ours,
and every one is registered in `UNVERIFIED_CONSTANTS`:

| Class | Default | What you are actually doing |
|---|---|---|
| `base-layer` | 0.05 | Push the sleeves up, open a quarter-zip collar. Almost nothing. |
| `full-zip-mid` | 0.35 | A full-length zip opened over the whole chest, hood down. |
| `insulated-jacket` | 0.30 | Main zip, pit zips, hood down: but the loft stays on your arms and back. |
| `shell` | 0.15 | **Mostly binary**: most of a shell's clo is windproofing, which an open zip does not remove. |
| `pants` | 0.10 | Roll the cuffs, open side zips. |
| `headwear` | 0.30 | Push a beanie back off the ears, pull a balaclava down off the face. |
| `handwear` / `footwear` | 0 | Binary. Taking gloves off is removal, which is a different rung. |
| a draped bag/quilt | 0.60 | **The most adjustable thing in the model**: it is held on by nothing. |

Two garments override their class because the class is wrong for them: a T-shirt is 0 (no zip,
no pit zips, no sleeves to push up) and `jacket_hood` is **1.0**: the whole of that "garment" is
an adjustment, since putting the hood down sheds all of it without removing anything.

### Operative temperature and night-sky cooling (`src/environment.ts`)

| Quantity | Form | Source |
|---|---|---|
| Clear-sky emissivity ⭐ | `ε_sky,c = 0.633 + 0.057·√P_w` (night, P_w in hPa) | Li, Jiang & Coimbra (2017), 7 NOAA SURFRAD stations: STANDARDS §6.4 |
| Cloud | `ε_sky = ε_clear + 0.784·n·(1 − ε_clear)` | Martin & Berdahl: STANDARDS §6.6 |
| Sky temperature | `T_sky = ε^0.25 · T_a` | STANDARDS §6.2 |
| Mean radiant | `T_mrt = (0.5·T_upper⁴ + 0.5·T_ground⁴)^¼` | STANDARDS §6.7, §6.8 |
| Operative | `t_o = (h_c t_a + h_r t_r)/(h_c + h_r)`, cross-checked against the ASHRAE 55 `A`-table | STANDARDS §6.1 |

STANDARDS §6.4 is blunt that *"the Swinbank, Idso and Jackson and Ruckstuhl models … are not
recommended for future use"*, so they are not the default. The widely-repeated "a clear night
sky is about −70 °C" is a brightness temperature inside the 8–13 µm window, not the broadband
value a fabric sees; the real broadband depression is **15–27 K**, and the engine reproduces
that.

**The headline:** a clear night costs a person in the open roughly **5–6 K of operative
temperature** versus the air temperature the forecast reports, and roughly 4–5 K versus the
same night overcast. It is the single largest correction in the model and it is invisible on a
thermometer.

🔴 **And the tent result is probably not what you expect.** Two independent peer-reviewed
campaigns measured unoccupied tent air **0.9–1.2 K BELOW ambient** on clear nights, and a
cold-weather field study measured −2.2 K. A tent is not a passive air-warming device; **its
benefit is radiant**: the fly blocks the sky and raises `T_mrt` by ≈ 4.3 K at essentially
unchanged air temperature. The engine follows the measurements: `SHELTERS.tent.airOffsetK` is
**−1.0**. Seeber's occupied double-wall figure (+1.1 K, single-source, not peer-reviewed) is
available as an explicit opt-in, not a default. A consequence that falls out and is tested: a
tent beats the open sky, but at low metabolic rates a **forest canopy beats the tent**, because
the canopy costs no air temperature.

Forest is modelled with its radiative and aerodynamic terms **separate**, deliberately: STANDARDS
§6.9 records that forest understory minima run ~1–3 °C warmer than the open, *and* that Karlsson
(2000) measured forest air up to 3 °C **colder** than extensive open ground. Folding those into
one "forest is warmer" offset would hide the mechanism.

#### A campfire (`CAMPFIRE`, `campfireEffect`): **off by default**

A fire is a **radiant** source, so it raises mean radiant temperature and reaches the balance
through `t_r` and the operative-temperature path above. It is **never** modelled as a metabolic
bonus: sitting by a fire does not make you produce more heat. All numbers are
[`docs/CAMPFIRE.md`](../../docs/CAMPFIRE.md) §9.2's recommended parameter block, and `CAMPFIRE`
in `environment.ts` is the single place they live.

| Quantity | Form | Source |
|---|---|---|
| Irradiance | `E(r) = χ_rad·Q̇ / (4π·[r² + (z_t − z_s)²])` (point source) | CAMPFIRE.md F1 / NISTIR 6546 |
| Operative gain | `Δt_o = f·E/(h_c + h_r)` | F2 |
| Mean radiant gain | `Δt̄_r = f·E/h_r` (derived diagnostic) | F2 |
| Coupling | `f = (α_fire/ε)·(A_p/A_D)` = 0.179 seated, 0.224 standing | §6.1 |
| `χ_rad` | **0.15**: measured, free-burning wood cribs | Yu (2014) |
| `A_p/A_D` | **0.202** seated, 0.254 standing: measured | ASHRAE 55 §C1/§C4 |
| Asymmetry | `Δt_pr = (ε/f_p)·Δt̄_r`; the 23 K limit is reported, not flagged | ASHRAE 55 Table 5-10 |

**Design result: `Δt_o ≈ 2.0 K` at 1.2 m in still air** (`Δt̄_r ≈ 3.8 K`). The engine reproduces
CAMPFIRE.md §8.2's whole distance/wind table as a test. Three things in that are worth saying
plainly:

1. **`h_r` cancels out of `Δt_o`: but only if the same `h_r` is used in both places.** `h_r` is
   the largest single parameter uncertainty in the chain and it has *no effect* on the answer, so
   `h_r` is evaluated once per environment (on the fire-free `t_r`) and shared between the fire's
   conversion and the `t_o` blend. Hard-coding 4.7 here while the model computes 3.4 elsewhere
   would understate the benefit by 28 %: or, reversed, overstate it by 38 %.
2. **Wind matters more than distance.** At 2 m/s the same fire at 1.2 m is worth **0.81 K**, not
   2.0 K, because `h_c` triples. Sitting 2 m away in still air is the same deal.
3. **`χ_rad = 0.3–0.4` is the wrong bracket**: those are large liquid-pool numbers and would
   roughly double the benefit. Not used.

Edge behaviour, all explicit: below **0.75 m** the point source is outside its `L/D > 2.5`
validity criterion and over-predicts, so `E` is clamped to its 0.75 m value with an
`out-of-range` warning rather than extrapolated; beyond **4 m** the benefit is exactly zero
(measured: "no thermal effect … at 4 m and above"); and above **4 m/s** the benefit is flagged
unreliable.

The radiant asymmetry is **computed and reported, and deliberately not warned about**.
CAMPFIRE.md §7.4 recommends flagging `Δt_pr` above ASHRAE 55 Table 5-10's 23 K warm-wall limit,
and that threshold is kept in `CAMPFIRE` and surfaced on
`CampfireEffect.asymmetryExceedsLimit` so its provenance is not lost. But ASHRAE 55 is about
office occupants who cannot move away from a warm wall. A warm front and a cool back is the
*point* of sitting by a fire, not a fault condition, and an alarm there would tell a user
something is wrong when nothing is. The asymmetry's real consequence is enforced where it
actually matters (the extremities get none of the benefit) and stated as a plain caveat in the
same register as the others, not as a flag.

🔴 **The fire's benefit is withheld entirely from the extremity verdicts**: both the operative
temperature they are judged against *and* the core margin that drives vasoconstriction, so the
reference configuration is re-assessed with the fire removed. That is **not** conservatism:
Watanabe et al. (2023) instrumented a real campfire and found **no rise at all on the
back-facing sensor at any distance**, and the `A_p/A_D = 0.202` the benefit is computed from is a
whole-body average that says nothing about how it is distributed between your shins and your
back. It will be wrong in the other direction for hands deliberately held out to the fire; the
fix for that is per-segment projected-area factors, which CAMPFIRE.md §10 item 14 records as not
found. The fire is also a **no-op for the sleep phase** rather than a quiet bonus.

⚠️ **The weakest link is the fire itself.** There is **no published heat-release-rate measurement
of an actual campfire**; the 10 kW is inferred by inverting a flame-height correlation whose own
source says it does not apply to fuels with substantial in-depth combustion: i.e. not wood
(CAMPFIRE.md §10 item 1). That sentence is in the caveat string the engine ships.

### Extremities (`src/extremities.ts`): a heuristic, and labelled as one

🔴 **`docs/STANDARDS.md` contains nothing rigorous on local cooling.** ISO 11079's title ends
"… and local cooling effects", but its Annexes A–F are past the end of every public preview, so
the standard's own finger/toe temperature limits, wind-chill index and contact-cooling limits
were never obtained. Nothing else in the document covers extremities at all.

So this module is an explicit heuristic. It has the right *shape*: a local steady-state balance
in which colder air and lower blood flow both raise the requirement, coupled to the whole-body
margin so that vasoconstriction shuts the hands down when the core is marginal: and its inputs
(local skin-temperature thresholds, local heat fluxes, segment area fractions) are **estimated
by us**. Every result carries `rigour: 'heuristic'` and a caveat string saying so. It never
returns a `dangerous` verdict, because there is no frostbite criterion behind it and a heuristic
should not invent one.

The only evidence for its numbers is that it lands where field experience does: with a core at
the comfort threshold and 0 °C operative, liner gloves are not enough and insulated mitts are
about the threshold; a beanie is about the threshold for the head; trail runners and midweight
socks leave the feet short: and a hiker with core headroom to spare is fine in liners at the
same temperature.

---

## Coverage: the layering ladder, and three kinds of hole

### The ladder is nested, then pruned

`coverage()` used to enumerate combinations, which produced outfits nobody would wear: a shell
over a bare base layer with no fleece, a *lighter* base layer than the rung above it: and labels
that read oddly. It now builds the way people actually dress:

1. **A nested chain.** Rung 0 is the minimum sensible outfit (one torso inner, the pants you are
   wearing, socks, shoes); **each rung is the previous rung plus exactly one garment**, added
   from the skin outwards: base, hat, mid, insulation, gloves, then the shell outermost and rain
   pants over anything. `SPEC.md` §4's rules still hold, and nesting makes most of them automatic.
   Hands get up to **two** rungs, because gloves stack: the warmest pair you own, and the next
   warmest worn under it (a shell pair, rain mitts, always goes outside whatever it is paired
   with). That is the one place the ladder, rather than the catalogue, carries a layering fact,
   and it is why hands no longer needs an inner slot.
2. **Then the Pareto filter.** A rung is kept only if it covers a slice of the band that **no
   lighter rung covers** (`CandidateEnsemble.uniquelyCoversC`). Nesting gives naturalness; unique
   coverage gives non-redundancy. If *nothing* in the kit reaches the band there is nothing to
   discriminate on, so the whole ladder is returned and the cold gap speaks for itself.

Because the chain cannot swap base layers (swapping is not adding) it commits to the **warmest**
inner you own. The warm end of the band is then covered by *venting*, which is why the
adjustability model had to land first. For the worked kit below this takes the old generator's 5
combinations to a 6-rung ladder of which **4 survive** while hiking.

`shortLabel` still names each candidate by its delta from the lightest, and with a nested chain
that delta is exactly the garments you add: `base only`, `+ beanie`, `+ beanie + liner gloves`.

### Gap severities

`CoverageGap.severity` has a third value. **`'cold'` and `'too_warm'` mean exactly what they did
before**; coverage is simply now measured against the union of the vented-to-closed envelopes.

| Severity | Meaning |
|---|---|
| `'cold'` | Below the coldest configuration you own, fully closed. Nothing you can put on reaches down here. |
| `'too_warm'` | Above the warm end of the lightest configuration you own, *even fully vented*. |
| `'nothing_between'` | **New.** An interior hole: your kit brackets this range but nothing you own sits *in* it, and venting does not bridge it. |

The bug this fixes: the panel used to report *"25–26 °F falls between two of your
configurations"*. With binary garments that is exactly what comes out: a sliver neither rung
covers. Model the garments as adjustable and the gap is **gone, because the warmer rung opened up
really does reach that slice**. Nothing is suppressed: an interior gap that survives venting is
real and is still reported. A base layer and an expedition parka and nothing between is not
bridged by a zip, and the engine says so in its own words: *"Nothing you own fits 39–50 °F.
Your base layers are too cold there even closed up, and your base + puffy too warm even wide
open."* It then proposes an *intermediate* layer, one that lands in the gap rather than jumping
over it.

Classification is computed against the **whole** ladder, not the surviving rungs, so pruning a
rung that is too warm for the band can never turn an interior gap into a false `'cold'`.

### The words it uses

Every string this package generates (`report.verdict`, every `Fix`, every warning, every
caveat) is written to four rules. They came out of a review that said the old headline was
"too wordy, too technical, and worst of all, it references things that no one would
understand", and they are enforced by `src/prose.test.ts` rather than by good intentions.

1. **Lead with the consequence, not the derivation.** The old headline opened with where the
   arithmetic landed: *"You are short in camp in the evening, the biggest gap is 18 to 40 °F.
   You need +3.2 clo to reach 18 °F and nothing in the v1 ontology does that in one piece."*
   It now opens with what happens to you: *"Nothing you own is warm enough below 40 °F in camp
   in the evening."*
2. **No model vocabulary.** No ontology, no ensembles, no comfort intervals, no IREQ, no
   clause numbers. A **caveat** may name a standard, because naming the standard is the point
   of the caveats panel. A headline or a fix may not.
3. **Numbers where they inform a decision, nowhere else.** A jacket you would have to buy
   keeps its clo, because that is what you would shop on. A jacket you already own and only
   have to put on does not, because the number changes nothing you do.
4. **Short sentences, readable in one pass.** The headline is at most three sentences, and
   each `Fix` carries a one-clause `short` form, which is the action without the arithmetic:
   `text` is *"A down puffy (~4.5 oz fill) is the warmest single layer there is, and it still
   stops at 29 °F. Reaching 25 °F needs +2.6 clo, more than any one layer carries."*, and
   `short` is just the first of those two sentences. The headline uses `short`; the gap panel
   shows `text`.

And one house rule that has nothing to do with physics: **no em dash, anywhere.** Not in a
string, not in a comment. `prose.test.ts` walks every string the package can hand out and
fails on one, and it also fails on the two usual ways of pretending to obey (a spaced hyphen
or a spaced en dash standing in for the same dash). An en dash *between numbers* is how ranges
are written and is fine.

**Plain is not the same as overconfident.** The engine still refuses to claim more than the
model supports: an interior hole is reported as a dressing problem rather than a cold risk, a
kit that only fails at the warm end says so instead of claiming full coverage, and when no
single layer closes a gap the fix says how far the warmest one gets and how much is missing
rather than recommending it and going quiet.

## Worked example

Andy's kit from [`REFERENCE_warmth_check.md`](../../REFERENCE_warmth_check.md), plus a beanie
and liner gloves, on the AT in the Smokies in mid-November.

```ts
import { coverage, fahrenheitToCelsius as F } from '@will-i-be-cold/heat';

const gear = {
  garments: ['ls_synthetic', 'grid_fleece', 'rain_shell', 'alpha_leggings',
             'hiking_pants', 'rain_pants', 'socks_mid', 'boots', 'beanie', 'liner_gloves'],
  sleep: {
    bag: { kind: 'bag', ratingC: F(20), ratingType: 'limit' },  // a US "20 °F" bag
    pads: [{ imperialR: 4.2, label: 'insulated air pad' }],
  },
};

const phases = [
  { phase: 'hiking',       conditions: { relativeHumidity: 0.75, cloudCover: 0.6, windSpeed: 3, shelter: 'open'   } },
  { phase: 'day_break',    conditions: { relativeHumidity: 0.75, cloudCover: 0.6, windSpeed: 3, shelter: 'open'   } },
  { phase: 'camp_evening', conditions: { relativeHumidity: 0.80, cloudCover: 0.2, windSpeed: 1, shelter: 'forest' } },
  { phase: 'camp_morning', conditions: { relativeHumidity: 0.85, cloudCover: 0.2, windSpeed: 1, shelter: 'forest' } },
  { phase: 'sleep',        conditions: { relativeHumidity: 0.90, cloudCover: 0.2, windSpeed: 1, shelter: 'tent'   } },
];

const band = (lo, hi) => ({ p10: F(lo), p50: F((lo + hi) / 2), p90: F(hi) });
const report = coverage(gear, phases, {
  hiking: band(30, 48), day_break: band(32, 48), camp_evening: band(25, 40),
  camp_morning: band(22, 34), sleep: band(20, 34),
});
```

What comes back, starting with the one sentence at the top of the page:

```
verdict  Nothing you own is warm enough below 48 °F at a break on the trail. Same in 3 other
         phases. A down puffy (~4.5 oz fill) would cover it.

hiking        band 30–48 °F   ISO 11079   covered 100%   4 of 6 rungs survive
  base only                              1.36 clo  vent 0.19  [42 … 72] °F  uniquely 42–48
  + beanie                               1.44 clo  vent 0.22  [40 … 70] °F  uniquely 40–42
  + beanie + liner gloves                1.48 clo  vent 0.22  [39 … 69] °F  uniquely 39–40
  + rain shell jacket + beanie + gloves  1.65 clo  vent 0.24  [24 … 61] °F  uniquely 30–39
  hands marginal · feet marginal · head fine
  (rung 0, base layers with the fleece off, is dropped: at 0.90 clo its interval starts at
   54 °F, above the band. "Everything on" is dropped too: the shell rung already covers
   everything it would.)

day_break     band 32–48 °F   ISO 11079   covered 0%   whole ladder returned
  (the same six rungs, all cold: 1.3 met instead of 3.0 met moves every interval ~25 °F warmer)
  GAP 32–48 °F [cold] → A down puffy (~4.5 oz fill, +2.3 clo) would cover it, down to 32 °F.
  hands cold · feet cold · head marginal

camp_evening  band 25–40 °F   ISO 11079   covered 0%
  GAP 25–40 °F [cold] → A down puffy (~4.5 oz fill) is the warmest single layer there is, and it
                 still stops at 29 °F. Reaching 25 °F needs +2.6 clo, more than any one layer
                 carries.

camp_morning  band 22–34 °F   ISO 11079   covered 0%
  GAP 22–34 °F [cold] → A down puffy (~4.5 oz fill, +2.3 clo) would cover it, down to 22 °F.

sleep         band 20–34 °F   ISO 23537   covered 0%
  Bag + pads   R_c 1.00 m²K/W   comfort 34 °F
  GAP 20–34 °F [cold] → Put another R 3.4 of pad under you and you are covered down to 20 °F.
                 You carry R 4.2; the rating on the bag assumes R 4.8.
```

Note the intervals: each bar's cold end is where those garments *fully closed* stop working, and
its warm end is where they stop working *fully vented*: which is why consecutive rungs overlap
and this kit reports no interior gaps at all. It never did deserve any: every step on this ladder
is smaller than one clo.

The same gear is **100 % covered while hiking and 0 % covered standing still twenty minutes
later**, on the same air temperature. That gap (metabolic rate, not weather) is the whole
point of the tool.

And the sleep row is the headline for the video: a US-labelled **"20 °F bag" has an ISO comfort
rating of 31 °F** before you account for the pad, and with a typical R 4.2 pad instead of the
R 4.83 reference mattress baked into the rating, its real comfort limit is **34 °F**. The engine
reproduces the 31 °F figure from ISO 23537's own normative table, independently of the field
heuristic that first claimed it.

---

## Caveats

Read these before quoting a number from this library.

**Steady state only.** ISO 11079 drops the storage term to compute IREQ. The verdict is *where
you settle*, not *how you feel in the first ten minutes*. Felt discomfort at a lunch stop is
skin and extremity cooling with a time constant of minutes, driven by vasoconstriction, not by
whole-body heat storage. This engine does not model the transient.

**±1 clo person to person.** Required insulation at identical conditions varies by roughly this
much between individuals, and one field validation study reports ISO 11079 "needs improvement
with respect to gender". The margin this library reports is a model, not a measurement of you.

**Wet changes everything, and this model barely models it.** `docs/STANDARDS.md` has nothing on
wet insulation. The wet derate here is `SPEC.md` §2.7's retention factors (down 0.3, fleece 0.4,
synthetics 0.65), all estimated. `REFERENCE_warmth_check.md` simply says "the check assumes dry
layers", which is the honest position.

**The `f_cl` ambiguity, and why DLE is reported to one significant figure.** ISO 11079's body
text says `f_cl = 1 + 1.97·I_cl`; its own normative Annex F program says `1 + 1.197·I_cl`. The
latter is what three independent ports compute and what reproduces the standard's own Table F.1,
so it is what ships. IREQ is nearly insensitive to the choice: but **DLE is not**, with
reported differences of up to 5 h for long exposures. So `DurationLimitedExposure.hours` is
*already rounded* to one significant figure and the raw solver output is deliberately not
exported. Separately, DLE answers "when is your core in heat debt", not "when will I feel cold";
a field validation study found its skin-temperature criteria "were not met at −14 and −22 °C".
**Treat DLE as an index, not a prediction.**

**Pad-stacking additivity is asserted everywhere and measured nowhere.** ASTM F3340 says nothing
about stacking. Therm-a-Rest, NEMO and the standard's own authors all assert R-values add, with
one qualifier ("provided there is no air gap between them"), and STANDARDS §4.6 found **no
published measurement anywhere** of a stacked pair against the sum of its parts. The engine
implements additivity and attaches the caveat to the result. The circulating "5–15 % stacking
penalty" traces only to AI-generated SEO content and is not used.

**The extremity model is a heuristic.** See above. It is a flag worth acting on, not a number.

**The ensemble rule is extrapolated.** ISO 9920 Eq. (11) was tested to 1.6 clo; winter layering
is 3–5 clo. One independent study supports it to 3.33 clo. Above that the engine warns and keeps
going.

**No published angular factors exist for a supine person.** ISO 7726, VDI 3787 Part 2, SOLWEIG,
RayMan, PALM and the Kántor & Unger review all stop at standing / seated / sphere. `F_sky = 0.5`
is a first-principles half-space result that happens to coincide with the standing factors in
open terrain; under partial obstruction a lying person loses more sky than this model charges
them for.

**The cloud correction is unresolved in the literature.** At full overcast, Martin–Berdahl and
Crawford–Duchon remove 80–85 % of the clear-sky radiant penalty; EnergyPlus removes about 15 %.
Both are published and mainstream. The engine defaults to the stronger form, because three
independent measurement datasets sit with it, and exposes the other two.

**The "too warm" end is soft.** v1 does not model sweating at all; the warm limit is set by a
chosen insulation headroom (1.0 clo), not by an evaporative balance.

---

## Unverified constants

Everything the engine ships that is **not** traceable to a standard or a paper is registered in
`UNVERIFIED_CONSTANTS`, with a note on each, and is overridable through the model's parameter
objects. The ones that move a shipped number most:

| Constant | Value | Why it matters |
|---|---|---|
| `sleep.underBodyAreaFraction` | 0.35 | **The single most influential estimate in the engine.** No published supine area split exists. It sets how harshly an under-spec pad is penalised: 0.25 roughly halves the penalty, 0.45 roughly doubles it. The *direction* (a thin pad costs you a lot) is not in doubt; the magnitude is ours. |
| `ireq.walkingSpeedFloor` | 0.5 m/s | STANDARDS §1.7 gives `v_w = 0.0052(M−58)` capped at 1.2 with no floor; §1.10 reports Table F.1 was run with a 0.5 m/s floor. We ship the floor because it is what reproduces the table. Affects DLE and the back-calculated `I_cl`, not IREQ. |
| `sleep.crushedBagRsi` | 0.02 m²K/W | The reference doc says the crushed underside "counts ~0"; this is "nearly zero". |
| `sleep.inBagClothingEfficiency` | over 0.75 / under 0.25 | The reference doc assumes clothing worn in a bag adds its full clo; we discount for compression. |
| `sleep.noDraftCollarPenaltyRsi` | 0.06 m²K/W | The ISO test cinches the bag fully closed. |
| `sleep.ventedOverPathFraction` | 0.5 | Stands in for ISO 23537's `T_max` (from the separate `R_c(2)` test), which 2022 demoted to informative Annex F and which was never obtained. Warm end of the sleep interval only. |
| `sleep.quiltLabelCorrection` | +3 °F cottage, +10 °F direct-import | **Field folklore from `SPEC.md` §2.5, not physics.** Applied only when `quiltProvenance` is set deliberately; otherwise the engine warns rather than guessing. |
| `sleep.bagDrapeEfficiency` | 0.32 | Calibrated to the reference doc's single "+2.5 clo draped" data point. |
| `sleep.headAreaFraction` | 0.07 | Anatomical segment share, used only to split the head out when no hood is used. |
| `environment.projectedAreaFraction` | 0.25 | Turns forecast shortwave into a radiant gain. Replaces `SPEC.md` §2.2's flat "+5 K daytime clear" with something that scales, but the number is a judgement call. |
| `environment.shelter.*` sky-view factors and wind factors | see `SHELTERS` | Tarp and three-sided shelter values are estimated. The tent and forest *radiative* figures come from measurements; the wind fractions do not. |
| `environment.tentFabricSubAmbient` | 0 K | STANDARDS §6.10 calls quantified tent-fly surface depression "the single biggest empirical gap for this product" and estimates 2–5 K without measurement. We ship 0 K rather than invent a depression. |
| `extremities.*` (9 entries) | - | Every input to the extremity heuristic. |
| `garments.adjustability.*` (9 entries) | 0 – 0.6 | How much of a garment you can shed without taking it off, per class, plus the draped-quilt case. ISO 9920 tabulates garments worn open vs closed in Annex A, never obtained (STANDARDS §7.2 item 10); §8.1 confirms only that "the types and number of openings" matter. The ordering is physical, the magnitudes are ours. **Sets how far every comfort interval extends upward in temperature; never moves a cold limit.** |
| `environment.campfire.heatReleaseRateKw` | 10 kW | 🔴 **The weakest link in the campfire chain.** CAMPFIRE.md §10 item 1: no published HRR measurement of an actual campfire exists; 10 kW is inferred by inverting a flame-height correlation whose own source says it does not apply to fuels with substantial in-depth combustion, i.e. not wood. Range 7–16 kW, driven mostly by a fuel-bed diameter the user never tells us. Moves the fire's benefit roughly in proportion. |
| `environment.campfire.fireAbsorptivity` | 0.84 | `α_fire` in `f = (α_fire/ε)·(A_p/A_D)`. CAMPFIRE.md §5.3 derives it from a measured spectral split; ±0.05 is ±6 % on the fire's benefit. Notably **not** 0.95: a flame radiates partly in the near-IR. |
| `environment.campfire.deltaOperativeAtDesignDistanceK` | 2 K | The design-case *result*, registered so the number itself is auditable: `Δt_o ≈ 2.0 K` (`Δt̄_r ≈ 3.8 K`) seated at 1.2 m in still air, bracket 1.4–5.3 K. Computed from the irradiance model and the engine's own `h_c`/`h_r`, not carried as a constant. |
| `environment.campfire.extremityAllocation` | 0 | Share of the fire's benefit given to the hands/feet/head verdicts. Labelled `peer-reviewed`, not estimated: Watanabe et al. (2023) measured **no rise at all on the back-facing sensor at any distance**. Will be wrong in the other direction for hands held out to the fire. |
| `ireq.airPermeability.windshirt` | 8 l·m⁻²·s⁻¹ | Interpolated between STANDARDS' anchors; coincides with Table F.1's reference clothing. |
| garment clo values marked `'estimated'` | - | Every technical outdoor garment in the catalogue. ISO 9920 Annex A was never obtained. |

The campfire's **measured** and standard-sourced parameters are deliberately *not* in that
registry: `χ_rad = 0.15` (Yu 2014, free-burning wood cribs), `A_p/A_D = 0.202` and `f_p = 0.290`
(ASHRAE 55 §C4), the 0.75 m `L/D > 2.5` validity criterion, the 4 m no-effect distance and the
23 K asymmetry limit all have sources, and listing them as guesses would be as dishonest as
hiding the two above. They are documented on `CAMPFIRE` in `environment.ts` with their citations.

Two further judgement calls live in `assess.ts` rather than the registry because they are
presentation rather than physics: `TOO_WARM_HEADROOM_CLO` (1.0 clo, `SPEC.md` §2.1 suggests
0.5, which combined with the reference doc's ±0.3 clo marginal band would leave almost no "fine"
window) and `SLEEP_RADIANT_COUPLING` (0.6: how much of the mean-radiant offset a person inside
a sleeping bag actually feels; ISO 23537's chamber has `t_r = t_a`, so a rating temperature is
an air temperature, and nothing measures the outdoor coupling).

---

## Tests

```
308 tests across 11 suites
```

The acceptance tests that matter:

| Test | Result |
|---|---|
| **ISO 11079 Table F.1**, all 8 reference rows (STANDARDS §1.10) | ✅ IREQ within 0.087 clo (tolerance 0.11), back-calculated `I_cl` within 0.107 clo (0.11), DLE within 0.19 h (0.21) |
| **ISO 23537 Table 1, all 72 cells**, < 0.1 K | ✅ worst cell 0.081 K |
| ISO 23537 Table 1 vs the accredited SGS lab measurement at `R_c` = 1.195 | ✅ −31.25 / −11.53 / −4.85 °C |
| **US "20 °F" bag → `R_c` ≈ 1.061 m²K/W → `T_comf` ≈ −0.7 °C ≈ 31 °F** | ✅ 1.0611 m²K/W, −0.691 °C, 30.8 °F |
| **Smokies vectors** from `REFERENCE_warmth_check.md`: verdicts, not clo numbers | ✅ see below |
| Property: more insulation never raises the required temperature | ✅ |
| Property: monotone in wind, in `M`, in sky exposure, in pad R, in `R_c` | ✅ |
| Property: converges across −40…+30 °C × 0–20 m/s × 0.8–5 MET, or throws, never NaN | ✅ 2 240 of 2 880 points converge; the 640 refusals are exactly the two validity limits (`M < 58 W/m²` and `v_ar > 18 m/s`) |
| Guard: IREQ at sleeping metabolic rates fails rather than returning a number | ✅ throws, with a message pointing at the sleep model |
| **docs/CAMPFIRE.md §8.2's whole distance × wind table**, 0.75–3.0 m × still/2 m/s | ✅ `E`, `Δt̄_r` and `Δt_o` all reproduced from the point-source model |
| Campfire: `h_r` cancels out of `Δt_o` exactly (CAMPFIRE.md §6.3) | ✅ and `Δt̄_r`, the diagnostic, does move with `h_r`, as it should |
| **Goldilocks regression**: two configurations one layer apart produce no interior gap | ✅ and with the same garments modelled as binary, the gap reappears |
| A genuinely unbridgeable interior gap *is* still reported | ✅ `'nothing_between'`, with its own wording and an intermediate-layer fix |
| Venting moves the warm limit and never the cold limit | ✅ cold limit and `marginK` identical to 9 decimal places |
| The ladder is nested, and every surviving rung uniquely covers something | ✅ across three phases, including the superset and clo-monotonicity checks |
| The fire raises operative temperature, never `M`, and extremity verdicts are unchanged by it | ✅ at 45/35/25/15/5 °F, verdict, `requiredClo` and `localFlux` all identical |
| No caveat or warning is ever repeated, per phase or across the report | ✅ and the per-candidate numbers that used to vary the text live on the candidate instead |
| **Liner gloves still stack under mitts** now that hands has one slot | ✅ 0.30 clo, not 0.25, and both pairs are on the warmest rung in layering order |
| **No em dash** in any string the package can hand a user | ✅ `prose.test.ts`, over six whole reports, the catalogue, the constants ledger, every export and the error messages |
| No model vocabulary in a headline or a fix, and a standard named in the caveats | ✅ same file, same six reports |

### Where the rigorous model disagrees with the reference document

The reference document's **verdicts** are regression targets; its **clo numbers for bags** are
not, because `MODEL.md` §2 shows they were back-derived from the same naive
`clo_required = (33 − t_a)/(0.155·M)` formula they would be testing. Where the two disagree, the
test asserts the verdict and the comment records both numbers.

| Vector | Reference | This engine | Verdict |
|---|---|---|---|
| Hiking, 30 °F, 3.0 met | needs 1.3 clo, has 1.8 → **fine** | needs **1.15** clo, has 1.68 → **fine** | ✅ agree |
| Lunch stop, 35 °F, 1.3 met | needs 2.7 clo → **cold** | needs **3.09** clo → **cold** | ✅ agree |
| Camp evening, 25 °F, 1.1 met | needs 3.7 clo → **cold** | needs **4.46** clo → **cold** | ✅ agree |
| Camp evening + bag draped | 4.3 clo vs 3.7 → **fine** (+0.6) | 4.16 clo vs 4.46 → **marginal** (−0.30) | ⚠️ **disagree** |
| 20 °F bag's true comfort rating | "31–32 °F" | **30.8 °F** | ✅ agree, from the standard's table |

The one disagreement is instructive and is the thesis of the whole project in miniature: the
bag's contribution agrees to 0.02 clo (2.48 vs 2.50), and the entire gap is in the
**requirement**: 4.46 clo against the naive formula's 3.72. The difference is the respiratory
and evaporative terms the naive formula deletes, which at 1.1 met are worth about 0.7 clo. So
sitting in your bag in camp *is* the fix, and it is **not quite enough**.

The same mechanism, run at sleeping metabolic rate, is why the naive heuristic understates the
sleeping insulation requirement by a near-constant **×1.48** (STANDARDS §3.8).

### Discrepancies found in `docs/STANDARDS.md`

Two, both recorded in the tests rather than papered over:

1. **§1.10's Table F.1 row 4** prints `v_ar = 0*` with a footnote reading "row 4 has t_r = 0
   with t_a = −10". Taking `v_ar = 0` literally reproduces none of that row's three outputs
   (`I_cl` misses by 0.45 clo, far outside the stated ±0.11). Reading the `0` as the `t_r` value
   that leaked into the velocity column (i.e. `v_ar = 2` like every other row) reproduces all
   three inside tolerance. The engine reads it that way and says so.
2. **§1.7's worked bracket values are inconsistent with §1.7's own equation.** The section states
   `corr = 0.54 e^(−0.15 v_ar − 0.22 v_w) a_p^0.075 − 0.06 ln a_p + 0.5` and then gives worked
   values at `v_ar = 2`, `v_w = 0` of 0.90 / 0.64 / 0.33 for `a_p` = 1 / 50 / 500, concluding
   "a factor ~2.7 spread: air permeability is a first-order parameter in cold wind". Only the
   first reproduces: the equation gives **0.90 / 0.80 / 0.77**, a 1.2× spread at that wind speed
   (widening to ~1.4× at 5 m/s). The engine ships the equation: its coefficients are the ones
   STANDARDS marks `verified` across two independent sources, and it is what reproduces
   Table F.1: and does **not** ship the "first-order" narrative that follows from the worked
   values. A windproof shell helps; it helps less than §1.7's prose implies.

---

## Licence

MIT. See [`../../LICENSE`](../../LICENSE).
