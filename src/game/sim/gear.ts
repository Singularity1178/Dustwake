// Gear: items worn on the body in named slots (Actor.gear; only the back so
// far). Gear belongs to the actor, like its pack, so any golem or NPC could
// wear things later. A worn item is not in the pack, and capacity tiers can
// require worn items (content/inventory.ts): putting the basket on grows the
// pack, taking it off shrinks it. Taking gear off is refused unless everything
// still fits afterwards, counting how stacks merge and the item itself, which
// needs a slot back in the pack. A refusal changes nothing, and nothing is
// ever dropped or lost by it. Pure sim (no DOM). The pack screen goes through
// sim/commands.ts (wearFromSlot / takeOffGear); any actor can run the same
// "wear" / "takeOff" effects as tasks (sim/tasks.ts).
import { ITEMS, ITEM_NAMES, type GearSlot, type ItemId } from "../content/items";
import { emit, type Actor, type Gear, type World } from "../world/world";
import { capacity, giveItem, reconcileCapacity, repackInto, slotsNeeded, type Stack } from "./inventory";

/** What `a` wears in `slot` (undefined: the slot is empty). */
export const wornIn = (a: Actor, slot: GearSlot): ItemId | undefined => a.gear[slot];
/** Is `a` wearing `id`, in any slot? */
export const wears = (a: Actor, id: ItemId) => Object.values(a.gear).includes(id);

/** The capacity `a` would have wearing `gear` instead of what it wears now. */
export function capacityWith(w: World, a: Actor, gear: Gear): number {
  return capacity(w, { ...a, gear });
}

export type GearCheck =
  | { ok: true; item: ItemId; slot: GearSlot }
  | { ok: false; reason: "empty" | "notWearable" | "noRoom"; item?: ItemId; over?: number };

/** The pack as stacks, optionally with one unit taken out of pack slot `minus`. */
function packStacks(a: Actor, minus = -1): Stack[] {
  return a.inventory.flatMap((s, i) => {
    if (!s) return [];
    const n = i === minus ? s.n - 1 : s.n;
    return n > 0 ? [{ item: s.item, n }] : [];
  });
}

/**
 * Can `a` put on the item in pack slot `slot`? Whatever it wears in that gear
 * slot now swaps into the pack slot being freed, so a swap needs no extra
 * room, unless the new gear grants fewer slots: then everything must still fit.
 */
export function wearCheck(w: World, a: Actor, slot: number): GearCheck {
  const s = a.inventory[slot];
  if (!s) return { ok: false, reason: "empty" };
  const g = ITEMS[s.item].wear;
  if (!g) return { ok: false, reason: "notWearable", item: s.item };
  const prev = a.gear[g.slot];
  if (prev) {
    const need = slotsNeeded([...packStacks(a, slot), { item: prev, n: 1 }]);
    const cap = capacityWith(w, a, { ...a.gear, [g.slot]: s.item });
    if (need > cap) return { ok: false, reason: "noRoom", item: prev, over: need - cap };
  }
  return { ok: true, item: s.item, slot: g.slot };
}

/**
 * Can `a` take off what it wears in `slot`? Only if, at the capacity it would
 * have afterwards, the pack holds everything it holds now plus the item itself.
 */
export function takeOffCheck(w: World, a: Actor, slot: GearSlot): GearCheck {
  const item = a.gear[slot];
  if (!item) return { ok: false, reason: "empty" };
  const after: Gear = { ...a.gear };
  delete after[slot];
  const need = slotsNeeded([...packStacks(a), { item, n: 1 }]);
  const cap = capacityWith(w, a, after);
  if (need > cap) return { ok: false, reason: "noRoom", item, over: need - cap };
  return { ok: true, item, slot };
}

/** Put on the item in pack slot `slot`. Re-validates; a refusal changes nothing. */
export function applyWear(w: World, a: Actor, slot: number): GearCheck {
  const chk = wearCheck(w, a, slot);
  if (!chk.ok) return chk;
  const s = a.inventory[slot]!;
  s.n -= 1;
  if (s.n === 0) a.inventory[slot] = null;
  const prev = a.gear[chk.slot];
  a.gear[chk.slot] = chk.item;
  const extra: Stack[] = [];
  if (prev) {
    if (!a.inventory[slot]) a.inventory[slot] = { item: prev, n: 1 };
    else extra.push({ item: prev, n: 1 });
  }
  // Fit the pack to the new capacity: it grows (empty slots appended, nothing
  // moves); a swap to gear granting less was checked to fit above.
  if (!repackInto(a, capacity(w, a), extra)) { reconcileCapacity(w, a); for (const x of extra) giveItem(w, a, x.item, x.n); }
  if (prev) emit(w, { t: "gearOff", actor: a.id, item: prev, slot: chk.slot });
  emit(w, { t: "gearOn", actor: a.id, item: chk.item, slot: chk.slot });
  return chk;
}

/** Take off what `a` wears in `slot`, into the pack. Re-validates; a refusal changes nothing. */
export function applyTakeOff(w: World, a: Actor, slot: GearSlot): GearCheck {
  const chk = takeOffCheck(w, a, slot);
  if (!chk.ok) return chk;
  delete a.gear[slot];
  if (!repackInto(a, capacity(w, a), [{ item: chk.item, n: 1 }])) {
    // Unreachable (the check guarantees the fit), but never drop or lose anything.
    a.gear[slot] = chk.item;
    return { ok: false, reason: "noRoom", item: chk.item, over: 1 };
  }
  emit(w, { t: "gearOff", actor: a.id, item: chk.item, slot });
  return chk;
}

/**
 * Make sure `a` wears `item` (debug kits): put on the one in its pack if it
 * has one, else a new one straight onto the body. False if `item` isn't gear
 * or its slot already holds something else.
 */
export function ensureWorn(w: World, a: Actor, item: ItemId): boolean {
  if (wears(a, item)) return true;
  const g = ITEMS[item].wear;
  if (!g || a.gear[g.slot]) return false;
  const i = a.inventory.findIndex((s) => s?.item === item);
  if (i >= 0) return applyWear(w, a, i).ok;
  a.gear[g.slot] = item;
  reconcileCapacity(w, a);
  return true;
}

/** What to tell the player when gear can't be put on or taken off. */
export function gearRefusal(chk: GearCheck): string {
  if (chk.ok) return "";
  if (chk.reason === "notWearable") return "THAT CAN'T BE WORN";
  if (chk.reason === "empty") return "NOTHING TO TAKE OFF";
  const k = chk.over ?? 1;
  return `TOO MUCH TO CARRY WITHOUT THE ${ITEM_NAMES[chk.item!]} - FREE ${k} SLOT${k === 1 ? "" : "S"}`;
}
