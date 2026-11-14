import { describe, expect, it } from 'vitest';
import * as api from './index.js';
describe('public surface',()=>{it('exports the documented API without name collisions',()=>{
 for (const name of ['coverage','assess','ireq','recoveryTime','solveSleepSystem','annexCTemperature','annexCResistance','interpolateTable1','ensembleInsulation','resolveEnvironment','skyTemperature','assessExtremities','UNVERIFIED_CONSTANTS','garment','GARMENTS','ThermalModelError','CLO','MET']) {
   expect(api as Record<string, unknown>).toHaveProperty(name);
   expect((api as Record<string, unknown>)[name]).toBeDefined();
 }
});});
