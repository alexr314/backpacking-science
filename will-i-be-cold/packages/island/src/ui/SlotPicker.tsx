/**
 * The picker for one slot, floated over the page from its callout.
 *
 * It is an overlay, not a block in the flow: opening it must never move the other callouts.
 * The callout's `li` positions it (below for the upper body, above for the lower body, so it
 * never runs off the bottom of the stage); this component only draws the box. A long list
 * scrolls inside the box rather than growing it. Escape and the × in the corner close it,
 * and so does clicking anywhere outside it; all three hand focus back to the callout.
 *
 * Every option is a checkbox, because this is an inventory: tick what you own, as many as you
 * like. Which of them get worn together is the engine's decision, not a rule here. Hovering
 * or focusing an option previews it on the figure (`onPreview`), so the picker is the
 * keyboard route to the preview as well as the pointer one.
 *
 * THE SEARCH SEAM. The list rendered here is exactly what `catalogueFor(region, slot)`
 * returns. The roadmap's "type what you want" is a filter on that list (and later on a brand
 * database) that hands this component the same `readonly Garment[]`; the picker itself does
 * not change. Nothing of that is built here.
 */

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { catalogueFor, owns, REGION_LABEL, type Kit, type Region, type Slot } from '../model/kit.js';

function Est({ provenance }: { provenance: string }): JSX.Element | null {
  if (provenance === 'estimated')
    return (
      <abbr className="wibc-est" title="Estimated, not measured: ISO 9920 Annex A was never obtained">
        est
      </abbr>
    );
  if (provenance === 'ashrae')
    return (
      <abbr className="wibc-est" title="ASHRAE 55 / ISO 7730 Annex C published garment table">
        ISO
      </abbr>
    );
  return null;
}

export interface SlotPickerProps {
  readonly kit: Kit;
  readonly region: Region;
  readonly slot: Slot;
  readonly id: string;
  readonly onToggle: (id: string) => void;
  /** The option under the pointer or holding focus, for the figure to try on. `null` to clear. */
  readonly onPreview: (id: string | null) => void;
  /** Close, returning focus to whatever opened it. Fired by ×, Escape and clicking outside. */
  readonly onDone: () => void;
}

export function SlotPicker({ kit, region, slot, id, onToggle, onPreview, onDone }: SlotPickerProps): JSX.Element {
  const options = catalogueFor(region, slot);
  const boxRef = useRef<HTMLDivElement>(null);

  // Escape closes from anywhere on the page; a pointer landing outside the picker *and*
  // outside its own callout closes it too (the callout's button toggles it itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onDone();
    };
    const onPointer = (e: PointerEvent): void => {
      const box = boxRef.current;
      const target = e.target;
      if (box === null || !(target instanceof Node)) return;
      const callout = box.closest('.wibc-callout');
      if ((callout ?? box).contains(target)) return;
      // the figure's halves toggle the same slot; let them do their own thing
      if (target instanceof Element && target.closest('.wibc-gear-figure-svg') !== null) return;
      onDone();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onDone]);

  const legend = slot === 'inner' ? 'Tick everything you own; one is worn at a time' : 'Tick everything you own';

  return (
    <div className="wibc-picker" id={id} ref={boxRef} role="group" aria-label={`${REGION_LABEL[region]}, ${slot}: what you own`}>
      <div className="wibc-picker-head">
        <span className="wibc-picker-legend">{legend}</span>
        <button type="button" className="wibc-picker-close" onClick={onDone} aria-label="Close the picker">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="wibc-picker-list" onMouseLeave={() => onPreview(null)}>
        <fieldset className="wibc-pick-group">
          <legend className="wibc-sr-only">{legend}</legend>
          {options.map((g) => {
            const on = owns(kit, g.id);
            return (
              <label
                key={g.id}
                className="wibc-opt"
                data-owned={on}
                onMouseEnter={() => onPreview(g.id)}
                onFocusCapture={() => onPreview(g.id)}
                onBlurCapture={() => onPreview(null)}
              >
                <input type="checkbox" checked={on} onChange={() => onToggle(g.id)} />
                <span>
                  {g.label}
                  <Est provenance={g.provenance} />
                  {g.isShell === true && <span className="wibc-est">shell</span>}
                  {g.isPuffy === true && <span className="wibc-est">loft</span>}
                </span>
                <span className="wibc-opt-clo">{g.clo.toFixed(2)}</span>
              </label>
            );
          })}
        </fieldset>
      </div>
    </div>
  );
}
