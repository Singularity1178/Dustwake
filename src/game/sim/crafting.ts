// Crafting: UI SHELL ONLY (see content/crafting.ts). Status checks are real
// (knowledge and ingredients against the crafter's own pack, since stations have
// no slots); there is no craft task yet, so orderCraft never changes the world.
import { craftRecipesFor, CRAFT_RECIPES, type CraftRecipe } from "../content/crafting";
import { emit, type Actor, type World } from "../world/world";
import { meets } from "./requirements";
import { countItem } from "./inventory";

export type CraftStatus = "ok" | "cost" | "unknown" | "placeholder";
export interface CraftEntry { recipe: CraftRecipe; status: CraftStatus; lines: { item: CraftRecipe["inputs"][number]["item"]; need: number; have: number }[] }

export const CRAFT_TEXT: Record<Exclude<CraftStatus, "ok">, string> = {
  unknown: "NOT YET LEARNED",
  cost: "NOT ENOUGH MATERIALS",
  placeholder: "NO PLANS YET",
};

export function craftEntries(w: World, a: Actor, station: string, list: readonly CraftRecipe[] = CRAFT_RECIPES): CraftEntry[] {
  return craftRecipesFor(station, list).map((r) => {
    const lines = r.inputs.map((c) => ({ item: c.item, need: c.n, have: countItem(a, c.item) }));
    const status: CraftStatus = !meets(w, a, r.requires) ? "unknown" : r.placeholder || !r.output ? "placeholder" : lines.every((l) => l.have >= l.need) ? "ok" : "cost";
    return { recipe: r, status, lines };
  });
}

/**
 * The CRAFT button. Validates and reports. Real crafting will start a task
 * here (consume `inputs`, give `output` via giveItem); until then even a
 * satisfiable recipe only reports that the work isn't understood.
 */
export function orderCraft(w: World, a: Actor, station: string, id: string): boolean {
  const e = craftEntries(w, a, station).find((x) => x.recipe.id === id);
  if (!e) return false;
  emit(w, { t: "message", text: e.status === "ok" ? "THE BENCH ISN'T READY FOR THIS YET" : CRAFT_TEXT[e.status] });
  return false;
}
