// Actor inventories: an ordered array of slots ({item, n} or null). Capacity is
// derived from world/actor state (content/inventory.ts), never stored. All
// functions here are pure sim (no DOM) and work for any actor.
import { CAPACITY_TIERS } from "../content/inventory";
import { maxStack, type ItemId } from "../content/items";
import { TS, isSolidT } from "../content/tiles";
import { emit, areaOf, type Actor, type Slot, type World } from "../world/world";
import type { Area } from "../world/area";
import { meets } from "./requirements";
import { actorBoxes } from "./collision";
import type { Box } from "./reach";

/** Slot count for this actor right now: the highest satisfied tier. */
export function capacity(w: World, a: Actor): number {
  let n = 0;
  for (const t of CAPACITY_TIERS) if (t.slots > n && meets(w, a, t.requires)) n = t.slots;
  return n;
}

export const countItem = (a: Actor, id: ItemId) => a.inventory.reduce((s, x) => s + (x?.item === id ? x.n : 0), 0);
export const hasItem = (a: Actor, id: ItemId) => a.inventory.some((s) => s?.item === id);
/** Distinct item ids held, in slot order (for "does the pack contain any X" checks). */
export const heldItems = (a: Actor) => a.inventory.flatMap((s) => (s ? [s.item] : []));

/** A stack of one item (what an inventory slot holds). */
export type Stack = { item: ItemId; n: number };

/** Slots these stacks need when packed tight: units of one item merge, up to its stack size per slot. */
export function slotsNeeded(stacks: readonly Stack[]): number {
  const units = new Map<ItemId, number>();
  for (const s of stacks) units.set(s.item, (units.get(s.item) ?? 0) + s.n);
  let k = 0;
  for (const [id, n] of units) k += Math.ceil(n / maxStack(id));
  return k;
}

/** Pour stacks into slots: matching stacks with room first, then empty slots (as addItems does). False if anything is left over. */
function pour(slots: Slot[], stacks: readonly Stack[]): boolean {
  for (const st of stacks) {
    const max = maxStack(st.item);
    let n = st.n;
    for (let i = 0; i < slots.length && n > 0; i++) {
      const s = slots[i];
      if (s && s.item === st.item && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
    }
    for (let i = 0; i < slots.length && n > 0; i++) {
      if (slots[i]) continue;
      const k = Math.min(n, max);
      slots[i] = { item: st.item, n: k };
      n -= k;
    }
    if (n > 0) return false;
  }
  return true;
}

/**
 * Fit the actor's pack, plus `extra`, into exactly `cap` slots without
 * dropping anything (taking gear off uses it). Gentle first: slots inside
 * `cap` stay where they are, and stacks beyond it, then `extra`, pour into
 * matching stacks and empty slots. Only if that isn't enough is the pack
 * compacted (same items merged, in order of first appearance). If even that
 * can't hold everything it returns false and changes nothing.
 */
export function repackInto(a: Actor, cap: number, extra: readonly Stack[] = []): boolean {
  const inv = a.inventory;
  const held: Stack[] = inv.flatMap((s) => (s ? [{ item: s.item, n: s.n }] : []));
  if (slotsNeeded([...held, ...extra]) > cap) return false;
  let next: Slot[] = Array.from({ length: cap }, (_, i) => (inv[i] ? { ...inv[i]! } : null));
  const beyond: Stack[] = inv.slice(cap).flatMap((s) => (s ? [{ item: s.item, n: s.n }] : []));
  if (!pour(next, [...beyond, ...extra])) {
    next = Array.from({ length: cap }, () => null);
    pour(next, [...held, ...extra]);
  }
  inv.length = 0;
  inv.push(...next);
  return true;
}

/**
 * Make the slot array match capacity. Growth only appends empty slots, so
 * nothing moves. If capacity shrinks (it shouldn't in play, but debug keys and
 * old saves can do it) items beyond capacity are first packed into free room
 * within capacity and anything that still doesn't fit is dropped into the
 * world next to the actor. Items never vanish.
 */
export function reconcileCapacity(w: World, a: Actor) {
  // Capacity tiers describe the golem's body (golem.* flags). NPC packs are
  // per actor too but have no tiers yet: leave them exactly as they are.
  if (a.kind === "npc") return;
  const cap = capacity(w, a);
  const inv = a.inventory;
  while (inv.length < cap) inv.push(null);
  if (inv.length === cap) return;
  const extra = inv.splice(cap);
  for (const s of extra) {
    if (!s) continue;
    const left = addItems(w, a, s.item, s.n);
    if (left > 0) {
      const area = areaOf(w, a);
      const spot = dropSpot(area, a, actorBoxes(w, area.id, a.id));
      const x = spot ? spot.x : a.x, y = spot ? spot.y : a.y;
      spawnLoose(area, s.item, left, x, y);
      emit(w, { t: "itemDropped", actor: a.id, item: s.item, n: left, x, y, reason: "overflow" });
    }
  }
}

/** Store up to n units. Fills existing stacks first, then empty slots. Returns units that did not fit. */
export function addItems(w: World, a: Actor, id: ItemId, n: number): number {
  const cap = capacity(w, a), inv = a.inventory, max = maxStack(id);
  while (inv.length < cap) inv.push(null);
  for (let i = 0; i < cap && n > 0; i++) {
    const s = inv[i];
    if (s && s.item === id && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
  }
  for (let i = 0; i < cap && n > 0; i++) {
    if (inv[i]) continue;
    const k = Math.min(n, max);
    inv[i] = { item: id, n: k };
    n -= k;
  }
  return n;
}

/** How many units of `id` would fit right now. */
export function roomFor(w: World, a: Actor, id: ItemId): number {
  const cap = capacity(w, a), max = maxStack(id);
  let r = 0;
  for (let i = 0; i < cap; i++) {
    const s = a.inventory[i];
    if (!s) r += max;
    else if (s.item === id) r += max - s.n;
  }
  return r;
}

/** Remove n units (from the last matching slots first). All-or-nothing. */
export function removeItems(a: Actor, id: ItemId, n = 1): boolean {
  if (countItem(a, id) < n) return false;
  const inv = a.inventory;
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
    const s = inv[i];
    if (!s || s.item !== id) continue;
    const k = Math.min(n, s.n);
    s.n -= k; n -= k;
    if (s.n === 0) inv[i] = null;
  }
  return true;
}

/**
 * Give items to an actor. Whatever doesn't fit (full pack) is dropped on the
 * ground next to the actor as a loose item, so nothing is ever lost.
 */
export function giveItem(w: World, a: Actor, id: ItemId, n = 1) {
  const left = addItems(w, a, id, n);
  if (left < n) emit(w, { t: "itemGained", actor: a.id, item: id, stored: true, n: n - left });
  if (left > 0) {
    const area = areaOf(w, a);
    const spot = dropSpot(area, a, actorBoxes(w, area.id, a.id));
    const x = spot ? spot.x : a.x, y = spot ? spot.y : a.y;
    spawnLoose(area, id, left, x, y);
    emit(w, { t: "packFull", actor: a.id, item: id });
    emit(w, { t: "itemDropped", actor: a.id, item: id, n: left, x, y, reason: "full" });
  }
}

// ---------------------------------------------------------------- placement
/** Candidate offsets as [forward, sideways] relative to the actor's facing, in preference order. */
const DROP_ORDER: [number, number][] = [
  [1, 0], [0, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [-1, -1], [-1, 1],
  [2, 0], [2, -1], [2, 1], [0, -2], [0, 2], [-2, 0], [2, -2], [2, 2], [-2, -1], [-2, 1],
];

function tileFree(area: Area, tx: number, ty: number, bodies: readonly Box[]) {
  if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) return false;
  if (isSolidT(area.grid[ty * area.w + tx])) return false;
  const cx = tx * TS + 8, cy = ty * TS + 11;
  for (const p of area.props) {
    const b = p.box;
    if (b && !p.taken && cx > b[0] - 3 && cx < b[2] + 3 && cy > b[1] - 3 && cy < b[3] + 3) return false;
  }
  for (const b of bodies) if (cx > b[0] - 3 && cx < b[2] + 3 && cy > b[1] - 3 && cy < b[3] + 3) return false;
  return true;
}

/**
 * Where an actor's dropped item lands: the tile in front of it if free, else
 * its own tile, then the nearest free tile around it in a fixed order relative
 * to facing. Fully deterministic (no randomness). Null if boxed in.
 */
export function dropSpot(area: Area, a: Actor, bodies: readonly Box[] = []): { x: number; y: number; tx: number; ty: number } | null {
  const fx = a.facing === "left" ? -1 : a.facing === "right" ? 1 : 0;
  const fy = a.facing === "up" ? -1 : a.facing === "down" ? 1 : 0;
  const gx = Math.floor(a.x / TS), gy = Math.floor((a.y - 3) / TS);
  for (const [f, s] of DROP_ORDER) {
    const tx = gx + f * fx - s * fy, ty = gy + f * fy + s * fx;
    if (tileFree(area, tx, ty, bodies)) return { x: tx * TS + 8, y: ty * TS + 11, tx, ty };
  }
  return null;
}

/** Put a loose stack in the world, merging into a same-item stack already on that spot. */
export function spawnLoose(area: Area, item: ItemId, n: number, x: number, y: number) {
  const max = maxStack(item);
  for (const l of area.loose) {
    if (n <= 0) break;
    if (l.taken || l.item !== item || l.x !== x || l.y !== y) continue;
    const k = Math.min(n, max - (l.n ?? 1));
    if (k > 0) { area.setLooseCount(l.id, (l.n ?? 1) + k); n -= k; }
  }
  while (n > 0) {
    const k = Math.min(n, max);
    area.addLoose(item, k, x, y);
    n -= k;
  }
}

export type { Slot };
