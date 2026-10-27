import { actorDef } from "../content/actors";
import { POWER_CORES } from "../content/power";
import type { ItemId } from "../content/items";
import { areaOf, emit, type Actor, type World } from "../world/world";
import { countItem, giveItem, removeItems } from "./inventory";
import { powered } from "./actorStats";
import { lineOfSight } from "./navigation";

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