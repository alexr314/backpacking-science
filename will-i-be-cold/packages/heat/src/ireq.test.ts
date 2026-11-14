import { describe, expect, it } from 'vitest';
import {
  AIR_PERMEABILITY,
  F_CL_COEFFICIENT,
  IREQ_VALIDITY,
  Q_LIM_WATT_HOURS,
  STATIC_AIR_INSULATION,
  basicInsulation,
  convectiveCoefficientIso9920,
  criterionValues,
  defaultWalkingSpeed,
  dynamicAirInsulation,
  insulationCorrectionFactor,
  ireq,
  radiativeCoefficient,
  recoveryTime,
  resultantInsulation,
  respiratoryLosses,
} from './ireq.js';
import { ThermalModelError } from './types.js';
import { CLO, saturationVapourPressureKPa, siToClo, vapourPressureKPa } from './units.js';

/**
 * ISO 11079 Table F.1, as transcribed in `docs/STANDARDS.md` §1.10.
 * Conditions: t_r = t_a, RH 85 %, a_p = 8 l·m⁻²·s⁻¹, W = 0,
 * v_w = clamp(0.0052(M − 58), 0.5, 1.2).
 *
 * ⚠️ **Discrepancy found in STANDARDS §1.10 and resolved here.** Its row 4 prints
 * `v_ar = 0*` with a footnote reading "row 4 has t_r = 0 with t_a = −10". Taking `v_ar = 0`
 * literally reproduces none of that row's three outputs (I_cl misses by 0.45 clo, well
 * outside the stated ±0.11 tolerance). Taking the `0` as the *t_r* value that leaked into the
 * velocity column (i.e. `v_ar = 2` like every other row) reproduces all three outputs
 * inside tolerance (IREQ 1.906 vs 1.9; I_cl 2.34 vs 2.4; DLE > 8 h). We therefore read that
 * row as v_ar = 2, t_r = 0, and say so rather than silently widening a tolerance.
 */
const TABLE_F1 = [
  { ta: 0, var: 2, M: 90, iclClo: 2.5, ireqClo: 2.6, requiredClo: 3.1, dle: 2.3 },
  { ta: 0, var: 2, M: 145, iclClo: 2.5, ireqClo: 1.5, requiredClo: 1.8, dle: null },
  { ta: -10, var: 2, M: 90, iclClo: 2.5, ireqClo: 3.5, requiredClo: 4.4, dle: 0.7 },
  { ta: -10, var: 2, M: 145, iclClo: 2.4, ireqClo: 1.9, requiredClo: 2.4, dle: null, tr: 0 },
  { ta: -20, var: 2, M: 115, iclClo: 4.2, ireqClo: 3.4, requiredClo: 4.2, dle: null },
  { ta: -20, var: 7, M: 115, iclClo: 4.2, ireqClo: 3.5, requiredClo: 5.9, dle: 1.1 },
  { ta: -30, var: 2, M: 115, iclClo: 4.2, ireqClo: 4.0, requiredClo: 5.0, dle: 2.2 },
  { ta: -30, var: 5, M: 175, iclClo: 4.2, ireqClo: 2.6, requiredClo: 4.0, dle: null },
] as const;

const runRow = (row: (typeof TABLE_F1)[number]) =>
  ireq({
    airTemperature: row.ta,
    radiantTemperature: 'tr' in row && row.tr !== undefined ? row.tr : row.ta,
    airVelocity: row.var,
    relativeHumidity: 0.85,
    metabolicRate: row.M,
    clothingInsulation: row.iclClo * CLO,
    airPermeability: 8,
  });

describe('ISO 11079 Table F.1: the standard’s own reference values (STANDARDS §1.10)', () => {
  it.each(TABLE_F1.map((r, i) => [i, r] as const))(
    'row %i reproduces IREQ_neutral to the library-asserted ±0.11 clo',
    (_i, row) => {
      expect(Math.abs(siToClo(runRow(row).ireqNeutral) - row.ireqClo)).toBeLessThanOrEqual(0.11);
    },
  );

  it.each(TABLE_F1.map((r, i) => [i, r] as const))(
    'row %i reproduces the required basic I_cl to ±0.11 clo',
    (_i, row) => {
      expect(Math.abs(runRow(row).requiredNeutralClo - row.requiredClo)).toBeLessThanOrEqual(0.11);
    },
  );

  it.each(TABLE_F1.map((r, i) => [i, r] as const))(
    'row %i reproduces DLE_neutral to ±0.21 h (or "> 8 h")',
    (_i, row) => {
      const result = runRow(row);
      if (row.dle === null) {
        expect(result.dleNeutral.hours).toBeNull();
        expect(result.dleNeutral.display).toBe('> 8 h');
      } else {
        // The *reported* DLE is capped at one significant figure on purpose, so the physics is
        // asserted against the unrounded body-heat-storage rate the result also carries.
        expect(result.storageNeutral).toBeLessThan(0);
        const rawHours = Q_LIM_WATT_HOURS / -result.storageNeutral;
        expect(Math.abs(rawHours - row.dle)).toBeLessThanOrEqual(0.21);
      }
    },
  );

  it('reports DLE to one significant figure only, by construction', () => {
    const r = runRow(TABLE_F1[2]);
    expect(r.dleNeutral.significantFigures).toBe(1);
    // 0.7 h, not 0.83 h: the f_cl ambiguity moves DLE by up to 5 h for long exposures.
    expect(r.dleNeutral.display).toMatch(/^(> 8 h|\d(\.\d)? h)$/);
    expect(String(r.dleNeutral.hours ?? '')).not.toMatch(/\d\.\d\d/);
  });

  it('DLE_min is never shorter than DLE_neutral (STANDARDS §1.8)', () => {
    for (const row of TABLE_F1) {
      const r = runRow(row);
      const n = r.dleNeutral.hours ?? Number.POSITIVE_INFINITY;
      const m = r.dleMin.hours ?? Number.POSITIVE_INFINITY;
      expect(m).toBeGreaterThanOrEqual(n - 1e-9);
    }
  });
});

describe('coefficients', () => {
  it('h_r comes from the linearisation and is nowhere near the indoor 4.7 constant', () => {
    // STANDARDS §5.5's table for ISO 11079's geometry (ε 0.95, A_r/A_Du 0.77).
    expect(radiativeCoefficient(20, 20)).toBeCloseTo(4.18, 1);
    expect(radiativeCoefficient(0, 0)).toBeCloseTo(3.38, 1);
    expect(radiativeCoefficient(-20, -20)).toBeCloseTo(2.69, 1);
    // 🔴 a hard-coded 4.7 would overestimate radiant loss by ~75 % at −20 °C.
    expect(4.7 / radiativeCoefficient(-20, -20)).toBeGreaterThan(1.7);
  });

  it('h_r is continuous through t_cl = t_r', () => {
    const a = radiativeCoefficient(-10 + 1e-7, -10);
    const b = radiativeCoefficient(-10, -10);
    expect(Math.abs(a - b) / b).toBeLessThan(1e-6);
  });

  it('the ISO 7933/9920 h_c branches meet exactly at v = 1 m/s (STANDARDS §5.3)', () => {
    expect(3.5 + 5.2 * 1).toBe(8.7);
    expect(8.7 * Math.pow(1, 0.6)).toBe(8.7);
    expect(convectiveCoefficientIso9920(1)).toBeCloseTo(8.7, 10);
    expect(convectiveCoefficientIso9920(0.5)).toBeCloseTo(6.1, 10);
    expect(convectiveCoefficientIso9920(4)).toBeCloseTo(8.7 * Math.pow(4, 0.6), 10);
    // Not Mitchell's 8.3 (ASHRAE, motionless subjects), and not ISO 7730's 12.1·√v.
    expect(convectiveCoefficientIso9920(1)).not.toBeCloseTo(8.3, 2);
    expect(convectiveCoefficientIso9920(1)).not.toBeCloseTo(12.1, 2);
  });

  it('I_a,r at the standard’s own reference wind lands near its static I_a (STANDARDS §1.6)', () => {
    expect(dynamicAirInsulation(0.4, 0)).toBeCloseTo(0.0821, 3);
    expect(STATIC_AIR_INSULATION).toBe(0.085);
  });

  /**
   * ⚠️ **`docs/STANDARDS.md` §1.7 contradicts itself here, and this test records it.**
   *
   * §1.7 states the bracket as
   * `0.54·exp(−0.15 v_ar − 0.22 v_w)·a_p^0.075 − 0.06·ln(a_p) + 0.5`
   * and then gives worked values at v_ar = 2, v_w = 0 of **0.90** (a_p = 1), **0.64**
   * (a_p = 50) and **0.33** (a_p = 500), concluding "a factor ~2.7 spread: air permeability
   * is a first-order parameter in cold wind".
   *
   * Only the first of those three reproduces from the stated equation. The equation gives
   * 0.90 / **0.80** / **0.77**: a 1.2× spread at this wind speed, not 2.7×. We ship the
   * equation (its coefficients are the ones STANDARDS marks `verified` across two independent
   * sources, and it is what reproduces Table F.1), and we do *not* ship the narrative that
   * follows from the worked values. A windproof shell still helps: the spread widens with
   * wind, reaching ~1.4× at 5 m/s, but it is a second-order term here, not first-order.
   */
  it('the wind/permeability bracket follows §1.7’s equation, whose worked values disagree', () => {
    expect(insulationCorrectionFactor(2, 0, AIR_PERMEABILITY.windproofMembrane)).toBeCloseTo(0.9, 2);
    expect(insulationCorrectionFactor(2, 0, AIR_PERMEABILITY.ordinaryWoven)).toBeCloseTo(0.802, 2);
    expect(insulationCorrectionFactor(2, 0, AIR_PERMEABILITY.openFleece)).toBeCloseTo(0.765, 2);
    // Documented departure from §1.7's prose: the real spread is ~1.2×, not ~2.7×.
    const spread =
      insulationCorrectionFactor(2, 0, 1) / insulationCorrectionFactor(2, 0, 500);
    expect(spread).toBeGreaterThan(1.1);
    expect(spread).toBeLessThan(1.3);
    // Monotone: more permeable fabric always loses more insulation.
    expect(insulationCorrectionFactor(5, 0, 1)).toBeGreaterThan(insulationCorrectionFactor(5, 0, 500));
  });

  it('uses the Annex F f_cl coefficient, not the body text’s', () => {
    expect(F_CL_COEFFICIENT).toBe(1.197);
  });

  it('resultant ↔ basic insulation round-trips', () => {
    const ctx = { airVelocity: 3, walkingSpeed: 0.6, airPermeability: 8, fclCoefficient: 1.197 };
    for (const clo of [0.5, 1, 2, 4, 6]) {
      expect(basicInsulation(resultantInsulation(clo * CLO, ctx), ctx)).toBeCloseTo(clo * CLO, 6);
    }
  });

  it('default walking speed follows the ISO rule with the Table F.1 floor and cap', () => {
    expect(defaultWalkingSpeed(90)).toBeCloseTo(0.5, 10);
    expect(defaultWalkingSpeed(175)).toBeCloseTo(0.6084, 4);
    expect(defaultWalkingSpeed(400)).toBe(IREQ_VALIDITY.maxWalkingSpeed);
  });
});

describe('respiratory losses use ISO 11079’s forms, not Fanger’s (STANDARDS §1.5)', () => {
  it('t_ex = 29 + 0.2·t_a', () => {
    expect(respiratoryLosses(100, -20, 0.1).expiredAirTemperature).toBeCloseTo(25, 10);
    expect(respiratoryLosses(100, 0, 0.1).expiredAirTemperature).toBeCloseTo(29, 10);
  });

  it('p_ex = p_s(t_ex): about 3.17 kPa at −20 °C, not Fanger’s fixed 5.87', () => {
    const r = respiratoryLosses(100, -20, 0.1);
    expect(r.expiredAirVapourPressure).toBeCloseTo(3.17, 1);
    expect(r.expiredAirVapourPressure).toBeLessThan(5.87 * 0.6);
  });

  it('Fanger’s C_res would be ~20 % higher and his E_res ~85 % larger at −20 °C', () => {
    const M = 100;
    const pa = vapourPressureKPa(-20, 0.85);
    const iso = respiratoryLosses(M, -20, pa);
    const fangerCres = 0.0014 * M * (34 - -20);
    const fangerEres = 0.0172 * M * (5.867 - pa);
    expect(fangerCres / iso.convective).toBeCloseTo(1.2, 1);
    expect(fangerEres / iso.evaporative).toBeGreaterThan(1.7);
  });

  it('p_s matches the values STANDARDS §1.4 self-checked', () => {
    expect(saturationVapourPressureKPa(20)).toBeCloseTo(2.3369, 3);
    expect(saturationVapourPressureKPa(0)).toBeCloseTo(0.6088, 3);
  });
});

describe('criteria', () => {
  it('both ISO 11079 Annex B criterion pairs are implemented (STANDARDS §1.3)', () => {
    expect(criterionValues('neutral', 58)).toEqual({
      meanSkinTemperature: 35.7 - 0.0285 * 58,
      skinWettedness: 0.058,
    });
    expect(criterionValues('min', 58).meanSkinTemperature).toBeCloseTo(31.287, 3);
    expect(criterionValues('min', 58).skinWettedness).toBe(0.06);
  });

  it('IREQ_min is always below IREQ_neutral', () => {
    for (const ta of [-30, -10, 0, 5]) {
      const r = ireq({
        airTemperature: ta,
        airVelocity: 2,
        relativeHumidity: 0.7,
        metabolicRate: 100,
        clothingInsulation: 2 * CLO,
      });
      expect(r.ireqMin).toBeLessThan(r.ireqNeutral);
    }
  });
});

describe('validity limits are enforced, not silently ignored (STANDARDS §1.9)', () => {
  const base = {
    airTemperature: -5,
    airVelocity: 2,
    relativeHumidity: 0.8,
    clothingInsulation: 3 * CLO,
  };

  it('throws at sleeping metabolic rates rather than returning a number', () => {
    expect(() => ireq({ ...base, metabolicRate: 45 })).toThrow(ThermalModelError);
    expect(() => ireq({ ...base, metabolicRate: 45 })).toThrow(/ISO 23537|sleep/i);
    expect(() => ireq({ ...base, metabolicRate: 0.8 * 58.15 })).toThrow(ThermalModelError);
  });

  it('throws above the metabolic ceiling too', () => {
    expect(() => ireq({ ...base, metabolicRate: 500 })).toThrow(/400/);
  });

  it('warns-and-clamps rather than throwing below the air-velocity floor', () => {
    const r = ireq({ ...base, airVelocity: 0.05, metabolicRate: 100 });
    expect(r.warnings.map((w) => w.code)).toContain('ireq_air_velocity_below_floor');
    const atFloor = ireq({ ...base, airVelocity: 0.4, metabolicRate: 100 });
    expect(r.ireqNeutral).toBeCloseTo(atFloor.ireqNeutral, 10);
  });

  it('warns when used above its 10 °C cold-stress ceiling', () => {
    const r = ireq({ ...base, airTemperature: 20, metabolicRate: 100 });
    expect(r.warnings.map((w) => w.code)).toContain('ireq_air_temperature_above_ceiling');
  });

  it('downgrades throws to warnings when asked explicitly', () => {
    const r = ireq({ ...base, metabolicRate: 45 }, { onOutOfRange: 'warn' });
    expect(r.warnings.map((w) => w.code)).toContain('ireq_metabolic_rate_below_floor');
    expect(Number.isFinite(r.ireqNeutral)).toBe(true);
  });

  it('rejects impossible inputs instead of producing NaN', () => {
    expect(() =>
      ireq({ ...base, metabolicRate: 100, airPermeability: 0 }),
    ).toThrow(/permeability/);
    expect(() =>
      ireq({ ...base, metabolicRate: 100, clothingInsulation: -1 }),
    ).toThrow(/≥ 0/);
  });
});

describe('DLE and recovery time', () => {
  it('Q_lim is 40 Wh/m² (= 144 kJ/m²)', () => {
    expect(Q_LIM_WATT_HOURS).toBe(40);
    expect(Q_LIM_WATT_HOURS * 3600).toBe(144000);
  });

  it('recovery time is finite when the recovery environment actually warms you', () => {
    const rt = recoveryTime({
      airTemperature: 5,
      airVelocity: 0.4,
      relativeHumidity: 0.6,
      metabolicRate: 100,
      clothingInsulation: 5 * CLO,
    });
    expect(rt.significantFigures).toBe(1);
    expect(rt.hours === null || rt.hours > 0).toBe(true);
  });

  it('recovery time is "> 8 h" when the recovery conditions do not produce heat gain', () => {
    const rt = recoveryTime({
      airTemperature: -20,
      airVelocity: 2,
      relativeHumidity: 0.6,
      metabolicRate: 60,
      clothingInsulation: 0.5 * CLO,
    });
    expect(rt.hours).toBeNull();
  });
});
