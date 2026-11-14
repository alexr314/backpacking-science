/**
 * The panel: a trip tab where the place and the dates are set, one gear tab where the
 * inventory is built, and the five times of day as tabs you page through. The inventory is
 * set once and read everywhere; each phase's conditions and the engine's result for it live
 * here too, so the tab strip can carry every phase's status and the gear tab can dress its
 * figure in what the engine actually built.
 *
 * THE TAB BAR is part of the interface, not chrome: a translucent pill, centred, floated a
 * little way down over whatever the tab shows (the sky's zenith on a scene, the studio's top
 * on the gear tab). Trip and Gear stand apart from the five times of day behind a vertical
 * rule, and the unit toggle sits behind another.
 *
 * POOLED BY DEFAULT, ONE NIGHT ON DEMAND. The trip is several nights, and the phase tabs show
 * each phase pooled over all of them unless a night is picked: `phaseDistributions` from the
 * weather package gives the pooled marginal and the pooled encounter curve, and
 * `pooledPhaseWeather` dresses them for the engine. The choice of night is one piece of state
 * shared by every phase tab, so stepping to night two on the evening tab shows night two on
 * the sleep tab as well. It resets to the whole trip whenever the data changes.
 *
 * The panel does no I/O. The data arrives as a `LoadedTrip` (the recorded fixture by default,
 * a live fetch when asked for) and the trip tab's actions are callbacks; `CampEvening.tsx`
 * owns the loading.
 *
 * The five phases share one `PhaseTab`; the scene inside it is one world the tabs move
 * through, so the stage is kept mounted across phase tabs and the transition plays.
 */

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { phaseDistributions, type LocalDate, type PhaseDistributions, type PhaseWeather } from '@will-i-be-cold/weather';
import { PHASE_NAMES, type PhaseName } from '@will-i-be-cold/heat';
import { UNIT_SYMBOL, type Unit } from '../lib/units.js';
import { DEFAULT_KIT, EMPTY_KIT, kitFromGarments, toggleOwned, type Kit, type Outfit } from '../model/kit.js';
import { assessPhase, DEFAULT_SETTINGS, type PanelResult, type PhaseSettings } from '../model/panel.js';
import { PHASE_TABS, type TabId } from '../model/tabs.js';
import { encounterOf, type EncounterCurves } from '../model/encounter.js';
import { pooledPhaseWeather, WHOLE_TRIP, type LoadedTrip, type NightScope, type TripSpec } from '../model/trip.js';
import { GearTab } from './GearTab.js';
import { PhaseTab } from './PhaseTab.js';
import { TripSetup, type PlaceService, type TripJob } from './TripSetup.js';
import { gapMark } from './ComfortChart.js';
import type { SlotRef } from './Figure.js';

let uidCounter = 0;

export interface WillIBeColdPanelProps {
  /** The weather on screen: the recorded fixture to begin with, a live fetch once asked for. */
  readonly loaded: LoadedTrip;
  /** The trip being set up on the trip tab. Equals `loaded.spec` until the user edits it. */
  readonly spec: TripSpec;
  readonly onSpec: (spec: TripSpec) => void;
  readonly job: TripJob;
  readonly onFetch: () => void;
  readonly onCancel: () => void;
  readonly onUseFixture: () => void;
  /** Today's date where the user sits, for the horizon readout before anything is fetched. */
  readonly today: LocalDate;
  readonly places: PlaceService;
  readonly initialKit?: Kit;
  readonly initialUnit?: Unit;
  readonly initialTab?: TabId;
  /** Where "See our methodology" goes. */
  readonly methodologyHref?: string;
}

interface ShownPhase {
  readonly weather: PhaseWeather;
  readonly curves: EncounterCurves;
}

function usePhaseResult(phase: PhaseName, kit: Kit, unit: Unit, settings: PhaseSettings, weather: PhaseWeather): PanelResult {
  // The engine bakes units into its prose, so the verdict must be rebuilt on toggle.
  return useMemo(() => assessPhase(phase, { kit, settings, unit }, weather), [phase, kit, settings, unit, weather]);
}

export function WillIBeColdPanel({
  loaded,
  spec,
  onSpec,
  job,
  onFetch,
  onCancel,
  onUseFixture,
  today,
  places,
  initialKit = DEFAULT_KIT,
  initialUnit = 'F',
  initialTab = 'gear',
  methodologyHref = '/methodology',
}: WillIBeColdPanelProps): JSX.Element {
  const [uid] = useState(() => `wibc${++uidCounter}`);
  const [kit, setKit] = useState<Kit>(initialKit);
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [selectedSlot, setSelectedSlot] = useState<SlotRef | null>(null);
  const [settings, setSettings] = useState<Readonly<Record<PhaseName, PhaseSettings>>>(DEFAULT_SETTINGS);
  const [scope, setScope] = useState<NightScope>(WHOLE_TRIP);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  const days = loaded.weather.days;
  if (days.length === 0) throw new Error('The loaded trip has no nights.');

  // a new trip is read as a whole first
  useEffect(() => setScope(WHOLE_TRIP), [loaded]);
  const safeScope: NightScope = scope.kind === 'night' && scope.index >= days.length ? WHOLE_TRIP : scope;

  // the pooled and per-night distributions of every phase, once per trip
  const dists = useMemo(
    () => Object.fromEntries(PHASE_NAMES.map((p) => [p, phaseDistributions(loaded.weather, p)])) as Record<PhaseName, PhaseDistributions>,
    [loaded.weather],
  );

  // what each phase tab looks at: the trip pooled, or one of its nights
  const shown = useMemo(() => {
    const pick = (p: PhaseName): ShownPhase => {
      if (safeScope.kind === 'night') {
        const day = days[safeScope.index]!;
        const dist = dists[p].byNight[safeScope.index]!;
        return { weather: day.phases[p], curves: encounterOf(dist) };
      }
      return { weather: pooledPhaseWeather(days, p, dists[p].overall), curves: encounterOf(dists[p].overall) };
    };
    return Object.fromEntries(PHASE_NAMES.map((p) => [p, pick(p)])) as Record<PhaseName, ShownPhase>;
  }, [dists, days, safeScope]);

  // one engine call per phase, each remembered against its own inputs
  const results: Readonly<Record<PhaseName, PanelResult>> = {
    camp_morning: usePhaseResult('camp_morning', kit, unit, settings.camp_morning, shown.camp_morning.weather),
    hiking: usePhaseResult('hiking', kit, unit, settings.hiking, shown.hiking.weather),
    day_break: usePhaseResult('day_break', kit, unit, settings.day_break, shown.day_break.weather),
    camp_evening: usePhaseResult('camp_evening', kit, unit, settings.camp_evening, shown.camp_evening.weather),
    sleep: usePhaseResult('sleep', kit, unit, settings.sleep, shown.sleep.weather),
  };

  // The representative configuration the gear tab's figure wears: the warmest the engine built for the evening.
  const evening = results.camp_evening;
  const warmest = useMemo(
    () => evening.phase.candidates.reduce<(typeof evening.phase.candidates)[number] | null>((a, c) => (a === null || c.clo > a.clo ? c : a), null),
    [evening],
  );
  const outfit: Outfit = useMemo(() => (warmest === null ? EMPTY_KIT : kitFromGarments(warmest.garments)), [warmest]);

  const tabs: readonly { id: TabId; label: string; built: boolean }[] = [
    { id: 'trip', label: 'Trip', built: true },
    { id: 'gear', label: 'Gear', built: true },
    ...PHASE_TABS.map((t) => ({ id: t.phase, label: t.label, built: t.built })),
  ];

  const onTabKey = (e: KeyboardEvent, i: number): void => {
    const delta =
      e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : e.key === 'End' ? tabs.length - 1 - i : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = tabs[(i + delta + tabs.length) % tabs.length]!;
    setTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const renderTab = (): JSX.Element => {
    if (tab === 'trip')
      return (
        <div className="wibc-wrap">
          <TripSetup
            loaded={loaded}
            spec={spec}
            onSpec={onSpec}
            job={job}
            onFetch={onFetch}
            onCancel={onCancel}
            onUseFixture={onUseFixture}
            onGoToPhase={(p) => setTab(p)}
            today={today}
            places={places}
            uid={uid}
          />
        </div>
      );
    if (tab === 'gear')
      return (
        <div className="wibc-wrap">
          <GearTab
            kit={kit}
            outfit={outfit}
            outfitLabel={warmest?.label ?? null}
            selected={selectedSlot}
            onSelect={setSelectedSlot}
            onToggle={(id) => setKit((k) => toggleOwned(k, id))}
            uid={uid}
          />
        </div>
      );
    const phase: PhaseName = tab;
    return (
      <PhaseTab
        phase={phase}
        loaded={loaded}
        days={days}
        scope={safeScope}
        onScope={setScope}
        weather={shown[phase].weather}
        curves={shown[phase].curves}
        kit={kit}
        outfit={outfit}
        unit={unit}
        settings={settings[phase]}
        onSettings={(next) => setSettings((s) => ({ ...s, [phase]: next }))}
        result={results[phase]}
        onGoToGear={() => setTab('gear')}
        onGoToTrip={() => setTab('trip')}
        methodologyHref={methodologyHref}
        overcast={phase === 'sleep' ? settings.camp_evening.wet : settings[phase].wet}
        uid={uid}
      />
    );
  };

  const renderTabButton = (t: (typeof tabs)[number]): JSX.Element => {
    const i = tabs.findIndex((x) => x.id === t.id);
    const phaseGaps = t.id === 'gear' || t.id === 'trip' ? null : results[t.id].phase.gaps;
    const mark = phaseGaps === null ? null : gapMark(phaseGaps);
    return (
      <button
        key={t.id}
        type="button"
        role="tab"
        id={`${uid}-tab-${t.id}`}
        aria-selected={tab === t.id}
        aria-controls={`${uid}-panel`}
        tabIndex={tab === t.id ? 0 : -1}
        data-built={t.built}
        className="wibc-tab"
        ref={(el) => {
          if (el === null) tabRefs.current.delete(t.id);
          else tabRefs.current.set(t.id, el);
        }}
        onClick={() => setTab(t.id)}
        onKeyDown={(e: KeyboardEvent) => onTabKey(e, i)}
      >
        {t.label}
        {t.id === 'trip' && job.kind === 'loading' && (
          <span className="wibc-tab-soon" aria-label="fetching">
            …
          </span>
        )}
        {mark !== null && phaseGaps !== null && (
          <span className="wibc-tab-status" style={{ color: mark.colour }} aria-label={phaseGaps.length === 0 ? 'covered' : 'has a gap'}>
            {mark.glyph}
          </span>
        )}
        {!t.built && <span className="wibc-tab-soon">soon</span>}
      </button>
    );
  };

  return (
    <div className="wibc" data-tab={tab}>
      <div className="wibc-tabbar">
        <div className="wibc-tabs" role="tablist" aria-label="Trip and gear, then the times of day">
          {renderTabButton(tabs[0]!)}
          {renderTabButton(tabs[1]!)}
          <span className="wibc-tabs-rule" aria-hidden="true" />
          {tabs.slice(2).map(renderTabButton)}
        </div>
        <span className="wibc-tabs-rule" aria-hidden="true" />
        <div className="wibc-seg" role="group" aria-label="Temperature unit">
          {(['F', 'C'] as const).map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {UNIT_SYMBOL[u]}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`} className="wibc-tabpanel">
        {renderTab()}
      </div>
    </div>
  );
}

export { PHASE_NAMES };
