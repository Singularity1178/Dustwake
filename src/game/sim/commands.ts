// Commands issued by UI screens (pack, build placement, reading). Each one
// validates and then goes through the normal Task/Effect path, so it is data,
// saveable and testable headless.
import { ITEMS, isDroppable, type ItemId } from "../content/items";
import { RECIPES } from "../content/build";
import { emit, areaOf, type Actor, type World } from "../world/world";
import { applyEffect, beginTask } from "./tasks";
import { placement, BLOCK_TEXT, buildAnchor } from "./build";
import { dropSpot } from "./inventory";
import { faceTo } from "./tasks";

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
  if (!dropSpot(areaOf(w, a), a)) { emit(w, { t: "message", text: "NO ROOM TO DROP IT HERE" }); return "noRoom"; }
  applyEffect(w, a, { op: "drop", slot, n });
  return "ok";
}

/** Confirm a placement: start the build task (the effect re-validates when it fires). */
export function orderBuild(w: World, a: Actor, recipe: string, tx: number, ty: number): boolean {
  const ok = placement(w, a, areaOf(w, a), recipe, tx, ty);
  if (!ok.ok) { emit(w, { t: "message", text: BLOCK_TEXT[ok.reason] }); return false; }
  const at = buildAnchor(tx, ty);
  faceTo(a, at.x, at.y - 4);
  beginTask(a, { kind: "reach", dur: 0.7, effect: { op: "build", recipe, tx, ty } }, { kind: "build", x: at.x, y: at.y, tx, ty });
  return RECIPES[recipe] !== undefined;
}

/** Reading a book or document: grants its knowledge flag (once). */
export function readItem(w: World, a: Actor, id: ItemId) {
  const g = ITEMS[id].book?.grants;
  if (g) applyEffect(w, a, { op: "learn", flag: g });
}
