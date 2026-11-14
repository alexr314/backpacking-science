/**
 * The trip tab: where, at what height, and when.
 *
 * Two columns. WHERE: search a place by name (`PlaceSearch`) or drop a pin by pasting its
 * coordinates; either way the point's terrain height is looked up on the 90 m DEM and becomes
 * the height the forecast is asked for, in a field the user can overwrite (the DEM reads the
 * valley under a trail that climbs out of it). WHEN: a first night and a count of nights, with
 * the horizon decision read out per night before anything is fetched: forecast within sixteen
 * days, climatology beyond, never mixed within a night.
 *
 * THE SIGNATURE CLAIM IS ON SCREEN. The place card shows the DEM height, the height being
 * asked for, and the difference; once a forecast is loaded it shows what `elevation=` was
 * worth at this point as a measured number (the same request with and without it,
 * differenced), not a lapse rate quoted from a textbook.
 *
 * NOTHING SPINS FOREVER. The fetch has four states (idle, loading with a named step, failed
 * with a named failure, loaded) and each has its own words and its own way out. The recorded
 * Smokies forecast is the starting state and is one click away at every moment, so the panel
 * works with no network at all.
 */

import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { OPEN_METEO_LICENCE_URL, type GeocodeResult, type LocalDate } from '@will-i-be-cold/weather';
import type { PhaseName } from '@will-i-be-cold/heat';
import type { LoadStep } from '../data/live.js';
import { formatDateSpan, formatLongDate, formatShortDate } from '../lib/units.js';
import {
  classifyFailure,
  clampNights,
  formatFeet,
  formatLatLon,
  formatMetres,
  MAX_NIGHTS,
  parsePin,
  planHorizon,
  primaryPin,
  specProblem,
  tripDates,
  type LoadedTrip,
  type Place,
  type TripFailure,
  type TripSpec,
} from '../model/trip.js';
import { PlaceSearch } from './PlaceSearch.js';

/** The I/O the tab needs for places, injected so the tab itself never fetches. */
export interface PlaceService {
  readonly search: (name: string) => Promise<GeocodeResult[]>;
  /** A geocoding hit or a pin as a `Place`, before its height is known. */
  readonly fromResult: (r: GeocodeResult) => Place;
  readonly fromPin: (latitude: number, longitude: number) => Place;
  /** The same place with its 90 m DEM height filled in. */
  readonly resolve: (place: Place) => Promise<Place>;
}

export type TripJob =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly step: LoadStep }
  | { readonly kind: 'failed'; readonly failure: TripFailure };

export interface TripSetupProps {
  readonly loaded: LoadedTrip;
  readonly spec: TripSpec;
  readonly onSpec: (spec: TripSpec) => void;
  readonly job: TripJob;
  readonly onFetch: () => void;
  readonly onCancel: () => void;
  readonly onUseFixture: () => void;
  readonly onGoToPhase: (phase: PhaseName) => void;
  readonly today: LocalDate;
  readonly places: PlaceService;
  readonly uid: string;
}

/** The DEM lookup for the chosen point: its own small state machine beside the fetch's. */
type ElevationJob =
  | { readonly kind: 'idle' }
  | { readonly kind: 'looking'; readonly place: Place }
  | { readonly kind: 'failed'; readonly failure: TripFailure };

export function TripSetup(props: TripSetupProps): JSX.Element {
  const { loaded, spec, onSpec, job, today, places, uid } = props;
  const pin = primaryPin(spec);
  const [pinText, setPinText] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [elevJob, setElevJob] = useState<ElevationJob>({ kind: 'idle' });
  const [elevText, setElevText] = useState(pin?.elevation === null || pin?.elevation === undefined ? '' : String(Math.round(pin.elevation)));

  // the elevation field follows the pin when the pin changes under it (a new place, a DEM arriving)
  useEffect(() => {
    setElevText(pin?.elevation === null || pin?.elevation === undefined ? '' : String(Math.round(pin.elevation)));
  }, [pin?.latitude, pin?.longitude, pin?.demElevation]);

  const setPin = (next: Place): void => onSpec({ ...spec, pins: [next, ...spec.pins.slice(1)] });

  /** Take a point, show it at once, then fill in its DEM height; a failed lookup leaves the field to the user. */
  const choose = (place: Place): void => {
    setPin(place);
    setElevJob({ kind: 'looking', place });
    places
      .resolve(place)
      .then((resolved) => {
        setPin(resolved);
        setElevJob({ kind: 'idle' });
      })
      .catch((e: unknown) => {
        setElevJob({ kind: 'failed', failure: classifyFailure(e) });
      });
  };

  const onPinSubmit = (e: Event): void => {
    e.preventDefault();
    const parsed = parsePin(pinText);
    if (parsed === null) {
      setPinError('Could not read that as "latitude, longitude". Decimal degrees, north and east positive: 35.6056, -83.4672.');
      return;
    }
    setPinError(null);
    choose(places.fromPin(parsed.latitude, parsed.longitude));
  };

  const onElevation = (text: string): void => {
    setElevText(text);
    if (pin === null) return;
    const n = Number.parseFloat(text);
    setPin({ ...pin, elevation: text.trim() === '' || !Number.isFinite(n) ? null : n });
  };

  const dates = useMemo(() => tripDates(spec), [spec.startDate, spec.nights]);
  const plan = useMemo(() => planHorizon(dates, today), [dates, today]);
  const problem = specProblem(spec, today);
  const loading = job.kind === 'loading';
  const canFetch = problem === null && !loading;

  // the loaded data's own point, to say whether the correction on screen is for the pin being edited
  const loadedPin = primaryPin(loaded.spec);
  const lapseIsForThisPin =
    loaded.lapse !== null &&
    pin !== null &&
    loadedPin !== null &&
    Math.abs(loadedPin.latitude - pin.latitude) < 1e-6 &&
    Math.abs(loadedPin.longitude - pin.longitude) < 1e-6 &&
    pin.elevation !== null &&
    Math.round(pin.elevation) === Math.round(loaded.lapse.trailElevation);

  const overridden = pin !== null && pin.demElevation !== null && pin.elevation !== null && Math.round(pin.elevation) !== Math.round(pin.demElevation);

  return (
    <section className="wibc-trip" aria-labelledby={`${uid}-trip-title`}>
      <header className="wibc-trip-head">
        <div>
          <p className="wibc-kicker">Trip</p>
          <h2 className="wibc-gear-title" id={`${uid}-trip-title`}>
            Where, and when?
          </h2>
          <p className="wibc-gear-lede">
            The forecast is made for a point and a height, not for the nearest town. Open-Meteo lapse-corrects from its own model terrain to the
            elevation you give it, and the 90 m terrain model supplies that elevation for any pin; you can overwrite it when you know the trail
            sits higher or lower than the ground under the pin.
          </p>
        </div>
        <OnScreen loaded={loaded} />
      </header>

      <div className="wibc-trip-grid">
        {/* ------------------------------------------------------------------ where */}
        <section className="wibc-trip-col" aria-labelledby={`${uid}-where`}>
          <h3 className="wibc-trip-h" id={`${uid}-where`}>
            Where
          </h3>
          <PlaceSearch onSearch={places.search} onPick={(r) => choose(places.fromResult(r))} uid={uid} disabled={loading} />

          <form className="wibc-pin" onSubmit={onPinSubmit}>
            <label className="wibc-field" htmlFor={`${uid}-pin`}>
              <span>Or drop a pin</span>
              <span className="wibc-pin-row">
                <input
                  id={`${uid}-pin`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellcheck={false}
                  placeholder="35.6056, -83.4672"
                  value={pinText}
                  disabled={loading}
                  aria-describedby={`${uid}-pin-help`}
                  aria-invalid={pinError !== null}
                  onInput={(e) => {
                    setPinText((e.currentTarget as HTMLInputElement).value);
                    setPinError(null);
                  }}
                />
                <button type="submit" className="wibc-button" disabled={loading || pinText.trim() === ''}>
                  Use this pin
                </button>
              </span>
            </label>
            <p className="wibc-note" id={`${uid}-pin-help`}>
              {pinError ?? 'Paste the coordinates your maps app gives for a long-press on the spot: decimal degrees, latitude first.'}
            </p>
          </form>

          {pin !== null && (
            <div className="wibc-place" aria-live="polite">
              <p className="wibc-place-name">
                <span className="wibc-kicker">{pin.origin === 'pin' ? 'Pin' : pin.origin === 'fixture' ? 'Recorded point' : 'Place'}</span>
                <b>{pin.label}</b>
                {pin.origin !== 'pin' && <span className="wibc-note">{formatLatLon(pin.latitude, pin.longitude)}</span>}
              </p>

              <dl className="wibc-place-heights">
                <div>
                  <dt>Terrain here, 90 m DEM</dt>
                  <dd>
                    {elevJob.kind === 'looking' ? (
                      <span role="status">Looking up…</span>
                    ) : pin.demElevation !== null ? (
                      <>
                        {formatMetres(pin.demElevation)} <span className="wibc-note">({formatFeet(pin.demElevation)})</span>
                      </>
                    ) : elevJob.kind === 'failed' ? (
                      <span className="wibc-trip-warn" role="alert">
                        Unavailable: {elevJob.failure.message} Enter the elevation yourself.
                      </span>
                    ) : (
                      <span className="wibc-note">Not looked up</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    <label htmlFor={`${uid}-elev`}>Forecast for elevation</label>
                  </dt>
                  <dd className="wibc-elev">
                    <input
                      id={`${uid}-elev`}
                      type="number"
                      inputMode="numeric"
                      min={-500}
                      max={9000}
                      step={10}
                      value={elevText}
                      disabled={loading}
                      aria-describedby={`${uid}-elev-help`}
                      onInput={(e) => onElevation((e.currentTarget as HTMLInputElement).value)}
                    />
                    <span>m</span>
                    {pin.elevation !== null && <span className="wibc-note">({formatFeet(pin.elevation)})</span>}
                    {overridden && pin.demElevation !== null && (
                      <button type="button" className="wibc-chip" onClick={() => onElevation(String(Math.round(pin.demElevation ?? 0)))}>
                        Use the DEM height
                      </button>
                    )}
                  </dd>
                </div>
              </dl>
              <p className="wibc-note" id={`${uid}-elev-help`}>
                {overridden && pin.demElevation !== null && pin.elevation !== null
                  ? `${pin.elevation > pin.demElevation ? '+' : ''}${Math.round(pin.elevation - pin.demElevation)} m from the terrain under the pin. `
                  : ''}
                Open-Meteo picks the grid cell whose terrain is nearest this height and corrects the 2 m temperature to it. Leave it at the DEM
                unless you know better; set it to the ridge or the gap you will actually sleep in.
              </p>

              {loaded.lapse !== null && lapseIsForThisPin && (
                <p className="wibc-lapse">
                  <span className="wibc-kicker">What the correction was worth here</span>
                  Open-Meteo&rsquo;s own terrain at this point is <b>{formatMetres(loaded.lapse.modelElevation)}</b>. Asking for{' '}
                  <b>{formatMetres(loaded.lapse.trailElevation)}</b> ({loaded.lapse.trailElevation >= loaded.lapse.modelElevation ? '+' : ''}
                  {Math.round(loaded.lapse.trailElevation - loaded.lapse.modelElevation)} m) moved the forecast temperature by{' '}
                  <b>{signedC(loaded.lapse.meanDeltaC)}</b>{' '}
                  on average over {loaded.lapse.hoursCompared} hours
                  {loaded.source === 'fixture' ? ', in the recording' : ''}. That is the number a town-based forecast gets wrong.
                </p>
              )}
              {(loaded.lapse === null || !lapseIsForThisPin) && (
                <p className="wibc-note">Fetch the forecast to measure what the elevation correction is worth at this point.</p>
              )}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------------ when */}
        <section className="wibc-trip-col" aria-labelledby={`${uid}-when`}>
          <h3 className="wibc-trip-h" id={`${uid}-when`}>
            When
          </h3>
          <div className="wibc-when">
            <label className="wibc-field" htmlFor={`${uid}-start`}>
              <span>First night</span>
              <input
                id={`${uid}-start`}
                type="date"
                value={spec.startDate}
                min={today}
                disabled={loading}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  if (v !== '') onSpec({ ...spec, startDate: v });
                }}
              />
            </label>
            <label className="wibc-field" htmlFor={`${uid}-nights`}>
              <span>Nights</span>
              <input
                id={`${uid}-nights`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_NIGHTS}
                step={1}
                value={spec.nights}
                disabled={loading}
                onInput={(e) => onSpec({ ...spec, nights: clampNights(Number((e.currentTarget as HTMLInputElement).value)) })}
              />
            </label>
          </div>

          <ol className="wibc-horizon" aria-label="How each night will be sourced">
            {dates.map((d, i) => {
              const dec = plan.decisions[i]!;
              // a night needs the next morning too, so the run's last date cannot carry a whole night
              const runsOff = dec.mode === 'forecast' && d === plan.lastForecastDate;
              const mode = dec.reason === 'past' ? 'past' : runsOff ? 'climatology' : dec.mode;
              return (
                <li key={d} data-mode={mode}>
                  <span className="wibc-horizon-date">{formatShortDate(d)}</span>
                  <span className="wibc-horizon-mode">
                    {dec.reason === 'past'
                      ? 'already passed'
                      : runsOff
                        ? 'the run ends that night, so it falls to climatology'
                        : dec.mode === 'forecast'
                          ? `forecast, ${dec.daysOut === 0 ? 'today' : dec.daysOut === 1 ? 'tomorrow' : `${dec.daysOut} days out`}`
                          : 'beyond the 16-day forecast: climatology, labelled as such'}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="wibc-note">
            The hourly forecast runs to {formatLongDate(plan.lastForecastDate)}. A night after that is shown as the ERA5 record of what the date
            usually does at this point, pooled over twenty years and labelled as climatology; a night is never half one and half the other.
            {spec.nights > 1 ? ' The phase tabs pool every night by default, with each night one click away.' : ''}
          </p>

          <div className="wibc-trip-actions">
            <button type="button" className="wibc-button wibc-button-primary" disabled={!canFetch} onClick={props.onFetch} aria-describedby={`${uid}-problem`}>
              {loading ? 'Fetching…' : 'Get the weather for this trip'}
            </button>
            {loading && (
              <button type="button" className="wibc-button" onClick={props.onCancel}>
                Cancel
              </button>
            )}
            {loaded.source === 'live' && !loading && (
              <button type="button" className="wibc-button" onClick={props.onUseFixture}>
                Back to the recorded Smokies trip
              </button>
            )}
          </div>
          <p className="wibc-note wibc-problem" id={`${uid}-problem`}>
            {problem ?? ''}
          </p>

          <JobStatus job={job} loaded={loaded} spec={spec} onRetry={props.onFetch} onUseFixture={props.onUseFixture} onGoToPhase={props.onGoToPhase} />
        </section>
      </div>

      <footer className="wibc-foot wibc-trip-foot">
        <p>
          <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a> · <a href={OPEN_METEO_LICENCE_URL}>CC BY 4.0</a>. Place names from
          Open-Meteo&rsquo;s geocoder (GeoNames); terrain heights from its 90 m elevation model (Copernicus DEM). Keyless and fetched from your
          browser directly; nothing passes through a server of ours.
        </p>
      </footer>
    </section>
  );
}

/** `+1.2 °C`, `−2.4 °C`: a real minus sign, never a hyphen or a dash. */
function signedC(deltaC: number): string {
  const v = deltaC.toFixed(1);
  return v.startsWith('-') ? `\u2212${v.slice(1)} °C` : `+${v} °C`;
}

/** What the phase tabs are showing right now, so the form and the data cannot be confused. */
function OnScreen({ loaded }: { loaded: LoadedTrip }): JSX.Element {
  const days = loaded.weather.days;
  const first = days[0];
  const last = days[days.length - 1];
  const when = first === undefined || last === undefined ? '' : formatDateSpan(first.date, last.date);
  const clim = loaded.nightsBySource.climatology.length;
  return (
    <div className="wibc-onscreen" data-source={loaded.source}>
      <span className="wibc-kicker">On the phase tabs now</span>
      <b>{loaded.weather.location.label ?? 'Unnamed point'}</b>
      <span>
        {when} · {days.length} night{days.length === 1 ? '' : 's'} · {formatMetres(loaded.weather.location.elevation)}
      </span>
      <span className="wibc-onscreen-kind">
        {loaded.source === 'fixture'
          ? 'Recorded forecast, captured 13 Nov 2026, replayed offline'
          : clim === 0
            ? `Live forecast, fetched ${loaded.fetchedAtUtc?.slice(11, 16) ?? ''} UTC`
            : clim === days.length
              ? 'Climatology, not a forecast'
              : `${days.length - clim} night${days.length - clim === 1 ? '' : 's'} forecast, ${clim} climatology`}
      </span>
    </div>
  );
}

function JobStatus({
  job,
  loaded,
  spec,
  onRetry,
  onUseFixture,
  onGoToPhase,
}: {
  job: TripJob;
  loaded: LoadedTrip;
  spec: TripSpec;
  onRetry: () => void;
  onUseFixture: () => void;
  onGoToPhase: (phase: PhaseName) => void;
}): JSX.Element | null {
  const pin = primaryPin(spec);
  if (job.kind === 'loading') {
    return (
      <p className="wibc-job" role="status" aria-live="polite" data-kind="loading">
        {job.step === 'forecast'
          ? `Fetching the 16-day forecast for ${pin?.label ?? 'the point'} at ${pin?.elevation !== null && pin?.elevation !== undefined ? formatMetres(pin.elevation) : 'the given height'}, with and without the elevation correction…`
          : 'Pooling twenty years of ERA5 for the nights beyond the forecast: twenty small requests…'}
      </p>
    );
  }
  if (job.kind === 'failed') {
    const f = job.failure;
    if (f.kind === 'aborted') return null;
    return (
      <div className="wibc-job" role="alert" data-kind={f.kind}>
        <p>
          <b>
            {f.kind === 'offline'
              ? 'No connection.'
              : f.kind === 'rate-limit'
                ? 'Rate-limited.'
                : f.kind === 'past'
                  ? 'Too late for that date.'
                  : f.kind === 'shape'
                    ? 'Unexpected answer.'
                    : 'Could not fetch.'}
          </b>{' '}
          {f.message}
        </p>
        {f.detail !== null && <p className="wibc-note">{f.detail}</p>}
        <p className="wibc-job-actions">
          {f.kind !== 'past' && (
            <button type="button" className="wibc-button" onClick={onRetry}>
              Try again
            </button>
          )}
          {loaded.source === 'live' && (
            <button type="button" className="wibc-button" onClick={onUseFixture}>
              Use the recorded Smokies trip
            </button>
          )}
          {loaded.source === 'fixture' && <span className="wibc-note">The recorded Smokies trip is still on the phase tabs.</span>}
        </p>
      </div>
    );
  }
  if (loaded.source === 'live') {
    return (
      <div className="wibc-job" data-kind="loaded">
        <p>
          <b>Loaded.</b> {loaded.provenance}
        </p>
        <p className="wibc-job-actions">
          <button type="button" className="wibc-button" onClick={() => onGoToPhase('camp_evening')}>
            See the evenings →
          </button>
          <button type="button" className="wibc-button" onClick={() => onGoToPhase('sleep')}>
            See the nights →
          </button>
        </p>
      </div>
    );
  }
  return (
    <p className="wibc-job wibc-note" data-kind="fixture">
      Nothing is fetched until you ask. The phase tabs are running on the recorded Smokies forecast, which needs no network and is the panel&rsquo;s
      fallback whenever a fetch fails.
    </p>
  );
}
