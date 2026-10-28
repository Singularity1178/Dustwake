import { actorDef } from "../content/actors";
import { POWER_CORES } from "../content/power";
import type { ItemId } from "../content/items";
import { areaOf, emit, type Actor, type World } from "../world/world";
import { countItem, giveItem, removeItems } from "./inventory";
import { powered } from "./actorStats";
import { lineOfSight } from "./navigation";
import { actorMessage } from "./messages";

export function coreCheck(a: Actor, item: ItemId) {
  const core = POWER_CORES[item], req = actorDef(a).power;
  const accepts = !!core && !!req && core.family === req.family;
  return { accepts, sufficient: accepts && core!.tier >= req!.tier };
}

/** Insertion is allowed even when the tier is insufficient (the guardian).
 * Work remains unpowered. A replacement returns the previous core, never eats it. */
export function insertPowerCore(w: World, source: Actor, target: Actor, item: ItemId): boolean {
  if (source.area !== target.area || Math.hypot(source.x - target.x, source.y - target.y) > actorDef(target).body.reach + 8) return false;
  if (!lineOfSight(areaOf(w, source), source, target)) return false;
  if (!coreCheck(target, item).accepts || countItem(source, item) < 1) return false;
  const old = target.powerCore;
  removeItems(source, item);
  target.powerCore = item;
  if (old) giveItem(w, source, old);
  emit(w, { t: "powerChanged", actor: target.id, powered: powered(target) });
  return true;
}

export function removePowerCore(w: World, source: Actor, target: Actor): boolean {
  if (!target.powerCore || source.area !== target.area || Math.hypot(source.x - target.x, source.y - target.y) > actorDef(target).body.reach + 8) return false;
  if (!lineOfSight(areaOf(w, source), source, target)) return false;
  const old = target.powerCore;
  target.powerCore = null;
  giveItem(w, source, old);
  emit(w, { t: "powerChanged", actor: target.id, powered: powered(target) });
  return true;
}

// ---------------------------------------------------------------- the slot seam
// Slotting and removing share one path: CORE_TASK with the `slotCore` effect
// (sim/commands.ts: orderCoreSwap starts it; the C key picks the action), and
// one `coreSlotted` event the host answers. A management screen later issues
// the same order with an explicit choice. Nothing here creates or deletes a
// core: insertion takes it from the pack, removal gives it back (a full pack
// drops it on the ground through giveItem), a replacement returns the old one.

/** What slotting would do to `target`: take its core out, put in the first core `a` carries that fits, or nothing (why). */
export type CoreAction = { op: "insert"; item: ItemId } | { op: "remove"; item: ItemId } | { op: "none"; reason: "noSocket" | "noCore" };
export function coreActionFor(a: Actor, target: Actor): CoreAction {
  if (!actorDef(target).power) return { op: "none", reason: "noSocket" };
  if (target.powerCore) return { op: "remove", item: target.powerCore };
  const slot = a.inventory.find((s) => !!s && coreCheck(target, s.item).accepts);
  return slot ? { op: "insert", item: slot.item } : { op: "none", reason: "noCore" };
}

export const CORE_TEXT = {
  reach: "STEP UP TO IT TO REACH ITS CORE",
  noCore: "YOU CARRY NO CORE THAT FITS IT",
  empty: "IT HOLDS NO CORE",
} as const;

/**
 * The `slotCore` effect, when the reach lands: insert `item` (or remove the
 * core with null), re-validated by insertPowerCore / removePowerCore (reach,
 * sight, fit, the item still carried). On success emits `coreSlotted`, the
 * player's event (powerChanged belongs to the body), with the body's power after.
 */
export function applySlotCore(w: World, a: Actor, target: Actor | undefined, item: ItemId | null): boolean {
  if (!target) return false;
  const old = target.powerCore;
  if (!item && !old) { actorMessage(w, a, CORE_TEXT.empty); return false; }
  const ok = item ? insertPowerCore(w, a, target, item) : removePowerCore(w, a, target);
  if (!ok) { actorMessage(w, a, item && countItem(a, item) < 1 ? CORE_TEXT.noCore : CORE_TEXT.reach); return false; }
  emit(w, { t: "coreSlotted", actor: a.id, target: target.id, item: item ?? old!, inserted: !!item, powered: powered(target) });
  return true;
}