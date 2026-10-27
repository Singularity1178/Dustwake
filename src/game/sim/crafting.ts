// Crafting reads the actor's pack and nearby storage, then commits inputs
// atomically at the task fire point. Tools must stay in the actor's own pack.
//
// The CRAFT button (`orderCraft`) validates and starts a `craft` task. The
// `craft` effect (`applyCraft`) re-validates when it fires (the pack, the bench
// and the knowledge may all have changed in the meantime), then consumes the
// inputs and gives the output through `giveItem`, so a full pack drops the
// overflow on the ground like any pickup. Nothing is ever deleted: a failed
// check changes nothing. Tools (the rune chisel) must be carried, never used up.
// Any actor can run the same task, not just the player.
import { craftRecipesFor, CRAFT_RECIPES, CRAFT_DUR, STATION_REQUIRES, type CraftRecipe } from "../content/crafting";
import { ITEMS, ITEM_NAMES, type ItemId } from "../content/items";
import { propDef } from "../content/props";
import { emit, type Actor, type World } from "../world/world";
import type { Area, PropInst } from "../world/area";
import { meets } from "./requirements";
import { countItem, giveItem, hasItem, capacity } from "./inventory";
import { beginTask, faceTo } from "./tasks";
import { craftSources, consumeInputs } from "./storage";
import { capable } from "../content/actors";
import { powered } from "./actorStats";
import { propReach } from "../content/props";
import { copySlots, removeItems, roomIn } from "./inventoryOps";
import { rememberItem } from "./discovery";
import { lineOfSight } from "./navigation";
import { actorMessage } from "./messages";

export type CraftStatus = "ok" | "cost" | "tools" | "unknown";
export interface CraftEntry {
  recipe: CraftRecipe;
  status: CraftStatus;
  /** Inputs against what the crafter carries. */
  lines: { item: ItemId; need: number; have: number }[];
  /** Tools that must be carried (not used up), and whether they are. */
  tools: { item: ItemId; have: boolean }[];
}

export const CRAFT_TEXT: Record<Exclude<CraftStatus, "ok" | "tools">, string> = {
  unknown: "NOT YET LEARNED",
  cost: "NOT ENOUGH MATERIALS",
};
/** Shown when the crafter doesn't know the craft at all (the station opens greyed out). */
export const CRAFT_LOCKED_TEXT = "YOU DON'T KNOW HOW TO CRAFT YET";
export const CRAFT_GONE_TEXT = "THE BENCH IS GONE OR TOO FAR AWAY";

const validRecipe = (r: CraftRecipe) => !!ITEMS[r.output.item] && Number.isSafeInteger(r.output.n) && r.output.n > 0
  && r.inputs.every((c) => !!ITEMS[c.item] && Number.isSafeInteger(c.n) && c.n > 0)
  && (r.tools ?? []).every((item) => !!ITEMS[item] && !r.inputs.some((c) => c.item === item));

/** The reason a recipe can't be made now, for the screen and the message line. */
export function craftReason(e: CraftEntry): string {
  if (e.status === "ok") return "";
  if (e.status === "tools") return `NEED THE ${e.tools.filter((t) => !t.have).map((t) => ITEM_NAMES[t.item]).join(" + ")}`;
  return CRAFT_TEXT[e.status];
}

/** True while `a` lacks the knowledge to read a station's plans (see STATION_REQUIRES). */
export const craftLocked = (w: World, a: Actor, station: string) => !meets(w, a, STATION_REQUIRES[station]);

/** Status of one recipe for a crafter (knowledge, then tools carried, then materials). */
export function craftEntry(w: World, a: Actor, r: CraftRecipe, station?: PropInst): CraftEntry {
  const sources = craftSources(w, a, station);
  const totals = new Map<ItemId, number>();
  for (const c of r.inputs) totals.set(c.item, (totals.get(c.item) ?? 0) + c.n);
  const lines = [...totals].map(([item, need]) => ({ item, need, have: sources.reduce((s, h) => s + countItem(h, item), 0) }));
  const tools = (r.tools ?? []).map((item) => ({ item, have: hasItem(a, item) }));
  const status: CraftStatus = !validRecipe(r) || !meets(w, a, r.requires) ? "unknown" : !tools.every((t) => t.have) ? "tools" : lines.every((l) => l.have >= l.need) ? "ok" : "cost";
  return { recipe: r, status, lines, tools };
}

/** The plans a station shows `a`. Empty while the craft is unknown: nothing is viewable. */
export function craftEntries(w: World, a: Actor, station: string, list: readonly CraftRecipe[] = CRAFT_RECIPES, propId?: string | null): CraftEntry[] {
  if (craftLocked(w, a, station)) return [];
  const p = propId ? w.areas.get(a.area)?.prop(propId) : undefined;
  return craftRecipesFor(station, list).map((r) => craftEntry(w, a, r, p));
}

/**
 * The CRAFT button. Validates, then starts the craft task (the effect does the
 * work when it fires). `propId` is the bench in use: the crafter turns to face
 * it, and the effect checks it is still there. Returns whether work started;
 * a refusal says why and changes nothing.
 */
export function orderCraft(w: World, a: Actor, station: string, id: string, propId?: string | null, list: readonly CraftRecipe[] = CRAFT_RECIPES): boolean {
  // A station-opening reach may be paused beneath its screen after firing.
  const opening = a.task?.fired && a.task.effect?.op === "useStation";
  if ((a.task && !opening) || !capable(a, "craft") || !powered(a)) return false;
  if (craftLocked(w, a, station)) { actorMessage(w, a, CRAFT_LOCKED_TEXT); return false; }
  const r = craftRecipesFor(station, list).find((x) => x.id === id);
  if (!r) return false;
  const p = propId ? w.areas.get(a.area)?.prop(propId) : undefined;
  const e = craftEntry(w, a, r, p);
  if (e.status !== "ok") { actorMessage(w, a, craftReason(e)); return false; }
  if (propId && (!p || propDef(p.kind).station !== station || !atStation(a, p) || !lineOfSight(w.areas.get(a.area)!, a, p))) { actorMessage(w, a, CRAFT_GONE_TEXT); return false; }
  if (p) faceTo(a, p.x, p.y - 4);
  beginTask(a, { kind: "craft", dur: r.dur ?? CRAFT_DUR, effect: { op: "craft", recipe: r.id } }, { kind: "craft", x: p?.x ?? a.x, y: p?.y ?? a.y, propId: p?.id });
  return true;
}

/**
 * The `craft` effect. Re-validates everything (the bench may have been taken
 * apart, the inputs spent, the tool dropped) and applies nothing if any check
 * fails. Otherwise: inputs out, output in (overflow to the ground).
 */
export function applyCraft(w: World, a: Actor, area: Area, recipe: string, propId?: string, list: readonly CraftRecipe[] = CRAFT_RECIPES): boolean {
  if (area.id !== a.area || !capable(a, "craft") || !powered(a)) return false;
  const r = list.find((x) => x.id === recipe);
  if (!r) return false;
  if (propId) {
    const p = area.prop(propId);
    if (!p || propDef(p.kind).station !== r.station || !atStation(a, p) || !lineOfSight(area, a, p)) { actorMessage(w, a, CRAFT_GONE_TEXT); return false; }
  }
  if (craftLocked(w, a, r.station)) { actorMessage(w, a, CRAFT_LOCKED_TEXT); return false; }
  const p = propId ? area.prop(propId) : undefined;
  const e = craftEntry(w, a, r, p);
  if (e.status !== "ok") { actorMessage(w, a, craftReason(e)); return false; }
  if (a.task?.jobId !== undefined && !outputFits(w, a, r)) return false;
  if (!consumeInputs(craftSources(w, a, p), r.inputs)) return false;
  for (const c of r.inputs) rememberItem(w, a, c.item);
  giveItem(w, a, r.output.item, r.output.n);
  emit(w, { t: "crafted", actor: a.id, recipe: r.id, item: r.output.item, n: r.output.n });
  return true;
}

export const atStation = (a: Actor, p: PropInst) => Math.hypot(a.x - p.x, a.y - p.y) <= propReach(p.kind) + 8;

/** Jobs wait rather than scattering products when their pack is full. Pack
 * ingredients are consumed first, so account for the slots they will free. */
export function outputFits(w: World, a: Actor, r: CraftRecipe): boolean {
  const pack = { inventory: copySlots(a.inventory) };
  for (const c of r.inputs) removeItems(pack, c.item, Math.min(c.n, countItem(pack, c.item)));
  return roomIn(pack.inventory, capacity(w, a), r.output.item) >= r.output.n;
}
