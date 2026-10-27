import { actorDef } from "../content/actors";
import { POWER_CORES } from "../content/power";
import type { Actor, World } from "../world/world";
import { meets } from "./requirements";
import { speedMultiplier } from "./gear";

export function powered(a: Actor): boolean {
  const req = actorDef(a).power;
  if (!req) return true;
  const core = a.powerCore && POWER_CORES[a.powerCore];
  return !!core && core.family === req.family && core.tier >= req.tier;
}
export function powerEffects(a: Actor) {
  return powered(a) && a.powerCore ? POWER_CORES[a.powerCore]?.effects : undefined;
}
export function actorSpeed(w: World, a: Actor): number {
  const d = actorDef(a);
  let speed = d.speed;
  for (const t of d.speedTiers ?? []) if (meets(w, a, t.requires)) speed = Math.max(speed, t.speed);
  return powered(a) ? speed * speedMultiplier(w, a) * Math.max(0, 1 + (powerEffects(a)?.speed ?? 0)) : 0;
}
export const harvestPower = (a: Actor) => powered(a) ? Math.max(0, actorDef(a).harvestPower * (1 + (powerEffects(a)?.harvest ?? 0))) : 0;