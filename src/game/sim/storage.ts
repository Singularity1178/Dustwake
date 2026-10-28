// Generic inventory transactions. Prop handles are snapshots; only the commit
// touches Area state. Source order for crafting is pack, then stable prop id.
import { propDef } from "../content/props";
import { TS } from "../content/tiles";
import type { ItemId } from "../content/items";
import { actorById, type Actor, type Slot, type World } from "../world/world";
import type { Area, PropInst } from "../world/area";
import { capacity } from "./inventory";
import { copySlots, countItem, insertItems, removeItems, roomIn } from "./inventoryOps";
import { rememberItem } from "./discovery";
import { RECIPES, recipeForProp } from "../content/build";

export type InventoryRef = { kind: "actor"; id: string } | { kind: "prop"; area: string; id: string };
export interface InventoryHandle {
  ref: InventoryRef;
  inventory: Slot[];
  capacity: number;
  commit: () => void;
}
export const packRef = (a: Actor): InventoryRef => ({ kind: "actor", id: a.id });
export const storageRef = (area: string, id: string): InventoryRef => ({ kind: "prop", area, id });

export function inventoryHandle(w: World, ref: InventoryRef): InventoryHandle | null {
  if (ref.kind === "actor") {
    const a = actorById(w, ref.id);
    if (!a) return null;
    const h: InventoryHandle = { ref, inventory: copySlots(a.inventory), capacity: capacity(w, a), commit: () => {
      a.inventory = copySlots(h.inventory);
      for (const s of a.inventory) if (s) rememberItem(w, a, s.item);
    } };
    return h;
  }
  const area = w.areas.get(ref.area), p = area?.prop(ref.id), cap = p && propDef(p.kind).storage?.slots;
  if (!area || !p?.inventory || cap === undefined) return null;
  const h: InventoryHandle = { ref, inventory: copySlots(p.inventory), capacity: cap, commit: () => area.setInventory(p.id, h.inventory) };
  return h;
}

/** Transfer as much as fits; a refusal or missing owner changes nothing. */
export function transferItems(w: World, from: InventoryRef, to: InventoryRef, item: ItemId, n: number): number {
  const same = from.kind === to.kind && from.id === to.id && (from.kind !== "prop" || to.kind !== "prop" || from.area === to.area);
  if (!Number.isSafeInteger(n) || n <= 0 || same) return 0;
  const src = inventoryHandle(w, from), dst = inventoryHandle(w, to);
  if (!src || !dst) return 0;
  const moved = Math.min(n, countItem(src, item), roomIn(dst.inventory, dst.capacity, item));
  if (!moved) return 0;
  removeItems(src, item, moved);
  insertItems(dst.inventory, dst.capacity, item, moved);
  src.commit(); dst.commit();
  return moved;
}

export function nearbyStorage(area: Area, station: PropInst, radius = 2): PropInst[] {
  const tx = Math.floor(station.x / TS), ty = Math.floor((station.y - 1) / TS);
  return area.props.filter((p) => p.inventory && Math.max(Math.abs(Math.floor(p.x / TS) - tx), Math.abs(Math.floor((p.y - 1) / TS) - ty)) <= radius)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function craftSources(w: World, a: Actor, station?: PropInst): InventoryHandle[] {
  const pack = inventoryHandle(w, packRef(a));
  const area = w.areas.get(a.area);
  return [pack, ...(area && station ? nearbyStorage(area, station).map((p) => inventoryHandle(w, storageRef(area.id, p.id))) : [])]
    .filter((h): h is InventoryHandle => !!h);
}

/** Aggregate duplicate ingredient rows before validation; commit only after
 * every ingredient fits, so competing crafters cannot partially consume. */
export function consumeInputs(sources: InventoryHandle[], inputs: readonly { item: ItemId; n: number }[]): boolean {
  const seen = new Set<string>();
  sources = sources.filter((h) => {
    const key = JSON.stringify([h.ref.kind, h.ref.kind === "prop" ? h.ref.area : null, h.ref.id]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const totals = new Map<ItemId, number>();
  for (const c of inputs) {
    if (!Number.isSafeInteger(c.n) || c.n <= 0) return false;
    totals.set(c.item, (totals.get(c.item) ?? 0) + c.n);
  }
  for (const [item, n] of totals) if (sources.reduce((s, h) => s + countItem(h, item), 0) < n) return false;
  const dirty = new Set<InventoryHandle>();
  for (const [item, total] of totals) {
    let left = total;
    for (const h of sources) {
      const n = Math.min(left, countItem(h, item));
      if (n) { removeItems(h, item, n); dirty.add(h); left -= n; }
    }
  }
  for (const h of dirty) h.commit();
  return true;
}
/**
 * What E on a storage prop says until the storage screen exists: the host's
 * `openStorage` seam shows this note (the screen will replace it). Honest about
 * what is inside; nothing is moved.
 */
export function storageNote(area: Area, propId: string): string | null {
  const p = area.prop(propId), slots = p?.inventory;
  if (!p || !slots) return null;
  const id = recipeForProp(p.kind), name = id ? RECIPES[id].name : "STORAGE";
  const used = slots.filter(Boolean).length;
  return used ? `${name}: ${used} OF ${slots.length} SLOTS IN USE` : `${name}: EMPTY, ${slots.length} SLOTS`;
}
