/**
 * The two floors of a sleep system, drawn out.
 *
 * A bag's ISO 23537 rating is a whole-system number: it already contains a reference
 * mattress of R 4.83 and a base layer (`packages/heat/MODEL.md` §6, `SPEC.md` §10.3). So the
 * system is two parallel heat paths, and the pad's R is never added on top of the rating; what
 * matters is how far your pad falls short of the one the rating assumed. This block shows the
 * two paths as two bars of resistance, with the reference drawn as a ghost behind your pad so
 * the shortfall is the visible thing, and names what it costs in degrees.
 *
 * Every number is `solveSleepSystem()`'s: the over-path and under-path resistances, the
 * reference under-path, the pad R values, the share of heat lost downward, and the pad
 * penalty in kelvin. Nothing here is computed.
 */

import type { JSX } from 'preact';
import { siToClo } from '@will-i-be-cold/heat';
import { formatDelta, formatTempPlain, UNIT_SYMBOL, type Unit } from '../lib/units.js';
import type { SleepSystemView } from '../model/panel.js';

export interface SleepFloorsProps {
  readonly view: SleepSystemView;
  readonly unit: Unit;
  readonly uid: string;
}

const BAR_H = 18;
const BAR_W = 420;

export function SleepFloors({ view, unit, uid }: SleepFloorsProps): JSX.Element {
  const { yours, onLabelMat } = view;
  const over = yours.overPathRc;
  const under = yours.underPathRc;
  const reference = yours.referenceUnderPathRc;
  const scale = BAR_W / Math.max(over, under, reference);
  const w = (rsi: number): number => Math.max(2, rsi * scale);
  const shortfall = reference - under;
  const t = (c: number): string => `${formatTempPlain(c, unit)} ${UNIT_SYMBOL[unit]}`;
  const penalty = yours.padPenaltyK;
  const downPct = Math.round(yours.underPathHeatShare * 100);

  const summary =
    `Over you, the bag and what you wear in it: ${siToClo(over).toFixed(1)} clo. Under you, the crushed bag and your R ${yours.padImperialR.toFixed(
      1,
    )} pad: ${siToClo(under).toFixed(1)} clo, against ${siToClo(reference).toFixed(1)} clo with the R ${view.referencePadImperialR.toFixed(
      2,
    )} mattress the rating assumes. ${downPct}% of your heat leaves downward. Comfort ${t(onLabelMat.comfortC)} on the rating's mat, ${t(
      yours.comfortC,
    )} on your pad: ${formatDelta(Math.abs(penalty), unit, 1)} ${penalty >= 0 ? 'worse' : 'better'}.`;

  return (
    <section className="wibc-floors" aria-labelledby={`${uid}-floors-title`}>
      <h3 className="wibc-kicker" id={`${uid}-floors-title`}>
        Two floors, one rating
      </h3>
      <p className="wibc-floors-lede">
        The rating on the bag is a whole-system number: it already includes a mattress of R {view.referencePadImperialR.toFixed(2)} underneath
        you. Your pad is not added to it; what counts is how far your pad falls short of that one.
      </p>
      <svg
        className="wibc-floors-svg"
        width={BAR_W + 200}
        height={BAR_H * 2 + 58}
        viewBox={`0 0 ${BAR_W + 200} ${BAR_H * 2 + 58}`}
        role="img"
        aria-label={summary}
      >
        <defs>
          <pattern id={`${uid}-floor-hatch`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--serious)" fill-opacity="0.45" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" stroke-width="2" stroke-opacity="0.6" />
          </pattern>
        </defs>
        {/* over you */}
        <text x={0} y={BAR_H - 4} font-size="11" font-weight="600" letter-spacing="0.1em" fill="var(--ink-2)">
          OVER YOU
        </text>
        <rect x={96} y={0} width={w(over)} height={BAR_H} rx={4} fill="var(--clo-4)" />
        <text x={96 + w(over) + 8} y={BAR_H - 4} font-size="12" fill="var(--ink)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {siToClo(over).toFixed(1)} clo
        </text>
        <text x={96} y={BAR_H + 13} font-size="10.5" fill="var(--ink-3)">
          bag loft, cavity air, boundary layer, what you wear in it: back-solved from the label
        </text>
        {/* under you */}
        <g transform={`translate(0 ${BAR_H + 30})`}>
          <text x={0} y={BAR_H - 4} font-size="11" font-weight="600" letter-spacing="0.1em" fill="var(--ink-2)">
            UNDER YOU
          </text>
          {/* the mattress in the rating, as a ghost; the shortfall hatched */}
          <rect x={96} y={0} width={w(reference)} height={BAR_H} rx={4} fill="none" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3" />
          {shortfall > 0 && <rect x={96 + w(under)} y={1} width={Math.max(0, w(reference) - w(under))} height={BAR_H - 2} fill={`url(#${uid}-floor-hatch)`} />}
          <rect x={96} y={0} width={w(under)} height={BAR_H} rx={4} fill="var(--clo-3)" />
          <text x={96 + w(Math.max(under, reference)) + 8} y={BAR_H - 4} font-size="12" fill="var(--ink)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {siToClo(under).toFixed(1)} clo
            {shortfall > 0 ? ` of ${siToClo(reference).toFixed(1)}` : ''}
          </text>
          <text x={96} y={BAR_H + 13} font-size="10.5" fill="var(--ink-3)">
            crushed bag and your R {yours.padImperialR.toFixed(1)} pad; the dashed box is the R {view.referencePadImperialR.toFixed(2)} mattress the rating assumes
          </text>
        </g>
      </svg>
      <p className="wibc-floors-line">
        <b>{downPct}%</b> of your heat leaves downward. On the rating&rsquo;s mat this bag is comfortable to <b>{t(onLabelMat.comfortC)}</b>; on your
        pad, to <b>{t(yours.comfortC)}</b>: the pad costs <b>{formatDelta(Math.abs(penalty), unit, 1)}</b>
        {penalty < 0 ? ' in your favour' : ''}, before the bag leaves the stuff sack.
      </p>
    </section>
  );
}
