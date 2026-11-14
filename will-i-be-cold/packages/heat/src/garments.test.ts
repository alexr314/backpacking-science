import { describe, expect, it } from 'vitest';
import {
  ENSEMBLE_RULE,
  GARMENTS,
  adjustTabulatedEnsemble,
  ensembleInsulation,
  garment,
  garmentFromLoft,
  loftDerivedClo,
} from './garments.js';
import { ThermalModelError } from './types.js';
import { CLO } from './units.js';

const ids = (xs: string[]) => xs.map(garment);

describe('the ISO 9920 ensemble rule', () => {
  it('is Eq. (11) verbatim: I_cl = 0.161 + 0.835·ΣI_clu [clo]', () => {
    expect(ENSEMBLE_RULE.intercept).toBe(0.161);
    expect(ENSEMBLE_RULE.slope).toBe(0.835);
    const e = ensembleInsulation(ids(['ls_synthetic', 'grid_fleece', 'hiking_pants']));
    expect(e.sumClo).toBeCloseTo(0.25 + 0.5 + 0.25, 10);
    expect(e.clo).toBeCloseTo(0.161 + 0.835 * 1.0, 10);
    expect(e.rsi).toBeCloseTo(e.clo * CLO, 12);
  });

  it('offers Eq. (12) (plain summation) as the standard’s lower-accuracy alternative', () => {
    const e = ensembleInsulation(ids(['ls_synthetic', 'grid_fleece']), { simpleSummation: true });
    expect(e.clo).toBeCloseTo(0.75, 10);
  });

  it('implements Eq. (13), the adjust-a-tabulated-ensemble form the standard prefers', () => {
    expect(adjustTabulatedEnsemble(1.0, -0.5)).toBeCloseTo(1.0 - 0.835 * 0.5, 10);
  });
});

describe('the ensemble rule’s validity range is checked, not ignored', () => {
  it('warns below 0.2 clo', () => {
    const e = ensembleInsulation(ids(['briefs']));
    expect(e.warnings.map((w) => w.code)).toContain('ensemble_below_tested_range');
  });

  it('warns above the standard’s tested 1.6 clo', () => {
    const e = ensembleInsulation(
      ids(['merino_mid', 'fleece_300', 'down_puffy_2oz', 'long_underwear', 'hiking_pants']),
    );
    expect(e.sumClo).toBeGreaterThan(ENSEMBLE_RULE.testedMaxClo);
    expect(e.warnings.map((w) => w.code)).toContain('ensemble_above_tested_range');
    expect(e.warnings.map((w) => w.message).join(' ')).toMatch(/Kuklane/);
  });

  it('warns harder above Kuklane et al.’s 3.33 clo extension', () => {
    const e = ensembleInsulation(
      ids([
        'merino_mid',
        'fleece_300',
        'down_puffy_45oz',
        'synth_puffy_100',
        'rain_shell',
        'long_underwear',
        'fleece_lined_pants',
        'snow_pants',
      ]),
    );
    expect(e.sumClo).toBeGreaterThan(ENSEMBLE_RULE.extendedMaxClo);
    expect(e.warnings.map((w) => w.code)).toContain('ensemble_far_above_tested_range');
  });

  it('warns about ISO 9920’s own "uneven distribution" caveat', () => {
    const e = ensembleInsulation(ids(['merino_mid', 'down_puffy_45oz']));
    expect(e.warnings.map((w) => w.code)).toContain('ensemble_uneven_distribution');
  });

  it('is in range, and silent, for an ordinary three-season kit', () => {
    const e = ensembleInsulation(ids(['ls_synthetic', 'hiking_pants', 'socks_mid', 'trail_runners']));
    expect(e.warnings).toHaveLength(0);
  });
});

describe('provenance', () => {
  it('every catalogue entry declares where its number came from', () => {
    for (const x of GARMENTS) {
      expect(x.provenance).toBeTruthy();
      expect(['ashrae', 'estimated', 'iso9920', 'loft-derived']).toContain(x.provenance);
    }
  });

  it('only the garments that really are in the published ASHRAE/ISO 7730 list claim `ashrae`', () => {
    const ashrae = GARMENTS.filter((x) => x.provenance === 'ashrae').map((x) => x.id);
    expect(ashrae.sort()).toEqual(['briefs', 'hiking_pants', 'ls_synthetic', 'shorts', 'tee']);
  });

  it('every technical outdoor garment is honestly marked `estimated`', () => {
    for (const id of ['down_puffy_3oz', 'alpha_90', 'grid_fleece', 'rain_shell']) {
      expect(garment(id).provenance).toBe('estimated');
    }
  });

  it('the loft helper is marked `loft-derived`, and its rule is SPEC §2.3’s', () => {
    expect(loftDerivedClo(1, 0.45)).toBeCloseTo(1.8, 10);
    const custom = garmentFromLoft('x', 'Custom parka', 'torso', 'outer', 1.5, 0.5);
    expect(custom.provenance).toBe('loft-derived');
    expect(custom.clo).toBeCloseTo(3.0, 10);
  });
});

describe('wet derate (SPEC §2.7)', () => {
  it('knocks down down and fleece hardest and leaves shells alone', () => {
    const dry = ensembleInsulation(ids(['down_puffy_3oz']));
    const wet = ensembleInsulation(ids(['down_puffy_3oz']), { wet: true });
    expect(wet.sumClo / dry.sumClo).toBeCloseTo(0.3, 2);

    const dryShell = ensembleInsulation(ids(['rain_shell']));
    const wetShell = ensembleInsulation(ids(['rain_shell']), { wet: true });
    expect(wetShell.sumClo).toBeCloseTo(dryShell.sumClo, 10);
  });
});

describe('lookup', () => {
  it('throws on an unknown id rather than silently returning 0 clo', () => {
    expect(() => garment('not_a_real_garment')).toThrow(ThermalModelError);
  });

  it('flags windproof shells so the ISO 11079 permeability term can use them', () => {
    expect(garment('rain_shell').windproof).toBe(true);
    expect(garment('grid_fleece').windproof).toBeUndefined();
    expect(ensembleInsulation(ids(['grid_fleece', 'rain_shell'])).hasWindproofShell).toBe(true);
    expect(ensembleInsulation(ids(['grid_fleece'])).hasWindproofShell).toBe(false);
  });
});
