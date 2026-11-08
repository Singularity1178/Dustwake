// Commands issued by UI screens (pack, build placement, reading). Each one
// validates and then goes through the normal Task/Effect path, so it is data,
// saveable and testable headless.
import { ITEMS, ITEM_NAMES, isDroppable, type GearSlot, type ItemId } from "../content/items";
import { propDef, propReach } from "../content/props";
import { RECIPES, DECONSTRUCT_DUR } from "../content/build";
import { CORE_TASK } from "../content/interactions";
import { actorDef } from "../content/actors";
import { emit, areaOf, actorById, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { CORE_TEXT, coreActionFor, coreCheck } from "./power";
import { countItem } from "./inventory";
import { findTargetIn } from "./interact";
import { applyEffect, beginTask } from "./tasks";
import { placement, BLOCK_TEXT, recipeAnchor, deconstructCheck, deconMessage } from "./build";
import { dropSpot } from "./inventory";
import { actorBoxes } from "./collision";
import { faceTo } from "./tasks";
import { wearCheck, takeOffCheck, gearRefusal, slotsFor } from "./gear";
import { inventoryHandle, packRef, storageRef, transferSlot } from "./storage";
import { orderRefusal, pauseJob, resumeJob, setWorkerOrder, workerRefusal } from "./jobs";
import { powered, cleanActorName, actorLabel } from "./actorStats";
import { actorMessage } from "./messages";
import { cleanPropName, defaultPropName, propName } from "./orders";
import type { JobOrder } from "../world/jobs";

export type DropResult = "ok" | "empty" | "undroppable" | "noRoom";

/**
 * Drop one unit from a slot (pack open, world paused). Applied immediately via
 * applyEffect so the result is visible at once; NPCs can queue the same
 * `{op: "drop"}` effect as a task.
 */
export function dropFromSlot(w: World, a: Actor, slot: number, n = 1): DropResult {
  const s = a.inventory[slot];
  if (!s) return "empty";
  if (!isDroppable(s.item)) { emit(w, { t: "message", text: "THAT IS TOO IMPORTANT TO DROP" }); return "undroppable"; }
  if (!dropSpot(areaOf(w, a), a, actorBoxes(w, a.area, a.id))) { emit(w, { t: "message", text: "NO ROOM TO DROP IT HERE" }); return "noRoom"; }
  applyEffect(w, a, { op: "drop", slot, n });
  return "ok";
}

export type GearResult = "ok" | "empty" | "notWearable" | "noSlot" | "noRoom";

/**
 * Put on the gear in a pack slot (pack open, world paused), applied at once
 * like dropping: the basket goes onto the golem's back and the pack grows, a
 * rune goes into a rune slot. With no usable slot for it, it is refused.
 * NPCs can queue the same `{op: "wear"}` effect as a task.
 */
export function wearFromSlot(w: World, a: Actor, slot: number, into?: GearSlot): GearResult {
  const chk = wearCheck(w, a, slot, into);
  if (!chk.ok) { if (chk.reason !== "empty") emit(w, { t: "message", text: gearRefusal(chk) }); return chk.reason; }
  applyEffect(w, a, { op: "wear", slot, into });
  return "ok";
}

/**
 * Take off what is worn in a gear slot, back into the pack. Refused, with a
 * message and no change at all, unless everything (the item itself included)
 * still fits once the pack shrinks. Nothing is ever dropped by it.
 */
export function takeOffGear(w: World, a: Actor, gear: GearSlot): GearResult {
  const chk = takeOffCheck(w, a, gear);
  if (!chk.ok) { if (chk.reason !== "empty") emit(w, { t: "message", text: gearRefusal(chk) }); return chk.reason; }
  applyEffect(w, a, { op: "takeOff", gear });
  return "ok";
}

/** Confirm a placement: start the build task (the effect re-validates when it fires). */
export function orderBuild(w: World, a: Actor, recipe: string, tx: number, ty: number): boolean {
  const ok = placement(w, a, areaOf(w, a), recipe, tx, ty);
  if (!ok.ok) { emit(w, { t: "message", text: BLOCK_TEXT[ok.reason] }); return false; }
  const at = recipeAnchor(recipe, tx, ty);
  faceTo(a, at.x, at.y - 4);
  beginTask(a, { kind: "reach", dur: RECIPES[recipe].dur ?? 0.7, effect: { op: "build", recipe, tx, ty } }, { kind: "build", x: at.x, y: at.y, tx, ty });
  return true;
}

/**
 * Confirm a deconstruction: start a `dismantle` task aimed at the prop. The
 * `deconstruct` effect re-validates when it fires and refunds the full cost.
 */
export function orderDeconstruct(w: World, a: Actor, propId: string): boolean {
  const chk = deconstructCheck(w, a, areaOf(w, a), propId);
  if (!chk.ok) { emit(w, { t: "message", text: deconMessage(chk) }); return false; }
  const p = chk.prop;
  faceTo(a, p.x, p.y - 4);
  beginTask(a, { kind: "dismantle", dur: DECONSTRUCT_DUR, effect: { op: "deconstruct" } }, { kind: "deconstruct", x: p.x, y: p.y, propId: p.id });
  return true;
}

/** Reading a book or document: grants its knowledge flag (once). */
export function readItem(w: World, a: Actor, id: ItemId) {
  const g = ITEMS[id].book?.grants;
  if (g) applyEffect(w, a, { op: "learn", flag: g });
}

/**
 * Order a power-core swap on the body `targetId`: slot `item` from the pack, or
 * take its core out (`item: null`). Validates now (same area, a body that takes
 * cores, the core carried and fitting, something to take out) and starts the
 * short CORE_TASK whose `slotCore` effect re-validates reach and sight when it
 * lands (sim/power.ts: applySlotCore). The one entry point for both ways: the C
 * key and the worker management screen (screens/manage.ts). The reach that
 * opened that screen may still be finishing beneath it (it already fired), so
 * it does not count as busy, as for a crafting bench.
 */
export function orderCoreSwap(w: World, a: Actor, targetId: string, item: ItemId | null): boolean {
  const target = actorById(w, targetId);
  const opening = !!a.task?.fired && a.task.effect?.op === "manageActor";
  if ((a.task && !opening) || !target || target.id === a.id || target.area !== a.area || !actorDef(target).power) return false;
  if (item && !(coreCheck(target, item).accepts && countItem(a, item) > 0)) { emit(w, { t: "message", text: CORE_TEXT.noCore }); return false; }
  if (!item && !target.powerCore) { emit(w, { t: "message", text: CORE_TEXT.empty }); return false; }
  faceTo(a, target.x, target.y - 6);
  beginTask(a, { ...CORE_TASK, effect: { op: "slotCore", item } }, { kind: "core", x: target.x, y: target.y, actorId: target.id });
  return true;
}

/** The body in front of `a` that takes a power core (any actor whose definition needs power), within its reach. */
export function coreTargetFor(w: World, a: Actor, area: Area): Actor | undefined {
  const bodies = w.actors.filter((x) => x.id !== a.id && x.area === area.id && !!actorDef(x).power)
    .map((x) => ({ kind: "core", x: x.x, y: x.y + 2, r: actorDef(x).body.reach, actorId: x.id }));
  const it = findTargetIn(bodies, a);
  return it?.actorId ? actorById(w, it.actorId) : undefined;
}

/**
 * The C key on the play screen: a deliberate input of its own, never E (E on
 * the guardian always talks). Facing a body that takes cores, it takes the core
 * out if there is one, else slots the first fitting core carried. Nothing in
 * front: nothing happens. Returns whether work started.
 */
export function coreKey(w: World, a: Actor, area: Area): boolean {
  if (a.task) return false;
  const target = coreTargetFor(w, a, area);
  if (!target) return false;
  const act = coreActionFor(a, target);
  if (act.op === "none") { emit(w, { t: "message", text: CORE_TEXT.noCore }); return false; }
  return orderCoreSwap(w, a, target.id, act.op === "insert" ? act.item : null);
}

// ---------------------------------------------------------------- storage screen
export type StoreResult = "ok" | "partial" | "empty" | "full" | "critical" | "gone" | "far";
export interface StoreOutcome { result: StoreResult; moved: number; text: string }
export const STORE_TEXT = {
  empty: "NOTHING THERE TO MOVE",
  critical: "TOO IMPORTANT TO STORE",
  gone: "THE STORAGE IS GONE",
  far: "STEP UP TO THE STORAGE",
  chestFull: "THE STORAGE IS FULL",
  packFull: "YOUR PACK IS FULL",
} as const;

/**
 * The storage screen's one move: up to `n` of what pack slot `slot` holds into
 * the storage prop (`store`), or out of its slot into the pack (`take`). Applied
 * at once, like dropping, through sim/storage.ts: as much as fits moves, the
 * rest stays where it was, and a refusal changes nothing. Items the golem can't
 * even drop (the tutorial's) are never stored, so progress can't be put out of
 * reach. Says what happened as a player message and returns it.
 */
export function moveStorageSlot(w: World, a: Actor, propId: string, dir: "store" | "take", slot: number, n: number): StoreOutcome {
  const out = (result: StoreResult, moved: number, text: string): StoreOutcome => { actorMessage(w, a, text); return { result, moved, text }; };
  const area = areaOf(w, a), p = area.prop(propId);
  if (!p?.inventory || !propDef(p.kind).storage) return out("gone", 0, STORE_TEXT.gone);
  if (Math.hypot(a.x - p.x, a.y - p.y) > propReach(p.kind) + 8) return out("far", 0, STORE_TEXT.far);
  const chest = storageRef(area.id, p.id), pack = packRef(a);
  const from = dir === "store" ? pack : chest, to = dir === "store" ? chest : pack;
  const s = inventoryHandle(w, from)?.inventory[slot];
  if (!s) return out("empty", 0, STORE_TEXT.empty);
  if (dir === "store" && !isDroppable(s.item)) return out("critical", 0, STORE_TEXT.critical);
  const item = s.item, want = Math.max(1, Math.min(Math.floor(n), s.n));
  const moved = transferSlot(w, from, to, slot, want), verb = dir === "store" ? "STORED" : "TOOK";
  const full = dir === "store" ? STORE_TEXT.chestFull : STORE_TEXT.packFull;
  if (!moved) return out("full", 0, full);
  if (moved < want) return out("partial", moved, `${verb} ${moved} OF ${want} ${ITEM_NAMES[item]}. ${full}`);
  return out("ok", moved, `${verb} ${moved} ${ITEM_NAMES[item]}`);
}

/**
 * Rename the storage prop `propId` in the player's area: `name` cleaned (cleanPropName), or empty to go back to
 * its default label ("DUNGEON CHEST 2"). The name is the prop's own (saved with it), so the storage screen and
 * every order that points at the chest show it. Needs the golem beside it, as the screen does. Says what happened.
 */
export function renameStorage(w: World, a: Actor, propId: string, name: string): OrderOutcome {
  const say = (ok: boolean, text: string): OrderOutcome => { actorMessage(w, a, text); return { ok, text }; };
  const area = areaOf(w, a), p = area.prop(propId);
  if (!p?.inventory || !propDef(p.kind).storage) return say(false, STORE_TEXT.gone);
  if (Math.hypot(a.x - p.x, a.y - p.y) > propReach(p.kind) + 8) return say(false, STORE_TEXT.far);
  const clean = cleanPropName(name);
  if (!clean || clean === defaultPropName(area, p)) { area.setPropName(p.id, undefined); return say(true, `NAMED ${propName(area, p)}`); }
  area.setPropName(p.id, clean);
  return say(true, `NAMED ${clean}`);
}

// ---------------------------------------------------------------- management screen
export interface OrderOutcome { ok: boolean; text: string }
export const ORDER_TEXT = { given: "ORDER GIVEN", waits: "ORDER GIVEN. IT WAITS FOR A CORE" } as const;

/**
 * Give a worker an order from the management screen: setWorkerOrder, with its
 * refusal (out of reach, no sight, not a worker, unknown or invalid order, can't
 * do that work, busy) said in words. The order replaces the one it had.
 */
export function giveWorkerOrder(w: World, a: Actor, targetId: string, order: JobOrder): OrderOutcome {
  const why = orderRefusal(w, a, targetId, order);
  if (why) { actorMessage(w, a, why); return { ok: false, text: why }; }
  const target = actorById(w, targetId)!;
  if (!setWorkerOrder(w, a, targetId, order)) { const text = "IT WILL NOT TAKE THE ORDER"; actorMessage(w, a, text); return { ok: false, text }; }
  const text = powered(target) ? ORDER_TEXT.given : ORDER_TEXT.waits;
  actorMessage(w, a, text);
  return { ok: true, text };
}

export type WorkerControl = "pause" | "resume" | "cancel";
/** Pause, resume (or retry a blocked order) or cancel a worker's order: pauseJob / resumeJob / setWorkerOrder(null), behind the same reach and sight rules. */
export function controlWorker(w: World, a: Actor, targetId: string, what: WorkerControl): OrderOutcome {
  const say = (ok: boolean, text: string): OrderOutcome => { actorMessage(w, a, text); return { ok, text }; };
  const why = workerRefusal(w, a, targetId);
  if (why) return say(false, why);
  const target = actorById(w, targetId)!, job = target.job;
  if (!job) return say(false, "IT HAS NO ORDER");
  if (what === "cancel") { setWorkerOrder(w, a, targetId, null); return say(true, "ORDER CANCELLED"); }
  if (job.status === "done") return say(false, "THAT ORDER IS DONE");
  if (what === "pause") {
    if (job.status === "paused" && job.reason === "manual") return say(false, "IT IS ALREADY PAUSED");
    pauseJob(w, target);
    return say(true, "ORDER PAUSED");
  }
  if (job.status === "running") return say(false, "IT IS ALREADY WORKING");
  resumeJob(w, target);
  return say(true, powered(target) ? "ORDER RESUMED" : "NO POWER. IT WAITS FOR A CORE");
}


// ---------------------------------------------------------------- naming and transfer
/**
 * Give an orderable body (a worker) a name of its own, or clear it (empty). The name goes in front of its kind
 * everywhere it is shown ("BOB - WORKER GOLEM"). Needs the commander within reach and in sight, as the orders do.
 */
export function renameActor(w: World, a: Actor, targetId: string, name: string): OrderOutcome {
  const say = (ok: boolean, text: string): OrderOutcome => { actorMessage(w, a, text); return { ok, text }; };
  const why = workerRefusal(w, a, targetId);
  if (why) return say(false, why);
  const target = actorById(w, targetId)!, clean = cleanActorName(name);
  if (clean) target.name = clean; else delete target.name;
  return say(true, clean ? `NAMED ${actorLabel(target)}` : `NAME CLEARED`);
}

export interface TransferOutcome { ok: boolean; moved: number; text: string }
export const TRANSFER_TEXT = {
  empty: "NOTHING THERE TO MOVE",
  critical: "TOO IMPORTANT TO GIVE AWAY",
  theirFull: "ITS PACK IS FULL",
  packFull: "YOUR PACK IS FULL",
  noWear: "IT CAN'T WEAR THAT",
} as const;

/**
 * The transfer screen's move: up to `n` of what slot `slot` holds goes from the commander's pack to the worker's
 * (`give`) or from the worker's to the commander's (`take`). As much as fits moves, the rest stays; a refusal
 * changes nothing. Items the golem can't even drop (the tutorial's) are never given away.
 */
export function transferWithActor(w: World, a: Actor, targetId: string, dir: "give" | "take", slot: number, n: number): TransferOutcome {
  const out = (ok: boolean, moved: number, text: string): TransferOutcome => { actorMessage(w, a, text); return { ok, moved, text }; };
  const why = workerRefusal(w, a, targetId);
  if (why) return out(false, 0, why);
  const target = actorById(w, targetId)!;
  const from = dir === "give" ? packRef(a) : packRef(target), to = dir === "give" ? packRef(target) : packRef(a);
  const s = inventoryHandle(w, from)?.inventory[slot];
  if (!s) return out(false, 0, TRANSFER_TEXT.empty);
  if (dir === "give" && !isDroppable(s.item)) return out(false, 0, TRANSFER_TEXT.critical);
  const item = s.item, want = Math.max(1, Math.min(Math.floor(n), s.n));
  const moved = transferSlot(w, from, to, slot, want), full = dir === "give" ? TRANSFER_TEXT.theirFull : TRANSFER_TEXT.packFull;
  if (!moved) return out(false, 0, full);
  const verb = dir === "give" ? "GAVE" : "TOOK";
  if (moved < want) return out(true, moved, `${verb} ${moved} OF ${want} ${ITEM_NAMES[item]}. ${full}`);
  return out(true, moved, `${verb} ${moved} ${ITEM_NAMES[item]}`);
}

/**
 * Put gear on the worker (a rune into its rune slot). `from` says whose pack slot `slot` is: the commander's (one
 * of the stack goes across first) or the worker's own. If it can't be worn the item goes back where it came from
 * and nothing changes.
 */
export function equipActor(w: World, a: Actor, targetId: string, from: "pack" | "carry", slot: number): TransferOutcome {
  const out = (ok: boolean, text: string): TransferOutcome => { actorMessage(w, a, text); return { ok, moved: ok ? 1 : 0, text }; };
  const why = workerRefusal(w, a, targetId);
  if (why) return out(false, why);
  const target = actorById(w, targetId)!;
  const src = from === "pack" ? a : target, s = src.inventory[slot];
  if (!s) return out(false, TRANSFER_TEXT.empty);
  const item = s.item;
  if (!ITEMS[item].wear || !slotsFor(w, target, item).length) return out(false, TRANSFER_TEXT.noWear);
  let at = slot;
  if (from === "pack") {
    if (!isDroppable(item)) return out(false, TRANSFER_TEXT.critical);
    if (!transferSlot(w, packRef(a), packRef(target), slot, 1)) return out(false, TRANSFER_TEXT.theirFull);
    at = target.inventory.findIndex((x) => x?.item === item);
  }
  const chk = wearCheck(w, target, at);
  if (!chk.ok) {
    if (from === "pack") transferSlot(w, packRef(target), packRef(a), at, 1);
    return out(false, gearRefusal(chk));
  }
  applyEffect(w, target, { op: "wear", slot: at });
  return out(true, `${actorLabel(target)} WEARS ${ITEM_NAMES[item]}`);
}

/** Take what the worker wears in `gear` off, into its own pack (refused, changing nothing, if it doesn't fit). */
export function unequipActor(w: World, a: Actor, targetId: string, gear: GearSlot): TransferOutcome {
  const out = (ok: boolean, text: string): TransferOutcome => { actorMessage(w, a, text); return { ok, moved: ok ? 1 : 0, text }; };
  const why = workerRefusal(w, a, targetId);
  if (why) return out(false, why);
  const target = actorById(w, targetId)!, chk = takeOffCheck(w, target, gear);
  if (!chk.ok) return out(false, chk.reason === "empty" ? "NOTHING WORN THERE" : gearRefusal(chk));
  applyEffect(w, target, { op: "takeOff", gear });
  return out(true, `TOOK OFF ${ITEM_NAMES[chk.item]}`);
}
