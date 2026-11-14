import { describe, expect, it } from 'vitest';
import {
  EXTREMITY_PARAMETERS,
  EXTREMITY_UNVERIFIED_CONSTANTS,
  assessExtremities,
  assessExtremity,
} from './extremities.js';

/**
 * A person standing still in camp with their core exactly at the comfort threshold: the
 * case where vasoconstriction has shut the extremities down. That is the interesting state;
 * a hiker with headroom to spare has warm hands in liner gloves and the model says so.
 */
const base = { operativeTemperatureC: 0, coreMarginClo: 0, met: 1.1 };

describe('the extremity model is honestly labelled', () => {
  it('every result says it is a heuristic, in the type and in the text', () => {
    const r = assessExtremity({ ...base, part: 'hands', wornClo: 0.05 });
    expect(r.rigour).toBe('heuristic');
    expect(r.caveat).toMatch(/heuristic, not a standard/);
    expect(r.caveat).toMatch(/nothing\s+rigorous on local cooling/);
  });

  it('every parameter it uses is registered as unverified', () => {
    expect(EXTREMITY_UNVERIFIED_CONSTANTS.length).toBeGreaterThanOrEqual(9);
    for (const c of EXTREMITY_UNVERIFIED_CONSTANTS) {
      expect(c.provenance).toBe('estimated');
      expect(c.id).toMatch(/^extremities\./);
    }
  });
});

describe('calibration sanity checks (the only evidence these numbers have)', () => {
  it('at 0 °C liner gloves are not enough and insulated mitts are about the threshold', () => {
    const liners = assessExtremity({ ...base, part: 'hands', wornClo: 0.05 });
    const mitts = assessExtremity({ ...base, part: 'hands', wornClo: 0.25 });
    expect(liners.verdict).toBe('cold');
    expect(['marginal', 'fine']).toContain(mitts.verdict);
  });

  it('at 0 °C a beanie is about the threshold for the head', () => {
    const bare = assessExtremity({ ...base, part: 'head', wornClo: 0 });
    const beanie = assessExtremity({ ...base, part: 'head', wornClo: 0.1 });
    expect(bare.verdict).toBe('cold');
    expect(['marginal', 'fine']).toContain(beanie.verdict);
  });

  it('at 0 °C trail runners plus midweight socks leave the feet short', () => {
    const r = assessExtremity({ ...base, part: 'feet', wornClo: 0.08 + 0.03 });
    expect(r.verdict).toBe('cold');
    const boots = assessExtremity({ ...base, part: 'feet', wornClo: 0.3 + 0.05 });
    expect(['marginal', 'fine']).toContain(boots.verdict);
  });

  it('but a hiker with core headroom to spare is fine in liner gloves at 0 °C', () => {
    const moving = assessExtremity({
      operativeTemperatureC: 0,
      coreMarginClo: 0.5,
      met: 3,
      part: 'hands',
      wornClo: 0.05,
    });
    expect(['marginal', 'fine']).toContain(moving.verdict);
  });

  it('the head is the part that does not vasoconstrict: the highest local flux', () => {
    expect(EXTREMITY_PARAMETERS.head.fluxVasoconstricted).toBeGreaterThan(
      EXTREMITY_PARAMETERS.hands.fluxOpen,
    );
  });
});

describe('monotonicity', () => {
  it('colder air never lowers the requirement', () => {
    let previous = -Infinity;
    for (const t of [10, 5, 0, -10, -20, -30]) {
      const r = assessExtremity({ ...base, operativeTemperatureC: t, part: 'hands', wornClo: 0.1 });
      expect(r.requiredClo).toBeGreaterThan(previous);
      previous = r.requiredClo;
    }
  });

  it('more insulation never worsens the verdict margin', () => {
    let previous = -Infinity;
    for (const clo of [0, 0.05, 0.1, 0.25, 0.5]) {
      const r = assessExtremity({ ...base, part: 'hands', wornClo: clo });
      expect(r.marginClo).toBeGreaterThan(previous);
      previous = r.marginClo;
    }
  });

  it('a cold core makes the extremities worse, which is the SPEC §2.4 coupling', () => {
    const warmCore = assessExtremity({ ...base, coreMarginClo: 1, part: 'feet', wornClo: 0.15 });
    const coldCore = assessExtremity({ ...base, coreMarginClo: -1, part: 'feet', wornClo: 0.15 });
    expect(coldCore.requiredClo).toBeGreaterThan(warmCore.requiredClo);
    expect(coldCore.localFlux).toBeLessThan(warmCore.localFlux);
    expect(coldCore.warnings.map((w) => w.code)).toContain('extremity_core_coupled');
  });

  it('working hands are warmer hands', () => {
    const resting = assessExtremity({ ...base, met: 1.1, part: 'hands', wornClo: 0.1 });
    const hiking = assessExtremity({ ...base, met: 3, part: 'hands', wornClo: 0.1 });
    expect(hiking.requiredClo).toBeLessThan(resting.requiredClo);
    expect(hiking.localFlux).toBeGreaterThan(resting.localFlux);
  });

  it('wind raises the requirement unless the part is windproofed', () => {
    const still = assessExtremity({ ...base, airVelocity: 0.1, part: 'hands', wornClo: 0.1 });
    const windy = assessExtremity({ ...base, airVelocity: 8, part: 'hands', wornClo: 0.1 });
    const shelled = assessExtremity({
      ...base,
      airVelocity: 8,
      windproof: true,
      part: 'hands',
      wornClo: 0.1,
    });
    expect(windy.requiredClo).toBeGreaterThan(still.requiredClo);
    expect(shelled.requiredClo).toBeLessThan(windy.requiredClo);
  });
});

describe('the verdicts are independent of the core verdict (SPEC §2.4)', () => {
  it('a warm core can still have cold hands', () => {
    const [hands] = assessExtremities(
      { operativeTemperatureC: -20, coreMarginClo: 2, met: 1.1 },
      { hands: 0.05, feet: 0.35, head: 0.18 },
    );
    expect(hands?.verdict).toBe('cold');
  });

  it('never claims "dangerous": there is no frostbite criterion behind this model', () => {
    for (const part of ['hands', 'feet', 'head'] as const) {
      const r = assessExtremity({
        operativeTemperatureC: -40,
        coreMarginClo: -3,
        met: 1.1,
        part,
        wornClo: 0,
      });
      expect(r.verdict).toBe('cold');
    }
  });

  it('returns all three parts in a stable order', () => {
    const all = assessExtremities(base, { hands: 0.1, feet: 0.1, head: 0.1 });
    expect(all.map((x) => x.part)).toEqual(['hands', 'feet', 'head']);
  });
});
