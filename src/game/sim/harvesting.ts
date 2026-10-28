import { HARVEST } from "../content/harvest";
import type { ItemId } from "../content/items";
import type { Area, PropInst } from "../world/area";
import type { Actor } from "../world/world";
import { harvestPower } from "./actorStats";

/**
 * The harvestable props a blow at (x, y) reaches: every standing tree, rock or
 * log with some part of its footprint (its collision box, or just its anchor if
 * it has none) within `radius` of the blow. The golem's own position is
 * irrelevant, as for every slam target. Nearest first, ties by id, so the order
 * is deterministic. Depleted props are not harvestable and are left out.
 */
export function harvestReach(area: Area, x: number, y: number, radius: number): PropInst[] {
  const found: { p: PropInst; d2: number }[] = [];
  for (const p of area.props) {
    if (p.taken || !HARVEST[p.kind]) continue;
    const b = p.box ?? [p.x, p.y, p.x, p.y];
    const dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]);
    const d2 = dx * dx + dy * dy;
    if (d2 <= radius * radius) found.push({ p, d2 });
  }
  return found.sort((a, b) => a.d2 - b.d2 || (a.p.id < b.p.id ? -1 : 1)).map((f) => f.p);
}

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