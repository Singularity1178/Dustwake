import { HARVEST } from "../content/harvest";
import type { ItemId } from "../content/items";
import type { PropInst } from "../world/area";
import type { Actor } from "../world/world";
import { harvestPower } from "./actorStats";

/** One blow's entitlement, shared by the effect and the job's capacity check. */
export function harvestStep(a: Actor, p: PropInst) {
  const def = HARVEST[p.kind], power = harvestPower(a);
  if (!def || p.taken || !Number.isFinite(power) || power <= 0) return null;
  const before = Math.min(def.hp, p.dmg);
  const after = Math.min(def.hp, Math.round((before + power) * 1e9) / 1e9);
  if (after <= before) return null;
  const depleted = after >= def.hp, rewards = new Map<ItemId, number>();
  const units = Math.floor(after * def.perHit.n + 1e-9) - Math.floor(before * def.perHit.n + 1e-9);
  if (units) rewards.set(def.perHit.item, units);
  if (depleted && def.final) rewards.set(def.final.item, (rewards.get(def.final.item) ?? 0) + def.final.n);
  return { damage: after - before, depleted, rewards: [...rewards].map(([item, n]) => ({ item, n })) };
}