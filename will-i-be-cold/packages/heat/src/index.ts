/**
 * `@will-i-be-cold/heat`: cold-weather thermal physics for backpackers.
 *
 * Two models, one result type:
 *  - clothed phases → **ISO 11079** IREQ (`ireq.ts`)
 *  - sleep          → **ISO 23537 Annex C** (`sleep.ts`)
 *
 * The split is forced, not stylistic: ISO 11079's validity floors are M ≥ 58 W/m² and
 * v_ar ≥ 0.4 m/s, and a sleeping person is ~45 W/m² at ~0.05 m/s. See the README.
 */

export * from './units.js';
export * from './types.js';
export * from './ireq.js';
export * from './sleep.js';
export * from './garments.js';
export * from './environment.js';
export * from './extremities.js';
export * from './assess.js';
export * from './coverage.js';
