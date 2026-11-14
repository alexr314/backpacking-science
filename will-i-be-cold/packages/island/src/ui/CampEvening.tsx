/**
 * The panel bound to its data. This is the component an Astro island mounts.
 *
 * It starts on the recorded Smokies fixture, which needs no network, and owns the one piece
 * of I/O in the island: when the trip tab asks, it fetches a live trip through the weather
 * package's clients (`data/live.ts`) and swaps it in. A failed fetch leaves whatever was on
 * screen there and reports itself on the trip tab; a cancelled one is forgotten.
 */

import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createFetchJson, type LocalDate } from '@will-i-be-cold/weather';
import { fixtureTrip } from '../data/fixture.js';
import { classifyFailure, loadLiveTrip, placeFromPin, placeFromResult, searchPlaces, withDemElevation } from '../data/live.js';
import { FIXTURE_PLACE, FIXTURE_SPEC, PANEL_DATE } from '../data/trip.js';
import { WillIBeColdPanel } from './Panel.js';
import type { PlaceService, TripJob } from './TripSetup.js';
import type { Unit } from '../lib/units.js';
import type { TabId } from '../model/tabs.js';
import { localToday, type LoadedTrip, type TripSpec } from '../model/trip.js';

export interface WillIBeColdProps {
  /** First night of the recorded trip to start on. Defaults to the fixture's pinned panel date. */
  readonly date?: LocalDate;
  /** How many nights of the recording to start on. Defaults to three. */
  readonly nights?: number;
  readonly unit?: Unit;
  /** Which tab to open on. Defaults to the gear tab. */
  readonly tab?: TabId;
  /** Where "See our methodology" goes. */
  readonly methodologyHref?: string;
}

export function WillIBeCold({ date = PANEL_DATE, nights = FIXTURE_SPEC.nights, unit = 'F', tab = 'gear', methodologyHref }: WillIBeColdProps): JSX.Element {
  const fixtureSpec = useMemo<TripSpec>(() => ({ pins: [FIXTURE_PLACE], startDate: date, nights }), [date, nights]);
  const [loaded, setLoaded] = useState<LoadedTrip>(() => fixtureTrip(fixtureSpec));
  const [today, setToday] = useState<LocalDate>(() => localToday());
  // the form starts as the recording's trip, except that a recording ages: a start date now past moves to today
  const [spec, setSpec] = useState<TripSpec>(() => ({ ...fixtureSpec, startDate: fixtureSpec.startDate < localToday() ? localToday() : fixtureSpec.startDate }));
  const [job, setJob] = useState<TripJob>({ kind: 'idle' });
  const inFlight = useRef<AbortController | null>(null);

  // midnight passes while the tab is open
  useEffect(() => {
    const tick = setInterval(() => setToday(localToday()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // one fetcher for the small lookups; each trip load gets its own, so it can be cancelled alone
  const lookups = useMemo(() => createFetchJson(), []);
  const places = useMemo<PlaceService>(
    () => ({
      search: (name) => searchPlaces(name, lookups),
      fromResult: placeFromResult,
      fromPin: placeFromPin,
      resolve: (place) => withDemElevation(place, lookups),
    }),
    [lookups],
  );

  const onCancel = useCallback((): void => {
    inFlight.current?.abort();
    inFlight.current = null;
    setJob({ kind: 'idle' });
  }, []);

  const onFetch = useCallback((): void => {
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;
    setJob({ kind: 'loading', step: 'forecast' });
    loadLiveTrip(spec, {
      fetchJson: createFetchJson({ signal: ctl.signal }),
      signal: ctl.signal,
      onStep: (step) => {
        if (!ctl.signal.aborted) setJob({ kind: 'loading', step });
      },
    })
      .then((trip) => {
        if (ctl.signal.aborted) return;
        inFlight.current = null;
        setLoaded(trip);
        setJob({ kind: 'idle' });
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        inFlight.current = null;
        setJob({ kind: 'failed', failure: classifyFailure(e) });
      });
  }, [spec]);

  const onUseFixture = useCallback((): void => {
    inFlight.current?.abort();
    inFlight.current = null;
    setLoaded(fixtureTrip(fixtureSpec));
    setJob({ kind: 'idle' });
  }, [fixtureSpec]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return (
    <WillIBeColdPanel
      loaded={loaded}
      spec={spec}
      onSpec={setSpec}
      job={job}
      onFetch={onFetch}
      onCancel={onCancel}
      onUseFixture={onUseFixture}
      today={today}
      places={places}
      initialUnit={unit}
      initialTab={tab}
      {...(methodologyHref !== undefined ? { methodologyHref } : {})}
    />
  );
}

/** @deprecated The panel is no longer one phase; use `WillIBeCold`. Kept so existing mounts keep working. */
export const CampEvening = WillIBeCold;
export type CampEveningProps = WillIBeColdProps;
