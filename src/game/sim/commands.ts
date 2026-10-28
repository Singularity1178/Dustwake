// Commands issued by UI screens (pack, build placement, reading). Each one
// validates and then goes through the normal Task/Effect path, so it is data,
// saveable and testable headless.
import { ITEMS, isDroppable, type GearSlot, type ItemId } from "../content/items";
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
import { wearCheck, takeOffCheck, gearRefusal } from "./gear";

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
 * key today, the worker management screen later.
 */
export function orderCoreSwap(w: World, a: Actor, targetId: string, item: ItemId | null): boolean {
  const target = actorById(w, targetId);
  if (a.task || !target || target.id === a.id || target.area !== a.area || !actorDef(target).power) return false;
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
