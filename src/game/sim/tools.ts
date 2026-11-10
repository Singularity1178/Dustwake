// Tools at work (content/tools.ts). Pure sim, and deliberately small: it reads
// only the actor, so requirement checks, harvesting and digging can all use it
// without an import cycle.
//
// A head counts while it is fitted to an arm slot. Gear in a slot that is not
// usable is put back in the pack every world step (sim/gear.ts: reconcileGear),
// so whatever `Actor.gear` holds is in use. A hafted tool counts in the pack of
// a body that can `wield` (the workers); the maintainer fits heads instead.
import { ITEMS, type ItemId } from "../content/items";
import { capable } from "../content/actors";
import type { ToolType } from "../content/tools";
import type { Actor } from "../world/world";

/** The tools working for `a` right now. */
export function activeTools(a: Actor): ItemId[] {
  const out: ItemId[] = [];
  for (const id of Object.values(a.gear ?? {})) if (id && ITEMS[id]?.tool?.form === "head") out.push(id);
  if (capable(a, "wield")) for (const s of a.inventory) if (s && ITEMS[s.item]?.tool?.form === "full") out.push(s.item);
  return out;
}

/** The best bonus `a` has for a tool type (0: none working). Two of a kind do not add: the better one counts. */
export function toolBonus(a: Actor, type: ToolType | undefined): number {
  if (!type) return 0;
  let best = 0;
  for (const id of activeTools(a)) { const t = ITEMS[id].tool!; if (t.type === type && t.bonus > best) best = t.bonus; }
  return best;
}
