// Minimal opt-in rows for tests and ?debug. The production catalogs and area
// builders are unchanged; the content update can promote these rows later.
import type { Recipe } from "./build";
import type { CraftRecipe } from "./crafting";

export const FOUNDATION_BUILDS: Record<string, Recipe> = {
  storage_chest: {
    name: "STORAGE CHEST", category: "furniture", prop: "storage_chest", analysis: "storage_chest",
    desc: ["A ONE-TILE, 32-SLOT CHEST."], cost: [{ item: "planks", n: 4 }], requires: { flags: ["know.build"] },
  },
};
export const FOUNDATION_CRAFTS: CraftRecipe[] = [
  {
    id: "ruby_core", name: "RUBY GOLEM CORE", station: "crafting", dur: 2,
    desc: ["CARVE A CORE WITH THE CHISEL."], inputs: [{ item: "large_ruby", n: 1 }], tools: ["chisel"], output: { item: "ruby_core", n: 1 },
  },
  {
    id: "unmake_crown", mode: "deconstruct", name: "DECONSTRUCT CROWN", station: "crafting",
    desc: ["RECOVER THE RUBY."], inputs: [{ item: "crown", n: 1 }], output: { item: "large_ruby", n: 1 },
  },
  ...(["rune_swift", "rune_glow"] as const).map((item): CraftRecipe => ({
    id: `unmake_${item}`, mode: "deconstruct", name: "DECONSTRUCT RUNE", station: "crafting",
    desc: ["RECOVER ONE ROUGH STONE."], inputs: [{ item, n: 1 }], output: { item: "stone", n: 1 },
  })),
];