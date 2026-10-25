// Pack capacity tiers (data). Capacity is never stored: it is derived from
// world/actor state each time it's needed. The highest satisfied tier wins, so
// adding a tier (say, a cart) is one more row.
//
// Why flags rather than "owns item X": the iron arm and the basket are *equip*
// items. Picking them up installs them on the golem and sets a `golem.*` flag;
// they never occupy a slot. If capacity came from an item sitting in the pack,
// that item would take one of the slots it grants and could be dropped, which
// would shrink capacity under the player's feet. A flag can't be misplaced.
import type { Requirement } from "./interactions";
import { FLAGS } from "./flags";

export interface CapacityTier { requires?: Requirement; slots: number }

export const CAPACITY_TIERS: CapacityTier[] = [
  { slots: 8 },
  { requires: { flags: [FLAGS.golemArm] }, slots: 16 },
  { requires: { flags: [FLAGS.golemBasket] }, slots: 48 },
];
