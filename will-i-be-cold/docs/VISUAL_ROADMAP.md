# Visual roadmap

Alex's direction, 2026-11-13. Items are ordered by when they get built, not by size.

> **Desktop only for now** (Alex, 2026-11-13). Phone is a later port, tracked as R9. Don't
> compromise the desktop design to fit a narrow screen; do keep layout in relative units so the
> port starts from something sane. Hover is therefore a safe interaction, which is what makes
> R5's hover-only bar text viable.
**Art style is settled and liked**: the campfire, the mountain sunset and the overall
simplified/abstract register are the target. Don't redesign them.

---

## Now: structure and the key graphic

### R1. Gear selection becomes its own tab
One panel where you construct your character; the five times of day become tabs you page
through. The character appears in **every** scene (seated at the fire, walking, in the bag) but
*picking* gear happens in one place only.

### R2. The figure stands on the gear tab
The seated posture makes the anatomy hard to read when you are choosing garments. Scenes keep
their posture-appropriate figure; the gear tab gets a standing one.

### R3. Every region splits inner/outer: including torso
The torso not splitting was actively confusing. You must be able to pick inner torso
independently of outer torso, and inner legs independently of outer legs.

### R4. Callout annotations, not a row of cells
Each garment slot is a small callout placed around the figure, joined to its body part by a
**line, possibly angled**. Rules:
- A region with nothing on it **folds up and disappears** (an empty head callout is not a row
  reading "nothing").
- Clicking a callout (e.g. outer torso) **emphasises it and opens it into the picker in place**.
- v1 picker is the current limited list. **Future: type what you want** (free-text search over
  the garment catalogue, and later the brand database).

### R5. The comfort chart becomes a vertical thermometer
- **Vertical**, with an abstract thermometer shape. Vertical matches how people think about
  temperature; left-right does not.
- A **blue→red gradient in absolute terms**, so it moves with the temperature axis rather than
  with the data: icy blue at the bottom, through regular blue, **green ~70 °F, yellow ~80 °F**,
  and a **desaturated dark-red/pink reserved for 90–100 °F**. Alex: "nobody's going camping in
  that hot of weather… certainly not someone using the 'Will I be cold?' tool", so the hot end
  is deliberately academic and must never compete with the red that means *gap*.
- Comfort intervals become **vertical bars**.
- **The bar text is too much: move it to hover.**

### R6. Redo the clouds
Current horizontal pill shapes are wrong. Everything else in the sky is right.

---

## Later: polish Alex explicitly deferred

### R7. Garments render on the character
Not everything needs to be reflected, but the ones that are should read instantly:
- Add a hat → the character wears a hat. Add a beanie → a beanie. **Some of these stack.**
- A sweater makes the silhouette **puffier**.
- Down to a T-shirt → short sleeves, with a **skin-coloured forearm** showing it is short.

### R8. Per-panel animation

**Campfire (sunset panel).** The flame is currently three separate static shapes. It should be
**one parametric shape** that:
1. grows from nothing into the first shape,
2. morphs to the second, then the third,
3. fades out , 
with several instances **staggered** against each other and looping, so they fold over one
another. Colour runs **white → yellow → orange** through the life of each instance. Add small
**particles rising, shrinking and fading**.

**Night.** The sky darkens, the sun goes down, the moon comes up, the fire gets smaller, and
**the whole cycle lengthens** so everything moves more slowly. Particles rise less high and are
smaller.

**Hiking.** A very simple walking cycle for the character, possibly trees passing. Alex flagged
this as the hard one. **Clouds drifting left** is the easy, certain part.

**Picnic / day break.** Deliberately quiet: little should happen. Clouds move, more slowly.

---

### R9. Port to phone
Deferred deliberately. The two things that will fight a narrow screen are the vertical
thermometer and the callouts arranged around the figure; both are being built desktop-first on
purpose. Hover-only detail (R5) will need a tap-to-reveal equivalent when this happens.

---

### R10. The campfire toggle drives the fire animation
A campfire is becoming a real term in the physics (it raises mean radiant temperature; see
`docs/CAMPFIRE.md`). Alex: "the great thing about it is that if you turn it on and off, our
animated fire turns on and off." So the toggle is one control with two effects: the model gains
a radiant source and the scene's fire lights or goes out. When the fire is off the evening scene
should still read as evening, not as a broken illustration: embers, or no hearth at all.

Deliberately conservative on the physics side: the benefit applies to the whole-body balance only
and is **withheld from the extremity verdicts**, because a fire heats your front and not your
back and a steady-state whole-body average would otherwise launder that asymmetry into a comfort
it has not earned.

### R11. Gear is an inventory, not an outfit
The gear page must hold **everything you own**, not one wearable configuration. Alex: "this is
supposed to be all of our gear, right? For instance, on the torso inner, I have to choose one
only, but how do I represent the fact that I might have a T-shirt and a merino wool base layer?"

The engine was always right about this: `coverage()` takes a `GearInventory` of everything owned
and picks subsets per phase. The island's `Kit` collapsed it to one outfit and passed that outfit
as the inventory. Consequences:
- Callouts list everything owned in a slot; multiple torso inners, multiple footwear, all legal.
- The figure becomes a **preview** of one representative configuration (default: the warmest),
  not a statement of what you are wearing. Hovering an item previews it.
- Heading becomes "What's all your gear?"; the invitation is "click a part of the figure and pick
  what you'll pack". The old "dress the character once" line reads as vibe-coded and is gone.
- Headline number is the ensemble clo alone, with the ISO 9920 compression discount behind an
  info icon rather than stated as a puzzle.
- The **hands inner slot is removed**. Liner gloves become an ordinary hands item; if they
  combine with other gloves, the candidate ladder will show it.

### R12. The encounter probability curve
Replaces the p10 to p90 band, which Alex says "doesn't read super well". For each temperature,
**the probability of encountering it during the period**:

    P_encounter(T) = P( min(period) <= T <= max(period) )

**It is not normalized.** A single evening passes through many temperatures, so summed over bins
it exceeds 1. It is a probability per temperature, each independently in [0, 1], and it saturates
near 1 across the bulk of the range: Alex's test case is that seeing 45 degrees F this evening is
near certain. The silhouette is a broad mesa, not a bell and not a ramp.

A second curve, `P(min <= T)`, is what **prices a gap**: if the gear fails below 30, the risk is
that it gets below 30, not that it passes through exactly 30. The two nearly coincide on the cold
limb, which is exactly why conflating them is an easy and invisible bug. They ship under separate
names.

This quantity is a minimum over **correlated** samples, so unlike a marginal it genuinely needs a
correlation model: a nested trip / night / hour error decomposition, evaluated by seeded Monte
Carlo. Treating hours as independent would give the minimum many chances to dip and would badly
overstate the risk of extreme cold.

### R13. The remaining four panels
Alex: "it's past time for us to start building the other pages as well. We've pretty well spec'd
out what they should be. The only thing that's genuinely quite different is sleep, because that
involves the sleep system." Deliberately sequenced **after** the evening recomposition, because
all four inherit its layout and building them first means building them twice.

### R14. Methodology page
"Read before you trust it", the model warnings and the estimated-constants register all come off
the panel: interesting, but nobody reads it there. The content is not deleted; it moves to its own
page, reached by one quiet link at the bottom. The Open-Meteo attribution stays on the panel
itself, because the licence requires it next to the data.

### R15. One parameterised world, not five scenes
Alex, 2026-11-14: the panels should **transition into each other**, not cut. The sun moves
smoothly up and down and the sky fades consistently with where it is; the moon and stars come out
at night, the moon moving and the stars rotating and fading into place; the fire's logs fade in
before it ignites; and the figure should **morph between poses** rather than snap. His own words
on the figure: "Maybe it's something that you're capable of... I think Fable can do stuff like
that."

**This is an architecture constraint, not a polish item.** Five discrete scene components cannot
be interpolated. One scene parameterised by a continuous time of day (plus fire state, weather and
pose) makes every transition fall out of the parameterisation. Poses must share a vertex and
anchor topology for the same reason the flame keyframes do, so a morph is a lerp rather than a
special case per pair.

### R16. Fire ignition and extinction
Toggling the campfire on grows it in: logs fade first, then each flame element turns on and fades
in, bloom with them. Toggling off **stops new instances spawning and lets the living ones finish
their natural life** before fading; the bloom fades out. Nothing is cut short.

### R17. Extremity verdicts annotate the figure
"Hands cold / feet cold / head marginal" moves off a row of chips below the fold and onto the
figure: a leader line to the body part, a label, and a **red outline around that part**, placed on
the figure's left where the raised horizon (R18) gives dark ground to sit on. Same callout
vocabulary as the gear page.

### R18. Camp evening composition fixes
- Raise the horizon: push background, treeline and all of it up by about **one third of the total
  height**, so the figure and fire sit on the ground rather than against the ridges.
- Deepen the opacity of the thermometer panel's black backing.
- Wider margins throughout.
- **Flip the encounter curve and its axis** so it reads outward, away from the thermometer.
- Delete the "TONIGHT, p10 to p90" label.

### R19. Deferred: a real site header
A top-level header with navigation, above and distinct from the tab bar. **The current tab bar is
right and should not change.** Deferred by Alex because there is nothing to connect it to yet.

### R20. Future: the wider tool suite
Trip configuration, a Pareto frontier explorer for sleep systems, and cost-aware gear tools.
Recorded here only so the header (R19) and the information architecture leave room for it. Not
scheduled, and explicitly not to be designed for now.

---

## Status
Alex's assessment at the end of the first panel: **~40 % of the way there overall, ~70 % on art
style alone.** The art direction is working; the structure and the key graphic are what's behind.
