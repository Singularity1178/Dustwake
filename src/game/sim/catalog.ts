// Build catalog queries: per-entry status (can build / missing materials /
// unknown recipe), plus pure search, filter and sort over entries. No DOM; the
// build menu renders whatever `queryCatalog` returns, and tests drive these
// functions directly with synthetic catalogs of any size.
import { RECIPES, categoryIndex, categoryName, costTotal, scanHint, type Recipe } from "../content/build";
import { ITEM_NAMES } from "../content/items";
import type { Actor, World } from "../world/world";
import { countItem } from "./inventory";
import { planLock, type PlanLock } from "./analysis";

export type EntryStatus = "ok" | "cost" | "unknown";
export interface CostLine { item: Recipe["cost"][number]["item"]; need: number; have: number }

export interface CatalogEntry {
  id: string;
  recipe: Recipe;
  status: EntryStatus;
  /** Why an `unknown` entry is locked: missing knowledge, or a plan not yet analyzed. */
  lock?: PlanLock;
  /** Cost against what the builder carries. */
  lines: CostLine[];
}

export type SortKey = "category" | "name" | "cost";
export const SORT_KEYS: SortKey[] = ["category", "name", "cost"];
export const SORT_NAMES: Record<SortKey, string> = { category: "TYPE", name: "NAME", cost: "COST" };

/** Pseudo-tabs before the real categories. */
export const TAB_ALL = "all";
export const TAB_FAV = "fav";

export interface CatalogQuery {
  /** TAB_ALL, TAB_FAV or a BuildCategory id. */
  tab: string;
  search: string;
  sort: SortKey;
  /** Only entries the builder can build right now. */
  affordableOnly: boolean;
  favorites: ReadonlySet<string>;
}

/** Status of one recipe for an actor. Hidden-until-known recipes return null. */
export function entryFor(w: World, a: Actor, id: string, r: Recipe = RECIPES[id]): CatalogEntry | null {
  const lock = planLock(w, a, r);
  if (lock && r.unknown === "hidden") return null;
  const lines = r.cost.map((c) => ({ item: c.item, need: c.n, have: countItem(a, c.item) }));
  const status: EntryStatus = lock ? "unknown" : lines.every((l) => l.have >= l.need) ? "ok" : "cost";
  return lock ? { id, recipe: r, status, lock, lines } : { id, recipe: r, status, lines };
}

/** Every listable entry of a recipe table (default: RECIPES) for an actor. */
export function catalogEntries(w: World, a: Actor, recipes: Record<string, Recipe> = RECIPES): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const id of Object.keys(recipes)) {
    const e = entryFor(w, a, id, recipes[id]);
    if (e) out.push(e);
  }
  return out;
}

/** Normalise typed text the way names are written (uppercase, single spaces). */
export const normSearch = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Search: every word of the query must appear in the entry's name, category
 * name or one of its material names ("STONE" finds everything that costs stone).
 */
export function matchesSearch(e: CatalogEntry, search: string): boolean {
  const q = normSearch(search);
  if (!q) return true;
  const hay = [e.recipe.name, categoryName(e.recipe.category), ...e.recipe.cost.map((c) => ITEM_NAMES[c.item] ?? c.item)].join(" ").toUpperCase();
  return q.split(" ").every((word) => hay.includes(word));
}

export function matchesTab(e: CatalogEntry, tab: string, favorites: ReadonlySet<string>): boolean {
  if (tab === TAB_ALL) return true;
  if (tab === TAB_FAV) return favorites.has(e.id);
  return e.recipe.category === tab;
}

const byName = (a: CatalogEntry, b: CatalogEntry) => (a.recipe.name < b.recipe.name ? -1 : a.recipe.name > b.recipe.name ? 1 : 0);
const byCategory = (a: CatalogEntry, b: CatalogEntry) =>
  categoryIndex(a.recipe.category) - categoryIndex(b.recipe.category) || (a.recipe.order ?? 0) - (b.recipe.order ?? 0) || byName(a, b);

/** Stable sort; ties always fall back to name, then id, so the order is total. */
export function sortEntries(list: readonly CatalogEntry[], sort: SortKey): CatalogEntry[] {
  const cmp = sort === "name" ? byName : sort === "cost" ? (a: CatalogEntry, b: CatalogEntry) => costTotal(a.recipe) - costTotal(b.recipe) || byName(a, b) : byCategory;
  return [...list].sort((a, b) => cmp(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Tab, search and affordability filters, then sort. */
export function queryCatalog(entries: readonly CatalogEntry[], q: CatalogQuery): CatalogEntry[] {
  const kept = entries.filter((e) => matchesTab(e, q.tab, q.favorites) && matchesSearch(e, q.search) && (!q.affordableOnly || e.status === "ok"));
  return sortEntries(kept, q.sort);
}

/** Why an entry can't be built, for the detail panel's status line ("" if it can). At most 36 characters. */
export function entryReason(e: CatalogEntry): string {
  // Known how to build, plan not read yet: say what to scan, and that vision is Z.
  if (e.status === "unknown" && e.lock === "analysis") return `SCAN ${scanHint(e.recipe)} IN VISION (Z)`;
  if (e.status === "unknown") return "UNKNOWN RECIPE - NOT YET LEARNED";
  if (e.status === "cost") {
    const miss = e.lines.filter((l) => l.have < l.need).map((l) => `${l.need - l.have} ${ITEM_NAMES[l.item]}`);
    return `NEED ${miss.join(" + ")} MORE`;
  }
  return "";
}
