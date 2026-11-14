/**
 * One time of day, end to end: the tab every phase shares.
 *
 * A tableau (the landscape, with the thermometer standing in it, the headline figure, the
 * conditions, the character in the scene with the extremity verdicts on their body, and the
 * settings row), then the verdict in one sentence, the gaps, the table twin, a quiet link to
 * the methodology, and the attribution. The camp-evening tab was the first of these and is
 * now simply this component at `phase = 'camp_evening'`.
 *
 * Every number on screen arrives from `coverage()`, from `solveSleepSystem()` or from the
 * weather sampler. The tab computes no physics of its own.
 *
 * ONE THRESHOLD PER PHASE. The headline is a probability (the chance you are comfortable, and
 * its complement, the chance of colder than the kit handles), and it is read at the trip-wide
 * comfort limit whichever scope is on screen, so the whole trip and each of its nights are
 * comparable and obey the union bound (`model/risk.ts`). This scope's own limit, which moves
 * with its wind and sky, is stated beneath as the secondary fact it is.
 *
 * THE SLEEP SYSTEM IS SET HERE. The bag and the pads are the sleep tab's own controls
 * (`SleepSystemControls.tsx`), a row above the conditions, so the two-floor diagram and the
 * pad delta move as you change them.
 *
 * WHAT DIFFERS PER PHASE is a value, not a branch: the scene's target (`model/tabs.ts`), the
 * words for the period, the controls on offer (`PHASE_CONTROLS`), and which series stand on
 * the thermometer. The four clothed phases put the engine's candidate ladder there. Sleep is
 * not a ladder of outfits; its two bars are the same bag on two mats (the reference mattress
 * inside its rating, and the pad you carry) with the pad delta dimensioned between their cold
 * ends, and the two heat-loss floors drawn out below the verdict (`SleepFloors.tsx`).
 *
 * THE TABLEAU. The sky and landscape span the whole width and the whole height of the stage.
 * Laid over them, held to the reading width, a grid: the chart (the encounter curve, the
 * thermometer, the bars) at the left, standing on a translucent black panel that fades out on
 * every side so it is legible over the ridges; the headline coverage figure top middle, just
 * right of the thermometer; the conditions line top right; the character in the cell below
 * those, measured for the scene so the figure lands in it; and the settings row along the
 * bottom, on the dark ground. No title: the tab and the scene already say what time it is.
 *
 * HOVER DRESSES THE FIGURE. Each clothed bar is one candidate ensemble, and the engine hands
 * over its `garments`; while a bar is under the pointer (or holds focus, or is clicked), the
 * figure in the picture wears exactly that, with a chip naming it. Leave, and they are back
 * in the warmest outfit the engine could build from the inventory.
 */

import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { OPEN_METEO_LICENCE_URL, type DayWeather, type PhaseWeather } from '@will-i-be-cold/weather';
import { verdictFrom, type PhaseName, type ShelterKind, type SleepGear, type Span } from '@will-i-be-cold/heat';
import { useBoxWithin, useMeasure } from '../lib/useMeasure.js';
import { headline, plain } from '../lib/prose.js';
import { clockOf, formatDateSpan, formatDelta, formatLongDate, formatShortDate, formatTempPlain, UNIT_SYMBOL, type Unit } from '../lib/units.js';
import { kitFromGarments, slotGarments, type Kit, type Outfit } from '../model/kit.js';
import type { EncounterCurves } from '../model/encounter.js';
import { ACTIVITY_LABEL, PHASE_CONTROLS, sleepSystemView, type Activity, type PanelResult, type PhaseSettings } from '../model/panel.js';
import { kitColdLimitC, riskLevel, type Anchor, type ScopeRisk } from '../model/risk.js';
import { phaseTab, voiceFor } from '../model/tabs.js';
import type { LoadedTrip, NightScope } from '../model/trip.js';
import { Scene, type SceneAnnotation, type SceneTarget } from './Scene.js';
import { candidateSeries, ComfortChart, GAP_GLYPH, riskMark, VERDICT_COLOR, VERDICT_ICON, VERDICT_WORD, type ChartSeries } from './ComfortChart.js';
import { SleepFloors } from './SleepFloors.js';
import { SleepSystemControls } from './SleepSystemControls.js';

/** The stage's height on a desktop: enough for the thermometer to stand inside the landscape. */
const STAGE_H = 800;
/** Top of the chart below the floating tab bar, and the least the settings rows take of the bottom. */
const CHART_TOP = 76;
const CHART_BOTTOM = 84;
/** Air between the chart's foot and the settings rows. */
const CHART_SETTLE = 10;

export interface PhaseTabProps {
  readonly phase: PhaseName;
  readonly loaded: LoadedTrip;
  /** The trip's nights, in order. */
  readonly days: readonly DayWeather[];
  /** The whole trip pooled, or one night of it. */
  readonly scope: NightScope;
  readonly onScope: (scope: NightScope) => void;
  /** This phase's weather under `scope`: pooled over the trip, or one night's. */
  readonly weather: PhaseWeather;
  readonly curves: EncounterCurves;
  /** Everything owned, for the sleep tab's "worn inside" chips. */
  readonly kit: Kit;
  /** What the figure wears when no bar is hovered: the warmest outfit the engine built. */
  readonly outfit: Outfit;
  readonly unit: Unit;
  readonly settings: PhaseSettings;
  readonly onSettings: (next: PhaseSettings) => void;
  readonly result: PanelResult;
  /** The trip-wide comfort limits the risk is quoted at, from the pooled scope's result. */
  readonly anchor: Anchor;
  /** This scope's curves read at the anchor. */
  readonly risk: ScopeRisk;
  /** Every night's curves read at the same anchor, in trip order, for the pooled view's night-by-night line. */
  readonly nightRisks: readonly ScopeRisk[];
  /** The fixed thermometer axis, the same on every tab. */
  readonly axis: Span;
  readonly sleepGear: SleepGear;
  readonly onSleepGear: (gear: SleepGear) => void;
  readonly onGoToGear: () => void;
  readonly onGoToTrip: () => void;
  readonly methodologyHref: string;
  /**
   * Whether the scene's sky is closed over: "it rained today". A phase with the toggle shows
   * its own setting; the night, which has no toggle, is handed the evening's.
   */
  readonly overcast: boolean;
  readonly uid: string;
}

export function PhaseTab(props: PhaseTabProps): JSX.Element {
  const { phase: phaseName, loaded, days, scope, weather, curves, kit, outfit, unit, settings, result, anchor, risk, nightRisks, sleepGear, uid } = props;
  const { report, phase } = result;
  const tab = phaseTab(phaseName);
  const controls = PHASE_CONTROLS[phaseName];
  const trip = loaded.weather;
  const provenance = loaded.provenance;
  // the night on screen, or the first night as the stand-in for the scene's sun and the window clocks when the trip is pooled
  const day = (scope.kind === 'night' ? days[scope.index] : days[0]) ?? days[0]!;
  const nightsShown = scope.kind === 'trip' ? days.length : 1;
  const voice = voiceFor(tab, nightsShown);
  const whenLabel = nightsShown === 1 ? formatLongDate(day.date) : formatDateSpan(days[0]!.date, days[days.length - 1]!.date);
  const sourceLabel = describeSource(weather, loaded, nightsShown);
  const isSleep = phaseName === 'sleep';
  const [selectedBar, setSelectedBar] = useState<string | null>(null);
  const [hoverBar, setHoverBar] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [stageRef, stageW] = useMeasure<HTMLDivElement>(1440);
  // the little scene keeps to the tableau's middle-right cell; the landscape spans the stage
  const [sideRef, vignette] = useBoxWithin<HTMLDivElement, HTMLDivElement>(stageRef, { x: 560, y: 140, w: 700, h: 500 });
  const stageH = STAGE_H;
  // the settings take one row, or two on the sleep tab; the chart gives way to them rather than standing over them
  const [settingsRef, settingsBox] = useBoxWithin<HTMLDivElement, HTMLDivElement>(stageRef, { x: 0, y: stageH - CHART_BOTTOM, w: 0, h: CHART_BOTTOM });
  const chartH = stageH - CHART_TOP - Math.max(CHART_BOTTOM, settingsBox.h + CHART_SETTLE);

  // what the figure wears: the bar under the pointer wins, then the clicked bar, then the warmest outfit
  const shownId = hoverBar ?? selectedBar;
  const shown = shownId === null ? null : (phase.candidates.find((c) => c.id === shownId && c.garments.length > 0) ?? null);
  const sceneKit = useMemo(() => (shown === null ? outfit : kitFromGarments(shown.garments)), [shown, outfit]);

  // the sleep system, solved on your pad and on the label's own mat
  const sleep = useMemo(() => (isSleep ? sleepSystemView(settings, sleepGear) : null), [isSleep, settings, sleepGear]);

  const series: ChartSeries[] = useMemo(() => {
    if (sleep === null) return candidateSeries(phase.candidates, unit);
    const candidate = phase.candidates[0];
    if (candidate === undefined) return [];
    const a = candidate.assessment;
    // the air the engine compared the system to: its margin is measured from the comfort limit
    const effectiveAirC = a.marginK + a.comfort.coldLimitC;
    const t = (c: number): string => `${formatTempPlain(c, unit)} ${UNIT_SYMBOL[unit]}`;
    const bag = sleep.input.bag;
    const labelOn = bag.ratingType === 'limit' ? 'limit' : 'comfort';
    const mat = (r: typeof sleep.yours, name: string, padR: number): readonly (readonly [string, string])[] => [
      ['Comfort', t(r.comfortC)],
      ['Limit', t(r.limitC)],
      ['Extreme', t(r.extremeC)],
      ['Pad under you', `R ${padR.toFixed(1)} (${name})`],
      ['Whole system', `${r.systemRc.toFixed(2)} m²K/W`],
    ];
    const onLabel = sleep.onLabelMat;
    const yours = sleep.yours;
    const labelWarm = onLabel.ventedComfortC + sleep.ventHeadroomK;
    return [
      {
        id: 'label_mat',
        label: `On the mat in the rating (R ${sleep.referencePadImperialR.toFixed(1)})`,
        coldLimitC: onLabel.comfortC,
        warmLimitC: labelWarm,
        foot: 'LABEL',
        verdict: verdictFrom({
          airTemperatureC: effectiveAirC,
          comfort: { coldLimitC: onLabel.comfortC, warmLimitC: labelWarm },
          survivalCriterionFailing: effectiveAirC < onLabel.extremeC,
        }),
        rows: mat(onLabel, 'ISO reference', sleep.referencePadImperialR),
        aria: `The bag on the reference mattress its rating assumes, R ${sleep.referencePadImperialR.toFixed(1)}. Comfortable from ${t(onLabel.comfortC)} to ${t(labelWarm)}; limit ${t(onLabel.limitC)}; extreme ${t(onLabel.extremeC)}.`,
        below: { limitC: onLabel.limitC, extremeC: onLabel.extremeC, ...(labelOn === 'limit' ? { limitLabel: `label ${t(bag.ratingC)}` } : {}) },
      },
      {
        id: 'your_pad',
        label: `On your pad (R ${yours.padImperialR.toFixed(1)})`,
        coldLimitC: a.comfort.coldLimitC,
        warmLimitC: a.comfort.warmLimitC,
        foot: 'YOURS',
        verdict: a.verdict,
        rows: [...mat(yours, 'yours', yours.padImperialR), ['At the median', VERDICT_WORD[a.verdict]]],
        aria: `The same bag on your pad, R ${yours.padImperialR.toFixed(1)}. Comfortable from ${t(yours.comfortC)}${
          a.comfort.warmLimitC === null ? ' upward' : ` to ${t(a.comfort.warmLimitC)}`
        }; limit ${t(yours.limitC)}; extreme ${t(yours.extremeC)}. Verdict at the median: ${VERDICT_WORD[a.verdict]}.`,
        below: { limitC: yours.limitC, extremeC: yours.extremeC },
      },
    ];
  }, [sleep, phase, unit]);

  /** Conditions are the same for every candidate, so any one of them reports the environment. */
  const resolved = phase.best?.assessment.conditions ?? phase.candidates[0]?.assessment.conditions ?? null;

  // the headline: the chance you are comfortable, and the two tails it leaves, all at the trip-wide anchor
  const comfortPct = Math.round(risk.comfortable * 100);
  const colderPct = Math.round(risk.cold * 100);
  const warmerPct = Math.round(risk.warm * 100);
  const mark = riskMark(riskLevel(risk.cold));
  const t = (c: number): string => `${formatTempPlain(c, unit)} ${UNIT_SYMBOL[unit]}`;
  // this scope's own limit, which moves with its wind and sky; stated, but not what the risk is read at
  const ownLimitC = kitColdLimitC(phase);
  const ownDiffers = anchor.coldC !== null && ownLimitC !== null && Math.abs(ownLimitC - anchor.coldC) > 0.05;
  const scopeNoun = phaseName === 'hiking' || phaseName === 'day_break' ? 'day' : 'night';
  const kitNoun = isSleep ? 'your sleep system' : 'your kit';

  const verdict = headline(report.verdict, tab.enginePhrase);
  const fire = controls.campfire && settings.campfire;
  const overcast = props.overcast;
  const target: SceneTarget = useMemo(
    () => ({ p: tab.sun, pose: tab.pose, lit: fire, overcast: overcast ? 1 : 0, ...tab.props }),
    [tab, fire, overcast],
  );

  const annotations: SceneAnnotation[] = phase.extremities.map((e) => ({
    region: e.part,
    verdict: e.verdict,
    label: `${e.part}: ${VERDICT_WORD[e.verdict]}`,
    detail: `needs ${e.requiredClo.toFixed(2)}, has ${e.wornClo.toFixed(2)} clo`,
    colour: VERDICT_COLOR[e.verdict],
  }));

  const set = (patch: Partial<PhaseSettings>): void => props.onSettings({ ...settings, ...patch });
  const start = phaseName === 'camp_evening' ? day.sunset : weather.startLocal;
  const padDelta = sleep === null ? null : sleep.yours.padPenaltyK;

  return (
    <div className="wibc-phase">
      <div className="wibc-stage" ref={stageRef} style={{ height: `${stageH}px` }}>
        <Scene
          width={stageW}
          height={stageH}
          vignette={vignette}
          kit={sceneKit}
          target={target}
          onFigureClick={props.onGoToGear}
          figureLabel={
            shown === null
              ? `The character, ${voice.posture}, in the warmest outfit you own. Opens the gear tab.`
              : `The character, ${voice.posture}, shown wearing ${shown.label}. Opens the gear tab.`
          }
          caption={
            tab.caption +
            (controls.campfire && !settings.campfire ? ' The fire is unlit, a few embers in the ring.' : '') +
            (overcast ? ' It rained today: the clouds have grown and merged into one grey overcast sheet, the sun a pale patch behind it.' : '')
          }
          annotations={annotations}
          uid={uid}
        />
        {shown !== null && (
          <p className="wibc-scene-chip" role="status" style={{ left: `${vignette.x + 14}px`, top: `${vignette.y + vignette.h - 36}px` }}>
            <span className="wibc-scene-chip-kicker">wearing</span> {shown.shortLabel}
          </p>
        )}

        <div className="wibc-tableau wibc-wrap" style={{ paddingTop: `${CHART_TOP}px` }}>
          <section className="wibc-tableau-chart" aria-labelledby={`${uid}-chart-title`}>
            <div className="wibc-chart-panel" aria-hidden="true" />
            <h2 className="wibc-sr-only" id={`${uid}-chart-title`}>
              {isSleep ? `Where the sleep system is comfortable, against ${voice.period}` : `Where each outfit is comfortable, against ${voice.period}`}
            </h2>
            <ComfortChart
              height={chartH}
              unit={unit}
              series={series}
              band={phase.band}
              gaps={phase.gaps}
              temperature={weather.temperature}
              curves={curves}
              axis={props.axis}
              anchorC={anchor.coldC}
              selectedId={selectedBar}
              onSelect={setSelectedBar}
              onHover={setHoverBar}
              footCaption={isSleep ? 'THE SAME BAG, TWO MATS' : 'ENSEMBLE CLO →'}
              period={voice.period}
              {...(sleep !== null && padDelta !== null
                ? {
                    delta: {
                      fromId: 'label_mat',
                      toId: 'your_pad',
                      lines: [
                        `${padDelta >= 0 ? '+' : ''}${formatDelta(padDelta, unit, 1)}`,
                        'the pad delta:',
                        `R ${sleep.yours.padImperialR.toFixed(1)} under you,`,
                        `R ${sleep.referencePadImperialR.toFixed(1)} in the rating`,
                      ],
                    },
                    minPlotW: 190,
                  }
                : {})}
              uid={uid}
            />
          </section>

          <div className="wibc-tableau-top">
            <div className="wibc-findings-lead">
              <p className="wibc-stat" aria-label={`${comfortPct} percent likely to be comfortable ${voice.period}`}>
                <span className="wibc-stat-value">
                  <span className="wibc-stat-mark" style={{ color: mark.colour }} aria-hidden="true">
                    {mark.glyph}
                  </span>
                  {comfortPct}% comfortable
                </span>
                <span className="wibc-stat-label">
                  {anchor.coldC === null ? (
                    <>nothing you own could be assessed {voice.period}</>
                  ) : (
                    <>
                      <b>{colderPct}% chance</b> it gets colder than {kitNoun} handles {voice.period}
                      {warmerPct > 0 && (
                        <>
                          ; <b>{warmerPct}%</b> of warmer than {isSleep ? 'the bag vented' : 'your lightest outfit, fully open'}
                        </>
                      )}
                    </>
                  )}
                </span>
              </p>
              {sleep === null && anchor.coldC !== null && (
                <p className="wibc-runs-out">
                  Your warmest outfit runs out at <b>{t(anchor.coldC)}</b> over the trip; every figure here is read at that one limit, so the
                  nights compare.
                  {scope.kind === 'trip' && nightRisks.length > 1 && (
                    <>
                      {' '}
                      {scopeNoun === 'day' ? 'Day' : 'Night'} by {scopeNoun}, at that same limit:{' '}
                      {nightRisks.map((r, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          <b>{Math.round(r.cold * 100)}%</b>
                        </span>
                      ))}
                      .
                    </>
                  )}
                  {scope.kind === 'night' && ownLimitC !== null && (
                    <>
                      {' '}
                      {ownDiffers ? (
                        <>
                          This {scopeNoun}&rsquo;s own conditions (wind {weather.windSpeed.p50.toFixed(1)} m/s, {Math.round(weather.cloudCover * 100)}%
                          cloud) take the same kit to <b>{t(ownLimitC)}</b>.
                        </>
                      ) : (
                        <>This {scopeNoun}&rsquo;s own limit is the same.</>
                      )}
                    </>
                  )}
                </p>
              )}
              {sleep !== null && anchor.coldC !== null && (
                <p className="wibc-runs-out">
                  The label says <b>{t(sleep.input.bag.ratingC)}</b>
                  {sleep.input.bag.ratingType === 'limit' ? (
                    <>, a US limit rating: on the mat in that rating it is comfortable down to <b>{t(sleep.onLabelMat.comfortC)}</b></>
                  ) : (
                    <>, its comfort rating on the mat in that rating</>
                  )}
                  , and on your R {sleep.yours.padImperialR.toFixed(1)} pad to <b>{t(sleep.yours.comfortC)}</b>. The risk above is read at{' '}
                  <b>{t(anchor.coldC)}</b>, the trip-wide limit, on every night.
                  {scope.kind === 'trip' && nightRisks.length > 1 && (
                    <>
                      {' '}
                      Night by night:{' '}
                      {nightRisks.map((r, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          <b>{Math.round(r.cold * 100)}%</b>
                        </span>
                      ))}
                      .
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="wibc-where">
              <span>
                <button type="button" className="wibc-where-trip" onClick={props.onGoToTrip} title="Change the place or the dates">
                  {trip.location.label ?? 'Great Smoky Mountains'}
                </button>{' '}
                · {whenLabel} · {clockOf(start)}–{clockOf(weather.endLocal)}
              </span>
              <span>
                {nightsShown > 1 ? `${nightsShown} nights pooled, ${weather.sampleHours} hours` : `${weather.sampleHours} ${weather.source === 'climatology' ? 'hours' : 'forecast hours'}`} ·{' '}
                {Math.round(weather.cloudCover * 100)}% cloud · wind {weather.windSpeed.p50.toFixed(1)} m/s
              </span>
              <span className="wibc-source" data-source={sourceLabel.kind}>
                {sourceLabel.text}
              </span>
              {days.length > 1 && (
                <span className="wibc-nights" role="group" aria-label="Which night to show">
                  <button type="button" className="wibc-night" aria-pressed={scope.kind === 'trip'} onClick={() => props.onScope({ kind: 'trip' })}>
                    Whole trip
                  </button>
                  {days.map((d, i) => (
                    <button
                      key={d.date}
                      type="button"
                      className="wibc-night"
                      aria-pressed={scope.kind === 'night' && scope.index === i}
                      aria-label={`Night ${i + 1}, ${formatLongDate(d.date)}${d.source === 'climatology' ? ', climatology' : ''}`}
                      data-source={d.source}
                      onClick={() => props.onScope({ kind: 'night', index: i })}
                    >
                      {formatShortDate(d.date)}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </div>

          {/* the cell the figure is drawn into; the scene behind it takes the clicks */}
          <div className="wibc-tableau-scene" ref={sideRef} aria-hidden="true" />

          <div className="wibc-tableau-settings" ref={settingsRef}>
            {isSleep && <SleepSystemControls gear={sleepGear} onChange={props.onSleepGear} unit={unit} uid={uid} />}
            <div className="wibc-controls" role="group" aria-label={`Conditions ${voice.period}`}>
            <span className="wibc-controls-label">{voice.settings}</span>
            <label className="wibc-control">
              <span>{controls.shelter.label}</span>
              <select value={settings.shelter} onChange={(e) => set({ shelter: (e.currentTarget as HTMLSelectElement).value as ShelterKind })}>
                {controls.shelter.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {controls.activities !== null && (
              <label className="wibc-control">
                <span>Doing</span>
                <select value={settings.activity} onChange={(e) => set({ activity: (e.currentTarget as HTMLSelectElement).value as Activity })}>
                  {controls.activities.map((a) => (
                    <option key={a} value={a}>
                      {ACTIVITY_LABEL[a]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {controls.campfire && (
              <button
                type="button"
                className="wibc-toggle"
                aria-pressed={settings.campfire}
                onClick={() => set({ campfire: !settings.campfire })}
                title="A fire about a metre away: roughly 2 K warmer on the side facing it, in the model and in the picture"
              >
                Campfire
              </button>
            )}
            {controls.bagDraped && (
              <button type="button" className="wibc-toggle" aria-pressed={settings.bagDraped} onClick={() => set({ bagDraped: !settings.bagDraped })}>
                Bag draped over you
              </button>
            )}
            {controls.wet && (
              <button type="button" className="wibc-toggle" aria-pressed={settings.wet} onClick={() => set({ wet: !settings.wet })}>
                It rained today
              </button>
            )}
            {controls.sleep && (
              <>
                <button
                  type="button"
                  className="wibc-toggle"
                  aria-pressed={settings.asBlanket}
                  onClick={() => set({ asBlanket: !settings.asBlanket })}
                  title="Unzipped and spread over you: the hood and the draft collar the rating assumes are out of play"
                >
                  Bag open, as a blanket
                </button>
                <WornInside kit={kit} worn={settings.wornInside} onChange={(ids) => set({ wornInside: ids })} />
              </>
            )}
            <button type="button" className="wibc-button wibc-controls-gear" onClick={props.onGoToGear}>
              Change your gear →
            </button>
            </div>
          </div>
        </div>
      </div>

      <div className="wibc-body wibc-wrap">
        {/* THE VERDICT. Its one home. */}
        <p className="wibc-verdict">{verdict}</p>

        <div className="wibc-findings">
          {/*
            Every gap gets a line, not just the cold ones, and each kind in its own words:
            `cold` is below everything you own (a warning); `too_warm` is above your lightest
            outfit even fully open; `nothing_between` is a hole in the ladder (your kit
            brackets the range but nothing sits in it), which is a wardrobe observation, not
            a warning, and is worded as calmly as that. The line says where and how much; the
            fix is repeated only when the hero sentence does not already carry it word for word.
          */}
          {phase.gaps.length > 0 && (
            <ul className="wibc-gaps" aria-label="Gaps in coverage">
              {phase.gaps.map((gap) => {
                const share = Math.round(((gap.toC - gap.fromC) / (phase.band.toC - phase.band.fromC)) * 100);
                const range = `${formatTempPlain(gap.fromC, unit)}–${formatTempPlain(gap.toC, unit)} ${UNIT_SYMBOL[unit]}`;
                const fixInHero = verdict.includes(plain(gap.fix.text));
                return (
                  <li className="wibc-gap" data-severity={gap.severity} key={`${gap.fromC}-${gap.toC}`}>
                    <span className="wibc-gap-mark" aria-hidden="true">
                      {GAP_GLYPH[gap.severity]}
                    </span>
                    <span className="wibc-gap-text">
                      {gap.severity === 'cold' ? (
                        <b>{isSleep ? `Your sleep system does not cover ${range}` : `Nothing you own covers ${range}`}</b>
                      ) : gap.severity === 'too_warm' ? (
                        <b>{isSleep ? `${range} is too warm even with the bag vented` : `${range} is too warm even for your lightest outfit, fully open`}</b>
                      ) : (
                        <>
                          <b>Nothing you own sits in {range}</b>, though you have outfits either side
                        </>
                      )}
                      : {share}% {voice.share}.
                      {!fixInHero && <span className="wibc-gap-fix"> {plain(gap.fix.text)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* the extremity verdicts are drawn on the figure; this is their reading-order twin */}
          {phase.extremities.length > 0 && (
            <ul className="wibc-sr-only" aria-label="Hands, feet and head, judged separately">
              {phase.extremities.map((e) => (
                <li key={e.part}>
                  {e.part}: {VERDICT_WORD[e.verdict]}, needs {e.requiredClo.toFixed(2)} clo and has {e.wornClo.toFixed(2)}.
                </li>
              ))}
            </ul>
          )}

          {sleep !== null && <SleepFloors view={sleep} unit={unit} uid={uid} />}

          <p className="wibc-note wibc-chart-how">
            {isSleep ? (
              <>
                On the thermometer, the two bars are the same bag on two mats: the ISO reference mattress inside its rating, and the pad you
                carry. Each bar&rsquo;s solid part is the ISO 23537 comfort range; the dashed tail below runs down to the limit rating and the
                hollow dot marks the extreme. The curve at the far left is the chance of passing through each temperature {voice.period}. Hover a bar for
                its numbers.
              </>
            ) : (
              <>
                On the thermometer, each bar is one outfit&rsquo;s ISO 11079 comfort interval, lightest nearest the scale; the curve at the far
                left is the chance of passing through each temperature {voice.period}.
                Hover a bar for its numbers, and the character puts that outfit on.
              </>
            )}
          </p>

          <details className="wibc-table-details" open={showTable} onToggle={(e) => setShowTable((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>Show the numbers as a table</summary>
            <div className="wibc-scroll">
              {sleep === null ? (
                <table className="wibc-table">
                  <caption className="wibc-chart-sub" style={{ textAlign: 'left', padding: '6px 0' }}>
                    Comfort intervals, {tab.label.toLowerCase()}, {whenLabel}. Lightest outfit first, as on the chart.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Outfit</th>
                      <th scope="col">Ensemble</th>
                      <th scope="col">Needs</th>
                      <th scope="col">Comfortable from</th>
                      <th scope="col">to</th>
                      <th scope="col">At the median</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...phase.candidates]
                      .sort((a, b) => a.clo - b.clo)
                      .map((c) => {
                        const d = c.assessment.detail;
                        return (
                          <tr key={c.id}>
                            <th scope="row">
                              {c.shortLabel}
                              <span className="wibc-table-full">{c.label}</span>
                            </th>
                            <td>{c.clo.toFixed(2)} clo</td>
                            <td>{d.model === 'iso-11079-ireq' ? `${d.requiredNeutralClo.toFixed(2)} clo` : 'n/a'}</td>
                            <td>
                              {formatTempPlain(c.assessment.comfort.coldLimitC, unit)} {UNIT_SYMBOL[unit]}
                            </td>
                            <td>
                              {c.assessment.comfort.warmLimitC === null
                                ? 'open'
                                : `${formatTempPlain(c.assessment.comfort.warmLimitC, unit)} ${UNIT_SYMBOL[unit]}`}
                            </td>
                            <td>
                              {VERDICT_ICON[c.assessment.verdict]} {VERDICT_WORD[c.assessment.verdict]}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : (
                <table className="wibc-table">
                  <caption className="wibc-chart-sub" style={{ textAlign: 'left', padding: '6px 0' }}>
                    The sleep system, {whenLabel}: the same bag on the mat in its rating and on your pad.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Under you</th>
                      <th scope="col">Whole system</th>
                      <th scope="col">Comfort</th>
                      <th scope="col">Limit</th>
                      <th scope="col">Extreme</th>
                      <th scope="col">Vented, up to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        [`ISO reference mattress, R ${sleep.referencePadImperialR.toFixed(1)}`, sleep.onLabelMat],
                        [`Your pad, R ${sleep.yours.padImperialR.toFixed(1)}`, sleep.yours],
                      ] as const
                    ).map(([name, r]) => (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td>{r.systemRc.toFixed(3)} m²K/W</td>
                        <td>
                          {formatTempPlain(r.comfortC, unit)} {UNIT_SYMBOL[unit]}
                        </td>
                        <td>
                          {formatTempPlain(r.limitC, unit)} {UNIT_SYMBOL[unit]}
                        </td>
                        <td>
                          {formatTempPlain(r.extremeC, unit)} {UNIT_SYMBOL[unit]}
                        </td>
                        <td>
                          {formatTempPlain(r.ventedComfortC + sleep.ventHeadroomK, unit)} {UNIT_SYMBOL[unit]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        </div>

        <footer className="wibc-foot">
          <p className="wibc-foot-method">
            <a href={props.methodologyHref}>See our methodology</a>: what this model does not know, in the engine&rsquo;s own words.
          </p>
          <p>
            <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a> · <a href={OPEN_METEO_LICENCE_URL}>CC BY 4.0</a>.{' '}
            {provenance}
          </p>
          {sourceLabel.kind !== 'forecast' && sourceLabel.kind !== 'recorded' && (
            <p>
              {sourceLabel.kind === 'climatology'
                ? 'Climatology is the record of what this date has done at this point over the pooled years, not a prediction of this year; its band is wide because the years differ, not because the model is unsure.'
                : 'Where a night is beyond the forecast, its climatology stands in and is labelled on that night; the pooled view mixes the two across nights, never within one.'}
            </p>
          )}
          {resolved !== null && (
            <p>
              The engine resolves {voice.period} to an operative temperature of {formatTempPlain(resolved.operativeTemperatureC, unit)}{' '}
              {UNIT_SYMBOL[unit]} against {formatTempPlain(resolved.airTemperatureC, unit)} {UNIT_SYMBOL[unit]} of air and a mean radiant
              temperature of {formatTempPlain(resolved.meanRadiantTemperatureC, unit)} {UNIT_SYMBOL[unit]}: a{' '}
              {formatDelta(Math.abs(resolved.operativeTemperatureC - resolved.airTemperatureC), unit, 1)} radiant correction that no
              thermometer shows.
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The words on the source pill: what kind of data the shown weather is, said plainly. */
function describeSource(
  weather: PhaseWeather,
  loaded: LoadedTrip,
  nightsShown: number,
): { kind: 'forecast' | 'recorded' | 'climatology' | 'mixed'; text: string } {
  const climNights = loaded.nightsBySource.climatology.length;
  const fcNights = loaded.nightsBySource.forecast.length;
  if (nightsShown > 1 && climNights > 0 && fcNights > 0) {
    return { kind: 'mixed', text: `${fcNights} night${fcNights === 1 ? '' : 's'} forecast, ${climNights} climatology (not a forecast)` };
  }
  if (weather.source === 'climatology') {
    const years = loaded.climatologyYears;
    const span = years !== null && years.length > 0 ? `${years.length} years, ${years[0]} to ${years[years.length - 1]}` : `${weather.sampleYears} years`;
    return { kind: 'climatology', text: `Climatology, not a forecast: ${span}` };
  }
  if (loaded.source === 'fixture') return { kind: 'recorded', text: 'Recorded forecast, replayed offline' };
  return { kind: 'forecast', text: 'Live forecast' };
}

/**
 * What is worn inside the bag: chips for the owned garments that can go in (torso layers and
 * long underwear; shells stay out). Each is a toggle; the sum of their catalogue clo goes to
 * the engine, which counts only the excess over the base layer the rating already includes.
 */
function WornInside({ kit, worn, onChange }: { kit: Kit; worn: readonly string[]; onChange: (ids: string[]) => void }): JSX.Element | null {
  const options = [
    ...slotGarments(kit, 'torso', 'inner'),
    ...slotGarments(kit, 'torso', 'outer').filter((g) => g.isShell !== true),
    ...slotGarments(kit, 'legs', 'inner'),
  ];
  if (options.length === 0) return null;
  return (
    <span className="wibc-control wibc-chips" role="group" aria-label="Worn inside the bag">
      <span>Wearing inside</span>
      {options.map((g) => {
        const on = worn.includes(g.id);
        return (
          <button
            key={g.id}
            type="button"
            className="wibc-chip"
            aria-pressed={on}
            onClick={() => onChange(on ? worn.filter((x) => x !== g.id) : [...worn, g.id])}
            title={`${g.clo.toFixed(2)} clo in the catalogue`}
          >
            {g.label}
          </button>
        );
      })}
    </span>
  );
}
