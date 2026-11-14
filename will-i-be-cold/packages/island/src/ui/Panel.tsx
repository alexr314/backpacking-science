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
 * ONE ANCHOR PER PHASE. The pooled result is computed for every phase whatever the scope,
 * because its comfort limit is the threshold every scope's risk is read at (`model/risk.ts`);
 * a night's own result is computed as well when a night is shown, for its bars and its own
 * limit. The union bound on the resulting numbers is checked here and reported to the console
 * in development if it ever fails.
 *
 * THE AXIS IS THE TRIP'S. One fixed temperature scale for every phase tab and scope, from the
 * curves of the whole trip, so nothing slides when a tab changes.
 *
 * The sleep system (bag and pads) is state here, set on the sleep tab, because the clothed
 * phases' bag-as-blanket term reads the same bag.
 *
 * The five phases share one `PhaseTab`; the scene inside it is one world the tabs move
 * through, so the stage is kept mounted across phase tabs and the transition plays.
 */

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { phaseDistributions, type LocalDate, type PhaseDistributions, type PhaseWeather } from '@will-i-be-cold/weather';
import { PHASE_NAMES, type PhaseName, type SleepGear, type Span } from '@will-i-be-cold/heat';
import { UNIT_SYMBOL, type Unit } from '../lib/units.js';
import { DEFAULT_KIT, EMPTY_KIT, kitFromGarments, toggleOwned, type Kit, type Outfit } from '../model/kit.js';
import { assessPhase, DEFAULT_SETTINGS, SLEEP_GEAR, type PanelResult, type PhaseSettings } from '../model/panel.js';
import { PHASE_TABS, type TabId } from '../model/tabs.js';
import { encounterOf, type EncounterCurves } from '../model/encounter.js';
import { anchorOf, checkUnionBound, encounterAxis, riskAt, riskLevel, type Anchor, type ScopeRisk, type UnionBoundCheck } from '../model/risk.js';
import { pooledPhaseWeather, WHOLE_TRIP, type LoadedTrip, type NightScope, type TripSpec } from '../model/trip.js';
import { GearTab } from './GearTab.js';
import { PhaseTab } from './PhaseTab.js';
import { TripSetup, type PlaceService, type TripJob } from './TripSetup.js';
import { riskMark } from './ComfortChart.js';
import type { SlotRef } from './Figure.js';

/** The fallback axis if no curve anywhere reaches the floor: a 0 to 60 °F scale, never reached on real data. */
const FALLBACK_AXIS: Span = { fromC: -17.8, toC: 15.6 };

const RISK_WORD = { fine: 'low risk of cold', marginal: 'some risk of cold', cold: 'likely too cold' } as const;

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
  readonly initialSleepGear?: SleepGear;
  readonly initialUnit?: Unit;
  readonly initialTab?: TabId;
  /** Where "See our methodology" goes. */
  readonly methodologyHref?: string;
}

interface ShownPhase {
  readonly weather: PhaseWeather;
  readonly curves: EncounterCurves;
}

interface PhaseView {
  /** The pooled result: always computed, because its limit anchors every scope's risk. */
  readonly pooled: PanelResult;
  /** The result for the scope on screen; the pooled one itself when the whole trip is shown. */
  readonly shown: PanelResult;
  readonly anchor: Anchor;
  readonly risk: ScopeRisk;
  readonly nightRisks: readonly ScopeRisk[];
  readonly check: UnionBoundCheck;
}

function usePhaseView(
  phase: PhaseName,
  kit: Kit,
  sleepGear: SleepGear,
  unit: Unit,
  settings: PhaseSettings,
  pooledWeather: PhaseWeather,
  nightWeather: PhaseWeather | null,
  dists: PhaseDistributions,
  nightIndex: number | null,
): PhaseView {
  // The engine bakes units into its prose, so the verdict must be rebuilt on toggle.
  const pooled = useMemo(
    () => assessPhase(phase, { kit, settings, unit, sleepGear }, pooledWeather),
    [phase, kit, settings, unit, sleepGear, pooledWeather],
  );
  const night = useMemo(
    () => (nightWeather === null ? null : assessPhase(phase, { kit, settings, unit, sleepGear }, nightWeather)),
    [phase, kit, settings, unit, sleepGear, nightWeather],
  );
  return useMemo(() => {
    const anchor = anchorOf(pooled.phase);
    const nightRisks = dists.byNight.map((d) => riskAt(d, anchor));
    const pooledRisk = riskAt(dists.overall, anchor);
    const shownDist = nightIndex === null ? dists.overall : dists.byNight[nightIndex]!;
    return {
      pooled,
      shown: night ?? pooled,
      anchor,
      risk: nightIndex === null ? pooledRisk : riskAt(shownDist, anchor),
      nightRisks,
      check: checkUnionBound(pooledRisk.cold, nightRisks.map((r) => r.cold)),
    };
  }, [pooled, night, dists, nightIndex]);
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
  initialSleepGear = SLEEP_GEAR,
  initialUnit = 'F',
  initialTab = 'gear',
  methodologyHref = '/methodology',
}: WillIBeColdPanelProps): JSX.Element {
  const [uid] = useState(() => `wibc${++uidCounter}`);
  const [kit, setKit] = useState<Kit>(initialKit);
  const [sleepGear, setSleepGear] = useState<SleepGear>(initialSleepGear);
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

  // every phase pooled over the trip: the default view, and the anchor for every other scope
  const pooled = useMemo(
    () =>
      Object.fromEntries(
        PHASE_NAMES.map((p) => [p, { weather: pooledPhaseWeather(days, p, dists[p].overall), curves: encounterOf(dists[p].overall) }]),
      ) as Record<PhaseName, ShownPhase>,
    [dists, days],
  );

  // what each phase tab looks at: the trip pooled, or one of its nights
  const nightIndex = safeScope.kind === 'night' ? safeScope.index : null;
  const shown = useMemo(() => {
    if (nightIndex === null) return pooled;
    const day = days[nightIndex]!;
    const pick = (p: PhaseName): ShownPhase => ({ weather: day.phases[p], curves: encounterOf(dists[p].byNight[nightIndex]!) });
    return Object.fromEntries(PHASE_NAMES.map((p) => [p, pick(p)])) as Record<PhaseName, ShownPhase>;
  }, [dists, days, pooled, nightIndex]);

  // the fixed thermometer axis: one scale for every tab and scope of this trip
  const axis: Span = useMemo(
    () => encounterAxis(PHASE_NAMES.flatMap((p) => [dists[p].overall, ...dists[p].byNight])) ?? FALLBACK_AXIS,
    [dists],
  );

  // the engine, per phase: the pooled result always, this night's as well when one is shown
  const nightOf = (p: PhaseName): PhaseWeather | null => (nightIndex === null ? null : shown[p].weather);
  const views: Readonly<Record<PhaseName, PhaseView>> = {
    camp_morning: usePhaseView('camp_morning', kit, sleepGear, unit, settings.camp_morning, pooled.camp_morning.weather, nightOf('camp_morning'), dists.camp_morning, nightIndex),
    hiking: usePhaseView('hiking', kit, sleepGear, unit, settings.hiking, pooled.hiking.weather, nightOf('hiking'), dists.hiking, nightIndex),
    day_break: usePhaseView('day_break', kit, sleepGear, unit, settings.day_break, pooled.day_break.weather, nightOf('day_break'), dists.day_break, nightIndex),
    camp_evening: usePhaseView('camp_evening', kit, sleepGear, unit, settings.camp_evening, pooled.camp_evening.weather, nightOf('camp_evening'), dists.camp_evening, nightIndex),
    sleep: usePhaseView('sleep', kit, sleepGear, unit, settings.sleep, pooled.sleep.weather, nightOf('sleep'), dists.sleep, nightIndex),
  };
  const results: Readonly<Record<PhaseName, PanelResult>> = {
    camp_morning: views.camp_morning.shown,
    hiking: views.hiking.shown,
    day_break: views.day_break.shown,
    camp_evening: views.camp_evening.shown,
    sleep: views.sleep.shown,
  };

  // The union bound must hold of the numbers on screen; say so loudly in development if it does not.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    for (const p of PHASE_NAMES) {
      const c = views[p].check;
      if (!c.holds) {
        console.warn(
          `[will-i-be-cold] union bound failed for ${p}: pooled ${c.pooled.toFixed(3)} outside [max ${c.lower.toFixed(3)}, sum ${c.upper.toFixed(3)}] of nights ${c.nights
            .map((x) => x.toFixed(3))
            .join(', ')}`,
        );
      }
    }
  });

  // The representative configuration the gear tab's figure wears: the warmest the engine built for the evening.
  const evening = views.camp_evening.pooled;
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
        anchor={views[phase].anchor}
        risk={views[phase].risk}
        nightRisks={views[phase].nightRisks}
        axis={axis}
        sleepGear={sleepGear}
        onSleepGear={setSleepGear}
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
    const level = t.id === 'gear' || t.id === 'trip' ? null : riskLevel(views[t.id].risk.cold);
    const mark = level === null ? null : riskMark(level);
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
        {mark !== null && level !== null && (
          <span className="wibc-tab-status" style={{ color: mark.colour }} aria-label={RISK_WORD[level]}>
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
