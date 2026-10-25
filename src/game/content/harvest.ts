// Harvestable props (data). Each blow of the golem's fists deals 1 damage,
// which is stored on the prop (Area.damageProp) so it saves and any actor's
// blows accumulate. Every blow yields `perHit`; the blow that depletes it
// also yields `final`.
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
  rock: { hp: 3, perHit: { item: "stone", n: 1 }, final: { item: "stone", n: 2 }, clearBox: true },
};
