import { describe, expect, it } from 'vitest';
import {
  ANNEX_C_PARAMETERS,
  DEFAULT_UNDER_BODY_AREA_FRACTION,
  ISO_23537_TABLE_1,
  QUILT_LABEL_CORRECTION_K,
  REFERENCE_MATTRESS_IMPERIAL_R,
  REFERENCE_MATTRESS_RSI,
  TABLE_1_RANGE,
  annexCResistance,
  annexCTemperature,
  bagAsBlanketClo,
  interpolateTable1,
  padResistance,
  referenceMattressImperialR,
  solveSleepSystem,
  type BagSpec,
} from './sleep.js';
import { ThermalModelError } from './types.js';
import {
  CLO_PER_IMPERIAL_R,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  siToClo,
} from './units.js';

describe('ISO 23537 Annex C reproduces Table 1: all 72 cells (hard acceptance test)', () => {
  const cells = ISO_23537_TABLE_1.flatMap((row) => [
    { rc: row.rc, kind: 'extreme' as const, expected: row.extremeC },
    { rc: row.rc, kind: 'limit' as const, expected: row.limitC },
    { rc: row.rc, kind: 'comfort' as const, expected: row.comfortC },
  ]);

  it('has exactly 72 cells', () => {
    expect(ISO_23537_TABLE_1).toHaveLength(24);
    expect(cells).toHaveLength(72);
  });

  it.each(cells)('R_c = $rc, $kind → $expected °C within 0.1 K', ({ rc, kind, expected }) => {
    expect(Math.abs(annexCTemperature(rc, kind) - expected)).toBeLessThan(0.1);
  });

  it('the worst cell across the whole table is still inside 0.1 K', () => {
    const worst = cells.reduce(
      (acc, c) => Math.max(acc, Math.abs(annexCTemperature(c.rc, c.kind) - c.expected)),
      0,
    );
    expect(worst).toBeLessThan(0.1);
  });

  it('inverts cleanly: temperature → R_c → temperature', () => {
    for (const row of ISO_23537_TABLE_1) {
      expect(annexCResistance(row.comfortC, 'comfort')).toBeCloseTo(row.rc, 2);
    }
  });

  it('uses the corrected parameter assignment, not [T4]’s garbled one', () => {
    // Shivering belongs to T_ext; the 0.9 relaxed-posture factor belongs to T_comf.
    expect(ANNEX_C_PARAMETERS.extreme.shiveringMetabolicRate).toBe(25.4);
    expect(ANNEX_C_PARAMETERS.comfort.shiveringMetabolicRate).toBe(0);
    expect(ANNEX_C_PARAMETERS.comfort.effectiveResistanceFactor).toBe(0.9);
    expect(ANNEX_C_PARAMETERS.extreme.effectiveResistanceFactor).toBe(1.0);
    // T_comf / T_ext are the standard woman, T_lim the standard man (STANDARDS §3.4).
    expect(ANNEX_C_PARAMETERS.comfort.referencePerson).toBe('standard woman');
    expect(ANNEX_C_PARAMETERS.limit.referencePerson).toBe('standard man');
  });
});

describe('Table 1 interpolation (the normative method, ISO 23537-1 §4.1)', () => {
  it('matches the accredited lab measurement in STANDARDS §3.1', () => {
    // SGS Hong Kong SL12300358882101TX: R_c(1) = 1.195 → −31 / −11 / −5 °C.
    const r = interpolateTable1(1.195);
    expect(r.extremeC).toBeCloseTo(-31.25, 1);
    expect(r.limitC).toBeCloseTo(-11.53, 1);
    expect(r.comfortC).toBeCloseTo(-4.85, 1);
    expect(Math.round(r.extremeC)).toBe(-31);
    expect(Math.round(r.limitC)).toBe(-12); // rounds to −11.53 → lab reported −11
    expect(Math.round(r.comfortC)).toBe(-5);
  });

  it('agrees with the Annex C solver everywhere inside the table’s validity range', () => {
    for (let rc = TABLE_1_RANGE.minRc; rc <= TABLE_1_RANGE.maxRc + 1e-9; rc += 0.01) {
      const table = interpolateTable1(rc);
      expect(Math.abs(annexCTemperature(rc, 'comfort') - table.comfortC)).toBeLessThan(0.12);
      expect(Math.abs(annexCTemperature(rc, 'limit') - table.limitC)).toBeLessThan(0.12);
    }
  });
});

describe('the reference mattress is inside every bag rating (STANDARDS §3.5, §4.7)', () => {
  it('R_ct = 0.85 m²K/W ≈ imperial R 4.83', () => {
    expect(REFERENCE_MATTRESS_RSI).toBe(0.85);
    expect(referenceMattressImperialR()).toBeCloseTo(4.827, 2);
    expect(REFERENCE_MATTRESS_IMPERIAL_R).toBeCloseTo(4.827, 2);
  });

  it('1 imperial R = 1.136 clo (STANDARDS §4.5)', () => {
    expect(CLO_PER_IMPERIAL_R).toBeCloseTo(1.13619, 4);
    expect(padResistance([{ imperialR: 4.2 }]).clo).toBeCloseTo(4.2 * 1.13619, 3);
  });
});

describe('label semantics: a US 20 °F bag (acceptance test)', () => {
  const twentyF: BagSpec = {
    kind: 'bag',
    ratingC: fahrenheitToCelsius(20),
    ratingType: 'limit',
  };

  it('T_lim = −6.7 °C → R_c ≈ 1.061 m²K/W → T_comf ≈ −0.7 °C ≈ 31 °F', () => {
    expect(twentyF.ratingC).toBeCloseTo(-6.667, 3);
    const rc = annexCResistance(twentyF.ratingC, 'limit');
    expect(rc).toBeCloseTo(1.061, 2);
    const comfort = annexCTemperature(rc, 'comfort');
    expect(comfort).toBeCloseTo(-0.7, 1);
    expect(celsiusToFahrenheit(comfort)).toBeCloseTo(31, 0);
  });

  it('reproduces it end-to-end through the system solver with the reference mattress', () => {
    const s = solveSleepSystem({
      bag: twentyF,
      pads: [{ imperialR: REFERENCE_MATTRESS_IMPERIAL_R }],
    });
    expect(s.labelRc).toBeCloseTo(1.061, 2);
    expect(celsiusToFahrenheit(s.labelComfortC)).toBeCloseTo(31, 0);
    // With exactly the reference mattress the user's system IS the label: no penalty.
    expect(s.padPenaltyK).toBeCloseTo(0, 2);
    expect(s.systemRc).toBeCloseTo(s.labelRc, 3);
  });

  it('the same number read as a European comfort rating is a very different bag', () => {
    const euro: BagSpec = { kind: 'bag', ratingC: fahrenheitToCelsius(20), ratingType: 'comfort' };
    const us = solveSleepSystem({ bag: twentyF, pads: [{ imperialR: 4.83 }] });
    const eu = solveSleepSystem({ bag: euro, pads: [{ imperialR: 4.83 }] });
    expect(eu.labelRc).toBeGreaterThan(us.labelRc);
    // ~6 K apart: this is why `ratingType` is required and never guessed.
    expect(us.labelComfortC - eu.labelComfortC).toBeGreaterThan(5);
  });
});

describe('the pad delta: the correction SPEC §2.5 gets wrong', () => {
  const bag: BagSpec = { kind: 'bag', ratingC: fahrenheitToCelsius(20), ratingType: 'limit' };

  it('a pad below the reference mattress makes the label optimistic, and says by how much', () => {
    const s = solveSleepSystem({ bag, pads: [{ imperialR: 3.2 }] });
    expect(s.padPenaltyK).toBeGreaterThan(0);
    expect(s.comfortC).toBeGreaterThan(s.labelComfortC);
    expect(s.warnings.map((w) => w.code)).toContain('sleep_pad_below_reference');
  });

  it('a better pad than the reference buys the difference back', () => {
    const s = solveSleepSystem({ bag, pads: [{ imperialR: 7 }] });
    expect(s.padPenaltyK).toBeLessThan(0);
    expect(s.comfortC).toBeLessThan(s.labelComfortC);
  });

  it('comfort temperature is monotone decreasing in pad R', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const r of [1, 2, 3, 4, 4.83, 5.5, 7, 9]) {
      const c = solveSleepSystem({ bag, pads: [{ imperialR: r }] }).comfortC;
      expect(c).toBeLessThan(previous);
      previous = c;
    }
  });

  it('never simply adds the pad R on top of the bag rating (the double-count SPEC §2.5 invites)', () => {
    const s = solveSleepSystem({ bag, pads: [{ imperialR: 4.83 }] });
    const naiveDoubleCount = siToClo(s.labelRc) + 4.83 * CLO_PER_IMPERIAL_R;
    expect(siToClo(s.systemRc)).toBeLessThan(naiveDoubleCount * 0.75);
  });

  it('the over- and under-paths are a parallel pair that reproduces the label', () => {
    const s = solveSleepSystem({ bag, pads: [{ imperialR: REFERENCE_MATTRESS_IMPERIAL_R }] });
    const a = DEFAULT_UNDER_BODY_AREA_FRACTION;
    const reconstructed = 1 / (a / s.referenceUnderPathRc + (1 - a) / s.overPathRc);
    expect(reconstructed).toBeCloseTo(s.labelRc, 6);
    // The under-path carries roughly half the heat loss on a third of the area.
    expect(s.underPathHeatShare).toBeGreaterThan(0.3);
    expect(s.underPathHeatShare).toBeLessThan(0.6);
  });
});

describe('pad stacking', () => {
  it('adds R-values and surfaces the caveat that nobody has ever measured this', () => {
    const bag: BagSpec = { kind: 'bag', ratingC: -7, ratingType: 'limit' };
    const stacked = solveSleepSystem({ bag, pads: [{ imperialR: 4.2 }, { imperialR: 2.0 }] });
    const single = solveSleepSystem({ bag, pads: [{ imperialR: 6.2 }] });
    expect(stacked.systemRc).toBeCloseTo(single.systemRc, 10);
    expect(stacked.warnings.map((w) => w.code)).toContain('sleep_pad_additivity_unmeasured');
    expect(stacked.caveats.join(' ')).toMatch(/no published measurement/i);
  });
});

describe('quilts, hoods and worn clothing', () => {
  const quiltBase = { kind: 'quilt' as const, ratingC: fahrenheitToCelsius(20), ratingType: 'limit' as const };

  it('applies SPEC §2.5’s empirical label corrections and labels them as empirical', () => {
    expect(QUILT_LABEL_CORRECTION_K.cottage).toBeCloseTo(1.667, 3);
    expect(QUILT_LABEL_CORRECTION_K['direct-import']).toBeCloseTo(5.556, 3);
    const cottage = solveSleepSystem({
      bag: { ...quiltBase, quiltProvenance: 'cottage' },
      pads: [{ imperialR: 4.83 }],
    });
    const direct = solveSleepSystem({
      bag: { ...quiltBase, quiltProvenance: 'direct-import' },
      pads: [{ imperialR: 4.83 }],
    });
    expect(direct.comfortC).toBeGreaterThan(cottage.comfortC);
    expect(cottage.caveats.join(' ')).toMatch(/empirical correction/i);
  });

  it('warns when quilt provenance is left unspecified rather than guessing', () => {
    const s = solveSleepSystem({ bag: quiltBase, pads: [{ imperialR: 4.83 }] });
    expect(s.warnings.map((w) => w.code)).toContain('sleep_quilt_provenance_unspecified');
  });

  it('a hoodless quilt is colder than the same rating with the hood the ISO test cinches', () => {
    const withHood = solveSleepSystem({
      bag: { ...quiltBase, hoodUsed: true, draftCollar: true },
      pads: [{ imperialR: 4.83 }],
    });
    const withoutHood = solveSleepSystem({
      bag: { ...quiltBase, hoodUsed: false, draftCollar: true },
      pads: [{ imperialR: 4.83 }],
    });
    expect(withoutHood.comfortC).toBeGreaterThan(withHood.comfortC);
    expect(withoutHood.caveats.join(' ')).toMatch(/hood/i);
  });

  it('headwear partly recovers the hoodless penalty', () => {
    const bare = solveSleepSystem({
      bag: { ...quiltBase, hoodUsed: false },
      pads: [{ imperialR: 4.83 }],
    });
    const beanie = solveSleepSystem({
      bag: { ...quiltBase, hoodUsed: false },
      pads: [{ imperialR: 4.83 }],
      headwearClo: 0.1,
    });
    expect(beanie.comfortC).toBeLessThan(bare.comfortC);
  });

  it('clothing worn inside only counts beyond the reference base layer', () => {
    const bag: BagSpec = { kind: 'bag', ratingC: -7, ratingType: 'limit' };
    const pads = [{ imperialR: 4.83 }];
    const nothing = solveSleepSystem({ bag, pads });
    const baseLayerOnly = solveSleepSystem({ bag, pads, clothingInsideClo: 0.3 });
    const puffy = solveSleepSystem({ bag, pads, clothingInsideClo: 2.1 });
    expect(baseLayerOnly.comfortC).toBeCloseTo(nothing.comfortC, 6);
    expect(puffy.comfortC).toBeLessThan(nothing.comfortC - 2);
  });

  it('a missing draft collar costs something and says it is estimated', () => {
    const bag: BagSpec = { kind: 'bag', ratingC: -7, ratingType: 'limit', draftCollar: false };
    const s = solveSleepSystem({ bag, pads: [{ imperialR: 4.83 }] });
    const withCollar = solveSleepSystem({
      bag: { ...bag, draftCollar: true },
      pads: [{ imperialR: 4.83 }],
    });
    expect(s.comfortC).toBeGreaterThan(withCollar.comfortC);
    expect(s.caveats.join(' ')).toMatch(/estimated, not measured/i);
  });
});

describe('ground temperature', () => {
  it('reduces to plain Annex C at zero offset and helps when the soil is warmer', () => {
    const bag: BagSpec = { kind: 'bag', ratingC: -7, ratingType: 'limit' };
    const flat = solveSleepSystem({ bag, pads: [{ imperialR: 3 }] });
    const zero = solveSleepSystem({ bag, pads: [{ imperialR: 3 }], groundTemperatureOffsetK: 0 });
    const warmSoil = solveSleepSystem({
      bag,
      pads: [{ imperialR: 3 }],
      groundTemperatureOffsetK: 5,
    });
    expect(zero.comfortC).toBeCloseTo(flat.comfortC, 10);
    expect(warmSoil.comfortC).toBeLessThan(flat.comfortC);
  });
});

describe('guards', () => {
  it('warns when the label implies an R_c outside ISO 23537 Table 1’s range', () => {
    const deepWinter = solveSleepSystem({
      bag: { kind: 'bag', ratingC: -30, ratingType: 'comfort' },
      pads: [{ imperialR: 6 }],
    });
    expect(deepWinter.warnings.map((w) => w.code)).toContain('sleep_outside_table_1');
  });

  it('warns rather than silently modelling bare ground when no pad is given', () => {
    const s = solveSleepSystem({
      bag: { kind: 'bag', ratingC: -7, ratingType: 'limit' },
      pads: [],
    });
    expect(s.warnings.map((w) => w.code)).toContain('sleep_no_pad');
    expect(s.comfortC).toBeGreaterThan(s.labelComfortC + 10);
  });

  it('throws rather than returning NaN for a nonsensical R_c', () => {
    expect(() => annexCTemperature(0, 'comfort')).toThrow(ThermalModelError);
    expect(() => annexCTemperature(Number.NaN, 'comfort')).toThrow(ThermalModelError);
  });
});

describe('bag as a blanket', () => {
  it('a US 20 °F bag draped over your shoulders is worth ≈ 2.5 clo (the reference doc’s figure)', () => {
    const clo = bagAsBlanketClo({
      kind: 'bag',
      ratingC: fahrenheitToCelsius(20),
      ratingType: 'limit',
    });
    expect(clo).toBeCloseTo(2.5, 1);
  });
});
