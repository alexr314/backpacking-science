You're taking over a new project: **"Will I Be Cold?"** — a public heat-balance calculator for
backpackers, hosted on Alex's personal site, paired with a YouTube explainer. This workspace is
`~/projects/will-i-be-cold/`. Read, in order: `README.md`, `SPEC.md` (the full spec; §9 has the
decisions already made), `REFERENCE_warmth_check.md` (a worked example of the physics in its
simple form, used on a real trip — treat it as a test vector, not the final model).

## Who you're working with
Alex has a PhD in theoretical physics (also BS math, PhD CS; AI-alignment researcher). Pitch the
physics all the way up — derive, don't hand-wave; cite the standards (ISO 11079 IREQ, ISO 9920,
ISO 23537, ASTM F3340, ISO 7730). He dictates messages, so expect homophones and read past them.
He stops reading long or dense turns: keep turns short, batch findings into one digest, lead with
the decision. Don't give the obvious/modal answer — state a defended opinion and offer alternatives.
Confirm before anything outward-facing or hard to reverse; otherwise make the call and keep moving.

## What was decided (don't relitigate)
- v1 ships **with** place/date forecasting. Open-Meteo (keyless): forecast at any lat/lon with
  `elevation=` lapse correction; Geocoding API for names; Elevation API (90 m DEM) for a dropped
  pin. ≤16 days hourly; beyond that, climatology bands labelled honestly. Manual high/low is a
  fallback. UI: search a place or drop a pin; 2–3 pins for a route.
- Physics engine is its own open-source repo (`heat.ts` + tests + README); the site consumes it
  as an Astro island. Site: `~/projects/personal_website/personal-website` (Astro 2, Tailwind,
  KaTeX already installed — use it for the equations page), Netlify behind Cloudflare. No backend
  for v1. If a proxy is ever needed it goes on the Hetzner box **only** under
  `~/projects/hetzner_policy.md` (read it before touching infra; Alex deploys, agents prepare).
- °F default, °C toggle, SI internally.
- v1 gear ontology = generic categories with clo values (table in SPEC §4). Brand/product
  database is the first post-launch step and is shared with the sibling tool (Pareto-frontier
  gear explorer, price × weight × warmth).
- Build by delegation: physics library and weather/geocoding client as separate subagents with
  contract tests, then the UI.

## The product in one paragraph
Not a layering lookup table. A steady-state heat balance (M − W = (T_sk − T_op)/(I_cl + I_a) + …)
run over a *temperature distribution* for five phases of the day (hiking · day break · camp
evening · camp morning · asleep), for every sensible combination of the gear the user owns,
producing **coverage**: where in the expected temperature range no owned combination keeps them
comfortable. Gaps get a "!" and a one-line fix. Extremities (hands/feet/head) get separate local
verdicts; the core verdict sums garment clo (ISO 9920, ×0.835 ensemble factor). Sleep is two
independent floors: pad R (1 R ≈ 1.14 clo) under, bag/quilt clo over, with clothes-in-bag and
bag-as-blanket-in-camp as toggles. Wind enters through I_a (h_c ∝ v^0.6) and pumping (a shell
zeros it); radiation through operative temperature (clear night sky 15–25 K below air; tent/canopy
restores it). A "runs hot/cold" slider shifts M ±10%.

## Visual brief (Alex's words, paraphrased)
Four or five panels, each a time of day with its own sky: high sun (hiking, picnic break), sunset
with a campfire and a seated figure (camp evening), moon and stars (sleep). Simplified, slightly
abstract digital-art style; pretty. A dress-the-doll figure: inner layers on the left half, outer
on the right; click a body region to pick garments; each configuration gets a thumbnail. Per panel:
a horizontal temperature axis with the expected band, one comfort bar per configuration, and the
uncovered span highlighted. He cares a lot about light and colour; don't ship a generic dashboard.

## Context you won't find in the docs
- The model was built live on a real trip (Smokies AT, Nov 22–24 2026, design low 20–25 °F) and
  the numbers in `REFERENCE_warmth_check.md` (garment clo table, MET table, phase worst-cases)
  were used to make real purchases. Keep them as regression tests when you upgrade to IREQ.
- The chart language Alex liked: see `~/personal/backpacking/gear_research/gear_lab.html` — an
  interactive lab with pad/quilt/puffy scatters, a price×weight frontier with three mark classes
  (eligible / fails floor / can't ship in time), and clo-required curves by MET with ensemble
  bands. Reuse the *ideas* (frontier line, threshold lines, hover tooltips, toggles) and the
  dataviz discipline (validated palette, dark/light themes). `products.csv` next to it (~90
  products with weight/price/R/fill + sources) is the seed for the future brand DB. That folder is
  Alex's private trip planning; copy data out, never link context back in.
- Honest caveats Alex wants surfaced in the tool and the video: steady-state only; ±1 clo
  person-to-person; wet changes everything; Amazon-brand pad R-values are often untested.
- The video outline lives at `~/personal/backpacking/VIDEO_NOTES.md` for now; the tool's end card
  is the link. The tool does not need to exist before the hike; he may film b-roll on the trip.
- Things Alex explicitly does not want: inflatable-pillow-style "trust me" numbers; a town-based
  weather proxy ("vibe-subtracting" for elevation); modal answers.

## First moves I'd suggest
1. Scaffold the physics repo: `heat.ts` with IREQ-style solve, garment table, ensemble rule,
   extremity lookups, sleep module, wind/radiation corrections; tests against ISO 11079 examples
   and the Smokies vectors. Export a pure function `coverage(gear, phases, tempDistributions)`.
2. Weather client: Open-Meteo forecast + geocoding + elevation, with the ≤16-day / climatology
   switch and a diurnal sampler that yields per-phase distributions. Contract-test with recorded
   fixtures.
3. Then the island: doll, panels, coverage. Then the Pareto sibling.
Report back in short digests; one decision per question.
