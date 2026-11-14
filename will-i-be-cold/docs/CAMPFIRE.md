# Radiant Heat from a Campfire: Verified Reference

Source reference for the campfire radiant-gain term used by this library. Companion to
`STANDARDS.md`; the same rules apply.

**Rules of this document.** Every number below is traceable to a source that was actually
fetched during this research, or is explicitly marked unverified. Nothing is written from
memory. Each entry carries:

- the equation in LaTeX (KaTeX-compatible),
- every symbol defined with SI units,
- validity range as stated by the source,
- **Source**: URL + source kind,
- **Confidence**: `verified` (two independent sources agree) / `single-source` /
  `UNVERIFIED: do not ship`.

Markers used throughout: ✅ a prior assumption confirmed · ⚠️ a caveat or a correction ·
🔴 something that will produce a wrong answer if ignored · ⭐ the recommended choice ·
ℹ️ context. **§10 lists everything that could not be pinned down**: read it before
trusting anything marked `single-source` or `UNVERIFIED`.

Calculations labelled "computed here" were performed during this research from inputs
already verified above; they are reproducible arithmetic, not quoted from a source.

### Contents

| § | Question | Status of the core result |
|---|---|---|
| **1** | The design case and its geometry | Flame height is the only firm input; HRR is **inferred** from it |
| **2** | Heat release rate $\dot Q$ of a small campfire | **No published HRR of an actual campfire was found.** Bracketed 7–16 kW by two independent routes |
| **3** | Radiative fraction $\chi_{rad}$ | 🔴 **0.15, not 0.3**, at this fire size: measured on 22 kW and 47 kW wood cribs |
| **4** | Irradiance $E$ at 1.0–1.3 m | ⚠️ **The point-source model is *valid* at 1.2 m** ($L/D=4$). The brief's expectation was wrong |
| **5** | From $E$ to absorbed flux on a person | $A_p/A_D$ from ASHRAE 55 normative code, cross-checked against ISO 7726 |
| **6** | $\Delta \overline{t}_r$ and $\Delta t_o$ | Derived; $h_r$ **cancels** in $\Delta t_o$ |
| **7** | The asymmetry caveat, quantified | A campfire at 0.75 m **exceeds every published asymmetry comfort limit**; at 1.2 m it is inside them only at the low end of the bracket |
| **8** | Wind and distance sensitivity | Table of $\Delta\overline{t}_r$ / $\Delta t_o$ at 0.75–3.0 m, 0–4 m/s |
| **9** | ⭐ **Recommended parameter block** | This is what gets coded against |
| **10** | Open questions / could not verify | 19 numbered items |

**Four results that matter most**

1. 🔴 **$\chi_{rad} \approx 0.15$ at campfire scale, not the textbook 0.2–0.4.** The
   radiative fraction of wood fires *rises* with size in this regime (optically thin flames);
   22 kW and 47 kW wood cribs measured 0.15, the geometrically similar 340 kW and 740 kW
   cribs measured 0.25 (§3). Using 0.3 would overstate the fire's benefit by 2×.
2. ⚠️ **The point-source model is *not* invalid at 1.2 m from a 0.3 m flame.** $L/D = 4.0$,
   and the published validity threshold is $L/D > 2.5$. It is, however, the *lower* of the two
   models at this range (by ~25 %), so it is the conservative choice for a *comfort*
   calculation: note that this is the **opposite** of its role in a *hazard* calculation,
   where "conservative" means a high flux (§4).
3. **$\Delta t_o$ is independent of $h_r$.** Because the engine blends $t_a$ and $\overline{t}_r$
   with the same $h_r$, $\Delta t_o = f\,E/(h_c+h_r)$ exactly, and $h_r$ cancels (§6.3). This
   removes the single largest parameter uncertainty: but only if the *same* $h_r$ is used in
   both places.
4. 🔴 **Wind destroys the benefit faster than distance does.** At 1.2 m the fire is worth
   $\Delta t_o \approx 2.0$ K in still air but only $\approx 0.8$ K at 2 m/s: the same loss as
   retreating to about 2.0 m in still air (§8).

### Primary sources used (all fetched during this research)

| Tag | What it is | URL |
|---|---|---|
| **[C1]** | **NIST report.** McGrattan K.B., Baum H.R., Hamins A., *Thermal Radiation from Large Pool Fires*, NISTIR 6546, NIST BFRL, Nov 2000. Full text obtained; contains the point-source and solid-flame formulations, Eqs. (1)–(8), and the $\chi_r(D)$ correlation. | https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir6546.pdf |
| **[C2]** | **Peer-reviewed symposium paper.** Yu H.-Z. (FM Global), *Physical Scaling of Water Mist Suppression of Wood Crib Fires in Enclosures*, Fire Safety Science: Proc. 11th Int. Symposium, pp. 1222–1235, IAFSS 2014. DOI 10.3801/IAFSS.FSS.11-1222. Full text obtained. **The key source for small-wood-fire HRR and $\chi_{rad}$.** | https://publications.iafss.org/publications/fss/11/1222/view/fss_11-1222.pdf |
| **[C3]** | **Peer-reviewed paper (scan).** Shokri M., Beyler C.L., *Radiation from Large Pool Fires*, SFPE J. Fire Prot. Engr. **1**(4), 1989, pp. 141–150. Body text obtained; **equations are page images and could not be extracted.** | https://higherlogicdownload.s3.amazonaws.com/SFPE/93e7d31c-6432-4991-b440-97a413556197/UploadedImages/JFPE_1989/jfpe_1989_4_4.pdf |
| **[C4]** | **Regulatory guidance.** NUREG-1805 *Fire Dynamics Tools*, Ch. 5, "Estimating Radiant Heat Flux from Fire to a Target Fuel", as reproduced verbatim in PDHonline course M312. Text obtained; **numbered equations are page images.** | https://pdhonline.com/courses/m312/Radiant%20Flux.pdf |
| **[C5]** | **Conference presentation (experimental).** Fleury R., Spearpoint M., Fleischmann C., *Evaluation of Thermal Radiation Models for Fire Spread Between Objects*, FEMTC 2011, Baltimore. Measured heat flux around a 100–300 kW gas burner, effective diameter ≤ 0.6 m, compared against six radiation models. | https://files.thunderheadeng.com/femtc/2011_d2-05-fleury-presentation.pdf |
| **[C6]** | **Peer-reviewed field measurement.** Watanabe S., Hatano Y., Ishii J., *Practical Study of the Effects on Thermal Comfort of a Campfire*, J. Human-Environment System **25**(2), 2023, pp. 57–63 (J-STAGE, released 2024-03-12). Full text obtained. 🔴 **The only direct measurement of the radiant field around a real campfire found in this research.** | https://www.jstage.jst.go.jp/article/jhes/25/2/25_57/_pdf/-char/en |
| **[C7]** | **Standard text.** ANSI/ASHRAE Standard 55-2023, *Thermal Environmental Conditions for Human Occupancy*. Full text obtained, **including Normative Appendix C (SolarCal) and its §C4 source code with the $f_p$ tables**, Table 5-10, and the Appendix D SET source listing. | https://smartairdefense.com/wp-content/uploads/2025/10/ASHRAE-Standard-55.pdf |
| **[C8]** | **Standard text.** ISO 7726:1998(E), *Ergonomics of the thermal environment, Instruments for measuring physical quantities*. Clauses 1–5.3 and Tables 3–5 obtained verbatim; **Table 2 and Annexes B.3 onward, C and G are scanned page images and could not be extracted.** | https://www.ntm.ru/UserFiles/File/document/Microklimat/Norm/ISO7726_1998.pdf |
| **[C9]** | **Standard text (preview).** ISO 7730:2005(E) official preview PDF. Preview runs to p. 9 and **does contain §6.5 and Equations (9)–(12)** for percentage dissatisfied vs radiant asymmetry. Annex A is not in the preview. | https://cdn.standards.iteh.ai/samples/39155/9632a0563ca742209edb45856ff69296/ISO-7730-2005.pdf |
| **[C10]** | **NIST publication.** *Flame Heights and Heat Transfer from Gaseous, Liquid and Solid Fuels for Burner…* (NIST tsapps pub_id 905896). States Heskestad's flame-height correlation as Eq. [1] with its stated applicability and the fuel-dependence of the 0.235 coefficient. | https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=905896 |
| **[C11]** | **Teaching note.** Hagen B.C., *Flame height calculation: one point lesson*. Independent statement of the same Heskestad correlation (used only to cross-check [C10]). | https://www.hagensforlag.no/Flameheight.pdf |
| **[C12]** | **Peer-reviewed paper.** *Heat Release Rate Characterization of NFPA 1403 Compliant Training Fuels*, Fire Technology, 2021 (FSRI copy). Measured effective heat of combustion of wood-based fuel packages. | https://technicalpanels.fsri.org/docs/HeatReleaseRateCharacterization-fire-technology-2021.pdf |
| **[C13]** | **Instrument datasheet.** Hukseflux NR01 four-component net radiometer: spectral ranges of the pyranometer and pyrgeometer pairs. Needed to bound the instrumental blind band in [C6]. | http://www.jytech.com/pdf/HF/NR01_v1625.pdf |

> **Note on [C7]:** the copy fetched is a licensed PDF that happens to be publicly reachable.
> The citation is to the standard itself. What makes it valuable here is that **Normative
> Appendix C and Normative Appendix D print their own source code**, so the $f_p$ projected-area
> tables and the $h_r$ linearisation are available as literal numbers rather than as a figure.

---

## 1. The design case

Taken from the client's description, treated as the specification:

| Symbol | Quantity | Design value | Units |
|---|---|---|---|
| $L_f$ | mean visible flame height above the fuel bed | $0.30$ | $\mathrm{m}$ |
| $D$ | effective diameter of the burning fuel bed | $0.30$ (range $0.2$–$0.5$) | $\mathrm{m}$ |
| $r$ | horizontal distance, fire axis to person | $1.0$–$1.3$ | $\mathrm{m}$ |
| $z_t$ | height of the receiver's radiative centroid | $0.60$ (seated) | $\mathrm{m}$ |
| $z_s$ | height of the equivalent point source ($=L_f/2$) | $0.15$ | $\mathrm{m}$ |

ℹ️ **Only $L_f$ is given.** Everything downstream (HRR, radiative power, irradiance) is
*inferred* from a 0.3 m flame height. $D$ is not specified by the client and is the dominant
remaining uncertainty: it moves the inferred HRR by a factor of 3 (§2.2).

The slant distance from the equivalent point source to a seated receiver is

$$d = \sqrt{r^2 + (z_t - z_s)^2}$$

so $d = 1.282\ \mathrm{m}$ at $r = 1.2\ \mathrm{m}$: i.e. **the source is 21° below the
horizontal** as seen by a seated person, not level with them. This matters in §5.2.

---

## 2. Heat release rate of a small wood campfire

### 2.1 🔴 There is no published HRR measurement of a campfire

This is the central gap. Fire-safety engineering measures wood *cribs* (regular stacks of
machined sticks) and wood *pallets*, because those are reproducible. A campfire: loose split
logs in a tepee or log-cabin stack, hand-fed, half ember bed: is not a standard test article.
Searches of the fire-science literature, NIST publications, IAFSS proceedings and the
cookstove literature returned **no oxygen-consumption-calorimetry measurement of a recreational
campfire**. Everything in §2.2–2.4 is therefore *inference*, and is labelled as such.

**Confidence:** `verified` (as a negative result, the absence is itself the finding).

### 2.2 Route A: inverting Heskestad's flame-height correlation

$$L_f = 0.235\,\dot Q^{2/5} - 1.02\,D$$

| Symbol | Quantity | Units |
|---|---|---|
| $L_f$ | mean visible flame height | $\mathrm{m}$ |
| $\dot Q$ | total heat release rate | $\mathrm{kW}$ |
| $D$ | diameter of the burner / fuel bed | $\mathrm{m}$ |

Quoted as Eq. [1] of [C10] and independently in [C11]. Inverting (computed here):

$$\dot Q = \left(\frac{L_f + 1.02\,D}{0.235}\right)^{5/2}$$

| $D$ (m) | $\dot Q$ for $L_f = 0.30$ m (kW) |
|---|---|
| 0.20 | **6.7** |
| 0.30 | **10.7** |
| 0.40 | **15.8** |
| 0.50 | 22.1 |

⚠️ **Three caveats, all from [C10] itself.** (i) The correlation is stated to apply to "fuels
which do not have substantial in-depth combustion… liquid pool fires and other horizontal
surface fires": a porous wood crib with a glowing char bed is *not* such a fuel. (ii) [C10]
notes the coefficient 0.235 "is dependent on the ratio of the heat of combustion to the actual
mass stoichiometric ratio of air to volatiles of the fuel" and that for gasoline 0.2 is the
right value; no wood-specific coefficient was found. (iii) [C10]'s own validation found
calculated flame heights ran *high* versus photographic means (e.g. 0.94–1.1 m calculated vs
0.70 m observed for natural gas), which means inverting it **under**estimates $\dot Q$: the
conservative direction for us, but it is a bias, not a random error.

**Source:** [C10] (NIST publication), cross-checked against [C11].
**Confidence:** `verified` for the correlation; the *inversion* for a wood fire is
`single-source` and extrapolated outside the stated fuel class.

### 2.3 Route B: the wood-crib anchor

[C2] configured four geometrically similar northern-spruce-pine cribs ("near knob-free",
dry-basis moisture content 4–8 %) and measured their free-burn HRR under a fire products
collector in open space:

| Crib | Stick thickness $b$ (mm) | Stick length $\ell$ (mm) | Sticks/layer $n$ | Layers $N$ | Peak HRR (kW) |
|---|---|---|---|---|---|
| Scale-1 small | 16 | 191 | 8 | 6 | **22** |
| Scale-1 large | 16 | 191 | 6 | 12 | **47** |
| Scale-3 small | 27 | 657 | 16 | 11 | 340 |
| Scale-3 large | 27 | 657 | 12 | 20 | 740 |

Quoted verbatim from [C2] Table 3 and §"Results". The Scale-1 cribs have a footprint of
roughly $0.19 \times 0.19$ m.

ℹ️ **This is consistent with Route A, not in conflict with it.** Heskestad's correlation at
$\dot Q = 22$ kW, $D = 0.19$ m gives $L_f = 0.62$ m (computed here): a 22 kW crib has
**two-foot flames**, not one-foot flames. A machined crib is a far more efficient burner per
unit footprint than loose logs, so footprint alone is a poor scaling variable; flame height is
the better one, and it is also what the client actually specified.

**Source:** [C2] (peer-reviewed IAFSS proceedings).
**Confidence:** `verified` for the crib HRRs; `single-source` for the inference about campfires.

### 2.4 Route C: fuel mass flow (sanity check only)

$$\dot Q = \dot m \,\Delta h_{c,\mathrm{eff}}$$

| Symbol | Quantity | Units |
|---|---|---|
| $\dot m$ | fuel mass loss rate | $\mathrm{kg\,s^{-1}}$ |
| $\Delta h_{c,\mathrm{eff}}$ | effective heat of combustion | $\mathrm{kJ\,kg^{-1}}$ |

[C12] burned 21 wood-based training-fuel packages (pallets, OSB, excelsior) in a calorimeter and
obtained $\Delta h_{c,\mathrm{eff}}$ by dividing total energy release by initial fuel mass:
**14.2 MJ/kg** from an ordinary-least-squares fit with $R^2 = 0.980$, with individual values
ranging **12.4–16.4 MJ/kg**. A second regression on a different subset gave 14.9 MJ/kg,
$R^2 = 0.99$. Quoted from [C12] §Results.

At 14.2 MJ/kg, **1 kg/h of wood ≈ 3.9 kW**. A 10 kW fire therefore consumes ≈ 2.5 kg/h
(≈ 5.6 lb/h): which is in the right range for a hand-fed social campfire (computed here).

⚠️ This route cannot *pin* the design case because no fetched source gives a measured mass-loss
rate for a campfire. It only confirms that 7–16 kW is not absurd.

**Source:** [C12] (peer-reviewed, Fire Technology).
**Confidence:** `verified` for $\Delta h_{c,\mathrm{eff}}$; the campfire mass flow is
`UNVERIFIED: do not ship` as an independent input.

### 2.5 ⭐ Recommendation for $\dot Q$

$$\dot Q = 10\ \mathrm{kW} \quad \text{(design)}, \qquad 7\ \mathrm{kW} \le \dot Q \le 16\ \mathrm{kW} \quad \text{(range)}$$

What drives the spread, in descending order of leverage:

1. **Fuel-bed diameter**: 0.2 → 0.5 m moves $\dot Q$ from 6.7 to 22 kW at fixed flame height.
2. **Flame height itself**: the client's "roughly 1 foot" is an eyeball estimate; flames
   fluctuate by ±50 % second to second. $L_f = 0.45$ m with $D = 0.3$ m gives 19 kW.
3. **Moisture content**: [C2]'s cribs were at 4–8 % dry-basis. Campsite firewood at 20–25 %
   burns slower and cooler; no fetched source quantified the HRR penalty.
4. **Species / density**: [C2] used spruce pine; [C12] mixed wood products. The 12.4–16.4 MJ/kg
   spread in [C12] is the visible part of this.
5. **Stack geometry and air access**: a crib and a tepee of the same mass differ by more than
   a factor of two in HRR per footprint (§2.3).

**Confidence:** `single-source` (inference from [C10] constrained by [C2]), **not a measurement
of a campfire.**

---

## 3. Radiative fraction $\chi_{rad}$

### 3.1 Definition

$$\dot Q_{rad} = \chi_{rad}\,\dot Q$$

the fraction of the total heat release rate that leaves the fire as thermal radiation rather
than as enthalpy in the convective plume. Dimensionless.

### 3.2 🔴 The measured value for wood fires of this size is 0.15

[C2], free-burning in open space under a fire products collector:

> "The maximum heat release rates of the smaller and larger crib fires were about 22 and 47 kW.
> The radiation fraction at the maximum heat release rate was measured about **0.15** for both
> the smaller and larger cribs."

and for the geometrically similar 3× cribs:

> "The peak heat release rates of the smaller and larger Scale-3 fires were about 340 and 740 kW
> respectively… The radiation fraction at the peak heat release rate was measured about **0.25**
> for both the smaller and large wood cribs."

Both quoted verbatim from [C2]. **$\chi_{rad}$ rose with fire size** across a 15× range in HRR
with the fuel, geometry and instrument held fixed.

**Source:** [C2] (peer-reviewed IAFSS proceedings, FM Global).
**Confidence:** `single-source`, but it is a direct measurement on the right fuel at
very nearly the right scale, which is better than a cross-checked value from the wrong regime.

### 3.3 Why "0.2–0.4" is the wrong bracket here

The familiar 0.2–0.4 comes from **large liquid pool fires**. [C1] is explicit:

> "For fires up to roughly four meters in diameter, the ratio of the rate of energy radiated to
> the surroundings to the total HRR of the fire, $\chi_r$, is between 0.30 and 0.40, and this
> value decreases with increasing fire diameter due to smoke obscuration."

with the correlation

$$\chi_r = \chi_{r,\max}\,e^{-k D}, \qquad \chi_{r,\max} = 0.35,\quad k = 0.05\ \mathrm{m^{-1}}$$

fitted to heptane, crude oil and kerosene data ([C1] Eq. 3 and Fig. 3). ⚠️ Note what this
correlation does at small $D$: it tends to **0.35 as $D \to 0$**, which is exactly the opposite
of what [C2] measured for wood. The correlation has no data below ~1 m and must not be
extrapolated to 0.3 m.

[C4] gives the general engineering bracket: $\chi_r$ "can vary from approximately **0.15** for
low-sooting fuels (e.g. alcohol) to **0.60** for high sooting fuels (e.g. hydrocarbons)", and
[C1] recommends 0.20 as "a conservative estimate… appropriate for a wide range of gaseous
fuels". A small wood flame sits at the low-sooting, **optically thin** end: the flame sheet is
too thin to be a blackbody, so it radiates less than its temperature would suggest.

**Source:** [C1], [C4].
**Confidence:** `verified` that 0.30–0.40 is a *large-pool-fire* number and that the
large-fire trend is *downward*; `verified` that 0.15 is a physically recognised floor for
low-sooting fuels.

### 3.4 Partial independent corroboration

A study of surface fires in mixed-oak litter is reported to have obtained a radiative fraction
averaging **0.17**, range 0.13–0.21, from radiometers combined with mass-loss. This agrees
closely with [C2]'s 0.15. ⚠️ **This number comes from a search-result summary; the underlying
paper was not fetched.** Treated as suggestive only.

**Confidence:** `UNVERIFIED, do not ship` as an independent source. Listed in §10.

### 3.5 ⭐ Recommendation for $\chi_{rad}$

$$\chi_{rad} = 0.15 \quad \text{(design)}, \qquad 0.15 \le \chi_{rad} \le 0.25 \quad \text{(range)}$$

Design radiative source strength:

$$\dot Q_{rad} = \chi_{rad}\dot Q = 0.15 \times 10\ \mathrm{kW} = \mathbf{1.5\ kW}, \qquad 1.05\ \mathrm{kW} \le \dot Q_{rad} \le 4.0\ \mathrm{kW}$$

(computed here; the range combines the $\dot Q$ and $\chi_{rad}$ extremes). The design value
sits at **38 % of the upper bound**: deliberately so.

---

## 4. Irradiance at the receiver

### 4.1 Point-source model

$$E = \frac{\chi_{rad}\,\dot Q}{4\pi d^2}$$

| Symbol | Quantity | Units |
|---|---|---|
| $E$ | irradiance at the receiver, normal incidence | $\mathrm{W\,m^{-2}}$ |
| $\chi_{rad}\dot Q$ | radiative power of the fire | $\mathrm{W}$ |
| $d$ | distance from the equivalent point source to the receiver | $\mathrm{m}$ |

[C1] Eq. (7) verbatim (as $\dot q'' = \chi_r \dot Q/4\pi r^2$). [C5] uses the same expression
with an explicit incidence cosine, $\dot q'' = \dot Q_r \cos\theta/4\pi R^2$, for a target whose
normal is at $\theta$ to the line of sight. For the $\Delta\overline{t}_r$ conversion in §6 we
want **normal incidence** (the cosine is absorbed into the projected-area factor $A_p/A_D$), so
the bare form is the right one to use here.

**Where the point source is placed.** [C4] states the model "assumes that radiant energy is
released at a point located at the center of the fire". We place it on the fire axis at
$z_s = L_f/2 = 0.15$ m. ⚠️ The convention matters at the ~10 % level: placing the source at ground level instead
gives $d^2 = 1.80$ rather than $1.6425\ \mathrm{m^2}$ at $r = 1.2$ m, i.e. an $E$ **9.6 % lower**
(computed here). $L_f/2$ is the physically correct choice: the centroid of the radiating volume , 
so the ground-level convention would be conservative by 1.10× but for the wrong reason. Fix the
convention explicitly in code rather than leaving it implicit.

**Source:** [C1] Eq. (7); [C4] §5.3.1; [C5].
**Confidence:** `verified`.

### 4.2 ⚠️ Where it fails: and the brief's expectation was wrong

The brief anticipated that the point-source model would break down at 1.2 m and asked for that
to be said loudly. **It does not break down at 1.2 m, and the honest finding is the opposite.**

[C4] §5.5, verbatim, on the limitations of point-source models:

> "(2) The point source model **overestimates** the intensity of thermal radiation at the
> observer's (target) locations close to the fire. This is primarily because the near-field
> radiation is greatly influenced by the flame size, shape, and tilt, as well as the relative
> orientation of the observer (target).
> (3) A theoretical analysis of radiation from small pool fire by **Modak (1977)** indicated
> that the point source model is **within 5-percent** the correct incident heat flux when
> **$L/D > 2.5$**."

[C1] says the same qualitatively: the method "is accurate in the far-field, but is considered
overly conservative within a few fire diameters".

For the design case: $L/D = 1.2/0.3 = \mathbf{4.0}$, comfortably above 2.5. Even at the
pessimistic $D = 0.5$ m the ratio is 2.4, i.e. marginal rather than invalid. **The point-source
model is in its stated validity range at 1.0–1.3 m from a 0.3 m fire.** It would become
invalid at $r \lesssim 0.75$ m.

🔴 **The sign of "conservative" flips between disciplines.** Both [C1] and [C4] call the
point-source model "conservative" close in because it *overpredicts the flux*: which is the
safe side for a burn-hazard or separation-distance calculation. For *this* library,
overpredicting the flux means **overstating how warm the user is**, which is precisely the
failure mode the client is worried about. So the fire-science literature's word "conservative"
must be read as **anti-conservative for us**. Anyone porting a hazard formula into this engine
needs to know that.

**Source:** [C4] §5.5 (regulatory guidance, citing Modak 1977); [C1] §3.
**Confidence:** `verified` (two independent sources state the same validity criterion and the
same direction of error).

### 4.3 Empirical support at small scale

[C5] measured radiant heat flux around a gas burner: heat release 100–300 kW, effective fire
diameter ≤ 0.6 m: and compared six models. Average percentage error from experiment:

| Model | Vertical target | Horizontal target |
|---|---|---|
| **Point source** | **18 %** | 76 % |
| Dayan & Tien | 35 % | 71 % |
| Rectangular planar | 40 % | 76 % |
| Shokri & Beyler detailed | 50 % | 89 % |
| Shokri & Beyler correlation | 99 % | - |
| Mudan | 224 % | 205 % |

Binned by flux level, the point source gave 17 % / 17 % / 31 % error at < 5, 5–10 and
> 10 kW/m². [C5]'s conclusion, verbatim: "Point Source model (surprisingly) proved to be the
most robust, in terms of dealing with different scenarios."

✅ This is direct experimental support for using the point-source model at sub-metre fire
diameters, and it sets a realistic error bar: **±20 % on $E$ for a vertically-oriented receiver.**

**Source:** [C5] (conference presentation, University of Canterbury / Arup).
**Confidence:** `single-source`. ⚠️ Propane burner, not wood; compartment, not open air.

### 4.4 Solid-flame / view-factor model

$$E = \tau\,\varepsilon_f\,E_f\,F_{1\to2}$$

| Symbol | Quantity | Units |
|---|---|---|
| $E_f$ | emissive power at the flame surface | $\mathrm{kW\,m^{-2}}$ |
| $\varepsilon_f$ | effective flame emissivity ($1 - e^{-\kappa D}$) | - |
| $\tau$ | atmospheric transmissivity | - |
| $F_{1\to2}$ | configuration (view) factor, flame → receiver element | - |

[C1] Eq. (1) verbatim; [C3] and [C4] Eq. (5-4) use the same form with $\tau = \varepsilon_f = 1$.
At 1.2 m in dry air $\tau \to 1$ (it is "taken as one, to be on the conservative side" in [C1]).

🔴 **Energy conservation binds, and it is the only defensible way to set $E_f$ here.** [C1]
Eq. (2) couples the emissive power to the HRR:

$$\chi_r \dot Q = P\,H\,E_f$$

with $P$ the flame perimeter and $H$ its height. For a cylinder $P = \pi D$, so for the design
case the lateral area is $\pi \times 0.3 \times 0.3 = 0.2827\ \mathrm{m^2}$ and

$$E_f = \frac{1.5\ \mathrm{kW}}{0.2827\ \mathrm{m^2}} = \mathbf{5.3\ kW\,m^{-2}}$$

(computed here; 3.7 kW/m² at the low bracket, 14.1 kW/m² at the high bracket).

⚠️ **Every literature emissive power violates energy conservation at this scale.** Shokri &
Beyler's correlation is widely quoted as $E_f = 58\cdot10^{-0.00823D}$ kW/m²; the fetched paper
[C3] confirms the magnitude in words: the effective emissive power "reduces from about
**60 kW/m² at 1 m diameter to 20 kW/m² at about 60 m diameter**": and also confirms the hard
limit on its use: "**Only data for pool fires in excess of one meter diameter will be
considered.**" [C4] adds that the underlying pool diameters "ranged from 1 to 50 m" and the
fuels were kerosene, fuel oil, gasoline, JP-4, JP-5 and LNG.

Applying it anyway at $D = 0.3$ m gives $E_f = 57.7\ \mathrm{kW\,m^{-2}}$, which over a
0.2827 m² flame envelope radiates **16.3 kW: more than the entire 10 kW heat release rate of
the fire** (computed here). It is not a conservative choice; it is an impossible one. The same
goes for [C1]'s $E_f = 100\ \mathrm{kW\,m^{-2}}$ "adopted here" for large-pool near-field hazard
work.

ℹ️ The physical reconciliation: a small wood flame is **optically thin**. Measured wood-crib
flame emissivities in the 0.1–0.6 range were reported in the literature surveyed, consistent
with $E_f \approx 5\ \mathrm{kW\,m^{-2}}$ against a $\sim$1200 K blackbody value of
$\sigma T^4 = 118\ \mathrm{kW\,m^{-2}}$ ($\varepsilon_f \approx 0.045$: lower than any
reported crib value, which suggests the true radiating envelope is larger than the idealised
$0.3\times0.3$ m cylinder). ⚠️ The 0.1–0.6 emissivity figure is from a search-result summary,
not a fetched source: see §10.

**Source:** [C1] Eqs. (1)–(2); [C3]; [C4] §5.3.2.
**Confidence:** `verified` for the solid-flame formulation and for the stated validity limits of
the emissive-power correlations. The energy-conserving $E_f$ for the design case is
**computed here**, not measured: `single-source` at best.

### 4.5 What the two models predict: numerical comparison

Computed here. Flame = cylinder, radius 0.15 m, height 0.30 m, uniform lateral emissive power
$E_f = 5.3\ \mathrm{kW\,m^{-2}}$ (energy-conserving, $\chi_{rad}\dot Q = 1.5$ kW). View factor
by direct numerical quadrature over the visible lateral surface (1200 × 400 cells), receiver a
small plane element at height 0.60 m with its normal pointing at the flame centroid.
Point source on the axis at 0.15 m.

| $r$ (m) | $L/D$ | $F_{1\to2}$ | $E$ solid flame (W/m²) | $E$ point source (W/m²) | ratio PS / SF |
|---|---|---|---|---|---|
| 0.50 | 1.7 | 0.0424 | 225 | 264 | **1.17** |
| 0.75 | 2.5 | 0.0329 | 175 | 156 | 0.89 |
| 1.00 | 3.3 | 0.0229 | 122 | 99 | 0.82 |
| **1.20** | **4.0** | **0.0173** | **92** | **73** | **0.79** |
| 1.30 | 4.3 | 0.0152 | 81 | 63 | 0.78 |
| 1.50 | 5.0 | 0.0118 | 63 | 49 | 0.78 |
| 2.00 | 6.7 | 0.0070 | 37 | 28 | 0.77 |
| 3.00 | 10.0 | 0.0032 | 17 | 13 | 0.77 |

Two things to read off.

1. ✅ **At 1.2 m the two models agree to 21 %**: within [C5]'s measured ±18 % model error. At
   $L/D = 1.7$ the point source does overpredict (ratio 1.17), reproducing the [C4] statement.
2. ⚠️ **They converge to a ratio of $\pi/4 = 0.785$, not to 1.** This is structural, not a
   quadrature error. A cosine (Lambertian) emitter on a vertical cylinder of projected area
   $DH$ radiates a far-field intensity $E_f DH/\pi$ in the horizontal direction, while an
   isotropic point source of the same *total* power $E_f \pi D H$ radiates
   $E_f \pi D H/4\pi = E_f D H/4$. The ratio is $4/\pi = 1.273$: **an energy-conserving solid
   flame beams sideways 27 % harder than an isotropic point source**, because its lateral
   surface sends nothing straight up or down. Verified analytically (computed here) and matched
   by the quadrature to 3 significant figures.

### 4.6 ⭐ Which model to use at 1.0–1.3 m

**Use the point-source model, Eq. §4.1.** Reasons, in order:

1. It is inside its published validity range at this distance ($L/D = 4 > 2.5$): §4.2.
2. It was the most accurate of six models in the only small-scale experimental comparison
   obtained, at 17–18 % error: §4.3.
3. It is the **lower** of the two predictions at $r \ge 0.75$ m, by ~21 %: so it is the
   conservative choice *for a comfort calculation*: §4.5.
4. It needs no flame-geometry inputs, and flame geometry is exactly what we do not know
   (we have $L_f$ to ±50 % and $D$ not at all).

🔴 **Do not use it below 0.75 m.** There $L/D < 2.5$, it overpredicts, and overprediction here
means overstating comfort.

### 4.7 Cross-check against the only real campfire measurement

[C6] instrumented a pine campfire at a public campsite (Kasugai, Japan, 2020-09-19) with
four-component net radiometers mounted vertically at 1.1 m, facing the fire, at 1.5, 2.5 and
3.5 m. Two one-hour fires, 35 split pine logs each (~35 cm long, 15 in an initial tepee then 2
added every 2 min). Measured **increases** over pre-ignition baseline, at 1.5 m, verbatim from
[C6]:

| Quantity | Fire 1 | Fire 2 |
|---|---|---|
| Long-wave flux facing the fire | $+146.8\ \mathrm{W\,m^{-2}}$ (max 571.1 from 424.1) | $+173.3\ \mathrm{W\,m^{-2}}$ |
| Short-wave flux facing the fire | $109.5\ \mathrm{W\,m^{-2}}$ | $111.3\ \mathrm{W\,m^{-2}}$ |
| Long-wave flux at the **back** | no rise (413.8–424.1 range throughout) | no rise (406.8–415.2) |
| Short-wave flux at the **back** | "remained almost zero throughout" | same |
| Plane radiant temperature, front | $+32.5$ K (to 53.5 °C) | $+36.3$ K (to 55.9 °C) |
| Plane radiant temperature, back | "did not rise at all" | same |

Total measured fire irradiance on a vertical plane at 1.5 m: **256 W/m² (fire 1), 285 W/m²
(fire 2)** (computed here, SW + LW).

Inverting the point-source model with a slant distance of 1.70 m (receiver 1.1 m high, source
at ~0.3 m) gives $\chi_{rad}\dot Q = 9.3$–$10.3$ kW, i.e. $\dot Q \approx 37$–69 kW for
$\chi_{rad}$ between 0.25 and 0.15 (computed here). ✅ That is a plausible size for a 35-log
tepee fire and **4–7× the design case**: which is the right ordering, and tells us the design
case is genuinely a *small* fire by campfire standards.

⚠️ **Three caveats on using [C6]'s fluxes as absolute truth.**

- 🔴 **The instrument has a blind band.** [C13] gives the NR01's spectral ranges as
  **285–3000 nm** (pyranometer) and **4.5–40 µm** (pyrgeometer). Nothing is measured between
  3.0 and 4.5 µm. For a grey emitter at flame temperature the blackbody fraction in that band
  is **0.28 at 900 K, 0.28 at 1100 K, 0.25 at 1400 K, 0.21 at 1600 K** (computed here, Planck
  integration). Worse, the strong CO₂ emission band at 4.3 µm: a dominant radiator in
  hydrocarbon flames: sits inside the gap. So **[C6]'s numbers are a lower bound on the true
  irradiance, plausibly by 25–40 %.** Using them as-is is conservative.
- The fire's radiation splits roughly 57 % long-wave / 43 % short-wave at 1.5 m: see §5.3.
- No flame height, fuel mass rate or HRR was measured, so the inversion above is uncalibrated.

**Source:** [C6] (peer-reviewed field measurement); [C13] (instrument datasheet).
**Confidence:** `single-source` for the fluxes (one night, two fires, one site);
`verified` for the instrument spectral ranges and hence for the blind-band caveat.

---

## 5. From irradiance to a human

### 5.1 The absorbed flux

Per unit DuBois (total body) area $A_D$, the extra absorbed radiant flux from a directional
source is

$$\Delta R = \alpha_{fire}\,\frac{A_p}{A_D}\,E$$

| Symbol | Quantity | Units |
|---|---|---|
| $A_p$ | projected area of the body toward the source | $\mathrm{m^2}$ |
| $A_D$ | DuBois total body surface area | $\mathrm{m^2}$ |
| $\alpha_{fire}$ | body absorptivity for the fire's spectrum | - |
| $E$ | irradiance normal to the source direction | $\mathrm{W\,m^{-2}}$ |

### 5.2 Projected area fraction $A_p/A_D$: ✅ two standards agree

ASHRAE 55-2023 Normative Appendix C decomposes this as $A_p/A_D = f_p\,f_{\mathrm{eff}}$, where
$f_{\mathrm{eff}}$ is "the fraction of the body surface exposed to radiation from the
environment (**= 0.696 for a seated person and 0.725 for a standing or horizontal person**)"
and $f_p$ is the projected fraction relative to that effective area, tabulated against source
altitude and horizontal bearing (SHARP). From the $f_p$ tables printed as literal source code
in [C7] §C4:

| Posture | Source altitude | SHARP (bearing) | $f_p$ | $A_p/A_D = f_p f_{\mathrm{eff}}$ |
|---|---|---|---|---|
| **Seated** | 0° (horizontal) | 0° (dead ahead) | **0.290** | **0.202** |
| Seated | 15° | 0° | 0.324 | 0.226 |
| Seated | 0° | 90° (side-on) | 0.216 | 0.150 |
| Seated | 0° | 180° (behind) | 0.300 | 0.209 |
| **Standing** | 0° | 0° | **0.350** | **0.254** |
| Standing | 0° | 90° | 0.230 | 0.167 |
| Standing | 90° (overhead) | any | 0.082 | 0.059 |

Independent cross-check: ISO 7726:1998 Table B.1 is reported to give projected area factors of
0.18 (up/down), 0.22 (left/right), 0.30 (front/back) for a seated person and 0.08/0.23/0.35
standing. Used as weights in the six-direction mean-radiant-temperature estimate, the
normalised front weight is $0.30/(2\times0.70) = 0.214$ seated and $0.35/(2\times0.66) = 0.265$
standing (computed here): **within 6 % of ASHRAE's 0.202 and 0.254.** ⚠️ The ISO Table B.1
numbers come from a search-result summary; the table itself is a scanned page image in [C8] and
could not be extracted. The *agreement* is therefore suggestive, not a second verified source.

⚠️ **Our source is 21° *below* the horizontal for a seated person (§1), and the ASHRAE table
only covers altitudes 0–90° *above*.** No fetched source tabulates $f_p$ for a sub-horizontal
source. Physically a seated person presents thighs, shins and feet to a below-horizontal source,
so $f_p$ should be at least as large as at 0°; we use the 0° value and flag it (§10).

**Source:** [C7] Normative Appendix C §C1 and §C4 (standard text + its own normative source
code).
**Confidence:** `verified` for $f_{\mathrm{eff}}$ and the $f_p$ tables; `single-source` for the
choice of the 0°-altitude entry for a 21°-below source.

### 5.3 Absorptivity $\alpha_{fire}$: 🔴 not 0.95

[C7] Appendix C gives two absorptivities: long-wave $\alpha_{LW} = 0.95$ ("the default value for
skin and clothing") and short-wave $\alpha_{SW} = 0.70$ to be used "unless more specific
information about the clothing or skin color of the occupants is available", with an informative
note that it "typically ranges from 0.57 to 0.84, depending on skin and clothing color".

A campfire radiates in *both* bands. [C6] used $\alpha_L = 0.97$ and, for short-wave,
$\alpha_S = 0.66$ (their "average value for summer" from an earlier paper by the same author).
With [C6]'s measured 57 % / 43 % long-/short-wave split at 1.5 m, the flux-weighted effective
absorptivity is

$$\alpha_{fire} = \frac{0.97 \times 146.8 + 0.66 \times 109.5}{146.8+109.5} = \mathbf{0.84}$$

(computed here; 0.85 for fire 2). ✅ Internal consistency check: $0.97\times146.8 +
0.66\times109.5 = 214.7\ \mathrm{W\,m^{-2}}$, and recomputing the absorbed flux from [C6]'s own
reported plane radiant temperatures ($21.0 \to 53.5\ ^\circ\mathrm{C}$, $\varepsilon_p = 0.97$)
gives $214\ \mathrm{W\,m^{-2}}$: the two agree to 0.3 %, which confirms we have reconstructed
their calculation correctly.

🔴 **Using $\alpha = 0.95$ for a fire overstates the absorbed flux by 13 %.** Flame radiation is
much shorter-wavelength than room-temperature surroundings (Wien peak ≈ 2.4 µm at 1200 K), and
skin and clothing are *less* absorptive in the near infrared than in the far infrared. Dark
clothing moves $\alpha_{fire}$ up toward 0.9; a white shell moves it down toward 0.7.

**Source:** [C7] §C2(a); [C6] §2.2.
**Confidence:** `single-source` for 0.84 (one spectral split, one $\alpha_S$ value from a
source not independently fetched). ⭐ Ship 0.84; it is both better-founded and more
conservative than 0.95.

### 5.4 What the comfort standards say about an asymmetric source

**ISO 7726:1998** is an *instruments* standard. It defines the quantity but sets no comfort
limits. Verbatim from [C8] §4.1.3:

> "The **radiant temperature asymmetry** is the difference between the plane radiant temperature
> of the two opposite sides of a small plane element… The concept of radiant temperature
> asymmetry is used when the mean radiant temperature does not completely describe the radiative
> environment, for instance when the radiation is coming from opposite parts of the space with
> appreciable thermal heterogeneities."

and on the plane radiant temperature itself (§4.1.3):

> "the uniform temperature of an enclosure where the radiance on one side of a small plane
> element is the same as in the non-uniform actual environment."

[C8] §4.1.2 also authorises exactly the approach used in §6:

> "The mean radiant temperature may also be estimated for the plane radiant temperature in six
> opposite directions **weighted according to the projected area factors for a person**.
> Similarly, it can be estimated from the measurement of the radiant flux from different
> directions."

Measurement heights, [C8] Table 5: abdomen level is **0.6 m sitting / 1.1 m standing**; head
level 1.1 m / 1.7 m; ankle level 0.1 m both. ⚠️ [C8] Table 4's "Factor X = 2 (class C) / 3
(class S)" for radiant temperature asymmetry: which a casual search will surface as if it were
a comfort limit: is **not** one: it is the multiplier on the *required measuring accuracy* that
defines whether an environment may be treated as homogeneous. Do not cite it as a comfort
threshold.

**The comfort limits live in ISO 7730 and ASHRAE 55.** [C7] Table 5-10, verbatim:

| Ceiling warmer than floor | Ceiling cooler than floor | **Wall warmer than air** | Wall cooler than air |
|---|---|---|---|
| < 5 °C (9.0 °F) | < 14 °C (25.2 °F) | **< 23 °C (41.4 °F)** | < 10 °C (18.0 °F) |

measured "at waist level, 0.6 m (24 in.) for a seated occupant and 1.1 m (43 in.) for a standing
occupant", with the sensor "oriented to capture the greatest surface temperature difference"
([C7] §3, §5.3.5.2, §7.3.2(b)). [C7] Informative Appendix I2 states these limits "are based on
Figure I-1 and assume that a maximum of **5 % of occupants are dissatisfied** by radiant
asymmetry".

ISO 7730:2005 §6.5 gives the underlying logistic fits. Verbatim from [C9]:

$$\text{warm ceiling:}\quad PD = \frac{100}{1+\exp(2.84 - 0.174\,\Delta t_{pr})} - 5.5, \qquad \Delta t_{pr} < 23\ ^\circ\mathrm{C}$$

$$\text{cool wall:}\quad PD = \frac{100}{1+\exp(6.61 - 0.345\,\Delta t_{pr})}, \qquad \Delta t_{pr} < 15\ ^\circ\mathrm{C}$$

$$\text{cool ceiling:}\quad PD = \frac{100}{1+\exp(9.93 - 0.50\,\Delta t_{pr})}, \qquad \Delta t_{pr} < 15\ ^\circ\mathrm{C}$$

$$\text{warm wall:}\quad PD = \frac{100}{1+\exp(3.72 - 0.052\,\Delta t_{pr})} - 3.5, \qquad \Delta t_{pr} < 35\ ^\circ\mathrm{C}$$

| Symbol | Quantity | Units |
|---|---|---|
| $PD$ | predicted percentage dissatisfied due to asymmetry | % |
| $\Delta t_{pr}$ | radiant temperature asymmetry | $^\circ\mathrm{C}$ |

[C9] §6.5 also states, importantly for us:

> "For horizontal radiant asymmetry, Figure 4 applies from side-to-side (left/right or
> right/left) asymmetry, the curves providing a conservative estimate of the discomfort:
> **no other positions of the body in relation to the surfaces (e.g. front/back) cause higher
> asymmetry discomfort.**"

✅ **Front/back asymmetry is the most *tolerated* orientation**, and a warm vertical surface is
the most tolerated of the four cases (35 °C validity ceiling, 23 °C allowable limit vs 5 °C for
a warm ceiling).

**Source:** [C8] §4.1.2–4.1.3, Tables 4–5; [C7] §3, §5.3.5.2, Table 5-10, Appendix I2;
[C9] §6.5 Eqs. (9)–(12).
**Confidence:** `verified` (standard text obtained verbatim from two standards).

---

## 6. The conversion we need: $\Delta\overline{t}_r$ and $\Delta t_o$

### 6.1 Derivation

The engine's linearised radiant exchange per unit $A_D$ is $R = h_r(t_{cl} - \overline{t}_r)$
with (`STANDARDS.md` §2.5, §5.5; ISO 9920 Eq. 26)

$$h_r = 4\,\varepsilon\,\sigma\,\frac{A_r}{A_D}\left(273.2 + \frac{t_{cl}+\overline{t}_r}{2}\right)^{3}$$

Define $\Delta\overline{t}_r$ as the increment in mean radiant temperature that delivers the same
extra absorbed flux as the fire:

$$h_r\,\Delta\overline{t}_r \;=\; \alpha_{fire}\,\frac{A_p}{A_D}\,E$$

$$\boxed{\;\Delta\overline{t}_r \;=\; \frac{\alpha_{fire}}{\varepsilon}\cdot\frac{A_p}{A_D}\cdot\frac{E}{h_r}\;=\;\frac{f\,E}{h_r},\qquad f \equiv \frac{\alpha_{fire}}{\varepsilon}\cdot\frac{A_p}{A_D}\;}$$

The $\alpha_{fire}/\varepsilon$ ratio appears because $h_r$ already carries the body's long-wave
emissivity; it is the same device as [C7] Eq. (C-2), $\alpha_{LW}\,ERF_{solar} = \alpha_{SW}\,E_{solar}$.

For the design case (computed here): $\alpha_{fire} = 0.84$, $\varepsilon = 0.95$,
$A_p/A_D = 0.202$ (seated) ⟹

$$f = \frac{0.84}{0.95}\times 0.202 = \mathbf{0.179}\ \ \text{(seated)}, \qquad \mathbf{0.224}\ \ \text{(standing)}$$

✅ **Cross-check against the ASHRAE SolarCal chain.** [C7] Eq. (C-1) is
$ERF = f_{\mathrm{eff}}h_r(\overline{t}_{r,lw}-t_a)$ and Eq. (C-5) is
$E_{dir} = f_p f_{\mathrm{eff}} f_{bes} T_{sol} I_{dir}$; composing them, $f_{\mathrm{eff}}$
cancels and the recovered coefficient is $f_p (\alpha_{SW}/\alpha_{LW})/h_r$, identical to the
boxed result up to one factor of $\varepsilon$ (within 5 %). The two routes agree.

**Confidence:** `verified` (the structure is forced by [C7] Appendix C; the arithmetic is
computed here).

### 6.2 ⚠️ $h_r$ is the biggest soft spot: and it does not matter

`STANDARDS.md` §5.5 already establishes that $h_r \approx 4.7\ \mathrm{W\,m^{-2}K^{-1}}$ is a
conventional seed value, not a consequence of the formula, and that $h_r$ falls ~35 % from
20 °C to −20 °C. Evaluating the formula for a seated person ($A_r/A_D = 0.696$,
$\varepsilon = 0.95$) (computed here):

| $T_m = 273.2 + (t_{cl}+\overline{t}_r)/2$ | $h_r$ (W m⁻² K⁻¹) |
|---|---|
| 273 K (0 °C) | 3.05 |
| 283 K (10 °C) | 3.40 |
| 293 K (20 °C) | 3.77 |
| 303 K (30 °C) | 4.17 |

[C7]'s own SET source code (Normative Appendix D) seeds `CHR = 4.7` then iterates to
`CHR = 4.0*0.95*SBC*((TCL+TR)/2+273.15)^3 * 0.7` for sitting and `* 0.73` for standing , 
confirming both the formula and the $A_r/A_D$ values. Verbatim comment in [C7]: "0.7 ratio
between radiation area of the body and the body area".

**Confidence:** `verified` (formula and $A_r/A_D$ obtained from [C7] source listing; consistent
with `STANDARDS.md` §2.5/§5.5).

### 6.3 🔴 The key algebraic result: $h_r$ cancels in operative temperature

The engine computes $t_o = (h_c t_a + h_r \overline{t}_r)/(h_c+h_r)$. Adding
$\Delta\overline{t}_r$ to $\overline{t}_r$ gives

$$\Delta t_o = \frac{h_r\,\Delta\overline{t}_r}{h_c+h_r} = \frac{h_r}{h_c+h_r}\cdot\frac{f E}{h_r} \;=\; \boxed{\;\frac{f\,E}{h_c+h_r}\;}$$

**$h_r$ disappears.** The uncertainty in $h_r$: the largest single parameter uncertainty in
this chain: has *no effect* on the operative-temperature benefit of the fire, provided the
engine uses the **same** $h_r$ in $\Delta\overline{t}_r$ and in the $t_o$ blend.

🔴 **The failure mode this creates.** If the code hard-codes $h_r = 4.7$ inside the campfire
module while the thermal model elsewhere computes $h_r = 3.4$ from temperature, the cancellation
breaks and the fire's benefit is understated by 28 %: or, with the errors reversed, overstated
by 38 %. **Compute $\Delta t_o$ directly from $f E/(h_c+h_r)$ and derive $\Delta\overline{t}_r$
from it, rather than the other way round.**

**Confidence:** `verified` (algebra on two equations both verbatim from standards:
`STANDARDS.md` §6 / [C7] Appendix A for $t_o$, §6.1 above for $\Delta\overline{t}_r$).

### 6.4 Design-case values

Point source, $\chi_{rad}\dot Q = 1.5$ kW, seated receiver at $z_t = 0.60$ m, source at
$z_s = 0.15$ m, $f = 0.179$, $h_r = 3.40\ \mathrm{W\,m^{-2}K^{-1}}$ ($T_m = 283$ K),
$h_c = 3.1\ \mathrm{W\,m^{-2}K^{-1}}$ (still air, `STANDARDS.md` §5.4, Mitchell 1974,
$v < 0.2\ \mathrm{m\,s^{-1}}$). All computed here.

| $r$ (m) | $E$ (W m⁻²) | $\Delta\overline{t}_r$ (K) | $\Delta t_o$ (K), still air |
|---|---|---|---|
| 1.00 | 99 | 5.21 | 2.73 |
| **1.20** | **73** | **3.82** | **2.00** |
| 1.30 | 63 | 3.31 | 1.73 |

Sensitivity to the source-strength bracket at $r = 1.2$ m:

| Case | $\chi_{rad}\dot Q$ (kW) | $E$ (W m⁻²) | $\Delta\overline{t}_r$ (K) | $\Delta t_o$ (K) |
|---|---|---|---|---|
| Low ($\dot Q=7$, $\chi=0.15$) | 1.05 | 51 | 2.67 | 1.40 |
| ⭐ **Design** ($\dot Q=10$, $\chi=0.15$) | **1.50** | **73** | **3.82** | **2.00** |
| Mid-high | 2.40 | 116 | 6.11 | 3.19 |
| High ($\dot Q=16$, $\chi=0.25$) | 4.00 | 194 | 10.18 | 5.32 |

### 6.5 How conservative is the recommendation, and why

$\Delta\overline{t}_r = 3.8$ K at 1.2 m carries the following deliberate biases, each toward
*understating* the fire:

| Choice | Conservative factor | Basis |
|---|---|---|
| $\chi_{rad} = 0.15$ rather than 0.25 | **1.7×** | [C2] measured 0.15 at 22–47 kW; 0.25 only appeared at 340–740 kW |
| $\dot Q = 10$ kW rather than 16 kW | **1.6×** | Heskestad inversion at $D = 0.3$ m; 0.4–0.5 m beds are plausible |
| Point source rather than solid flame | **1.27×** | §4.5; the $4/\pi$ structural factor |
| $\alpha_{fire} = 0.84$ rather than 0.95 | **1.13×** | [C6] spectral split; §5.3 |
| Ignoring the 3.0–4.5 µm instrumental blind band | (1.3× on [C6] only) | [C13]; §4.7 |
| Ignoring the glowing ember/char bed as a second radiator | unquantified | §10 item 11 |

Multiplying the four independent factors gives **~3.9×** between the design value and a
plausible upper bound; the §6.4 table's low-to-high span is 3.8×, consistent. ✅ **The
recommendation sits near the bottom of the credible range, by construction.** If the engine's
verdict flips between $\Delta\overline{t}_r = 2.7$ K and 10 K, the user should be told the fire
is marginal rather than given a number.

⚠️ **What is *not* conservative about it.** Three assumptions could make the real fire warmer
than modelled in ways not captured above: the ember bed (unmodelled second source), the fire's
convective plume warming the air immediately around the person ([C6] measured air-temperature
rises of 3.5–3.9 K at 1.5 m, though on the windward side and they attribute it partly to sensor
radiation error), and conduction/shielding effects from sitting close to warmed ground. None of
these are in the model. They are listed in §10, not silently absorbed.

---

## 7. The asymmetry caveat, quantified

### 7.1 A real campfire at 1.5 m blows through every published limit

The radiant temperature asymmetry produced by a campfire, as **measured** by [C6] at 1.5 m:

$$\Delta t_{pr} = t_{pr,\mathrm{front}} - t_{pr,\mathrm{back}} = 53.5 - 19.5 = \mathbf{34.0\ K}\ \text{(fire 1)}, \qquad 55.9 - 18.1 = \mathbf{37.8\ K}\ \text{(fire 2)}$$

(computed here from [C6]'s reported values; the back-side plane radiant temperature "did not
rise at all", average 19.5 °C and 18.1 °C during the two fires).

Against the published criteria:

| Criterion | Limit | Campfire at 1.5 m |
|---|---|---|
| ASHRAE 55-2023 Table 5-10, wall warmer than air | $< 23$ K | **34–38 K: fails by 1.5×** |
| ISO 7730:2005 Eq. (12) validity range, warm wall | $\Delta t_{pr} < 35$ K | **at or beyond the edge of the fitted data** |
| ASHRAE 55 implied dissatisfaction at the limit | 5 % | **off-scale; not extrapolable** |

🔴 **The honest headline on asymmetry: a real campfire at sociable distance sits outside the
domain of the thermal-comfort standards.** The ISO 7730 warm-wall curve cannot be evaluated at
38 K, and at its 23 K ceiling it already gives $PD = 3.9\ \%$ (computed here from Eq. 12). Our
design fire is 4–7× smaller than [C6]'s, so it is not automatically over the limit: converting its own
$\Delta\overline{t}_r$ to an asymmetry with §7.5 gives **12.5 K** at the design value and
**8.7–33.3 K** across the bracket: the same order as the ASHRAE limit, and over it at the top
of the range.

**Source:** [C6] (measured); [C7] Table 5-10; [C9] Eq. (12).
**Confidence:** `verified` for the limits; `single-source` for the measured 34–38 K.

### 7.2 Front/back is the *best* orientation for this, though

[C9] §6.5 states explicitly that the Figure 4 curves are for side-to-side asymmetry and that
"no other positions of the body in relation to the surfaces (e.g. front/back) cause higher
asymmetry discomfort": so applying a warm-wall curve to a front/back campfire over-states the
discomfort, and the real tolerance is somewhat better than the table suggests. That is the one
piece of good news in this section, and it is standard text, not inference.

### 7.3 Measured skin-temperature asymmetry

No study measuring front/back skin or clothing surface temperature **beside a fire** was found.
Three adjacent literatures exist and were partially reached:

- Asymmetric radiant-panel chamber studies report a largest local skin-temperature difference
  of **3–4 K at the upper arm**, with a reported linear relationship between asymmetric skin
  temperature difference and asymmetric thermal sensation vote. ⚠️ From a search-result summary;
  the paper was not fetched. `UNVERIFIED: do not ship`.
- Thermal-manikin studies of seated subjects in anterior–posterior, left–right and up–down
  asymmetric radiant fields exist (Journal: *Building and Environment*), but only abstracts were
  reachable.
- [C6] measured the *environment*, not the person: the back-facing radiometer saw **zero** rise
  at 1.5, 2.5 and 3.5 m. That is the cleanest available statement of the asymmetry's magnitude
  on the environment side.

**Confidence:** `UNVERIFIED, do not ship` for any skin-temperature number. §10 item 13.

### 7.4 Is "whole-body benefit, no extremity benefit" defensible?

⭐ **Yes, and it is the better-founded of the two obvious choices: but say *why* in the code.**

In favour:

1. **The radiation is strictly one-sided and does not wrap.** [C6] measured *no* rise at all on
   the back-facing sensor at any distance. A fire warms what it can see.
2. **$A_p/A_D = 0.202$ is a whole-body average** ([C7] §C4). It is the correct weight for the
   whole-body heat balance, and it is *definitionally wrong* for a body segment: it says
   nothing about how the 0.202 is distributed between torso front, shins and hands.
3. **The standards' own local-discomfort machinery is separate from the whole-body index** , 
   ISO 7730 computes $PMV/PPD$ *and* local discomfort ($DR$, vertical gradient, asymmetry,
   floor temperature) independently and requires both ([C9] §6; [C7] §5.3.5). Splitting
   whole-body gain from local verdicts mirrors the standards' structure rather than departing
   from it.
4. It is conservative: it withholds a benefit that may partly exist (hands held out to a fire
   receive far *more* than 0.202 of $E$).

Against / limits:

- ⚠️ It will be **wrong in the other direction for hands and face**, which a user deliberately
  points at the fire. A segment-resolved model would give the hands a projected-area fraction
  well above 0.2 and the back of the calves essentially zero.
- The better-founded split would be a **multi-segment radiant exchange** (a 25- or 65-node
  physiological model with per-segment view factors to the flame). That machinery is not in this
  library and no fetched source provides per-segment projected-area factors toward a
  near-horizontal point source.

**Recommendation.** Apply $\Delta\overline{t}_r$ to the whole-body balance; apply **zero** to
extremity verdicts; and surface an explicit asymmetry flag whenever
$\Delta t_{pr,\mathrm{est}} \gtrsim 23$ K, i.e. $\Delta\overline{t}_r \gtrsim 7.0$ K for a seated
person (§7.5) (whenever the ASHRAE 55 warm-wall limit is exceeded) because at that point the whole-body number is no longer
a sufficient description of the environment, which is exactly what [C8] §4.1.3 says the
asymmetry concept exists to detect.

**Confidence:** `verified` for the standards-structure argument; `single-source` for the
one-sidedness magnitude ([C6]); the recommendation itself is an engineering judgement, labelled
as such.

### 7.5 Converting $\Delta\overline{t}_r$ back to an asymmetry, so the flag can fire

The engine computes $\Delta\overline{t}_r$; the standards' limits are on $\Delta t_{pr}$. The two
are related exactly, because both derive from the same absorbed flux. Linearising the plane
radiant temperature about ambient, $\Delta t_{pr} = \alpha_{fire} E/(4\varepsilon\sigma T^3)$,
while $\Delta\overline{t}_r = (\alpha_{fire}/\varepsilon)(f_p f_{\mathrm{eff}})E/
\left(4\varepsilon\sigma (A_r/A_D) T^3\right)$ with $A_r/A_D = f_{\mathrm{eff}}$. Both
$f_{\mathrm{eff}}$ and $T^3$ cancel:

$$\boxed{\;\Delta t_{pr} \;=\; \frac{\varepsilon}{f_p}\,\Delta\overline{t}_r\;}$$

$= 3.28\,\Delta\overline{t}_r$ seated ($f_p = 0.290$), $= 2.71\,\Delta\overline{t}_r$ standing
($f_p = 0.350$) (computed here). Note it depends on $f_p$, **not** on $A_p/A_D$: dividing by
$A_p/A_D = 0.202$ instead (the obvious-looking move) overstates the asymmetry by $1/f_{\mathrm{eff}} = 1.44\times$.

| Quantity | Design (1.2 m) | Low bracket | High bracket | 0.75 m | [C6] at 1.5 m |
|---|---|---|---|---|---|
| $\Delta\overline{t}_r$ (K) | 3.82 | 2.67 | 10.18 | 8.19 | 15.4 (standing) |
| $\Delta t_{pr}$, linearised (K) | **12.5** | 8.7 | 33.3 | 26.8 | 41.8 |
| $\Delta t_{pr}$, exact 4th-power (K) | 11.5 | 8.2 | 28.1 | - | - |
| vs ASHRAE 55 limit of 23 K | pass | pass | **fail** | **fail** | **fail** |

✅ **Cross-check:** for [C6]'s fire the formula predicts 41.8 K against the 37.8 K actually
measured: 11 % high, in the right direction for a linearisation (the exact 4th-power form
always gives less). This is an independent validation of the whole §5–§6 chain against field
data, using only [C6]'s radiometer fluxes as input.

⚠️ The linearised form runs 9–19 % high at these magnitudes (table row 2 vs row 3). Use the
exact form, $\Delta t_{pr} = \left[(\alpha_{fire}E + \varepsilon\sigma T_0^4)/(\varepsilon\sigma)\right]^{1/4} - T_0$,
if the flag's exact trip point matters.

**Confidence:** `verified` (algebra on verified definitions); the cross-check against [C6] is
`single-source`.

---

## 8. Wind and distance sensitivity

### 8.1 Distance: not quite inverse-square at this range

The point-source model is inverse-square in the **slant** distance $d$, but the engine's input
is the *horizontal* distance $r$, and $d^2 = r^2 + (z_t - z_s)^2$ with
$z_t - z_s = 0.45\ \mathrm{m}$. The effective local exponent $n$ in $E \propto r^{-n}$ is
therefore (computed here):

| Interval | local exponent $n$ |
|---|---|
| 0.75 → 1.0 m | 1.57 |
| 1.0 → 1.3 m | 1.73 |
| 1.2 → 2.0 m | 1.84 |
| 1.5 → 3.0 m | 1.91 |

ℹ️ **Use $d$, not $r$.** Assuming pure $r^{-2}$ while anchoring at 1.2 m over-predicts the
falloff and under-predicts the fire at close range by up to ~10 % at 0.75 m. Beyond 2 m the
distinction is immaterial.

### 8.2 ⭐ The table the engine needs

Design case: $\chi_{rad}\dot Q = 1.5$ kW, seated, $f = 0.179$, $h_r = 3.40$,
$h_c = \max(3.1,\ 8.3\,v^{0.6})$ (`STANDARDS.md` §5.4: $h_c = 3.1$ for
$v < 0.2\ \mathrm{m\,s^{-1}}$, $h_c = 8.3 v^{0.6}$ for $0.2 < v < 4\ \mathrm{m\,s^{-1}}$,
Mitchell 1974). All values computed here.

| $r$ (m) | $E$ (W m⁻²) | $\Delta\overline{t}_r$ (K) | $\Delta t_o$ still (K) | $\Delta t_o$ @1 m/s | $\Delta t_o$ @2 m/s | $\Delta t_o$ @4 m/s |
|---|---|---|---|---|---|---|
| 0.75 | 156 | 8.19 | 4.28 | 2.38 | 1.74 | 1.24 |
| 1.00 | 99 | 5.21 | 2.73 | 1.51 | 1.11 | 0.79 |
| **1.20** | **73** | **3.82** | **2.00** | **1.11** | **0.81** | **0.58** |
| **1.30** | **63** | **3.31** | **1.73** | **0.96** | **0.70** | **0.50** |
| 1.50 | 49 | 2.56 | 1.34 | 0.74 | 0.54 | 0.39 |
| 2.00 | 28 | 1.49 | 0.78 | 0.43 | 0.32 | 0.23 |
| 3.00 | 13 | 0.68 | 0.36 | 0.20 | 0.14 | 0.10 |

🔴 **$\Delta\overline{t}_r$ does not depend on wind; $\Delta t_o$ does, strongly.** The
$\Delta\overline{t}_r$ column is the same at every wind speed: the fire's radiation is
unaffected by how fast the person is losing heat convectively. The benefit *in operative
temperature* collapses because $h_c$ grows: from 3.1 W m⁻² K⁻¹ still to 12.6 at 2 m/s. **At
2 m/s the fire at 1.2 m is worth 0.81 K: the same as sitting 1.96 m away in still air**
(computed here).

### 8.3 What wind does to the fire itself

Three effects, of which only the third is quantified above.

1. **Flame tilt.** Wind leans the flame over, which raises the view factor and the received flux
   for a target **downwind** and lowers it **upwind**. For a seated person this means the benefit
   becomes strongly direction-dependent at the same radius. ⚠️ No fetched source gives a tilt
   correlation validated at 0.3 m scale; [C4] discusses windblown flames and reproduces
   wind-tilt figures, but its equations are page images. `UNVERIFIED` as a quantitative
   correction.
2. **Fire intensity.** Wind increases air entrainment and can raise $\dot Q$ (and strip heat
   from the fuel bed). [C3] notes that in the Alger & Capner data "the range of results for each
   test configuration was very wide with variations in heat flux of a factor of two or more…
   These variations appear to be due to wind effects." ⚠️ **A factor of two in received flux,
   attributed to wind, in a liquid-pool dataset.** That is a reasonable order for the
   uncertainty wind introduces at campfire scale too, and it dwarfs everything in §6.5.
3. **Convective loss from the person.** Fully captured by $h_c$ in §8.2, via the
   already-verified `STANDARDS.md` §5.4 correlation.

ℹ️ Direction matters twice over: downwind of the fire you get the tilted flame's extra view
factor *and* the warm plume, but you also get the smoke. Upwind you get neither. The engine has
no wind-direction input; absent one, the still-air-to-2 m/s span in §8.2 is the honest envelope.

**Confidence:** `verified` for the $h_c$ effect (§8.2 arithmetic on a verified correlation);
`single-source` for the factor-of-two wind scatter ([C3]); `UNVERIFIED` for any tilt correction.

---

## 9. ⭐ Recommended parameter block

**This is the block to code against.** Confidence labels are per-line and binding: anything
marked `UNVERIFIED` must not be shipped as a silent default.

### 9.1 Equations to implement

$$E(r) = \frac{\chi_{rad}\,\dot Q}{4\pi\left[r^2 + (z_t-z_s)^2\right]} \tag{F1}$$

$$\Delta t_o = \frac{f\,E}{h_c+h_r}, \qquad \Delta\overline{t}_r = \frac{f\,E}{h_r}, \qquad f = \frac{\alpha_{fire}}{\varepsilon}\cdot\frac{A_p}{A_D} \tag{F2}$$

Compute $\Delta t_o$ from (F2) using **the engine's own $h_c$ and $h_r$** (§6.3), and report
$\Delta\overline{t}_r$ as a derived diagnostic only.

### 9.2 Parameters

| Parameter | Value | Units | Kind | Confidence | Source |
|---|---|---|---|---|---|
| $\dot Q$ design | **10** | kW | **our estimate** (inverted flame height) | `single-source` | [C10] correlation + [C2] bracket |
| $\dot Q$ range | 7 – 16 | kW | our estimate | `single-source` | §2.5 |
| $\chi_{rad}$ design | **0.15** | - | **measured** (22 & 47 kW wood cribs, free burn) | `single-source` | [C2] |
| $\chi_{rad}$ range | 0.15 – 0.25 | - | measured | `single-source` | [C2] |
| $\chi_{rad}\dot Q$ design | **1.5** | kW | derived | `single-source` | §3.5 |
| $z_s$ (source height $=L_f/2$) | **0.15** | m | convention | `verified` | [C4] §5.3.1 |
| $z_t$ seated / standing | **0.60** / 1.10 | m | **measured convention** | `verified` | [C8] Table 5; [C7] §3 |
| $A_p/A_D$ seated, frontal, horizontal | **0.202** | - | **measured** ($f_p{=}0.290 \times f_{\mathrm{eff}}{=}0.696$) | `verified` | [C7] §C1, §C4 |
| $A_p/A_D$ standing, frontal, horizontal | 0.254 | - | measured ($0.350 \times 0.725$) | `verified` | [C7] §C1, §C4 |
| $\alpha_{fire}$ | **0.84** | - | **our estimate** from a measured spectral split | `single-source` | [C6] + §5.3 |
| $\varepsilon$ (body long-wave) | **0.95** | - | measured/standard default | `verified` | [C7] §C1 |
| $f$ seated / standing | **0.179** / 0.224 | - | derived | `single-source` | §6.1 |
| $h_r$ | engine's own, $4\varepsilon\sigma (A_r/A_D) T_m^3$ | W m⁻² K⁻¹ | standard formula | `verified` | [C7] App. D; `STANDARDS.md` §5.5 |
| $h_c$ | engine's own, $\max(3.1,\,8.3 v^{0.6})$ | W m⁻² K⁻¹ | standard correlation | `verified` | `STANDARDS.md` §5.4 |
| **$\Delta\overline{t}_r$ at 1.2 m, design** | **3.8** | K | **our estimate** | `single-source` | §6.4 |
| $\Delta\overline{t}_r$ at 1.2 m, range | 2.7 – 10.2 | K | our estimate | `single-source` | §6.4 |
| **$\Delta t_o$ at 1.2 m, still air, design** | **2.0** | K | **our estimate** | `single-source` | §6.4 |
| $\Delta t_o$ at 1.2 m, 2 m/s | 0.81 | K | our estimate | `single-source` | §8.2 |
| Minimum distance for model validity | **0.75** | m | **measured criterion** ($L/D>2.5$) | `verified` | [C4] §5.5 (Modak 1977) |
| Distance at which benefit is negligible | 4.0 | m | **measured** ("no thermal effect… at 4 m and above") | `single-source` | [C6] |
| $\Delta t_{pr}$ conversion | $(\varepsilon/f_p)\,\Delta\overline{t}_r$ = $3.28\,\Delta\overline{t}_r$ seated | K | derived | `verified` | §7.5 |
| $\Delta t_{pr}$ at 1.2 m, design | 12.5 (exact 11.5) | K | our estimate | `single-source` | §7.5 |
| Asymmetry flag threshold | **23** (i.e. $\Delta\overline{t}_r > 7.0$ K) | K | **standard limit** (wall warmer than air) | `verified` | [C7] Table 5-10 |
| Extremity allocation of the benefit | **0** | - | engineering judgement | `single-source` | §7.4 |
| $E_f$ if a solid-flame model is ever used | $\chi_{rad}\dot Q/(\pi D L_f)$, ≈ 5.3 | kW m⁻² | derived (energy-conserving) | `single-source` | [C1] Eq. (2); §4.4 |
| 🔴 $E_f$ from Shokri & Beyler | **do not use** below $D = 1$ m | kW m⁻² | out of stated range | `verified` | [C3] |
| 🔴 $\chi_{rad} = 0.3$–$0.4$ | **do not use** for a campfire | - | wrong regime (large liquid pools) | `verified` | [C1], [C2] |

### 9.3 Behaviour at the edges

| Condition | Required behaviour |
|---|---|
| $r < 0.75$ m | Point source invalid ($L/D<2.5$) and over-predicts. **Clamp $E$ to its value at 0.75 m** and emit a warning; do not extrapolate. |
| $r > 4$ m | Set $\Delta\overline{t}_r = 0$: [C6] measured no thermal effect at ≥ 4 m. |
| $v > 4$ m/s | Outside the stated range of the $8.3v^{0.6}$ correlation (`STANDARDS.md` §5.4). Treat the fire's benefit as unreliable. |
| $\Delta\overline{t}_r > 7.0$ K (equivalently $\Delta t_{pr,\mathrm{est}} > 23$ K, §7.5) | Raise the asymmetry flag (§7.4); the whole-body number alone is insufficient. |
| Person is not facing the fire | $A_p/A_D$ drops to 0.150 (seated, side-on; [C7] §C4). The engine has no orientation input: §10 item 7. |

---

## 10. Open questions / could not verify

Numbered for citation. Items marked 🔴 would change a shipped number.

1. 🔴 **No published heat-release-rate measurement of an actual campfire or recreational fire
   pit exists in anything reachable.** $\dot Q = 10$ kW is inferred from a flame-height
   correlation whose own source says it applies to fuels "which do not have substantial
   in-depth combustion": i.e. not wood cribs. This is the single weakest link in the chain.
2. 🔴 **Heskestad's 0.235 coefficient has no verified wood value.** [C10] states it depends on
   the fuel's heat of combustion / stoichiometric air ratio and that gasoline needs 0.2; no
   wood-specific figure was found. A 0.2 coefficient would raise the inferred $\dot Q$ by 70 %.
3. 🔴 **$\chi_{rad} = 0.15$ rests on one paper** ([C2]), measured on machined spruce-pine cribs
   at 4–8 % moisture, not on split campsite logs at 20 %+. The direction of the error is
   unknown.
4. **The mixed-oak-litter radiative fraction of 0.17 (range 0.13–0.21)** came from a
   search-result summary; the underlying paper (Kremens / Dickinson et al., radiant flux density
   in mixed-oak forest surface fires) was identified but not fetched. It would be the best
   available second source for item 3.
5. **Three-stone cooking-fire firepower.** Values of 3.1 kW and of 3.78 / 4.72 / 5.79 kW were
   returned for Jetter & Kariher (2009, *Biomass & Bioenergy* 33(2):294–305) and related
   cookstove work, but no paper giving a measured firepower was fetched. This would be a
   genuinely independent low-end anchor for item 1.
6. **No measured emissive power for a *wood* flame** was obtained in kW/m². The "wood crib flame
   emissivity 0.1–0.6" figure is a search-result paraphrase. The energy-conserving
   $E_f = 5.3\ \mathrm{kW\,m^{-2}}$ is arithmetic, not measurement.
7. 🔴 **$f_p$ for a source *below* the horizontal is not tabulated anywhere.** [C7]'s tables
   start at 0° altitude; our source is 21° below. We use the 0° value. Also, **the engine has no
   body-orientation input**, so the side-on case ($A_p/A_D = 0.150$, a 26 % reduction) cannot be
   expressed.
8. **ISO 7726:1998 Table 2 (required measuring accuracy) and Annexes C and G could not be
   extracted**: those pages are scanned images in the only reachable copy [C8]. So the
   standard's own accuracy requirement for plane radiant temperature, and its Annex G treatment
   of operative temperature, are unverified here. ASHRAE 55 Table 7-1 was obtained instead
   (plane radiant temperature range 0–50 °C, accuracy ±0.5 °C; directional radiation
   ±5 W/m²).
9. **ISO 7726 Table B.1 projected area factors** (0.18/0.22/0.30 seated, 0.08/0.23/0.35
   standing) are from a search-result summary, not the fetched standard. They agree with [C7] to
   6 %, which is why §5.2 is labelled `verified` on the ASHRAE side only.
10. **ISO 7730:2005 Annex A Table A.1** (category A/B/C limits) is outside the fetched preview.
    Reported category limits of < 3 K and < 5 K for radiant asymmetry are search-summary only
    and were **not** used; §7 uses the fetched ASHRAE 55 Table 5-10 instead.
11. 🔴 **The glowing ember / char bed is not modelled.** A campfire's bed of embers is a
    low-temperature, high-emissivity, near-horizontal radiator whose radiation goes mostly
    upward and would contribute a different spectrum and view factor from the flame. No fetched
    source separates ember-bed from flame radiation for a wood fire. This is the most likely
    reason the model would *under*-predict reality.
12. **The convective plume's effect on local air temperature is not modelled.** [C6] measured
    air-temperature rises of 3.5–3.9 K at 1.5 m but could not rule out radiation error on the
    thermometers, and wrote: "Further research should be performed to verify whether campfires
    raise the air temperature around them."
13. 🔴 **No front/back skin or clothing surface temperature measurement beside a fire was
    found.** The "3–4 K at the upper arm" figure from asymmetric radiant-panel chamber work is a
    search-result summary and was not used in any recommendation.
14. **Per-segment projected-area factors toward a near-horizontal source** (needed for a
    better-founded whole-body/extremity split than "all or nothing") were not found.
15. **No validated flame-tilt correction at 0.3 m scale.** Wind direction relative to the person
    is therefore an unmodelled factor of order 2 in received flux ([C3], §8.3).
16. **[C6]'s instrumental blind band (3.0–4.5 µm) is unquantified for a real flame.** The 21–29 %
    blackbody estimate (§4.7) ignores the fact that flame emission is band-structured and that
    the CO₂ 4.3 µm band sits inside the gap; the true shortfall could be larger.
17. **Fuel moisture content's effect on $\dot Q$ and $\chi_{rad}$ is unquantified.** All wood
    HRR data obtained are for dry wood (4–8 % in [C2], kiln-dry products in [C12]).
18. **[C6] is a single night, two fires, one site, one instrument**: and it is the only
    measurement of a real campfire's radiant field we have. Every cross-check in this document
    traces back to it.
19. **ISO 7726:2025 / EN ISO 7726:2025** exist (a new edition superseding the 1998 version used
    here). Not obtained; the definitions quoted in §5.4 are from the 1998 text and may have
    been renumbered or revised.
