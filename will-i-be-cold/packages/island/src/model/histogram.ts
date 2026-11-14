/**
 * Tonight's temperature as a histogram: bins on round numbers (every 5 °F, or every 2 °C when
 * the panel is in Celsius) with the probability mass in each. On the chart this is background
 * texture only; the primary read is the encounter curve (`encounter.ts`).
 *
 * THE SEAM. The chart consumes `TemperatureHistogram` and nothing else. The weather package is
 * producing a sampled, binned distribution; until it lands, `deriveHistogram` fills the same
 * shape from the sampler's existing `Distribution` (its median and combined standard
 * deviation, read as a normal). Swapping in the real bins means replacing the one call to
 * `deriveHistogram` and nothing in the chart. `source` says which of the two you are looking at.
 */

import type { Distribution } from '@will-i-be-cold/weather';
import { fahrenheitToCelsius } from '@will-i-be-cold/heat';
import type { Unit } from '../lib/units.js';
import { normalCdf } from './encounter.js';

export interface TemperatureBin {
  readonly fromC: number;
  readonly toC: number;
  /** Probability mass in this bin, 0..1. The bins of one histogram sum to about 1. */
  readonly mass: number;
}

export interface TemperatureHistogram {
  readonly bins: readonly TemperatureBin[];
  readonly source: 'derived-from-band' | 'sampled';
}

/** Bin width on round numbers in the display unit, as the client asked: 5 °F, or 2 °C. */
export const BIN_WIDTH: Readonly<Record<Unit, number>> = { F: 5, C: 2 };

export function deriveHistogram(temperature: Distribution, unit: Unit): TemperatureHistogram {
  const width = BIN_WIDTH[unit];
  const toC = (u: number): number => (unit === 'F' ? fahrenheitToCelsius(u) : u);
  const toU = (c: number): number => (unit === 'F' ? (c * 9) / 5 + 32 : c);
  const mean = temperature.p50;
  const sd = Math.max(0.3, temperature.sd);
  const lo = Math.floor(toU(mean - 3.5 * sd) / width) * width;
  const hi = Math.ceil(toU(mean + 3.5 * sd) / width) * width;
  const bins: TemperatureBin[] = [];
  for (let edge = lo; edge < hi - 1e-9; edge += width) {
    const fromC = toC(edge);
    const toCEdge = toC(edge + width);
    const mass = normalCdf((toCEdge - mean) / sd) - normalCdf((fromC - mean) / sd);
    if (mass >= 0.004) bins.push({ fromC, toC: toCEdge, mass });
  }
  return { bins, source: 'derived-from-band' };
}
