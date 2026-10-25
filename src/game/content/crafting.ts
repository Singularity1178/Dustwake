// Crafting recipes (data) for work stations such as the crafting bench.
//
// STATUS: UI SHELL ONLY. The crafting screen lists these rows, shows the
// ingredients against what the crafter carries, and has a CRAFT button, but no
// crafting work exists yet: orderCraft (sim/crafting.ts) validates and then
// reports that the work isn't understood. When crafting arrives, a recipe gains
// a real `output`, and orderCraft starts a task whose effect consumes `inputs`
// from the crafter's pack and gives `output` (overflow to the ground, as always).
// Crafting draws from the crafter's own pack: stations have no item slots.
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
  inputs: Cost[];
  /** What it makes. Absent on placeholder rows. */
  output?: { item: ItemId; n: number };
  requires?: Requirement;
  /** Seconds of work (for the future craft task). */
  dur?: number;
  /** A clearly marked dummy row: shown, never craftable. */
  placeholder?: boolean;
}

export const CRAFT_RECIPES: CraftRecipe[] = [
  {
    id: "placeholder", name: "UNKNOWN WORK", station: "crafting", placeholder: true,
    desc: ["PLACEHOLDER. THE BENCH IS", "READY, BUT NO PLANS HAVE", "BEEN WORKED OUT YET."],
    inputs: [{ item: "wood", n: 2 }, { item: "stone", n: 1 }],
    requires: { flags: [FLAGS.knowBuild] },
  },
];

export const craftRecipesFor = (station: string, list: readonly CraftRecipe[] = CRAFT_RECIPES) => list.filter((r) => r.station === station);
