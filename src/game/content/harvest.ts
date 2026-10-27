// Harvestable props (data). Damage is cumulative work, saved on the prop.
// `perHit` retains its legacy name but pays per whole unit of work, not per
// animation. Actor harvest power scales work; `final` is paid once on depletion.
//
// Depletion is permanent in v1: a tree becomes a stump, a rock is broken up.
// The hook for regrowth is `regrow` (seconds of world time): when set, the
// harvest effect schedules a `regrow` effect in the prop's area, which
// restores it. Nothing uses it yet.
import type { ItemId } from "./items";

export interface HarvestDef {
  hp: number;
  perHit: { item: ItemId; n: number };
  final?: { item: ItemId; n: number };
  regrow?: number;
  /** Once depleted the prop no longer blocks movement (a broken rock vs. a stump). */
  clearBox?: boolean;
}

export const HARVEST: Record<string, HarvestDef> = {
  tree: { hp: 4, perHit: { item: "wood", n: 1 }, final: { item: "wood", n: 2 } },
  /** A fallen, rotting trunk: quick wood, and the way opens once it's broken up. */
  log: { hp: 3, perHit: { item: "wood", n: 1 }, final: { item: "wood", n: 1 }, clearBox: true },
  rock: { hp: 3, perHit: { item: "stone", n: 1 }, final: { item: "stone", n: 2 }, clearBox: true },
};
