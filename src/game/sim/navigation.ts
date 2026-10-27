// Static geometry caches by Area + body + layout revision. Dynamic bodies are
// checked during planning and at every swept movement step, never baked in.
import { actorDef } from "../content/actors";
import { TS, isSolidT } from "../content/tiles";
import type { Area } from "../world/area";
import { areaOf, type Actor, type World } from "../world/world";
import type { Destination, Point } from "../world/jobs";
import { actorBoxes, propBlocks } from "./collision";
import { cellFeet, freeAt, type Box } from "./reach";
import { actorSpeed } from "./actorStats";

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
export interface NavGrid {
  revision: number;
  size: readonly [number, number];
  free: (x: number, y: number) => boolean;
  stand: (k: number) => boolean;
  edges: (k: number) => number;
}
const cache = new WeakMap<Area, Map<string, NavGrid>>();
const keyAt = (area: Area, p: Point) => Math.floor((p.y - 3) / TS) * area.w + Math.floor(p.x / TS);
const feet = (area: Area, k: number) => cellFeet(k % area.w, Math.floor(k / area.w));

export function sweptFree(from: Point, to: Point, free: (x: number, y: number) => boolean): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let i = 0; i <= steps; i++) if (!free(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps)) return false;
  return true;
}

export function navGrid(area: Area, a: Actor): NavGrid {
  const size = actorDef(a).body.box, key = size.join(",");
  let grids = cache.get(area);
  if (!grids) cache.set(area, grids = new Map());
  const old = grids.get(key);
  if (old?.revision === area.layoutRevision) return old;
  const buckets = new Map<number, Box[]>();
  for (const p of area.props) if (propBlocks(p)) {
    const b = p.box!;
    for (let y = Math.floor((b[1] - size[1]) / TS) - 1; y <= Math.floor((b[3] + size[1]) / TS) + 1; y++)
      for (let x = Math.floor((b[0] - size[0]) / TS) - 1; x <= Math.floor((b[2] + size[0]) / TS) + 1; x++) {
        if (x < 0 || y < 0 || x >= area.w || y >= area.h) continue;
        const k = y * area.w + x;
        const list = buckets.get(k) ?? [];
        list.push(b); buckets.set(k, list);
      }
  }
  const free = (x: number, y: number) => freeAt(area, buckets.get(Math.floor(y / TS) * area.w + Math.floor(x / TS)) ?? [], x, y, size);
  const cells = new Int8Array(area.w * area.h).fill(-1), links = new Int8Array(cells.length).fill(-1);
  const stand = (k: number) => {
    if (k < 0 || k >= cells.length) return false;
    if (cells[k] < 0) { const p = feet(area, k); cells[k] = Number(free(p.x, p.y)); }
    return cells[k] === 1;
  };
  const edges = (k: number) => {
    if (links[k] >= 0) return links[k];
    const x = k % area.w, y = Math.floor(k / area.w), p = feet(area, k);
    let mask = 0;
    if (stand(k)) DIRS.forEach(([dx, dy], i) => {
      const nx = x + dx, ny = y + dy, nk = ny * area.w + nx;
      if (nx >= 0 && ny >= 0 && nx < area.w && ny < area.h && stand(nk) && sweptFree(p, feet(area, nk), free)) mask |= 1 << i;
    });
    links[k] = mask;
    return mask;
  };
  const grid: NavGrid = { revision: area.layoutRevision, size, free, stand, edges };
  grids.set(key, grid);
  return grid;
}

/** Work cannot reach through a solid tile. Props at the destination are not walls. */
export const lineOfSight = (area: Area, from: Point, to: Point) => sweptFree(from, to, (x, y) => !isSolidT(area.tileAtPx(x, y)));
export const atDestination = (area: Area, a: Point, goal: Pick<Destination, "x" | "y" | "range">) =>
  Math.hypot(a.x - goal.x, a.y - goal.y) <= goal.range + 0.01 && lineOfSight(area, a, goal);

export function findPath(w: World, a: Actor, goal: Pick<Destination, "x" | "y" | "range">, avoidActors = true): Point[] | null {
  const area = areaOf(w, a), grid = navGrid(area, a), bodies = avoidActors ? actorBoxes(w, area.id, a.id) : [];
  const free = (x: number, y: number) => grid.free(x, y) && freeAt(area, bodies, x, y, grid.size);
  const sx = Math.floor(a.x / TS), sy = Math.floor((a.y - 3) / TS);
  const starts: number[] = [];
  for (let y = sy - 2; y <= sy + 2; y++) for (let x = sx - 2; x <= sx + 2; x++) {
    if (x < 0 || y < 0 || x >= area.w || y >= area.h) continue;
    const k = y * area.w + x;
    if (grid.stand(k) && sweptFree(a, feet(area, k), free)) starts.push(k);
  }
  starts.sort((i, j) => {
    const p = feet(area, i), q = feet(area, j);
    return Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y) || i - j;
  });
  if (!starts.length) return null;
  const start = starts[0], queue = [start], prev = new Int32Array(area.w * area.h).fill(-2);
  prev[start] = -1;
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head], p = feet(area, k);
    const exact = goal.range < 4 && Math.hypot(p.x - goal.x, p.y - goal.y) <= TS && sweptFree(p, goal, free);
    if (atDestination(area, p, goal) || exact) {
      const path: Point[] = [];
      for (let n = k; n >= 0; n = prev[n]) path.push(feet(area, n));
      path.reverse();
      if (exact && !atDestination(area, p, goal)) path.push({ x: goal.x, y: goal.y });
      return path;
    }
    const mask = grid.edges(k);
    DIRS.forEach(([dx, dy], i) => {
      if (!(mask & (1 << i))) return;
      const n = k + dy * area.w + dx;
      if (prev[n] !== -2 || !sweptFree(p, feet(area, n), free)) return;
      prev[n] = k; queue.push(n);
    });
  }
  return null;
}

/** Lower id keeps its route; the other actor backs into a reachable passing
 * place outside that route. No teleporting, pushing or disabling collision. */
function yieldPath(w: World, a: Actor): Point[] | null {
  const area = areaOf(w, a), grid = navGrid(area, a);
  const peers = w.actors.filter((b) => b.id < a.id && b.area === a.area && b.job?.status === "running" && Math.hypot(b.x - a.x, b.y - a.y) < TS * 3)
    .sort((a, b) => a.id < b.id ? -1 : 1);
  const peer = peers[0];
  if (!peer) return null;
  const route = [peer, ...(peer.job?.nav?.path ?? [])];
  const cells: number[] = [], k0 = keyAt(area, a), sx = k0 % area.w, sy = Math.floor(k0 / area.w);
  for (let y = sy - 5; y <= sy + 5; y++) for (let x = sx - 5; x <= sx + 5; x++) {
    if (x < 0 || y < 0 || x >= area.w || y >= area.h) continue;
    const k = y * area.w + x, p = feet(area, k);
    if (k !== k0 && grid.stand(k) && route.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= TS - 1)) cells.push(k);
  }
  cells.sort((i, j) => {
    const p = feet(area, i), q = feet(area, j);
    return Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y) || i - j;
  });
  for (const k of cells) {
    const path = findPath(w, a, { ...feet(area, k), range: 1 });
    if (path) return path;
  }
  return null;
}

export type WalkResult = "arrived" | "moving" | "stuck";
export function walkTo(w: World, a: Actor, goal: Destination, dt: number): WalkResult {
  const job = a.job, area = areaOf(w, a);
  if (!job || goal.area !== area.id) return "stuck";
  const key = `${goal.area}:${goal.x},${goal.y}:${goal.range}`;
  if (job.nav?.goal !== key) job.nav = { goal: key, path: [], blockedFor: 0, recoveries: 0, yielding: false, replanIn: 0 };
  const nav = job.nav;
  a.moving = false; a.vx = 0; a.vy = 0;
  if (!nav.yielding && atDestination(area, a, goal)) { job.nav = null; return "arrived"; }
  nav.replanIn = Math.max(0, nav.replanIn - dt);
  if (!nav.path.length && nav.replanIn > 0) return "moving";
  if (!nav.path.length) nav.path = findPath(w, a, goal) ?? findPath(w, a, goal, false) ?? [];
  const start = { x: a.x, y: a.y }, grid = navGrid(area, a), bodies = actorBoxes(w, a.area, a.id);
  const free = (x: number, y: number) => grid.free(x, y) && freeAt(area, bodies, x, y, grid.size);
  let budget = actorSpeed(w, a) * dt;
  while (nav.path.length && budget > 0) {
    const p = nav.path[0], dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy);
    if (dist < 0.01) { nav.path.shift(); continue; }
    const step = Math.min(dist, budget, 2), next = { x: a.x + dx / dist * step, y: a.y + dy / dist * step };
    if (!sweptFree(a, next, free)) break;
    a.x = next.x; a.y = next.y; budget -= step;
    a.facing = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up";
    if (step >= dist - 0.01) nav.path.shift();
  }
  const moved = Math.hypot(a.x - start.x, a.y - start.y);
  if (moved > 0.001) {
    a.moving = true; a.vx = (a.x - start.x) / Math.max(dt, 1e-6); a.vy = (a.y - start.y) / Math.max(dt, 1e-6);
    a.phase += moved * 0.2; nav.blockedFor = 0;
  } else nav.blockedFor += dt;
  if (nav.yielding && !nav.path.length) { nav.yielding = false; nav.replanIn = 0.8; nav.blockedFor = 0; }
  if (nav.blockedFor >= 0.65) {
    nav.blockedFor = 0; nav.recoveries++;
    if (nav.recoveries >= 6) return "stuck";
    const yielding = yieldPath(w, a);
    nav.yielding = !!yielding;
    nav.path = yielding ?? findPath(w, a, goal) ?? [];
    nav.replanIn = nav.path.length ? 0 : 0.2;
  }
  return "moving";
}