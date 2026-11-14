# Constants and Equations Reference

Verified source reference for the thermal-physiology models used by this library.

**Rules of this document.** Every equation below is traceable to a source that was actually
fetched during research. Nothing is written from memory. Each entry carries:

- the equation in LaTeX (KaTeX-compatible),
- every symbol defined with SI units,
- validity range as stated by the source,
- **Source**: URL + source kind,
- **Confidence**: `verified` (two independent sources agree) / `single-source` /
  `UNVERIFIED: do not ship`.

Markers used throughout: ✅ a prior assumption confirmed · ⚠️ a caveat or a correction ·
🔴 something that will produce a wrong answer if ignored · ⭐ the recommended choice ·
ℹ️ context. **Section 7 lists everything that could not be pinned down**: read it before
trusting anything marked `single-source` or `UNVERIFIED`.

Calculations described as "computed here" / "derived here" were performed during this research
from inputs already verified above; they are reproducible, not quoted from a source.

### Contents

| § | Standard | Status of the core result |
|---|---|---|
| **1** | **ISO 11079:2007**, IREQ, DLE, recovery time | Equations (1)–(9) from the standard's own text; Annex A/B/F constants from 1 paper + 3 independent code ports |
| **2** | **ISO 9920:2007**, garment & ensemble insulation | **Full normative body text obtained** (Eqs. 1–33) |
| **3** | **ISO 23537-1**: sleeping bag ratings | Table 1 obtained verbatim; Annex C model reconstructed and validated to <0.08 K |
| **4** | **ASTM F3340-22**: sleeping pad R-value | Scope/terminology/apparatus from the publisher preview; conditions from the accredited lab |
| **5** | **ISO 7730 / ISO 7933**: $h_c$, $h_r$ | ISO 7730 Eq. (3) verbatim; the $8.3v^{0.6}$ lineage traced to Mitchell (1974) |
| **6** | **Operative temperature & night-sky cooling** | ASHRAE 55-2023 Appendix A verbatim; sky models cross-checked across 4 papers |
| **7** | **Open questions / could not verify** | 27 numbered items |

**Three results that matter most for this library**

1. **IREQ is invalid for a sleeping person** (§1.9): both its metabolic-rate floor and its air-velocity
   floor are violated. Use ISO 23537 for sleep, IREQ for the awake case.
2. **A clear night costs ~5–6 K of operative temperature** versus the forecast air temperature for
   someone lying in the open, and that penalty largely vanishes under cloud or canopy (§6.8).
3. **The project's current `clo_required` heuristic understates the sleeping requirement by ≈1.48×**
   (§3.8), dominated by the omitted respiratory and evaporative terms.

**Universal constants used throughout**

| Symbol | Value | Units | Note |
|---|---|---|---|
| $1\,\mathrm{clo}$ | $0.155$ | $\mathrm{m^2\,K\,W^{-1}}$ | ISO 11079 §5.4 / ISO 9920 |
| $1\,\mathrm{met}$ | $58.15$ | $\mathrm{W\,m^{-2}}$ | `pythermalcomfort` `met_to_w_m2`; ISO 8996 uses 58.15 |
| $\sigma$ | $5.67\times10^{-8}$ | $\mathrm{W\,m^{-2}\,K^{-4}}$ | Stefan–Boltzmann |
| $L$ (Lewis relation) | $16.5$ | $\mathrm{K\,kPa^{-1}}$ | ISO 9920 §7.3; used as $1/L \approx 0.06$ |

---

## 1. ISO 11079:2007, IREQ (Required Clothing Insulation)

**Full title:** *Ergonomics of the thermal environment, Determination and interpretation of
cold stress when using required clothing insulation (IREQ) and local cooling effects.*
First edition 2007-12-15. Supersedes ISO/TR 11079:1993 (a "technical revision").

### Primary sources used for this section

| Tag | What it is | URL |
|---|---|---|
| **[S1]** | **Standard text.** ISO 11079:2007(E) official preview PDF, contains Clauses 1–5.4 verbatim, including the symbols table and Equations (1)–(9). Preview ends mid-page 7; Annexes A–F are **not** in the preview. | https://cdn.standards.iteh.ai/samples/38900/92fb892385a24045a2decbbf2ba0d6c7/ISO-11079-2007.pdf |
| **[S2]** | **Standard text (predecessor).** ISO/TR 11079:1993(E) official preview PDF, contains Clauses 1–7.1 verbatim including Equations (1)–(14), the DLE/RT definitions and the full symbols table. | https://cdn.standards.iteh.ai/samples/19067/f752810ce2fa4d19bdeaafdcc3f6d743/ISO-TR-11079-1993.pdf |
| **[S3]** | **Peer-reviewed paper.** d'Ambrosio Alfano F.R., Kuklane K., Palella B.I., Riccio G., *On the Effects of Clothing Area Factor and Vapour Resistance on the Evaluation of Cold Environments via IREQ Model*, Int. J. Environ. Res. Public Health **22**(8):1188, 2025-07-29. Reproduces the ISO 11079 model equations numbered 1–34 and discusses the standard's internal inconsistencies. (Citation verified via Crossref API.) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12385740/ · DOI https://doi.org/10.3390/ijerph22081188 |
| **[S4]** | **Library source.** `pythermalcomfort` v4.4+ `pythermalcomfort/models/ireq.py`: a direct transcription of the **ISO 11079 Annex F** reference program, validated by its test suite against **ISO 11079 Table F.1**. | https://github.com/pythermalcomfort/pythermalcomfort (file `pythermalcomfort/models/ireq.py`) |

> **Note on [S4]:** this is the strongest practical source available without buying the
> standard, because it is a line-by-line port of the standard's own normative Annex F
> program, and its test file (`tests/test_ireq.py::test_ireq_iso_11079_table_f1`) asserts
> agreement with the standard's own published worked examples. It was run locally during
> this research and reproduces those values.

### 1.1 Steady-state heat balance

$$M - W = E_{res} + C_{res} + E + K + R + C + S$$

Quoted verbatim from ISO 11079:2007 Equation (1) [S1] (the preview PDF has an OCR slip
rendering the first two right-hand terms as `E + C`; ISO/TR 11079:1993 Eq. (1) [S2] and
[S3] Eq. (1) both give `E_res + C_res`).

| Symbol | Meaning | Units |
|---|---|---|
| $M$ | metabolic rate | $\mathrm{W\,m^{-2}}$ |
| $W$ | effective mechanical power | $\mathrm{W\,m^{-2}}$ |
| $E_{res}$ | respiratory evaporative heat flow | $\mathrm{W\,m^{-2}}$ |
| $C_{res}$ | respiratory convective heat flow | $\mathrm{W\,m^{-2}}$ |
| $E$ | evaporative heat flow at the skin | $\mathrm{W\,m^{-2}}$ |
| $K$ | conductive heat flow | $\mathrm{W\,m^{-2}}$ |
| $R$ | radiative heat flow | $\mathrm{W\,m^{-2}}$ |
| $C$ | convective heat flow | $\mathrm{W\,m^{-2}}$ |
| $S$ | body heat storage rate | $\mathrm{W\,m^{-2}}$ |

**Sign convention (confirmed in the standard's own words, [S1] §5.3.1):** the left-hand side
"represents the internal heat production, which is balanced by the right-hand side which
represents the sum of heat exchanges in the respiratory tract, heat exchanges on the skin
and the heat storage accumulating in the body." So **all right-hand terms are heat
*losses* from the body when positive**, and $S>0$ means heat is being stored (body warming);
$S<0$ means heat debt is accumulating (body cooling).

**Is $S=0$?** Yes: *for the IREQ calculation only.* [S1] §5.4 states IREQ is calculated "on
the basis of Equations (1) to (7), **in steady state**". $K$ is dropped as well: §5.3.6 says
conductive exchange "is mostly small and can be accounted for by the expressions for
convective and radiation heat exchange." Reducing Eq. (1) with $K=0,\ S=0$:

$$R + C = M - W - E_{res} - C_{res} - E$$

([S3] Eq. 2.) **$S$ is explicitly *not* zero in the DLE calculation**: see §1.8.

- **Confidence:** `verified` ([S1] + [S2] + [S3]).

### 1.2 The IREQ equation and its iteration

$$\mathrm{IREQ} = \frac{\overline{t}_{sk} - t_{cl}}{R + C}$$

Verbatim, ISO 11079:2007 Equation (8) [S1]. The user's remembered form is **correct**.

| Symbol | Meaning | Units |
|---|---|---|
| $\mathrm{IREQ}$ | required **resultant** clothing insulation | $\mathrm{m^2\,K\,W^{-1}}$ |
| $\overline{t}_{sk}$ | mean skin temperature | $^\circ\mathrm{C}$ |
| $t_{cl}$ | clothing surface temperature | $^\circ\mathrm{C}$ |

The companion relation, ISO 11079:2007 Equation (7) [S1], makes the meaning of $\mathrm{IREQ}$ precise , 
**it is a *resultant* (dynamic, wind- and motion-corrected) insulation, not a basic/static one:**

$$\frac{\overline{t}_{sk} - t_{cl}}{I_{cl,r}} = R + C = M - W - E_{res} - C_{res} - E - S$$

> [S1] §5.4, verbatim: "$I_{cl,r}$ is the value of clothing insulation corrected for the
> effects of wind penetration and activity, taking into account the air permeability of the
> outer garment layer. IREQ is the thermal insulation required for the maintenance of
> thermal equilibrium."

**The iteration.** [S1] §5.4: "Equation (8) contains two unknown variables (IREQ and
$t_{cl}$). Therefore, Equation (8) is solved for $t_{cl}$ as follows":

$$t_{cl} = \overline{t}_{sk} - \mathrm{IREQ}\cdot\left(M - W - E_{res} - C_{res} - E\right) \qquad (9)$$

This $t_{cl}$ is substituted into the expressions for $R$ and $C$, and **IREQ is found by
iteration** until the balance $M - W - E_{res} - C_{res} - E - R - C = 0$ is satisfied.
[S4] implements this as a bisection search on IREQ starting at $0.5\ \mathrm{m^2KW^{-1}}$
with step $0.5$, halving on overshoot, tolerance $|\text{balance}| \le 0.01\ \mathrm{W\,m^{-2}}$,
max 150 iterations.

- **Confidence:** `verified` ([S1] standard text for Eqs. 7–9; [S3] Eq. 6; [S4] implementation).

### 1.3 The two criterion sets: skin temperature and wettedness

This is the heart of the model. **Both of the user's remembered expressions are correct, and
the pairing is correct.**

**IREQ$_\text{neutral}$** (thermal neutrality / low physiological strain):

$$\overline{t}_{sk} = 35.7 - 0.0285\,M \qquad w = 0.001\,M$$

**IREQ$_\text{min}$** (subject accepts body cooling / high physiological strain):

$$\overline{t}_{sk} = 33.34 - 0.0354\,M \qquad w = 0.06$$

| Symbol | Meaning | Units |
|---|---|---|
| $M$ | metabolic rate: **$\mathrm{W\,m^{-2}}$, not met** | $\mathrm{W\,m^{-2}}$ |
| $\overline{t}_{sk}$ | mean skin temperature | $^\circ\mathrm{C}$ |
| $w$ | skin wettedness (fraction of skin that can be considered fully wet) | dimensionless |

**Units of $M$ confirmed.** [S4] converts the user's `met` input to $\mathrm{W\,m^{-2}}$ via
`met * 58.15` *before* evaluating these expressions, and [S1]'s symbols table defines $M$ as
$\mathrm{W\,m^{-2}}$. Sanity check: at rest ($M = 58\ \mathrm{W\,m^{-2}}$),
$\overline{t}_{sk,neutral} = 35.7 - 1.65 = 34.0\ ^\circ\mathrm{C}$ and
$\overline{t}_{sk,min} = 33.34 - 2.05 = 31.3\ ^\circ\mathrm{C}$: physiologically sensible.
Had $M$ been in met, the expressions would be essentially constant, which is clearly not the
intent.

**Interpretation** (ISO/TR 11079:1993 §5.4.2, verbatim [S2]):
> "IREQ$_{min}$ defines a minimal thermal insulation required to maintain body thermal
> equilibrium at a subnormal level of mean body temperature. The minimal IREQ represents the
> highest admissible body cooling in occupational work."
> "IREQ$_{neutral}$ is defined as the thermal insulation required to provide conditions of
> thermal neutrality, i.e. thermal equilibrium maintained at a normal level of mean body
> temperature. This level represents no or minimal cooling of the human body."

And [S2] §5.4.3: "The interval between IREQ$_{min}$ and IREQ$_{neutral}$ can be regarded as a
clothing regulatory zone, in which each individual chooses the appropriate protection level.
With insulation values lower than IREQ$_{min}$ there is a risk of progressive body cooling.
With values higher than IREQ$_{neutral}$ conditions will be considered warm and overheating
can occur."

- **Source:** [S3] (peer-reviewed, table of physiological criteria) and [S4] (library source, lines
  `("min", 33.34 - 0.0354 * met, 0.06)`, `("neutral", 35.7 - 0.0285 * met, 0.001 * met)`).
- **Confidence:** `verified` (two independent sources, exact digit-for-digit agreement).
  Note: these live in ISO 11079 **Annex B**, which is *not* in the public preview, so neither
  source is the standard text itself: but they are independent of each other.

### 1.4 Evaporative heat loss at the skin, $E$

**Answer to the question "does it use $R_{e,T}$, a Lewis-relation form, or a fraction of $M$?":
it uses $R_{e,T}$, and $R_{e,T}$ is itself derived from insulation via the Lewis relation.
It is never a fraction of $M$.** ($M$ enters only through $w$ and $\overline{t}_{sk}$.)

ISO 11079:2007 Equation (4), verbatim [S1]:

$$E = \frac{p_{sk} - p_a}{R_{e,T}}$$

Expanded with skin wettedness (the form actually computed: [S3] Eq. 5, [S4]):

$$E = \frac{w\left(p_{sk,s} - p_a\right)}{R_{e,T,r}}$$

| Symbol | Meaning | Units |
|---|---|---|
| $p_{sk}$ | water vapour pressure at the skin | $\mathrm{kPa}$ |
| $p_{sk,s}$ | **saturated** water vapour pressure at skin temperature | $\mathrm{kPa}$ |
| $p_a$ | ambient water vapour partial pressure | $\mathrm{kPa}$ |
| $R_{e,T}$ | total evaporative resistance of clothing + boundary air layer | $\mathrm{m^2\,kPa\,W^{-1}}$ |
| $R_{e,T,r}$ | the same, *resultant* (wind/motion corrected) | $\mathrm{m^2\,kPa\,W^{-1}}$ |

**$p_a$ is in kPa.** Confirmed directly from ISO 11079:2007's symbols table [S1]:
"$p_a$ water vapour partial pressure, **kPa**"; "$R_{e,T}$ … $\mathrm{m^2\cdot kPa\cdot W^{-1}}$".

**The evaporative resistance used by Annex F** ([S4]):

$$R_{e,T,r} = \frac{1}{i_m L}\left(I_{a,r} + I_{cl,r}\right) \;=\; \frac{0.06}{0.38}\left(I_{a,r} + I_{cl,r}\right)$$

with $i_m = 0.38$ (moisture permeability index, dimensionless) and $1/L = 0.06\ \mathrm{kPa\,K^{-1}}$
(i.e. $L = 16.67\ \mathrm{K\,kPa^{-1}}$; ISO 9920 states $L = 16.5$ and uses $0.06$ as the rounded reciprocal).

> ⚠️ **Discrepancy, unresolved.** [S4] (Annex F port) sums $I_{a,r} + I_{cl,r}$ **without**
> dividing the air layer by $f_{cl}$. [S3] renders the ISO 11079 expression as containing
> $I_{a,r}/f_{cl} + I_{cl,r}$ (consistent with ISO 9920 Eq. 27, §2.5 below). These differ.
> The effect is small for thick clothing but not zero. See §7.

**Saturation vapour pressure** (the Antoine-type form used in [S4], originating in ISO 7933):

$$p_s(t) = 0.1333\,\exp\!\left(18.6686 - \frac{4030.183}{t + 235}\right) \quad [\mathrm{kPa}],\ t\ \mathrm{in}\ ^\circ\mathrm{C}$$

Numerically self-checked during research: $p_s(20) = 2.3369\ \mathrm{kPa}$ (reference value
2.339 kPa), $p_s(0) = 0.6088\ \mathrm{kPa}$ (reference 0.6113 kPa). Good to ~0.4 %.

- **Confidence:** `verified` for the $E$ equation and the kPa units ([S1] standard text + [S3] + [S4]).
  `single-source` for the exact $R_{e,T,r}$ form, because the two sources disagree on the $f_{cl}$ placement.

### 1.5 Respiratory heat losses

> ⚠️ **Correction: the user's remembered forms are the ISO 7730 / Fanger ones, NOT ISO 11079's.**

ISO 11079 defines the respiratory terms with **temperature-dependent expired air**, not with
the fixed constants 34 °C and 5.87 kPa:

$$C_{res} = 0.0014\,M\,\left(t_{ex} - t_a\right)$$
$$E_{res} = 0.0173\,M\,\left(p_{ex} - p_a\right)$$
$$t_{ex} = 29 + 0.2\,t_a$$
$$p_{ex} = p_s\!\left(t_{ex}\right)$$

| Symbol | Meaning | Units |
|---|---|---|
| $t_{ex}$ | expired air temperature | $^\circ\mathrm{C}$ |
| $p_{ex}$ | saturated vapour pressure at $t_{ex}$ | $\mathrm{kPa}$ |
| $t_a$ | air temperature | $^\circ\mathrm{C}$ |
| $p_a$ | ambient water vapour partial pressure | $\mathrm{kPa}$ |
| $M$ | metabolic rate | $\mathrm{W\,m^{-2}}$ |

**The coefficients 0.0014 and 0.0173 are confirmed correct.** It is the *second* factor in each
bracket that the user mis-remembered.

**Why this matters for a cold-weather library:** the difference is large exactly where this
library operates. At $t_a = -20\ ^\circ\mathrm{C}$, ISO 11079 gives
$t_{ex} = 29 + 0.2(-20) = 25\ ^\circ\mathrm{C}$, so $C_{res} = 0.0014\,M\,(25 - (-20)) = 0.063\,M$,
whereas the Fanger form would give $0.0014\,M\,(34-(-20)) = 0.0756\,M$: about **20 % higher**.
Likewise $p_{ex} = p_s(25) = 3.17\ \mathrm{kPa}$, not 5.87 kPa, so the Fanger $E_{res}$ would be
roughly **85 % too large** at that temperature. Use the ISO 11079 forms.

For reference, the forms the user was recalling (ISO 7730 / Fanger, valid in moderate
environments only): $C_{res} = 0.0014\,M\,(34 - t_a)$ and
$E_{res} = 1.72\times10^{-5}\,M\,(5867 - p_a)$ with $p_a$ in **Pa**: equivalently
$0.0172\,M\,(5.867 - p_a)$ with $p_a$ in kPa.

**Note on the standard's own Eqs. (2) and (3).** ISO 11079:2007 §5.3.4 [S1] states the
respiratory terms in *physical* form, $C_{res} = c_p V (t_{ex} - t_a)/A_{Du}$ and
$E_{res} = c_e V (W_{ex} - W_a)/A_{Du}$. The 0.0014 / 0.0173 coefficients are the Annex A
*computational* reductions of these, with ventilation rate $V$ taken proportional to $M$.

- **Source:** [S3] Eqs. A2–A5 (peer-reviewed) + [S4] (`1.4e-03 * met * (expired_air_temperature - tdb)`,
  `1.73e-02 * met * (expired_air_vapor_pressure - ambient_vapor_pressure)`,
  `expired_air_temperature = 29.0 + 0.2 * tdb`). [S1] for the physical forms and the kPa units.
- **Confidence:** `verified` (two independent sources agree digit-for-digit, including $t_{ex}=29+0.2t_a$).

### 1.6 $h_r$, $h_c$, $f_{cl}$ and $I_a$

#### Radiative heat transfer coefficient $h_r$

ISO 11079 Eq. (5) [S1]: $R = f_{cl}\,h_r\,(t_{cl} - t_r)$. The coefficient itself is the standard
linearisation of the Stefan–Boltzmann law:

$$h_r = \varepsilon_{cl}\,\sigma \frac{A_r}{A_{Du}}\cdot\frac{\left(t_{cl}+273\right)^4 - \left(t_r+273\right)^4}{t_{cl} - t_r}$$

with the small-$\Delta t$ limit used when $|t_{cl}-t_r|\to 0$:

$$h_r \to 4\,\varepsilon_{cl}\,\sigma \frac{A_r}{A_{Du}}\left(273 + \tfrac{t_{cl}+t_r}{2}\right)^3$$

| Symbol | Value / meaning | Units |
|---|---|---|
| $\varepsilon_{cl}$ | clothing surface emissivity $= 0.95$ | - |
| $\sigma$ | $5.67\times10^{-8}$ | $\mathrm{W\,m^{-2}\,K^{-4}}$ |
| $A_r/A_{Du}$ | effective radiating area fraction $= \mathbf{0.77}$ (standing) | - |
| $t_r$ | mean radiant temperature | $^\circ\mathrm{C}$ |

> ⚠️ **$A_r/A_{Du} = 0.77$ in ISO 11079**, *not* the 0.70/0.73 familiar from ISO 7730. [S4]
> hard-codes `ar_adu = 0.77`. This is consistent with ISO 9920 §6, which states the fraction
> "is equal to 0,67 for a crouching subject, 0,70 for a seated subject and **0,77 for a
> standing subject**": IREQ assumes a standing/working person.

#### Convective heat transfer coefficient $h_c$: **not what you'd expect**

> ⚠️ **ISO 11079 does not use an explicit $h_c = a\,v^b$ correlation.** It derives $h_c$ by
> *subtraction* from the dynamic boundary-layer insulation:

$$h_c = \frac{1}{I_{a,r}} - h_r$$

This is internally consistent with $I_a = 1/(h_c + h_r)$ (ISO 9920 Eq. 22, §2.5 below). The wind
dependence therefore enters entirely through $I_{a,r}$, below. If you are porting ISO 11079,
**do not substitute an ISO 7730 or ASHRAE $h_c$ here**: you will double-count the wind.

- **Source:** [S4], `convection_coefficient = 1.0 / air_insulation - radiation_coefficient`.
- **Confidence:** `single-source` for the explicit statement (only [S4] shows the code), but
  structurally `verified` because it is forced by $I_a = 1/(h_c+h_r)$, which is ISO 9920 Eq. (22)
  standard text.

#### Boundary layer insulation $I_a$ (static) and $I_{a,r}$ (resultant)

$$I_a = 0.085\ \mathrm{m^2\,K\,W^{-1}}\ \ (= 0.55\ \mathrm{clo})$$

$$I_{a,r} = 0.092\,e^{-0.15\,v_{ar} - 0.22\,v_w} - 0.0045$$

| Symbol | Meaning | Units |
|---|---|---|
| $I_a$ | static boundary-layer insulation used by ISO 11079 | $\mathrm{m^2\,K\,W^{-1}}$ |
| $I_{a,r}$ | resultant (wind + walking corrected) boundary-layer insulation | $\mathrm{m^2\,K\,W^{-1}}$ |
| $v_{ar}$ | relative air velocity | $\mathrm{m\,s^{-1}}$ |
| $v_w$ | walking speed | $\mathrm{m\,s^{-1}}$ |

> ⚠️ **$I_a = 0.085$, not the 0.109 (0.7 clo) of ISO 9920.** This is not an error: the two
> standards use different reference wind speeds. ISO 9920 §6 states its 0.7 clo figure is
> "measured at air velocities around 0,1 m·s⁻¹ to 0,15 m·s⁻¹" and then adds: "For some cold
> weather clothing measurements the reference wind speed is set at **0,4 m·s⁻¹**". ISO 11079's
> validity range starts at $v_{ar} = 0.4\ \mathrm{m\,s^{-1}}$. Consistency check:
> $I_{a,r}(v_{ar}=0.4, v_w=0) = 0.092\,e^{-0.06} - 0.0045 = 0.0821\ \mathrm{m^2KW^{-1}}$: close to 0.085. ✓

- **Source:** [S3] Eq. 9 and the stated $I_a = 0.085\ \mathrm{m^2\,K\,W^{-1}}$; [S4]
  (`air_insulation = 0.092 * math.exp(-0.15 * vr - 0.22 * walk_sp) - 0.0045`, and `0.085` in the
  $I_{cl}$ back-calculation).
- **Confidence:** `verified` (two independent sources, exact agreement).

#### Clothing area factor $f_{cl}$: ⚠️ **the standard contradicts itself**

The user expected $f_{cl} = 1 + 0.3\,I_{cl}[\mathrm{clo}]$. That is **approximately right, and
matches the standard's *body text*, but does not match the standard's own reference program.**

| Form | $I_{cl}$ in $\mathrm{m^2KW^{-1}}$ | equivalent per clo | Where it appears |
|---|---|---|---|
| ISO 11079 **text** | $f_{cl} = 1.00 + 1.97\,I_{cl}$ | $1 + 0.305\,I_{cl}[\mathrm{clo}]$ | [S3] Eq. 13, attributed to the current standard |
| ISO 11079 **Annex F program** | $f_{cl} = 1.00 + 1.197\,I_{cl}$ | $1 + 0.186\,I_{cl}[\mathrm{clo}]$ | [S4]; also noted by [S3] |
| ISO 9920:2007 Eq. (19)/(20) | $f_{cl} = 1.00 + 1.81\,I_{cl}$ | $f_{cl} = 1.00 + 0.28\,I_{cl}[\mathrm{clo}]$ | ISO 9920 standard text, §2.4 below |

[S3] states this explicitly: according to the ISO 11079 standard text $f_{cl} = 1.0 + 1.97\,I_{cl}$,
but "the algorithm available on the official IREQ webpage uses the equation
$f_{cl} = 1.0 + 1.197 \times I_{cl,r}$". `1.197` looks like a transposition of `1.97`, but it is
what the normative Annex F program and every faithful port actually compute. The discrepancy is
large: at $I_{cl} = 4\ \mathrm{clo}$, $f_{cl} = 2.22$ vs $1.74$.

**Practical note from [S3]:** the paper's headline finding is that IREQ itself is remarkably
insensitive to $f_{cl}$ (compensating terms in the balance), but **DLE is not**: they report
differences "up to 5 h" for long exposures. Since this library's headline output is "you'll be
cold in ~22 minutes", **this choice matters here.** Recommend following Annex F (1.197) for
reproducibility against the standard's Table F.1, and documenting the choice.

- **Confidence:** `verified` that the inconsistency exists and that Annex F uses 1.197 ([S3] + [S4]).
  `single-source` for 1.97 being the body-text value (only [S3]; not visible in the public preview).

### 1.7 Wind and walking correction to clothing insulation (ISO 11079's own form)

ISO 11079 does **not** use the ISO 9920 correction; it carries its own, which uniquely includes
**air permeability**:

$$I_{T,r} = I_T \cdot \left[\,0.54\,e^{-0.15\,v_{ar} - 0.22\,v_w}\,a_p^{\,0.075} - 0.06\ln a_p + 0.5\,\right]$$

$$I_T = I_{cl} + \frac{I_a}{f_{cl}} \qquad I_{cl,r} = I_{T,r} - \frac{I_{a,r}}{f_{cl}}$$

| Symbol | Meaning | Units |
|---|---|---|
| $a_p$ | air permeability of the outer fabric layer | $\mathrm{l\,m^{-2}\,s^{-1}}$ |
| $I_T$ / $I_{T,r}$ | basic / resultant **total** insulation | $\mathrm{m^2\,K\,W^{-1}}$ |
| $I_{cl}$ / $I_{cl,r}$ | basic / resultant **intrinsic (clothing)** insulation | $\mathrm{m^2\,K\,W^{-1}}$ |
| $v_{ar}$, $v_w$ | relative air velocity, walking speed | $\mathrm{m\,s^{-1}}$ |

**$a_p$ units confirmed** from ISO 11079:2007's symbols table [S1]: "$a_p$ air permeability,
$\mathrm{l\cdot m^{-2}\cdot s^{-1}}$", measured per ISO 9237 (listed as a normative reference in [S1] §2).
**A windproof shell enters as a small $a_p$**: as $a_p \to$ small, $-0.06\ln a_p$ grows, so the
bracket grows and less insulation is lost. Worked values for the bracket at $v_{ar}=2,\ v_w=0$:
$a_p = 1$ (membrane, near-windproof) → $0.90$; $a_p = 50$ (ordinary woven) → $0.64$;
$a_p = 500$ (open fleece) → $0.33$. That is a factor ~2.7 spread: **air permeability is a
first-order parameter in cold wind, not a refinement.**

**Default walking speed when unknown:**

$$v_w = 0.0052\,\left(M - 58\right), \quad \text{capped at } 1.2\ \mathrm{m\,s^{-1}}$$

- **Source:** [S4] (`_clothing_constant_part`, exact), [S3] Eq. 8 and Eq. 11 (peer-reviewed;
  [S3]'s rendering of Eq. 8 is garbled by PDF extraction but the coefficients 0.54, −0.15, −0.22,
  0.075, −0.06, +0.5 all appear and match). [S1] for $a_p$ units.
- **Confidence:** `verified` (coefficients agree across [S3] and [S4]).

### 1.8 DLE (Duration Limited Exposure), RT (Recovery Time) and $Q_{lim}$

$$D_{lim} = \frac{-Q_{lim}}{S}$$

$$Q_{lim} = 144\ \mathrm{kJ\,m^{-2}} \;=\; \mathbf{40\ W\,h\,m^{-2}}$$

> ✅ **The user's remembered value of 40 Wh/m² is correct.** ISO 11079:2007's symbols table [S1]
> gives $Q_{lim}$ in $\mathrm{kJ\,m^{-2}}$ ("limit value for $Q$, $\mathrm{kJ\cdot m^{-2}}$"),
> while ISO/TR 11079:1993's table [S2] gives it in $\mathrm{W\cdot h/m^2}$, the 2007 revision
> changed the *unit*, not the value. $144\ \mathrm{kJ\,m^{-2}} \div 3600\ \mathrm{s\,h^{-1}} = 40\ \mathrm{W\,h\,m^{-2}}$ exactly.
> [S3] states "$Q_{lim} = 144\ \mathrm{kJ\,m^{-2}}$ for both criteria"; [S4] hard-codes
> `storage = -40.0` and `dle = -40.0 / storage`.

**Sign convention:** $Q_{lim}$ is a heat *debt*, so it is negative as a change in body heat
content; $S < 0$ during cold exposure. [S4] seeds the storage search at $S = -40$ and computes
`dle = -40.0 / storage`, giving a positive $D_{lim}$ in hours. [S2] Eq. (11) writes it as
$\mathrm{DLE} = Q_{lim}/S$ with both quantities negative: same result. **Write it as
$D_{lim} = |Q_{lim}| / |S|$ and you cannot get the sign wrong.**

| Symbol | Meaning | Units |
|---|---|---|
| $D_{lim}$ (older: DLE) | duration limited exposure | $\mathrm{h}$ |
| $Q_{lim}$ | limiting body heat debt | $\mathrm{kJ\,m^{-2}}$ (2007) or $\mathrm{W\,h\,m^{-2}}$ (1993) |
| $S$ | body heat storage rate | $\mathrm{W\,m^{-2}}$ |

**How $S$ is obtained** (ISO/TR 11079:1993 Eqs. 12–13 [S2], implemented in [S4]). With the
*actual available* resultant insulation $I_{cl,r}$ substituted for IREQ, iterate:

$$S = M - W - C_{res} - E_{res} - E - R - C$$
$$t_{cl} = \overline{t}_{sk} - I_{cl,r}\left(M - W - C_{res} - E_{res} - E - S\right)$$

[S4] solves this by bisection on $S$ (seed $-40$, step 500, halving, tolerance 0.01).

**Important:** $D_{lim}$ is computed **separately for each criterion**, $D_{lim,min}$ uses
$\overline{t}_{sk} = 33.34-0.0354M,\ w=0.06$, and $D_{lim,neutral}$ uses the neutral pair. [S2]
§5.5 notes: "the deficit in thermal insulation between selected clothing and IREQ$_{min}$ is
always smaller than between selected clothing and IREQ$_{neutral}$. Accordingly, the exposure
(DLE) becomes longer at a higher level of strain for IREQ$_{min}$." So
$D_{lim,min} > D_{lim,neutral}$ always. **For a "when will I feel cold?" product,
$D_{lim,neutral}$ is the honest number; $D_{lim,min}$ is the "when is this dangerous" number.**

**Reporting ceiling:** [S4] reports `"more than 8"` for $D_{lim} > 8\ \mathrm{h}$, matching the
standard's Table F.1 presentation. Do not report DLE values beyond 8 h as precise.

**Recovery time (RT / $D_{rec}$).** ISO/TR 11079:1993 §5.5 [S2], verbatim:
> "Recovery time (RT) is calculated in the same way as DLE, substituting the 'cold conditions'
> with the exposure conditions during the recovery period. In other words, $RT = Q_{lim}/S'$,
> where $S'$ is the rate of heat storage (positive) calculated from equations (12) and (13) for
> the exposure conditions during the recovery period. Since recovery is supposed to start when
> the body has achieved a certain heat debt, the value of $Q_{lim}$ should be the same when
> calculating RT."

ISO 11079:2007's symbols table [S1] carries this forward as "$D_{rec}$ recovery time, h".

Also from [S2] §5.5: "If, at the onset of exposure, the worker has adopted a certain heat debt,
the exposure time should be reduced accordingly.": i.e. $Q$ is a *state*, and consecutive
exposures should carry it over. Worth modelling if this library handles multi-day trips.

- **Confidence:** `verified` for $Q_{lim}$ value, units and the DLE formula ([S1] units,
  [S2] formula + 1993 units, [S3] 144 kJ/m², [S4] 40 Wh/m²).
  `verified` for the RT formula ([S2] verbatim standard text; [S1] symbol table corroborates
  that a recovery time quantity exists in the 2007 edition).

### 1.9 Validity limits

| Parameter | Limit | Source |
|---|---|---|
| Air temperature $t_a$ | $\le 10\ ^\circ\mathrm{C}$ | [S4] |
| Metabolic rate $M$ | $58 \le M \le 400\ \mathrm{W\,m^{-2}}$ | [S4] |
| Relative air velocity $v_{ar}$ | $0.4 \le v_{ar} \le 18\ \mathrm{m\,s^{-1}}$ | [S4] + [S3] |
| Walking speed $v_w$ | $\min\!\left(0.0052(M{-}58),\,1.2\right) \le v_w \le 1.2\ \mathrm{m\,s^{-1}}$ | [S4]; [S3] gives $0 \le v_w \le 1.2$ |

> ⚠️ **$v_{ar} \ge 0.4\ \mathrm{m\,s^{-1}}$ is a hard floor and it is a problem for this library.**
> A person asleep in a tent on a still night is at $v_{ar} \approx 0.05$–$0.1\ \mathrm{m\,s^{-1}}$,
> **below the model's validity range.** [S4] returns `NaN` for $v_{ar} < 0.4$ by default. Running
> IREQ at 0.4 when the truth is 0.05 systematically *overestimates* required insulation (errs
> safe), but it is an extrapolation and should be labelled as such in any output.

> ⚠️ **$M \ge 58\ \mathrm{W\,m^{-2}}$ (1 met) is also a floor.** Sleeping metabolic rate is
> ~0.7–0.8 met ($41$–$47\ \mathrm{W\,m^{-2}}$): **also outside IREQ's range.** ISO 23537
> (§3) exists precisely because IREQ does not cover the sleeping case. Do not use IREQ for
> sleeping-bag predictions.

> ⚠️ **ISO 11079 assumes a standing/working, clothed person in wind.** $A_r/A_{Du} = 0.77$
> (standing), $v_w$ default tied to $M$, $I_a$ referenced to 0.4 m/s. A supine person in a
> sleeping bag violates essentially every one of these.

**Field validation caveat.** A validation study (Ingvar Holmér's group) reports that at predicted
time limits the mean-skin-temperature criteria of ISO/TR 11079 "were not met at −14 and −22 °C",
i.e. **the DLE criterion is not perfectly validated in real cold**. Treat DLE as an index, not a
physiological prediction.
Source: *Thermal responses at three low ambient temperatures: Validation of the duration limited
exposure index*, Int. J. Industrial Ergonomics: https://www.sciencedirect.com/science/article/abs/pii/S0169814197000024
(abstract only was read; `single-source`, abstract-level).
See also *Limits of and possibilities to improve the IREQ cold stress model (ISO/TR 11079). A
validation study in the field*: https://www.sciencedirect.com/science/article/abs/pii/S0003687099000599
(abstract only; reports the model applies "for air temperatures up to 15 °C" and "needs improvement
with respect to gender"). Both `single-source`, abstract-level: **the full texts were not read.**

### 1.10 Reference values for regression-testing an implementation

These are **ISO 11079 Table F.1** values, as asserted by `pythermalcomfort`'s test
`test_ireq_iso_11079_table_f1`. Conditions: $t_r = t_a$, RH = 85 %, $a_p = 8\ \mathrm{l\,m^{-2}s^{-1}}$,
$W = 0$, $v_w = \mathrm{clamp}(0.0052(M-58),\,0.5,\,1.2)$.

| $t_a$ (°C) | $v_{ar}$ (m/s) | $M$ (W/m²) | $I_{cl}$ (clo) | IREQ$_\text{neutral}$ (clo) | $I_{cl,\text{neutral}}$ (clo) | DLE$_\text{neutral}$ (h) |
|---|---|---|---|---|---|---|
| 0 | 2 | 90 | 2.5 | 2.6 | 3.1 | 2.3 |
| 0 | 2 | 145 | 2.5 | 1.5 | 1.8 | > 8 |
| −10 | 2 | 90 | 2.5 | 3.5 | 4.4 | 0.7 |
| −10 | 0* | 145 | 2.4 | 1.9 | 2.4 | > 8 |
| −20 | 2 | 115 | 4.2 | 3.4 | 4.2 | > 8 |
| −20 | 7 | 115 | 4.2 | 3.5 | 5.9 | 1.1 |
| −30 | 2 | 115 | 4.2 | 4.0 | 5.0 | 2.2 |
| −30 | 5 | 175 | 4.2 | 2.6 | 4.0 | > 8 |

\* row 4 has $t_r = 0$ with $t_a = -10$ (asymmetric radiant case).

Tolerances asserted by the library: ±0.11 clo on IREQ and $I_{cl}$, ±0.21 h on DLE.

- **Source:** https://github.com/pythermalcomfort/pythermalcomfort, `tests/test_ireq.py`.
- **Confidence:** `single-source` (library's transcription of Table F.1; the table itself is not
  in the public preview). But it is a *self-consistent* anchor: any correct port must reproduce it.

---

## 2. ISO 9920:2007, Garment / ensemble insulation

**Full title:** *Ergonomics of the thermal environment, Estimation of thermal insulation and
water vapour resistance of a clothing ensemble.*

### Primary source for this section

| Tag | What it is | URL |
|---|---|---|
| **[S5]** | **Standard text.** ISO 9920:2007(E) official SIS preview PDF. **This preview contains the full normative body text through page 13**, i.e. Clauses 1–8.2 including Equations (1)–(33) verbatim. The best source in this document. | https://www.sis.se/api/document/preview/908708/ |
| **[S6]** | **Peer-reviewed.** Kuklane et al., *Validation of ISO 9920 clothing item insulation summation method based on an ambulance personnel clothing system*, Industrial Health 59(1):27–33, 2021. | https://www.jniosh.johas.go.jp/en/indu_hel/doc/IH_59_1_27.pdf (also https://pmc.ncbi.nlm.nih.gov/articles/PMC7855677/) |
| **[S7]** | **Peer-reviewed.** Ueno, *Comparison of correction factor for both dynamic total thermal insulation and evaporative resistance between ISO 7933 and ISO 9920*, J. Physiol. Anthropol. 39:23, 2020. Table 1 reproduces both standards' correction equations side by side; Table 2 gives validity ranges. | https://link.springer.com/article/10.1186/s40101-020-00235-9 (PDF: https://d-nb.info/1219498319/34) |

### 2.1 Ensemble summation

$$I_{cl} = 0.161 + 0.835\sum I_{clu} \qquad \text{[clo]}$$

**Verbatim, ISO 9920:2007 Equation (11)** [S5]. The user's remembered form is **exactly correct**.

Or, "with slightly reduced accuracy", ISO 9920 Equation (12):

$$I_{cl} = \sum I_{clu}$$

| Symbol | Meaning | Units |
|---|---|---|
| $I_{cl}$ | **basic (intrinsic)** clothing insulation of the ensemble | clo (Eq. 11 is clo-only) |
| $I_{clu}$ | effective thermal insulation of an individual garment | clo (or $\mathrm{m^2KW^{-1}}$ for Eq. 12) |

**It yields intrinsic $I_{cl}$, not total $I_T$.** [S5] is unambiguous: Clause 4.3 is titled
"Ensemble thermal insulation values based on individual garments" and reads "the insulation for
an ensemble, $I_{cl}$, expressed in clo, may also be estimated". $I_{cl}$ is defined in §2.1.2 as
$(t_{sk}-t_{cl})/H$, i.e. the clothing layer alone, excluding the boundary air layer.

> ⚠️ **Equation (11) is clo-specific.** The constant 0.161 clo has units; the equation is *not*
> dimensionally portable. Convert $I_{clu}$ to clo, apply Eq. (11), then convert back.

**Validity range: verbatim [S5]:** "The application range for which these relationships
[Equations (11) and (12)] were tested is between **0,2 clo and 1,6 clo**."

> ⚠️ **This is a serious limitation for a cold-weather library.** 1.6 clo is a business suit plus
> a light coat. Expedition layering is 3–5 clo: **a factor of 2–3 outside the tested range.**
> [S6] independently extended the test to 0.63–3.33 clo on an ambulance clothing system and found
> agreement within −18 % to +12 % (absolute difference −0.17 to +0.18 clo, mean +0.02 clo,
> $R^2 = 0.98$), "with the highest percentual difference for the lightest clothing sets". That is
> encouraging evidence the equation extrapolates acceptably to ~3.3 clo: but it is **one study,
> one clothing system**, not the standard's claim.

**Two further caveats, verbatim [S5]:** the summations "are based on data with rather uniform
insulation distributions over the body. Such summations should not be used for extreme situations
(e.g. three layers on lower body and only a thin layer on upper body)." And: "The accuracy of the
summation was acceptable when actually measured data for the respective garments were used. When
the separate garments' insulations were obtained from the tables, the accuracy of the summation
was limited."

- **Confidence:** `verified` (ISO 9920 standard text [S5] + independent reproduction in [S6]).

### 2.2 Adjusting a tabulated ensemble (often better than summing)

$$I_{cl,a} = I_{cl,A} + 0.835\times\Delta I_{clu}$$

ISO 9920 Equation (13) [S5]. $I_{cl,A}$ is a tabulated Annex A ensemble, $\Delta I_{clu}$ the
insulation difference for the garment being swapped (negative when removing). [S5] recommends this
over summation: "The accuracy of the summation of individual garments (4.3) is much less than that
of matching the actual ensemble with an ensemble taken from Annex A."

- **Confidence:** `verified` (standard text).

### 2.3 Other estimators in ISO 9920 (may be useful fallbacks)

$$I_{cl} = 0.919 + 0.255\,m - 0.008\,74\,A_{COV,0} - 0.005\,10\,A_{COV,1} \qquad \text{[clo]} \quad (14)$$

$m$ = clothing mass without shoes [kg]; $A_{COV,0}$ = % body surface **not** covered;
$A_{COV,1}$ = % covered by a **single** layer. Tested range 0.2–1.8 clo.

$$I_{clu} = 0.000\,95\,A_{COV}\ [\mathrm{m^2KW^{-1}}] \qquad I_{clu} = 0.0061\,A_{COV}\ [\mathrm{clo}] \quad (15),(16)$$

$A_{COV}$ = % of total skin area covered by that garment.

- **Source:** [S5], verbatim. **Confidence:** `verified` (standard text, read directly).

### 2.4 Clothing area factor

$$f_{cl} = 1.00 + 1.81\,I_{cl}\quad [I_{cl}\ \mathrm{in\ m^2KW^{-1}}] \qquad (19)$$
$$f_{cl} = 1.00 + 0.28\,I_{cl}\quad [I_{cl}\ \mathrm{in\ clo}] \qquad (20)$$

The user's expectation of "$1 + 0.3\,I_{cl}[\mathrm{clo}]$ or similar" is **confirmed** , 
ISO 9920 says 0.28. (Note $1.81 \times 0.155 = 0.281$ ✓ internally consistent.)

**Validity:** "The application range for which these relations were tested is between 0,2 clo
and 1,7 clo" [S5].

**The standard's own warning, verbatim [S5]:** "It should be noted that the correlation between
$f_{cl}$ and $I_{cl}$ observed was low, so the estimate has limited reliability, especially for
non-western clothing. Determination of $f_{cl}$ based on the table examples in Annex A, or,
ideally, by actually measuring it, is therefore preferable, although in general the actual impact
of $f_{cl}$ on the overall result for the insulation values is small."

See §1.6 for the three mutually inconsistent $f_{cl}$ forms across ISO 11079 / ISO 9920.

- **Confidence:** `verified` (standard text read directly; corroborated by [S3]'s Eq. 17).

### 2.5 $I_{cl}$, $I_T$, $I_a$, $R_{e,T}$ and $h_c$ / $h_r$

**The relation the user asked to confirm: ISO 9920:2007 Equation (7), verbatim [S5]:**

$$\boxed{\;I_T = I_{cl} + \frac{I_a}{f_{cl}}\;}$$

**Confirmed exactly.** [S5] explains why, verbatim: "Basic and air insulation do not simply add up
to total insulation. This is explained by the difference in surface area between the outer clothing
surface and the skin surface. Owing to this higher surface area, the insulative effect for the body
of the air insulation is reduced the thicker the clothing."

Definitions (Eqs. 1–4, [S5]), all referred to a *skin-area* basis:

$$I_T = \frac{t_{sk} - t_o}{H} \qquad I_{cl} = \frac{t_{sk} - t_{cl}}{H} \qquad I_a = \frac{t_{cl} - t_o}{H} \qquad f_{cl} = \frac{A_{cl}}{A_{Du}}$$

| Symbol | Meaning | Units |
|---|---|---|
| $H$ | dry heat loss per unit body surface area | $\mathrm{W\,m^{-2}}$ |
| $t_o$ | operative temperature | $^\circ\mathrm{C}$ |
| $A_{cl}$, $A_{Du}$ | clothed / nude (DuBois) body surface area | $\mathrm{m^2}$ |

**Static boundary air layer, [S5] §6 verbatim:** "The static value of $I_a$ ranges in most studies
on which the tables in Annex A were based around **0,7 clo (0,109 m²·K·W⁻¹)** when measured at air
velocities around 0,1 m·s⁻¹ to 0,15 m·s⁻¹."

$$I_a = \frac{1}{h_c + h_r} \qquad (22)$$

**$h_c$: ISO 9920 Eqs. (23)–(25), take the GREATEST of:**

$$h_c = 2.38\,\left|t_{sk} - t_a\right|^{0.25} \qquad h_c = 3.5 + 5.2\,v_{ar} \qquad h_c = 8.7\,v_{ar}^{0.6}$$

> ⚠️ **Note the coefficient is 8.7, not 8.3.** See §5 for the full disentangling of the
> $8.3\,v^{0.6}$ / $8.7\,v^{0.6}$ / $12.1\sqrt{v}$ family across standards.

**$h_r$: ISO 9920 Eq. (26):**

$$h_r = 5.67\times10^{-8}\,\varepsilon\,\frac{A_r}{A_{Du}}\cdot\frac{(t_{cl}+273)^4 - (t_r+273)^4}{t_{cl}-t_r}$$

with, verbatim [S5]: "$A_r/A_{DU}$ … is equal to **0,67 for a crouching subject, 0,70 for a seated
subject and 0,77 for a standing subject**."

**Evaporative resistance: ISO 9920 Eq. (27), verbatim [S5]:**

$$R_{e,T} = \frac{I_T}{i_m L} = \frac{0.06}{i_m}\left(\frac{I_a}{f_{cl}} + I_{cl}\right)$$

with $L = 16.5\ \mathrm{K\,kPa^{-1}}$, $I$ in $\mathrm{m^2KW^{-1}}$, $R_{e,T}$ in $\mathrm{m^2\,kPa\,W^{-1}}$.
"For an air layer, $i_m$ … is around 0,5. For impermeable garments that cover the whole body
including hands, feet and head it is close to zero. For many types of one- or two-layer, permeable
clothing, the permeability index, $i_m$, may be set to **0,38**", giving Eq. (28):

$$R_{e,T} = 0.16\,I_T \qquad\text{and, with } i_{m,cl}=0.34,\quad R_{e,cl} = 0.18\,I_{cl} \quad (31)$$

> **Note the $I_a/f_{cl}$ term here.** This is the form [S3] attributes to ISO 11079 as well, and
> which [S4]'s Annex F port omits. See §1.4 and §7.

- **Confidence:** `verified` for all of §2.5, read directly from the ISO 9920 standard text [S5];
  $A_r/A_{Du}$ and the $h_r$ linearisation corroborated by [S4]/[S3].

### 2.6 Wind and body-movement correction (the Havenith/Nilsson regressions)

**All ISO 9920 corrections operate on TOTAL insulation $I_T$, not intrinsic $I_{cl}$.** Verbatim
[S5] §8.2: "Owing to the type of data that are available, the correction equations used to correct
static clothing insulation for the effects of air and body movement are based on correction of the
total static insulation value, $I_T$."

**Normal / light clothing**: ISO 9920 Eq. (32), verbatim [S5]:

$$I_{T,r} = \mathrm{corr}_{I_T}\cdot I_T,\qquad \mathrm{corr}_{I_T} = e^{\,-0.281(v_{ar}-0.15)\;+\;0.044(v_{ar}-0.15)^2\;-\;0.492\,v_w\;+\;0.176\,v_w^2}$$

Stated range [S5]: $0.6\ \mathrm{clo} < I_{cl} < 1.4\ \mathrm{clo}$, or $1.2\ \mathrm{clo} < I_T < 2.0\ \mathrm{clo}$.

**Nude**: ISO 9920 Eq. (33) and Eq. (21), verbatim [S5]:

$$\mathrm{corr}_{I_a} = e^{\,-0.533(v_{ar}-0.15)\;+\;0.069(v_{ar}-0.15)^2\;-\;0.462\,v_w\;+\;0.201\,v_w^2}, \qquad I_{a,r} = \mathrm{corr}_{I_a}\cdot I_{a,static}$$

with, verbatim [S5]: "$v_{ar}$ … (minimum = 0,15 m·s⁻¹; maximum = **3,5 m·s⁻¹**); $v_w$ … (maximum
= **1,2 m·s⁻¹**); $I_{a,static}$ is the reference value for air insulation (= **0,7 clo**)."

**Intermediate, $0 < I_{cl} < 0.6$ clo**: [S7] Table 1, Eq. 2.2 (interpolation between the two):

$$\mathrm{corr} = \frac{(0.6 - I_{cl})\cdot\mathrm{corr}_{I_a}\cdot I_a \;+\; I_{cl}\cdot\mathrm{corr}_{I_T}\cdot I_{T(0.6)}}{0.6\cdot I_{T(I_{cl})}}$$

**Evaporative resistance correction**: two alternatives, [S7] Table 1 Eqs. 4 and 5 (= [S3] Eqs. 25, 26):

$$\mathrm{corr}_E = e^{\,-0.468(v_{ar}-0.15)\;+\;0.080(v_{ar}-0.15)^2\;-\;0.874\,v_w\;+\;0.358\,v_w^2}$$
$$\text{or}\qquad \mathrm{corr}_E = 0.3 - 0.5\,\mathrm{corr}_{I_T} + 1.2\,\mathrm{corr}_{I_T}^2$$

then $R_{e,T,r} = \mathrm{corr}_E \cdot R_{e,T}$.

**ISO 9920 validity ranges**: [S7] Table 2: $v_{ar}$ 0.15–3.50 m·s⁻¹, $v_w$ 0.0–1.2 m·s⁻¹,
$I_{cl}$ **0.0–1.4 clo**.

> ⚠️ **$I_{cl} \le 1.4$ clo and $v_{ar} \le 3.5$ m·s⁻¹ make the ISO 9920 correction unusable for
> cold-weather clothing.** This is exactly why ISO 11079 carries its own correction (§1.7), which
> is validated to 18 m·s⁻¹ and includes air permeability. **For this library, use the ISO 11079
> form (§1.7), not the ISO 9920 form.**

**How air permeability enters.** [S5] §8.1, verbatim: "The influence of wind depends on the air
permeability of the outer textile layer and on the types and number of openings, though for many
ensembles the effects have been shown to be similar." ISO 9920 has a **separate cold-weather
equation containing $a_p$** on page 14: *past the end of the public preview*. The best available
rendering (from [S3] Eq. 29, a peer-reviewed paper, and a corroborating search snippet) is:

$$\mathrm{corr}_{I_T} \;=\; e^{\,-0.0512(v_{ar}-0.4)\;+\;0.794\times10^{-3}(v_{ar}-0.4)^2\;-\;0.0639\,v_w}\cdot a_p^{\,0.144}$$

> 🔶 **`single-source` / structurally ambiguous: do not ship without checking.** The two renderings
> obtained place $a_p^{0.144}$ differently (as a multiplier outside the exponential vs. multiplying
> the $v_w$ term inside it). Both were PDF/search extractions, neither was the standard text.
> **Use the ISO 11079 Eq. §1.7 instead**, which is cleanly verified by two sources and covers the
> same regime.

- **Confidence:** `verified` for Eqs. (21), (32), (33) and all validity ranges, ISO 9920 standard
  text [S5] read directly, *and* independently reproduced coefficient-for-coefficient in [S7] Table 1.
  `verified` for the $\mathrm{corr}_E$ pair ([S7] + [S3]).
  `UNVERIFIED: do not ship` for the cold-weather $a_p$ variant.

**Underlying primary literature** (abstracts read, full texts **not** obtained):
Havenith & Nilsson, *Correction of clothing insulation for movement and wind effects, a
meta-analysis*, Eur. J. Appl. Physiol. 92(6):636–640, 2004 , 
https://link.springer.com/article/10.1007/s00421-004-1113-6 /
https://pubmed.ncbi.nlm.nih.gov/15138827/. Abstract states: clothing 1.22–4.14 clo; single walking
equation $r^2 = 0.91$; separate wind equations for regular workwear ($r^2 = 0.93$) and cold-weather
clothing ($r^2 = 0.97$); "an interaction between wind and walking effects was present (the size of
the combined effects is less than the sum of the separate effects), and for cold-weather clothing
an effect of clothing air permeability was present."

---

## 3. ISO 23537-1: Sleeping bag thermal ratings

**Full title:** *Requirements for sleeping bags, Part 1: Thermal and dimensional requirements*
(2016) / *Part 1: Thermal, mass and dimensional requirements* (2022). Formerly EN 13537:2002.

> 🔴 **Headline correction to the premise.** The user asked for "the actual regression equations
> that convert a manikin-measured total insulation into Comfort / Limit / Extreme temperatures."
> **No such published regression exists.** ISO 23537-1 converts $R_c(1)$ to temperatures via a
> **normative lookup table with linear interpolation**. Annex C contains a *physiological heat-balance
> model*, not a closed-form fit. A `T_comf = f(I_tot)` polynomial was searched for in EN 13537:2002,
> ISO 23537-1:2016, :2022 and the ISO/DIS draft and was **not found in any of them.**

### Primary sources for this section

| Tag | What it is | URL |
|---|---|---|
| **[T1]** | **Standard text.** ISO 23537-1:2022 preview PDF (12 pp), **contains Table 1 in full**, plus §4.1–4.2 and the test conditions. | https://cdn.standards.iteh.ai/samples/82789/fe5a62f38f094d0a8c9b73cbdb50a7b2/ISO-23537-1-2022.pdf |
| **[T2]** | **Standard text.** ISO 23537-1:2016 preview PDF (11 pp), body through §4.4.8. | https://cdn.standards.iteh.ai/samples/67105/95312389da7d452ea16946940c0c30f2/ISO-23537-1-2016.pdf |
| **[T3]** | **Standard text.** SIST EN 13537:2003 (= EN 13537:2002 English text), 2002 definitions and dimensional zones. | https://cdn.standards.iteh.ai/samples/10293/6840d6213ad347dd88dcb562d5d1d8a5/SIST-EN-13537-2003.pdf |
| **[T4]** | **Peer-reviewed.** Matusiak et al., *Materials* **15**, 1992, 2022: reproduces the Annex C equations and parameter sets. | https://pmc.ncbi.nlm.nih.gov/articles/PMC8951403/ |
| **[T5]** | **Accredited lab report.** SGS Hong Kong SL12300358882101TX, 2023-12-27, tested to ISO 23537-1:2022. | https://s.globalsources.com/IMAGES/CERT/548/C6084866548.pdf |
| **[T6]** | **Standard text.** ISO 15831:2004 preview, the normative manikin method. | https://cdn.standards.iteh.ai/samples/28720/b6d44f6e38f244738a47415497c4ecc4/ISO-15831-2004.pdf |

### 3.1 The actual conversion: Table 1 + linear interpolation

ISO 23537-1:2022 §4.1, **verbatim** [T1]:
> "Depending on the thermal resistance posture 1 $R_c(1)$, the values for the extreme temperature
> ($T_{ext}$), limit temperature ($T_{lim}$) and comfort temperature ($T_{comf}$) as given in Table 1
> shall be used. If the thermal resistances posture 1 $R_c(1)$ measured for the sleeping bag is in
> between the values in Table 1, a **linear interpolation** shall be performed on the basis of the
> nearest upper and lower values."

**Edition difference** (both primary [T1]/[T2]): in **2016** §4.4.8 made the Annex C model normative
and the table an "acceptable accuracy" alternative. In **2022** the table *is* the requirement, and
$T_{max}$ (from $R_c(2)$) was demoted to informative Annex F. Annex C is normative in 2016 and 2022;
it was informative in the DIS draft.

**Table 1: lower temperature limits of the range of utility** ($R_c(1)$ in $\mathrm{m^2\,K\,W^{-1}}$, temperatures in °C).
Reproduced from the freely-published ISO preview [T1]; buy the standard for production use.

| $R_c(1)$ | $T_{ext}$ | $T_{lim}$ | $T_{comf}$ | | $R_c(1)$ | $T_{ext}$ | $T_{lim}$ | $T_{comf}$ |
|---|---|---|---|---|---|---|---|---|
| 0.500 | +5.0 | +14.2 | +17.2 | | 0.980 | −20.5 | −3.7 | +1.8 |
| 0.540 | +2.8 | +12.7 | +15.9 | | 1.020 | −22.5 | −5.2 | +0.6 |
| 0.580 | +0.6 | +11.2 | +14.6 | | 1.060 | −24.5 | −6.7 | −0.7 |
| 0.620 | −1.5 | +9.7 | +13.3 | | 1.100 | −26.5 | −8.1 | −1.9 |
| 0.660 | −3.7 | +8.1 | +12.0 | | 1.140 | −28.5 | −9.5 | −3.1 |
| 0.700 | −5.8 | +6.6 | +10.7 | | 1.180 | −30.5 | −11.0 | −4.4 |
| 0.740 | −7.9 | +5.1 | +9.4 | | 1.220 | −32.5 | −12.4 | −5.6 |
| 0.780 | −10.1 | +3.6 | +8.1 | | 1.260 | −34.4 | −13.8 | −6.8 |
| 0.820 | −12.2 | +2.2 | +6.9 | | 1.300 | −36.4 | −15.2 | −8.0 |
| 0.860 | −14.3 | +0.7 | +5.6 | | 1.340 | −38.3 | −16.7 | −9.2 |
| 0.900 | −16.3 | −0.8 | +4.3 | | 1.380 | −40.2 | −18.1 | −10.4 |
| 0.940 | −18.4 | −2.3 | +3.1 | | 1.420 | −42.2 | −19.5 | −11.6 |

**Validity: $0.500 \le R_c(1) \le 1.420\ \mathrm{m^2KW^{-1}}$** (3.23 to 9.16 clo). The table stops at
$T_{lim} = -19.5\ ^\circ\mathrm{C}$ because the 2022 scope is restricted to "sleeping bags designed
for limit temperatures of −20 °C and higher" [T1]. **Deep-winter bags are out of scope of the standard.**

**Independent validation against an accredited lab** [T5]: SGS measured $R_c(1) = 1.195\ \mathrm{m^2KW^{-1}}$
and reported $T_{ext}/T_{lim}/T_{comf} = -31 / -11 / -5\ ^\circ\mathrm{C}$. Interpolating Table 1 at
1.195 gives $-31.25 / -11.53 / -4.85$: all three round to the reported values. ✓

- **Confidence:** `verified`, **three ways**: the standard text [T1] was fetched and the table
  extracted directly (twice, independently, during this research); the interpolation arithmetic was
  recomputed; and an accredited lab's real measurement [T5] falls on it.

**Related clauses worth knowing about (titles confirmed from [T1]'s table of contents, contents not
in the preview):** Annex A *(normative)* "Reference values of thermal resistance for calibration of
thermal manikin"; Annex B *(informative)* "Precision of test results"; Annex C *(normative)*
"Physiological model for calculation of range of utility" (pp. 14–18); **Annex D *(informative)*
"Warning of misuse of temperature rating"** (p. 19); Annex E "Rationale"; Annex F "Test method for
maximum temperature". **Annex D is the one a consumer-facing product should read before shipping a
number**: it was not obtainable here.

### 3.2 Annex C: the physiological model behind the table

$$M = M_B + M_S \qquad (C.1)$$
$$M_B + M_S = H_c + H_e + H_{res} + \Delta S \qquad (C.2)$$
$$H_c = \frac{t_{sk} - t_a}{R_{c,\mathrm{eff}}} \qquad (C.3)$$
$$H_e = \frac{w\left(p_{sd} - p_a\right)}{R_{e,\mathrm{eff}}} \qquad (C.4)$$
$$H_{res} = M\left[0.5524 - 0.00144\left(t_a + 273\right) - 0.00632\,\frac{p_a}{t_a + 273}\right] \qquad (C.5)$$

| Symbol | Meaning | Units |
|---|---|---|
| $M$, $M_B$, $M_S$ | total / basal (recumbent) / shivering metabolic heat production | $\mathrm{W\,m^{-2}}$ |
| $H_c$, $H_e$, $H_{res}$ | dry, evaporative, respiratory heat loss | $\mathrm{W\,m^{-2}}$ |
| $\Delta S$ | rate of change of body heat content (= 0 at a rating temperature) | $\mathrm{W\,m^{-2}}$ |
| $t_{sk}$, $t_a$ | mean skin temperature, ambient air temperature | $^\circ\mathrm{C}$ |
| $R_{c,\mathrm{eff}}$ | effective thermal resistance of the bag system | $\mathrm{m^2\,K\,W^{-1}}$ |
| $R_{e,\mathrm{eff}}$ | effective water-vapour resistance | $\mathrm{m^2\,Pa\,W^{-1}}$ |
| $w$ | skin wettedness, fixed at **0.06** | - |
| $p_{sd}$, $p_a$ | saturated vapour pressure at skin temp; ambient vapour pressure | $\mathrm{Pa}$ |

**Per-rating parameter sets:**

| Rating | $M_B$ | $M_S$ | $R_{c,\mathrm{eff}}$ | $i_m$ (in $R_{e,\mathrm{eff}} = 60\,R_{c,\mathrm{eff}}/i_m$) |
|---|---|---|---|---|
| $T_{comf}$ | 44.4 $\mathrm{W\,m^{-2}}$ | 0 | $0.9\,R_c$ | 0.50 |
| $T_{lim}$ | 47.5 $\mathrm{W\,m^{-2}}$ | 0 | $1.0\,R_c$ | 0.54 |
| $T_{ext}$ | 44.4 $\mathrm{W\,m^{-2}}$ | **25.4** $\mathrm{W\,m^{-2}}$ | $1.0\,R_c$ | 0.54 |

**Internal consistency checks that passed:** $60/i_m$ is the Lewis relation in Pa
($1000\ \mathrm{Pa/kPa} \div 16.65\ \mathrm{K\,kPa^{-1}} = 60.06$), so $i_m$ is a water-vapour
permeability index: and the standard separately requires $i_{mt} \ge 0.45$ for the bag [T1] §4.2.
Eq. (C.5) is the standard Fanger/ISO 7933 respiratory-loss expression.

> **Reconstruction check performed during research (not a published result):** implementing C.3–C.5
> with the parameters above at 50 % RH and solving for $t_a$ at all 24 $R_c$ values reproduces **all
> 72 Table 1 cells** with a single fitted mean skin temperature: RMS error 0.03–0.04 K, max error
> 0.08 K over a 60 K span. Fitted $t_{sk} = 32.85\ ^\circ\mathrm{C}$ ($T_{comf}$, $T_{lim}$) and
> $32.55\ ^\circ\mathrm{C}$ ($T_{ext}$). Agreement that tight is not coincidence: this is the
> Annex C model. **But the fitted $t_{sk}$ is a derived number, not a sourced constant.**

> ⚠️ [T4]'s bullet labels are garbled: it attaches the shivering term to $T_{comf}$ and the
> $0.9\,R_c$ factor to $T_{ext}$, which is physiologically backwards. The assignment in the table
> above is the corrected one, confirmed by the numerical reconstruction.

- **Confidence:** `single-source` for the equations and parameter values ([T4]); **corroborated
  numerically** against the standard's own Table 1. The literal Annex C text was never obtained.

### 3.3 Closed-form fits to Table 1

**These are fits produced during this research, NOT published coefficients.** Use them only as a
convenience; the normative method is interpolation of Table 1. Valid for
$0.500 \le R_c \le 1.420\ \mathrm{m^2KW^{-1}}$ only.

$$T_{ext} = 4.0229\,R_c^2 - 58.9696\,R_c + 33.4782 \qquad (\text{max err } 0.056\ \mathrm{K})$$
$$T_{lim} = 1.7535\,R_c^2 - 39.9917\,R_c + 33.7707 \qquad (\text{max err } 0.055\ \mathrm{K})$$
$$T_{comf} = 1.7188\,R_c^2 - 34.6153\,R_c + 34.0899 \qquad (\text{max err } 0.039\ \mathrm{K})$$

Sanity: the intercepts are 33–34 °C, i.e. skin temperature, as the physics requires ($t_a \to t_{sk}$
as $R_c \to 0$). ✓

- **Confidence:** `verified` as fits (they reproduce the verified Table 1); **`UNVERIFIED` as anything
  the standard publishes**: they are not in any edition read.

### 3.4 Standard woman / standard man

| Quantity | Standard woman | Standard man | Confidence |
|---|---|---|---|
| Age | 25 y | 25 y | `single-source` (vendor explainers, multiple but non-independent) |
| Height | 1.60 m | 1.73 m | `single-source` (same caveat) |
| Mass | 60 kg | **70 kg *or* 73 kg: contested** | woman `single-source`; man **`UNVERIFIED`** |
| Body surface area | 1.62 m² | 1.83 m² | `UNVERIFIED` |
| Used for | **$T_{comf}$ and $T_{ext}$** | **$T_{lim}$** (and $T_{max}$) | `verified` ([T3] + multiple) |

**Metabolic rate: answering the 0.8 MET question.** Vendor explainers quote a single
$46\ \mathrm{W\,m^{-2}}$ for both sexes. The reconstruction instead gives **44.4 $\mathrm{W\,m^{-2}}$
(woman) and 47.5 $\mathrm{W\,m^{-2}}$ (man)**: which bracket 46, so "46" looks like a rounded
conflation. In met units (1 met = 58.15 W/m²): **0.76 met (woman), 0.82 met (man)**. So
**"≈0.8 MET" is correct.** Shivering at $T_{ext}$ adds 25.4 W/m², taking $M$ to 69.8 W/m² ≈ **1.20 met**.

**Physiological criteria**: definitions `verified` from [T1]/[T2]/[T3]:
- **$T_{comf}$**: "lower limit of the comfort range, down to which a sleeping bag user with a
  relaxed posture, such as lying on their back, is globally in thermal equilibrium and at the
  threshold of feeling cold." *Mechanism: steady-state balance at basal metabolism, no shivering,
  with a 10 % insulation penalty for the spread-out posture.*
- **$T_{lim}$**: "lower limit at which a sleeping bag user with a curled-up body posture is
  globally in thermal equilibrium and at the threshold of feeling cold." *Full $R_c$ (curling
  preserves insulation), higher basal rate.*
- **$T_{ext}$**: "very low temperature where the risk of health damage by hypothermia is possible".
  *Balance only achieved with maximal shivering, +57 % over basal.*

Wording history: EN 13537:2002 [T3] wrote the sex into the clause-3 definitions; ISO 2016/2022
stripped it out and moved it to Annex C. "just not feeling cold" (2016) → "at the threshold of
feeling cold" (2022).

> ⚠️ **$T_{comf}$ and $T_{ext}$ use the standard *woman*; $T_{lim}$ uses the standard *man*.** The
> three numbers on a bag's label are therefore **not three points on one person's curve.** A library
> that interpolates between them is interpolating between two different bodies. Say so in the output.

### 3.5 Test setup: ⚠️ the mat is *inside* the rating

All `verified` from [T1]/[T2] standard text.

| Parameter | ISO 23537-1:2016 | ISO 23537-1:2022 |
|---|---|---|
| Manikin | per ISO 15831, height **(1.70 ± 0.15) m** | same |
| Manikin surface temp | per ISO 15831:2004 Cl. 7, **34 °C ± 0.2 K** | same |
| **Posture** | **supine (on its back)** for *both* $R_c(1)$ and $R_c(2)$: **never curled** | same |
| **Reference mattress** | foam, **$R_{ct} = (0.85 \pm 0.06)\ \mathrm{m^2KW^{-1}}$** per ISO 11092 | same |
| Artificial ground | ISO 1096 wooden board, (20 ± 2) mm, ≥100 mm above floor | same |
| **Clothing** | two-piece long-sleeve suit, $R_{ct}$ **0.040–0.060 $\mathrm{m^2KW^{-1}}$**, knee socks | same |
| Air speed | **(0.3 ± 0.15) m/s** | per ISO 15831:2004 Cl. 7 |
| Ambient temperature | **(15 ± 2) °C** | **(10 ± 5) °C** |
| RH | **(50 ± 5) %** | per ISO 15831:2004 Cl. 7 |
| Heat flux | ≥ 20 W/m² per segment | same |
| Replicates | **three** separate tests, arithmetic mean | same |

The 2022 revision **loosened the chamber spec** (ambient 15±2 → 10±5 °C) and delegated air
speed/RH to ISO 15831. Ratings from the two editions are not strictly interchangeable.

**$R_c(1)$ vs $R_c(2)$: genuinely distinct tests** [T2]:
- **$R_c(1)$**: manikin *fully* inserted, supine; zips closed; hood drawn over the head with cords
  tightened as far as possible by hand. A cold-weather mask is used **only if** the hood aperture
  closes to < 120 mm diameter. Serial or parallel summation.
- **$R_c(2)$**: manikin *partly* inserted; bag pulled only to the armpits, arms outside; zips fully
  open; hood under the head. **Parallel method only.** Feeds $T_{max}$, which 2022 demoted to
  informative Annex F.

**Correction to the premise on "hood/shoulder/foot measurement zones":** those are **dimensional**,
not thermal. EN 13537:2002 Table 1 [T3] specifies minimum *inside widths* at the foot, knee and
shoulder zones (mummy, body ≤175 cm: 48 / 58 / 73 cm; inside length 180 cm). ISO 2016/2022 replaced
this with declared-value-plus-tolerance (inside length ±3 cm; inside foot width measured
30 ± 1 cm from the heel seam, ±2 cm; mass ±5 %). **There is no per-zone thermal rating** , 
$R_c(1)$ is a whole-body number.

Also normative [T1] §4.2: water-vapour permeability index **$i_{mt} \ge 0.45$**.

### 3.6 What $I_{tot}$ does a −7 °C (20 °F) comfort bag actually measure?

> 🔴 **First, disambiguate the label.** −7 °C = 19.4 °F. US brands overwhelmingly label by the
> **Limit**, European brands by the **Comfort**. [T5] makes this concrete: one real bag is
> "12 °F" ($T_{lim}$) *and* "23 °F" ($T_{comf}$) simultaneously. Answering "what is a 20 °F bag"
> therefore has two different answers:

| Interpretation | Required $R_c(1)$ | In clo |
|---|---|---|
| **$T_{comf} = -7\ ^\circ\mathrm{C}$** (true EU-style comfort rating) | **1.267 $\mathrm{m^2KW^{-1}}$** | **8.17 clo** |
| **$T_{lim} = -7\ ^\circ\mathrm{C}$** (what a US "20 °F bag" usually means) | **1.069 $\mathrm{m^2KW^{-1}}$** | **6.89 clo** |
| $T_{lim} = -6.7\ ^\circ\mathrm{C}$ (exactly 20.0 °F) | 1.060 | 6.84 clo |
| $T_{ext} = -7\ ^\circ\mathrm{C}$ | 0.723 | 4.66 clo |

Other anchors: $T_{comf} = 0\ ^\circ\mathrm{C} \to 1.039$ (6.70 clo); $T_{comf} = -10\ ^\circ\mathrm{C} \to 1.367$
(8.82 clo); $T_{lim} = -18\ ^\circ\mathrm{C}$ (0 °F) $\to 1.377$ (8.88 clo).
(Derived by interpolating the verified Table 1; 1 clo = 0.155 m²K/W.)

**Measured, named manikin values: `verified`** [T5]: SGS report SL12300358882101TX, a 3.329 kg
US-style modular bag: **$R_c(1) = 1.195\ \mathrm{m^2KW^{-1}} = 7.71\ \mathrm{clo}$** →
$T_{ext}/T_{lim}/T_{comf} = -31 / -11 / -5\ ^\circ\mathrm{C}$. As-run: air 5 ± 0.5 °C, air speed
0.3–0.5 m/s, manikin 34.0 ± 0.1 °C, height 1.78 m, surface area 1.8 m².

**Peer-reviewed measured values: `single-source`** [T4]: a "summer" bag at
$R_{c,\mathrm{eff}} = 0.851\ \mathrm{m^2KW^{-1}}$ (−20 °C chamber) / 0.794 (+20 °C chamber); an
"autumn" bag at 1.111 / 1.063. **Note the same bag's $R_c$ varies 5–7 % across a −20…+20 °C
chamber range**: the rating is not a temperature-independent constant.

> 🔴 **The single most important caveat for this library.** $R_c(1)$ is $I_{tot}$ of the **whole
> system**, not the bag. ISO 23537-1:2022 clause 3.6 Note 2, **verbatim** [T1]: it "includes the
> effects of the shell fabrics and filling materials, air volume in the cavity inside the sleeping
> bag, boundary air layer on the outer face of the sleeping bag, **mattress underneath the sleeping
> bag and garments worn by the sleeping bag user**. It is considered to be the total thermal
> insulation (see ISO 15831)."
>
> So **~8 clo for a −7 °C comfort bag already includes a 0.85 m²K/W mat, base layers and the surface
> air layer.** Consequences:
> 1. **Do not add a pad R-value on top of a bag's ISO rating**: you would double-count. The rating
>    already assumes a mat of $R_{ct} = 0.85\ \mathrm{m^2KW^{-1}}$ ≈ **US R-value 4.8** (§4).
> 2. A user with a *worse* pad than R≈4.8 is colder than the label says; a better pad buys the
>    difference. Model the **delta**, not the absolute.
> 3. The bag's own insulation is $R_c(1)$ minus mat, clothing and boundary layer: not directly
>    published.

### 3.7 Validation literature (abstract-level only)

Havenith's sleeping-bag validation work (Ann. Occup. Hyg. / Appl. Ergon. ~2012 four-bag study;
JOSE 2010) was **paywalled and not read**. Secondary summaries indicate that air velocity, mattress
insulation and unpack-to-measure time each shift measured insulation by **5–15 %** within the
parameter window the standard allows, while manikin mass, ground thickness and mask presence are
negligible; and that EN 13537 tends to **underestimate** $T_{comf}$/$T_{lim}$ for high-insulation bags.
`UNVERIFIED`: do not quote these numbers as established.

### 3.8 Independent reproduction, and what it says about the simple `clo_required` heuristic

**Reproduction.** The Annex C model (§3.2) was implemented a second time, independently, during
this research: Eqs. (C.1)–(C.5), the parameter table, 50 % RH, bisection on $t_a$. Spot checks
against the verified Table 1:

| Rating | $R_c$ = 0.500 | 0.900 | 1.260 | 1.420 |
|---|---|---|---|---|
| $T_{comf}$ model / table | +17.14 / **+17.2** | +4.34 / **+4.3** | −6.80 / **−6.8** | −11.64 / **−11.6** |
| $T_{lim}$ model / table | +14.23 / **+14.2** | −0.79 / **−0.8** | - | −19.42 / **−19.5** |
| $T_{ext}$ model / table | +5.02 / **+5.0** | −16.32 / **−16.3** | - | −42.14 / **−42.2** |

Max deviation 0.08 K across a 60 K span. **This upgrades §3.2 from `single-source` to
`verified-by-reconstruction`:** two independent implementations of [T4]'s equations both reproduce
the standard's own normative table. The equations are right. (The fitted $t_{sk}$ remains derived,
not sourced.)

**Consequence for the project's existing heuristic.** `REFERENCE_warmth_check.md` currently uses

$$\mathrm{clo_{required}} = \frac{33 - t_a}{0.155\,M}$$

This is the dry-heat-only balance: it assumes **all** metabolic heat crosses the insulation as dry
heat. Comparing it against ISO 23537's comfort requirement for a sleeping person:

| °F | °C | heuristic (M = 47 W/m²) | ISO 23537 $I_{tot}$ for $T_{comf}$ | ratio |
|---|---|---|---|---|
| 45 | +7.22 | 3.54 clo | 5.22 clo | **1.48** |
| 40 | +4.44 | 3.92 clo | 5.78 clo | **1.47** |
| 35 | +1.67 | 4.30 clo | 6.35 clo | **1.48** |
| 30 | −1.11 | 4.68 clo | 6.93 clo | **1.48** |
| 25 | −3.89 | 5.06 clo | 7.51 clo | **1.48** |
| 20 | −6.67 | 5.44 clo | 8.10 clo | **1.49** |

> 🔴 **The heuristic understates the sleeping insulation requirement by a near-constant factor of
> ≈ 1.48.** The factor decomposes almost exactly as:
>
> | Cause | Factor |
> |---|---|
> | Omitting respiratory + evaporative loss ($H_e + H_{res} \approx 22\%$ of $M$) | **1.26** |
> | Omitting the $0.9\,R_c$ relaxed-posture penalty | **1.11** |
> | Using $M = 47$ rather than the standard woman's 44.4 W/m² | **1.06** |
> | $t_{sk} = 33$ vs. 32.85 °C | 1.00 |
> | **product** | **1.48** ✓ |
>
> The dominant term is counter-intuitive but correct: because $H_c = M - H_e - H_{res}$, **less**
> heat is available to drive the temperature gradient than the naive form assumes, so **more**
> insulation is required, not less.
>
> Note the heuristic's output is $I_{tot}$ (no boundary layer or $f_{cl}$ term), which is the right
> quantity to compare against $R_c(1)$: so the comparison above is apples-to-apples, and the gap
> is real rather than a units artefact. **Either apply the model, or apply the 1.48 correction and
> label it as an empirical fudge.** The 1.48 figure is valid only for the sleeping case
> (0.76–0.8 met, supine, 50 % RH); it is *not* a general correction.

- **Confidence:** `verified` (both tables computed here from sources already verified above;
  reproducible from the equations in §3.2 and Table 1 in §3.1).

---

## 4. ASTM F3340: Sleeping pad (camping mattress) R-value

### 4.1 Designation: ⚠️ the current edition is **-22**, not -18

| Item | Value |
|---|---|
| **Current edition** | **ASTM F3340-22** (Active). F3340-18 is marked *Historical*. |
| Full title | *Standard Test Method for Thermal Resistance of Camping Mattresses Using a **Guarded Hot Plate** Apparatus* |
| Approved / published | 2022-06-15 / July 2022; originally approved 2018 |
| Committee | ASTM F08, Subcommittee **F08.22 Camping Softgoods** |
| DOI | 10.1520/F3340-22 · Book of Standards Vol. 15.07 · 12 pp |

- **Source:** https://www.astm.org/f3340-22.html and https://www.astm.org/f3340-18.html (the latter
  carries "Standard **Historical**"); official 4-page publisher preview of the standard text:
  https://www.normsplash.com/Samples/ASTM/154885617/ASTM-F3340-22-en.pdf
- **Confidence:** `verified` (ASTM's own catalogue pages + the publisher-issued preview of the
  standard's own front matter).

### 4.2 The test: guarded hot plate, under load

**Scope §1.1, verbatim** (publisher preview): "This test method covers the measurement of the
thermal resistance of camping mattresses in conditions of steady-state heat transfer, using a
two-plate apparatus. The camping mattress is held under constant compressive force between a
guarded hot plate and a cold plate. The primary heat transfer for this method is one dimensional,
vertically through the camping mattress thickness. As such this measured thermal insulation value
is a repeatable comparative measurement. However, it needs to be noted that this value will not
always correlate to actual insulation performance … (for example, edge heat loss, uncovered surface
heat loss, compression rate changes or posture changes during sleep)."

**§1.2:** "Auxiliary insulation of any type shall be excluded in the measurement."

**Base standard: §7.1.1, verbatim:** "The guarded hot plate and cold plate shall be designed and
constructed using principles and construction which are well defined in **Test Method C177, Test
Method D1518, or ISO 8302**."

> ⚠️ **It is NOT ASTM C518** (heat-flow-meter) and **NOT ASTM F1868** (sweating guarded hotplate).
> Neither appears in §2. The full §2 list is C168, C177, D1518, E177, E691, ISO 8302. (The F1868
> confusion likely comes from commercial rigs that satisfy both F1868 and F3340.)

Plate specs (§7.2–7.4, verbatim): metering-plate temperature uniformity < 0.2 °C; surface
**emissivity ≥ 0.9 "as to mimic the emissivity of human skin"**; metering plate ≥ 200 mm;
metering + guard ring 400–660 mm; "Compression can be achieved by any viable means, such as dead
weight or constant-force springs"; plates parallel within 2 %.

### 4.3 Measurement conditions

| Parameter | Value | Imperial |
|---|---|---|
| **Hot plate** | **35 °C** | 95 °F |
| **Cold plate** | **5 °C** | 41 °F |
| $\Delta T$ | **30 K** | 54 °F |
| **Mean plate temperature** | **20 °C** | 68 °F |
| Ambient air | 20 °C (= plate mean, per §4.1) | - |
| Relative humidity | 20–80 % | - |
| **Compression pressure** | **2.0 ± 0.1 kPa** | ≈ 0.29 psi |
| **Inflation pressure** (inflatables) | **3.5 ± 0.2 kPa** | - |

**On the "body load" question:** the standard specifies a **pressure, not a mass**, 2.0 kPa, applied
by dead weight or constant-force springs. For scale, that is roughly the contact pressure of a
supine adult (≈70 kg over ≈0.35 m² of contact area).

**Conditioning, §9.3 verbatim:** inflatables are filled to **3.7 kPa** (0.2 kPa above the test fill,
to let pressure equalise) with a raft pump: "Compressed air or mouth blowing are not recommended to
avoid introducing moisture, particulates, and oils": then conditioned in the test environment
**≥ 6 h** (inflating) / **≥ 2 h** (non-inflatable).

**Sampling, §9.1/§9.4.1:** "Test three identical specimens", three measurement lines at 0.25 L,
0.5 L, 0.75 L → **9 measurements across 3 full-size specimens** for consumer-facing claims. §9.2.2:
cut-down (20 × 20 in) specimens "cannot be used for consumer-facing claims."

- **Source:** Kansas State University Institute for Environmental Research submission form (the
  accredited commercial lab that runs this test) , 
  https://www.k-state.edu/ier/testing/KSU%20Submission%20Form%20for%20Camping%20Mattresses.docx
  (lab documentation); independently corroborated by https://www.yamatomichi.com/en/journals/309473
  (manufacturer technical write-up); §§7, 9 quotes from the publisher preview of the standard text.
- **Confidence:** `verified` for the plate temperatures, pressures and conditioning (two independent
  sources plus the standard's own preview text).

### 4.4 The reported unit is **imperial**: confirmed, and the apparent contradiction resolved

The standard's §1.4 says "The values stated in SI units are to be regarded as the standard."
That looks like it contradicts the familiar imperial R-value on a pad's hangtag. **It doesn't** , 
Terminology §3.2 settles it, **verbatim**:

> **3.2.9** *R-value, n*: thermal resistance of a material or a system in **inch-pound units: F ft² h/Btu**.
> **3.2.9.1** *Discussion*: R-value is only used as a presentation of a converted final material's
> RSI-value. It shall not be used in any intermediate measurement data conversion or machine calibration.
> **3.2.10** *RSI-value, n*: thermal resistance of a material or a system in **SI units: K m²/W**.

So: **all measurement and arithmetic happen in SI ("RSI"); the published consumer number is the
inch-pound R-value, $\mathrm{ft^2\,^\circ F\,h\,BTU^{-1}}$**, obtained by converting at the end.
"RSI" is the standard's own name for the SI variant. The user's expectation is correct.

- **Confidence:** `verified` (standard's own terminology clause, read directly).

### 4.5 Unit conversions

$$1\ R_{\mathrm{imperial}} \;=\; 1\ \frac{\mathrm{ft^2\cdot{}^\circ F\cdot h}}{\mathrm{BTU_{IT}}} \;=\; \mathbf{0.1761102\ m^2\,K\,W^{-1}}$$
$$1\ \mathrm{m^2\,K\,W^{-1}} = 5.678263\ R_{\mathrm{imperial}} \qquad 1\ \mathrm{clo} = 0.155\ \mathrm{m^2\,K\,W^{-1}}$$
$$\boxed{\;1\ R_{\mathrm{imperial}} = \frac{0.1761102}{0.155} = \mathbf{1.13619\ clo}\;}\qquad 1\ \mathrm{clo} = 0.88013\ R_{\mathrm{imperial}}$$

**The user's expected ≈1.136 clo per R is confirmed exactly.**

Exact derivation (computed twice independently during this research):
$$\frac{3600\ \mathrm{s}\times 0.09290304\ \mathrm{m^2}\times \tfrac{5}{9}\ \mathrm{K}}{1055.05585262\ \mathrm{J}} = \frac{185.80608}{1055.05585262} = 0.17611018\ \mathrm{m^2\,K\,W^{-1}}$$

| $R$ (imperial) | $\mathrm{m^2KW^{-1}}$ | clo |
|---|---|---|
| 1 | 0.1761 | 1.136 |
| 2 | 0.3522 | 2.272 |
| 3 | 0.5283 | 3.409 |
| 4 | 0.7044 | 4.545 |
| 5 | 0.8806 | 5.681 |
| 6 | 1.0567 | 6.817 |
| 7 | 1.2328 | 7.953 |

> ⚠️ **Some converters quote the reciprocal as 5.67446.** That uses the *thermochemical* BTU
> (1054.350 J), not $\mathrm{BTU_{IT}}$. Use **5.678263 / 0.1761102**.

- **Source:** NIST SP 811 Appendix B.9 (primary metrology reference) , 
  https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9
  lists "°F·h·ft²/Btu_IT → 1.761 102 E-01" m²K/W, "clo → 1.55 E-01" m²K/W, "Btu_IT → 1.055 056 E+03" J.
  Cross-checked against https://en.wikipedia.org/wiki/R-value_(insulation) (0.1761102 / 5.678263) and
  against direct computation here.
- **Confidence:** `verified` (NIST + independent arithmetic, agreeing to 7 significant figures).
  The 1 clo = 0.155 m²K/W figure is additionally confirmed *inside ISO 7730:2005* itself
  (note under Eq. 4: "1 clothing unit = 1 clo = 0,155 m²·°C/W").

### 4.6 Are stacked pads additive?: **asserted everywhere, measured nowhere**

**(a) Does the standard say?** **No: nothing found.** §§1–9 (the publicly available pages) never
mention stacking or layering, and point the other way: §1.2 "Auxiliary insulation of any type shall
be excluded"; §9.2.1 defines the specimen as one full-size mattress. **There is no certified stacked
rating under F3340.** §§10–13 and Annexes A1–A4 are paywalled → `UNVERIFIED` for those.

**(b) Manufacturers say yes: consistently, with one qualifier:**

- **Cascade Designs / Therm-a-Rest** (drove the standard): "R-value is additive; therefore, if you
  stack two pads, you can add their respective R-values together for a higher overall rating." Worked
  example: XLite (4.2) + Z Lite SOL (2.0) = 6.2.
  https://cascadedesigns.com/blogs/thermarest-gear/ultimate-guide-sleeping-pads (manufacturer)
- **NEMO** (co-author of the standard): "R-Value is additive, which means that you can use two pads
  and add their R-Values together."
  https://www.nemoequipment.com/blogs/journal/new-standardized-r-value-nemos-involvement-in-and-approach-to-astm-f3340 (manufacturer)
- **Therm-a-Rest engineers, interviewed: this is the operative qualifier:** "Yes, the R-values of
  sleeping pads are additive, **provided that there is no air gap between them**." And: "As long as
  there isn't an air gap between the pads, they'll have the same additive R-value no matter how
  they're stacked." https://sectionhiker.com/new-sleeping-pad-r-value-standard-astm-ff3340/ (interview)

**(c) Measured stacked-pad data: NONE FOUND.** No published measurement of a stacked pair run on an
F3340 rig versus the sum of the individuals: not from any manufacturer, lab, gear-testing outlet or
academic source. **Every additivity claim above is series-resistance theory asserted, not measured.**
Claims circulating that air gaps cost "5–15 %" trace only to AI-generated SEO content with no cited
measurement → `UNVERIFIED`, do not use.

**Physics caveat worth shipping.** Series addition of thermal resistances is exact only under
conditions a pad stack does not meet:
1. Additivity holds for "dense solids in direct mutual contact". Inflatable pads are neither dense
   solids nor in uniform contact: the interface adds contact resistance and can host a radiating
   air gap.
2. Each pad is rated individually across a 35 °C / 5 °C boundary. **In a stack the upper pad sees a
   warmer, narrower span and the lower pad a colder one**: and radiative and convective transport
   inside an air-filled pad are not linear in $\Delta T$, so neither pad is operating at its rated point.

**Treat additivity as a good first-order model, flagged as unmeasured.**

- **Confidence:** `verified` that manufacturers claim additivity (three first-party sources);
  `UNVERIFIED` that it is true to any stated tolerance; **`UNVERIFIED: do not ship`** for any
  specific stacking penalty figure.

### 4.7 Cross-reference: do not double-count the pad against a sleeping-bag rating

See §3.6. ISO 23537's $R_c(1)$ **already includes a reference mattress of
$R_{ct} = 0.85\ \mathrm{m^2KW^{-1}}$ ≈ imperial R 4.83**. Adding a pad's R-value on top of a bag's
ISO rating double-counts. Model the **difference** from R ≈ 4.8.
(0.85 / 0.1761102 = 4.827: computed here; `verified`.)

---

## 5. ISO 7730 / ISO 7933: convective and radiative coefficients

> **Headline: the user's remembered pair mixes three different lineages.** $12.1\sqrt{v}$ is ISO 7730.
> $8.3\,v^{0.6}$ is **Mitchell (1974) via the ASHRAE Handbook**: not ISO anything. ISO 7933/9920 use
> $8.7\,v^{0.6}$. And **ISO 7726 contains none of them** (its only convection coefficients are for
> the globe thermometer).

### 5.1 ISO 7730: the PMV/Fanger branch ✅ **both of the user's branches' *forms* confirmed**

ISO 7730:2005 §4, **Equation (3), verbatim**:

$$h_c = \begin{cases} 2.38\,\lvert t_{cl} - t_a\rvert^{0.25} & \text{for } 2.38\,\lvert t_{cl}-t_a\rvert^{0.25} > 12.1\sqrt{v_{ar}}\\[4pt] 12.1\sqrt{v_{ar}} & \text{for } 2.38\,\lvert t_{cl}-t_a\rvert^{0.25} < 12.1\sqrt{v_{ar}}\end{cases}$$

i.e. $h_c = \max\!\left(2.38\,\lvert t_{cl}-t_a\rvert^{0.25},\; 12.1\sqrt{v_{ar}}\right)$. The standard
writes it as a case split, not a `max()`; they are identical.

| Symbol | Meaning | Units |
|---|---|---|
| $h_c$ | convective heat transfer coefficient | $\mathrm{W\,m^{-2}K^{-1}}$ |
| $t_{cl}$ | clothing surface temperature | $^\circ\mathrm{C}$ |
| $t_a$ | air temperature | $^\circ\mathrm{C}$ |
| $v_{ar}$ | **relative** air velocity | $\mathrm{m\,s^{-1}}$ |

**Validity of the whole PMV equation** (ISO 7730:2005 §4.1, verbatim): $M$ 46–232 W/m² (0.8–4 met);
$I_{cl}$ 0–0.310 m²K/W (0–2 clo); $t_a$ 10–30 °C; $t_r$ 10–40 °C; **$v_{ar}$ 0–1 m/s**;
$p_a$ 0–2700 Pa.

> ⚠️ **$t_a \ge 10\ ^\circ\mathrm{C}$ and $I_{cl} \le 2$ clo.** PMV is **not valid** for this library's
> domain. It is listed here only so its coefficients are not accidentally borrowed into a cold model.

- **Source:** ISO 7730:2005 preview PDF (standard text) , 
  https://cdn.standards.iteh.ai/samples/39155/9632a0563ca742209edb45856ff69296/ISO-7730-2005.pdf ·
  ISO 7730:1994 preview (same equations) , 
  https://cdn.standards.iteh.ai/samples/14567/8b424422c77b49239f1c385829105f0c/ISO-7730-1994.pdf ·
  ANSI/ASHRAE 55-2023 normative appendix PMV source listing (`hcf = 12.1*sqrt(vel)`, `hcn = 2.38*...`) ·
  `pythermalcomfort` `models/_pmv_ppd_optimized.py` · CBE Comfort Tool `comfort-models.js`.
- **Confidence:** `verified`, **four independent sources including two editions of the standard's own text.**

> ℹ️ **ISO 7730:2005 has been superseded by ISO 7730:2025** (4th ed., approved 2025-09-05). Its
> foreword lists "correction of the calculation program" among the changes. The $12.1$/$2.38$ branch
> appears unchanged; what moved is the **initial guess for $t_{cl}$**, from
> $t_a + (35.5 - t_a)/(3.5\,I_{cl} + 0.1)$ to $t_a + (35.5 - t_a)/\left(3.5(6.45\,I_{cl} + 0.1)\right)$.
> `single-source` (inferred from a code comment in `pythermalcomfort`, not read from the 2025 text , 
> that preview is front matter only). Source: https://cdn.standards.iteh.ai/samples/iso/iso-7730-2025/a4c38a45994e4e4c864139ae1b566e00/iso-7730-2025.pdf

### 5.2 Where $8.3\,v^{0.6}$ actually comes from: **Mitchell (1974), not ISO**

| Branch | Range | Attribution |
|---|---|---|
| $h_c = 3.1\ \mathrm{W\,m^{-2}K^{-1}}$ | $v < 0.2\ \mathrm{m\,s^{-1}}$ | Mitchell et al., 1974 |
| $h_c = 8.3\,v^{0.6}$ | $\mathbf{0.2 < v < 4\ m\,s^{-1}}$ | Mitchell, 1974 |

**Crossover is at $v = 0.2\ \mathrm{m\,s^{-1}}$ and the upper bound is 4.0 m/s.** The user's
remembered "$0.1 \le v < 1$" bounds are **`UNVERIFIED`: no source found uses them for this pair.**

These are the ASHRAE Handbook of Fundamentals values, "selected as appropriate for **motionless
subjects in moving air**": i.e. the seated/standing-still case, which is why they are lower than
ISO 7730's.

> ⚠️ **Two traps.**
> 1. **$8.3\,v^{0.6}$ (Mitchell) and $8.3\,v^{0.5}$ (Kerslake 1972 / McIntyre 1980) are different
>    equations that share a leading coefficient.** Don't conflate them.
> 2. **ISO 7726 does NOT contain this pair.** Its only convection coefficients are for the black
>    globe thermometer (Annex B): $h_{cg} = 1.4(\Delta T/D)^{0.25}$ natural and
>    $h_{cg} = 6.3\,v_a^{0.6}/D^{0.4}$ forced, $D$ = globe diameter in m. Nothing about the human body.

- **Source:** DTU Orbit, *Convective Heat Transfer Coefficients of the Human Body* (literature review,
  reproduces the table verbatim) , 
  https://backend.orbit.dtu.dk/ws/files/101972573/Convective_Heat_Transfer_Coefficients.pdf ·
  de Dear, Arens, Hui & Oguro (1997), peer-reviewed, for the ASHRAE attribution , 
  https://escholarship.org/content/qt9hn3s947/qt9hn3s947.pdf ·
  ISO 7726:1998 full text for the negative result, https://www.ntm.ru/UserFiles/File/document/Microklimat/Norm/ISO7726_1998.pdf
- **Confidence:** `verified` for the coefficients, ranges and the Mitchell attribution (two
  independent sources). `verified` (negative) that ISO 7726 does not contain them.

**Other published whole-body $h_c$ correlations** (de Dear 1997, peer-reviewed, `single-source` each):
general-purpose indoor forced convection, either posture, $0.2 < v < 0.8$: $h_c = 10.3\,v^{0.6}$;
whole-body **natural** convection in still air ($v < 0.10$): **3.3** (seated) / **3.4** (standing)
$\mathrm{W\,m^{-2}K^{-1}}$; Ichihara 1995 standing manikin $15.4\,v^{0.63}$; Seppänen 1972 standing
$14.8\,v^{0.69}$; Gagge 2-node walking $8.6\sqrt{v}$.

### 5.3 ISO 7933 / ISO 9920: the third pair, and the real crossover

$$h_c = \max\!\left(2.38\,\lvert \Delta t\rvert^{0.25},\; z\right),\qquad z = \begin{cases}3.5 + 5.2\,v_{ar} & v_{ar} \le 1\\ 8.7\,v_{ar}^{0.6} & v_{ar} > 1\end{cases}$$

**Note 8.7, not 8.3.** The two branches **meet exactly at $v_{ar} = 1\ \mathrm{m\,s^{-1}}$**:
$3.5 + 5.2(1) = 8.7$ and $8.7(1)^{0.6} = 8.7$ (verified by direct computation). *This* is the
crossover the user was reaching for.

**Comparison at $v_{ar} = 1\ \mathrm{m\,s^{-1}}$:** ISO 7730 → **12.1**; ISO 7933/9920 → **8.7**;
Mitchell/ASHRAE seated → **8.3** $\mathrm{W\,m^{-2}K^{-1}}$. **ISO 7730's PMV coefficient is ~40 %
higher than ISO 7933's.** They are not interchangeable: use the one belonging to the model you are
implementing.

- **Source:** **ISO 9920:2007 standard text**, Eqs. (23)–(25) ("the greatest value from the following":
  $2.38\lvert t_{sk}-t_a\rvert^{0.25}$, $3.5 + 5.2\,v_{ar}$, $8.7\,v_{ar}^{0.6}$) , 
  https://www.sis.se/api/document/preview/908708/ · `pythermalcomfort` `models/phs.py` ·
  CBE Comfort Tool `comfort-models.js`.
- **Confidence:** `verified`, the ISO 9920 standard text was read directly, and two independent
  implementations agree. (The ISO 7933 standard text itself was not obtained; both the 2004 and
  2023 previews truncate before the relevant annex.)

### 5.4 ISO 11079 uses none of these

**Reminder (see §1.6):** ISO 11079 derives $h_c = 1/I_{a,r} - h_r$ from the dynamic boundary-layer
insulation. **Do not substitute an ISO 7730 or ASHRAE $h_c$ into an IREQ implementation**: you will
double-count the wind.

### 5.5 $h_r$ linearisation: ✅ formula confirmed, ❌ "4.7 at 20 °C" is a different thing

$$h_r = 4\,\varepsilon\,\sigma\,\frac{A_r}{A_D}\left[273.2 + \frac{t_{cl} + \overline{t}_r}{2}\right]^3$$

| Symbol | Value | Units |
|---|---|---|
| $\varepsilon$ | **0.95** (average body surface emissivity) | - |
| $\sigma$ | **$5.67\times10^{-8}$** | $\mathrm{W\,m^{-2}K^{-4}}$ |
| $A_r/A_D$ | **0.70 seated, 0.73 standing** (Fanger 1970): ISO 9920 adds **0.67 crouching, 0.77 standing** | - |
| $t_{cl}$, $\overline{t}_r$ | mean clothed-surface and mean radiant temperature | $^\circ\mathrm{C}$ |

**All four of the user's values ($\varepsilon=0.95$, $\sigma$, 0.70/0.73, the $T^3$ form) are
confirmed verbatim** from de Dear et al. 1997 (attributing to ASHRAE HoF 1993), and independently
from `pythermalcomfort` `models/two_nodes_gagge.py` and the CBE Comfort Tool, which implement it
byte-identically with the comment "0.95 is the clothing emissivity from ASHRAE fundamentals Ch. 9.7 Eq. 35".

> 🔴 **But $h_r \approx 4.7\ \mathrm{W\,m^{-2}K^{-1}}$ at 20 °C does NOT follow from this formula.**
> Computed independently, twice, during this research:
>
> | Mean temp | seated (0.95, 0.70) | standing (0.95, 0.73) | ISO 11079 (0.95, 0.77) |
> |---|---|---|---|
> | 20 °C | **3.80** | **3.96** | **4.18** |
> | 0 °C | 3.07 | 3.21 | 3.38 |
> | −20 °C | 2.45 | 2.55 | 2.69 |
>
> To reach 4.7 at a 20 °C mean you would need $\varepsilon\,(A_r/A_D) = 0.822$, or a mean temperature
> of **41.5 °C**. Neither is physical here.
>
> **What 4.7 actually is:** a separately-established *empirical whole-body constant*, not an output of
> the linearisation. de Dear, verbatim: "explicit solutions for $h_r$ are rarely obtained for clothed
> subjects due to the difficulties in measuring $t_{cl}$. Therefore **the value $h_r = 4.7\ \mathrm{W/m^2}$
> per K has been widely accepted as a reasonable whole-body estimate for general purposes (ASHRAE 1993)**."
> His own manikin measurement gave **4.5** for both postures. This is why `pythermalcomfort` and CBE
> both *seed* `h_r = 4.7` as an initial guess before iterating to the formula value.
>
> **Ship the formula, not the constant.** $h_r$ falls ~35 % from 20 °C to −20 °C; a hard-coded 4.7
> would **overestimate radiant loss by ~75 % at −20 °C**: a large error in exactly this library's domain.

**Related: Fanger's $3.96\times10^{-8}$.** ISO 7730:2005 Eqs. (1)/(2) carry a radiation term
$3.96\times10^{-8}\,f_{cl}\left[(t_{cl}+273)^4 - (t_r+273)^4\right]$. Arithmetically
$5.67\times10^{-8}\times 0.97 \times 0.72 = 3.9599\times10^{-8}$, i.e. $\varepsilon = 0.97$ with
$f_{eff} = 0.72$. The **0.72** is confirmed (EnergyPlus Engineering Reference: "$f_{eff}$ – The
fraction of surface effective for radiation ( = 0.72)" , 
https://bigladdersoftware.com/epx/docs/8-7/engineering-reference/occupant-thermal-comfort.html).
The $\varepsilon = 0.97$ half is an **arithmetic inference, `UNVERIFIED`** from a primary source.

- **Confidence:** `verified` for the formula and all four constants (peer-reviewed source + two
  independent implementations). **`UNVERIFIED: do not ship`** for "$h_r = 4.7$ follows from the
  formula"; `verified` that 4.7 exists as a separate conventional constant.

---

## 6. Operative temperature and night-sky radiant cooling

> **This is the section where the library most differs from indoor thermal comfort.** A forecast
> gives air temperature. A person lying in the open on a clear night experiences an **operative
> temperature roughly 5–6 K below it**, and that penalty **largely disappears under overcast or
> a forest canopy**. Everything below quantifies that.

### 6.1 Operative temperature: ✅ the user's form is correct, but no standard prints it

$$t_o = \frac{h_c\,t_a + h_r\,t_r}{h_c + h_r}$$

**Equivalently, and this is the form the standards actually publish:**

$$t_o = A\,t_a + (1-A)\,t_r, \qquad A = \frac{h_c}{h_c + h_r}$$

| Symbol | Meaning | Units |
|---|---|---|
| $t_o$ | operative temperature | $^\circ\mathrm{C}$ |
| $t_a$ | air temperature | $^\circ\mathrm{C}$ |
| $t_r$ | mean radiant temperature | $^\circ\mathrm{C}$ |
| $h_c$, $h_r$ | convective / radiative heat transfer coefficients | $\mathrm{W\,m^{-2}K^{-1}}$ |
| $A$ | weighting factor | - |

The two forms are algebraically identical: substitute $A = h_c/(h_c+h_r)$ and expand.

> ⚠️ **Correction:** **ASHRAE 55-2023 does not print the $h_c$/$h_r$ equation anywhere.** It gives
> only the $A$-form and defers to *ASHRAE Handbook, Fundamentals* Ch. 9. Cite ISO 7730 or the
> Handbook for the $h$-form, not Standard 55.

**ASHRAE 55-2023 Normative Appendix A §A1, verbatim:** "Operative temperature $t_o$ is permitted to
be calculated per the following formula: $t_o = A\,t_a + (1-A)\,t_r$ … $A$ can be selected from the
following values as a function of the average air speed $V_a$."

| $V_a$ | < 0.2 m/s | 0.2–0.6 m/s | 0.6–1.0 m/s |
|---|---|---|---|
| **$A$** | **0.5** | **0.6** | **0.7** |

**ISO 7730 publishes the identical table.** So **$t_o \approx (t_a + t_r)/2$ is exactly the $A=0.5$
row, valid for $V_a < 0.2\ \mathrm{m\,s^{-1}}$**: plus, per ISO 7730, a second condition: "small
difference of temperature $|t_a - t_r|$".

> ⚠️ **Both conditions are violated in this library's use case.** Outdoors on a clear night
> $|t_a - t_r|$ is 5–12 K, not small, and wind often exceeds 0.2 m/s. Use the $A$-table against
> actual wind rather than defaulting to the midpoint, and flag that the standards' own validity
> caveat is being stretched.

**Definitions, verbatim:**
- ASHRAE 55-2023 §3: "**temperature, operative ($t_o$):** the uniform temperature of an imaginary
  black enclosure, and the air within it, in which an occupant would exchange the same amount of
  heat by radiation plus convection as in the actual non-uniform environment."
- ISO 7730:2005 §3.4: "**operative temperature** $t_o$, uniform temperature of an imaginary black
  enclosure in which an occupant would exchange the same amount of heat by radiation and convection
  as in the actual non-uniform environment."

- **Source:** ANSI/ASHRAE 55-2023 (primary standard text) , 
  https://smartairdefense.com/wp-content/uploads/2025/10/ASHRAE-Standard-55.pdf ·
  ISO 7730:2005 official preview (primary) , 
  https://cdn.standards.iteh.ai/samples/39155/9632a0563ca742209edb45856ff69296/ISO-7730-2005.pdf ·
  Kazkaz & Pavelek, *Engineering MECHANICS* 20(3/4):319–325 (2013), §3, citing ČSN EN ISO 7730
  (peer-reviewed, gives the $A \leftrightarrow h$ link explicitly) , 
  https://www.engineeringmechanics.cz/pdf/20_3_319.pdf · Olesen (ASHRAE Journal, AIVC #7416) , 
  https://www.aivc.org/sites/default/files/airbase_7416.pdf
- **Confidence:** `verified` (three independent sources, two of them primary standard text).

> ℹ️ **ISO 7726 Annex G** is titled "Measurement of operative temperature" (confirmed in the TOC of
> both the ntm.ru copy and the SIS preview). **Its body text could not be obtained**: every free
> copy stops at p. 15 of 49. (This was checked directly here: the ntm.ru PDF truncates after
> Annex B.) The widely-repeated closed form $A = k\sqrt{v_a}/(1+k\sqrt{v_a})$ appeared only in
> search-engine summaries → **`UNVERIFIED`**. The *numeric* $A$ table is solid regardless.

**Sanity anchor (computed here):** $4\sigma T^3 = 4.62 / 5.15 / 5.71\ \mathrm{W\,m^{-2}K^{-1}}$ at
$T = 0/10/20\ ^\circ\mathrm{C}$. So $A = 0.5$ implies $h_c \approx 5\ \mathrm{W\,m^{-2}K^{-1}}$,
i.e. genuinely still air.

### 6.2 Clear-sky emissivity models

All of these define $\varepsilon_{sky} = L^\downarrow/(\sigma T_a^4)$ and $T_{sky} = \varepsilon_{sky}^{0.25}\,T_a$.

| Model | Formula | Input units | Confidence |
|---|---|---|---|
| **Swinbank (1963)** | $\varepsilon = 9.365\times10^{-6}\,T_a^{2}$ | $T_a$ in **K** | `verified` (2 sources) |
| **Brunt (1932)** | $\varepsilon = 0.52 + 0.065\sqrt{P_w}$ | $P_w$ in **hPa** | `verified` (3 sources) |
| **Idso & Jackson (1969)** | $\varepsilon = 1 - 0.261\exp\!\left[-7.77\times10^{-4}(273-T_a)^2\right]$ | $T_a$ in **K** | `verified` (2 sources) |
| **Berdahl & Fromberg (1982)** | $\varepsilon = 0.727 + 0.0060\,T_{dp}$ (24 h); $0.741 + 0.0062\,T_{dp}$ (**night**) | $T_{dp}$ in **°C** | `verified` (2 sources) |
| **Berdahl & Martin (1984)** | $\varepsilon = 0.711 + 0.56\left(\tfrac{T_{dp}}{100}\right) + 0.73\left(\tfrac{T_{dp}}{100}\right)^2$ | $T_{dp}$ in **°C** | `verified` (3 sources) |
| **Clark & Allen (1978)** | $\varepsilon = 0.787 + 0.7641\ln\!\left(\tfrac{T_{dp}}{273}\right)$ | $T_{dp}$ in **K** | `verified` (2 sources) |
| **Brutsaert (1975)** | $\varepsilon = 1.24\left(P_w/T_a\right)^{1/7}$ | $P_w$ hPa, $T_a$ K | `single-source` |

- **Source:** Li, Jiang & Coimbra (2017), *Solar Energy* **144**:40–48, **Table 5** (peer-reviewed;
  gives all seven with units and original coefficients) , 
  https://www.li-realab.info/publication/radiative-model/li-2017/li-2017.pdf ·
  cross-checked against Bachour et al., EuroSun 2022 Eqs. 3–6 , 
  https://proceedings.ises.org/conference/eurosun2022/papers/eurosun2022-0157-Bachour.pdf ·
  Zhang, McDowell & Kummert, IBPSA BS2017: https://publications.ibpsa.org/proceedings/bs/2017/papers/BS2017_569.pdf ·
  Yang & Quan, *Atmos. Chem. Phys.* **23**:4419 (2023), Table 2, https://acp.copernicus.org/articles/23/4419/2023/acp-23-4419-2023.pdf

> 🔴 **TRAP: a published typo you will otherwise inherit.** IBPSA BS2017 Eq. (4) prints Swinbank as
> $\varepsilon = 5.31\times10^{-13}T_a^2$. **That is wrong.** $5.31\times10^{-13}$ is the coefficient
> of Swinbank's *irradiance* law $L^\downarrow = 5.31\times10^{-13}T_a^6$ (W/m²). Dividing by
> $\sigma T_a^4$: $5.31\times10^{-13}/5.67\times10^{-8} = 9.3651\times10^{-6}$, **verified by direct
> computation here**, and matching Li et al. Table 5 and Bachour Eq. 3.

**The user's $T_{sky} = 0.0552\,T_a^{1.5}$: `verified` as a mathematical identity.** From
$\varepsilon = 9.365\times10^{-6}T_a^2$: $T_{sky} = \varepsilon^{0.25}T_a = (9.365\times10^{-6})^{0.25}T_a^{1.5}
= \mathbf{0.05532}\,T_a^{1.5}$ (computed here). The 0.0552 variant differs only by $\sigma$ rounding , 
they agree to 0.2 %.

### 6.3 Berdahl & Martin in full: from the primary paper

Berdahl & Martin, "Emissivity of clear skies", *Solar Energy* **32**(5):663–664, 1984
(doi 10.1016/0038-092X(84)90144-0); preprint LBL-15367 recovered at
https://escholarship.org/content/qt3d17x714/qt3d17x714.pdf, **peer-reviewed primary source**.

- **Eq. (2)** is "a value for the **24-hour average** of the total sky emissivity for clear skies."
- **Validity, verbatim:** "The range of monthly average values of $T_{dp}$ was **[−13, 24] °C**;
  Eq. (2) probably has useful predictive capability over the range **[−20, 30] °C**."
- **Diurnal correction, Eq. (3):** $\Delta\varepsilon = 0.013\cos(2\pi t/24)$, $t$ = solar time in
  hours: "The coefficient 0.013 was chosen to produce the observed average **day/night difference
  of 0.016**", with "the larger values observed at night". ⇒ **add ≈ +0.013 at local midnight.**
- **Elevation correction:** $\Delta\varepsilon = 0.00012(P - 1000)$, $P$ in mbar. `single-source`.
- **Accuracy, verbatim:** "The root mean square deviation of the monthly values from the fit is
  **0.018**"; systematic deviations "**less than or equal to 0.02** at midlatitude sites below an
  elevation of 1 km."
- **Dataset:** 57 site-months, 6 US cities, **30 835** half-hourly clear-sky observations.
- **Brunt-form equivalent, Eq. (7):** $\varepsilon = 0.564 + 0.059\sqrt{e}$ ($e$ in mb), "differing
  from Eq. (2) by no more than **0.003**, a negligible difference."

### 6.4 ⭐ Recommended model for this library

Li, Jiang & Coimbra (2017) recalibrated 15 models against **7 NOAA SURFRAD stations**:

$$\boxed{\;\varepsilon_{sky,c} = 0.633 + 0.057\sqrt{P_w}\;}\qquad \text{(nighttime clear sky, } P_w \text{ in hPa)}$$

(Daytime: $0.598 + 0.057\sqrt{P_w}$; all-day: $0.618 + 0.056\sqrt{P_w}$, MBE 0.94 W/m²,
RMSE 13.24 W/m², rRMSE **4.37 %**.)

Verbatim: "on average, the **nighttime emissivity is around 0.035 higher than the daytime** values
under the same ground-level partial pressure of water vapor. This behavior is related to the
formation of inversion layers during clear nights."

And, bluntly: "**The Swinbank, Idso and Jackson and Ruckstuhl models have errors around twice of
that of other models, indicating that these three formulas are not recommended for future use.**"
Original-coefficient rRMSE on US data: Brunt 10.64 %, Swinbank 10.00 %, Idso & Jackson 10.07 % →
recalibrated Brunt **4.37 %**.

> **Use the nighttime form above.** It is the most accurate, the simplest (one input, two
> coefficients), and the only one explicitly fitted to night. Keep Berdahl & Martin as the
> dew-point-input alternative.

**Climate caveat** (`verified`, Bachour et al. EuroSun 2022, two desert sites in Qatar): Idso (1981)
was best there (rRMSE 3.7–4.0 %), Swinbank biased low (−8 to −9 %), Brunt biased high (+8 to +10 %).
Ranking is climate-dependent; **Swinbank is consistently the worst of the common choices.**

- **Confidence:** `verified` (peer-reviewed, 7-station recalibration, plus an independent
  desert-climate validation study).

### 6.5 How far below air temperature?: clear sky

**Computed here** from Berdahl & Martin Eq. (2) + the 0.013 night correction, with
$\Delta T = T_a(1 - \varepsilon^{0.25})$:

| $t_a$ (°C) | $T_{dp}$ (°C) | $\varepsilon$ (B&M, night) | $\Delta T = t_a - t_{sky}$ (K) | via Clark–Allen (K) | $L^\downarrow$ (W/m²) |
|---|---|---|---|---|---|
| 30 | 25 (humid) | 0.910 | **7.1** | 11.7 | 436 |
| 20 | 15 | 0.824 | **13.8** | 13.5 | 345 |
| 10 | 5 | 0.754 | **19.3** | 15.3 | 275 |
| 10 | −5 (dry) | 0.698 | **24.4** | 17.7 | 254 |
| 0 | −5 | 0.698 | **23.5** | 17.0 | 220 |
| 0 | −15 (very dry) | 0.656 | **27.3** | 19.5 | 207 |
| −5 | −10 | 0.675 | **25.1** | 17.9 | 198 |

Swinbank independently (recomputed here): **23.4 / 19.6 / 15.5 K** at $t_a = 0/10/20\ ^\circ\mathrm{C}$ , 
within ~1 K of the B&M column at 0 °C. **Three independent models converge on roughly 14–27 K for
ordinary clear nights**, humidity being the dominant control.

**Measured corroboration:**

| Value | Context | Source | Confidence |
|---|---|---|---|
| $t_a - t_{sky}$ = **18 / 24 / 33 K** at $t_a$ = +30/0/−20 °C clear; **0 K** cloudy. $L^\downarrow$ = 377/214/132 clear, 477/314/232 cloudy W/m² | Expected pyrgeometer output, whole-sky | Hukseflux IR20 manual §2.4 Table 2.4.1, hosted by NOAA PSL: https://psl.noaa.gov/data/obs/instruments/HuksefluxIR20_manual_v2006.pdf | `single-source` (instrument manual, round numbers; implies the dry end) |
| **8–15 K** clear (May), **≈3–6 K** cloudy (Aug) | Measured, Western Maharashtra, 40 nights | https://pmc.ncbi.nlm.nih.gov/articles/PMC6777208/ | `verified` (peer-reviewed) |
| $T_{sky}$ at zenith "mostly lies **25–50 Kelvin** below the ambient temperature near the ground" | Cerro Paranal / Armazones, Atacama, 2600–3060 m (extreme dry, high altitude | Holzlöhner et al. (2020), *A&A*, arXiv:2010.01978) https://arxiv.org/pdf/2010.01978 | `verified` (peer-reviewed) |
| **−80 W/m²** typical net longwave on a radiation-frost night; range **−95 (clear) to −10 (overcast)** | Agricultural frost | FAO *Frost Protection* Vol. 1 (Snyder & de Melo-Abreu 2005), p. 62: https://www.fao.org/4/y7223e/y7223e00.pdf | `single-source`, authoritative. (−80 W/m² at 273 K ⇒ $T_{sky}$ ≈ 254 K ⇒ **≈19 K**, inside the model range) |

> 🔴 **Reject this number.** The widely-repeated claim that "a clear night sky has an effective
> temperature of about −70 °C" is **`UNVERIFIED` and inconsistent with every pyrgeometer measurement
> above.** It is at best a brightness temperature *inside the 8–13 µm atmospheric window*, not the
> broadband value that drives a fabric's energy balance. **Broadband clear-sky depression is
> 15–27 K, not 90 K.**

### 6.6 Cloud cover

Two formulations that are algebraically identical:

**Martin & Berdahl (1984):**
$$\varepsilon_{sky} = \varepsilon_{clear} + \left(1 - \varepsilon_{clear}\right)C, \qquad C = n\,\varepsilon_c\,\Gamma,\quad \Gamma = e^{-h/h_0},\ h_0 = 8.2\ \mathrm{km}$$
Simplified: $\varepsilon_{thin} = 0.4$ at $h = 8$ km, $\varepsilon_{opaque} = 1.0$ at $h = 2$ km;
**if all cloud is opaque, $C = 0.784\,n_{opaque}$.** (TRNSYS uses 0.9; "The origin of the 0.9 factor
is unclear.")

**Crawford & Duchon (1999):**
$$L^\downarrow = L^\downarrow_{clear}(1 - CF) + CF\,\sigma T_a^4 \;\Longleftrightarrow\; \varepsilon_{sky} = \varepsilon_{clear} + CF\left(1 - \varepsilon_{clear}\right)$$

**Clark & Allen / EnergyPlus:**
$$\varepsilon_{sky} = \varepsilon_{clear}\left(1 + 0.0224N - 0.0035N^2 + 0.00028N^3\right),\quad N = \text{opaque sky cover in tenths}$$

> ⚠️ At $N = 10$ the EnergyPlus factor is only **1.154** (+15.4 %): **notably weaker** than the
> Martin–Berdahl / Crawford–Duchon form. This is a real, unresolved discrepancy between two
> mainstream building-simulation codes. `verified` that both are published; **unresolved** which is right.

**Depression vs cloud** (computed from Martin–Berdahl $C = 0.784\,n_{opaque}$, $t_a = 10\ ^\circ\mathrm{C}$):

| $\varepsilon_{clear}$ | $n_{opaque} = 0$ | 0.5 | 1.0 (full overcast) |
|---|---|---|---|
| 0.70 (dry) | **24.2 K** | 13.9 K | **4.7 K** |
| 0.75 | **19.6 K** | 11.4 K | **3.9 K** |
| 0.80 | **15.4 K** | 9.0 K | **3.1 K** |
| 0.85 (humid) | **11.3 K** | 6.7 K | **2.3 K** |

**Measured corroboration (3 independent):** net longwave **≈−100 W/m² clear vs ≈0 W/m² cloudy**
(Hukseflux §2.4, verbatim); FAO **−95 clear to −10 overcast W/m²**; measured sky–ambient difference
**8–15 K clear vs ≈3–6 K cloudy** (PMC6777208).

> **Bottom line:** full opaque overcast removes **~80–85 %** of the clear-sky radiant penalty,
> leaving ~2–5 K. "Clouds cancel it" is close enough for a go/no-go model. **Cloud base height
> matters**: high thin cirrus ($\varepsilon \approx 0.4$ at 8 km) does much less than low stratus at 2 km.

- **Source:** IBPSA BS2017 Eqs. (11)–(21); Li et al. (2017) Eq. (23); EnergyPlus Engineering
  Reference: https://bigladdersoftware.com/epx/docs/22-2/engineering-reference/climate-calculations.html
- **Confidence:** `verified` for all three formulations (two independent sources each).

### 6.7 Mean radiant temperature for a *person* from sky + ground

**Six-direction method** (SOLWEIG / VDI 3787 Part 2 / Höppe 1992 / Fanger 1970):

$$S_{str} = \alpha_k\sum_{i=1}^{6}F_i K_i + \varepsilon_p\sum_{i=1}^{6}F_i L_i, \qquad T_{mrt} = \left(\frac{S_{str}}{\varepsilon_p\sigma}\right)^{0.25} - 273.15$$

with $\alpha_k = 0.7$ (shortwave absorptivity), $\varepsilon_p = 0.97$ (clothed body longwave
emissivity; skin 0.99, clothing 0.95).

**Published angular weighting factors** (Kántor & Unger 2011, Table 4; confirmed verbatim by
Lindberg et al. 2016: "angular factors (F) … set to 0.22 for east, west, north and south, and 0.06
for radiation fluxes from above and below (Fanger 1970)"):

| Shape | E | S | W | N | **up** | **down** |
|---|---|---|---|---|---|---|
| **standing person** | 0.220 | 0.220 | 0.220 | 0.220 | **0.060** | **0.060** |
| **seated person** | 0.185 | 0.185 | 0.185 | 0.185 | **0.130** | **0.130** |
| **globe (sphere)** | 0.167 | 0.167 | 0.167 | 0.167 | **0.167** | **0.167** |

**Effective radiation area factor**: ASHRAE 55-2023 Normative Appendix C, verbatim: "$f_{eff}$ is
the fraction of the body surface exposed to radiation from the environment (= **0.696 for a seated
person** and **0.725 for a standing or horizontal person**)". Note ASHRAE explicitly treats
**horizontal ≡ standing** for $f_{eff}$.

> 🔴 **GAP: no published angular factors exist for a supine person.** ISO 7726, VDI 3787 Part 2,
> Fanger-1970 derivatives, Höppe 1992, Thorsson 2007, SOLWEIG, RayMan, PALM and the Kántor & Unger
> review were all searched: **every published table stops at standing / seated / sphere.**
> **`UNVERIFIED: does not exist in the reachable literature.`**

What *is* defensible:
- The macro-scale simplification is published: "a limitation to **two angle factors, each of value
  0.5**" for "the lower hemisphere (ground) and an upper hemisphere (sky) only": Di Napoli et al.,
  *Int. J. Biometeorol.* (2020), https://pmc.ncbi.nlm.nih.gov/articles/PMC7295834/ (`single-source`).
- **Derived here, and worth knowing:** for a person in **open, level terrain**,
  $F_{sky} = F_{ground} = 0.5$ by the half-space argument. Remarkably, the *standing* factors give
  the same answer, because the four lateral directions each see half sky and half ground:
  $0.06 + 0.88\times0.5 = 0.50$ exactly (computed here). **So in open flat terrain, posture barely
  matters and $F_{sky} = 0.5$ is safe.** Posture only starts to matter under partial obstruction
  (canopy, tent, cliff), where sky is removed preferentially from *overhead*: which penalises a
  lying person more than a standing one.

### 6.8 ⭐ Putting it together: the headline number

$$T_{mrt} = \left(0.5\,T_{sky}^4 + 0.5\,T_{ground}^4\right)^{0.25}$$

Computed here, ground at air temperature, $t_a = 10\ ^\circ\mathrm{C}$, still air ($A = 0.5$):

| Sky | $\varepsilon_{sky}$ | $t_{sky}$ (°C) | $T_{mrt}$ (°C) | $T_{mrt} - t_a$ | $t_o$ (°C) | $t_o - t_a$ | net LW from body |
|---|---|---|---|---|---|---|---|
| Clear, dry | 0.70 | −14.2 | −1.3 | **−11.3 K** | 4.4 | **−5.6 K** | 53 W/m² |
| Clear, moderate | 0.75 | −9.7 | +0.7 | **−9.3 K** | 5.4 | **−4.7 K** | 44 W/m² |
| Clear, humid | 0.85 | −1.3 | +4.5 | **−5.5 K** | 7.3 | **−2.7 K** | 27 W/m² |
| Overcast | 0.98 | +8.6 | +9.3 | **−0.7 K** | 9.6 | **−0.4 K** | 3.5 W/m² |

> ⭐ **A clear night costs a person lying in the open roughly 5–6 K of operative temperature versus
> the air temperature the forecast reports, and roughly 4–5 K versus the same night overcast.**

**Measured corroboration: and it is a good one.** Phoenix tent campaign, black-globe $T_{mrt}$ at
1 m, 204 nighttime observations, 8–11 Sep 2023:

| Location | Night $T_{mrt}$ (°C) | Night $T_{air}$ (°C) | $T_{mrt} - T_{air}$ |
|---|---|---|---|
| **Ambient, open sky** | 28.1–29.1 | 33.5–34.2 | **≈ −5.3 K** |
| Inside plain uncovered tent | 32.6–33.4 | 32.6–33.3 | **≈ 0 K** |
| Inside mylar-covered tent | 34.7–35.4 | 33.0–33.7 | **≈ +1.7 K** |
| Inside foil-covered tent | ≈35.6–36.2 | ≈33.2–33.9 | **≈ +2.3 K** |

Verbatim: "during the nighttime, the mean ambient MRT was significantly lower compared to all the
tents"; "at nighttime, the shade prevents radiative cooling."
Karanja et al., *Int. J. Biometeorol.* (2024), doi 10.1007/s00484-024-02751-0, accepted MS , 
https://par.nsf.gov/servlets/purl/10558537 (peer-reviewed).

**The measured −5.3 K in warm, humid-ish Phoenix matches the derived −5.5 K for
$\varepsilon_{sky} = 0.85$ almost exactly**: an independent check of the whole chain (sky emissivity
→ $T_{sky}$ → half-sky view factor → $T_{mrt}$). **Caveat:** a small globe is convectively coupled,
so globe-derived $T_{mrt}$ **understates** the true radiant depression. Treat −5.3 K as a lower bound.

- **Confidence:** `verified` for the method and the measured corroboration; the specific table is
  **derived here** from verified inputs: reproducible, not quoted.

**Useful mechanism formula** (Holzlöhner et al. 2020, peer-reviewed): why wind kills the effect:

$$h_{rad} = 4T_0^3\sigma\,\varepsilon\,F_{sky} \approx 4.9\,\varepsilon F_{sky}\ \mathrm{W\,m^{-2}K^{-1}},\qquad \Delta T_{surf} = \frac{\eta}{1+\eta}\Delta T_D,\quad \eta = \frac{h_{rad}}{h_c}$$

"In the opposite limit of $\eta \to \infty$, we obtain $\Delta T_{surf} \to \Delta T_{sky}$."
**The $\eta/(1+\eta)$ factor is the key: wind (large $h_c$) collapses the surface depression toward zero.**

### 6.9 Forest canopy

**Measured net longwave, clear winter nights, Austrian Alps (~1900 m, snow surface):**

| | Open field | Clearing (density 0.2) | Forest (density 0.6) |
|---|---|---|---|
| Nighttime net radiation (= net longwave) | **−65 W/m²** | **−56 W/m²** | **−34 W/m²** |

Verbatim: "the longwave balance in the forest (A3) was about **30 W m⁻² higher** than in the open
field"; "the outgoing longwave radiation in the open field is only **6–11 W m⁻²** lower than in the
forest", while "the incoming longwave radiation in the forest is significantly higher (about
**17–50 W m⁻²**)". **The canopy effect is almost entirely on $L^\downarrow$, not $L^\uparrow$.**
- Höller (2001), *Annals of Glaciology* **32**:217–222 (peer-reviewed) , 
https://www.cambridge.org/core/journals/annals-of-glaciology/article/influence-of-the-forest-on-nighttime-snow-surface-temperature/2FB76C300B042CCB44D16A00921F9B23

**Canopy radiates at ≈ air temperature at night**: `verified` (3 sources): "At night, average needle
temperatures were **0.4 °C cooler** than air temperatures" (Musselman & Pomeroy 2017,
*J. Hydrometeorol.* **18**:555, https://research-groups.usask.ca/hydrology/documents/pubs/marmot/musselman_pomeroy_2017.pdf);
Essery et al. (2008) and Rutter et al. (2023) both use air temperature as the canopy radiative proxy.

**Sky-view-factor partition** (Roth & Nolin 2017, *HESS* **21**:5427, Eq. 7 , 
https://hess.copernicus.org/articles/21/5427/2017/hess-21-5427-2017.pdf):

$$L^\downarrow = \mathrm{SVF}\cdot\varepsilon_{sky}\sigma T_{air}^4 + \left(1 - \mathrm{SVF}\right)\varepsilon_{canopy}\sigma T_C^4$$

> ⚠️ That paper assumes $T_C = T_{air} + 4\ \mathrm{K}$, a **daytime-weighted** figure. **For night
> use $T_C \approx T_a - 0.4\ \mathrm{K}$.**

Emissivities: leaf 8–14 µm **0.958 ± 0.002**; literature range 0.938–0.985; model canopy
$\varepsilon_v$ 0.975–0.983 at LAI ≈ 3.7 (Todt et al. 2019, *The Cryosphere* **13**:3077 , 
https://tc.copernicus.org/articles/13/3077/2019/tc-13-3077-2019.pdf), with
$\varepsilon_v = 1 - e^{-(\mathrm{LAI+SAI})}$. Measured below/above-canopy $L^\downarrow$ enhancement
ratio **1.0 to >1.6**, "higher under clear skies but close to 1 or even smaller for overcast".

**Frost protection by canopy: excellent dataset, `verified`:** "The average difference in minimum
air temperature between the forest and clearcut opening was **nearly 3 °C**… and **during clear night
sky conditions, this temperature difference approached 6 °C**"; "during **cloudy** night sky
conditions [it was] **slightly greater than 1 °C**"; "Moderation of air temperature on clear nights
would be best achieved with **sky view factors of less than 0.3**." Frost damage: 75 % of seedlings
in clearcut vs **2 %** in forest.
- Groot & Carlson (1996), *Can. J. For. Res.*, doi 10.1139/x26-172: https://cdnsciencepub.com/doi/10.1139/x26-172

**Forest microclimate buffering: global meta-analysis, `verified`:** "the **minimum temperatures of
the forest understory were 1.1 ± 0.2 °C warmer** than the macroclimate outside the forest"; offsets
"more positive … as macroclimate temperature decreased"; buffering "strongest close to the ground".
98 sites, 74 studies, 5 continents.
- De Frenne et al. (2019), *Nature Ecol. Evol.* **3**:744–749, https://frodriguezsanchez.net/pdf/DeFrenne_NatEcolEvol_2019.pdf

> ⚠️ **Counter-example to encode.** Karlsson (2000), *J. Appl. Meteorol.* **39**:851: within a forest,
> increasing SVF gave more negative net radiation and lower air temperature, as expected. **But**
> compared with extensive open areas, the forest had **air temperatures about 3 °C LOWER** despite
> its lower SVF: "due to a sheltering effect that increased the possibility for cooling in the
> forested area because of lower turbulent heating." `verified`.
> **The canopy's benefit to a camper is radiant, and it can coexist with colder air. Model the
> radiative and aerodynamic terms separately; do not fold them into one "forest is warmer" offset.**

### 6.10 Tents: the headline is probably not what you expect

> 🔴 **An unoccupied tent at night under a clear sky sits at or slightly BELOW outside air temperature.**

| $T_{in} - T_{amb}$ | Context | Source | Confidence |
|---|---|---|---|
| **−1.2 K** (control); −0.7 / −0.5 / −1.0 / −0.1 K (bedsheet / Sunbrella / tarp / mylar); **+0.3 K** (foil) | Phoenix AZ, 8–11 Jul 2022, unoccupied tents, clear desert sky | https://pmc.ncbi.nlm.nih.gov/articles/PMC10689257/ | `verified` (peer-reviewed) |
| **≈ −0.9 K** (control); +0.3 K (white bedsheet); ≈ −0.4 K (tarp) | Phoenix AZ, 8–11 Sep 2023, 204 night obs | https://par.nsf.gov/servlets/purl/10558537 | `verified` (peer-reviewed) |
| **−2.2 K (−4 °F)** single-wall tent before occupant entered | NE USA, 23 overnights, $T_{amb}$ −13…+2 °C | Seeber (2024), Backpacking Light: https://backpackinglight.com/by-the-numbers-tent-design-materials-influence-cold-weather-camping-comfort-seeber/ | `single-source`, **not peer-reviewed** |

Two independent peer-reviewed campaigns plus one cold-weather field study agree. **A tent is not a
passive air-warming device. Its benefit is radiant**: §6.8's table shows a plain tent raising
$T_{mrt}$ by ≈ +4.3 K and a foil-covered one by +6.6–7.1 K at essentially unchanged air temperature.

**Occupied, occupant in a sleeping bag** (`single-source`, Seeber, not peer-reviewed): double-wall
**+2.2 K** transient settling to **+1.1 K**; single-wall **−0.6 to +0.6 K**; double-wall minus
single-wall mean **+1.1 K** over 23 overnights. His stated mechanism: "Radiant heat transfer from the
tent to the clear sky reduces the surface temperature of the tent walls to below the ambient
temperature, causing the interior air temperature in the tent to drop below outside temperatures."
He also found "the amount of heat produced by the tent occupant in a sleeping bag has minimal impact
on the tent's interior air temperature."

> 🔴 **Do not cite "tents can be 10 °C warmer than ambient."** The Knoxville homelessness study's
> abstract actually reads: "In winter, many participants successfully warmed their tents by 10 °C or
> more, **by burning materials and using layers of blankets and tarps**." That is combustion heating,
> not a passive shelter effect. `verified` as a misreading trap.

**Tent fabric going sub-ambient: ⚠️ GAP.** **No published, quantified measurement of tent-fly
surface temperature depression below air temperature was found.** Seeber reports it qualitatively
("My infrared imager revealed that the tent's walls were getting colder than the outside air after
the sun went down"), but the quantitative IR data is paywalled. **Derived estimate: 2–5 K sub-ambient**,
because a fly is radiatively loaded on both faces and convectively coupled on both: bracketed by the
8.4 K convection-suppressed lab emitter (Kou et al., *ACS Photonics* **4**:626, 2017 , 
https://web.stanford.edu/group/fan/publication/Kou_ACSPhotonics_4_626_2017.pdf) and the 2–3 K
real-wind dew condensers. **`UNVERIFIED` as a number: flag it.**

**Fabric LWIR transmissivity ranking** (`single-source`, qualitative): **Dyneema/DCF "effectively IR
transparent"** → light polyester "not really opaque" → dark nylon "much better". **If true this is
materially important** (a DCF tarp may give far less radiant shielding than a nylon one) **but the
measured transmissivity table is paywalled and UNVERIFIED.**

### 6.11 Frost above freezing air temperature

Definitional, FAO *Frost Protection* Vol. 1, pp. 62 & 111, verbatim: "A 'frost' is the occurrence of
an air temperature of 0 °C or lower, measured at a height of between 1.25 and 2.0 m above soil
level, inside an appropriate weather shelter." … "Due to long-wave radiation losses, exposed leaves,
buds, flowers, etc. will typically be colder than air temperature during a frost night."

**Quantified screen-minus-surface depression on radiation-frost nights:**

| Value | Definition | Source | Confidence |
|---|---|---|---|
| **4.1 K mean, range 3.3–5.7 K** | min screen air T − min grass-level T, 10 localities, São Paulo State | *Bragantia* (SciELO): http://www.scielo.br/j/brag/a/FFVWrQ5TsJPXbYGC4ytzCzN/?lang=pt | `verified` |
| **5 K state mean; regional 4.2–6.3 K** | screen at 1.60 m minus grass at 0.05 m, 19 stations, multi-year, Paraná | *Semina: Ciências Agrárias*, https://www.redalyc.org/journal/4457/445759861003/html/ | `verified` |
| **1.1–3.3 K (2–6 °F)** rooftop/windshield vs 2 m air, calm clear nights | Maritime temperate (Seattle) | Cliff Mass, UW Atmos. Sci.: https://cliffmass.blogspot.com/2017/04/frost-on-your-car-but-temperature-is.html | `single-source`, expert blog |

> **Usable rule:** frost on a fully sky-exposed surface is routine with screen air temperature up to
> **+4 to +6 °C** over short grass, and **+1 to +3 °C** on higher-conductance surfaces like glass and
> metal. **A tent fly behaves like the latter group**: which is why flies frost over on nights the
> forecast calls +2 °C.

### 6.12 UTCI: the most convenient off-the-shelf correction

UTCI's reference environment is $T_{mrt} = T_a$, 0.5 m/s at 10 m, 50 % RH, person walking at 4 km/h;
$\mathrm{UTCI} = T_a + \mathrm{offset}(T_a,\ T_{mrt}-T_a,\ v_a,\ P_a)$. **Valid input range
$T_{mrt} - T_a$ = −30 to +70 °C**: so the clear-sky −5 to −12 K sits comfortably inside it.
Source: https://umep-dev.github.io/solweig/physics/utci/ (`verified` for the reference conditions and
range). ⚠️ **UTCI assumes a walking person**, so it is not a clean fit for someone asleep.

---

## 7. Open questions / could not verify

Ordered roughly by how much they matter to this library.

### 7.1 Things that would change a shipped number

1. **ISO 11079's clothing area factor: 1.97 or 1.197?** (§1.6) The standard's body text and its own
   normative Annex F program disagree, and this is documented in the peer-reviewed literature rather
   than resolved by it. IREQ is insensitive to the choice; **DLE is not**: reported differences "up
   to 5 h" for long exposures. Since DLE *is* the product's headline output, this needs the purchased
   standard to settle. Recommend Annex F (1.197) for Table F.1 reproducibility, documented as a choice.
2. **ISO 9920's cold-weather insulation correction containing air permeability** (§2.6). Page 14 of
   the standard, just past the end of the free preview. The two renderings obtained place
   $a_p^{0.144}$ differently (inside vs outside the exponential). **`UNVERIFIED: do not ship.`**
   Mitigation: ISO 11079's own correction (§1.7) is cleanly verified by three independent ports and
   covers the same regime: use it.
3. **ISO 11079's $R_{e,T,r}$: does the air layer get divided by $f_{cl}$?** (§1.4) The Annex F ports
   sum $I_{a,r} + I_{cl,r}$; the peer-reviewed rendering and ISO 9920 Eq. (27) use
   $I_{a,r}/f_{cl} + I_{cl,r}$. Small effect for thick clothing but not zero. Unresolved.
4. **ISO 23537-1 Annex C's literal text** (§3.2). Every free preview (2016, 2022, DIS, SIST EN 13537)
   truncates before it. The equations and parameters here come from one peer-reviewed reproduction
   plus **two independent numerical reconstructions** that both reproduce the standard's own Table 1
   to <0.08 K: strong, but not the standard's own words. In particular the **assumed mean skin
   temperature (≈32.6–32.9 °C) is a fitted value, not a sourced constant.**
5. **ISO 23537-1 clause C.8 "Approximate calculation of the temperatures of utility"** (listed in the
   ISO/DIS table of contents). If any official closed-form approximation exists, it is here. Not
   retrieved. This is the closest thing to the "published regression" the brief expected.
6. **No measured stacked-pad dataset exists anywhere reachable** (§4.6). Additivity is asserted by
   Therm-a-Rest, NEMO and the standard's own authors, and apparently **never published as a
   measurement**. Any stacking penalty figure (the circulating "5–15 %") is `UNVERIFIED`.
7. **Angular/view factors for a supine person** (§6.7). Do not exist in ISO 7726, VDI 3787 Part 2,
   SOLWEIG, RayMan, PALM or the Kántor & Unger review. $F_{sky} = 0.5$ is a first-principles
   derivation plus a published macro-scale simplification: **not a citable posture-specific factor.**
8. **Tent-fly surface temperature depression, quantified** (§6.10). The single biggest empirical gap
   for this product. Seeber measured it with an IR imager; the data is paywalled. Also unverified:
   **measured LWIR transmissivity of specific tent fabrics (DCF vs silpoly vs silnylon)**: which, if
   the qualitative ranking holds, would be a first-order input.

### 7.2 Standard text that could not be obtained

9. **ISO 11079 Annexes A–F**: the preview ends mid-page 7. Everything in §§1.3–1.8 rests on a
   peer-reviewed paper plus three independent code ports, never on the normative annex text.
10. **ISO 9920 past page 13**, including Annexes A–C (the actual garment and ensemble insulation
    tables, which this library will eventually need) and the cold-weather correction.
11. **ISO 7726:1998 Annex G** ("Measurement of operative temperature", p. 49). Every free copy stops
    at p. 15. Verified directly here. The closed form $A = k\sqrt{v_a}/(1+k\sqrt{v_a})$ is
    search-summary only → `UNVERIFIED`. The numeric $A$ table is independently solid.
12. **ASHRAE Handbook, Fundamentals Ch. 9**: paywalled. This is the actual home of the $h_c$/$h_r$
    procedure, the Mitchell/de Dear $h_c$ table, and the conventional $h_r = 4.7$. Verified only
    through secondary peer-reviewed sources.
13. **ASTM F3340-22 §§10–13 and Annexes A1–A4**: the Procedure clause (test duration, steady-state
    criterion, the calculation equation) and the uncertainty analysis. The circulating "four hours"
    duration and the "slope of R < 1.5 %, CV < 2.0 %" steady-state criterion could not be traced to
    **any** primary text → treat as `UNVERIFIED`.
14. **ISO 7933's $h_c$ branches from the standard's own text**: both the 2004 and 2023 previews
    truncate before the relevant annex. Two code implementations agree, and ISO 9920 publishes the
    same triple, so this is `verified` by proxy but not from ISO 7933 itself.
15. **ISO 7730:2025 Annex D**, the new edition's "correction of the calculation program". The change
    to the $t_{cl}$ initial guess is inferred from a code comment, not read.

### 7.3 Numbers that are contested or wrong in circulation

16. **ISO 23537's "standard man" mass: 70 kg or 73 kg?** Sources split; no primary text obtained.
    The body surface areas (1.62 / 1.83 m²) rest on one arithmetically sloppy vendor explainer,
    although the woman's 1.62 m² checks out by DuBois for 1.60 m / 60 kg.
17. **$h_r \approx 4.7\ \mathrm{W\,m^{-2}K^{-1}}$ is NOT what the linearisation gives** (§5.5): it
    yields 3.80 (seated) / 3.96 (standing) at a 20 °C mean. 4.7 is a separate conventional whole-body
    constant (de Dear's own manikin measurement: 4.5). **Ship the formula, not the constant**: a
    hard-coded 4.7 overestimates radiant loss by ~75 % at −20 °C.
18. **"Clear night sky ≈ −70 °C effective temperature"**: window brightness temperature, not
    broadband. Real broadband depression is **15–27 K**. Reject.
19. **"$\varepsilon_{Swinbank} = 5.31\times10^{-13}T_a^2$"**: a typo in IBPSA BS2017 that propagates.
    Correct: $9.365\times10^{-6}T_a^2$ (verified by direct computation here).
20. **"Tents can be 10 °C warmer than ambient"**: that study's occupants were burning fuel inside.
21. **EnergyPlus vs Martin–Berdahl cloud corrections disagree materially** (§6.6): +15 % vs +80–85 %
    of the clear-sky gap removed at full overcast. Both are published and mainstream; **unresolved
    which is right.**
22. **The user's "$h_c = 8.3v^{0.6}$ for $0.1 \le v < 1$"**: the equation is Mitchell (1974) and real,
    but **those bounds are not**. Published bounds are $0.2 < v < 4\ \mathrm{m\,s^{-1}}$, with
    $h_c = 3.1$ below 0.2. Also, $8.3v^{0.6}$ (Mitchell) and $8.3v^{0.5}$ (Kerslake/McIntyre) are
    different equations sharing a leading coefficient.

### 7.4 Model-domain problems, not source problems

23. **IREQ is invalid for a sleeping person.** $M \ge 58\ \mathrm{W\,m^{-2}}$ (sleeping is ~41–47) and
    $v_{ar} \ge 0.4\ \mathrm{m\,s^{-1}}$ (a tent is ~0.05–0.1). **Use ISO 23537 for the sleeping case
    and IREQ for the awake case; do not stretch one across both.**
24. **ISO 9920's summation equation is tested only to 1.6 clo** and its wind correction only to
    1.4 clo. Expedition layering is 3–5 clo. One independent study (Kuklane et al. 2021) extends the
    summation to 3.33 clo at −18 %/+12 %, which is encouraging but is one clothing system.
25. **ISO 11079's DLE criterion is not well validated in real cold**: a field study found the mean
    skin temperature criteria "were not met at −14 and −22 °C". Only the abstract was read.
    **Treat DLE as an index, not a physiological prediction.** This matters: "you'll be cold in
    ~22 minutes" is exactly the claim the validation literature is least comfortable with.
26. **The project's existing `clo_required = (33 − t_a)/(0.155 M)` heuristic understates the sleeping
    requirement by a factor of ≈1.48** (§3.8), dominated by the omitted respiratory and evaporative
    terms. The factor is derived and reproducible but is specific to the sleeping case.
27. **Publisher blocks.** MDPI, Elsevier, AMS, Wiley, Springer and ScienceDirect refused essentially
    every fetch route including curl with a browser user agent. Lost this way: Havenith & Nilsson
    (2004) full text, Havenith's sleeping-bag validation papers, Sicart et al. (2004) sub-canopy
    longwave, and several MDPI shelter-thermal papers. All downstream claims from those are marked
    `single-source` or `UNVERIFIED` above.
