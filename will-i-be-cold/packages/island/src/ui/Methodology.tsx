/**
 * The methodology: everything the engine itself says about where its numbers are soft.
 *
 * This used to sit at the foot of the evening panel. It is interesting, and nobody read it
 * there, so it is its own page now: the panel keeps a single quiet link to it. Nothing was
 * cut in the move. Every string here is quoted from the engine: `phase.caveats` (which
 * already carries "steady state only" and "±1 clo person to person"), `report.warnings` for
 * anything it computed but flagged, and `report.unverifiedConstants`, the engine's own
 * register of numbers that are judgement calls rather than measurements. The page adds no
 * reassurance of its own and removes nothing.
 *
 * `Methodology` is the content, given a report; `MethodologyPage` binds it to the default
 * inventory and the recorded fixture so it can be mounted on its own route (`/methodology`).
 */

import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { CoverageReport, PhaseCoverage } from '@will-i-be-cold/heat';
import { OPEN_METEO_LICENCE_URL } from '@will-i-be-cold/weather';
import { tripWeather } from '../data/fixture.js';
import { dayOf, FIXTURE_PROVENANCE, PANEL_DATE } from '../data/trip.js';
import { plain } from '../lib/prose.js';
import { DEFAULT_KIT } from '../model/kit.js';
import { assessCampEvening } from '../model/panel.js';

export interface MethodologyProps {
  readonly report: CoverageReport;
  readonly phase: PhaseCoverage;
  readonly provenance: string;
  readonly attribution: string;
  /** Where "back to the panel" goes. Omit for no link. */
  readonly backHref?: string;
}

export function Methodology({ report, phase, provenance, attribution, backHref }: MethodologyProps): JSX.Element {
  const warnings = [...new Map(report.warnings.map((w) => [w.code + w.message, w])).values()];
  const model = phase.model === 'iso-11079-ireq' ? 'ISO 11079 (IREQ)' : 'ISO 23537 Annex C';

  return (
    <article className="wibc wibc-methodology">
      <div className="wibc-wrap wibc-methodology-wrap">
        {backHref !== undefined && (
          <p className="wibc-methodology-back">
            <a href={backHref}>← Back to the panel</a>
          </p>
        )}
        <header className="wibc-methodology-head">
          <p className="wibc-kicker">Methodology</p>
          <h1 id="wibc-methodology-title">What this model does not know</h1>
          <p className="wibc-caveats-lede">
            The bars come from {model}, a standard written for workplaces, applied to a hillside. These are the places the
            engine itself says its numbers are soft. Nothing here is softened by the page: every line is the engine&rsquo;s own.
          </p>
        </header>

        <section className="wibc-caveats" aria-labelledby="wibc-caveats-title">
          <div className="wibc-caveats-head">
            <p className="wibc-kicker">Read before you trust it</p>
            <h2 id="wibc-caveats-title">The caveats the engine attaches to this phase</h2>
          </div>
          <ol className="wibc-caveat-list">
            {phase.caveats.map((c) => (
              <li key={c}>{plain(c)}</li>
            ))}
          </ol>
        </section>

        <section className="wibc-methodology-section" aria-labelledby="wibc-warnings-title">
          <h2 id="wibc-warnings-title">
            {warnings.length} model warning{warnings.length === 1 ? '' : 's'} on the default configuration
          </h2>
          {warnings.length === 0 ? (
            <p className="wibc-note">The engine raised no warnings for this configuration.</p>
          ) : (
            <ul className="wibc-warning-list">
              {warnings.map((w) => (
                <li key={w.code + w.message} data-severity={w.severity}>
                  <code>{w.severity}</code> {plain(w.message)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wibc-methodology-section" aria-labelledby="wibc-constants-title">
          <h2 id="wibc-constants-title">
            {report.unverifiedConstants.length} constants in this engine are estimates, not measurements
          </h2>
          <div className="wibc-scroll">
            <table className="wibc-table">
              <thead>
                <tr>
                  <th scope="col">Constant</th>
                  <th scope="col">Value</th>
                  <th scope="col">Why it is a guess</th>
                </tr>
              </thead>
              <tbody>
                {report.unverifiedConstants.map((k) => (
                  <tr key={k.id}>
                    <th scope="row">
                      <code>{k.id}</code>
                    </th>
                    <td>
                      {k.value} {k.units}
                    </td>
                    <td className="wibc-table-prose">{plain(k.note)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="wibc-foot">
          <p>
            <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a> · <a href={OPEN_METEO_LICENCE_URL}>CC BY 4.0</a>. {attribution}{' '}
            {provenance}
          </p>
        </footer>
      </div>
    </article>
  );
}

export interface MethodologyPageProps {
  readonly backHref?: string;
}

/** The methodology bound to the default inventory and the recorded fixture, for its own route. */
export function MethodologyPage({ backHref = '/' }: MethodologyPageProps): JSX.Element {
  const { trip, result } = useMemo(() => {
    const t = tripWeather();
    const day = dayOf(t, PANEL_DATE);
    const r = assessCampEvening(DEFAULT_KIT, day.phases.camp_evening, 'F');
    return { trip: t, result: r };
  }, []);
  return (
    <Methodology report={result.report} phase={result.phase} provenance={FIXTURE_PROVENANCE} attribution={trip.attribution} backHref={backHref} />
  );
}
