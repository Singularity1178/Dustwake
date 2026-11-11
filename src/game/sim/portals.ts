// Walking from one area into the next: a road that runs off the edge of the
// map, a shop door, the way back out. A portal is a box of ground plus the
// direction you push to go through it (map.ts: Portal); areas declare theirs in
// `portals`, in pairs. Nothing is channelled and nothing is spent: unlike rune
// travel this is just walking, so any body that can move may use one: the
// player by pushing on, a body under orders by walking into the box and stepping
// through the same function (sim/jobs.ts, on a route from sim/routes.ts). Pure sim.
import type { Portal } from "../map";
import type { Facing } from "../golem";
import { actorDef, capable } from "../content/actors";
import { emit, enterArea, getArea, hasFlag, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { actorBoxes, nearestFree } from "./collision";

const PUSH: Record<Portal["dir"], readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const AWAY: Record<Portal["dir"], Facing> = { up: "down", down: "up", left: "right", right: "left" };

export const portalsOf = (area: Area): readonly Portal[] => area.base.portals ?? [];
export const portalById = (area: Area, id: string): Portal | undefined => portalsOf(area).find((p) => p.id === id);

/** Is a portal passable? One with a `flag` (a stair that has to be dug out first) only once that world flag is set. */
export const portalOpen = (w: World, p: Portal) => !p.flag || hasFlag(w, p.flag);

/** Are feet at (x, y) inside a portal's box? */
export const inPortal = (p: Portal, x: number, y: number) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;

/**
 * The portal someone standing at (x, y) and pushing (ix, iy) walks through, if any: feet in its box, pushing
 * mostly its way. `open` leaves out the ones that are shut (pass `(p) => portalOpen(w, p)`).
 */
export function portalAt(area: Area, x: number, y: number, ix: number, iy: number, open: (p: Portal) => boolean = () => true): Portal | null {
  const mag = Math.hypot(ix, iy);
  if (!mag) return null;
  for (const p of portalsOf(area)) {
    if (!open(p)) continue;
    const [dx, dy] = PUSH[p.dir];
    if ((ix * dx + iy * dy) / mag < 0.7) continue;
    if (inPortal(p, x, y)) return p;
  }
  return null;
}

/** Places in a portal's box, as fractions of its half-extents from its middle: the middle first, then toward the edges. */
const STAND: readonly (readonly [number, number])[] = [[0, 0], [-0.5, 0], [0.5, 0], [0, 0.5], [0, -0.5], [-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]];

/**
 * Where a body that means to go through a portal walks to: a place inside its box where it can stand (`free`: that
 * body's own collision test), the middle first. Every candidate lies well inside the box, so a walker that stops a
 * pixel short still has its feet in it. Null if the whole box is blocked.
 */
export function portalStand(p: Portal, free: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  for (const [fx, fy] of STAND) {
    const x = cx + fx * Math.max(0, p.w / 2 - 2), y = cy + fy * Math.max(0, p.h / 2 - 2);
    if (free(x, y)) return { x, y };
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
  if (a.area !== area.id || !capable(a, "move") || !portalOpen(w, p)) return false;
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
