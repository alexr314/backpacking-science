/**
 * Place-name search: a combobox over the Open-Meteo geocoder.
 *
 * Type, and after a short pause the ranked candidates appear in a listbox under the field,
 * each disambiguated the way the geocoder labels it ("Gatlinburg, Tennessee, United States"),
 * with what kind of place it is and the height GeoNames has for it. Arrow keys walk the list,
 * Enter picks, Escape closes; the pointer does the same. The status line under the field is
 * the honest one: how many places matched, that nothing did, or that the geocoder could not
 * be reached. Nothing spins without resolving.
 *
 * Picking a candidate hands back the raw `GeocodeResult`; the caller decides what to do with
 * its height (it looks up the 90 m DEM at the point rather than trusting the town's).
 */

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GeocodeResult } from '@will-i-be-cold/weather';
import { classifyFailure, formatMetres, type TripFailure } from '../model/trip.js';

export interface PlaceSearchProps {
  readonly onSearch: (name: string) => Promise<GeocodeResult[]>;
  readonly onPick: (result: GeocodeResult) => void;
  readonly uid: string;
  readonly disabled?: boolean;
}

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'results'; readonly results: readonly GeocodeResult[]; readonly query: string }
  | { readonly kind: 'failed'; readonly failure: TripFailure };

/** GeoNames feature codes, the handful a hiker meets, in words. Anything else shows its code. */
const FEATURE_WORDS: Readonly<Record<string, string>> = {
  PPL: 'town',
  PPLA: 'city',
  PPLA2: 'city',
  PPLA3: 'town',
  PPLA4: 'town',
  PPLC: 'capital',
  PPLL: 'locality',
  PPLX: 'district',
  MT: 'mountain',
  MTS: 'mountains',
  PK: 'peak',
  PASS: 'pass',
  GAP: 'gap',
  RDGE: 'ridge',
  VAL: 'valley',
  LK: 'lake',
  PRK: 'park',
  RESN: 'reserve',
  CMP: 'camp',
  TRL: 'trail',
  HUT: 'hut',
  SHEL: 'shelter',
  FRST: 'forest',
  AREA: 'area',
  AIRP: 'airport',
  RSTN: 'station',
  STM: 'stream',
  SPNG: 'spring',
  CLF: 'cliff',
  ISL: 'island',
  BCH: 'beach',
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;

export function PlaceSearch({ onSearch, onPick, uid, disabled = false }: PlaceSearchProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  /** The label written back into the field on pick, which must not be searched for again. */
  const picked = useRef<string | null>(null);
  const listId = `${uid}-places`;
  const statusId = `${uid}-places-status`;

  // debounce the geocoder; a later keystroke retires an earlier answer
  useEffect(() => {
    const name = query.trim();
    if (picked.current !== null && name === picked.current.trim()) return;
    picked.current = null;
    if (name.length < MIN_CHARS) {
      setState({ kind: 'idle' });
      setOpen(false);
      return;
    }
    const mine = ++generation.current;
    const handle = setTimeout(() => {
      setState({ kind: 'searching' });
      onSearch(name)
        .then((results) => {
          if (generation.current !== mine) return;
          setState({ kind: 'results', results, query: name });
          setOpen(true);
          setActive(results.length > 0 ? 0 : -1);
        })
        .catch((e: unknown) => {
          if (generation.current !== mine) return;
          setState({ kind: 'failed', failure: classifyFailure(e) });
          setOpen(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, onSearch]);

  const results = state.kind === 'results' ? state.results : [];
  const showList = open && results.length > 0;

  const pick = (r: GeocodeResult): void => {
    onPick(r);
    picked.current = r.label;
    generation.current += 1; // retire any answer still in flight
    setQuery(r.label);
    setOpen(false);
    setState({ kind: 'idle' });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && showList && active >= 0) {
      e.preventDefault();
      const r = results[active];
      if (r !== undefined) pick(r);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const status = ((): string => {
    switch (state.kind) {
      case 'idle':
        return query.trim().length > 0 && query.trim().length < MIN_CHARS ? 'Keep typing.' : '';
      case 'searching':
        return 'Searching…';
      case 'results':
        return state.results.length === 0
          ? `No place called "${state.query}" in the geocoder. Try a nearby town, or drop a pin instead.`
          : `${state.results.length} place${state.results.length === 1 ? '' : 's'}. Arrow keys, then Enter.`;
      case 'failed':
        return state.failure.message;
    }
  })();

  return (
    <div className="wibc-search">
      <label className="wibc-field" htmlFor={`${uid}-place`}>
        <span>Search a place</span>
        <input
          ref={inputRef}
          id={`${uid}-place`}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={statusId}
          autoComplete="off"
          spellcheck={false}
          placeholder="Gatlinburg, Clingmans Dome, Newfound Gap…"
          value={query}
          disabled={disabled}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          onBlur={() => {
            // let a click on an option land first
            setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKey}
        />
      </label>
      <ul id={listId} role="listbox" aria-label="Matching places" className="wibc-search-list" hidden={!showList}>
        {results.map((r, i) => (
          <li
            key={r.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="wibc-search-opt"
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(r);
            }}
          >
            <span className="wibc-search-name">{r.name}</span>
            <span className="wibc-search-where">{[r.admin1, r.country].filter((x): x is string => x !== null).join(', ')}</span>
            <span className="wibc-search-meta">
              {r.featureCode !== null ? FEATURE_WORDS[r.featureCode] ?? r.featureCode.toLowerCase() : 'place'}
              {r.elevation !== null ? ` · ${formatMetres(r.elevation)}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <p id={statusId} className="wibc-note wibc-search-status" role="status" aria-live="polite" data-kind={state.kind}>
        {status}
      </p>
    </div>
  );
}
