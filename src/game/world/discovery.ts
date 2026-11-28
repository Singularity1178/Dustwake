// Discovery: where the golem has been (pure; no DOM). Saved (v22).
//
// The record is the player's knowledge of the world, and it is what every order
// screen reads when it decides which places it may name (sim/orders.ts). It is
// two-level, like the world itself:
//
//   - an AREA is discovered when the golem comes into it (a room, the halls, the
//     surface);
//   - a ZONE of an area made of zones (world/zones.ts: the overworld's places) is
//     discovered when the golem walks into it, or arrives in it.
//
// Nothing else writes to it. An area existing in `World.areas` says only that the
// simulation has needed it (a worker walked in, a route was planned, a test asked
// for it); that used to double as "visited", which is how a town the golem had
// never seen came to be on offer once the surface became one area.
//
// What is NOT here, on purpose: a zone is never known "from its neighbour". Sites
// are set down side by side by a table (content/places.ts), so adjacency is an
// accident of layout, and a wild zone a thousand tiles across would announce every
// kingdom on its far edge the moment it was stepped into. What may be named ahead
// of a visit is a matter for the world to say, not geometry: the far end of an open
// door or road the golem has stood in the zone of (orders.ts: knownAreas, the signs
// over the shops' doors), and anything content chooses to tell it, by calling
// `discover` (a signpost, a map bought in a shop, something a townsperson says).
//
// Cost: a set lookup per question, one comparison per tick for the player
// (sim/step.ts: trackZone already knows the zone). Nothing here walks a list of
// zones, so it does not care how many places the overworld has.
import type { AreaData } from "../map";
import { zoneAt } from "./zones";

/** The saved shape: area id -> the ids of its zones that have been entered (empty for an area without zones). */
export type Discovered = Map<string, Set<string>>;
interface HasDiscovered { discovered: Discovered }
type HasBase = { base: AreaData } | AreaData;
const baseOf = (a: HasBase): AreaData => ("base" in a ? a.base : a);

/**
 * Record that the golem has been in `area`, and (given one) in its zone `zone`. True if that was news. The only
 * way anything becomes known: walking in (sim/step.ts), arriving (world.ts: enterArea), or content saying so.
 */
export function discover(w: HasDiscovered, area: string, zone?: string | null): boolean {
  let zones = w.discovered.get(area), fresh = false;
  if (!zones) { w.discovered.set(area, (zones = new Set())); fresh = true; }
  if (zone && !zones.has(zone)) { zones.add(zone); fresh = true; }
  return fresh;
}

/** Record the place a px point of an area lies in: the area, and the zone there if it is in one. */
export const discoverAt = (w: HasDiscovered, area: HasBase, x: number, y: number) => discover(w, baseOf(area).id, zoneAt(area, x, y)?.id);

/** Has the golem been in this area at all? */
export const areaDiscovered = (w: HasDiscovered, area: string) => w.discovered.has(area);
/** Has the golem been in this zone of the area? */
export const zoneDiscovered = (w: HasDiscovered, area: string, zone: string) => !!w.discovered.get(area)?.has(zone);

/**
 * Is the px point of an area somewhere the golem has been? In a zone: that zone has been entered. On ground no zone
 * covers (an area without zones, or the plain meadow between sites): the area has. This is the one question the
 * order screens ask of a chest, a tree, a rune or a door before naming it.
 */
export function knownAt(w: HasDiscovered, area: HasBase, x: number, y: number): boolean {
  const zones = w.discovered.get(baseOf(area).id);
  if (!zones) return false;
  const z = zoneAt(area, x, y);
  return !z || zones.has(z.id);
}

/** For a save: plain data, every key and list sorted, so two worlds that know the same places save the same bytes. */
export function discoveredToJson(d: Discovered): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of [...d.keys()].sort()) out[id] = [...d.get(id)!].sort();
  return out;
}
export function discoveredFromJson(raw: unknown): Discovered {
  const out: Discovered = new Map();
  if (raw && typeof raw === "object") for (const [id, zones] of Object.entries(raw as Record<string, unknown>)) {
    out.set(id, new Set(Array.isArray(zones) ? zones.filter((z): z is string => typeof z === "string") : []));
  }
  return out;
}
