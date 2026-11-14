/**
 * The inventory: everything the user owns, per body region and slot, with no single-choice
 * constraint. Two tees and a merino base layer can all be owned at once. The engine's
 * `coverage()` takes the whole inventory and builds the layering ladder itself, so nothing
 * here decides what gets worn; `kitGarments()` simply hands all of it over.
 *
 * The same shape also describes an *outfit*: one configuration the engine built, expressed as
 * a `Kit` so the figure can wear it (`kitFromGarments`). An outfit has at most one inner
 * garment per region; an inventory may have many. The type is shared on purpose, because the
 * figure, the callouts and the engine all speak in flat garment lists anyway.
 *
 * Layer *order* is a drawing concern only (`layerRank`): the engine sums `I_clu` through ISO
 * 9920 Eq. (11) and is indifferent to it. "A shell draws outermost" is a UI invariant.
 */

import { GARMENTS, type BodyRegion, type Garment } from '@will-i-be-cold/heat';

export const REGIONS = ['head', 'torso', 'legs', 'hands', 'feet'] as const;
export type Region = (typeof REGIONS)[number];

export const SLOTS = ['inner', 'outer'] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABEL: Readonly<Record<Slot, string>> = { inner: 'inner', outer: 'outer' };
export const SLOT_GLOSS: Readonly<Record<Slot, string>> = { inner: 'next to skin', outer: 'layered on top' };

/**
 * Which slots a region offers. The head has no inner slot (`SPEC.md` §4), and neither do the
 * hands on this panel: liner gloves are an ordinary hands item, and whether they combine with
 * other gloves is the engine's call.
 */
export function slotsOf(region: Region): readonly Slot[] {
  return region === 'head' || region === 'hands' ? ['outer'] : SLOTS;
}

/**
 * Where a garment is kept on this panel. Normally the catalogue's own slot; a garment whose
 * catalogue slot the region does not offer here (liner gloves, while the catalogue still files
 * them as a hands inner) goes to the region's one slot instead.
 */
export function slotFor(g: Garment): Slot {
  const region: Region = g.region;
  return slotsOf(region).includes(g.slot) ? g.slot : 'outer';
}

export interface RegionKit {
  /** Owned next-to-skin garments; an outfit wears at most one of them. */
  readonly inner: readonly string[];
  /** Owned layers that go on top; drawn skin-outwards, shell last. */
  readonly outer: readonly string[];
}

export type Kit = Readonly<Record<Region, RegionKit>>;

/** A `Kit` read as one configuration the figure wears, rather than as everything owned. */
export type Outfit = Kit;

export const REGION_LABEL: Readonly<Record<Region, string>> = {
  head: 'Head',
  torso: 'Torso',
  legs: 'Legs',
  hands: 'Hands',
  feet: 'Feet',
};

/** `SPEC.md` §4 marks torso, legs and feet as required: the ladder has nothing to start from without them. */
export const REQUIRES_INNER: Readonly<Record<Region, boolean>> = {
  head: false,
  torso: true,
  legs: true,
  hands: false,
  feet: true,
};

const BY_ID = new Map(GARMENTS.map((g) => [g.id, g]));

export function garmentById(id: string): Garment {
  const g = BY_ID.get(id);
  if (g === undefined) throw new Error(`Unknown garment id "${id}".`);
  return g;
}

/**
 * The options a picker offers for one slot. This is the seam for the roadmap's "type what
 * you want": a future free-text search filters *this* list (and later a brand database) and
 * hands the picker the same `readonly Garment[]`; nothing downstream needs to change.
 */
export function catalogueFor(region: Region, slot: Slot): readonly Garment[] {
  return GARMENTS.filter((g) => g.region === (region as BodyRegion) && slotFor(g) === slot);
}

/** What is in one slot right now, as garments. */
export function slotGarments(kit: Kit, region: Region, slot: Slot): Garment[] {
  return kit[region][slot].map(garmentById);
}

export const EMPTY_KIT: Kit = {
  head: { inner: [], outer: [] },
  torso: { inner: [], outer: [] },
  legs: { inner: [], outer: [] },
  hands: { inner: [], outer: [] },
  feet: { inner: [], outer: [] },
};

/**
 * Where a garment sits in the stack, skin outwards, for drawing. The ordering is
 * `SPEC.md` §4's: mid-layers, then insulation, then the shell, which is always outermost.
 */
export function layerRank(g: Garment): number {
  if (g.isShell === true) return 2;
  if (g.isPuffy === true) return 1;
  return 0;
}

/** Sorts a stack skin-outwards and keeps the order stable within a rank. */
function orderStack(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => layerRank(garmentById(a)) - layerRank(garmentById(b)));
}

export function owns(kit: Kit, id: string): boolean {
  const g = garmentById(id);
  return kit[g.region][slotFor(g)].includes(id);
}

/** Own it, or stop owning it. No rules: the inventory is a set, and the engine picks from it. */
export function toggleOwned(kit: Kit, id: string): Kit {
  const g = garmentById(id);
  const region: Region = g.region;
  const slot = slotFor(g);
  const list = kit[region][slot];
  const next = list.includes(id) ? list.filter((x) => x !== id) : orderStack([...list, id]);
  return { ...kit, [region]: { ...kit[region], [slot]: next } };
}

/**
 * An outfit from the engine's flat garment list, so a candidate ensemble
 * (`CandidateEnsemble.garments`) can be put on the figure. Nothing here invents a garment.
 */
export function kitFromGarments(garments: readonly Garment[]): Outfit {
  let out: Kit = EMPTY_KIT;
  for (const g of garments) if (!owns(out, g.id)) out = toggleOwned(out, g.id);
  return out;
}

/**
 * The outfit with one more garment on: an inner replaces the region's inner (you wear one base
 * layer at a time), an outer joins the stack. This is what "hover an owned item to preview it"
 * puts on the figure.
 */
export function wearing(outfit: Outfit, id: string): Outfit {
  const g = garmentById(id);
  const region: Region = g.region;
  if (slotFor(g) === 'inner') return { ...outfit, [region]: { ...outfit[region], inner: [id] } };
  return owns(outfit, id) ? outfit : toggleOwned(outfit, id);
}

/** The whole kit as the engine wants it: a flat list of garment ids. */
export function kitGarmentIds(kit: Kit): string[] {
  return REGIONS.flatMap((r) => [...kit[r].inner, ...kit[r].outer]);
}

export function kitGarments(kit: Kit): Garment[] {
  return kitGarmentIds(kit).map(garmentById);
}

/** Regions that need a next-to-skin garment and own none. */
export function missingRequired(kit: Kit): Region[] {
  return REGIONS.filter((r) => REQUIRES_INNER[r] && kit[r].inner.length === 0);
}

/**
 * Andy's kit from `REFERENCE_warmth_check.md`: the worked example in
 * `packages/heat/README.md`, plus the beanie and liner gloves it adds, and the sun hoodie the
 * reference lists as his hiking shirt. Starting here means the panel opens on a real,
 * documented inventory with a real, documented gap.
 */
export const DEFAULT_KIT: Kit = {
  head: { inner: [], outer: ['beanie'] },
  torso: { inner: ['ls_synthetic', 'grid_fleece'], outer: ['rain_shell'] },
  legs: { inner: ['alpha_leggings'], outer: ['hiking_pants', 'rain_pants'] },
  hands: { inner: [], outer: ['liner_gloves'] },
  feet: { inner: ['socks_mid'], outer: ['boots'] },
};
