// Requirement checks shared by interaction rules, capacity tiers and build
// recipes. Kept separate so inventory/tasks/interact can all use it without
// import cycles.
import type { Requirement } from "../content/interactions";
import { hasFlag, isBodyFlag, actorHasFlag, type Actor, type World } from "../world/world";
import { toolBonus } from "./tools";

export function meets(w: World, a: Actor, req?: Requirement): boolean {
  if (!req) return true;
  if (req.items && !req.items.every((i) => a.inventory.some((s) => s?.item === i))) return false;
  if (req.flags && !req.flags.every((f) => isBodyFlag(f) ? actorHasFlag(a, f) : hasFlag(w, f))) return false;
  if (req.actorFlags && !req.actorFlags.every((f) => a.upgrades.includes(f))) return false;
  if (req.worn && !req.worn.every((i) => Object.values(a.gear ?? {}).includes(i))) return false;
  if (req.tools && !req.tools.every((t) => toolBonus(a, t) > 0)) return false;
  if (req.any && !req.any.some((r) => meets(w, a, r))) return false;
  return true;
}
