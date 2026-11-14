/**
 * Property tests. These are the ones that catch sign errors, silent NaNs and non-physical
 * behaviour across the whole domain the UI can produce, rather than at a handful of points.
 */
import { describe, expect, it } from 'vitest';
import { coldLimitForInsulation, ireq } from './ireq.js';
import { annexCTemperature, solveSleepSystem, type BagSpec } from './sleep.js';
import { resolveEnvironment, skyTemperature, type ShelterKind } from './environment.js';
import { assess, clothedColdLimit, metToWm2, type PhaseConditions } from './assess.js';
import { garment } from './garments.js';
import { ThermalModelError } from './types.js';
import { CLO, MET } from './units.js';

/** The full domain the UI can produce, per the brief. */
const TEMPERATURES = [-40, -30, -20, -10, -5, 0, 5, 10, 20, 30];
const WINDS = [0, 0.4, 1, 2, 5, 8, 12, 16, 20];
const METS = [0.8, 1.0, 1.1, 1.3, 2, 3, 4, 5];
const HUMIDITIES = [0.2, 0.5, 0.85, 1];

describe('the solver converges across the whole domain, or throws: never NaN', () => {
  it('sweeps temperature × wind × metabolic rate × humidity', () => {
    let evaluated = 0;
    const refusals: Record<string, number> = {};
    for (const ta of TEMPERATURES) {
      for (const v of WINDS) {
        for (const met of METS) {
          for (const rh of HUMIDITIES) {
            const input = {
              airTemperature: ta,
              airVelocity: v,
              relativeHumidity: rh,
              metabolicRate: met * MET,
              clothingInsulation: 2 * CLO,
            };
            try {
              const r = ireq(input);
              evaluated++;
              for (const x of [
                r.ireqNeutral,
                r.ireqMin,
                r.requiredNeutralClo,
                r.requiredMinClo,
                r.marginClo,
                r.storageNeutral,
                r.storageMin,
                r.clothingSurfaceTemperature,
                r.radiativeCoefficient,
                r.convectiveCoefficient,
              ]) {
                expect(Number.isFinite(x)).toBe(true);
              }
              expect(r.ireqNeutral).toBeGreaterThanOrEqual(0);
            } catch (error) {
              // The only acceptable failure mode is an explicit, explained refusal.
              expect(error).toBeInstanceOf(ThermalModelError);
              const e = error as ThermalModelError;
              expect(e.message.length).toBeGreaterThan(20);
              refusals[e.code] = (refusals[e.code] ?? 0) + 1;
            }
          }
        }
      }
    }
    expect(evaluated).toBeGreaterThan(0);
    // Exactly two things in this domain are refused, and both are validity limits:
    //  - 0.8 met is below ISO 11079's M ≥ 58 W/m² floor (that is the sleep case),
    //  - 20 m/s is above its validated v_ar ≤ 18 m/s ceiling.
    // Everything else converges. Nothing anywhere returns NaN.
    const perMet = TEMPERATURES.length * WINDS.length * HUMIDITIES.length;
    const perWind = TEMPERATURES.length * HUMIDITIES.length;
    expect(refusals).toEqual({
      ireq_metabolic_rate_below_floor: perMet,
      // 7 of the 8 metabolic rates reach the velocity check; the 8th already threw.
      ireq_air_velocity_above_ceiling: perWind * (METS.length - 1),
    });
    expect(evaluated).toBe(
      TEMPERATURES.length * WINDS.length * METS.length * HUMIDITIES.length -
        perMet -
        perWind * (METS.length - 1),
    );
  });

  it('never returns NaN even for pathological but in-range inputs', () => {
    const r = ireq({
      airTemperature: -40,
      radiantTemperature: -60,
      airVelocity: 18,
      relativeHumidity: 1,
      metabolicRate: 58,
      clothingInsulation: 0,
    });
    expect(Number.isFinite(r.ireqNeutral)).toBe(true);
    expect(Number.isFinite(r.storageNeutral)).toBe(true);
  });
});

describe('monotonicity: more insulation never makes you need it warmer', () => {
  const base = {
    airVelocity: 2,
    relativeHumidity: 0.7,
    metabolicRate: 100,
  };

  it('the cold limit falls (or holds) as insulation rises', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const clo of [0.5, 1, 1.5, 2, 3, 4, 5, 6]) {
      const limit = coldLimitForInsulation({ ...base, clothingInsulation: clo * CLO }, 0);
      expect(limit).toBeLessThan(previous);
      previous = limit;
    }
  });

  it('the margin rises monotonically with insulation at fixed conditions', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const clo of [0, 0.5, 1, 2, 3, 4, 6, 8]) {
      const m = ireq({ ...base, airTemperature: -10, clothingInsulation: clo * CLO }).marginClo;
      expect(m).toBeGreaterThan(previous);
      previous = m;
    }
  });

  it('required insulation rises monotonically as air temperature falls', () => {
    let previous = 0;
    for (const ta of [10, 5, 0, -5, -10, -20, -30, -40]) {
      const r = ireq({ ...base, airTemperature: ta, clothingInsulation: 2 * CLO });
      expect(r.ireqNeutral).toBeGreaterThan(previous);
      previous = r.ireqNeutral;
    }
  });

  it('required insulation rises monotonically with wind', () => {
    let previous = 0;
    for (const v of [0.4, 1, 2, 4, 8, 12, 18]) {
      const r = ireq({
        ...base,
        airTemperature: -10,
        airVelocity: v,
        clothingInsulation: 2 * CLO,
      });
      // IREQ is a *resultant* insulation; the basic clothing it demands is what grows with wind.
      expect(r.requiredNeutralClo).toBeGreaterThan(previous);
      previous = r.requiredNeutralClo;
    }
  });

  it('required insulation falls monotonically as metabolic rate rises', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const met of [1.0, 1.3, 1.6, 2, 2.5, 3, 4, 5]) {
      const r = ireq({
        ...base,
        airTemperature: -10,
        metabolicRate: met * MET,
        clothingInsulation: 2 * CLO,
      });
      expect(r.ireqNeutral).toBeLessThan(previous);
      previous = r.ireqNeutral;
    }
  });

  it('a windproof shell never costs you insulation', () => {
    for (const v of [1, 3, 6, 12]) {
      const bare = ireq({
        ...base,
        airTemperature: -10,
        airVelocity: v,
        clothingInsulation: 2 * CLO,
        windproofShell: false,
      });
      const shelled = ireq({
        ...base,
        airTemperature: -10,
        airVelocity: v,
        clothingInsulation: 2 * CLO,
        windproofShell: true,
      });
      expect(shelled.marginClo).toBeGreaterThanOrEqual(bare.marginClo);
    }
  });
});

describe('monotonicity in sky exposure', () => {
  const env = (skyViewFactor: number) =>
    resolveEnvironment({
      airTemperature: -5,
      relativeHumidity: 0.7,
      cloudCover: 0,
      windSpeed: 1,
      skyViewFactorOverride: skyViewFactor,
    });

  it('more sky means a colder mean radiant temperature, always', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const svf of [0, 0.25, 0.5, 0.75, 1]) {
      const t = env(svf).meanRadiantTemperatureC;
      expect(t).toBeLessThan(previous);
      previous = t;
    }
  });

  it('more sky means a colder comfort limit for the same ensemble', () => {
    const garments = ['merino_mid', 'fleece_300', 'long_underwear', 'hiking_pants'].map(garment);
    // ⚠️ `tent` is deliberately not in this ladder. It has the *least* sky of all, but it
    // also carries a measured −1 K air-temperature offset (STANDARDS §6.10), and at low
    // metabolic rates that can outweigh its radiant benefit. That is a real property of the
    // model, not a monotonicity violation: see the dedicated test below.
    let previous = Number.NEGATIVE_INFINITY;
    for (const shelter of ['forest', 'tarp', 'partial_canopy', 'open'] as ShelterKind[]) {
      const conditions: PhaseConditions = {
        airTemperature: -5,
        relativeHumidity: 0.7,
        cloudCover: 0,
        windSpeed: 0,
        shelter,
      };
      const limit = clothedColdLimit(
        { kind: 'clothed', garments, metabolicRate: metToWm2(1.3) },
        conditions,
      );
      expect(limit).toBeGreaterThan(previous);
      previous = limit;
    }
  });

  it('a tent trades a radiant gain against a measured air-temperature loss', () => {
    const garments = ['merino_mid', 'fleece_300', 'long_underwear', 'hiking_pants'].map(garment);
    const limitIn = (shelter: ShelterKind): number =>
      clothedColdLimit(
        { kind: 'clothed', garments, metabolicRate: metToWm2(1.3) },
        { airTemperature: -5, relativeHumidity: 0.7, cloudCover: 0, windSpeed: 0, shelter },
      );
    // Against the open sky the tent wins; against a forest canopy (which costs no air
    // temperature) it does not. Both follow from STANDARDS §6.10 and neither is intuitive.
    expect(limitIn('tent')).toBeLessThan(limitIn('open'));
    expect(limitIn('tent')).toBeGreaterThan(limitIn('forest'));
  });

  it('more cloud never makes the sky colder', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const n of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const t = skyTemperature({ airTemperature: 0, relativeHumidity: 0.7, cloudCover: n })
        .skyTemperatureC;
      expect(t).toBeGreaterThan(previous);
      previous = t;
    }
  });
});

describe('ISO 23537 side', () => {
  it('rating temperature falls monotonically as R_c rises, across and beyond Table 1', () => {
    for (const kind of ['comfort', 'limit', 'extreme'] as const) {
      let previous = Number.POSITIVE_INFINITY;
      for (let rc = 0.2; rc <= 2.5; rc += 0.05) {
        const t = annexCTemperature(rc, kind);
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeLessThan(previous);
        previous = t;
      }
    }
  });

  it('T_ext < T_lim < T_comf at every R_c', () => {
    for (let rc = 0.3; rc <= 2; rc += 0.1) {
      expect(annexCTemperature(rc, 'extreme')).toBeLessThan(annexCTemperature(rc, 'limit'));
      expect(annexCTemperature(rc, 'limit')).toBeLessThan(annexCTemperature(rc, 'comfort'));
    }
  });

  it('more insulation anywhere in the sleep system never raises the comfort temperature', () => {
    const bag: BagSpec = { kind: 'bag', ratingC: -7, ratingType: 'limit' };
    const baseline = solveSleepSystem({ bag, pads: [{ imperialR: 4 }] }).comfortC;
    expect(solveSleepSystem({ bag, pads: [{ imperialR: 5 }] }).comfortC).toBeLessThan(baseline);
    expect(
      solveSleepSystem({ bag, pads: [{ imperialR: 4 }], clothingInsideClo: 1.5 }).comfortC,
    ).toBeLessThan(baseline);
    expect(
      solveSleepSystem({ bag, pads: [{ imperialR: 4 }, { imperialR: 1 }] }).comfortC,
    ).toBeLessThan(baseline);
  });

  it('the sleep solver covers every label a UI could offer, or refuses explicitly', () => {
    for (const ratingType of ['comfort', 'limit'] as const) {
      for (let f = -20; f <= 60; f += 5) {
        const bag: BagSpec = { kind: 'bag', ratingC: ((f - 32) * 5) / 9, ratingType };
        try {
          const s = solveSleepSystem({ bag, pads: [{ imperialR: 4 }] });
          for (const x of [s.systemRc, s.comfortC, s.limitC, s.extremeC, s.padPenaltyK]) {
            expect(Number.isFinite(x)).toBe(true);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(ThermalModelError);
        }
      }
    }
  });
});

describe('end-to-end assessment holds the same invariants', () => {
  const garments = ['merino_mid', 'fleece_300', 'long_underwear', 'hiking_pants', 'socks_mid', 'boots'].map(
    garment,
  );

  it('assess() produces a finite verdict everywhere the UI can go, or throws', () => {
    for (const ta of [-40, -20, -5, 0, 10, 20, 30]) {
      for (const windSpeed of [0, 2, 10, 20]) {
        for (const met of [1.1, 1.3, 3, 5]) {
          const conditions: PhaseConditions = {
            airTemperature: ta,
            relativeHumidity: 0.7,
            cloudCover: 0.3,
            windSpeed,
            shelter: 'open',
          };
          try {
            const a = assess(
              { kind: 'clothed', garments, metabolicRate: metToWm2(met) },
              conditions,
            );
            expect(Number.isFinite(a.marginK)).toBe(true);
            expect(Number.isFinite(a.comfort.coldLimitC)).toBe(true);
            expect(['too_warm', 'fine', 'marginal', 'cold', 'dangerous']).toContain(a.verdict);
          } catch (error) {
            expect(error).toBeInstanceOf(ThermalModelError);
          }
        }
      }
    }
  });

  it('refuses a clothed assessment at sleeping metabolic rates and points at the sleep model', () => {
    expect(() =>
      assess(
        { kind: 'clothed', garments, metabolicRate: metToWm2(0.8) },
        { airTemperature: -5, relativeHumidity: 0.7, cloudCover: 0.3, windSpeed: 1 },
      ),
    ).toThrow(/SleepConfiguration/);
  });
});
