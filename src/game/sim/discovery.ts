import { ITEMS, RELICS, type ItemId } from "../content/items";
import type { Actor, World } from "../world/world";
import { hasItem } from "./inventoryOps";

export const relicFlag = (item: ItemId) => `relic.found.${item}`;
export function rememberItem(w: World, a: Actor, item: ItemId) {
  if (a.id === w.playerId && ITEMS[item].tags.includes("relic")) w.flags.add(relicFlag(item));
}
/** Discovery, not possession: dropping or deconstructing a crown keeps credit. */
export const relicCount = (w: World, a: Actor) => RELICS.filter((id) => w.flags.has(relicFlag(id)) || hasItem(a, id)).length;