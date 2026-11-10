// Harvestable props (data). Damage is cumulative work, saved on the prop.
// `perHit` retains its legacy name but pays per whole unit of work, not per
// animation. Actor harvest power scales work; `final` is paid once on depletion.
//
// Depletion is permanent in v1: a tree becomes a stump, a rock is broken up.
// The hook for regrowth is `regrow` (seconds of world time): when set, the
// harvest effect schedules a `regrow` effect in the prop's area, which
// restores it. Nothing uses it yet.
import type { ItemId } from "./items";
import type { ToolType } from "./tools";

export interface HarvestDef {
  hp: number;
  perHit: { item: ItemId; n: number };
  final?: { item: ItemId; n: number };
  regrow?: number;
  /** Once depleted the prop no longer blocks movement (a broken rock vs. a stump). */
  clearBox?: boolean;
  /** The tool type that works this resource: one fitted (or wielded) multiplies each blow (content/tools.ts). Bare fists always work. */
  tool?: ToolType;
}

export const HARVEST: Record<string, HarvestDef> = {
  tree: { hp: 4, perHit: { item: "wood", n: 1 }, final: { item: "wood", n: 2 }, tool: "axe" },
  /** A fallen, rotting trunk: quick wood, and the way opens once it's broken up. */
  log: { hp: 3, perHit: { item: "wood", n: 1 }, final: { item: "wood", n: 1 }, clearBox: true, tool: "axe" },
  rock: { hp: 3, perHit: { item: "stone", n: 1 }, final: { item: "stone", n: 2 }, clearBox: true, tool: "pickaxe" },
  /**
   * An outcrop veined with iron: half a piece per unit of work, so two bare-fisted
   * blows for each piece of ore, three pieces in all. A pickaxe head gets one a blow.
   */
  ironore: { hp: 6, perHit: { item: "iron_ore", n: 0.5 }, clearBox: true, tool: "pickaxe" },
};
