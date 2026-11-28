// Zones: named regions of an area (pure; no DOM). An area that is put together
// from sites (world/compose.ts) carries one zone per site; any area may declare
// zones of its own. A zone is what the game means by "a place" inside a large
// continuous area:
//
//   - orders name it          ("GATHER WOOD FROM THE OLD ROAD", "GO TO WESTWAKE"),
//   - people belong to it     (a townsperson's spots, claims and rounds are their zone's),
//   - the simulation's level of detail is decided by it (sim/lod.ts: a settlement
//     far from the player is asleep, and wakes as a whole when the player nears),
//   - presentation reads it   (the place's name on walking in, whether lamps are tended).
//
// Lookups are O(1) whatever the number of zones: a coarse cell index per area
// (built once per AreaData, on first use) answers "which zone is this point in",
// and spots are bucketed per zone.
import type { AreaData, Spot, Zone } from "../map";
import { TS } from "../content/tiles";

export type { Zone } from "../map";

/** Anything that carries an area definition: an `Area` (its `base`), or the definition itself. */
type HasBase = { base: AreaData } | AreaData;
const baseOf = (a: HasBase): AreaData => ("base" in a ? a.base : a);

/** Tiles per side of an index cell. */
const CELL = 4;
interface Index {
  zones: readonly Zone[];
  byId: Map<string, Zone>;
  /** Per cell: zone index + 1, 0 for none, -1 where a cell straddles a border (scan). */
  cells: Int16Array;
  cw: number; ch: number;
  spots: Map<string, Spot[]>;
  spotById: Map<string, Map<string, Spot>>;
}
const cache = new WeakMap<AreaData, Index>();
const NONE = "";

function indexOf(a: HasBase): Index {
  const base = baseOf(a);
  let ix = cache.get(base);
  if (ix) return ix;
  const zones = base.zones ?? [];
  const cw = Math.ceil(base.w / CELL), ch = Math.ceil(base.h / CELL), cells = new Int16Array(cw * ch);
  zones.forEach((z, i) => {
    for (let cy = Math.floor(z.y / CELL); cy <= Math.floor((z.y + z.h - 1) / CELL); cy++)
      for (let cx = Math.floor(z.x / CELL); cx <= Math.floor((z.x + z.w - 1) / CELL); cx++) {
        if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
        const whole = cx * CELL >= z.x && cy * CELL >= z.y && (cx + 1) * CELL <= z.x + z.w && (cy + 1) * CELL <= z.y + z.h;
        const k = cy * cw + cx;
        cells[k] = whole && cells[k] === 0 ? i + 1 : -1;
      }
  });
  const spots = new Map<string, Spot[]>(), spotById = new Map<string, Map<string, Spot>>();
  for (const s of base.spots ?? []) {
    const key = s.zone ?? NONE;
    let list = spots.get(key), ids = spotById.get(key);
    if (!list) spots.set(key, (list = []));
    if (!ids) spotById.set(key, (ids = new Map()));
    list.push(s);
    if (!ids.has(s.id)) ids.set(s.id, s);
  }
  ix = { zones, byId: new Map(zones.map((z) => [z.id, z])), cells, cw, ch, spots, spotById };
  cache.set(base, ix);
  return ix;
}

/** An area's zones, in the order they were declared. */
export const zonesOf = (a: HasBase): readonly Zone[] => baseOf(a).zones ?? [];
export const zoneById = (a: HasBase, id: string | undefined | null): Zone | undefined => (id ? indexOf(a).byId.get(id) : undefined);

/** Is the px point inside the zone's rect? */
export const inZone = (z: Zone, x: number, y: number) => x >= z.x * TS && y >= z.y * TS && x < (z.x + z.w) * TS && y < (z.y + z.h) * TS;

/** The zone a px point lies in, if any. */
export function zoneAt(a: HasBase, x: number, y: number): Zone | null {
  const base = baseOf(a);
  if (!base.zones?.length) return null;
  const ix = indexOf(a), cx = Math.floor(x / TS / CELL), cy = Math.floor(y / TS / CELL);
  if (cx < 0 || cy < 0 || cx >= ix.cw || cy >= ix.ch) return null;
  const c = ix.cells[cy * ix.cw + cx];
  if (c > 0) return ix.zones[c - 1];
  if (c === 0) return null;
  for (const z of ix.zones) if (inZone(z, x, y)) return z;
  return null;
}

/** How far a px point is outside a zone's rect on each axis (0, 0 inside it). */
export function zoneGap(z: Zone, x: number, y: number): { dx: number; dy: number } {
  const x0 = z.x * TS, x1 = (z.x + z.w) * TS, y0 = z.y * TS, y1 = (z.y + z.h) * TS;
  return { dx: x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy: y < y0 ? y0 - y : y > y1 ? y - y1 : 0 };
}

/**
 * The standing places of a zone (or, with no zone, the area's places that belong to none: a room's). Spot ids are a
 * site's own, so two settlements in one area may each have a `door.tavern`; a zone's spots are looked up within it.
 */
export const spotsIn = (a: HasBase, zone?: string | null): readonly Spot[] => indexOf(a).spots.get(zone ?? NONE) ?? [];
/** A spot by its id within a zone. With no zone given: the area's own, else the first of that id in any zone. */
export function spotIn(a: HasBase, id: string, zone?: string | null): Spot | undefined {
  const ix = indexOf(a);
  if (zone) return ix.spotById.get(zone)?.get(id);
  const own = ix.spotById.get(NONE)?.get(id);
  if (own) return own;
  for (const m of ix.spotById.values()) { const s = m.get(id); if (s) return s; }
  return undefined;
}

/** Do people keep the lights at this point (content/props.ts: `habit`)? A zone says so for its ground; else the area. */
export function tendedAt(a: HasBase, x: number, y: number): boolean {
  const base = baseOf(a);
  if (!base.zones?.length) return !!base.tended;
  const z = zoneAt(a, x, y);
  return z ? !!z.tended : !!base.tended;
}

/** A position in a zone's own authored coordinates (px): what a site's builder, and anything written against it, calls that point. */
export const toZoneLocal = (z: Zone, x: number, y: number) => ({ x: x - z.ox, y: y - z.oy });
export const fromZoneLocal = (z: Zone, x: number, y: number) => ({ x: x + z.ox, y: y + z.oy });
