/**
 * The three connected modelling changes, as regressions.
 *
 * 1. **Garment adjustability**: a garment is continuously adjustable, so a configuration has a
 *    *range* of effective insulation. Venting moves the warm limit and never the cold limit.
 * 2. **Coverage against the envelope**: spurious "Goldilocks" interior gaps disappear because
 *    the physics closes them; genuinely unbridgeable interior gaps are still reported, in their
 *    own words and with their own severity.
 * 3. **The layering ladder**: a nested chain, pruned to the rungs that earn their place.
 *
 * Plus the campfire: mean radiant temperature, never metabolic rate, and withheld from the
 * extremity verdicts.
 */
import { describe, expect, it } from 'vitest';
import {
  UNVERIFIED_CONSTANTS,
  coverage,
  type CoverageGap,
  type GearInventory,
  type PhasePlan,
  type TemperatureBand,
} from './coverage.js';
import {
  ADJUSTABILITY_DEFAULTS,
  DRAPED_ADJUSTABILITY,
  adjustabilityClass,
  ensembleInsulation,
  garment,
  garmentAdjustability,
  GARMENTS,
  type Garment,
} from './garments.js';
import {
  assess,
  configurationVentableClo,
  metToWm2,
  type ClothedConfiguration,
  type PhaseConditions,
} from './assess.js';
import { CAMPFIRE, campfireEffect, resolveEnvironment, type CampfireContext } from './environment.js';
import { CLOTHING_EMISSIVITY } from './ireq.js';
import { celsiusToFahrenheit, fahrenheitToCelsius } from './units.js';

const F = fahrenheitToCelsius;
const toF = celsiusToFahrenheit;

const band = (lowF: number, highF: number): TemperatureBand => ({
  p10: F(lowF),
  p50: F((lowF + highF) / 2),
  p90: F(highF),
});

/** The same garment with every adjustment taken away: the old, binary model of a garment. */
const binary = (id: string): Garment => ({ ...garment(id), adjustability: 0 });

const HIKING_CONDITIONS: Omit<PhaseConditions, 'airTemperature'> = {
  relativeHumidity: 0.8,
  cloudCover: 0.1,
  windSpeed: 1,
  shelter: 'forest',
};
const HIKING: PhasePlan = { phase: 'hiking', conditions: HIKING_CONDITIONS };

const MINIMUM_OUTFIT = ['ls_synthetic', 'hiking_pants', 'socks_mid', 'boots'];

/** One base-layer rung and one base-layer-plus-a-puffy rung: two configurations, one layer apart. */
const oneLayerApart = (puffyId: string, adjustable: boolean): GearInventory => ({
  garments: adjustable
    ? [...MINIMUM_OUTFIT, puffyId]
    : [...MINIMUM_OUTFIT.map(binary), binary(puffyId)],
});

const gapsFor = (gear: GearInventory, lowF: number, highF: number): readonly CoverageGap[] =>
  coverage(gear, [HIKING], { hiking: band(lowF, highF) }).gaps;

// =======================================================================================
// 1. Adjustability
// =======================================================================================

describe('garment adjustability: the fraction you can shed without taking it off', () => {
  it('classifies garments by what is actually being adjusted', () => {
    // A full-zip fleece opens over the whole chest; a pull-on base layer does not.
    expect(adjustabilityClass(garment('fleece_300'))).toBe('full-zip-mid');
    expect(adjustabilityClass(garment('ls_merino_light'))).toBe('base-layer');
    expect(adjustabilityClass(garment('down_puffy_3oz'))).toBe('insulated-jacket');
    expect(adjustabilityClass(garment('rain_shell'))).toBe('shell');
    expect(adjustabilityClass(garment('hiking_pants'))).toBe('pants');
    expect(adjustabilityClass(garment('mitts'))).toBe('handwear');
    // A grid fleece hoodie is catalogued in the `inner` slot and is still a full-zip hoodie.
    expect(adjustabilityClass(garment('grid_fleece'))).toBe('full-zip-mid');
  });

  it('orders the classes the way the physics does: a full zip ≫ a shell ≫ a base layer', () => {
    expect(ADJUSTABILITY_DEFAULTS['full-zip-mid']).toBeGreaterThan(ADJUSTABILITY_DEFAULTS.shell);
    expect(ADJUSTABILITY_DEFAULTS.shell).toBeGreaterThan(ADJUSTABILITY_DEFAULTS['base-layer']);
    expect(ADJUSTABILITY_DEFAULTS.handwear).toBe(0);
    // A drape is the most adjustable thing in the model; it is held on by nothing.
    expect(DRAPED_ADJUSTABILITY).toBeGreaterThan(ADJUSTABILITY_DEFAULTS['insulated-jacket']);
  });

  it('lets a garment state its own adjustability, overriding its class', () => {
    // Putting a hood down sheds all of it without taking anything off.
    expect(garmentAdjustability(garment('jacket_hood'))).toBe(1);
    // A T-shirt has no zip, no pit zips and no sleeves to push up.
    expect(garmentAdjustability(garment('tee'))).toBe(0);
    expect(garmentAdjustability(binary('down_puffy_3oz'))).toBe(0);
  });

  it('every class default and the drape are registered as unverified constants', () => {
    const ids = UNVERIFIED_CONSTANTS.map((c) => c.id);
    for (const cls of Object.keys(ADJUSTABILITY_DEFAULTS)) {
      expect(ids).toContain(`garments.adjustability.${cls}`);
    }
    expect(ids).toContain('garments.adjustability.draped');
    const one = UNVERIFIED_CONSTANTS.find((c) => c.id === 'garments.adjustability.full-zip-mid');
    // Say out loud why there is no source: ISO 9920 Annex A was never obtained.
    expect(one?.provenance).toBe('estimated');
    expect(one?.note).toMatch(/Annex A/);
  });

  it('gives the ensemble a vented clo below its closed clo, with the intercept surviving', () => {
    const e = ensembleInsulation(['grid_fleece', 'rain_shell', 'hiking_pants'].map(garment));
    expect(e.ventedClo).toBeLessThan(e.clo);
    expect(e.ventableClo).toBeCloseTo(e.clo - e.ventedClo, 12);
    // Eq. (11)'s 0.161 clo intercept is the ensemble-ness, not a garment; no zip removes it.
    expect(e.ventedClo).toBeGreaterThan(0.161);
    const closed = ensembleInsulation(['grid_fleece', 'rain_shell', 'hiking_pants'].map(binary));
    expect(closed.ventableClo).toBe(0);
    expect(closed.ventedClo).toBeCloseTo(closed.clo, 12);
  });

  it('venting moves the warm limit and never the cold limit', () => {
    const conditions: PhaseConditions = { ...HIKING_CONDITIONS, airTemperature: F(35) };
    const items = ['grid_fleece', 'fleece_300', 'hiking_pants', 'socks_mid', 'boots'];
    const adjustable: ClothedConfiguration = {
      kind: 'clothed',
      garments: items.map(garment),
      metabolicRate: metToWm2(1.3),
    };
    const rigid: ClothedConfiguration = {
      kind: 'clothed',
      garments: items.map(binary),
      metabolicRate: metToWm2(1.3),
    };
    const a = assess(adjustable, conditions);
    const b = assess(rigid, conditions);

    // Same garments, same clo, same cold end: fully closed is as warm as it gets.
    expect(a.detail.model).toBe('iso-11079-ireq');
    if (a.detail.model === 'iso-11079-ireq' && b.detail.model === 'iso-11079-ireq') {
      expect(a.detail.providedClo).toBeCloseTo(b.detail.providedClo, 12);
    }
    expect(a.comfort.coldLimitC).toBeCloseTo(b.comfort.coldLimitC, 9);
    expect(a.marginK).toBeCloseTo(b.marginK, 9);

    // …and a strictly warmer warm end, which is the whole asymmetry.
    expect(a.comfort.ventableClo ?? 0).toBeGreaterThan(0);
    expect(b.comfort.ventableClo ?? 0).toBe(0);
    expect(a.comfort.warmLimitC).not.toBeNull();
    expect(a.comfort.warmLimitC as number).toBeGreaterThan(b.comfort.warmLimitC as number);
    // The closed warm end is preserved for the dT/dclo sensitivity and is unchanged.
    expect(a.comfort.fullyClosedWarmLimitC as number).toBeCloseTo(
      b.comfort.fullyClosedWarmLimitC as number,
      9,
    );
    expect(configurationVentableClo(adjustable)).toBeCloseTo(a.comfort.ventableClo ?? 0, 12);
  });

  it('a draped quilt is the most ventable thing a configuration can carry', () => {
    const config: ClothedConfiguration = {
      kind: 'clothed',
      garments: MINIMUM_OUTFIT.map(garment),
      metabolicRate: metToWm2(1.1),
      extraClo: 2.5,
    };
    const bare: ClothedConfiguration = { ...config, extraClo: 0 };
    expect(configurationVentableClo(config) - configurationVentableClo(bare)).toBeCloseTo(
      2.5 * DRAPED_ADJUSTABILITY,
      12,
    );
    // …and a caller can say a given `extraClo` is genuinely binary.
    expect(configurationVentableClo({ ...config, extraCloAdjustability: 0 })).toBeCloseTo(
      configurationVentableClo(bare),
      12,
    );
  });
});

// =======================================================================================
// 2. Coverage against the envelope, and honest interior gaps
// =======================================================================================

describe('the Goldilocks gap: the bug this was all for', () => {
  it('two configurations one layer apart no longer leave an interior gap', () => {
    // The client's report: "25–26 °F falls between two of your configurations". With binary
    // garments that is exactly what comes out: a sliver of band that neither rung covers.
    const rigid = gapsFor(oneLayerApart('synth_puffy_100', false), 10, 70);
    const rigidInterior = rigid.filter((g) => g.severity === 'nothing_between');
    expect(rigidInterior).toHaveLength(1);
    expect(toF(rigidInterior[0]!.fromC)).toBeGreaterThan(40);
    expect(toF(rigidInterior[0]!.toC)).toBeLessThan(55);

    // Model the same garments as adjustable and the gap is gone: because the warmer rung,
    // opened up, really does reach that slice. Nothing was suppressed.
    const adjustable = gapsFor(oneLayerApart('synth_puffy_100', true), 10, 70);
    expect(adjustable.filter((g) => g.severity === 'nothing_between')).toHaveLength(0);

    // The cold end of the band is a genuine cold gap in both, unchanged by any of this.
    for (const gaps of [rigid, adjustable]) {
      const cold = gaps.filter((g) => g.severity === 'cold');
      expect(cold).toHaveLength(1);
      expect(toF(cold[0]!.fromC)).toBeCloseTo(10, 0);
    }
  });

  it('the same for a 1.2 clo puffy, where the gap was a tenth of a degree wide', () => {
    expect(
      gapsFor(oneLayerApart('down_puffy_2oz', false), 10, 70).some(
        (g) => g.severity === 'nothing_between',
      ),
    ).toBe(true);
    expect(
      gapsFor(oneLayerApart('down_puffy_2oz', true), 10, 70).some(
        (g) => g.severity === 'nothing_between',
      ),
    ).toBe(false);
  });

  it('a genuinely unbridgeable interior gap is still reported, with its own severity', () => {
    // A base layer and an expedition-weight parka and nothing between. Venting a 2.3 clo puffy
    // buys ~0.6 clo; the step between the rungs is ~1.9 clo. No zip bridges that.
    const gaps = gapsFor(oneLayerApart('down_puffy_45oz', true), 10, 70);
    const interior = gaps.filter((g) => g.severity === 'nothing_between');
    expect(interior).toHaveLength(1);
    const gap = interior[0]!;
    expect(gap.toC - gap.fromC).toBeGreaterThan(2);

    // Distinct language: "nothing you own fits this range", never "you will freeze".
    expect(gap.fix.text).toMatch(/Nothing you own fits/);
    expect(gap.fix.text).not.toMatch(/warm enough|freeze/);
    expect(gap.fix.text).toMatch(/too cold there even closed up/);
    expect(gap.fix.text).toMatch(/too warm even wide open/);
    // Plain words only: no model vocabulary in a string a user reads.
    expect(gap.fix.text).not.toMatch(/ontology|ensemble|comfort interval|configuration/i);
    // …and it points at the missing *intermediate* rung, not at the parka that is already too
    // warm there. A bridging layer has to land in the gap, not jump over it.
    expect(['add-garment', 'wear']).toContain(gap.fix.kind);
    expect(gap.fix.deltaClo ?? 0).toBeLessThan(garment('down_puffy_45oz').clo);
  });

  it("keeps 'cold' meaning what it means today, and exterior gaps unchanged", () => {
    // Wide enough a band to show an exterior cold gap and an interior one at once.
    const gaps = gapsFor(oneLayerApart('down_puffy_45oz', true), -20, 70);
    expect(new Set(gaps.map((g) => g.severity))).toEqual(new Set(['cold', 'nothing_between']));
    const cold = gaps.filter((g) => g.severity === 'cold');
    // Below the coldest configuration you own: still 'cold', still a buy-this/wear-this fix.
    expect(cold).toHaveLength(1);
    expect(toF(cold[0]!.fromC)).toBeCloseTo(-20, 0);
    expect(cold[0]!.fix.text).toMatch(/clo/);
  });

  it("keeps 'too_warm' meaning what it means today, above the vented warm limit", () => {
    // Sitting in camp wrapped in the quilt when the afternoon turns warm.
    const ids = [
      'ls_synthetic',
      'grid_fleece',
      'rain_shell',
      'alpha_leggings',
      'hiking_pants',
      'socks_mid',
      'boots',
    ];
    const sleep = {
      bag: { kind: 'quilt', ratingC: F(20), ratingType: 'limit' },
      pads: [],
    } as const;
    const plan: PhasePlan = {
      phase: 'camp_evening',
      conditions: HIKING_CONDITIONS,
      bagAsBlanket: true,
    };
    const dist = { camp_evening: band(50, 90) };
    const report = coverage({ garments: ids, sleep }, [plan], dist);
    const warm = report.gaps.filter((g) => g.severity === 'too_warm');
    expect(warm).toHaveLength(1);
    expect(toF(warm[0]!.toC)).toBeCloseTo(90, 0);
    expect(warm[0]!.fix.kind).toBe('shed');

    // The warm end it is measured from is the *vented* one, so the gap is smaller than the
    // binary-garment model would have claimed.
    const rigid = coverage({ garments: ids.map(binary), sleep }, [plan], dist);
    const rigidWarm = rigid.gaps.filter((g) => g.severity === 'too_warm');
    expect(rigidWarm).toHaveLength(1);
    expect(warm[0]!.fromC).toBeGreaterThan(rigidWarm[0]!.fromC);
  });

  it('reports an interior gap in the headline sentence without calling it a cold risk', () => {
    const report = coverage(oneLayerApart('down_puffy_45oz', true), [HIKING], {
      hiking: band(45, 70),
    });
    expect(report.gaps.every((g) => g.severity === 'nothing_between')).toBe(true);
    expect(report.verdict).toMatch(/Nothing you own fits/);
    expect(report.verdict).toMatch(/nothing in between/);
    // Not a cold risk, and not worded as one.
    expect(report.verdict).not.toMatch(/warm enough|freeze|cold/i);
  });

  it('exposes the vented-to-closed envelope coverage is computed against', () => {
    const report = coverage(oneLayerApart('synth_puffy_100', true), [HIKING], {
      hiking: band(10, 70),
    });
    const phase = report.phases[0]!;
    expect(phase.envelope).not.toBeNull();
    for (const c of phase.candidates) {
      expect(c.ventedClo).toBeCloseTo(c.clo - c.ventableClo, 12);
      // The warm end of each candidate's own envelope is its vented warm limit.
      const { warmLimitC, fullyClosedWarmLimitC } = c.assessment.comfort;
      if (warmLimitC !== null && fullyClosedWarmLimitC != null && c.ventableClo > 0.01) {
        expect(warmLimitC).toBeGreaterThan(fullyClosedWarmLimitC);
      }
    }
  });
});

// =======================================================================================
// 3. The layering ladder
// =======================================================================================

describe('candidate generation is a natural layering ladder', () => {
  const KIT: GearInventory = {
    garments: [
      'merino_mid',
      'grid_fleece',
      'fleece_300',
      'down_puffy_3oz',
      'rain_shell',
      'long_underwear',
      'hiking_pants',
      'rain_pants',
      'socks_heavy',
      'boots',
      'beanie',
      'liner_gloves',
      'mitts',
    ],
  };
  const PLANS: PhasePlan[] = [
    HIKING,
    { phase: 'day_break', conditions: HIKING_CONDITIONS },
    { phase: 'camp_evening', conditions: HIKING_CONDITIONS },
  ];
  const DIST = {
    hiking: band(10, 60),
    day_break: band(10, 60),
    camp_evening: band(0, 50),
  };

  it('is nested: each rung is the previous rung plus one or more garments, never a swap', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      const chain = [...phase.candidates].sort((a, b) => a.garments.length - b.garments.length);
      for (let i = 1; i < chain.length; i += 1) {
        const previous = new Set((chain[i - 1] as { garments: readonly Garment[] }).garments.map((g) => g.id));
        const here = new Set((chain[i] as { garments: readonly Garment[] }).garments.map((g) => g.id));
        for (const id of previous) expect(here).toContain(id);
        expect(here.size).toBeGreaterThan(previous.size);
      }
      // Monotone in clo, too: a nested chain cannot get colder as it grows.
      const clos = chain.map((c) => c.clo);
      for (let i = 1; i < clos.length; i += 1) {
        expect(clos[i] as number).toBeGreaterThanOrEqual(clos[i - 1] as number);
      }
    }
  });

  it('every surviving rung uniquely covers a slice of the band no lighter rung covers', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      // The pruning rule only has something to discriminate on when the kit reaches the band.
      expect(phase.candidates.some((c) => c.coveredC.length > 0)).toBe(true);
      for (const c of phase.candidates) {
        expect(c.uniquelyCoversC.length).toBeGreaterThan(0);
        const width = c.uniquelyCoversC.reduce((s, x) => s + (x.toC - x.fromC), 0);
        expect(width).toBeGreaterThan(0);
        // And it really is unique: no *lighter* rung covers that slice.
        for (const other of phase.candidates.filter((o) => o.clo < c.clo)) {
          for (const mine of c.uniquelyCoversC) {
            for (const theirs of other.coveredC) {
              const overlap =
                Math.min(mine.toC, theirs.toC) - Math.max(mine.fromC, theirs.fromC);
              expect(overlap).toBeLessThanOrEqual(1e-6);
            }
          }
        }
      }
    }
  });

  it('still obeys SPEC §4: one inner per region, shell outermost, at most two puffies', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      for (const c of phase.candidates) {
        for (const region of ['torso', 'legs', 'hands', 'feet'] as const) {
          expect(
            c.garments.filter((g) => g.region === region && g.slot === 'inner').length,
          ).toBeLessThanOrEqual(1);
        }
        expect(c.garments.filter((g) => g.isPuffy === true).length).toBeLessThanOrEqual(2);
        expect(new Set(c.garments.map((g) => g.id)).size).toBe(c.garments.length);
      }
    }
  });

  it('keeps the whole ladder when nothing in the kit reaches the band at all', () => {
    // Nothing to discriminate on: the rungs are all above the band, so the report shows the
    // ladder and lets the cold gap speak rather than returning a single bar.
    const report = coverage(KIT, [{ phase: 'day_break', conditions: HIKING_CONDITIONS }], {
      day_break: band(-30, -15),
    });
    const phase = report.phases[0]!;
    expect(phase.coveredFraction).toBe(0);
    expect(phase.candidates.length).toBeGreaterThan(3);
    expect(phase.gaps.map((g) => g.severity)).toEqual(['cold']);
  });

  it('names each rung by its delta from the lightest, and never a bare "+ bag draped"', () => {
    const report = coverage(
      { ...KIT, sleep: { bag: { kind: 'quilt', ratingC: F(20), ratingType: 'limit' }, pads: [] } },
      [{ phase: 'camp_evening', conditions: HIKING_CONDITIONS, bagAsBlanket: true }],
      DIST,
    );
    const labels = report.phases[0]!.candidates.map((c) => c.shortLabel);
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[0]).toMatch(/^base only/);
    for (const l of labels) {
      expect(l.trim()).not.toMatch(/^\+ bag draped$/);
      expect(l.length).toBeGreaterThan(0);
    }
    expect(labels.some((l) => l.includes('bag draped'))).toBe(true);
  });

  it('honours maxCandidates by dropping the rungs that earn the least', () => {
    const report = coverage(KIT, [HIKING], DIST, { maxCandidates: 3 });
    const phase = report.phases[0]!;
    expect(phase.candidates.length).toBeLessThanOrEqual(3);
    // The ends of the envelope survive: the lightest rung and the one that reaches furthest down.
    const full = coverage(KIT, [HIKING], DIST).phases[0]!;
    expect(Math.min(...phase.candidates.map((c) => c.clo))).toBeCloseTo(
      Math.min(...full.candidates.map((c) => c.clo)),
      9,
    );
    expect(Math.min(...phase.candidates.map((c) => c.assessment.comfort.coldLimitC))).toBeCloseTo(
      Math.min(...full.candidates.map((c) => c.assessment.comfort.coldLimitC)),
      9,
    );
  });
});

// =======================================================================================
// 4. The campfire
// =======================================================================================

describe('a campfire is a radiant term, not a metabolic one', () => {
  const CAMP: Omit<PhaseConditions, 'airTemperature'> = {
    relativeHumidity: 0.8,
    cloudCover: 0.1,
    windSpeed: 1,
    shelter: 'forest',
  };
  const KIT: GearInventory = {
    garments: [
      'merino_mid',
      'grid_fleece',
      'down_puffy_3oz',
      'rain_shell',
      'long_underwear',
      'hiking_pants',
      'socks_heavy',
      'boots',
      'beanie',
      'liner_gloves',
    ],
  };
  const items = KIT.garments.map((x) => garment(x as string));
  const config: ClothedConfiguration = {
    kind: 'clothed',
    garments: items,
    metabolicRate: metToWm2(1.1),
  };
  const at = (fahrenheit: number, fire: boolean) =>
    assess(config, {
      ...CAMP,
      airTemperature: F(fahrenheit),
      ...(fire ? { campfire: { on: true } } : {}),
    });

  /** docs/CAMPFIRE.md §6.4/§8.2's own context: h_r = 3.40 at T_m = 283 K, h_c = 3.1 still. */
  const DOC_CONTEXT: CampfireContext = {
    convectiveCoefficient: 3.1,
    radiativeCoefficient: 3.4,
    airVelocity: 0.05,
  };

  it('is off by default', () => {
    const env = resolveEnvironment({
      airTemperature: F(30),
      relativeHumidity: 0.8,
      cloudCover: 0.1,
      windSpeed: 1,
    });
    expect(env.radiantSourceDeltaMrtK).toBe(0);
    expect(env.campfire.on).toBe(false);
    expect(env.operativeTemperatureWithoutSourceC).toBeCloseTo(env.operativeTemperatureC, 12);
    expect(campfireEffect(undefined, DOC_CONTEXT).deltaMeanRadiantK).toBe(0);
    expect(campfireEffect({ on: false }, DOC_CONTEXT).deltaMeanRadiantK).toBe(0);
    expect(at(30, false).conditions.radiantSourceDeltaMrtK).toBe(0);
  });

  it("reproduces docs/CAMPFIRE.md §8.2's table from the point-source model", () => {
    // r (m) → E (W/m²), Δt̄_r (K), Δt_o still (K), Δt_o @2 m/s (K)
    const table: readonly [number, number, number, number, number][] = [
      [0.75, 156, 8.19, 4.28, 1.74],
      [1.0, 99, 5.21, 2.73, 1.11],
      [1.2, 73, 3.82, 2.0, 0.81],
      [1.3, 63, 3.31, 1.73, 0.7],
      [1.5, 49, 2.56, 1.34, 0.54],
      [2.0, 28, 1.49, 0.78, 0.32],
      [3.0, 13, 0.68, 0.36, 0.14],
    ];
    const windy: CampfireContext = {
      // h_c = 8.3·2^0.6 = 12.58, the Mitchell form the document's table uses.
      convectiveCoefficient: 8.3 * Math.pow(2, 0.6),
      radiativeCoefficient: 3.4,
      airVelocity: 2,
    };
    for (const [r, e, dtr, dtoStill, dto2] of table) {
      const still = campfireEffect({ on: true, distanceM: r }, DOC_CONTEXT);
      expect(still.irradiance).toBeCloseTo(e, 0);
      expect(still.deltaMeanRadiantK).toBeCloseTo(dtr, 1);
      expect(still.deltaOperativeK).toBeCloseTo(dtoStill, 1);
      // 🔴 Δt̄_r does not depend on wind; Δt_o does, strongly (§8.2).
      const moving = campfireEffect({ on: true, distanceM: r }, windy);
      expect(moving.deltaMeanRadiantK).toBeCloseTo(still.deltaMeanRadiantK, 9);
      expect(moving.deltaOperativeK).toBeCloseTo(dto2, 1);
    }
  });

  it('is 2.0 K of operative temperature at the design distance, not the 8 K first guessed', () => {
    const design = campfireEffect({ on: true }, DOC_CONTEXT);
    expect(design.distanceM).toBe(CAMPFIRE.defaultDistanceM);
    expect(design.posture).toBe('seated');
    // f = (α_fire/ε)·(A_p/A_D) = (0.84/0.95)·0.202 = 0.179
    expect(design.absorbedFraction).toBeCloseTo(
      (CAMPFIRE.fireAbsorptivity / CLOTHING_EMISSIVITY) * CAMPFIRE.projectedAreaFraction.seated,
      9,
    );
    expect(design.absorbedFraction).toBeCloseTo(0.179, 3);
    expect(design.deltaOperativeK).toBeCloseTo(2.0, 1);
    expect(design.deltaMeanRadiantK).toBeCloseTo(3.8, 1);
    // Nothing in the model may ship a benefit larger than the design case at that distance.
    expect(design.deltaOperativeK).toBeLessThan(2.1);
    // Standing receives more: a taller centroid and a larger projected area.
    const standing = campfireEffect({ on: true, posture: 'standing' }, DOC_CONTEXT);
    expect(standing.absorbedFraction).toBeCloseTo(0.224, 2);
    expect(standing.absorbedFraction).toBeGreaterThan(design.absorbedFraction);
  });

  it('cancels h_r out of Δt_o exactly, which is the point of §6.3', () => {
    // h_r is the largest single parameter uncertainty in the chain and must not matter.
    const a = campfireEffect({ on: true }, { ...DOC_CONTEXT, radiativeCoefficient: 3.05 });
    const b = campfireEffect({ on: true }, { ...DOC_CONTEXT, radiativeCoefficient: 4.7 });
    const f = a.absorbedFraction;
    expect(a.deltaOperativeK).toBeCloseTo(
      (f * a.irradiance) / (DOC_CONTEXT.convectiveCoefficient + 3.05),
      9,
    );
    expect(b.deltaOperativeK).toBeCloseTo(
      (f * b.irradiance) / (DOC_CONTEXT.convectiveCoefficient + 4.7),
      9,
    );
    // Δt̄_r, the diagnostic, does move with h_r: it is the derived quantity, not the answer.
    expect(a.deltaMeanRadiantK).toBeGreaterThan(b.deltaMeanRadiantK);
  });

  it('raises mean radiant temperature, and therefore operative temperature', () => {
    const common = {
      airTemperature: F(30),
      relativeHumidity: 0.8,
      cloudCover: 0.1,
      windSpeed: 1,
    } as const;
    const off = resolveEnvironment(common);
    const on = resolveEnvironment({ ...common, radiantSource: { on: true } });
    expect(on.radiantSourceDeltaMrtK).toBeCloseTo(on.campfire.deltaMeanRadiantK, 12);
    expect(on.radiantSourceDeltaMrtK).toBeGreaterThan(2);
    expect(on.meanRadiantTemperatureC).toBeCloseTo(
      off.meanRadiantTemperatureC + on.radiantSourceDeltaMrtK,
      9,
    );
    // Through `t_o = (h_c·t_a + h_r·t_r)/(h_c + h_r)`: warmer, but by less than Δt̄_r, because
    // the convective term is still looking at the air temperature. And the engine's own h_c and
    // h_r are the ones used, so the Δt_o the fire reports is the Δt_o the engine sees.
    expect(on.operativeTemperatureC).toBeGreaterThan(off.operativeTemperatureC);
    expect(on.operativeTemperatureC - off.operativeTemperatureC).toBeLessThan(
      on.radiantSourceDeltaMrtK,
    );
    expect(on.operativeTemperatureC - off.operativeTemperatureC).toBeCloseTo(
      on.campfire.deltaOperativeK,
      9,
    );
    // Air temperature itself is untouched: a fire is not a heater for the clearing.
    expect(on.airTemperatureC).toBeCloseTo(off.airTemperatureC, 12);
    // …and the fire-free pair is carried alongside, for the extremities.
    expect(on.operativeTemperatureWithoutSourceC).toBeCloseTo(off.operativeTemperatureC, 9);
  });

  it('behaves at the edges exactly as §9.3 requires', () => {
    // Closer than 0.75 m: the point source is invalid and over-predicts. Clamp and warn.
    const tooClose = campfireEffect({ on: true, distanceM: 0.3 }, DOC_CONTEXT);
    const atLimit = campfireEffect({ on: true, distanceM: 0.75 }, DOC_CONTEXT);
    expect(tooClose.irradiance).toBeCloseTo(atLimit.irradiance, 9);
    expect(tooClose.warnings.map((w) => w.code)).toContain('campfire_too_close_for_point_source');
    expect(tooClose.warnings[0]?.severity).toBe('out-of-range');

    // Beyond 4 m: measured to have no thermal effect at all.
    const far = campfireEffect({ on: true, distanceM: 4.5 }, DOC_CONTEXT);
    expect(far.on).toBe(true);
    expect(far.irradiance).toBe(0);
    expect(far.deltaMeanRadiantK).toBe(0);
    expect(far.deltaOperativeK).toBe(0);

    // Above 4 m/s the h_c correlation the benefit is divided by is out of range.
    const gale = campfireEffect(
      { on: true },
      { convectiveCoefficient: 20, radiativeCoefficient: 3.4, airVelocity: 6 },
    );
    expect(gale.warnings.map((w) => w.code)).toContain('campfire_wind_out_of_range');

    // Δt̄_r > 7.0 K seated ⇔ Δt_pr > ASHRAE 55's 23 K warm-wall limit. Reported, and
    // deliberately NOT warned about: a warm front and a cool back is the point of sitting by a
    // fire, not a fault condition, and the asymmetry's real consequence (nothing for the
    // extremities) is enforced elsewhere.
    expect(atLimit.deltaMeanRadiantK).toBeGreaterThan(7);
    expect(atLimit.planeRadiantAsymmetryK).toBeGreaterThan(CAMPFIRE.asymmetryLimitK);
    expect(atLimit.asymmetryExceedsLimit).toBe(true);
    expect(atLimit.warnings.map((w) => w.code)).not.toContain('campfire_radiant_asymmetry');
    // At exactly 0.75 m nothing is out of range, so this result is warning-free *despite*
    // being over the asymmetry limit. That is the behaviour the client asked for.
    expect(atLimit.warnings).toHaveLength(0);
    // The design case is below the limit anyway, which is why 1.2 m is the design case.
    const design = campfireEffect({ on: true }, DOC_CONTEXT);
    expect(design.planeRadiantAsymmetryK).toBeCloseTo(12.5, 0);
    expect(design.asymmetryExceedsLimit).toBe(false);
    expect(design.warnings).toHaveLength(0);
    // Δt_pr = (ε/f_p)·Δt̄_r = 3.28·Δt̄_r seated, not (ε/(A_p/A_D)), which would overstate it.
    expect(design.planeRadiantAsymmetryK / design.deltaMeanRadiantK).toBeCloseTo(3.28, 2);
  });

  it('refuses the χ_rad = 0.3–0.4 bracket that belongs to large liquid pools', () => {
    expect(CAMPFIRE.radiativeFraction).toBe(0.15);
    expect(CAMPFIRE.radiativeFractionRange[1]).toBeLessThanOrEqual(0.25);
    // The whole-chain consequence: 1.5 kW of radiant power, not 3–4 kW.
    expect(CAMPFIRE.radiativeFraction * CAMPFIRE.heatReleaseRateKw).toBeCloseTo(1.5, 9);
  });

  it('never raises the metabolic rate, and improves the verdict through t_r alone', () => {
    const off = at(30, false);
    const on = at(30, true);
    expect(on.conditions.metabolicRate).toBeCloseTo(off.conditions.metabolicRate, 12);
    expect(on.conditions.operativeTemperatureC).toBeGreaterThan(
      off.conditions.operativeTemperatureC,
    );
    // A radiant gain buys real comfort: the cold limit moves down.
    expect(on.comfort.coldLimitC).toBeLessThan(off.comfort.coldLimitC);
    expect(on.marginK).toBeGreaterThan(off.marginK);
    expect(on.caveats.join(' ')).toMatch(/never the metabolic rate/);
    expect(on.caveats.join(' ')).toMatch(/docs\/CAMPFIRE\.md/);
  });

  it('falls off slower than inverse-square in the horizontal distance, as §8.1 says', () => {
    // E ∝ 1/d² in the *slant* distance, and d² = r² + (z_t − z_s)², so the local exponent in r
    // is 1.57 at 0.75→1.0 m and only approaches 2 beyond 2 m. Assuming r^-2 would under-predict
    // the fire at close range.
    const e = (r: number): number =>
      campfireEffect({ on: true, distanceM: r }, DOC_CONTEXT).irradiance;
    const exponent = (a: number, b: number): number =>
      Math.log(e(a) / e(b)) / Math.log(b / a);
    expect(exponent(0.75, 1.0)).toBeCloseTo(1.57, 1);
    expect(exponent(1.0, 1.3)).toBeCloseTo(1.73, 1);
    expect(exponent(1.5, 3.0)).toBeCloseTo(1.91, 1);
    // And the slant distance is what the geometry says it is: 21° below the horizontal.
    const design = campfireEffect({ on: true }, DOC_CONTEXT);
    expect(design.slantDistanceM).toBeCloseTo(1.282, 3);
  });

  it('takes an explicit Δt̄_r or radiative-power override', () => {
    expect(
      campfireEffect({ on: true, deltaMrtK: 3.5, distanceM: 1.0 }, DOC_CONTEXT).deltaMeanRadiantK,
    ).toBe(3.5);
    // Halving the radiative power halves the irradiance and the benefit.
    const design = campfireEffect({ on: true }, DOC_CONTEXT);
    const half = campfireEffect({ on: true, radiativePowerKw: 0.75 }, DOC_CONTEXT);
    expect(half.irradiance).toBeCloseTo(design.irradiance / 2, 9);
    expect(half.deltaOperativeK).toBeCloseTo(design.deltaOperativeK / 2, 9);
  });

  it('withholds the fire from the extremity verdicts, at every temperature', () => {
    // A fire heats your front and not your back. The whole-body balance gets it; hands, feet
    // and head do not: neither through their operative temperature nor through the core
    // margin that drives vasoconstriction.
    for (const fahrenheit of [45, 35, 25, 15, 5]) {
      const dist = { camp_evening: band(fahrenheit, fahrenheit + 10) };
      const off = coverage(KIT, [{ phase: 'camp_evening', conditions: CAMP }], dist);
      const on = coverage(
        KIT,
        [{ phase: 'camp_evening', conditions: { ...CAMP, campfire: { on: true } } }],
        dist,
      );
      const a = off.phases[0]!.extremities;
      const b = on.phases[0]!.extremities;
      expect(b.map((e) => e.part)).toEqual(a.map((e) => e.part));
      for (let i = 0; i < a.length; i += 1) {
        expect(b[i]!.verdict).toBe(a[i]!.verdict);
        expect(b[i]!.requiredClo).toBeCloseTo(a[i]!.requiredClo, 9);
        expect(b[i]!.localFlux).toBeCloseTo(a[i]!.localFlux, 9);
      }
      // The core balance, meanwhile, really did move.
      const coldOff = off.phases[0]!.best?.assessment.comfort.coldLimitC ?? 0;
      const coldOn = on.phases[0]!.best?.assessment.comfort.coldLimitC ?? 0;
      expect(coldOn).toBeLessThan(coldOff);
      // The one-sidedness is a factual note among the other caveats, not a flag.
      expect(on.caveats.join(' ')).toMatch(/warms the side of you that faces it/);
      expect(on.caveats.join(' ')).toMatch(/credits nothing to your hands, feet or head/);
      expect(on.caveats.join(' ')).toMatch(/no rise at all on the back-facing sensor/);
      expect(on.warnings.map((w) => w.code)).not.toContain('campfire_radiant_asymmetry');
    }
  });

  it('registers the estimates and only the estimates, keeping §9.2’s own labels', () => {
    const byId = new Map(UNVERIFIED_CONSTANTS.map((c) => [c.id, c]));
    // The two genuine estimates in the chain.
    const hrr = byId.get('environment.campfire.heatReleaseRateKw');
    expect(hrr?.value).toBe(CAMPFIRE.heatReleaseRateKw);
    expect(hrr?.provenance).toBe('estimated');
    // The single weakest link must be said out loud.
    expect(hrr?.note).toMatch(/no published heat-release-rate measurement/);
    expect(hrr?.note).toMatch(/in-depth combustion/);
    expect(byId.get('environment.campfire.fireAbsorptivity')?.provenance).toBe('estimated');
    expect(byId.get('environment.campfire.deltaOperativeAtDesignDistanceK')?.value).toBe(2);
    // The extremity allocation is not an estimate: it is measured behaviour, and labelled so.
    const allocation = byId.get('environment.campfire.extremityAllocation');
    expect(allocation?.value).toBe(0);
    expect(allocation?.provenance).toBe('peer-reviewed');
    expect(allocation?.note).toMatch(/Watanabe/);
    // The measured and standard-sourced parameters are NOT dumped in here as if they were
    // guesses: χ_rad, A_p/A_D, f_p and the 23 K limit all have sources.
    for (const id of [
      'environment.campfire.radiativeFraction',
      'environment.campfire.projectedAreaFraction',
      'environment.campfire.asymmetryLimitK',
    ]) {
      expect(byId.has(id)).toBe(false);
    }
  });

  it('is a no-op for the sleep phase rather than a quiet bonus', () => {
    const sleepGear: GearInventory = {
      ...KIT,
      sleep: { bag: { kind: 'bag', ratingC: F(20), ratingType: 'limit' }, pads: [{ imperialR: 4.2 }] },
    };
    const conditions: Omit<PhaseConditions, 'airTemperature'> = {
      relativeHumidity: 0.9,
      cloudCover: 0.2,
      windSpeed: 1,
      shelter: 'tent',
    };
    const dist = { sleep: band(20, 34) };
    const off = coverage(sleepGear, [{ phase: 'sleep', conditions }], dist);
    const on = coverage(
      sleepGear,
      [{ phase: 'sleep', conditions: { ...conditions, campfire: { on: true } } }],
      dist,
    );
    expect(on.phases[0]!.candidates[0]!.assessment.comfort.coldLimitC).toBeCloseTo(
      off.phases[0]!.candidates[0]!.assessment.comfort.coldLimitC,
      12,
    );
    expect(on.phases[0]!.candidates[0]!.assessment.conditions.radiantSourceDeltaMrtK).toBe(0);
  });
});

// =======================================================================================
// 5. The caveats panel says each thing once
// =======================================================================================

describe('the caveats panel is the credibility of the project, so it says each thing once', () => {
  const KIT: GearInventory = {
    garments: [
      'ls_synthetic',
      'grid_fleece',
      'rain_shell',
      'alpha_leggings',
      'hiking_pants',
      'rain_pants',
      'socks_mid',
      'boots',
      'beanie',
      'liner_gloves',
    ],
    sleep: {
      bag: { kind: 'bag', ratingC: F(20), ratingType: 'limit' },
      pads: [{ imperialR: 4.2 }],
    },
  };
  const PLANS: PhasePlan[] = [
    { phase: 'hiking', conditions: { relativeHumidity: 0.75, cloudCover: 0.6, windSpeed: 3, shelter: 'open' } },
    { phase: 'camp_evening', conditions: HIKING_CONDITIONS },
    { phase: 'camp_morning', conditions: HIKING_CONDITIONS },
  ];
  const DIST = {
    hiking: band(30, 48),
    camp_evening: band(25, 40),
    camp_morning: band(22, 34),
  };

  it('never repeats a caveat or a warning, per phase or across the report', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      expect(phase.candidates.length).toBeGreaterThan(1);
      expect(new Set(phase.caveats).size).toBe(phase.caveats.length);
      const keys = phase.warnings.map((w) => `${w.code}|${w.severity}|${w.message}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(new Set(report.caveats).size).toBe(report.caveats.length);
    const all = report.warnings.map((w) => `${w.code}|${w.severity}|${w.message}`);
    expect(new Set(all).size).toBe(all.length);
  });

  it('states the venting mechanism once and quotes no candidate’s clo figure in it', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      const venting = phase.caveats.filter((c) => /adjustable, not binary/.test(c));
      expect(venting).toHaveLength(1);
      // The number used to be in this sentence, once per candidate. It must not come back.
      expect(venting[0]).not.toMatch(/\d\.\d\d clo/);
      expect(venting[0]).toMatch(/estimated, not measured/);
    }
  });

  it('carries the per-candidate venting figure on the candidate instead', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      for (const c of phase.candidates) {
        expect(c.ventingCloRange[0]).toBeCloseTo(c.ventedClo, 12);
        expect(c.ventingCloRange[1]).toBeCloseTo(c.clo, 12);
        expect(c.ventingCloRange[1] - c.ventingCloRange[0]).toBeCloseTo(c.ventableClo, 12);
      }
      // …and they really do differ per candidate, which is why they could not live in one caveat.
      const ranges = new Set(phase.candidates.map((c) => c.ventingCloRange.join()));
      if (phase.candidates.length > 1) expect(ranges.size).toBeGreaterThan(1);
    }
  });

  it('states the short-DLE warning once, with the figure on each candidate', () => {
    const report = coverage(KIT, PLANS, DIST);
    const camp = report.phases.find((p) => p.phase === 'camp_evening');
    const dle = (camp?.warnings ?? []).filter((w) => w.code === 'short_duration_limited_exposure');
    expect(dle).toHaveLength(1);
    expect(dle[0]?.message).not.toMatch(/0\.\d h/);
    expect(dle[0]?.message).toMatch(/detail\.dleMin/);
    for (const c of camp?.candidates ?? []) {
      if (c.assessment.detail.model === 'iso-11079-ireq') {
        expect(c.assessment.detail.dleMin.significantFigures).toBe(1);
      }
    }
  });

  it('states the ensemble-range warning once, with the figure on the ensemble result', () => {
    const report = coverage(KIT, PLANS, DIST);
    for (const phase of report.phases) {
      const range = phase.warnings.filter((w) => /tested_range/.test(w.code));
      expect(range.length).toBeLessThanOrEqual(1);
      for (const w of range) expect(w.message).not.toMatch(/Σ I_clu = /);
    }
    // The number is still there for a direct caller of ensembleInsulation().
    const e = ensembleInsulation(['grid_fleece', 'fleece_300', 'down_puffy_45oz'].map(garment));
    expect(e.sumClo).toBeGreaterThan(1.6);
    expect(e.warnings.length).toBeGreaterThan(0);
  });

  it('states core-coupled vasoconstriction once, not once per body part', () => {
    const report = coverage(KIT, PLANS, DIST);
    const camp = report.phases.find((p) => p.phase === 'camp_evening');
    const coupled = (camp?.warnings ?? []).filter((w) => w.code === 'extremity_core_coupled');
    // It fires for hands, feet and head together, but the insight and the advice are identical
    // for all three: "your core is short, fix the core". Three copies of one sentence differing
    // only by body part reads as a bug in a five-item warning list.
    expect(coupled).toHaveLength(1);
    expect(coupled[0]?.message).not.toMatch(/\bhands\b|\bfeet\b|\bhead\b/);

    // The part-specific information is not lost: it lives on the per-part verdicts, which is
    // where a reader looks to find out *which* parts are cold and by how much.
    const parts = (camp?.extremities ?? []).map((e) => e.part);
    expect(parts).toEqual(expect.arrayContaining(['hands', 'feet', 'head']));
    for (const e of camp?.extremities ?? []) {
      expect(Number.isFinite(e.requiredClo)).toBe(true);
      expect(Number.isFinite(e.wornClo)).toBe(true);
    }
  });
});

describe('the catalogue still reports honestly about itself', () => {
  it('gives every garment a defined adjustability in [0, 1]', () => {
    for (const g of GARMENTS) {
      const a = garmentAdjustability(g);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});
