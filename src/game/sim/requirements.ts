// Requirement checks shared by interaction rules, capacity tiers and build
// recipes. Kept separate so inventory/tasks/interact can all use it without
// import cycles.
import type { Requirement } from "../content/interactions";
import { hasFlag, type Actor, type World } from "../world/world";

export function meets(w: World, a: Actor, req?: Requirement) {
  if (!req) return true;
  if (req.items && !req.items.every((i) => a.inventory.some((s) => s?.item === i))) return false;
  if (req.flags && !req.flags.every((f) => hasFlag(w, f))) return false;
  return true;
}
