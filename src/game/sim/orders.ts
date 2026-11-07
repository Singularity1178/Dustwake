// What the worker management screen may offer, and how it words a worker's
// state. Pure sim (no DOM): every list is derived from the World and the data
// rows (HARVEST, CRAFT_RECIPES, JOB_KINDS, RUNE_NODES), never stored, so the
// screen only ever offers targets the order's own validation accepts. Orders
// themselves are built with gatherOrder / craftOrder and given through
// commands.ts: giveWorkerOrder.
import { actorDef, capable } from "../content/actors";
import { AREA_NAMES } from "../content/geography";
import { HARVEST } from "../content/harvest";
import { ITEM_NAMES, type ItemId } from "../content/items";
import { JOB_KINDS } from "../content/jobs";
import { propDef } from "../content/props";
import { RECIPES, recipeForProp } from "../content/build";
import { CRAFT_RECIPES, craftRecipesFor, type CraftRecipe } from "../content/crafting";
import { RUNE_NODES } from "../content/runes";
import type { Area, PropInst } from "../world/area";
import type { Actor, World } from "../world/world";
import type { Job, PropRef } from "../world/jobs";
import { coreCheck } from "./power";
import { powered } from "./actorStats";
import { craftEntry, type CraftEntry } from "./crafting";
import { actorBoxes, nearestFree } from "./collision";
import { runeRoute } from "./runes";

export const areaName = (id: string) => AREA_NAMES[id] ?? id.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** Does this body have what an order kind needs (JOB_KINDS capabilities)? */
export const canTake = (a: Actor, kind: string) => !!JOB_KINDS[kind] && JOB_KINDS[kind].capabilities.every((c) => capable(a, c));

/** Can this actor get to `area`: it is there, or can travel and a rune route leads there. */
export const canReach = (w: World, a: Actor, area: string) => a.area === area || (capable(a, "travel") && !!runeRoute(w, a.area, area));

const SHORT: Record<string, string> = { storage_chest: "CHEST", workbench: "BENCH" };
/** A prop kind's name: the recipe that builds it, else its kind. */
export function propLabel(kind: string): string {
  const id = recipeForProp(kind);
  return id ? RECIPES[id].name : kind.toUpperCase().replace(/_/g, " ");
}

export interface PropOption { ref: PropRef; kind: string; label: string; area: string }

/** The longest name a prop may be given. */
export const PROP_NAME_MAX = 20;
/** What a typed name becomes: upper case, one space between words, trimmed, no longer than PROP_NAME_MAX. Empty means "no name of its own". */
export const cleanPropName = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim().slice(0, PROP_NAME_MAX).trim();

/** Which prop of its kind in its area this is, and how many there are: the orders' numbering (stable id order, among props of that kind). */
function kindIndex(area: Area, p: PropInst): { n: number; of: number } {
  const same = area.props.filter((q) => q.kind === p.kind).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { n: same.indexOf(p) + 1, of: same.length };
}

/**
 * What a prop is called until the player names it: its area, its kind and (with several of a kind in the area) its
 * number, as every order screen words it: "DUNGEON CHEST 1", "DUNGEON CHEST 2", "SURFACE CHEST".
 */
export function defaultPropName(area: Area, p: PropInst): string {
  const { n, of } = kindIndex(area, p);
  return `${areaName(area.id)} ${SHORT[p.kind] ?? p.kind.toUpperCase().replace(/_/g, " ")}${of > 1 ? ` ${n}` : ""}`;
}

/** A prop's name: the one the player gave it, else its default. The one name the storage screen and the orders both use. */
export const propName = (area: Area, p: PropInst) => p.name || defaultPropName(area, p);

/** Props in the areas the worker can get to (areas already visited), in stable area then id order, with labels like "SURFACE CHEST 2". */
function propOptions(w: World, a: Actor, want: (p: PropInst) => boolean): PropOption[] {
  const out: PropOption[] = [];
  for (const id of [...w.areas.keys()].sort()) {
    if (!canReach(w, a, id)) continue;
    const area = w.areas.get(id)!, props = area.props.filter(want).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    for (const p of props) {
      out.push({ ref: { area: id, prop: p.id }, kind: p.kind, area: id, label: propName(area, p) });
    }
  }
  return out;
}

/** Storage props the worker can deposit into. */
export const storageOptions = (w: World, a: Actor) => propOptions(w, a, (p) => !!p.inventory && !!propDef(p.kind).storage);
/** Work stations the worker can craft at. */
export const stationOptions = (w: World, a: Actor) => propOptions(w, a, (p) => !!propDef(p.kind).station);

/** Resources the world can yield: every item a harvestable pays, in data order. */
export function gatherResources(): ItemId[] {
  const out: ItemId[] = [];
  for (const d of Object.values(HARVEST)) for (const i of [d.perHit.item, d.final?.item]) if (i && !out.includes(i)) out.push(i);
  return out;
}

const yields = (p: PropInst, item: ItemId) => HARVEST[p.kind]?.perHit.item === item || HARVEST[p.kind]?.final?.item === item;
export const sourceCount = (area: Area, item: ItemId) => area.props.filter((p) => !p.taken && yields(p, item)).length;

/** Areas the worker can get to that still hold something yielding `item`. */
export function gatherSources(w: World, a: Actor, item: ItemId): { area: string; label: string; count: number }[] {
  return [...w.areas.keys()].sort().filter((id) => canReach(w, a, id)).flatMap((id) => {
    const count = sourceCount(w.areas.get(id)!, item);
    return count ? [{ area: id, label: areaName(id), count }] : [];
  });
}

/** Why a gather from `from` into `storage` can't be run (text), or null. The worker walks the route there and back. */
export function gatherRefusal(w: World, a: Actor, item: ItemId, from: string | undefined, storage: PropRef | undefined): string | null {
  if (!canTake(a, "gatherDeposit")) return "IT CANNOT DO THAT WORK";
  if (!storage) return "BUILD A STORAGE CHEST FIRST";
  if (!from) return `NO ${ITEM_NAMES[item]} TO BE FOUND`;
  if (!runeRoute(w, from, storage.area)) return "NO RUNE ROUTE FROM THERE";
  return null;
}

/** Recipes a worker may be sent to craft: every one it knows how to make (unknown ones stay hidden, as at the bench). */
export function craftChoices(w: World, a: Actor, station: PropOption | undefined): CraftEntry[] {
  if (!station) return [];
  const p = w.areas.get(station.area)?.prop(station.ref.prop), kind = propDef(station.kind).station;
  if (!kind) return [];
  return craftRecipesFor(kind, CRAFT_RECIPES).map((r: CraftRecipe) => craftEntry(w, a, r, p)).filter((e) => e.status !== "unknown");
}

export interface WalkOption { label: string; area: string; x: number; y: number }
/** Places to send it: the start of each area, beside each storage prop and station, and by each rune. */
export function walkOptions(w: World, a: Actor): WalkOption[] {
  const size = actorDef(a).body.box, out: WalkOption[] = [];
  const spot = (area: Area, x: number, y: number) => nearestFree(area, x, y, actorBoxes(w, area.id, a.id), size);
  const add = (label: string, area: Area, x: number, y: number) => { const s = spot(area, x, y); if (s) out.push({ label, area: area.id, x: s.x, y: s.y }); };
  for (const id of [...w.areas.keys()].sort()) {
    if (!canReach(w, a, id)) continue;
    const area = w.areas.get(id)!;
    add(`${areaName(id)} START`, area, area.start.x, area.start.y);
    for (const o of [...storageOptions(w, a), ...stationOptions(w, a)].filter((o) => o.area === id)) {
      const p = area.prop(o.ref.prop)!;
      add(o.label, area, p.x, p.y + 12);
    }
    for (const n of Object.values(RUNE_NODES).filter((n) => n.area === id).sort((p, q) => (p.id < q.id ? -1 : 1))) {
      const p = area.prop(n.prop);
      if (p) add(`${areaName(id)} RUNE`, area, p.x + n.arrive.dx, p.y + n.arrive.dy);
    }
  }
  return out;
}

// ---------------------------------------------------------------- amounts
/** What the amount row steps through; the last is "repeat until told otherwise". */
export const AMOUNTS: readonly (number | "REPEAT")[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50, 99, "REPEAT"];

// ---------------------------------------------------------------- wording
export type Tone = "ok" | "warn" | "bad" | "dim";
/** Short reasons an order blocks (`Job.reason`), at most 15 characters so "BLOCKED: " fits beside them. */
export const BLOCK_TEXT: Record<string, string> = {
  storageFull: "STORAGE FULL", missingStorage: "NO STORAGE", packFull: "PACK FULL", noResource: "NO RESOURCE",
  cannotHarvest: "CAN'T HARVEST", noTravel: "CAN'T TRAVEL", noRuneRoute: "NO RUNE ROUTE", missingRune: "RUNE MISSING",
  pathBlocked: "PATH BLOCKED", craftChanged: "CRAFT FAILED", missingStation: "NO STATION", cost: "NO MATERIALS",
  tools: "NEEDS TOOL", unknown: "UNKNOWN RECIPE", arrivalBlocked: "ARRIVAL BLOCKED", unknownJob: "UNKNOWN ORDER",
};
export const blockText = (reason: string | null) => (reason && BLOCK_TEXT[reason]) || "STUCK";

const PHASE_TEXT: Record<string, string> = { gather: "GATHERING", deposit: "STORING", craft: "CRAFTING", walk: "WALKING" };

/** The worker's body state: the core in it and whether it runs on it. */
export function powerState(a: Actor): { text: string; tone: Tone } {
  if (!actorDef(a).power) return { text: "NEEDS NO CORE", tone: "ok" };
  if (!a.powerCore) return { text: "NO CORE", tone: "bad" };
  if (!coreCheck(a, a.powerCore).sufficient) return { text: "CORE TOO WEAK", tone: "warn" };
  return { text: ITEM_NAMES[a.powerCore], tone: "ok" };
}

export function refLabel(w: World, ref: PropRef): string {
  const p = w.areas.get(ref.area)?.prop(ref.prop);
  if (!p) return "MISSING";
  const same = (w.areas.get(ref.area)?.props ?? []).filter((q) => q.kind === p.kind).sort((q, r) => (q.id < r.id ? -1 : 1));
  return `${areaName(ref.area)} ${SHORT[p.kind] ?? p.kind.toUpperCase().replace(/_/g, " ")}${same.length > 1 ? ` ${same.indexOf(p) + 1}` : ""}`;
}

const amountText = (j: Job) => (j.args.repeat === true ? `${j.completed} DONE (REPEAT)` : `${j.completed}/${j.args.amount}`);

export interface JobView {
  /** "GATHER WOOD", "CRAFT PLANKS", "GO TO SURFACE". */
  title: string;
  progress: string;
  phase: string;
  status: string;
  tone: Tone;
  /** Where from, where to. */
  lines: string[];
}

/** An actor's current order and how it is going, for the management screen. Null with no order. */
export function jobView(w: World, a: Actor): JobView | null {
  const j = a.job;
  if (!j) return null;
  let title = "ORDER", progress = "", lines: string[] = [];
  if (j.kind === "gatherDeposit") {
    title = `GATHER ${ITEM_NAMES[j.args.resource as ItemId] ?? "?"}`; progress = amountText(j);
    lines = [`FROM ${areaName(String(j.args.fromArea))}`, `TO ${refLabel(w, j.args.storage as unknown as PropRef)}`];
  } else if (j.kind === "craftAt") {
    title = `CRAFT ${CRAFT_RECIPES.find((r) => r.id === j.args.recipe)?.name ?? "?"}`; progress = amountText(j);
    lines = [`AT ${refLabel(w, j.args.station as unknown as PropRef)}`];
  } else if (j.kind === "walk") {
    title = `GO TO ${areaName(String(j.args.area))}`;
    lines = [`${Math.round(Number(j.args.x))},${Math.round(Number(j.args.y))}`];
  }
  const phase = j.transit || a.task?.effect?.op === "travel" ? "TRAVELLING" : PHASE_TEXT[j.phase] ?? j.phase.toUpperCase();
  let status = "WORKING", tone: Tone = "ok";
  if (j.status === "done") { status = "DONE"; tone = "dim"; }
  else if (j.status === "blocked") { status = `BLOCKED: ${blockText(j.reason)}`; tone = "bad"; }
  else if (j.status === "paused") { status = j.reason === "power" ? "WAITING FOR POWER" : "PAUSED"; tone = "warn"; }
  return { title, progress, phase: j.status === "done" ? "FINISHED" : phase, status, tone, lines };
}

/** One line for the head of the screen: what the body is doing. */
export function workerStatus(w: World, a: Actor): { text: string; tone: Tone } {
  const v = jobView(w, a);
  if (v) return { text: v.status, tone: v.tone };
  return powered(a) ? { text: "IDLE: NO ORDER", tone: "dim" } : { text: "OFF: NO POWER", tone: "bad" };
}
