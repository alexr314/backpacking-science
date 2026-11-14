/**
 * The quantitative core: a vertical thermometer. One temperature axis drawn as a tube with a
 * bulb at the cold end, the expected band for the phase lit on that tube and glowing out
 * across the plot, one vertical comfort-interval bar per series beside it, the uncovered span
 * burned into the tube itself, and at the far left, sharing the same vertical temperature
 * axis, the encounter curve.
 *
 * WHAT A BAR IS. The chart draws `ChartSeries`, not candidates: a bar is a comfort interval
 * with a name, a foot label and a tooltip. For the four clothed phases the series are the
 * engine's candidate ensembles (`candidateSeries`), lightest nearest the tube; for sleep they
 * are the same bag on two mats, the reference mattress inside its rating and the pad you
 * carry (`PhaseTab.tsx`), with a dimension line between their cold ends for the pad delta.
 * A series may carry the label's other two numbers (`below`): a dashed tail from the comfort
 * limit down to the limit rating, and a dot at the extreme.
 *
 * THE ENCOUNTER CURVE. For each temperature, the chance the period passes through it. Not a
 * distribution: each value is its own probability in [0, 1], so it is a mesa (near 1 across
 * the bulk of the period, limbs falling off at either end), never normalised, never stacked.
 * It is drawn against its own 0 to 1 axis, rotated so that the temperature axis is the
 * thermometer's, and it reads *outward*: p = 0 beside the tube, p = 1 at the far left, so
 * the mesa bulges away from the thermometer (R18). The read that matters is the cold limb,
 * so the chart marks on it where the warmest thing you own runs out, with the chance of it
 * getting colder than that.
 *
 * THE SCALE IS THE ONLY THING THAT WEARS TEMPERATURE COLOUR. The tube carries a blue to red
 * gradient in *absolute* terms: icy blue at the bottom, blue, green near 70 °F, yellow near
 * 80 °F, and a desaturated dark-red/pink reserved for 90 to 100 °F. It belongs to the axis,
 * not to the data: it moves with the scale, never with the bars. Its hot end is deliberately
 * academic (nobody asking "will I be cold?" is camping at 95 °F) and is kept low-chroma so it
 * can never compete with the saturated red that means *gap*. Gaps stay the loudest thing on
 * the panel.
 *
 * Form (dataviz): the bars are *ordered* configurations, so colour is a one-hue **ordinal**
 * ramp keyed to order. The hue is blue-grey ink, nowhere near the scale's hues, so a bar's
 * colour cannot be mistaken for a temperature. Bar *text* lives on hover and focus; the
 * resting state says which bar is which by position and by the foot label. Every number is
 * also in the table view beneath the chart.
 *
 * THE LIGHT LANGUAGE. The period's band is light spreading from the tube across the plot; a
 * gap is red light doing the same. The saturated marks are small (a hatched axis segment and
 * a badge), never a block.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { CandidateEnsemble, CoverageGap, GapSeverity, PhaseCoverage, Span, Verdict } from '@will-i-be-cold/heat';
import type { Distribution } from '@will-i-be-cold/weather';
import { formatClo, formatTempPlain, toUnit, UNIT_SYMBOL, type Unit } from '../lib/units.js';
import { curveAt, type EncounterCurves } from '../model/encounter.js';

const CLO_RAMP = ['var(--clo-1)', 'var(--clo-2)', 'var(--clo-3)', 'var(--clo-4)', 'var(--clo-5)'];

export const VERDICT_ICON: Readonly<Record<Verdict, string>> = {
  fine: '✓',
  marginal: '~',
  cold: '✕',
  too_warm: '≋',
  dangerous: '!',
};

export const VERDICT_WORD: Readonly<Record<Verdict, string>> = {
  fine: 'fine',
  marginal: 'marginal',
  cold: 'cold',
  too_warm: 'too warm',
  dangerous: 'dangerous',
};

export const VERDICT_COLOR: Readonly<Record<Verdict, string>> = {
  fine: 'var(--good)',
  marginal: 'var(--warning)',
  cold: 'var(--critical)',
  too_warm: 'var(--serious)',
  dangerous: 'var(--critical)',
};

/**
 * Gap severity is a status token, never a series colour.
 *
 * `nothing_between` is the engine's third kind: an interior hole that survives venting, i.e.
 * you own nothing that sits in this range. That is a wardrobe observation, not a cold-injury
 * warning, so it gets the warning token rather than the critical one; only `cold` means
 * "you will be cold".
 */
export const GAP_COLOR: Readonly<Record<GapSeverity, string>> = {
  cold: 'var(--critical)',
  too_warm: 'var(--serious)',
  nothing_between: 'var(--warning)',
};

export const GAP_GLYPH: Readonly<Record<GapSeverity, string>> = {
  nothing_between: '–',
  cold: '!',
  too_warm: '≋',
};

/** The worst kind of gap present: cold, then too warm, then a hole in the ladder; null for none. */
export function worstGap(gaps: readonly CoverageGap[]): GapSeverity | null {
  if (gaps.some((g) => g.severity === 'cold')) return 'cold';
  if (gaps.some((g) => g.severity === 'too_warm')) return 'too_warm';
  return gaps[0]?.severity ?? null;
}

/** The glyph and colour a status mark wears for a set of gaps. */
export function gapMark(gaps: readonly CoverageGap[]): { glyph: string; colour: string } {
  const worst = worstGap(gaps);
  return worst === null ? { glyph: '✓', colour: 'var(--good)' } : { glyph: GAP_GLYPH[worst], colour: GAP_COLOR[worst] };
}

/**
 * The absolute scale, as [°F, colour] anchors. Icy, blue, green near 70, yellow near 80, a
 * desaturated dark red/pink only at 90 to 100. The chroma falls off at the top on purpose.
 */
const SCALE_STOPS: readonly (readonly [number, string])[] = [
  [-20, '#dff2ff'],
  [10, '#9ccbf0'],
  [32, '#4d8fd8'],
  [50, '#3a7dbd'],
  [62, '#3a97a0'],
  [70, '#48a86a'],
  [80, '#d2bf4e'],
  [90, '#a35b6c'],
  [100, '#6a3441'],
];

// --- geometry (px) --------------------------------------------------------------------
const TOP = 44; // svg top to plot top (warm end): room for the captions
const FOOT = 96; // plot bottom (cold end) to svg bottom: bulb, the rotated foot labels, the caption
const CURVE_L = 14; // the probability axis: p = 1 here, at the far left
const CURVE_W = 84; // and p = 0 this far right of it, beside the tube
const LABEL_W = 44; // tick-label column between the curve and the tube
const TUBE_W = 16;
const BULB_R = 17;
const PAD_R = 12;
const BAR_W = 16;
const BAR_GAP = 9;

/** Nice tick steps in the *display* unit. */
function tickStep(spanInUnit: number, unit: Unit): number {
  const candidates = unit === 'F' ? [2, 5, 10, 20, 25] : [1, 2, 5, 10, 20];
  const target = spanInUnit / 8;
  return candidates.find((s) => s >= target) ?? candidates[candidates.length - 1]!;
}

/** One bar on the thermometer. */
export interface ChartSeries {
  readonly id: string;
  /** The name on hover. */
  readonly label: string;
  readonly coldLimitC: number;
  readonly warmLimitC: number | null;
  /** The persistent cue at the bar's foot, turned 45°. */
  readonly foot: string;
  readonly verdict: Verdict;
  /** Tooltip rows, after the name. */
  readonly rows: readonly (readonly [string, string])[];
  /** The screen-reader sentence for the bar. */
  readonly aria: string;
  /** The label's other two numbers, drawn below the comfort end: a dashed tail to the limit, a dot at the extreme. */
  readonly below?: { readonly limitC: number; readonly extremeC: number; readonly limitLabel?: string };
}

/**
 * Bars are named by how each candidate *differs* from the lightest one (`shortLabel`),
 * because every candidate in a phase shares most of its garments and the full labels all
 * open with the same words. The engine derives these; we only guard against a tie.
 */
export function candidateSeries(candidates: readonly CandidateEnsemble[], unit: Unit): ChartSeries[] {
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.shortLabel, (counts.get(c.shortLabel) ?? 0) + 1);
  // lightest first: the bars step down toward the cold end as layers are added
  const sorted = [...candidates].sort((a, b) => a.clo - b.clo);
  return sorted.map((c) => {
    const a = c.assessment;
    const label = (counts.get(c.shortLabel) ?? 0) > 1 ? `${c.shortLabel} (${formatClo(c.clo)})` : c.shortLabel;
    const detail = a.detail.model === 'iso-11079-ireq' ? a.detail : null;
    const rows: (readonly [string, string])[] = [
      ['Comfortable from', `${formatTempPlain(a.comfort.coldLimitC, unit)} ${UNIT_SYMBOL[unit]}`],
      ['Up to', a.comfort.warmLimitC === null ? 'open-ended' : `${formatTempPlain(a.comfort.warmLimitC, unit)} ${UNIT_SYMBOL[unit]}`],
      ['Ensemble', formatClo(c.clo)],
      ['At the median', `${VERDICT_ICON[a.verdict]} ${VERDICT_WORD[a.verdict]}`],
    ];
    if (detail !== null) {
      rows.push(['IREQ needs', formatClo(detail.requiredNeutralClo)]);
      rows.push(['Margin', `${detail.marginClo >= 0 ? '+' : ''}${detail.marginClo.toFixed(2)} clo`]);
      rows.push(['Heat debt in', detail.dleNeutral.display]);
    }
    return {
      id: c.id,
      label,
      coldLimitC: a.comfort.coldLimitC,
      warmLimitC: a.comfort.warmLimitC,
      foot: c.clo.toFixed(2),
      verdict: a.verdict,
      rows,
      aria: `${label}. ${formatClo(c.clo)}. Comfortable from ${formatTempPlain(a.comfort.coldLimitC, unit)} ${UNIT_SYMBOL[unit]}${
        a.comfort.warmLimitC === null ? ' upward' : ` to ${formatTempPlain(a.comfort.warmLimitC, unit)} ${UNIT_SYMBOL[unit]}`
      }. Verdict at the median: ${VERDICT_WORD[a.verdict]}.`,
    };
  });
}

/** The chart's natural width for this many bars; the column that holds it is sized from this. */
export function chartWidth(bars: number, minPlotW = 90): number {
  const plotL = CURVE_L + CURVE_W + 8 + LABEL_W + TUBE_W + 16;
  return plotL + Math.max(minPlotW, bars * (BAR_W + BAR_GAP)) + PAD_R;
}

export interface ChartProps {
  readonly height?: number;
  readonly unit: Unit;
  readonly series: readonly ChartSeries[];
  readonly band: Span;
  readonly gaps: PhaseCoverage['gaps'];
  /** The period's air temperature, for the median line and the p10 to p90 bracket. */
  readonly temperature: Distribution;
  readonly curves: EncounterCurves;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /** The bar under the pointer or holding focus, as it changes, so the scene can dress the figure in it. */
  readonly onHover?: (id: string | null) => void;
  /** The x-axis caption under the bars. */
  readonly footCaption: string;
  /** "tonight", "on the trail": how the curve's screen-reader text names the period. */
  readonly period: string;
  /** A dimension line between two bars' cold ends, with its label: the sleep tab's pad delta. */
  readonly delta?: { readonly fromId: string; readonly toId: string; readonly lines: readonly string[] };
  /** Minimum width of the bar plot, for a chart with few bars but annotations beside them. */
  readonly minPlotW?: number;
  readonly uid: string;
}

interface Bar {
  readonly series: ChartSeries;
  readonly color: string;
  readonly x: number;
  readonly w: number;
  /** Warm end (top). */
  readonly y0: number;
  /** Cold end (bottom). */
  readonly y1: number;
  readonly openEnd: boolean;
}

export function ComfortChart({
  height = 500,
  unit,
  series,
  band,
  gaps,
  temperature,
  curves,
  selectedId,
  onSelect,
  onHover,
  footCaption,
  period,
  delta,
  minPlotW = 90,
  uid,
}: ChartProps): JSX.Element {
  const [hoverId, setHoverIdState] = useState<string | null>(null);
  const setHoverId = (id: string | null): void => {
    setHoverIdState(id);
    onHover?.(id);
  };
  const n = series.length;
  const width = chartWidth(n, minPlotW);

  const curveR = CURVE_L + CURVE_W;
  const tubeX = curveR + 8 + LABEL_W + TUBE_W / 2;
  const plotL = tubeX + TUBE_W / 2 + 16;
  const plotR = width - PAD_R;
  const plotTop = TOP;
  const plotBottom = height - FOOT;
  const bulbY = plotBottom + 8 + BULB_R;

  // --- domain ------------------------------------------------------------------------
  const colds = series.map((s) => s.coldLimitC);
  const warms = series.map((s) => s.warmLimitC ?? s.coldLimitC + 7);
  const belows = series.flatMap((s) => (s.below === undefined ? [] : [s.below.limitC]));
  const rawLo = Math.max(-34.4, Math.min(band.fromC, ...colds, ...belows));
  const rawHi = Math.min(43.3, Math.max(band.toC, ...warms));
  const pad = Math.max(1, (rawHi - rawLo) * 0.07);
  const loC = rawLo - pad;
  const hiC = rawHi + pad;
  const y = (c: number): number => plotBottom - ((c - loC) / (hiC - loC)) * (plotBottom - plotTop);
  const clampY = (v: number): number => Math.min(plotBottom, Math.max(plotTop, v));
  const fToC = (f: number): number => ((f - 32) * 5) / 9;

  // --- ticks -------------------------------------------------------------------------
  const loU = toUnit(loC, unit);
  const hiU = toUnit(hiC, unit);
  const step = tickStep(hiU - loU, unit);
  const toC = (u: number): number => (unit === 'F' ? fToC(u) : u);
  const bandY0 = y(band.toC); // warm edge, higher up
  const bandY1 = y(band.fromC); // cold edge, lower down
  const ticks: number[] = [];
  for (let t = Math.ceil(loU / step) * step; t <= hiU + 1e-6; t += step) {
    const ty = y(toC(t));
    // The band's own edges are labelled in this column; a regular tick that would crowd them yields.
    if (Math.abs(ty - bandY0) < 13 || Math.abs(ty - bandY1) < 13) continue;
    ticks.push(Math.round(t));
  }

  // --- bars: packed, first nearest the tube -----------------------------------------
  const pitch = BAR_W + BAR_GAP;
  const bars: Bar[] = series.map((s, i) => {
    const openEnd = s.warmLimitC === null;
    const slot = n <= 1 ? CLO_RAMP.length - 1 : Math.round((i / (n - 1)) * (CLO_RAMP.length - 1));
    return {
      series: s,
      color: CLO_RAMP[slot]!,
      x: plotL + pitch * i + BAR_GAP / 2,
      w: BAR_W,
      y0: openEnd ? plotTop - 6 : clampY(y(s.warmLimitC ?? 0)),
      y1: clampY(y(s.coldLimitC)),
      openEnd,
    };
  });

  // The headline distance: how far the warmest thing you own sits from the band's warm edge.
  const warmestCold = Math.min(...colds);
  const shortfallK = warmestCold - band.toC;
  const warmestBar = bars.length > 0 ? bars[bars.length - 1]! : null;
  const showShortfall = warmestBar !== null && shortfallK > 0.6 && bandY0 - y(warmestCold) > 56;
  const shortfallX = warmestBar === null ? 0 : warmestBar.x + warmestBar.w / 2;
  const shortfallLines = [
    `${(unit === 'F' ? (shortfallK * 9) / 5 : shortfallK).toFixed(0)} ${UNIT_SYMBOL[unit]} short`,
    'of anything you own',
  ];

  const active = hoverId ?? selectedId;
  const activeBar = bars.find((b) => b.series.id === active) ?? null;

  // --- the encounter curve, in the plot's y and its own x, reading outward ---------------
  const px = (p: number): number => curveR - Math.max(0, Math.min(1, p)) * CURVE_W;
  const curvePts = curves.encounter.filter((pt) => pt.tC >= loC && pt.tC <= hiC);
  const curvePath =
    curvePts.length === 0
      ? ''
      : curvePts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${px(pt.p).toFixed(1)} ${y(pt.tC).toFixed(1)}`).join(' ');
  const areaPath =
    curvePts.length === 0
      ? ''
      : `${curvePath} L ${curveR} ${y(curvePts[curvePts.length - 1]!.tC).toFixed(1)} L ${curveR} ${y(curvePts[0]!.tC).toFixed(1)} Z`;
  // where the warmest outfit runs out, and the chance of it getting colder than that
  const runsOut = bars.length > 0 && Number.isFinite(warmestCold) && warmestCold > loC && warmestCold < hiC;
  const colderP = runsOut ? curveAt(curves.coldRisk, warmestCold) : 0;
  const colderPct = Math.round(colderP * 100);
  const curveAxisY = plotBottom + 14;

  // The absolute scale's stops, placed in user space so the gradient moves with the axis.
  const scaleTopY = y(fToC(SCALE_STOPS[SCALE_STOPS.length - 1]![0]));
  const scaleBottomY = y(fToC(SCALE_STOPS[0]![0]));
  const tubeTop = plotTop - 8;
  const tubeBottom = bulbY - BULB_R + 6;

  const curveDescription =
    `Chance you will see each temperature ${period}, from ${formatTempPlain(curvePts[0]?.tC ?? loC, unit)} to ${formatTempPlain(
      curvePts[curvePts.length - 1]?.tC ?? hiC,
      unit,
    )} ${UNIT_SYMBOL[unit]}; near certain across the expected band.` +
    (runsOut
      ? ` Your warmest option runs out at ${formatTempPlain(warmestCold, unit)} ${UNIT_SYMBOL[unit]}, with a ${colderPct}% chance of colder.`
      : '');

  const deltaBars = delta === undefined ? null : { a: bars.find((b) => b.series.id === delta.fromId), b: bars.find((b) => b.series.id === delta.toId) };

  return (
    <div className="wibc-chart" style={{ position: 'relative', width: `${width}px` }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
        <defs>
          <linearGradient id={`${uid}-scale`} gradientUnits="userSpaceOnUse" x1="0" y1={scaleBottomY} x2="0" y2={scaleTopY}>
            {SCALE_STOPS.map(([f, colour]) => (
              <stop
                key={f}
                offset={((f - SCALE_STOPS[0]![0]) / (SCALE_STOPS[SCALE_STOPS.length - 1]![0] - SCALE_STOPS[0]![0])).toFixed(3)}
                stop-color={colour}
              />
            ))}
          </linearGradient>
          {/* the period's band: light spreading from the tube, the way the fire lights the clearing */}
          <linearGradient id={`${uid}-bandglow`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#f5f2ea" stop-opacity="0.16" />
            <stop offset="0.45" stop-color="#f5f2ea" stop-opacity="0.06" />
            <stop offset="1" stop-color="#f5f2ea" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id={`${uid}-curvefill`} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stop-color="#f5f2ea" stop-opacity="0.04" />
            <stop offset="1" stop-color="#f5f2ea" stop-opacity="0.2" />
          </linearGradient>
          {(['cold', 'too_warm'] as const).map((severity) => (
            <linearGradient key={`g${severity}`} id={`${uid}-gapglow-${severity}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color={GAP_COLOR[severity]} stop-opacity="0.34" />
              <stop offset="0.5" stop-color={GAP_COLOR[severity]} stop-opacity="0.08" />
              <stop offset="1" stop-color={GAP_COLOR[severity]} stop-opacity="0" />
            </linearGradient>
          ))}
          {/*
            45-degree hatch on the tube segment, the redundant channel for the gap: the
            uncovered span is marked by texture AND colour AND a badge, so it survives CVD,
            greyscale print and forced colours.
          */}
          {(['cold', 'too_warm'] as const).map((severity) => (
            <pattern
              key={severity}
              id={`${uid}-hatch-${severity}`}
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform={`rotate(${severity === 'cold' ? 45 : 135})`}
            >
              <rect width="6" height="6" fill={GAP_COLOR[severity]} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" stroke-width="2" stroke-opacity="0.55" />
            </pattern>
          ))}
          <linearGradient id={`${uid}-openend`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--chart-ground)" stop-opacity="1" />
            <stop offset="1" stop-color="var(--chart-ground)" stop-opacity="0" />
          </linearGradient>
          <clipPath id={`${uid}-band-clip`}>
            <rect x={0} y={bandY0} width={width} height={Math.max(0, bandY1 - bandY0)} />
          </clipPath>
          <clipPath id={`${uid}-tube-clip`}>
            <rect x={tubeX - TUBE_W / 2} y={tubeTop} width={TUBE_W} height={tubeBottom - tubeTop} rx={TUBE_W / 2} />
            <circle cx={tubeX} cy={bulbY} r={BULB_R} />
          </clipPath>
          <clipPath id={`${uid}-plot-clip`}>
            <rect x={0} y={plotTop} width={width} height={plotBottom - plotTop} />
          </clipPath>
        </defs>

        {/* gridlines: hairline, solid, one step off the ground, across both the curve and the plot */}
        {ticks.map((t) => (
          <line
            key={`g${t}`}
            x1={CURVE_L}
            y1={y(toC(t))}
            x2={plotR}
            y2={y(toC(t))}
            stroke="var(--rule)"
            stroke-width="1"
            shape-rendering="crispEdges"
          />
        ))}

        {/* the period's band: a glow from the tube */}
        <rect x={plotL - 10} y={bandY0} width={plotR - plotL + 10} height={Math.max(1, bandY1 - bandY0)} fill={`url(#${uid}-bandglow)`} />
        {[bandY0, bandY1].map((by) => (
          <line
            key={`be${by}`}
            x1={CURVE_L}
            y1={by}
            x2={plotR}
            y2={by}
            stroke="#f5f2ea"
            stroke-opacity="0.32"
            stroke-width="1"
            shape-rendering="crispEdges"
          />
        ))}
        <line
          x1={plotL - 10}
          y1={y(temperature.p50)}
          x2={plotR}
          y2={y(temperature.p50)}
          stroke="#f5f2ea"
          stroke-opacity="0.5"
          stroke-width="1"
          shape-rendering="crispEdges"
        />
        <text x={plotR} y={y(temperature.p50) - 4} text-anchor="end" font-size="10" fill="var(--ink-3)">
          p50
        </text>

        {/* THE GAP: a glow across the plot, a hatched segment and a badge on the tube */}
        {gaps.map((gap) => {
          const gy0 = clampY(y(gap.toC));
          const gy1 = clampY(y(gap.fromC));
          return (
            <rect
              key={`gapglow${gap.fromC}`}
              x={plotL - 10}
              y={gy0}
              width={plotR - plotL + 10}
              height={Math.max(2, gy1 - gy0)}
              fill={`url(#${uid}-gapglow-${gap.severity})`}
            />
          );
        })}

        {/* THE ENCOUNTER CURVE: chance you'll see each temperature, on its own 0 to 1 axis, reading outward */}
        <g role="img" aria-label={curveDescription}>
          <text x={CURVE_L} y={plotTop - 24} font-size="10" fill="var(--ink-3)" letter-spacing="0.08em">
            CHANCE YOU&rsquo;LL
          </text>
          <text x={CURVE_L} y={plotTop - 12} font-size="10" fill="var(--ink-3)" letter-spacing="0.08em">
            SEE IT
          </text>
          <g clip-path={`url(#${uid}-plot-clip)`}>
            {areaPath !== '' && <path d={areaPath} fill={`url(#${uid}-curvefill)`} />}
            {curvePath !== '' && (
              <path d={curvePath} fill="none" stroke="#f5f2ea" stroke-opacity="0.85" stroke-width="1.6" stroke-linejoin="round" />
            )}
          </g>
          {/* the p10 to p90 interval, as a bracket on the p = 1 line */}
          <line x1={CURVE_L - 3} y1={bandY0} x2={CURVE_L - 3} y2={bandY1} stroke="var(--ink-2)" stroke-width="1" />
          {[bandY0, bandY1].map((by) => (
            <line key={`cap${by}`} x1={CURVE_L - 6} y1={by} x2={CURVE_L} y2={by} stroke="var(--ink-2)" stroke-width="1" />
          ))}
          <circle cx={CURVE_L - 3} cy={y(temperature.p50)} r="2" fill="var(--ink)" />
          {/* the probability axis: 0 at the thermometer's side, 1 at the far left */}
          <line x1={CURVE_L} y1={curveAxisY} x2={curveR} y2={curveAxisY} stroke="var(--axis)" stroke-width="1" shape-rendering="crispEdges" />
          {(
            [
              [0, '0'],
              [0.5, '50'],
              [1, '100%'],
            ] as const
          ).map(([p, label]) => (
            <g key={label}>
              <line x1={px(p)} y1={curveAxisY} x2={px(p)} y2={curveAxisY + 4} stroke="var(--axis)" stroke-width="1" shape-rendering="crispEdges" />
              <text x={px(p)} y={curveAxisY + 15} text-anchor={p === 1 ? 'start' : p === 0 ? 'end' : 'middle'} font-size="9.5" fill="var(--ink-3)">
                {label}
              </text>
            </g>
          ))}
          {/* where your warmest option runs out: the chance of colder than that, read off the cold limb */}
          {runsOut && (
            <g>
              <line
                x1={CURVE_L - 8}
                y1={y(warmestCold)}
                x2={curveR}
                y2={y(warmestCold)}
                stroke="var(--ink-2)"
                stroke-width="1"
                stroke-dasharray="2 3"
              />
              <circle cx={px(colderP)} cy={y(warmestCold)} r="3.5" fill="var(--chart-ground)" stroke="var(--ink)" stroke-width="1.5" />
              <text
                x={Math.max(px(colderP) - 8, CURVE_L + 2)}
                y={y(warmestCold) + (colderP > 0.5 ? 14 : -7)}
                text-anchor={colderP > 0.6 ? 'start' : 'end'}
                font-size="11"
                font-weight="700"
                fill="var(--ink)"
                stroke="var(--chart-ground)"
                stroke-width="3"
                paint-order="stroke"
              >
                {colderPct}% colder
              </text>
            </g>
          )}
        </g>

        {/* one bar per series; its name on hover, its foot label below */}
        {bars.map((b) => {
          const s = b.series;
          const isActive = active === s.id;
          const h = Math.max(6, b.y1 - b.y0);
          const cx = b.x + b.w / 2;
          return (
            <g key={s.id}>
              {/* the label's other numbers: a dashed tail to the limit rating, a dot at the extreme */}
              {s.below !== undefined && (
                <g>
                  <line x1={cx} y1={b.y1} x2={cx} y2={clampY(y(s.below.limitC))} stroke={b.color} stroke-width="3" stroke-dasharray="3 4" stroke-opacity="0.8" />
                  <line x1={cx - 6} y1={clampY(y(s.below.limitC))} x2={cx + 6} y2={clampY(y(s.below.limitC))} stroke={b.color} stroke-width="2" />
                  <circle cx={cx} cy={clampY(y(s.below.extremeC))} r="3" fill="none" stroke={b.color} stroke-width="1.5" stroke-opacity="0.8" />
                  {s.below.limitLabel !== undefined && (
                    <text
                      x={cx + 10}
                      y={clampY(y(s.below.limitC)) + 4}
                      font-size="10.5"
                      fill="var(--ink-2)"
                      stroke="var(--chart-ground)"
                      stroke-width="3"
                      paint-order="stroke"
                    >
                      {s.below.limitLabel}
                    </text>
                  )}
                </g>
              )}
              {/* the bar: dim outside the band, full chroma inside it */}
              <rect x={b.x} y={b.y0} width={b.w} height={h} rx="4" fill={b.color} fill-opacity="0.55" />
              <g clip-path={`url(#${uid}-band-clip)`}>
                <rect x={b.x} y={b.y0} width={b.w} height={h} rx="4" fill={b.color} />
              </g>
              {b.openEnd && <rect x={b.x - 1} y={plotTop - 8} width={b.w + 2} height={34} fill={`url(#${uid}-openend)`} />}
              {isActive && (
                <rect x={b.x - 3} y={b.y0 - 3} width={b.w + 6} height={h + 6} rx="6" fill="none" stroke="var(--ink)" stroke-width="1.5" />
              )}
              {/* the persistent cue at the foot, turned 45° so the packed bars still read */}
              <text
                x={cx}
                y={bulbY - 2}
                transform={`rotate(45 ${cx} ${bulbY - 2})`}
                text-anchor="start"
                font-size="11"
                font-weight={isActive ? 700 : 500}
                fill={isActive ? 'var(--ink)' : 'var(--ink-3)'}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {s.foot}
              </text>
              <rect
                className="wibc-bar-hit"
                x={b.x - BAR_GAP / 2}
                y={plotTop - 8}
                width={pitch}
                height={bulbY + BULB_R - plotTop + 8}
                fill="transparent"
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === s.id}
                aria-label={s.aria}
                onMouseEnter={() => setHoverId(s.id)}
                onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(s.id)}
                onBlur={() => setHoverId(null)}
                onClick={() => onSelect(selectedId === s.id ? null : s.id)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(selectedId === s.id ? null : s.id);
                  }
                }}
              />
            </g>
          );
        })}

        {/*
          The void between the band and the warmest bar IS the finding, so it gets drawn: a
          dimension line on the warmest bar's column, from the coldest thing any configuration
          manages down to the band's warm edge.
        */}
        {showShortfall && (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={shortfallX} y1={y(warmestCold) + 5} x2={shortfallX} y2={bandY0 - 5} stroke="var(--ink-3)" stroke-width="1" />
            {(
              [
                [y(warmestCold) + 5, -1],
                [bandY0 - 5, 1],
              ] as const
            ).map(([ay, dir]) => (
              <path key={ay} d={`M ${shortfallX} ${ay} l -3.5 ${-dir * 6} l 7 0 Z`} fill="var(--ink-3)" />
            ))}
            <text
              x={shortfallX - 8}
              y={(y(warmestCold) + bandY0) / 2 - 3}
              text-anchor="end"
              font-size="11.5"
              fill="var(--ink-2)"
              stroke="var(--chart-ground)"
              stroke-width="4"
              paint-order="stroke"
              stroke-linejoin="round"
            >
              {shortfallLines.map((line, i) => (
                <tspan key={i} x={shortfallX - 8} dy={i === 0 ? 0 : 14}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )}

        {/* THE PAD DELTA: a dimension line between two bars' cold ends, drawn to the right of the second */}
        {deltaBars !== null && deltaBars.a !== undefined && deltaBars.b !== undefined && delta !== undefined && (
          <g style={{ pointerEvents: 'none' }}>
            {(() => {
              const a = deltaBars.a;
              const b = deltaBars.b;
              const xDim = b.x + b.w + 14;
              const yA = a.y1;
              const yB = b.y1;
              const yTop = Math.min(yA, yB);
              const yBot = Math.max(yA, yB);
              return (
                <>
                  <line x1={a.x + a.w} y1={yA} x2={xDim + 6} y2={yA} stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3" />
                  <line x1={b.x + b.w} y1={yB} x2={xDim + 6} y2={yB} stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3" />
                  <line x1={xDim} y1={yTop + 4} x2={xDim} y2={yBot - 4} stroke="var(--ink-2)" stroke-width="1" />
                  {Math.abs(yBot - yTop) > 10 && (
                    <>
                      <path d={`M ${xDim} ${yTop} l -3.5 6 l 7 0 Z`} fill="var(--ink-2)" />
                      <path d={`M ${xDim} ${yBot} l -3.5 -6 l 7 0 Z`} fill="var(--ink-2)" />
                    </>
                  )}
                  <text
                    x={xDim + 8}
                    y={(yTop + yBot) / 2 - 2}
                    font-size="11.5"
                    fill="var(--ink)"
                    font-weight="600"
                    stroke="var(--chart-ground)"
                    stroke-width="4"
                    paint-order="stroke"
                    stroke-linejoin="round"
                  >
                    {delta.lines.map((line, i) => (
                      <tspan key={i} x={xDim + 8} dy={i === 0 ? 0 : 14} font-weight={i === 0 ? 700 : 400} fill={i === 0 ? 'var(--ink)' : 'var(--ink-2)'}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* THE THERMOMETER: the whole scale in its absolute colour, the band lit on it, the gap burned into it */}
        <g clip-path={`url(#${uid}-tube-clip)`}>
          <rect x={0} y={0} width={width} height={height} fill={`url(#${uid}-scale)`} opacity="0.42" />
          {/* the bulb is the reservoir: fuller than the dimmed scale, quieter than the gap */}
          <circle cx={tubeX} cy={bulbY} r={BULB_R} fill={`url(#${uid}-scale)`} opacity="0.7" />
          <rect x={0} y={bandY0} width={width} height={Math.max(1, bandY1 - bandY0)} fill={`url(#${uid}-scale)`} />
          {gaps.map((gap) => {
            const gy0 = clampY(y(gap.toC));
            const gy1 = clampY(y(gap.fromC));
            return (
              <rect
                key={`gapaxis${gap.fromC}`}
                x={0}
                y={gy0}
                width={width}
                height={Math.max(2, gy1 - gy0)}
                fill={`url(#${uid}-hatch-${gap.severity})`}
              />
            );
          })}
        </g>
        {/* a rim so the tube reads as glass against the ground */}
        <rect
          x={tubeX - TUBE_W / 2}
          y={tubeTop}
          width={TUBE_W}
          height={tubeBottom - tubeTop}
          rx={TUBE_W / 2}
          fill="none"
          stroke="#f5f2ea"
          stroke-opacity="0.18"
          stroke-width="1"
        />
        <circle cx={tubeX} cy={bulbY} r={BULB_R} fill="none" stroke="#f5f2ea" stroke-opacity="0.18" stroke-width="1" />
        {gaps.map((gap) => {
          const gy = (clampY(y(gap.toC)) + clampY(y(gap.fromC))) / 2;
          return (
            <g key={`gapbadge${gap.fromC}`}>
              <circle cx={tubeX} cy={gy} r="10" fill={GAP_COLOR[gap.severity]} />
              <text x={tubeX} y={gy + 5} text-anchor="middle" font-size="14" font-weight="700" fill="var(--surface)">
                {GAP_GLYPH[gap.severity]}
              </text>
            </g>
          );
        })}

        {/* ONE column of numbers. The band's edges are the loud ticks; the rest are quiet. */}
        {ticks.map((t) => (
          <g key={`t${t}`}>
            <line
              x1={tubeX - TUBE_W / 2 - 5}
              y1={y(toC(t))}
              x2={tubeX - TUBE_W / 2 - 1}
              y2={y(toC(t))}
              stroke="var(--axis)"
              stroke-width="1"
              shape-rendering="crispEdges"
            />
            <text
              x={tubeX - TUBE_W / 2 - 9}
              y={y(toC(t)) + 4}
              text-anchor="end"
              font-size="11"
              fill="var(--ink-3)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {t}
            </text>
          </g>
        ))}
        {[
          [bandY0, band.toC],
          [bandY1, band.fromC],
        ].map(([by, c]) => (
          <text
            key={`bl${by}`}
            x={tubeX - TUBE_W / 2 - 9}
            y={by! + 4}
            text-anchor="end"
            font-size="12"
            font-weight="700"
            fill="var(--ink)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatTempPlain(c!, unit)}
          </text>
        ))}
        <text x={tubeX - TUBE_W / 2 - 9} y={plotTop - 14} text-anchor="end" font-size="10.5" fill="var(--ink-3)" letter-spacing="0.08em">
          {UNIT_SYMBOL[unit]}
        </text>
        <text x={plotL} y={plotTop - 14} font-size="10.5" fill="var(--ink-3)" letter-spacing="0.08em">
          WARMER ↑
        </text>
        {/* the x axis caption under the bars */}
        <text x={plotL} y={height - 8} font-size="10.5" fill="var(--ink-3)" letter-spacing="0.08em">
          {footCaption}
        </text>
      </svg>

      {activeBar !== null && <Tooltip bar={activeBar} width={width} bandY0={bandY0} plotBottom={plotBottom} />}
    </div>
  );
}

function Tooltip({ bar, width, bandY0, plotBottom }: { bar: Bar; width: number; bandY0: number; plotBottom: number }): JSX.Element {
  const s = bar.series;
  const TIP_W = 232;
  const TIP_H = 40 + s.rows.length * 20;
  /*
   * Under the bar's cold end when the void between the bars and the band has room for it
   * (that void is usually the finding, and it is empty); else above the bar's warm end; else
   * beside it. Horizontally centred on the bar and kept inside the chart.
   */
  const left = Math.max(0, Math.min(bar.x + bar.w / 2 - TIP_W / 2, width - TIP_W));
  const top =
    bar.y1 + 10 + TIP_H <= bandY0
      ? bar.y1 + 10
      : bar.y0 - 10 - TIP_H >= 0
        ? bar.y0 - 10 - TIP_H
        : Math.max(0, Math.min(bar.y1 - 24, plotBottom - TIP_H));
  return (
    <div className="wibc-tip" style={{ left: `${left}px`, top: `${top}px`, width: `${TIP_W}px` }} role="status">
      <strong>{s.label}</strong>
      <dl>
        {s.rows.map(([k, v]) => (
          <>
            <dt key={`k${k}`}>{k}</dt>
            <dd key={`v${k}`}>
              {k === 'At the median' ? (
                <>
                  <span style={{ color: VERDICT_COLOR[s.verdict], fontWeight: 700 }}>{VERDICT_ICON[s.verdict]}</span> {VERDICT_WORD[s.verdict]}
                </>
              ) : (
                v
              )}
            </dd>
          </>
        ))}
      </dl>
    </div>
  );
}
