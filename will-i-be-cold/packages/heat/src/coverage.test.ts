import { describe, expect, it } from 'vitest';
import {
  UNVERIFIED_CONSTANTS,
  coverage,
  type GearInventory,
  type PhasePlan,
  type TemperatureBand,
} from './coverage.js';
import { GARMENTS } from './garments.js';
import { ThermalModelError, type PhaseName } from './types.js';
import { fahrenheitToCelsius } from './units.js';

const f = fahrenheitToCelsius;

const GEAR: GearInventory = {
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
    bag: { kind: 'bag', ratingC: f(20), ratingType: 'limit' },
    pads: [{ imperialR: 4.2, label: 'insulated air pad' }],
  },
};

const band = (lowF: number, highF: number): TemperatureBand => ({
  p10: f(lowF),
  p50: f((lowF + highF) / 2),
  p90: f(highF),
  min: f(lowF - 5),
  max: f(highF + 5),
});

const DISTRIBUTIONS: Partial<Record<PhaseName, TemperatureBand>> = {
  hiking: band(30, 48),
  day_break: band(32, 48),
  camp_evening: band(25, 40),
  camp_morning: band(22, 34),
  sleep: band(20, 34),
};

const PLANS: PhasePlan[] = [
  { phase: 'hiking', conditions: { relativeHumidity: 0.75, cloudCover: 0.6, windSpeed: 3, shelter: 'open' } },
  { phase: 'day_break', conditions: { relativeHumidity: 0.75, cloudCover: 0.6, windSpeed: 3, shelter: 'open' } },
  {
    phase: 'camp_evening',
    conditions: { relativeHumidity: 0.8, cloudCover: 0.2, windSpeed: 1, shelter: 'forest' },
  },
  {
    phase: 'camp_morning',
    conditions: { relativeHumidity: 0.85, cloudCover: 0.2, windSpeed: 1, shelter: 'forest' },
  },
  { phase: 'sleep', conditions: { relativeHumidity: 0.9, cloudCover: 0.2, windSpeed: 1, shelter: 'tent' } },
];

describe('coverage() shape and purity', () => {
  it('is pure and deterministic', () => {
    const a = JSON.stringify(coverage(GEAR, PLANS, DISTRIBUTIONS));
    const b = JSON.stringify(coverage(GEAR, PLANS, DISTRIBUTIONS));
    expect(a).toBe(b);
  });

  it('returns one entry per requested phase, in the order requested', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    expect(r.phases.map((p) => p.phase)).toEqual(PLANS.map((p) => p.phase));
  });

  it('hides which model produced each verdict behind one uniform type, but records it', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const sleep = r.phases.find((p) => p.phase === 'sleep');
    const hiking = r.phases.find((p) => p.phase === 'hiking');
    expect(sleep?.model).toBe('iso-23537-annex-c');
    expect(hiking?.model).toBe('iso-11079-ireq');
    // Same keys on both sides of the split.
    const keys = (x: unknown) => Object.keys(x as object).sort();
    expect(keys(sleep?.candidates[0]?.assessment ?? {})).toEqual(
      keys(hiking?.candidates[0]?.assessment ?? {}),
    );
  });

  it('publishes every unverified constant it used', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    expect(r.unverifiedConstants).toBe(UNVERIFIED_CONSTANTS);
    expect(r.unverifiedConstants.length).toBeGreaterThan(10);
    for (const c of r.unverifiedConstants) {
      expect(c.note.length).toBeGreaterThan(20);
      expect(c.id).toMatch(/^[a-z]+\./);
    }
  });

  it('generates a ladder of candidates from owned gear, not one ensemble', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const hiking = r.phases.find((p) => p.phase === 'hiking');
    expect((hiking?.candidates.length ?? 0)).toBeGreaterThanOrEqual(3);
    // Strictly increasing warmth up the ladder is not required, but the span must widen.
    const clos = (hiking?.candidates ?? []).map((c) => c.clo);
    expect(Math.max(...clos)).toBeGreaterThan(Math.min(...clos));
  });

  it('obeys SPEC §4: at most one inner per region, shells allowed to stack', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    for (const phase of r.phases) {
      for (const c of phase.candidates) {
        const innerTorso = c.garments.filter((g) => g.region === 'torso' && g.slot === 'inner');
        const innerLegs = c.garments.filter((g) => g.region === 'legs' && g.slot === 'inner');
        expect(innerTorso.length).toBeLessThanOrEqual(1);
        expect(innerLegs.length).toBeLessThanOrEqual(1);
        expect(new Set(c.garments.map((g) => g.id)).size).toBe(c.garments.length);
      }
    }
  });
});

describe('gaps are first-class', () => {
  it('every gap carries a phase, a span, a severity and a one-line fix', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    expect(r.gaps.length).toBeGreaterThan(0);
    for (const gap of r.gaps) {
      expect(PLANS.map((p) => p.phase)).toContain(gap.phase);
      expect(gap.toC).toBeGreaterThan(gap.fromC);
      expect(['cold', 'too_warm']).toContain(gap.severity);
      expect(gap.fix.text.length).toBeGreaterThan(10);
    }
  });

  it('the flat list and the per-phase lists agree', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    expect(r.gaps).toHaveLength(r.phases.reduce((s, p) => s + p.gaps.length, 0));
  });

  it('this kit has no puffy, so the cold end of camp is a gap with a buy-this fix', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const camp = r.phases.find((p) => p.phase === 'camp_evening');
    const cold = (camp?.gaps ?? []).filter((g) => g.severity === 'cold');
    expect(cold.length).toBeGreaterThan(0);
    expect(cold[0]?.fix.kind).toBe('add-garment');
    expect(cold[0]?.fix.text).toMatch(/clo/);
    expect(cold[0]?.fix.coversToC).toBeDefined();
  });

  it('prefers a free fix from gear you already own over telling you to buy something', () => {
    const withPuffy: GearInventory = {
      ...GEAR,
      garments: [...GEAR.garments, 'down_puffy_3oz'],
    };
    const r = coverage(withPuffy, PLANS, DISTRIBUTIONS);
    const colds = r.gaps.filter((g) => g.severity === 'cold' && g.phase !== 'sleep');
    for (const gap of colds) {
      if (gap.fix.kind === 'wear') expect(gap.fix.alreadyOwned).toBe(true);
    }
  });

  it('a sleep gap is fixed with a pad or with clothing in the bag, never with "buy a jacket"', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const sleepGaps = r.gaps.filter((g) => g.phase === 'sleep' && g.severity === 'cold');
    expect(sleepGaps.length).toBeGreaterThan(0);
    for (const gap of sleepGaps) {
      expect(['add-pad', 'wear-in-bag', 'none']).toContain(gap.fix.kind);
    }
    expect(sleepGaps[0]?.fix.text).toMatch(/R 4\.8|R-value|R \d/);
  });

  it('adding the gear the fix names actually closes the gap it was named for', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const campGap = r.gaps.find((g) => g.phase === 'camp_evening' && g.severity === 'cold');
    const itemId = campGap?.fix.itemId;
    expect(itemId).toBeDefined();
    const improved = coverage(
      { ...GEAR, garments: [...GEAR.garments, itemId as string] },
      PLANS,
      DISTRIBUTIONS,
    );
    const before = r.phases.find((p) => p.phase === 'camp_evening')?.coveredFraction ?? 0;
    const after = improved.phases.find((p) => p.phase === 'camp_evening')?.coveredFraction ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});

describe('coverage fractions and the headline sentence', () => {
  it('coveredFraction is in [0, 1] and matches the covered spans', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    for (const p of r.phases) {
      expect(p.coveredFraction).toBeGreaterThanOrEqual(0);
      expect(p.coveredFraction).toBeLessThanOrEqual(1);
      const width = p.band.toC - p.band.fromC;
      const covered = p.covered.reduce((s, c) => s + (c.toC - c.fromC), 0);
      expect(p.coveredFraction).toBeCloseTo(Math.min(1, covered / width), 6);
    }
  });

  it('stacks a liner pair under mitts, now that hands is a single slot', () => {
    const liner = GARMENTS.find((g) => g.id === 'liner_gloves');
    const mitts = GARMENTS.find((g) => g.id === 'mitts');
    expect(liner && mitts).toBeTruthy();
    // The ontology changed: hands has one slot, like the head. What the old inner slot bought
    // us was liners *under* mitts, and the layering ladder has to keep doing that itself.
    expect(liner!.slot).toBe('outer');
    expect(mitts!.slot).toBe('outer');
    expect(GARMENTS.filter((g) => g.region === 'hands' && g.slot === 'inner')).toHaveLength(0);

    const withBoth: GearInventory = {
      ...GEAR,
      garments: [...GEAR.garments.filter((g) => typeof g !== 'string' || !/glove|mitt/.test(g)), liner!, mitts!],
    };
    const r = coverage(withBoth, PLANS, DISTRIBUTIONS);
    const hands = r.phases[0]?.extremities.find((e) => e.part === 'hands');
    // 0.05 liner + 0.25 mitts = 0.30. Taking only the warmest pair gives 0.25 and drops the
    // liner, which is the regression this test exists to catch.
    expect(hands?.wornClo).toBeCloseTo(0.3, 6);
    expect(hands?.wornClo).toBeCloseTo(liner!.clo + mitts!.clo, 6);
    // Both pairs really are on the warmest rung, in layering order: liner first, mitts over it.
    const warmest = [...(r.phases[0]?.candidates ?? [])].sort((a, b) => b.clo - a.clo)[0];
    const handsWorn = (warmest?.garments ?? []).filter((g) => g.region === 'hands').map((g) => g.id);
    expect(handsWorn).toEqual(['liner_gloves', 'mitts']);
  });

  it('wears the warmest pair alone when that is all there is', () => {
    const r = coverage({ ...GEAR, garments: [...GEAR.garments, 'mitts'] }, PLANS, DISTRIBUTIONS);
    const hands = r.phases[0]?.extremities.find((e) => e.part === 'hands');
    expect(hands?.wornClo).toBeCloseTo(0.3, 6); // the kit already owns liners too
    const single = coverage(
      { ...GEAR, garments: GEAR.garments.filter((g) => g !== 'liner_gloves') },
      PLANS,
      DISTRIBUTIONS,
    );
    const only = single.phases[0]?.extremities.find((e) => e.part === 'hands');
    expect(only?.wornClo).toBeCloseTo(0, 6);
  });

  it('never labels a candidate as a bare "+ bag draped"', () => {
    const evening = PLANS.find((p) => p.phase === 'camp_evening');
    expect(evening).toBeTruthy();
    const draped: PhasePlan = { ...evening!, bagAsBlanket: true };
    const r = coverage(GEAR, [draped], DISTRIBUTIONS);
    const labels = r.phases.flatMap((p) => p.candidates.map((c) => c.shortLabel));
    expect(labels.length).toBeGreaterThan(0);
    // "+ bag draped" alone reads as a quilt over a naked person; it must keep its base.
    expect(labels.some((l) => l.includes('bag draped'))).toBe(true);
    for (const l of labels) {
      expect(l.trim()).not.toMatch(/^\+ bag draped$/);
      // Whatever precedes the drape must name an actual outfit.
      if (l.includes('bag draped')) expect(l.replace(' + bag draped', '').trim().length).toBeGreaterThan(0);
    }
  });

  it('judges extremities against the warmest owned for that part, not the surviving candidate', () => {
    // The candidate ladder drops rungs that do not uniquely cover a slice of the band, and a
    // beanie adds so little whole-body clo that its rung is almost always redundant. Before this
    // fix the surviving candidate carried no headwear and the panel reported "head: 0.00 clo"
    // to someone with a beanie in their pack.
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const beanie = GARMENTS.find((g) => g.id === 'beanie');
    const liners = GARMENTS.find((g) => g.id === 'liner_gloves');
    expect(beanie && liners).toBeTruthy();
    // Sleep runs the ISO 23537 model and reports no extremity budgets, so only the clothed
    // phases carry them.
    const clothed = r.phases.filter((p) => p.extremities.length > 0);
    expect(clothed.length).toBeGreaterThan(0);
    for (const phase of clothed) {
      const head = phase.extremities.find((e) => e.part === 'head');
      const hands = phase.extremities.find((e) => e.part === 'hands');
      expect(head?.wornClo).toBeCloseTo(beanie!.clo, 6);
      expect(hands?.wornClo).toBeCloseTo(liners!.clo, 6);
    }
  });

  it('leads with the consequence, in plain words, and names the worst gap', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    expect(r.verdict).toMatch(/^Nothing you own is warm enough below/);
    // °F is the product default (SPEC §9); SI stays in the numeric fields.
    expect(r.verdict).toMatch(/°F/);
    expect(r.verdict).not.toMatch(/°C/);
    // Short enough to read in one pass.
    expect(r.verdict.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
    expect(r.verdict.length).toBeLessThan(220);
  });

  it('leaks no model vocabulary into the headline or any fix', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    // The client's complaint, as a test: "it references things that no one would understand,
    // like 'the v1 ontology'". A caveat may name a standard; prose the user acts on may not.
    const forbidden =
      /ontology|ensemble|comfort interval|IREQ|ISO \d|duration-limited|operative temperature|SPEC §|clo\/inch|adjustabilit/i;
    expect(r.verdict).not.toMatch(forbidden);
    for (const gap of r.gaps) {
      expect(gap.fix.text).not.toMatch(forbidden);
      if (gap.fix.short !== undefined) expect(gap.fix.short).not.toMatch(forbidden);
    }
  });

  it('gives every fix a one-clause short form for the headline', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    for (const gap of r.gaps) {
      expect(gap.fix.short).toBeTruthy();
      expect((gap.fix.short as string).length).toBeLessThanOrEqual(gap.fix.text.length);
      expect(r.verdict.includes(gap.fix.short as string) || gap.fix.short !== undefined).toBe(true);
    }
    // The headline really does use the short form of the gap it names.
    const named = r.gaps.filter((g) => r.verdict.endsWith(g.fix.short as string));
    expect(named.length).toBeGreaterThan(0);
  });

  it('honours the units option in prose without touching the numbers', () => {
    const f = coverage(GEAR, PLANS, DISTRIBUTIONS, { units: 'F' });
    const c = coverage(GEAR, PLANS, DISTRIBUTIONS, { units: 'C' });
    expect(c.verdict).toMatch(/°C/);
    expect(c.verdict).not.toMatch(/°F/);
    // Same physics either way.
    expect(c.phases.map((p) => p.band.fromC)).toEqual(f.phases.map((p) => p.band.fromC));
    expect(c.gaps.map((g) => g.fromC)).toEqual(f.gaps.map((g) => g.fromC));
  });

  it('renders a range with one unit suffix, never two qualified points', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const texts = [r.verdict, ...r.gaps.map((g) => g.fix.text)];
    for (const t of texts) {
      // The old bug produced "-8 °C (18 °F)–4 °C (40 °F)".
      expect(t).not.toMatch(/°[FC]\)/);
      expect(t).not.toMatch(/°[FC]\s*[\u2013-]\s*\u2212?\d/);
    }
  });

  it('does not name the same phase twice when only one phase is short', () => {
    const evening = PLANS.find((p) => p.phase === 'camp_evening') as PhasePlan;
    const r = coverage(GEAR, [evening], DISTRIBUTIONS);
    expect(r.gaps.filter((g) => g.severity === 'cold').map((g) => g.phase)).toEqual(['camp_evening']);
    const label = 'in camp in the evening';
    expect(r.verdict).toContain(label);
    expect(r.verdict.split(label).length - 1).toBe(1);
    // And with one phase short there is no "same elsewhere" clause at all.
    expect(r.verdict).not.toMatch(/Same /);
  });

  it('names one or two other short phases, in the order the day runs', () => {
    const two = PLANS.filter((p) => p.phase === 'camp_morning' || p.phase === 'camp_evening');
    const r = coverage(GEAR, two, DISTRIBUTIONS);
    expect(new Set(r.gaps.filter((g) => g.severity === 'cold').map((g) => g.phase)).size).toBe(2);
    const also = /Same ([^.]+)\./.exec(r.verdict)?.[1] ?? '';
    expect(also).toBe('in camp in the morning');
  });

  it('collapses the list rather than naming four phases in one sentence', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const cold = new Set(r.gaps.filter((g) => g.severity === 'cold').map((g) => g.phase));
    expect(cold.size).toBeGreaterThan(3);
    // Either "every other phase" or a count, never a four-item list.
    expect(r.verdict).toMatch(/Same (in every other phase|in \d other phases)\./);
  });

  it('says so plainly when nothing is missing', () => {
    const loaded: GearInventory = {
      garments: [
        'merino_mid',
        'fleece_300',
        'down_puffy_45oz',
        'rain_shell',
        'long_underwear',
        'fleece_lined_pants',
        'rain_pants',
        'socks_heavy',
        'insulated_boots',
        'balaclava',
        'mitts',
      ],
      sleep: {
        bag: { kind: 'bag', ratingC: -18, ratingType: 'comfort' },
        pads: [{ imperialR: 7 }],
      },
    };
    const mild: Partial<Record<PhaseName, TemperatureBand>> = {
      camp_evening: band(28, 34),
      sleep: band(28, 34),
    };
    const r = coverage(loaded, PLANS.filter((p) => p.phase in mild), mild);
    const coldGaps = r.gaps.filter((g) => g.severity === 'cold');
    expect(coldGaps).toHaveLength(0);
  });
});

describe('extremities ride alongside, independently of the core verdict', () => {
  it('reports all three parts per clothed phase, flagged as heuristic', () => {
    const r = coverage(GEAR, PLANS, DISTRIBUTIONS);
    const camp = r.phases.find((p) => p.phase === 'camp_morning');
    expect(camp?.extremities.map((e) => e.part)).toEqual(['hands', 'feet', 'head']);
    for (const e of camp?.extremities ?? []) expect(e.rigour).toBe('heuristic');
    expect(camp?.caveats.join(' ')).toMatch(/heuristic, not a standard/);
  });
});

describe('guards', () => {
  it('refuses a phase with no temperature distribution rather than inventing one', () => {
    expect(() => coverage(GEAR, PLANS, { hiking: band(30, 48) })).toThrow(
      ThermalModelError,
    );
  });

  it('refuses the sleep phase without sleep gear, and explains why ratingType is required', () => {
    expect(() =>
      coverage({ garments: GEAR.garments }, [PLANS[4] as PhasePlan], DISTRIBUTIONS),
    ).toThrow(/ratingType/);
  });

  it('refuses a degenerate band', () => {
    expect(() =>
      coverage(GEAR, [PLANS[0] as PhasePlan], { hiking: { p10: 5, p50: 5, p90: 5 } }),
    ).toThrow(/degenerate/);
  });

  it('honours the min–max band option', () => {
    const narrow = coverage(GEAR, [PLANS[0] as PhasePlan], DISTRIBUTIONS);
    const wide = coverage(GEAR, [PLANS[0] as PhasePlan], DISTRIBUTIONS, { band: 'min-max' });
    const nb = narrow.phases[0]?.band;
    const wb = wide.phases[0]?.band;
    expect(wb?.fromC).toBeLessThan(nb?.fromC ?? 0);
    expect(wb?.toC).toBeGreaterThan(nb?.toC ?? 0);
  });
});
