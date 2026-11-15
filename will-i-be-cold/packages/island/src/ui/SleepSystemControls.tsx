/**
 * The bag and the pads, on the sleep tab: the one place the sleep system lives, so this is
 * where it is set, with the two-floor diagram and the pad delta moving as you type.
 *
 * TWO ROWS, BECAUSE THERE ARE TWO FLOORS. Everything on one line read as a jumble of fields
 * with no telling which belonged to what. The system is already two independent paths in the
 * engine (`solveSleepSystem` splits over and under), so the controls say so: what is over you
 * on one line, what is under you on the next. The pads also needed a way to say there are none,
 * which the stack could reach only by deleting its last row and never offered in words.
 *
 * Three facts about the bag and one list for the pads, all of them `solveSleepSystem()`'s
 * own inputs (`BagSpec`, `PadSpec`): bag or quilt; the number on the label; and **which
 * temperature that number is**. US brands print the limit, EU brands the comfort, and the
 * engine refuses to guess (`BagSpec.ratingType` is required), so the control offers the two
 * and nothing else. A quilt adds the provenance its label correction depends on. Pads are a
 * stack: each has its hangtag R, and another can be laid on top; the engine sums them and
 * says in its caveats that nobody has measured a stacked pair.
 *
 * The rating is typed in the display unit and stored in °C through the engine's own
 * conversion; the field keeps a draft while you type so "-" and "20." are not snapped away.
 * Every control is a native input or button with a label, so the keyboard and a screen
 * reader get the same thing the pointer does.
 */

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { fahrenheitToCelsius, type LabelRatingType, type QuiltProvenance, type SleepGear } from '@will-i-be-cold/heat';
import { toUnit, UNIT_SYMBOL, type Unit } from '../lib/units.js';
import { QUILT_PROVENANCE_OPTIONS, RATING_TYPE_OPTIONS } from '../model/panel.js';

/**
 * What people actually carry, as starting points rather than as a catalogue. An inflatable
 * three-season mat is around R 4; a closed-cell foam mat is around R 2, and is the thing most
 * often stacked under one. Both are editable the moment they are added: the number on the
 * hangtag is the one that counts.
 */
const INFLATABLE_PAD = { imperialR: 4.2, label: 'inflatable pad' };
const FOAM_PAD = { imperialR: 2, label: 'foam pad' };

export interface SleepSystemControlsProps {
  readonly gear: SleepGear;
  readonly onChange: (gear: SleepGear) => void;
  readonly unit: Unit;
  readonly uid: string;
}

export function SleepSystemControls({ gear, onChange, unit, uid }: SleepSystemControlsProps): JSX.Element {
  const bag = gear.bag;
  const setBag = (patch: Partial<SleepGear['bag']>): void => onChange({ ...gear, bag: { ...bag, ...patch } });
  const setPad = (i: number, imperialR: number): void =>
    onChange({ ...gear, pads: gear.pads.map((p, j) => (j === i ? { ...p, imperialR } : p)) });
  const removePad = (i: number): void => onChange({ ...gear, pads: gear.pads.filter((_, j) => j !== i) });
  const addPad = (preset: { readonly imperialR: number; readonly label: string }): void =>
    onChange({ ...gear, pads: [...gear.pads, { ...preset }] });
  const ratingHint = RATING_TYPE_OPTIONS.find((o) => o.value === bag.ratingType)?.hint ?? '';

  return (
    <div className="wibc-sleep-rows" role="group" aria-label="Your sleep system">
      <div className="wibc-controls wibc-sleep-controls" role="group" aria-label="Over you">
      <span className="wibc-controls-label">Over you</span>

      <span className="wibc-control">
        <span className="wibc-seg wibc-seg-small" role="group" aria-label="Bag or quilt">
          {(['bag', 'quilt'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={bag.kind === kind}
              onClick={() => setBag(kind === 'quilt' ? { kind, quiltProvenance: bag.quiltProvenance ?? 'none' } : { kind })}
            >
              {kind === 'bag' ? 'Bag' : 'Quilt'}
            </button>
          ))}
        </span>
      </span>

      <label className="wibc-control" htmlFor={`${uid}-bag-rating`}>
        <span>Rated</span>
        <NumberField
          id={`${uid}-bag-rating`}
          value={toUnit(bag.ratingC, unit)}
          digits={unit === 'F' ? 0 : 1}
          step={1}
          width="6.5ch"
          ariaLabel={`Rating on the label, ${UNIT_SYMBOL[unit]}`}
          onCommit={(v) => setBag({ ratingC: unit === 'F' ? fahrenheitToCelsius(v) : v })}
        />
        <span className="wibc-control-unit" aria-hidden="true">
          {UNIT_SYMBOL[unit]}
        </span>
      </label>

      <label className="wibc-control" htmlFor={`${uid}-bag-type`} title={ratingHint}>
        <span>Which is</span>
        <select
          id={`${uid}-bag-type`}
          value={bag.ratingType}
          aria-describedby={`${uid}-bag-type-hint`}
          onChange={(e) => setBag({ ratingType: (e.currentTarget as HTMLSelectElement).value as LabelRatingType })}
        >
          {RATING_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="wibc-sr-only" id={`${uid}-bag-type-hint`}>
          {ratingHint} Required: the two labels differ by about six kelvin for the same bag, so it is never inferred.
        </span>
      </label>

      {bag.kind === 'quilt' && (
        <label className="wibc-control" htmlFor={`${uid}-quilt-from`}>
          <span>Label from</span>
          <select
            id={`${uid}-quilt-from`}
            value={bag.quiltProvenance ?? 'none'}
            onChange={(e) => setBag({ quiltProvenance: (e.currentTarget as HTMLSelectElement).value as QuiltProvenance })}
          >
            {QUILT_PROVENANCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      </div>

      <div className="wibc-controls wibc-sleep-controls" role="group" aria-label="Under you">
      <span className="wibc-controls-label">Under you</span>

      <span className="wibc-control wibc-pads" role="group" aria-label="Pads under you, R-values; stacked pads add">
        <span>{gear.pads.length === 1 ? 'Pad' : gear.pads.length === 0 ? 'Nothing under you' : 'Stacked'}</span>
        {gear.pads.map((pad, i) => (
          <span key={i} className="wibc-pad">
            <span className="wibc-pad-r" aria-hidden="true">
              R
            </span>
            <NumberField
              id={`${uid}-pad-${i}`}
              value={pad.imperialR}
              digits={1}
              step={0.1}
              min={0}
              width="6ch"
              ariaLabel={`Pad ${i + 1} R-value`}
              onCommit={(v) => setPad(i, v)}
            />
            <button type="button" className="wibc-pad-remove" onClick={() => removePad(i)} aria-label={`Remove pad ${i + 1}`}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        <button type="button" className="wibc-toggle wibc-pad-add" onClick={() => addPad(INFLATABLE_PAD)}>
          Inflatable pad
        </button>
        <button type="button" className="wibc-toggle wibc-pad-add" onClick={() => addPad(FOAM_PAD)}>
          Foam pad
        </button>
        {/* the engine is happy with an empty stack; until now you could only get there by deleting rows */}
        <button
          type="button"
          className="wibc-toggle"
          aria-pressed={gear.pads.length === 0}
          onClick={() => onChange({ ...gear, pads: [] })}
        >
          I don&rsquo;t have one
        </button>
      </span>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  readonly id: string;
  readonly value: number;
  readonly digits: number;
  readonly step: number;
  readonly min?: number;
  readonly width: string;
  readonly ariaLabel: string;
  readonly onCommit: (value: number) => void;
}

/**
 * A number input that commits every parsable value as it is typed and keeps the draft text
 * otherwise, so a half-typed "-" or "20." is not snapped back. When the committed value
 * changes from outside (the unit toggle), the draft follows.
 */
function NumberField({ id, value, digits, step, min, width, ariaLabel, onCommit }: NumberFieldProps): JSX.Element {
  const shown = value.toFixed(digits);
  const [draft, setDraft] = useState(shown);
  const parsed = Number.parseFloat(draft);
  const inSync = Number.isFinite(parsed) && parsed.toFixed(digits) === shown;
  useEffect(() => {
    if (!inSync) setDraft(shown);
    // only an external change (the unit toggle) resyncs; the user's own commits already agree
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const invalid = !Number.isFinite(parsed) || (min !== undefined && parsed < min);
  return (
    <input
      id={id}
      className="wibc-num"
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={draft}
      style={{ width }}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      onInput={(e) => {
        const text = (e.currentTarget as HTMLInputElement).value;
        setDraft(text);
        const v = Number.parseFloat(text);
        if (Number.isFinite(v) && (min === undefined || v >= min)) onCommit(v);
      }}
      onBlur={() => {
        if (invalid) setDraft(shown);
      }}
    />
  );
}
