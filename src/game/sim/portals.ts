// Walking from one area into the next: a road that runs off the edge of the
// map, a shop door, the way back out. A portal is a box of ground plus the
// direction you push to go through it (map.ts: Portal); areas declare theirs in
// `portals`, in pairs. Nothing is channelled and nothing is spent: unlike rune
// travel this is just walking, so any body that can move may use one (the
// player today; townsfolk and haulers later path to a portal and step through
// the same function). Pure sim.
import type { Portal } from "../map";
import type { Facing } from "../golem";
import { actorDef, capable } from "../content/actors";
import { emit, enterArea, getArea, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { actorBoxes, nearestFree } from "./collision";

const PUSH: Record<Portal["dir"], readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const AWAY: Record<Portal["dir"], Facing> = { up: "down", down: "up", left: "right", right: "left" };

export const portalsOf = (area: Area): readonly Portal[] => area.base.portals ?? [];
export const portalById = (area: Area, id: string): Portal | undefined => portalsOf(area).find((p) => p.id === id);

/** The portal someone standing at (x, y) and pushing (ix, iy) walks through, if any: feet in its box, pushing mostly its way. */
export function portalAt(area: Area, x: number, y: number, ix: number, iy: number): Portal | null {
  const mag = Math.hypot(ix, iy);
  if (!mag) return null;
  for (const p of portalsOf(area)) {
    const [dx, dy] = PUSH[p.dir];
    if ((ix * dx + iy * dy) / mag < 0.7) continue;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
  }
  return null;
}

/** Where someone coming out of a portal stands, and which way they face (away from the way in). */
export function portalArrival(p: Portal): { x: number; y: number; facing: Facing } {
  const at = p.arrive ?? { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  return { x: at.x, y: at.y, facing: AWAY[p.dir] };
}

/**
 * Walk `a` through portal `p` of `area`: it comes out of the paired portal,
 * nudged to the nearest free spot if something stands there. False (and
 * nothing moves) if the other side is missing or blocked solid.
 */
export function walkThrough(w: World, a: Actor, area: Area, p: Portal): boolean {
  if (a.area !== area.id || !capable(a, "move")) return false;
  const dest = getArea(w, p.to.area), out = portalById(dest, p.to.portal);
  if (!out) return false;
  const at = portalArrival(out);
  const spot = nearestFree(dest, at.x, at.y, actorBoxes(w, dest.id, a.id), actorDef(a).body.box);
  if (!spot) return false;
  enterArea(w, a, dest.id, spot.x, spot.y);
  a.facing = at.facing;
  emit(w, { t: "portal", actor: a.id, fromArea: area.id, from: p.id, toArea: dest.id, to: out.id });
  return true;
}
