// Crafting recipes (data) for work stations such as the crafting bench.
//
// A recipe turns `inputs` from the crafter's own pack (stations have no item
// slots) into `output`. The crafting screen lists these rows and its CRAFT
// button calls sim/crafting.ts: orderCraft, which starts a `craft` task whose
// `craft` effect re-validates when it fires, consumes the inputs and gives the
// output (overflow lands on the ground, as for any pickup; nothing is deleted).
// `tools` are items that must be carried but are never used up (the rune
// chisel). Ratios and durations live only in these rows, so tuning is editing a
// number here.
//
// Knowledge: a station can be used by anyone, but its plans can only be read by
// someone who knows the craft (STATION_REQUIRES). Without it the screen still
// opens, greyed out and empty, so the bench is never a dead prop. Every recipe
// below, rune carving included, is unlocked by the existing building knowledge
// (`know.build`, the Builder's Primer): no separate crafting flag or book.
import type { ItemId } from "./items";
import type { Requirement } from "./interactions";
import type { Cost } from "./build";
import { FLAGS } from "./flags";

export interface CraftRecipe {
  id: string;
  /** Bitmap font only (uppercase, FONT_GLYPHS). */
  name: string;
  /** Station UI that offers it (PropKindDef.station). */
  station: "crafting";
  /** Up to 3 lines, at most 30 characters each. */
  desc: string[];
  /** Consumed from the crafter's pack. */
  inputs: Cost[];
  /** Carried but not consumed (e.g. the rune chisel). */
  tools?: ItemId[];
  output: { item: ItemId; n: number };
  /** Extra requirement beyond the station's own knowledge (none today: building knowledge covers all of them). */
  requires?: Requirement;
  /** Seconds of work. Default 1.2. */
  dur?: number;
}

/** What a crafter must know before a station shows any plans. Same knowledge as building: the bench is a built thing. */
export const STATION_REQUIRES: Record<string, Requirement> = {
  crafting: { flags: [FLAGS.knowBuild] },
};

export const CRAFT_DUR = 1.2;

export const CRAFT_RECIPES: CraftRecipe[] = [
  {
    id: "planks", name: "PLANKS", station: "crafting", dur: 1.0,
    desc: ["SAW ROUGH WOOD INTO PLANKS", "FOR TABLES, CHAIRS, BANNERS", "AND OTHER FINER BUILDS."],
    inputs: [{ item: "wood", n: 2 }], output: { item: "planks", n: 3 },
  },
  {
    id: "cut_stone", name: "CUT STONE", station: "crafting", dur: 1.4,
    desc: ["SQUARE ROUGH STONE INTO", "BLOCKS. SOME IS LOST IN THE", "CUTTING."],
    inputs: [{ item: "stone", n: 3 }], output: { item: "cut_stone", n: 2 },
  },
  {
    id: "rune_swift", name: "RUNE OF SWIFT", station: "crafting", dur: 2.4,
    desc: ["CARVE THE SIGN OF SWIFTNESS", "INTO CUT STONE. NEEDS THE", "RUNE CHISEL IN YOUR PACK."],
    inputs: [{ item: "cut_stone", n: 2 }], tools: ["chisel"], output: { item: "rune_swift", n: 1 },
  },
  {
    id: "rune_glow", name: "RUNE OF GLOW", station: "crafting", dur: 2.4,
    desc: ["CARVE THE SIGN OF LIGHT", "INTO CUT STONE. NEEDS THE", "RUNE CHISEL IN YOUR PACK."],
    inputs: [{ item: "cut_stone", n: 3 }], tools: ["chisel"], output: { item: "rune_glow", n: 1 },
  },
];

export const craftRecipesFor = (station: string, list: readonly CraftRecipe[] = CRAFT_RECIPES) => list.filter((r) => r.station === station);

/**
 * What one unit of an item is worth in raw materials (wood, stone and anything
 * not crafted count 1), derived from the recipe that makes it. The build menu
 * sorts by this, so a crafted material weighs what it cost to make.
 */
export function rawValue(item: ItemId, list: readonly CraftRecipe[] = CRAFT_RECIPES, depth = 0): number {
  const r = list.find((c) => c.output.item === item);
  if (!r || depth > 4) return 1;
  return r.inputs.reduce((s, c) => s + c.n * rawValue(c.item, list, depth + 1), 0) / r.output.n;
}
