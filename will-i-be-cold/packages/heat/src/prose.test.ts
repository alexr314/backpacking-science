/**
 * The house style, as a test.
 *
 * **No em dash, anywhere, ever.** It is a standing client rule across all of his projects, it
 * is not negotiable, and a rule that is only written down gets broken. So this walks every
 * string the package can hand a user and fails on a U+2014. It also rejects the two common
 * ways of pretending to obey: a spaced hyphen (` - `) or a spaced en dash (` – `) standing in
 * for the same dash. An en dash *between numbers* is fine and is what ranges are built from.
 *
 * The second half of the file is the other half of the same rule: the prose a user acts on
 * (the headline and the fixes) must not leak model vocabulary. A caveat may name a standard;
 * a headline may not.
 */
import { describe, expect, it } from 'vitest';
import * as api from './index.js';
import { coverage, type GearInventory, type PhasePlan, type TemperatureBand } from './coverage.js';
import { GARMENTS, garment } from './garments.js';
import { UNVERIFIED_CONSTANTS } from './coverage.js';
import { ThermalModelError, type PhaseName } from './types.js';
import { fahrenheitToCelsius as F } from './units.js';

/** U+2014, written as an escape so that even this file does not contain one. */
const EM_DASH = '\u2014';

/** Every string reachable from a value, with a path saying where it came from. */
function strings(value: unknown, path = '$', seen = new Set<unknown>()): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value !== 'object' || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`, seen));
  return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`, seen));
}

const CONDITIONS = { relativeHumidity: 0.8, cloudCover: 0.3, windSpeed: 2, shelter: 'forest' } as const;
const band = (lowF: number, highF: number): TemperatureBand => ({
  p10: F(lowF),
  p50: F((lowF + highF) / 2),
  p90: F(highF),
  min: F(lowF - 5),
  max: F(highF + 5),
});

/** A spread of reports, chosen to light up as many generated strings as the engine has. */
function everyReport(): { what: string; report: ReturnType<typeof coverage> }[] {
  const sleep = { bag: { kind: 'bag', ratingC: F(20), ratingType: 'limit' }, pads: [{ imperialR: 2 }] } as const;
  const thin: GearInventory = {
    garments: ['ls_synthetic', 'hiking_pants', 'socks_mid', 'trail_runners', 'liner_gloves'],
    sleep,
  };
  const loaded: GearInventory = {
    garments: [
      'merino_mid',
      'fleece_300',
      'down_puffy_45oz',
      'rain_shell',
      'long_underwear',
      'rain_pants',
      'socks_heavy',
      'insulated_boots',
      'balaclava',
      'liner_gloves',
      'mitts',
    ],
    sleep: { bag: { kind: 'quilt', ratingC: -18, ratingType: 'comfort' }, pads: [{ imperialR: 7 }] },
  };
  const interior: GearInventory = {
    garments: ['ls_synthetic', 'down_puffy_45oz', 'hiking_pants', 'socks_mid', 'boots'],
  };
  const plans = (phases: readonly PhaseName[], extra: Partial<PhasePlan> = {}): PhasePlan[] =>
    phases.map((phase) => ({ phase, conditions: CONDITIONS, ...extra }) as PhasePlan);
  const dist = (lowF: number, highF: number): Partial<Record<PhaseName, TemperatureBand>> =>
    Object.fromEntries(
      (['camp_morning', 'hiking', 'day_break', 'camp_evening', 'sleep'] as PhaseName[]).map((p) => [
        p,
        band(lowF, highF),
      ]),
    );
  const all: PhaseName[] = ['camp_morning', 'hiking', 'day_break', 'camp_evening', 'sleep'];
  return [
    { what: 'a thin kit in the cold', report: coverage(thin, plans(all), dist(5, 45)) },
    { what: 'a loaded kit in the warm', report: coverage(loaded, plans(all), dist(40, 70)) },
    {
      what: 'an interior hole',
      report: coverage(interior, plans(['hiking']), dist(35, 70)),
    },
    {
      what: 'wet, windy, by a fire, with the quilt draped',
      report: coverage(
        thin,
        plans(['camp_evening'], { bagAsBlanket: true }).map((p) => ({
          ...p,
          conditions: { ...CONDITIONS, wet: true, windSpeed: 8, campfire: { on: true } },
        })),
        dist(10, 40),
      ),
    },
    { what: 'in °C', report: coverage(thin, plans(all), dist(5, 45), { units: 'C' }) },
    { what: 'the paranoid band', report: coverage(thin, plans(all), dist(5, 45), { band: 'min-max' }) },
  ];
}

describe('no em dash, anywhere a user can see', () => {
  const reports = everyReport();

  it('produces strings at all, in every report, so this test cannot pass vacuously', () => {
    for (const { what, report } of reports) {
      const found = strings(report);
      expect(found.length, what).toBeGreaterThan(20);
    }
    // Every generated kind of string is actually represented.
    const everything = reports.flatMap(({ report }) => report);
    expect(everything.flatMap((r) => r.caveats).length).toBeGreaterThan(5);
    expect(everything.flatMap((r) => r.warnings).length).toBeGreaterThan(3);
    expect(everything.flatMap((r) => r.gaps).length).toBeGreaterThan(3);
  });

  it('has none in any verdict, fix, warning or caveat the engine generates', () => {
    for (const { what, report } of reports) {
      for (const [path, s] of strings(report)) {
        expect(s, `${what} at ${path}`).not.toContain(EM_DASH);
      }
    }
  });

  it('has none in the garment catalogue or the unverified-constants ledger', () => {
    for (const g of GARMENTS) {
      expect(g.label).not.toContain(EM_DASH);
      expect(g.note ?? '').not.toContain(EM_DASH);
    }
    for (const c of UNVERIFIED_CONSTANTS) {
      expect(c.note, c.id).not.toContain(EM_DASH);
      expect(c.units, c.id).not.toContain(EM_DASH);
      expect(c.id).not.toContain(EM_DASH);
    }
  });

  it('has none in any string exported from the package root', () => {
    for (const [path, s] of strings(api, '$api')) {
      expect(s, path).not.toContain(EM_DASH);
    }
  });

  it('has none in the error messages either', () => {
    const thrown: string[] = [];
    const capture = (f: () => unknown): void => {
      try {
        f();
      } catch (e) {
        thrown.push(e instanceof Error ? e.message : String(e));
      }
    };
    capture(() => garment('not_a_real_garment'));
    capture(() => coverage({ garments: [] }, [{ phase: 'hiking', conditions: CONDITIONS }], {}));
    capture(() =>
      coverage({ garments: ['tee'] }, [{ phase: 'sleep', conditions: CONDITIONS }], { sleep: band(20, 30) }),
    );
    capture(() =>
      coverage({ garments: ['tee'] }, [{ phase: 'hiking', conditions: CONDITIONS }], {
        hiking: { p10: 5, p50: 5, p90: 5 },
      }),
    );
    expect(thrown.length).toBe(4);
    for (const m of thrown) expect(m).not.toContain(EM_DASH);
    expect(new ThermalModelError('x', 'y').message).not.toContain(EM_DASH);
  });

  it('does not cheat by substituting a lookalike dash in prose', () => {
    for (const { what, report } of reports) {
      const prose = [
        report.verdict,
        ...report.gaps.flatMap((g) => [g.fix.text, g.fix.short ?? '']),
        ...report.caveats,
        ...report.warnings.map((w) => w.message),
      ];
      for (const s of prose) {
        expect(s, `${what}: spaced hyphen standing in for a dash`).not.toMatch(/\S - \S/);
        // An en dash is for ranges between numbers, never a punctuation dash between clauses.
        expect(s, `${what}: spaced en dash standing in for a dash`).not.toMatch(/\s–\s/);
      }
    }
  });
});

describe('the prose a user acts on stays out of the model’s vocabulary', () => {
  const INTERNAL =
    /ontology|ensemble|comfort interval|IREQ|ISO \d|ASHRAE|Annex|duration-limited|operative temperature|mean radiant|metabolic|SPEC §|STANDARDS|clo\/inch|provenance|adjustabilit|Pareto|rung/i;

  it('keeps it out of every headline and every fix', () => {
    for (const { what, report } of everyReport()) {
      expect(report.verdict, what).not.toMatch(INTERNAL);
      for (const gap of report.gaps) {
        expect(gap.fix.text, `${what} ${gap.phase}`).not.toMatch(INTERNAL);
        if (gap.fix.short !== undefined) expect(gap.fix.short, what).not.toMatch(INTERNAL);
      }
    }
  });

  it('allows a caveat to name a standard, which is the whole point of the caveats panel', () => {
    const { report } = everyReport()[0] as { report: ReturnType<typeof coverage> };
    expect(report.caveats.join(' ')).toMatch(/ISO \d/);
  });

  it('keeps the headline to a few short sentences', () => {
    for (const { what, report } of everyReport()) {
      const sentences = report.verdict.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
      expect(sentences.length, what).toBeLessThanOrEqual(3);
      expect(report.verdict.length, what).toBeLessThan(200);
      for (const s of sentences) expect(s.split(/\s+/).length, `${what}: "${s}"`).toBeLessThan(26);
    }
  });
});
