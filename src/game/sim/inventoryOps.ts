// Stack operations know neither actors nor props. Callers work on a copy and
// commit through its owner (Area.setInventory for a prop).
import { maxStack, type ItemId } from "../content/items";
import type { Slot } from "../world/world";

export interface InventoryOwner { inventory: Slot[] }
export const copySlots = (slots: readonly Slot[]): Slot[] => slots.map((s) => s ? { ...s } : null);
export const countItem = (a: InventoryOwner, id: ItemId) => a.inventory.reduce((n, s) => n + (s?.item === id ? s.n : 0), 0);
export const hasItem = (a: InventoryOwner, id: ItemId) => countItem(a, id) > 0;
export const heldItems = (a: InventoryOwner) => a.inventory.flatMap((s) => s ? [s.item] : []);

export function roomIn(slots: readonly Slot[], cap: number, item: ItemId): number {
  let room = 0;
  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (!s) room += maxStack(item);
    else if (s.item === item) room += Math.max(0, maxStack(item) - s.n);
  }
  return room;
}

/** Returns the number that did not fit. Never overfills a slot. */
export function insertItems(slots: Slot[], cap: number, item: ItemId, n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid item count");
  while (slots.length < cap) slots.push(null);
  for (let i = 0; i < cap && n > 0; i++) {
    const s = slots[i];
    if (!s || s.item !== item) continue;
    const k = Math.min(n, Math.max(0, maxStack(item) - s.n));
    s.n += k; n -= k;
  }
  for (let i = 0; i < cap && n > 0; i++) {
    if (slots[i]) continue;
    const k = Math.min(n, maxStack(item));
    slots[i] = { item, n: k }; n -= k;
  }
  return n;
}

/** All-or-nothing, last matching slots first. */
export function removeItems(a: InventoryOwner, item: ItemId, n = 1): boolean {
  if (!Number.isSafeInteger(n) || n < 0 || countItem(a, item) < n) return false;
  for (let i = a.inventory.length - 1; i >= 0 && n > 0; i--) {
    const s = a.inventory[i];
    if (!s || s.item !== item) continue;
    const k = Math.min(n, s.n);
    s.n -= k; n -= k;
    if (!s.n) a.inventory[i] = null;
  }
  return true;
}