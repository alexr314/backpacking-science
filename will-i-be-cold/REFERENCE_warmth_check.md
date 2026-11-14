# Skill: "Will I be warm enough?" — a clo/MET warmth check for a backpacking trip

Paste this whole file to your agent, then paste your clothing list and sleep gear. The agent
should run the procedure below and return the verdict table at the end.

## What we're computing

Comfort depends on three things: how much heat your body makes (activity level, in MET), how
cold the air is, and how much insulation sits between you and it (in clo). The standard
steady-state comfort relation, good to roughly ±1 °C for a resting-to-moderate-activity person:

    clo_required = (33 − T_air_°C) / (0.155 × M)

- `33` is mean skin temperature in °C.
- `T_air_°C = (T_°F − 32) × 5/9`.
- `M` is metabolic heat in W/m² of body surface: **1 MET = 58 W/m²**.
- `0.155` converts clo to m²·K/W.

If the clo you are wearing ≥ clo_required at that activity and temperature, you're comfortable.
Margin of ±0.3 clo is "marginal"; below −0.3 is "cold."

Two caveats the agent must state, not silently skip:
1. **Wind.** The equation assumes still air. On an exposed ridge without a windproof outer layer,
   treat the effective temperature as 5–10 °F colder. A rain shell (jacket + pants) restores most of it.
2. **Wet.** Wet fleece or wet down loses most of its clo. Synthetic insulation and Alpha Direct
   keep more. The check assumes dry layers.

## Activity levels (MET → W/m²)

| Phase | MET | W/m² | Typical duration |
|---|---|---|---|
| Hiking with a pack, rolling terrain | 3.0 | 175 | hours |
| Short rest / lunch stop, standing or sitting | 1.3 | 76 | 20–45 min |
| Sitting in camp, evening | 1.1 | 64 | 1–3 h |
| Asleep | 0.8 | 47 | 8 h |

## Garment clo values (intrinsic contribution to the whole-body ensemble; add them up)

Use the closest match. These are standard ASHRAE-style values adjusted for outdoor garments.

| Garment | clo |
|---|---|
| Underwear, briefs | 0.04 |
| Polyester sun hoodie / long-sleeve synthetic shirt | 0.25 |
| Merino base layer, long sleeve (150–200 g/m²) | 0.30 |
| Grid fleece hoodie (Polartec Grid, R1-style, ~200 g/m²) | 0.50 |
| Midweight fleece (300-weight) | 0.60 |
| Polartec Alpha Direct 60 top | 0.45 |
| Polartec Alpha Direct 90 top or leggings | 0.55 |
| Rain shell jacket (unlined) | 0.20 |
| Wind shirt | 0.15 |
| Lightweight down/synthetic puffy, ~2 oz fill 800 FP (e.g. Ghost Whisperer UL) | 1.2 |
| Hooded puffy, ~3 oz fill 800 FP (e.g. Decathlon MT100, Ghost Whisperer) | 1.8 |
| Heavier puffy, ~4.5 oz fill (e.g. Rab Microlight) | 2.3 |
| Synthetic puffy, 60 g/m² (Nano Puff) | 0.9 |
| Synthetic puffy, 100 g/m² (EE Torrid) | 1.3 |
| Hiking pants, thin | 0.25 |
| Running/exercise tights or shorts | 0.15 |
| Long underwear bottoms (merino/synthetic) | 0.30 |
| Alpha Direct 90 leggings | 0.55 |
| Fleece pants | 0.50 |
| Rain shell pants | 0.20 |
| Wool socks + hiking boots | 0.10 |
| Beanie | 0.10 |
| Liner gloves | 0.05 |
| 20 °F-rated quilt/bag, fully zipped/cinched, in bed | 5.5 |
| 30 °F-rated quilt/bag, in bed | 4.5 |
| Same quilt draped over you as a blanket while sitting (leaky) | +2.5 |

Hood up on a fleece or puffy: +0.1. Puffy worn inside the quilt in bed: add its full clo.

## Sleep system: two independent floors

In bed there are two insulation paths and they do **not** substitute for each other:
- **Above you:** the quilt/bag. Needed clo from the equation at 0.8 MET: **5.1 clo at 25 °F,
  5.5 clo at 20 °F.** A reputable 20 °F quilt (Enlightened Equipment, Hammock Gear, Katabatic,
  Zpacks, Western Mountaineering, Feathered Friends) is ~5.5 clo. A budget bag labelled "20 °F"
  (Kelty Cosmic, Marmot Trestles) is an ISO *limit* rating; its *comfort* rating is 31–32 °F ≈
  4.3 clo. Amazon-direct quilts run ~10 °F optimistic.
- **Below you:** the sleeping pad(s). Pad R-values (ASTM F3340, imperial) add across layers
  (foam + inflatable), and **1 R ≈ 1.14 clo**. The same 25 °F requirement under you is **R ≥ 4.0**
  (R ≥ 4.5 for 20 °F). A foam pad alone is R 2; an uninsulated air pad is R 1–1.6; insulated air
  pads are R 3–5.5. The quilt's underside is crushed flat and counts ~0 under you.

## Procedure for the agent

1. Ask for (or take from the message): the clothing list, the sleep gear (bag/quilt rating and
   maker; pad model(s) and R-values), and the trip. If the trip is **the AT in the Great Smoky
   Mountains in mid-November**, use these worst cases: hiking 30 °F, lunch stop 35 °F,
   camp evening 25 °F, asleep 20 °F. Tenting, exposed ridge: apply the wind caveat when no
   shell is worn.
2. Look up each garment's clo in the table (nearest match; say which row you used).
3. For each phase, sum the clo of what would actually be worn in that phase. Be realistic:
   hikers shed layers to avoid sweating, nobody unpacks a quilt for a 30-minute lunch, and in
   camp a quilt draped over the shoulders is fair game.
4. Compute clo_required for each phase at its worst-case temperature.
5. Output the verdict table and a one-paragraph recommendation naming the cheapest fix for any
   "cold" row (a ~3 oz-fill hooded puffy at ~$100, e.g. Decathlon MT100, fixes most of them).

Verdict table format:

| Phase | worst °F | MET | clo needed | clo worn (what) | margin | verdict |
|---|---|---|---|---|---|---|

## Worked example — Andy's list

Clothing: polyester long-sleeve sun shirt (0.25), Mountain Hardwear grid fleece hoodie (0.50),
rain shell jacket (0.20), Alpha 90 leggings (0.55), rain shell pants (0.20), wool socks + boots (0.10).
Everything on at once = **1.80 clo**. No puffy, no beanie, no gloves listed.

| Phase | worst °F | MET | clo needed | clo worn | margin | verdict |
|---|---|---|---|---|---|---|
| Hiking | 30 | 3.0 | 1.3 | 1.8 (all of it); 1.1 without fleece | +0.5 | **fine** — you'll shed the fleece on climbs |
| Lunch stop | 35 | 1.3 | 2.7 | 1.8 (all of it) | −0.9 | **cold** within ~15 min |
| Camp evening | 25 | 1.1 | 3.7 | 1.8; 4.3 with a 20 °F quilt draped | −1.9 / +0.6 | **cold** unless you sit in your sleeping bag |
| Asleep | 20 | 0.8 | 5.5 | depends on bag + pad — not given | ? | **need bag rating and pad R-values** |

Recommendation: the hiking kit is right (Alpha 90 under rain pants is a good cold-legs setup).
What's missing is static insulation. Add **a hooded puffy with ~3 oz of down** (+1.8 clo → 3.6
stopped, 6.1 in camp with the quilt draped) and **a beanie** (+0.1). That turns the lunch stop and
camp rows green. If you'd rather not buy, plan to eat lunch fast and get into the sleeping bag as
soon as you reach camp — workable, not comfortable. For the sleep row, send your bag's maker and
rating and your pad model(s); the test is a reputable 20 °F rating (or ISO comfort ≤ 25 °F) and
combined pad R ≥ 4.
