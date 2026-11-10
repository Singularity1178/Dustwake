// Digging (data). The ground is a column of layers; each layer is one material,
// and each material names the tool that works it and what a unit of it yields.
//
// A dig site says what column lies under a place. Today the only sites are prop
// kinds (DIG_SITES: the surface's buried entrance), and the progress of a site
// is that prop's saved work (`dmg`, as for harvesting) with `open` set once the
// column is through. Nothing else in the dig path knows that: sim/digging.ts
// resolves "what is being dug here" to a column and a depth, then the rules
// (content/interactions.ts: digDirt / digStone), the tool check, the yields and
// the events are the same for any column.
//
// Digging anywhere on the surface later is therefore two additions, not a
// rewrite: a per-tile depth store on the Area (a save field with a migration),
// and a default column per ground style (GROUND_COLUMN below is the one the
// meadow would get), returned by the same lookup for a tile that has no site.
import type { ItemId } from "./items";
import type { ToolType } from "./tools";

export type DigMaterial = "dirt" | "stone";

export const DIG_MATERIALS: Record<DigMaterial, { name: string; tool: ToolType; /** One per unit of work cleared. */ yields: ItemId; /** RULES row (content/interactions.ts) for E on a layer of it. */ rules: string }> = {
  dirt: { name: "EARTH", tool: "shovel", yields: "dirt", rules: "digDirt" },
  stone: { name: "STONE", tool: "pickaxe", yields: "stone", rules: "digStone" },
};

export interface DigLayer { material: DigMaterial; /** Units of work to clear it. A plain head clears one a stroke. */ work: number }

export interface DigSiteDef {
  layers: readonly DigLayer[];
  /** Where E reaches it, relative to the prop's anchor, and how far. */
  dy: number; reach: number;
  /** The entrance (content/geography.ts: ENTRANCES) that opens when the column is through. */
  opens?: string;
}

/** What lies under open ground where nothing else is said: the column a later "dig anywhere" starts from. Not read yet. */
export const GROUND_COLUMN: readonly DigLayer[] = [{ material: "dirt", work: 4 }, { material: "stone", work: 8 }];

/** Seconds a stroke takes. */
export const DIG_DUR = 1.1;

export const DIG_SITES: Record<string, DigSiteDef> = {
  // The old stair down into the halls: turf and a cellar's depth of earth, then the vault that fell into the stairwell.
  buriedgate: { layers: [{ material: "dirt", work: 8 }, { material: "stone", work: 8 }], dy: -20, reach: 28, opens: "surface_stair" },
};

export const digTotal = (def: DigSiteDef) => def.layers.reduce((s, l) => s + l.work, 0);

/** The layer `done` units of work have reached: its index, material, the work already into it and what is left of it. Null once through. */
export function digLayerAt(def: DigSiteDef, done: number): { index: number; material: DigMaterial; into: number; left: number } | null {
  let base = 0;
  for (let i = 0; i < def.layers.length; i++) {
    const l = def.layers[i];
    if (done < base + l.work - 1e-9) return { index: i, material: l.material, into: done - base, left: base + l.work - done };
    base += l.work;
  }
  return null;
}

/**
 * How far along a site looks, for its sprite: 0 untouched, then two looks per
 * layer (begun, half through), and 2 * layers + 1 once open. The buried
 * entrance: 0 grass, 1-2 earth, 3-4 stone, 5 the open stair.
 */
export function digStage(def: DigSiteDef, done: number, open: boolean): number {
  if (open) return def.layers.length * 2 + 1;
  if (done <= 0) return 0;
  const at = digLayerAt(def, done);
  if (!at) return def.layers.length * 2;
  return 1 + at.index * 2 + (at.into >= def.layers[at.index].work / 2 ? 1 : 0);
}

/** The sprite variant a prop is drawn with: its dig stage if it is a dig site, else its authored `v`. */
export function propLook(p: { kind: string; v: number; dmg?: number; open?: boolean }): number {
  const def = DIG_SITES[p.kind];
  return def ? digStage(def, p.dmg ?? 0, !!p.open) : p.v;
}
