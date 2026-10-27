// Requirement checks shared by interaction rules, capacity tiers and build
// recipes. Kept separate so inventory/tasks/interact can all use it without
// import cycles.
import type { Requirement } from "../content/interactions";
import { hasFlag, isBodyFlag, actorHasFlag, type Actor, type World } from "../world/world";

export function meets(w: World, a: Actor, req?: Requirement) {
  if (!req) return true;
  if (req.items && !req.items.every((i) => a.inventory.some((s) => s?.item === i))) return false;
  if (req.flags && !req.flags.every((f) => isBodyFlag(f) ? actorHasFlag(a, f) : hasFlag(w, f))) return false;
  if (req.actorFlags && !req.actorFlags.every((f) => a.upgrades.includes(f))) return false;
  if (req.worn && !req.worn.every((i) => Object.values(a.gear ?? {}).includes(i))) return false;
  return true;
}
