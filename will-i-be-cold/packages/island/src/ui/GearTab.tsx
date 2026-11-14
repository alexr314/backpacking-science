/**
 * The gear tab: what's all your gear?
 *
 * An inventory, not an outfit. Each callout lists everything you own for that part of the
 * body and slot; the picker behind it is a list of checkboxes with no single-choice rule. The
 * engine builds the layering ladder from the whole inventory, so the figure in the middle is a
 * *preview*: it wears one representative configuration (the warmest the engine could build)
 * and, while an owned or offered item is under the pointer or holding focus, that item on top
 * of it. The items the figure has on right now are the bright ones in each callout.
 *
 * A standing figure, split down the middle (inner layers drawn on its left half, outer on its
 * right) with one callout per occupied slot placed around it and joined to its body part by a
 * leader line. Inner callouts stand in a column on the left, outer on the right, so the
 * columns read the same way the figure does. Each sits at the height of its body part. An
 * empty slot folds up into a small "+" chip in the same place (a required slot with nothing
 * in it stays up, flagged); clicking a callout emphasises it and opens the picker as an
 * overlay hung from it, floating over the page, never pushing the other callouts about.
 * Upper-body pickers hang below their callout, lower-body ones stand above it, so none runs
 * off the bottom of the stage.
 *
 * The callouts are ordinary buttons in ordinary document flow, so the whole thing is a list a
 * keyboard or a screen reader walks top to bottom; the picker sits in the DOM right after the
 * button that opens it, so Tab walks into it and Escape (or its ×) walks back out, and focus
 * on a picker option previews it exactly as hover does. The leader lines are drawn afterwards
 * from measured positions and carry no information the buttons do not. The figure's halves
 * are a second route into the same choices; the head and the hands, which have one slot each,
 * are whole targets.
 *
 * This is a studio, not a scene: no sky, no horizon, the data ground throughout.
 */

import type { JSX } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ensembleInsulation } from '@will-i-be-cold/heat';
import { useMeasure } from '../lib/useMeasure.js';
import {
  kitGarments,
  missingRequired,
  owns,
  REGION_LABEL,
  REGIONS,
  REQUIRES_INNER,
  SLOT_GLOSS,
  slotGarments,
  slotsOf,
  wearing,
  type Kit,
  type Outfit,
  type Slot,
  type Region,
} from '../model/kit.js';
import { Figure, POSES, type SlotRef } from './Figure.js';
import { SlotPicker } from './SlotPicker.js';

const slotKey = (s: SlotRef): string => `${s.region}-${s.slot}`;
const sameSlot = (a: SlotRef | null, b: SlotRef): boolean => a !== null && a.region === b.region && a.slot === b.slot;

export interface GearTabProps {
  /** Everything owned. */
  readonly kit: Kit;
  /** What the figure wears when nothing is being previewed: the engine's warmest configuration. */
  readonly outfit: Outfit;
  /** The engine's name for that configuration, or null when it could build none. */
  readonly outfitLabel: string | null;
  readonly selected: SlotRef | null;
  readonly onSelect: (slot: SlotRef | null) => void;
  readonly onToggle: (id: string) => void;
  readonly uid: string;
}

interface Leader {
  readonly key: string;
  readonly d: string;
  readonly ax: number;
  readonly ay: number;
  readonly active: boolean;
  /** A folded slot's leader is drawn faint and dashed. */
  readonly folded: boolean;
}

interface Placement {
  readonly tops: Readonly<Record<string, number>>;
  readonly height: number;
}

/** Minimum air between two stacked callouts. */
const STACK_GAP = 12;
/** How far below the leader's landing line a callout's top sits (the leader meets its name row). */
const LEAD_DROP = 14;
/** Which way a slot's picker opens: lower-body callouts sit near the stage's foot, so theirs open upward. */
const PICKER_SIDE: Readonly<Record<Region, 'below' | 'above'>> = {
  head: 'below',
  torso: 'below',
  hands: 'below',
  legs: 'above',
  feet: 'above',
};

/** Whether a slot earns a callout: something owned, required-and-empty, or currently open. */
function standsUp(kit: Kit, region: Region, slot: Slot, selected: SlotRef | null): boolean {
  if (slotGarments(kit, region, slot).length > 0) return true;
  if (slot === 'inner' && REQUIRES_INNER[region]) return true;
  return sameSlot(selected, { region, slot });
}

export function GearTab(props: GearTabProps): JSX.Element {
  const { kit, outfit, outfitLabel, selected, onSelect, onToggle, uid } = props;
  const [hovered, setHovered] = useState<SlotRef | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stageRef, stageW] = useMeasure<HTMLDivElement>(1100);
  const svgRef = useRef<SVGSVGElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [placement, setPlacement] = useState<Placement>({ tops: {}, height: 0 });
  const pose = POSES.standing;

  // what the figure has on: the hovered item tried on over the representative outfit
  const shown: Outfit = preview === null ? outfit : wearing(outfit, preview);
  const shownGarments = kitGarments(shown);
  const ensemble = ensembleInsulation(shownGarments).clo;
  const sum = shownGarments.reduce((s, g) => s + g.clo, 0);
  const missing = missingRequired(kit);

  /** Close the open picker and put focus back on the callout that opened it. */
  const closePicker = useCallback((): void => {
    if (selected === null) return;
    const key = slotKey(selected);
    onSelect(null);
    setPreview(null);
    itemRefs.current.get(key)?.querySelector('button')?.focus();
  }, [selected, onSelect]);

  // Each column in the order its anchors fall down the figure (hands hang at hip height,
  // above where the legs are pointed at), so stacking never has to cross a leader.
  const byAnchor = (slot: Slot) => (a: Region, b: Region): number => pose.anchors[a][slot][1] - pose.anchors[b][slot][1];
  const columns: Readonly<Record<Slot, SlotRef[]>> = {
    inner: [...REGIONS.filter((r) => slotsOf(r).includes('inner'))].sort(byAnchor('inner')).map((region) => ({ region, slot: 'inner' as const })),
    outer: [...REGIONS].sort(byAnchor('outer')).map((region) => ({ region, slot: 'outer' as const })),
  };

  const describeSlot = (s: SlotRef): string => {
    const items = slotGarments(kit, s.region, s.slot);
    const worn = items.filter((g) => owns(shown, g.id)).map((g) => g.label);
    const what = items.length === 0 ? 'nothing owned' : `you own ${items.map((g) => g.label).join(', ')}`;
    const wearingNow = worn.length === 0 ? '' : `; wearing ${worn.join(', ')}`;
    const slotName = slotsOf(s.region).length === 1 ? '' : `, ${s.slot} (${SLOT_GLOSS[s.slot]})`;
    return `${REGION_LABEL[s.region]}${slotName}: ${what}${wearingNow}. Change what you own.`;
  };

  // Layout, measured after render. Every slot item (a callout or a folded chip) is placed at
  // the height of its anchor on the figure, stacked down only as far as needed to keep them
  // from overlapping; then the leader lines are drawn from each item to its anchor. The
  // measured heights do not depend on the positions, so this settles in one pass.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const svg = svgRef.current;
    if (stage === null || svg === null) return;
    const compute = (): void => {
      const sr = stage.getBoundingClientRect();
      const fr = svg.getBoundingClientRect();
      const scale = fr.width / pose.w;
      const tops: Record<string, number> = {};
      const nextLeaders: Leader[] = [];
      let columnHeight = 0;
      for (const slot of ['inner', 'outer'] as const) {
        let cursor = -Infinity;
        for (const ref of columns[slot]) {
          const el = itemRefs.current.get(slotKey(ref));
          if (el === undefined) continue;
          const [lx, ly] = pose.anchors[ref.region][slot];
          const ax = fr.left - sr.left + lx * scale;
          const ay = fr.top - sr.top + ly * scale;
          const cr = el.getBoundingClientRect();
          const list = el.parentElement?.getBoundingClientRect();
          const listTop = (list?.top ?? sr.top) - sr.top; // the list's own offset within the stage
          const h = cr.height;
          // tops are in list coordinates; the leader's landing line is in stage coordinates
          const top = Math.max(ay - listTop - LEAD_DROP, cursor);
          cursor = top + h + STACK_GAP;
          tops[slotKey(ref)] = top;
          columnHeight = Math.max(columnHeight, top + h);
          const folded = !standsUp(kit, ref.region, ref.slot, selected);
          const by = top + listTop + LEAD_DROP;
          const bx = slot === 'inner' ? cr.right - sr.left : cr.left - sr.left;
          const elbow = slot === 'inner' ? bx + 22 : bx - 22;
          nextLeaders.push({
            key: slotKey(ref),
            d: `M ${bx.toFixed(1)} ${by.toFixed(1)} L ${elbow.toFixed(1)} ${by.toFixed(1)} L ${ax.toFixed(1)} ${ay.toFixed(1)}`,
            ax,
            ay,
            active: sameSlot(selected, ref) || sameSlot(hovered, ref),
            folded,
          });
        }
      }
      setPlacement((prev) => {
        const next = { tops, height: Math.ceil(columnHeight) };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      setLeaders((prev) => (JSON.stringify(prev) === JSON.stringify(nextLeaders) ? prev : nextLeaders));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(stage);
    for (const el of itemRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  });

  const figW = Math.max(220, Math.min(340, stageW * 0.3));
  const figH = (figW * pose.h) / pose.w;

  const renderColumn = (slot: Slot): JSX.Element => (
    <div className={`wibc-callouts wibc-callouts-${slot}`}>
      <p className="wibc-kicker wibc-callouts-title">
        {slot} <span>· {SLOT_GLOSS[slot]}</span>
      </p>
      <ul className="wibc-callout-list" style={{ height: `${Math.max(figH, placement.height)}px` }}>
        {columns[slot].map((s) => {
          const key = slotKey(s);
          const items = slotGarments(kit, s.region, s.slot);
          const open = sameSlot(selected, s);
          const up = standsUp(kit, s.region, s.slot, selected);
          const needs = items.length === 0 && s.slot === 'inner' && REQUIRES_INNER[s.region];
          const pickerId = `${uid}-pick-${key}`;
          const top = placement.tops[key];
          const setRef = (el: HTMLLIElement | null): void => {
            if (el === null) itemRefs.current.delete(key);
            else itemRefs.current.set(key, el);
          };
          const hoverProps = {
            onMouseEnter: () => setHovered(s),
            onMouseLeave: () => setHovered(null),
            onFocus: () => setHovered(s),
            onBlur: () => setHovered(null),
          };
          if (!up) {
            // folded: the slot shrinks to a chip at the same height, which is the way back in
            return (
              <li key={key} ref={setRef} className="wibc-callout wibc-callout-folded" style={{ top: top === undefined ? 0 : `${top}px` }}>
                <button
                  type="button"
                  className="wibc-fold"
                  onClick={() => onSelect(s)}
                  aria-label={`${REGION_LABEL[s.region]}, ${s.slot}: nothing owned. Add something.`}
                  {...hoverProps}
                >
                  <span aria-hidden="true">+</span> {REGION_LABEL[s.region].toLowerCase()}
                </button>
              </li>
            );
          }
          return (
            <li
              key={key}
              ref={setRef}
              className="wibc-callout"
              data-open={open}
              data-hover={sameSlot(hovered, s)}
              data-picker={PICKER_SIDE[s.region]}
              style={{ top: top === undefined ? 0 : `${top}px` }}
            >
              <button
                type="button"
                className="wibc-callout-btn"
                aria-expanded={open}
                aria-controls={open ? pickerId : undefined}
                aria-label={describeSlot(s)}
                onClick={() => onSelect(open ? null : s)}
                {...hoverProps}
              >
                <span className="wibc-callout-name">
                  <span className="wibc-callout-region">
                    {REGION_LABEL[s.region]}
                    {slotsOf(s.region).length > 1 && <span className="wibc-callout-slot"> · {s.slot}</span>}
                  </span>
                  <span className="wibc-callout-clo">
                    {items.length === 0 ? '' : items.length === 1 ? '1 item' : `${items.length} items`}
                  </span>
                </span>
              </button>
              {/* the inventory for this slot; the bright ones are on the figure now, hover any to try it on */}
              {needs ? (
                <p className="wibc-callout-items">
                  <span className="wibc-need">nothing yet: pick one</span>
                </p>
              ) : (
                <ul className="wibc-callout-items" aria-label={`${REGION_LABEL[s.region]} ${s.slot}: owned`} onMouseLeave={() => setPreview(null)}>
                  {items.map((g) => {
                    const worn = owns(shown, g.id);
                    return (
                      <li key={g.id} className="wibc-callout-item" data-worn={worn} onMouseEnter={() => setPreview(g.id)}>
                        <span className="wibc-callout-item-name">{g.label}</span>
                        <span className="wibc-callout-item-clo">{g.clo.toFixed(2)}</span>
                        <span className="wibc-sr-only">{worn ? ', on the figure' : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {open && (
                <SlotPicker
                  kit={kit}
                  region={s.region}
                  slot={s.slot}
                  id={pickerId}
                  onToggle={onToggle}
                  onPreview={setPreview}
                  onDone={closePicker}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const previewName = preview === null ? null : shownGarments.find((g) => g.id === preview)?.label ?? null;

  return (
    <section className="wibc-gear" aria-labelledby={`${uid}-gear-title`}>
      <header className="wibc-gear-head">
        <div>
          <p className="wibc-kicker">Gear</p>
          <h2 className="wibc-gear-title" id={`${uid}-gear-title`}>
            What&rsquo;s all your gear?
          </h2>
          <p className="wibc-gear-lede">
            Click a part of the figure and pick what you&rsquo;ll pack.
            {missing.length > 0 && (
              <>
                {' '}
                <span className="wibc-need">
                  {missing.map((r) => REGION_LABEL[r]).join(' and ')} {missing.length === 1 ? 'has' : 'have'} nothing next to the skin
                  yet.
                </span>
              </>
            )}
          </p>
        </div>
        <p className="wibc-gear-sum">
          <span className="wibc-gear-sum-value">{ensemble.toFixed(2)} clo</span>
          <span className="wibc-gear-sum-label">
            {previewName === null ? (outfitLabel === null ? 'nothing to wear yet' : 'the warmest outfit in it') : `with ${previewName.toLowerCase()}`}
            <button type="button" className="wibc-info" aria-label="How this number is worked out" aria-describedby={`${uid}-gear-info`}>
              <span aria-hidden="true">i</span>
            </button>
            <span role="tooltip" id={`${uid}-gear-info`} className="wibc-info-tip">
              Worn together these add up to {sum.toFixed(2)} clo. Layers compress each other, and ISO 9920 Eq. (11) charges for
              that, so as an ensemble they are worth {ensemble.toFixed(2)} clo. That is the figure the thermometer uses.
            </span>
          </span>
        </p>
      </header>

      <div className="wibc-gear-stage" ref={stageRef}>
        {renderColumn('inner')}

        <div className="wibc-gear-figure" style={{ width: `${figW}px` }}>
          <svg
            ref={svgRef}
            width={figW}
            height={figH}
            viewBox={`0 0 ${pose.w} ${pose.h}`}
            className="wibc-gear-figure-svg"
            aria-label={`The character, standing, wearing ${
              previewName === null ? (outfitLabel ?? 'nothing') : `${outfitLabel ?? 'nothing'} with ${previewName}`
            }. Split down the middle below the neck: inner layers on the left half, outer layers on the right. Each half of each body part is a button that opens that slot's picker; the head and the hands are one button each.`}
          >
            <defs>
              <radialGradient id={`${uid}-studio-pool`} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stop-color="#1a1430" stop-opacity="0.9" />
                <stop offset="0.6" stop-color="#121226" stop-opacity="0.5" />
                <stop offset="1" stop-color="#0b0f18" stop-opacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx={pose.w / 2} cy={pose.h * 0.52} rx={pose.w * 0.6} ry={pose.h * 0.52} fill={`url(#${uid}-studio-pool)`} />
            <Figure
              kit={shown}
              pose="standing"
              view="split"
              selected={selected}
              hovered={hovered}
              onSelectSlot={(s) => onSelect(sameSlot(selected, s) ? null : s)}
              onHoverSlot={setHovered}
              describeSlot={describeSlot}
              lit={false}
              uid={`${uid}-gear`}
            />
          </svg>
          {/* the divide, named where it lands: a bracket under each half */}
          <div className="wibc-gear-bracket" aria-hidden="true">
            <span>
              <b>inner</b>
              {SLOT_GLOSS.inner}
            </span>
            <span>
              <b>outer</b>
              {SLOT_GLOSS.outer}
            </span>
          </div>
          <p className="wibc-gear-wearing" role="status">
            {previewName === null ? (
              <>
                <span className="wibc-scene-chip-kicker">wearing</span> {outfitLabel ?? 'nothing yet'}
              </>
            ) : (
              <>
                <span className="wibc-scene-chip-kicker">trying on</span> {previewName}
              </>
            )}
          </p>
        </div>

        {renderColumn('outer')}

        <svg className="wibc-leaders" aria-hidden="true">
          {leaders.map((l) => (
            <g key={l.key} data-active={l.active} data-folded={l.folded}>
              <path d={l.d} fill="none" stroke="var(--surface)" stroke-width="4" stroke-linejoin="round" />
              <path d={l.d} fill="none" className="wibc-leader" stroke-linejoin="round" />
              <circle cx={l.ax} cy={l.ay} r="4.5" fill="var(--surface)" />
              <circle cx={l.ax} cy={l.ay} r="3" className="wibc-leader-dot" />
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
