/**
 * Units, universal constants and conversions.
 *
 * **Everything inside this package is SI.** Degrees Celsius for temperature, m²K/W for
 * thermal resistance, W/m² for heat flux and metabolic rate, m/s for wind, kPa for vapour
 * pressure (that is ISO 11079's own unit: see `docs/STANDARDS.md` §1.4), Pa for the
 * ISO 23537 Annex C branch (which is written in Pa; §3.2). clo and imperial R-value exist
 * only as conversions at the API boundary.
 *
 * Every constant here carries its source clause. Nothing in this file is estimated.
 */

/** Degrees Celsius. */
export type Celsius = number;
/** Kelvin (absolute). */
export type Kelvin = number;
/** Thermal resistance / insulation, m²K/W. */
export type SquareMetreKelvinPerWatt = number;
/** Heat flux or metabolic rate per unit body surface, W/m². */
export type WattsPerSquareMetre = number;
/** Metres per second. */
export type MetresPerSecond = number;
/** Water-vapour pressure, kPa. */
export type Kilopascals = number;
/** A dimensionless 0..1 fraction. */
export type Fraction = number;

/**
 * 1 clo = 0.155 m²K/W.
 *
 * ISO 11079 §5.4 / ISO 9920; additionally confirmed inside ISO 7730:2005 itself
 * ("1 clothing unit = 1 clo = 0,155 m²·°C/W"). `docs/STANDARDS.md` universal-constants table.
 */
export const CLO = 0.155;

/**
 * 1 met = 58.15 W/m².
 *
 * ISO 8996 / `pythermalcomfort` `met_to_w_m2`. `docs/STANDARDS.md` universal-constants table.
 * Note `SPEC.md` §2.6 rounds this to 58.2 and `REFERENCE_warmth_check.md` to 58; we use the
 * standard's 58.15 everywhere and absorb the ~0.3 % difference.
 */
export const MET = 58.15;

/** Stefan–Boltzmann constant, W m⁻² K⁻⁴. */
export const STEFAN_BOLTZMANN = 5.67e-8;

/**
 * 1 imperial R-value (ft²·°F·h/BTU_IT) = 0.1761102 m²K/W.
 *
 * NIST SP 811 Appendix B.9, cross-checked by direct computation in `docs/STANDARDS.md` §4.5.
 * ⚠️ Converters quoting 5.67446 use the *thermochemical* BTU and are wrong for ASTM F3340.
 */
export const RSI_PER_IMPERIAL_R = 0.1761102;

/** 1 imperial R-value = 1.13619 clo (STANDARDS §4.5, boxed). */
export const CLO_PER_IMPERIAL_R = RSI_PER_IMPERIAL_R / CLO;

/** Zero Celsius in Kelvin, as ISO 11079's own equations round it (they use +273, not 273.15). */
export const ISO_KELVIN_OFFSET = 273;

export const cloToSI = (clo: number): SquareMetreKelvinPerWatt => clo * CLO;
export const siToClo = (si: SquareMetreKelvinPerWatt): number => si / CLO;
export const metToWattsPerSquareMetre = (met: number): WattsPerSquareMetre => met * MET;
export const wattsPerSquareMetreToMet = (w: WattsPerSquareMetre): number => w / MET;

/** Imperial R (the number on a sleeping-pad hangtag) → m²K/W ("RSI", ASTM F3340-22 §3.2.10). */
export const imperialRToSI = (r: number): SquareMetreKelvinPerWatt => r * RSI_PER_IMPERIAL_R;
/** m²K/W → imperial R (ASTM F3340-22 §3.2.9: the consumer-facing unit only). */
export const siToImperialR = (si: SquareMetreKelvinPerWatt): number => si / RSI_PER_IMPERIAL_R;

export const fahrenheitToCelsius = (f: number): Celsius => ((f - 32) * 5) / 9;
export const celsiusToFahrenheit = (c: Celsius): number => (c * 9) / 5 + 32;

/** A difference in °F expressed as a difference in K (no 32 offset). */
export const deltaFahrenheitToKelvin = (dF: number): number => (dF * 5) / 9;

/**
 * Saturation water-vapour pressure, kPa, for air temperature `t` in °C.
 *
 * The Antoine-type form ISO 11079's Annex F program uses, originating in ISO 7933
 * (`docs/STANDARDS.md` §1.4):
 *
 *     p_s(t) = 0.1333 · exp(18.6686 − 4030.183 / (t + 235))
 *
 * Accurate to ~0.4 % against reference tables (p_s(20) = 2.3369 vs 2.339 kPa).
 * We deliberately do *not* substitute a more accurate formulation: reproducing the
 * standard's own Table F.1 requires the standard's own p_s.
 */
export function saturationVapourPressureKPa(t: Celsius): Kilopascals {
  return 0.1333 * Math.exp(18.6686 - 4030.183 / (t + 235));
}

/** Same, in Pa: the unit ISO 23537 Annex C is written in (`docs/STANDARDS.md` §3.2). */
export function saturationVapourPressurePa(t: Celsius): number {
  return 1000 * saturationVapourPressureKPa(t);
}

/** Ambient vapour pressure from air temperature and relative humidity (0..1), kPa. */
export function vapourPressureKPa(t: Celsius, relativeHumidity: Fraction): Kilopascals {
  return relativeHumidity * saturationVapourPressureKPa(t);
}

/** Clamp helper used by the validity guards. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Round to `n` significant figures.
 *
 * Used for DLE, which `docs/STANDARDS.md` §7.1 item 1 says must not be presented to more than
 * one significant figure because the unresolved f_cl ambiguity moves it by up to 5 h.
 */
export function toSignificantFigures(x: number, n: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const magnitude = Math.ceil(Math.log10(Math.abs(x)));
  const factor = Math.pow(10, n - magnitude);
  return Math.round(x * factor) / factor;
}
