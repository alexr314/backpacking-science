# Model notes: where the reference model and a full balance part company

> ⚠️ **§§2 and 5 are SUPERSEDED by §6** (written before `docs/STANDARDS.md` landed).
> They used Fanger's respiratory terms and a hard-coded `h_r = 4.7`, both wrong in this domain,
> and §5's posture hypothesis has the sign backwards. Kept for the audit trail, not for use.

Status: derivation + numerics done (2026-11-13). Constants marked **[V]** are pending
verification against the standards (see `docs/STANDARDS.md`).

## 1. The reference formula is a full balance with two terms deleted

`REFERENCE_warmth_check.md` uses

    clo_req = (33 − T_a) / (0.155 · M)

This is the steady-state balance under three assumptions, each of which is wrong in a
knowable direction:

1. **All metabolic heat leaves as dry heat through the insulation.** It does not.
   Respiratory convection and evaporation plus insensible skin diffusion carry
   `C_res + E_res + E_sk ≈ 18–24 %` of `M` in cold dry air, and that fraction is
   roughly **proportional to M** (both respiratory terms carry an explicit factor of M),
   so it acts as a near-constant derate `M → 0.81 M`. This *raises* required insulation.
2. **The insulation in question is the garment insulation.** It is not: the formula solves
   for total skin→air resistance `I_T`, which includes the boundary air layer
   `I_a = 1/(h_c + h_r)` ≈ 0.11 m²K/W ≈ 0.7 clo in still air. The garment requirement is
   `I_cl = I_T − I_a/f_cl`, i.e. ~0.5–0.6 clo **less**. This *lowers* required insulation.
3. **T_sk = 33 °C at every activity level.** Skin temperature falls with metabolic rate
   (Fanger: `t_sk = 35.7 − 0.0275·M` **[V]**; ISO 11079 IREQ_min uses a steeper slope).

Corrections (1) and (2) pull in opposite directions and scale differently: (1) is
multiplicative in M, (2) is an additive constant in clo. They cancel near M ≈ 76 W/m²
(1.3 MET: the lunch stop) and diverge in both directions away from it.

## 2. Numbers (Smokies vectors, still air, no sky-radiation term, RH 75 %)

| Phase | °F | M (W/m²) | naive clo | full `I_T` | full `I_cl` | Δ vs naive | losses |
|---|---|---|---|---|---|---|---|
| Hiking | 30 | 175 | 1.26 | 1.55 | **0.71** | **−0.55** | 24 % |
| Lunch stop | 35 | 76 | 2.67 | 3.36 | **2.72** | **+0.05** | 19 % |
| Camp evening | 25 | 64 | 3.72 | 4.69 | **4.15** | **+0.43** | 19 % |
| Asleep | 20 | 47 | 5.50 | 6.95 | **6.52** | **+1.02** | 18 % |

So the reference model is **pessimistic while moving** (by ~0.55 clo: it tells you to
carry a layer you will immediately shed) and **optimistic while still**, by ~1 clo at the
sleep vector. One clo at 0.8 MET is ≈ 0.155 × 47 × 1.0 ≈ **7 K ≈ 13 °F** of bag rating.

The sleep gap is **not** an artefact of the skin-temperature convention: it survives all
three criteria:

| criterion | t_sk | required `I_cl` |
|---|---|---|
| Fanger / ISO neutral | 34.4 °C | 6.52 clo |
| flat 33 °C (reference doc) | 33.0 °C | 6.26 clo |
| ISO 11079 IREQ_min | 31.7 °C | 6.07 clo |

It is the respiratory terms. At 20 °F and 0.8 MET, `E_res` alone is 4.5 W/m² ≈ 10 % of M,
because you are humidifying bone-dry air to saturation at 34 °C, eight hours a night.

### Consequence: the bag clo table is circular
`REFERENCE_warmth_check.md` lists "20 °F bag = 5.5 clo", which was *back-derived from the
naive formula*. It therefore cannot test the model: it only reproduces it. The anchor has
to be ISO 23537 manikin `I_tot`, which is an independent measurement. **Open question for
`docs/STANDARDS.md`: what does a −7 °C-comfort bag actually measure?**

Two outcomes, both fine, but they mean different things:
- If a 20 °F bag measures ≈ 6.5 clo → the whole table shifts up together, real-world
  verdicts are unchanged, and the reference numbers survive as *verdict* regressions.
- If it measures ≈ 5.5 clo → ISO 23537's own rating model is more permissive than a
  full IREQ balance, and the tool will tell users their bags are rated ~1 clo optimistic.
  Defensible (it matches the folk wisdom that ratings run cold-optimistic) but it is a
  product-voice decision, not a physics one.

## 3. Wind and radiation, sized

- **Wind, hiking at 30 °F:** still air needs 0.71 clo; at 5 m/s, `I_a` collapses from
  0.71 clo to 0.20 clo and the requirement rises to **1.39 clo**: i.e. wind nearly doubles
  the garment requirement at hiking intensity, *before* the ISO 9920 pumping correction.
  Pumping is modelled separately and a windproof shell zeroes it.
- **Clear-sky radiation, camp evening at 25 °F:** a 15 K sky depression drops operative
  temperature to −14.3 °C (6.3 °F) and raises the requirement from 4.15 to **5.44 clo**.
  Sitting in the open under a clear sky costs ~1.3 clo versus sitting under canopy. This is
  the single largest correction in the model and it is invisible on a thermometer.

## 4. DLE is a safety metric, not a comfort metric

ISO 11079 gives duration-limited exposure `DLE = Q_lim / |S|` with `Q_lim ≈ 40 Wh/m²` **[V]**.
Applied to the reference doc's worked example (Andy, 1.8 clo, 35 °F lunch stop, still air):
`S = −22.5 W/m²` → **DLE ≈ 107 min**.

The reference doc says "cold within ~15 min", and the doc is right about the *sensation*.
DLE answers "when is your core in debt", not "when do you notice". Felt discomfort at a
lunch stop is skin and extremity cooling with a time constant of minutes, driven by
vasoconstriction, not by whole-body heat storage. So:

- ship the steady-state comfort margin as the primary verdict,
- ship DLE as a **separate safety line**, surfaced only when it is short,
- do **not** market DLE as "minutes until you feel cold": that needs a transient skin
  model we are not building in v1. Say so in the caveats.

## 5. Candidate mechanisms for an IREQ-vs-ISO-23537 gap (if it is real)

All at 20 °F, 0.8 MET, t_sk = 33 °C. Baseline here uses `I_a = 0.11` fixed and `w = 0.047`,
so it reads 6.37 clo rather than §2's 6.52: the mechanism *deltas* are what matter.

| mechanism | `I_T` | `I_cl` |
|---|---|---|
| baseline: ambient breathing, upright geometry | 6.70 | 6.37 |
| (a) breathing bag air (10 °C, 90 % RH) not ambient | 6.41 | 6.08 |
| (b) recumbent effective-area factor `a = 0.85` | 5.72 | 5.37 |
| (a) + (b) | 5.48 | 5.12 |
| (c) M raised to 1.0 MET | 5.36 | 4.99 |

Single-parameter values that reproduce `I_cl = 5.50`: `a = 0.869`, or `M = 53.3 W/m² (0.92 MET)`.

**(b) is a geometry error in our model, not a calibration.** The balance as written uses
standing-manikin geometry: `f_cl` and the `h_c`/`h_r` pair describe an upright body radiating
to a near-hemisphere. A sleeper is curled, with a large fraction of surface in self-contact or
pressed into the pad, seeing neither the sky nor moving air. ISO 23537 measures on a **lying**
manikin on a reference mat, so the standard has this geometry built in and we do not. The fix
is a recumbent effective-area factor applied **only** to the sleep phase, so it cannot
contaminate the clothed phases.

**(a) is small (~0.3 clo) but physically interesting** and belongs in the video: a cinched hood
moves respiratory loss from "heat leaving the system" to "heat and vapour deposited *inside*
the insulation". You recover some of it: and the latent half condenses in the down, which is
why bags wet out from the inside on multi-night trips.

**(c) is a fudge and we should refuse it.** Sleeping metabolic rate really is ≈ 0.8 MET
(BMR ≈ 44 W/m² for a 70 kg adult, sleep ≈ 0.95 × BMR). Moving M to 0.92 MET to close the gap
would be fitting, not modelling.

**(d) the two-floor structure may close part of it on its own.** ISO 23537's single number is
area-weighted over a body losing heat upward through the bag *and* downward through a crushed
bag bottom into a reference mat (R ≈ 4.8). Our §2 balance is single-node. The over/under split
the spec already requires is a different (and more correct) area weighting, and must be built
before any gap is declared real.

**Order of work:** build (d) and (b) from first principles, *then* compare to ISO 23537. The
comparison is a test, not a fit. If `a` falls out of recumbent geometry near 0.87 on its own,
the model is vindicated; if we have to reach for 0.70, something else is wrong.

---

## 6. Corrections after `docs/STANDARDS.md` (supersedes §§2, 5)

Four of my inputs were wrong. Three change shipped numbers.

**(i) Respiratory terms.** I used Fanger's `C_res = 0.0014·M·(34 − t_a)` and
`E_res = 0.0173·M·(5.87 − p_a)`. Those are ISO 7730, valid in moderate environments. **ISO 11079
uses temperature-dependent expired air**: `t_ex = 29 + 0.2·t_a`, `p_ex = p_s(t_ex)`. The
coefficients are right; the second bracket term is not. At −20 °C the Fanger `E_res` is ~85 % too
large. My §2 losses (18–24 % of M) are therefore overstated.

**(ii) `h_r = 4.7` is not what the linearisation yields.** It gives 3.80–3.96 at 20 °C and **2.5 at
−20 °C**. 4.7 is a separate conventional constant for indoor use. Hard-coding it overestimates
radiant loss by ~75 % in our domain: which means my §3 clear-sky number (1.3 clo) is too big.
`h_r` must be computed from `t_cl` and `t_r`, inside the iteration.

**(iii) `h_c = 8.3·v^0.6` is Mitchell (1974) via ASHRAE, not ISO**, and its bounds are 0.2–4 m/s,
not the 0.1–1 in SPEC §2.1. ISO 7933/9920 use **8.7·v^0.6**, meeting `3.5 + 5.2·v` exactly at
v = 1 m/s (both = 8.7). Use the ISO pair and the real crossover.

**(iv) IREQ is invalid for sleep.** ISO 11079's validity floors are `M ≥ 58 W/m²` and
`v_ar ≥ 0.4 m/s`. Sleeping is ~45 W/m² at ~0.05 m/s: outside the standard on both axes. So the
engine needs **two models, not one**: ISO 11079 IREQ for the four clothed phases, **ISO 23537
Annex C** for sleep. This is a cleaner split than forcing one balance to cover both.

### §5 was backwards: posture is a *penalty*, not a relief

I hypothesised a recumbent effective-area factor `a ≈ 0.87` *reducing* the sleeping requirement,
reasoning from a curled sleeper with surface in self-contact. ISO 23537 measures on a **supine**
manikin (never curled) and its Annex C applies `R_c,eff = 0.9·R_c` for the comfort criterion,
i.e. a **relaxed-posture penalty of ×1.11 on the requirement**. The sign is opposite to my guess.
A relaxed sleeper opens the bag's loft and defeats its own trapped air; they do not benefit from
curling, because the rated geometry never assumed curling in the first place.

So the naive heuristic understates the sleeping requirement by a **near-constant ×1.48**
(5.44 → 8.10 clo at 20 °F), decomposing as:

| cause | factor |
|---|---|
| omitted respiratory + evaporative loss (≈22 % of M) | 1.26 |
| omitted 0.9·R_c relaxed-posture penalty | 1.11 |
| M = 47 rather than the standard woman's 44.4 W/m² | 1.06 |
| **product** | **1.48** |

My §2 full balance got the direction right and the magnitude short (I had ×1.19), because I had
both (i) inflating and the posture term missing entirely.

### The structural finding: `R_c(1)` is the whole system, not the bag

ISO 23537-1:2022 cl. 3.6 Note 2, the rated insulation "includes … air volume in the cavity …
boundary air layer … **mattress underneath the sleeping bag and garments worn by the user**."

So **SPEC §2.5's "two independent floors" is wrong as written.** A bag's ISO rating is already a
whole-body *parallel* combination of the over-path and the under-path, with a reference mat of
`R_ct = 0.85 m²K/W` ≈ **US R-value 4.83** and a base layer (`R_ct` 0.040–0.060) baked in. Adding a
pad's R on top of a bag's rating double-counts.

The correct model is the **delta**: compute the two parallel paths explicitly, calibrate the
over-path by back-solving Annex C against the bag's label with the reference mat in place, then
re-solve with the user's actual pad. Most backpackers carry less than R 4.83, so for most users
**the label is optimistic before the bag is even unpacked**: and this quantifies by how much,
which is a better version of SPEC §2.5's intent.

### Headline for the video, now rigorous

US brands label by **Limit**; EU brands by **Comfort**. A US "20 °F bag" means `T_lim = −6.7 °C`
→ `R_c = 1.061 m²K/W` → `T_comf = −0.7 °C ≈ **31 °F**`. The bag is eleven degrees warmer than its
label before you account for an under-spec pad. This independently reproduces the claim in
`REFERENCE_warmth_check.md` ("its comfort rating is 31–32 °F") from the standard's own normative
table: so that reference line survives as a regression vector.

### Open issue that affects a shipped number

ISO 11079 gives `f_cl = 1.97` in its body text but **`1.197` in its own normative Annex F
program**. IREQ is insensitive to this; **DLE is not** (differences up to 5 h), and DLE is a
user-facing output. Ship DLE behind the Annex F value (1.197, what three independent ports use),
state the ambiguity in the caveats, and do not present DLE to more than one significant figure.

---

## 7. Open modelling question: directional venting at a campfire (Alex, 2026-11-13)

Parked deliberately: Alex intends to think about it and report observations from the Smokies
trip (Nov 22–24 2026). Recorded here so the insight isn't lost, **not** scheduled.

The observation: sitting by a fire, you might wear a jacket **open at the front and closed
across the back**. Two things are true at once, and our model currently represents neither:

1. Opening the front **lowers your insulation**: and absent the fire that is strictly a loss.
   This is the §1 adjustability term, but applied to *part* of the body rather than all of it.
2. Your back is **at its original comfort value**, because no excess radiant flux reaches it
   anyway. So the insulation you gave up at the front is insulation you were not using against
   the fire side, while the back keeps everything it had.

So opening a jacket at a fire is not "venting" in the whole-body sense we implemented. It is a
**deliberate exploitation of the radiant asymmetry**: shed insulation exactly where the external
heat source is replacing it, and keep it everywhere else. That is why it feels good rather than
feeling like a compromise, and it is probably why people do it without thinking.

**Why we can't model it yet.** Both halves of the machinery are whole-body:
- adjustability sheds a fraction of a garment's clo uniformly, with no front/back split;
- the fire raises a single whole-body operative temperature, with the extremity budgets simply
  excluded (`docs/CAMPFIRE.md` §7.4).

Representing this properly needs a **two-node body**: a fire-facing aspect and a shaded one,
each with its own insulation and its own operative temperature: which is a substantially
bigger change than either piece alone and would also want an orientation input the engine
doesn't have (`docs/CAMPFIRE.md` §10 item 7 flags the same gap from the radiation side).

**What it would buy.** Possibly a real result rather than a refinement: it would predict that
the comfortable range beside a fire is *wider* than the whole-body model says, because you can
trade front insulation against radiant gain continuously. Our current treatment can only say
"+2.0 K and your hands get nothing", which understates what sitting by a fire actually does for
you: while the whole-body-average treatment we rejected would have overstated it.

**Related:** the `0` extremity allocation (`docs/CAMPFIRE.md` §9.2) and §1's adjustability model
are the two pieces this would unify. Asymmetry is explicitly **not** surfaced as a warning , 
it is a normal, pleasant state, not a fault condition.
