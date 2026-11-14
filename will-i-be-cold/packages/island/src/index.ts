/**
 * Public surface of `@will-i-be-cold/island`.
 *
 * `WillIBeColdPanel` is a plain Preact component that takes its data as props; it does no
 * I/O. `WillIBeCold` starts it on the recorded Smokies fixture and owns the one live path: the
 * trip tab's fetch through the keyless Open-Meteo clients in `@will-i-be-cold/weather`. That
 * is what both the dev harness and an Astro island mount. Making it an Astro island is
 * therefore a three-line `.astro` file:
 *
 * ```astro
 * ---
 * import { WillIBeCold } from '@will-i-be-cold/island';
 * import '@will-i-be-cold/island/style.css';
 * ---
 * <WillIBeCold client:visible />
 * ```
 */

export { WillIBeColdPanel, type WillIBeColdPanelProps } from './ui/Panel.js';
export { WillIBeCold, CampEvening, type WillIBeColdProps, type CampEveningProps } from './ui/CampEvening.js';
export { mountWillIBeCold, mountCampEvening } from './mount.js';
export { DEFAULT_KIT, EMPTY_KIT, type Kit, type Outfit, type Region, type Slot } from './model/kit.js';
export { Methodology, MethodologyPage, type MethodologyProps, type MethodologyPageProps } from './ui/Methodology.js';
export { deriveHistogram, type TemperatureHistogram, type TemperatureBin } from './model/histogram.js';
export { encounterFrom, encounterOf, curveAt, type EncounterCurves, type CurvePoint } from './model/encounter.js';
export { PHASE_TABS, phaseTab, type TabId, type PhaseTab } from './model/tabs.js';
export {
  assessPhase,
  assessCampEvening,
  sleepSystemView,
  DEFAULT_SETTINGS,
  PHASE_CONTROLS,
  SLEEP_GEAR,
  RATING_TYPE_OPTIONS,
  QUILT_PROVENANCE_OPTIONS,
  type PanelInputs,
  type PanelResult,
  type PhaseSettings,
  type SleepSystemView,
} from './model/panel.js';
export {
  anchorOf,
  checkUnionBound,
  encounterAxis,
  kitColdLimitC,
  kitWarmLimitC,
  riskAt,
  riskLevel,
  AXIS_FLOOR_PROBABILITY,
  TICK_MAX_COLD_RISK,
  UNION_BOUND_TOLERANCE,
  WARN_MAX_COLD_RISK,
  type Anchor,
  type RiskLevel,
  type ScopeRisk,
  type UnionBoundCheck,
} from './model/risk.js';
export { SleepSystemControls, type SleepSystemControlsProps } from './ui/SleepSystemControls.js';
export { FIXTURE_PROVENANCE, FIXTURE_PLACE, FIXTURE_SPEC, PANEL_DATE, tripWeatherFrom, fixtureLoadedTrip } from './data/trip.js';
export { fixtureTrip } from './data/fixture.js';
export { loadLiveTrip, searchPlaces, withDemElevation, placeFromPin, placeFromResult, type LoadStep, type LoadOptions } from './data/live.js';
export { TripSetup, type TripSetupProps, type TripJob, type PlaceService } from './ui/TripSetup.js';
export { PlaceSearch, type PlaceSearchProps } from './ui/PlaceSearch.js';
export {
  MAX_NIGHTS,
  MAX_PINS,
  WHOLE_TRIP,
  classifyFailure,
  lapseCorrection,
  localToday,
  parsePin,
  planHorizon,
  pooledPhaseWeather,
  specProblem,
  tripDates,
  tripSubset,
  type HorizonPlan,
  type LapseCorrection,
  type LoadedTrip,
  type NightScope,
  type Place,
  type PlaceOrigin,
  type TripFailure,
  type TripFailureKind,
  type TripSource,
  type TripSpec,
} from './model/trip.js';
export type { Unit } from './lib/units.js';
