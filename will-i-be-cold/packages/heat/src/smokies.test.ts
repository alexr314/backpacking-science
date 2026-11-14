/**
 * Regression vectors from `REFERENCE_warmth_check.md`: the simple field model this engine
 * replaces.
 *
 * **What is and is not a regression target.** The reference document's *verdicts* are the
 * target: they encode real field experience on the AT in the Smokies in mid-November. Its
 * *clo numbers* for sleeping bags are not: `MODEL.md` §2 shows they were back-derived from the
 * same naive `clo_required = (33 − t_a)/(0.155·M)` formula they are compared against, so they
 * can only reproduce that formula, never test it. Where the rigorous model disagrees with a
 * reference number, the test asserts the verdict and the comment records both numbers and why.
 *
 * Conditions used here: overcast (cloudCover 1) and near-still air, which is the closest this
 * engine can get to the reference document's explicit "the equation assumes still air" and its
 * complete absence of a radiation term. Any wind or clear sky makes the rigorous model harsher
 * still.
 */
import { describe, expect, it } from 'vitest';
import { assess, metToWm2, type ClothedConfiguration, type PhaseConditions } from './assess.js';
import { ensembleInsulation, garment } from './garments.js';
import { bagAsBlanketClo, solveSleepSystem, type BagSpec } from './sleep.js';
import { celsiusToFahrenheit, fahrenheitToCelsius } from './units.js';

/** Andy's list, verbatim from `REFERENCE_warmth_check.md`'s worked example. */
const ANDY = [
  'ls_synthetic', // polyester long-sleeve sun shirt, 0.25
  'grid_fleece', // Mountain Hardwear grid fleece hoodie, 0.50
  'rain_shell', // rain shell jacket, 0.20
  'alpha_leggings', // Alpha 90 leggings, 0.55
  'rain_pants', // rain shell pants, 0.20
  'socks_light', // wool socks …
  'boots', // … + boots, 0.10 combined in the reference table
].map(garment);

const CONDITIONS: Omit<PhaseConditions, 'airTemperature'> = {
  relativeHumidity: 0.75,
  cloudCover: 1,
  windSpeed: 0.5,
  shelter: 'open',
};

const at = (fahrenheit: number, met: number, garments = ANDY, extraClo = 0) =>
  assess(
    {
      kind: 'clothed',
      garments,
      metabolicRate: metToWm2(met),
      ...(extraClo > 0 ? { extraClo } : {}),
    } satisfies ClothedConfiguration,
    { ...CONDITIONS, airTemperature: fahrenheitToCelsius(fahrenheit) },
  );

const TWENTY_F_BAG: BagSpec = {
  kind: 'bag',
  ratingC: fahrenheitToCelsius(20),
  ratingType: 'limit',
};

describe('Andy’s kit: the reference document’s worked example', () => {
  it('sums to the reference doc’s 1.8 clo before the ISO 9920 ensemble rule', () => {
    const e = ensembleInsulation(ANDY);
    expect(e.sumClo).toBeCloseTo(1.82, 2); // reference doc: 1.80
    // ⚠️ Disagreement worth knowing: the reference doc *adds* the garments; ISO 9920 Eq. (11)
    // applies 0.161 + 0.835·Σ, which here gives 1.68 clo: 0.12 clo less, because overlapping
    // layers compress. We ship the standard's rule.
    expect(e.clo).toBeCloseTo(1.68, 2);
  });

  it('HIKING at 30 °F, 3.0 MET → fine (reference: fine)', () => {
    const a = at(30, 3.0);
    expect(a.model).toBe('iso-11079-ireq');
    expect(a.verdict).toBe('fine');
    expect(a.marginK).toBeGreaterThan(0);
    // Numbers: rigorous required 1.15 clo vs the reference doc's 1.3 clo. The rigorous model
    // is *less* demanding while moving, exactly as MODEL.md §1 predicted: the boundary-layer
    // term it omits is worth more than the respiratory terms it also omits, at this M.
    const d = a.detail;
    expect(d.model).toBe('iso-11079-ireq');
    if (d.model === 'iso-11079-ireq') {
      expect(d.requiredNeutralClo).toBeGreaterThan(1.0);
      expect(d.requiredNeutralClo).toBeLessThan(1.35);
    }
  });

  it('…and the reference doc’s own note holds: the fleece comes off on climbs', () => {
    const withoutFleece = at(30, 3.0, ANDY.filter((x) => x.id !== 'grid_fleece'));
    expect(withoutFleece.verdict).not.toBe('cold');
    // The full kit is at the warm end of its own interval, which is why you shed a layer.
    const full = at(30, 3.0);
    expect(full.marginK).toBeGreaterThan(withoutFleece.marginK);
  });

  it('LUNCH STOP at 35 °F, 1.3 MET → cold (reference: cold within ~15 min)', () => {
    const a = at(35, 1.3);
    expect(a.verdict).toBe('cold');
    // Numbers: rigorous 3.09 clo required vs the reference doc's 2.7. The rigorous model is
    // ~0.4 clo *more* demanding standing still: MODEL.md §1's prediction again, with the sign
    // flipped because the respiratory and evaporative terms now dominate the boundary layer.
    const d = a.detail;
    if (d.model === 'iso-11079-ireq') {
      expect(d.requiredNeutralClo).toBeGreaterThan(2.9);
      expect(d.requiredNeutralClo).toBeLessThan(3.3);
      expect(d.marginClo).toBeLessThan(-0.3); // the reference doc's own "cold" threshold
    }
    // DLE is a separate safety line, never "minutes until you feel cold" (MODEL.md §4).
    if (d.model === 'iso-11079-ireq') {
      expect(d.dleNeutral.significantFigures).toBe(1);
    }
    expect(a.warnings.map((w) => w.code)).toContain('short_duration_limited_exposure');
  });

  it('CAMP EVENING at 25 °F, 1.1 MET → cold (reference: cold unless you sit in your bag)', () => {
    const a = at(25, 1.1);
    expect(a.verdict).toBe('cold');
    const d = a.detail;
    if (d.model === 'iso-11079-ireq') {
      // rigorous 4.46 clo vs reference 3.7: the gap grows as M falls, as MODEL.md §1 says.
      expect(d.requiredNeutralClo).toBeGreaterThan(4.2);
      expect(d.requiredNeutralClo).toBeLessThan(4.8);
    }
  });

  it('…and sitting in the bag fixes it, but by less than the reference doc claims', () => {
    const drape = bagAsBlanketClo(TWENTY_F_BAG);
    expect(drape).toBeCloseTo(2.5, 1); // the reference doc's "+2.5 clo, leaky"
    const a = at(25, 1.1, ANDY, drape);
    // ⚠️ **Disagreement.** The reference doc computes 1.8 + 2.5 = 4.3 clo against a 3.7 clo
    // requirement → +0.6 → "fine". The rigorous model computes 1.68 + 2.48 = 4.16 clo against
    // a 4.46 clo requirement → −0.30 → "marginal". The difference is entirely in the
    // *requirement* (4.46 vs 3.72): the reference formula omits the respiratory and
    // evaporative terms, which at 1.1 MET are worth ~0.7 clo. The bag's contribution agrees
    // to 0.02 clo. So: it is the fix, and it is not quite enough.
    expect(a.verdict).not.toBe('cold');
    expect(['marginal', 'fine']).toContain(a.verdict);
  });

  it('ASLEEP at 20 °F: the reference doc could not answer; this engine can', () => {
    // "the test is a reputable 20 °F rating (or ISO comfort ≤ 25 °F) and combined pad R ≥ 4"
    const a = assess(
      { kind: 'sleep', system: { bag: TWENTY_F_BAG, pads: [{ imperialR: 4.2 }] } },
      { ...CONDITIONS, airTemperature: fahrenheitToCelsius(20), shelter: 'tent' },
    );
    expect(a.model).toBe('iso-23537-annex-c');
    expect(a.verdict).toBe('cold');
    const d = a.detail;
    if (d.model === 'iso-23537-annex-c') {
      // The headline for the video: a US "20 °F bag" has an ISO comfort rating of ~31 °F
      // before you account for the pad, which independently reproduces the reference doc's
      // own line ("its comfort rating is 31–32 °F") from ISO 23537's normative table.
      expect(celsiusToFahrenheit(d.labelComfortC)).toBeCloseTo(31, 0);
      // …and an R 4.2 pad, a hair under the R 4.83 reference mattress, costs ~2 K more.
      expect(d.padPenaltyK).toBeGreaterThan(1);
      expect(d.padPenaltyK).toBeLessThan(3);
      expect(celsiusToFahrenheit(d.comfortC)).toBeCloseTo(34, 0);
    }
  });
});

describe('Andy’s recommendation: the outcome the reference document predicts', () => {
  const ANDY_PLUS = [...ANDY, garment('down_puffy_3oz'), garment('beanie')];

  it('a ~3 oz hooded puffy and a beanie lift the lunch stop out of "cold"', () => {
    expect(at(35, 1.3).verdict).toBe('cold');
    expect(at(35, 1.3, ANDY_PLUS).verdict).not.toBe('cold');
  });

  it('the same addition plus the bag draped lifts camp evening out of "cold"', () => {
    expect(at(25, 1.1).verdict).toBe('cold');
    const drape = bagAsBlanketClo(TWENTY_F_BAG);
    expect(at(25, 1.1, ANDY_PLUS, drape).verdict).not.toBe('cold');
  });

  it('and does not break the hiking phase, which was already fine', () => {
    // You would not hike in the puffy; the point is only that the kit still has a working
    // configuration at 30 °F once it is in the pack.
    expect(at(30, 3.0, ANDY.filter((x) => x.id !== 'grid_fleece')).verdict).not.toBe('cold');
  });

  it('⚠️ camp evening is NOT fixed by the puffy alone, which the reference doc implies it is', () => {
    // Reference: "+1.8 clo → 3.6 stopped, 6.1 in camp with the quilt draped … turns the lunch
    // stop and camp rows green". With the rigorous requirement of 4.46 clo at 25 °F, 3.6 clo
    // (reference arithmetic) or 3.18 clo (ISO 9920 ensemble rule) is still short. The quilt is
    // doing the work in the camp row, not the puffy.
    expect(at(25, 1.1, ANDY_PLUS).verdict).toBe('cold');
  });
});

describe('the sleep-system claim the video is built on', () => {
  it('quantifies how optimistic a US label is for a typical backpacker’s pad', () => {
    const table = [2.0, 3.2, 4.2, 4.83, 5.4, 7.0].map((r) => ({
      r,
      comfortF: celsiusToFahrenheit(
        solveSleepSystem({ bag: TWENTY_F_BAG, pads: [{ imperialR: r }] }).comfortC,
      ),
    }));
    // Monotone, and the reference mattress reproduces the label exactly.
    for (let i = 1; i < table.length; i++) {
      expect(table[i]?.comfortF ?? 0).toBeLessThan(table[i - 1]?.comfortF ?? 0);
    }
    expect(table.find((x) => x.r === 4.83)?.comfortF).toBeCloseTo(31, 0);
    // A bare foam pad (R 2) turns a "20 °F bag" into a system whose comfort limit is above
    // freezing by a wide margin. ⚠️ The magnitude here is driven by `underBodyAreaFraction`,
    // which is estimated: see sleep.ts. The *direction* is not in doubt; the size is.
    expect(table.find((x) => x.r === 2.0)?.comfortF ?? 0).toBeGreaterThan(45);
  });
});
