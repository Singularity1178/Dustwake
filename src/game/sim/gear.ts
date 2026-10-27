// Gear: items worn on the body in named slots (Actor.gear: back, helm, two
// arms, a core attachment and four rune slots; content/gear.ts). Gear belongs
// to the actor, like its pack, so any golem or NPC could wear things later. A
// worn item is not in the pack, and capacity tiers can require worn items
// (content/inventory.ts): putting the basket on grows the pack, taking it off
// shrinks it.
//
// Slots can be locked. A slot is usable when its unlock requirement is met (a
// world flag today: content/gear.ts), so opening one later is setting a flag.
// A locked slot takes nothing, and anything found in one (a flag cleared, an
// odd save) goes back to the pack (`reconcileGear`), never deleted.
//
// Taking gear off is refused unless everything still fits afterwards, counting
// how stacks merge and the item itself, which needs a slot back in the pack. A
// refusal changes nothing, and nothing is ever dropped or lost by it.
//
// Effects (runes): `speedMultiplier` and `golemGlow` read only what is worn in
// usable slots, from the item rows (ItemDef.worn), so an effect lasts exactly
// as long as the item is equipped. Pure sim (no DOM). The pack screen goes
// through sim/commands.ts (wearFromSlot / takeOffGear); any actor can run the
// same "wear" / "takeOff" effects as tasks (sim/tasks.ts).
import { ITEMS, ITEM_NAMES, type GearSlot, type ItemId } from "../content/items";
import { GEAR_SLOT_DEFS, GOLEM_LIGHT, RUNE_SLOTS, slotsOfKind, type GearSlotDef, type GolemLight } from "../content/gear";
import { emit, type Actor, type Gear, type World } from "../world/world";
import { capacity, giveItem, reconcileCapacity, repackInto, slotsNeeded, type Stack } from "./inventory";
import { meets } from "./requirements";
import { actorDef } from "../content/actors";

/** What `a` wears in `slot` (undefined: the slot is empty). */
export const wornIn = (a: Actor, slot: GearSlot): ItemId | undefined => a.gear[slot];
/** Is `a` wearing `id`, in any slot? */
export const wears = (a: Actor, id: ItemId) => Object.values(a.gear).includes(id);

// ---------------------------------------------------------------- slots
/** Can `a` use `slot` right now? A slot with no unlock requirement always can. */
export const slotUsable = (w: World, a: Actor, slot: GearSlot) => actorDef(a).gearSlots.includes(slot) && meets(w, a, actorDef(a).gearUnlocks?.[slot]);
export const usableSlots = (w: World, a: Actor): GearSlot[] => GEAR_SLOT_DEFS.filter((d) => slotUsable(w, a, d.id)).map((d) => d.id);

/** The lines that say why a locked slot is locked (the first `locked` entry whose condition holds). */
export function lockedText(w: World, a: Actor, def: GearSlotDef): string[] {
  if (!actorDef(a).gearSlots.includes(def.id)) return ["THIS BODY HAS NO SUCH SLOT."];
  const row = def.locked?.find((l) => meets(w, a, l.when));
  return row ? row.text : ["LOCKED."];
}

/** Every slot of the item's kind that it may go in and `a` can use, in fill order. */
export function slotsFor(w: World, a: Actor, item: ItemId): GearSlot[] {
  const g = ITEMS[item].wear;
  if (!g) return [];
  return slotsOfKind(g.kind).filter((s) => (!g.slot || g.slot === s) && slotUsable(w, a, s));
}

/** Where `item` would go now: the first empty usable slot of its kind, else the first usable one (swapping what is there). */
export function targetSlot(w: World, a: Actor, item: ItemId): GearSlot | undefined {
  const c = slotsFor(w, a, item);
  return c.find((s) => !a.gear[s]) ?? c[0];
}

/**
 * Anything worn in a slot that is not usable (its flag was cleared, a save from
 * somewhere odd) goes back into the pack. If the pack can't hold it the
 * overflow lands on the ground, like any pickup: nothing is deleted.
 */
export function reconcileGear(w: World, a: Actor) {
  for (const d of GEAR_SLOT_DEFS) {
    const item = a.gear[d.id];
    if (!item || slotUsable(w, a, d.id)) continue;
    delete a.gear[d.id];
    reconcileCapacity(w, a);
    giveItem(w, a, item, 1);
    emit(w, { t: "gearOff", actor: a.id, item, slot: d.id });
  }
}

// ---------------------------------------------------------------- effects
/** Items worn in usable slots: the ones whose effects count. */
export function activeGear(w: World, a: Actor): ItemId[] {
  return GEAR_SLOT_DEFS.flatMap((d) => (a.gear[d.id] && slotUsable(w, a, d.id) ? [a.gear[d.id]!] : []));
}

/** Movement speed multiplier from worn gear: 1 + the sum of the worn speed bonuses (1.5 = +150% = 2.5x). */
export function speedMultiplier(w: World, a: Actor): number {
  return 1 + activeGear(w, a).reduce((s, id) => s + (ITEMS[id].worn?.speed ?? 0), 0);
}

/** The golem's light now: its standard glow, or the widest light a worn item gives. */
export function golemGlow(w: World, a: Actor): GolemLight {
  let best: GolemLight = GOLEM_LIGHT;
  for (const id of activeGear(w, a)) {
    const l = ITEMS[id].worn?.light;
    if (l && l.rad > best.rad) best = l;
  }
  return best;
}

/** The sigils glowing on the body, one entry per rune slot (colour and pattern, or null when empty or locked): what golem.ts draws. */
export function runeMarks(w: World, a: Actor): ({ col: string; pat: [string, string, string] } | null)[] {
  return RUNE_SLOTS.map((s) => {
    const id = a.gear[s];
    return id && slotUsable(w, a, s) ? ITEMS[id].worn?.mark ?? null : null;
  });
}

// ---------------------------------------------------------------- wear / take off
/** The capacity `a` would have wearing `gear` instead of what it wears now. */
export function capacityWith(w: World, a: Actor, gear: Gear): number {
  return capacity(w, { ...a, gear });
}

export type GearCheck =
  | { ok: true; item: ItemId; slot: GearSlot }
  | { ok: false; reason: "empty" | "notWearable" | "noSlot" | "noRoom"; item?: ItemId; over?: number; /** The pack would shrink (otherwise it is just full). */ shrinks?: boolean };

/** The pack as stacks, optionally with one unit taken out of pack slot `minus`. */
function packStacks(a: Actor, minus = -1): Stack[] {
  return a.inventory.flatMap((s, i) => {
    if (!s) return [];
    const n = i === minus ? s.n - 1 : s.n;
    return n > 0 ? [{ item: s.item, n }] : [];
  });
}

/**
 * Can `a` put on the item in pack slot `slot`? It goes in `into` if given (a
 * usable slot of its kind), else in the first empty usable slot of its kind
 * (else it swaps with the first). Whatever it wears there swaps into the pack
 * slot being freed, so a swap needs no extra room, unless the new gear grants
 * fewer slots: then everything must still fit. No usable slot of its kind
 * (all locked) refuses: `noSlot`.
 */
export function wearCheck(w: World, a: Actor, slot: number, into?: GearSlot): GearCheck {
  const s = a.inventory[slot];
  if (!s) return { ok: false, reason: "empty" };
  if (!ITEMS[s.item].wear) return { ok: false, reason: "notWearable", item: s.item };
  const cands = slotsFor(w, a, s.item);
  const target = into ? cands.find((c) => c === into) : targetSlot(w, a, s.item);
  if (!target) return { ok: false, reason: "noSlot", item: s.item };
  const prev = a.gear[target];
  if (prev) {
    const need = slotsNeeded([...packStacks(a, slot), { item: prev, n: 1 }]);
    const cap = capacityWith(w, a, { ...a.gear, [target]: s.item });
    if (need > cap) return { ok: false, reason: "noRoom", item: prev, over: need - cap, shrinks: cap < capacity(w, a) };
  }
  return { ok: true, item: s.item, slot: target };
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
  if (need > cap) return { ok: false, reason: "noRoom", item, over: need - cap, shrinks: cap < capacity(w, a) };
  return { ok: true, item, slot };
}

/** Put on the item in pack slot `slot`. Re-validates; a refusal changes nothing. */
export function applyWear(w: World, a: Actor, slot: number, into?: GearSlot): GearCheck {
  const chk = wearCheck(w, a, slot, into);
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
 * or every slot it fits already holds something else.
 */
export function ensureWorn(w: World, a: Actor, item: ItemId): boolean {
  if (wears(a, item)) return true;
  const s = targetSlot(w, a, item);
  if (!s || a.gear[s]) return false;
  const i = a.inventory.findIndex((x) => x?.item === item);
  if (i >= 0) return applyWear(w, a, i, s).ok;
  a.gear[s] = item;
  reconcileCapacity(w, a);
  return true;
}

/** What to tell the player when gear can't be put on or taken off. */
export function gearRefusal(chk: GearCheck): string {
  if (chk.ok) return "";
  if (chk.reason === "notWearable") return "THAT CAN'T BE WORN";
  if (chk.reason === "empty") return "NOTHING TO TAKE OFF";
  if (chk.reason === "noSlot") return "NO FREE SLOT FOR THAT YET";
  const k = chk.over ?? 1;
  if (chk.shrinks) return `TOO MUCH TO CARRY WITHOUT THE ${ITEM_NAMES[chk.item!]} - FREE ${k} SLOT${k === 1 ? "" : "S"}`;
  return `NO ROOM IN THE PACK FOR THE ${ITEM_NAMES[chk.item!]} - FREE ${k} SLOT${k === 1 ? "" : "S"}`;
}
