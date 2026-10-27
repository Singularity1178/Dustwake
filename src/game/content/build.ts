// Things the golem can build (data): the build catalog. Each row is one entry
// in the build menu. Adding a buildable = a row here (plus its prop kind in
// props.ts and its sprite in art.ts's PROP_ART if the kind is new).
//
// Knowledge gating: `requires` is a normal Requirement (know.* flags, items).
// Entries the builder doesn't meet are shown locked ("unknown": "locked",
// the default) or left out of the menu entirely ("hidden"), so recipes can be
// unlocked later by setting a flag.
//
// Deconstruction: anything built from a recipe can be taken apart for the full
// cost of that recipe, and so can every authored (map-placed) prop whose kind a
// recipe builds (AUTHORED_SALVAGE is derived from this table). Other authored
// kinds opt in with a data row in EXTRA_SALVAGE.
//
// Materials: rough builds stay cheap and raw (wood, stone); better ones use
// crafted materials (planks, cut stone: content/crafting.ts), replacing the raw
// ones or mixing both. The crafting bench itself must stay raw: planks come
// from a bench, so a bench that needed planks could never be built.
import type { ItemId } from "./items";
import type { Requirement } from "./interactions";
import { FLAGS } from "./flags";
import { rawValue } from "./crafting";

export interface Cost { item: ItemId; n: number }

/** Build menu categories, in tab order. */
export const BUILD_CATEGORIES = [
  { id: "light", name: "LIGHT" },
  { id: "craft", name: "CRAFT" },
  { id: "defense", name: "DEFENSE" },
  { id: "furniture", name: "FURNITURE" },
  { id: "decor", name: "DECOR" },
] as const;
export type BuildCategory = (typeof BUILD_CATEGORIES)[number]["id"];
export const categoryName = (c: string) => BUILD_CATEGORIES.find((k) => k.id === c)?.name ?? c.toUpperCase();
export const categoryIndex = (c: string) => BUILD_CATEGORIES.findIndex((k) => k.id === c);

/**
 * Where a recipe may be placed (rules in sim/build.ts):
 *  - "floor": on open floor; the prop's whole collision footprint must be clear.
 *  - "wall":  on the visible (south) face of a plain wall tile, i.e. a WALL tile
 *             with open floor directly below it, exactly like the dungeon's
 *             authored wall torches and banners. Wall props have no footprint.
 */
export type PlaceRule = "floor" | "wall";

export interface Recipe {
  /** Menu name (bitmap font: uppercase and FONT_GLYPHS only). */
  name: string;
  category: BuildCategory;
  /** Up to 3 short lines for the detail panel (at most 34 characters each). */
  desc: string[];
  /** Prop kind created. */
  prop: string;
  /** Prop variant (sprite `v`). Default 0. */
  v?: number;
  cost: Cost[];
  requires: Requirement;
  /** Optional analysis key. Omit for things not discoverable in an area (e.g. a torch post). */
  analysis?: string;
  /** How the entry is shown while `requires` isn't met. Default "locked". */
  unknown?: "locked" | "hidden";
  /** Placement rule. Default "floor". */
  place?: PlaceRule;
  /** Initial prop state. */
  lit?: boolean;
  /** Seconds of work to build. Default 0.7. */
  dur?: number;
  /** Default sort order inside a category (lower first). */
  order?: number;
}

const KNOW_BUILD: Requirement = { flags: [FLAGS.knowBuild] };

export const RECIPES: Record<string, Recipe> = {
  torch_post: {
    name: "TORCH POST", category: "light", order: 0, prop: "torch_post", lit: true,
    desc: ["A FREESTANDING TORCH ON A", "WOODEN POLE. STANDS ON ANY", "OPEN GROUND."],
    cost: [{ item: "wood", n: 2 }, { item: "stone", n: 1 }], requires: KNOW_BUILD,
  },
  wall_torch: {
    name: "WALL TORCH", category: "light", order: 1, prop: "torch", lit: true, place: "wall",
    desc: ["AN IRON SCONCE FOR WALLS. HANGS", "ON THE LIT FACE OF A WALL", "WITH FLOOR IN FRONT OF IT."],
    cost: [{ item: "cut_stone", n: 1 }, { item: "wood", n: 1 }], requires: KNOW_BUILD,
  },
  brazier: {
    name: "BRAZIER", category: "light", order: 2, prop: "brazier", lit: true, dur: 1.1,
    desc: ["A STONE FIRE BOWL. BURNS", "BRIGHT AND WIDE. NEEDS THE", "MASON'S KNOWLEDGE."],
    cost: [{ item: "cut_stone", n: 4 }, { item: "wood", n: 2 }], requires: { flags: [FLAGS.knowMasonry] },
  },
  craftbench: {
    // Builds the same `workbench` prop the dungeon's artificery has (same sprite, same station).
    name: "CRAFTING BENCH", category: "craft", order: 0, prop: "workbench", dur: 1.4,
    desc: ["A STURDY BENCH TO WORK AT.", "USE IT TO OPEN THE CRAFTING", "PLANS. TAKES THREE TILES."],
    cost: [{ item: "wood", n: 6 }, { item: "stone", n: 2 }], requires: KNOW_BUILD,
  },
  barricade: {
    name: "BARRICADE", category: "defense", order: 0, prop: "barricade", dur: 1.0,
    desc: ["SHARPENED STAKES. NOTHING", "WALKS THROUGH IT. BLOCK A", "DOOR OR A PASSAGE."],
    cost: [{ item: "wood", n: 3 }], requires: KNOW_BUILD,
  },
  table: {
    name: "TABLE", category: "furniture", order: 0, prop: "table", dur: 1.0,
    desc: ["A PLAIN PLANK TABLE.", "TAKES THREE TILES OF FLOOR."],
    cost: [{ item: "planks", n: 4 }], requires: KNOW_BUILD,
  },
  chair: {
    name: "CHAIR", category: "furniture", order: 1, prop: "chair",
    desc: ["SOMEWHERE TO SIT, IF A", "GOLEM EVER NEEDED TO."],
    cost: [{ item: "planks", n: 2 }], requires: KNOW_BUILD,
  },
  wall_banner: {
    name: "WALL BANNER", category: "decor", order: 0, prop: "banner", v: 3, place: "wall",
    desc: ["A CRIMSON BANNER ON AN IRON", "ROD. HANGS ON A WALL FACE."],
    cost: [{ item: "planks", n: 1 }, { item: "cut_stone", n: 1 }], requires: KNOW_BUILD,
  },
};

export const RECIPE_IDS = Object.keys(RECIPES);
export const placeRule = (r: Recipe): PlaceRule => r.place ?? "floor";
/** What a recipe costs in raw-material units (crafted materials weigh what they cost to make): the build menu's cost sort. */
export const costTotal = (r: Recipe) => Math.round(r.cost.reduce((s, c) => s + c.n * rawValue(c.item), 0) * 100) / 100;

/**
 * Authored (area-builder) prop kinds that may be deconstructed, and what they
 * refund: the full cost of a recipe, or an explicit refund. Built props are
 * always deconstructable (they remember what they cost); an authored prop only
 * if its kind has a row here. Every kind a recipe builds is in it already, so a
 * new buildable is deconstructable everywhere it appears (the dungeon's torches,
 * braziers, workbench, tables, chairs and banners) with no extra row.
 */
export type SalvageRow = { recipe: string } | { refund: Cost[] };
/** Authored kinds that no recipe builds but may still be taken apart (none yet). */
export const EXTRA_SALVAGE: Record<string, SalvageRow> = {};
export const AUTHORED_SALVAGE: Record<string, SalvageRow> = (() => {
  const t: Record<string, SalvageRow> = {};
  for (const [id, r] of Object.entries(RECIPES)) if (!(r.prop in t)) t[r.prop] = { recipe: id };
  return { ...t, ...EXTRA_SALVAGE };
})();

/** The recipe that builds a prop kind (first match), for built props saved before recipes were recorded. */
export const recipeForProp = (kind: string) => Object.keys(RECIPES).find((id) => RECIPES[id].prop === kind);

/** How far (in tiles, Chebyshev) from the builder a placement may be. */
export const BUILD_REACH = 2;
/** Seconds of work to take a prop apart. */
export const DECONSTRUCT_DUR = 0.9;
