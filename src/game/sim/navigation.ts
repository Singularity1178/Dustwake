// Pathfinding and walking for bodies under orders, built for an area far larger
// than a screen. Pure sim. Three layers, each cached per area and body size:
//
//   1. Cells. A tile is standable if the body fits with its feet at the tile's
//      centre; two neighbours connect if the body stays free along the step
//      between them (the rule of sim/reach.ts and of locomotion). Evaluated
//      lazily and kept per *sector* (SECTOR x SECTOR tiles): a layout change
//      (a tree felled, a wall built) bumps only the sectors it can affect
//      (world/area.ts: sectorRev), and only those are thrown away. Felling a
//      tree in Westwake costs nothing at the ruins.
//
//   2. Regions. Within a sector, the connected groups of standable cells. Two
//      regions of neighbouring sectors are linked where a step crosses the
//      border. The region graph is the coarse map of the area: a search over
//      it (A*, a few hundred nodes for a trip across the overworld) says at
//      once whether somewhere can be reached at all, and through which
//      regions: the corridor.
//
//   3. Tiles. A* over cells, confined to the corridor, so the fine search
//      never floods the map. A long trip is planned in legs: the tile path is
//      made for the next LEG regions only and the walker plans again when it
//      gets there, so setting out for somewhere a thousand tiles away costs
//      the same as crossing a street, and a route adapts as the land changes.
//
// Dynamic bodies are never baked in: they are checked while planning (a path
// goes round a body standing in the way) and at every swept movement step.
//
// Far from the player (sim/lod.ts: isAbstract) a walker follows its planned path
// without testing other bodies at all. The path itself is still a real one over
// real ground, so wherever it is when the player comes near, it is standing
// somewhere it could have walked to.
import { actorDef } from "../content/actors";
import { TS, isSolidT } from "../content/tiles";
import { SECTOR, type Area } from "../world/area";
import { areaOf, type Actor, type World } from "../world/world";
import type { Destination, Point } from "../world/jobs";
import { actorBoxes, propBlocks } from "./collision";
import { cellFeet, type Box } from "./reach";
import { actorSpeed } from "./actorStats";
import { isAbstract } from "./lod";

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
/** Region ids are `sector * RMAX + n`: a sector of 256 cells has at most 128 regions. */
const RMAX = 256;
/** Regions of corridor a single leg's tile path covers. */
export const LEG = 8;
const SECTOR_PX = SECTOR * TS;

export interface NavGrid {
  /** The area's layout revision (kept for callers that compare; the grid itself is always current). */
  readonly revision: number;
  readonly size: readonly [number, number];
  /** Is the body free with its feet at (x, y)? Static geometry only (tiles and props). Always live. */
  free: (x: number, y: number) => boolean;
  stand: (k: number) => boolean;
  edges: (k: number) => number;
}

/** A binary min-heap of (key, priority); ties go to the lower key, so searches are deterministic. */
class Heap {
  private ks: number[] = [];
  private ps: number[] = [];
  get size() { return this.ks.length; }
  clear() { this.ks.length = 0; this.ps.length = 0; }
  private less(i: number, j: number) { return this.ps[i] < this.ps[j] || (this.ps[i] === this.ps[j] && this.ks[i] < this.ks[j]); }
  private swap(i: number, j: number) { const k = this.ks[i], p = this.ps[i]; this.ks[i] = this.ks[j]; this.ps[i] = this.ps[j]; this.ks[j] = k; this.ps[j] = p; }
  push(k: number, p: number) {
    let i = this.ks.length;
    this.ks.push(k); this.ps.push(p);
    while (i > 0) { const up = (i - 1) >> 1; if (!this.less(i, up)) break; this.swap(i, up); i = up; }
  }
  pop(): number {
    const top = this.ks[0], last = this.ks.length - 1;
    this.swap(0, last); this.ks.pop(); this.ps.pop();
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < last && this.less(l, m)) m = l;
      if (r < last && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return top;
  }
}

/** Per-area, per-body navigation data. See the file header. */
class Grid implements NavGrid {
  readonly w: number; readonly h: number;
  private cells: Int8Array;
  private links: Int8Array;
  /** Per sector: the area's sectorRev + 1 that `cells` / `links` are valid for (0: never filled). */
  private seen: Uint32Array;
  /** Per cell: its region id (valid for sectors whose regions are current), -1 for none. */
  readonly region: Int32Array;
  private regSeen: Uint32Array;
  private regCount: Uint16Array;
  private reps = new Map<number, number>();
  private adj = new Map<number, { v: number; list: number[] }>();
  // A* scratch, reused between searches (stamps instead of clearing)
  private g: Int32Array; private from: Int32Array; private mark: Uint32Array; private done: Uint32Array;
  private stamp = 0;
  private heap = new Heap();
  /** Instrumentation (tests, the soak report): cells expanded by the last tile search, regions by the last corridor search. */
  readonly stats = { tiles: 0, regions: 0 };

  constructor(readonly area: Area, readonly size: readonly [number, number]) {
    const n = area.w * area.h, s = area.sw * area.sh;
    this.w = area.w; this.h = area.h;
    this.cells = new Int8Array(n).fill(-1); this.links = new Int8Array(n).fill(-1);
    this.seen = new Uint32Array(s);
    this.region = new Int32Array(n).fill(-1);
    this.regSeen = new Uint32Array(s); this.regCount = new Uint16Array(s);
    this.g = new Int32Array(n); this.from = new Int32Array(n); this.mark = new Uint32Array(n); this.done = new Uint32Array(n);
  }

  get revision() { return this.area.layoutRevision; }
  feet(k: number): Point { const x = k % this.w; return cellFeet(x, (k - x) / this.w); }
  private sectorOf(k: number) { const x = k % this.w, y = (k - x) / this.w; return Math.floor(y / SECTOR) * this.area.sw + Math.floor(x / SECTOR); }
  private rev(s: number) { return this.area.sectorRev[s]; }

  /** Throw away a sector's cells if its layout has changed since they were worked out. */
  private sync(k: number) {
    const s = this.sectorOf(k), r = this.rev(s) + 1;
    if (this.seen[s] === r) return;
    const first = this.seen[s] === 0;
    this.seen[s] = r;
    if (first) return; // never filled: already blank
    const sx = s % this.area.sw, sy = (s - sx) / this.area.sw;
    const x1 = Math.min(this.w, (sx + 1) * SECTOR), y1 = Math.min(this.h, (sy + 1) * SECTOR);
    for (let y = sy * SECTOR; y < y1; y++) { const a = y * this.w + sx * SECTOR, b = y * this.w + x1; this.cells.fill(-1, a, b); this.links.fill(-1, a, b); }
  }

  free = (x: number, y: number): boolean => {
    const a = this.area, sz = this.size;
    const x0 = x - sz[0] / 2, x1 = x + sz[0] / 2, y0 = y - sz[1], y1 = y;
    for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++)
      for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++) {
        if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return false;
        if (isSolidT(a.grid[ty * a.w + tx])) return false;
      }
    return !a.blockedBy(x0, y0, x1, y1, propBlocks);
  };

  stand = (k: number): boolean => {
    if (k < 0 || k >= this.cells.length) return false;
    this.sync(k);
    if (this.cells[k] < 0) { const p = this.feet(k); this.cells[k] = this.free(p.x, p.y) ? 1 : 0; }
    return this.cells[k] === 1;
  };

  edges = (k: number): number => {
    this.sync(k);
    if (this.links[k] >= 0) return this.links[k];
    const x = k % this.w, y = (k - x) / this.w;
    let mask = 0;
    if (this.stand(k)) {
      const p = this.feet(k);
      for (let i = 0; i < 4; i++) {
        const nx = x + DX[i], ny = y + DY[i];
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const nk = ny * this.w + nx;
        if (this.stand(nk) && sweptFree(p, this.feet(nk), this.free)) mask |= 1 << i;
      }
    }
    this.links[k] = mask;
    return mask;
  };

  // ---------------------------------------------------------------- regions
  /** Work out a sector's regions (flood fills over its standable cells) if they are not current. */
  private ensureRegions(s: number) {
    const r = this.rev(s) + 1;
    if (this.regSeen[s] === r) return;
    this.regSeen[s] = r;
    const sw = this.area.sw, sx = s % sw, sy = (s - sx) / sw;
    const x0 = sx * SECTOR, y0 = sy * SECTOR, x1 = Math.min(this.w, x0 + SECTOR), y1 = Math.min(this.h, y0 + SECTOR);
    for (let y = y0; y < y1; y++) this.region.fill(-1, y * this.w + x0, y * this.w + x1);
    let count = 0;
    const stack: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = y * this.w + x;
      if (this.region[k] !== -1 || !this.stand(k)) continue;
      const id = s * RMAX + count++;
      this.reps.set(id, k);
      this.region[k] = id; stack.push(k);
      while (stack.length) {
        const c = stack.pop()!, m = this.edges(c), cx = c % this.w, cy = (c - cx) / this.w;
        for (let i = 0; i < 4; i++) {
          if (!(m & (1 << i))) continue;
          const nx = cx + DX[i], ny = cy + DY[i];
          if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
          const nk = ny * this.w + nx;
          if (this.region[nk] === -1) { this.region[nk] = id; stack.push(nk); }
        }
      }
    }
    this.regCount[s] = count;
  }

  /** The region a standable cell belongs to (-1: the cell cannot be stood on). */
  regionOf(k: number): number {
    if (!this.stand(k)) return -1;
    this.ensureRegions(this.sectorOf(k));
    return this.region[k];
  }
  /** A cell of the region to make for (its first, in row order). */
  rep(region: number): number { this.ensureRegions(Math.floor(region / RMAX)); return this.reps.get(region) ?? -1; }
  /** How many regions the area's sectors hold, for those worked out so far (instrumentation). */
  regionsKnown(): number { let n = 0; for (let s = 0; s < this.regCount.length; s++) if (this.regSeen[s]) n += this.regCount[s]; return n; }

  /** The regions a region touches across its sector's borders, in id order. Cached until any of the five sectors involved changes. */
  private neighbours(region: number): number[] {
    const s = Math.floor(region / RMAX), sw = this.area.sw, sh = this.area.sh, sx = s % sw, sy = (s - sx) / sw;
    this.ensureRegions(s);
    // sector revisions only ever grow, so their sum is a version of the neighbourhood
    let v = this.rev(s);
    if (sx > 0) v += this.rev(s - 1);
    if (sx < sw - 1) v += this.rev(s + 1);
    if (sy > 0) v += this.rev(s - sw);
    if (sy < sh - 1) v += this.rev(s + sw);
    const c = this.adj.get(region);
    if (c && c.v === v) return c.list;
    const x0 = sx * SECTOR, y0 = sy * SECTOR, x1 = Math.min(this.w, x0 + SECTOR), y1 = Math.min(this.h, y0 + SECTOR);
    const list: number[] = [];
    const look = (x: number, y: number) => {
      const k = y * this.w + x;
      if (this.region[k] !== region) return;
      const m = this.edges(k);
      for (let i = 0; i < 4; i++) {
        if (!(m & (1 << i))) continue;
        const nx = x + DX[i], ny = y + DY[i];
        if (nx >= x0 && ny >= y0 && nx < x1 && ny < y1) continue;
        const nr = this.regionOf(ny * this.w + nx);
        if (nr >= 0 && !list.includes(nr)) list.push(nr);
      }
    };
    for (let x = x0; x < x1; x++) { look(x, y0); if (y1 - 1 !== y0) look(x, y1 - 1); }
    for (let y = y0 + 1; y < y1 - 1; y++) { look(x0, y); if (x1 - 1 !== x0) look(x1 - 1, y); }
    list.sort((a, b) => a - b);
    this.adj.set(region, { v, list });
    return list;
  }

  /**
   * The corridor: the regions to pass through from `start` to the nearest of `goals`, fewest first (A* over the
   * region graph; each hop crosses one sector border, so sectors still to cross is an exact lower bound). Null:
   * there is no way, known without touching a tile beyond the regions looked at.
   */
  corridor(start: number, goals: ReadonlySet<number>, gx: number, gy: number): number[] | null {
    this.stats.regions = 0;
    if (start < 0) return null;
    if (goals.has(start)) return [start];
    const sw = this.area.sw, gsx = Math.floor(gx / SECTOR_PX), gsy = Math.floor(gy / SECTOR_PX);
    const h = (r: number) => { const s = Math.floor(r / RMAX), x = s % sw, y = (s - x) / sw; return Math.max(0, Math.abs(x - gsx) + Math.abs(y - gsy) - 1); };
    const best = new Map<number, number>([[start, 0]]), prev = new Map<number, number>(), closed = new Set<number>();
    const heap = new Heap();
    heap.push(start, h(start));
    while (heap.size) {
      const r = heap.pop();
      if (closed.has(r)) continue;
      closed.add(r); this.stats.regions++;
      if (goals.has(r)) {
        const out: number[] = [];
        for (let x: number | undefined = r; x !== undefined; x = prev.get(x)) out.push(x);
        return out.reverse();
      }
      const g = best.get(r)! + 1;
      for (const nb of this.neighbours(r)) {
        if (closed.has(nb) || (best.get(nb) ?? Infinity) <= g) continue;
        best.set(nb, g); prev.set(nb, r);
        heap.push(nb, g + h(nb));
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- tiles
  /**
   * A* over cells from `start` until `isGoal`, never leaving the `allowed` regions. `hx, hy, slack`: the goal point
   * (px) and how near counts, for the heuristic. `edgeOk`: a further test of a step (dynamic bodies). Returns the
   * goal cell reached (-1: none); `trace` then reads the way back.
   */
  search(start: number, isGoal: (k: number) => boolean, hx: number, hy: number, slack: number, allowed: ReadonlySet<number>, edgeOk: ((from: number, to: number) => boolean) | null): number {
    const st = ++this.stamp, { g, from, mark, done, heap, w } = this;
    const h = (k: number) => { const x = k % w, d = Math.abs(x * TS + 8 - hx) + Math.abs(((k - x) / w) * TS + 11 - hy) - slack; return d > 0 ? d / TS : 0; };
    heap.clear();
    this.stats.tiles = 0;
    g[start] = 0; from[start] = -1; mark[start] = st;
    heap.push(start, h(start));
    while (heap.size) {
      const k = heap.pop();
      if (done[k] === st) continue;
      done[k] = st; this.stats.tiles++;
      if (isGoal(k)) return k;
      const m = this.edges(k);
      if (!m) continue;
      const gk = g[k] + 1;
      for (let i = 0; i < 4; i++) {
        if (!(m & (1 << i))) continue;
        const n = k + DY[i] * w + DX[i];
        if (done[n] === st || (mark[n] === st && g[n] <= gk)) continue;
        if (!allowed.has(this.region[n])) continue;
        if (edgeOk && !edgeOk(k, n)) continue;
        mark[n] = st; g[n] = gk; from[n] = k;
        // (a hair of the heuristic on top: among equals, the one nearer the goal first)
        const hn = h(n);
        heap.push(n, gk + hn * 1.0001);
      }
    }
    return -1;
  }
  /** The cells from the last search's start to `end`, as feet positions. */
  trace(end: number): Point[] {
    const path: Point[] = [];
    for (let n = end; n >= 0; n = this.from[n]) path.push(this.feet(n));
    return path.reverse();
  }
}

const cache = new WeakMap<Area, Map<string, Grid>>();
function gridOf(area: Area, size: readonly [number, number]): Grid {
  const key = size.join(",");
  let grids = cache.get(area);
  if (!grids) cache.set(area, (grids = new Map()));
  let grid = grids.get(key);
  if (!grid) grids.set(key, (grid = new Grid(area, size)));
  return grid;
}

/** The navigation grid of an area for a body (cached; kept current sector by sector as the layout changes). */
export function navGrid(area: Area, a: Actor): NavGrid { return gridOf(area, actorDef(a).body.box); }
/** Search instrumentation for an area and body: cells and regions the last plan looked at, regions known so far. */
export function navStats(area: Area, a: Actor) { const g = gridOf(area, actorDef(a).body.box); return { ...g.stats, regionsKnown: g.regionsKnown() }; }

export function sweptFree(from: Point, to: Point, free: (x: number, y: number) => boolean): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let i = 0; i <= steps; i++) if (!free(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps)) return false;
  return true;
}

/** Work cannot reach through a solid tile. Props at the destination are not walls. */
export const lineOfSight = (area: Area, from: Point, to: Point) => sweptFree(from, to, (x, y) => !isSolidT(area.tileAtPx(x, y)));
export const atDestination = (area: Area, a: Point, goal: Pick<Destination, "x" | "y" | "range">) =>
  Math.hypot(a.x - goal.x, a.y - goal.y) <= goal.range + 0.01 && lineOfSight(area, a, goal);

const hits = (bodies: readonly Box[], x: number, y: number, size: readonly [number, number]) => {
  const x0 = x - size[0] / 2, x1 = x + size[0] / 2, y0 = y - size[1], y1 = y;
  for (const b of bodies) if (x1 > b[0] && x0 < b[2] && y1 > b[1] && y0 < b[3]) return true;
  return false;
};

type Goal = Pick<Destination, "x" | "y" | "range">;
/** What a plan needs before any search: the grid, the body-aware freedom test, where it starts, and what counts as there. */
function setup(w: World, a: Actor, goal: Goal, avoidActors: boolean) {
  const area = areaOf(w, a), grid = gridOf(area, actorDef(a).body.box), bodies = avoidActors ? actorBoxes(w, area.id, a.id) : [];
  const free = bodies.length ? (x: number, y: number) => grid.free(x, y) && !hits(bodies, x, y, grid.size) : grid.free;
  // the start: the nearest standable cell the body can step straight to from where it actually stands
  const sx = Math.floor(a.x / TS), sy = Math.floor((a.y - 3) / TS);
  let start = -1, near = Infinity;
  for (let y = sy - 2; y <= sy + 2; y++) for (let x = sx - 2; x <= sx + 2; x++) {
    if (x < 0 || y < 0 || x >= area.w || y >= area.h) continue;
    const k = y * area.w + x;
    if (!grid.stand(k)) continue;
    const p = grid.feet(k), d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < near && sweptFree(a, p, free)) { near = d; start = k; }
  }
  const R = Math.max(goal.range, TS);
  const exact = (p: Point) => goal.range < 4 && Math.hypot(p.x - goal.x, p.y - goal.y) <= TS && sweptFree(p, goal, free);
  const isGoal = (k: number) => {
    const p = grid.feet(k);
    if (Math.abs(p.x - goal.x) > R + 0.01 || Math.abs(p.y - goal.y) > R + 0.01) return false;
    return atDestination(area, p, goal) || exact(p);
  };
  // the regions that hold a cell which counts as there
  const goals = new Set<number>();
  if (start >= 0) {
    const tx0 = Math.max(0, Math.floor((goal.x - R) / TS) - 1), tx1 = Math.min(area.w - 1, Math.floor((goal.x + R) / TS) + 1);
    const ty0 = Math.max(0, Math.floor((goal.y - R) / TS) - 1), ty1 = Math.min(area.h - 1, Math.floor((goal.y + R) / TS) + 1);
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const k = y * area.w + x;
      if (grid.stand(k) && isGoal(k)) goals.add(grid.regionOf(k));
    }
  }
  return { area, grid, bodies, free, start, R, exact, isGoal, goals };
}

export interface PathPlan {
  path: Point[];
  /** The path is a leg: it ends at a waypoint on the way there, and the walker plans again from it. */
  partial: boolean;
}

function plan(w: World, a: Actor, goal: Goal, avoidActors: boolean, legs: boolean): PathPlan | null {
  const s = setup(w, a, goal, avoidActors), { area, grid } = s;
  if (s.start < 0 || !s.goals.size) return null;
  const corridor = grid.corridor(grid.regionOf(s.start), s.goals, goal.x, goal.y);
  if (!corridor) return null;
  const edgeOk = s.bodies.length ? (from: number, to: number) => sweptFree(grid.feet(from), grid.feet(to), s.free) : null;
  if (legs && corridor.length > LEG + 2) {
    // a long way: the tile path for the next LEG regions only, to a cell of the last of them
    const target = grid.rep(corridor[LEG]), t = grid.feet(target);
    const end = grid.search(s.start, (k) => k === target, t.x, t.y, 0, new Set(corridor.slice(0, LEG + 1)), edgeOk);
    return end < 0 ? null : { path: grid.trace(end), partial: true };
  }
  const end = grid.search(s.start, s.isGoal, goal.x, goal.y, s.R * Math.SQRT2, new Set(corridor), edgeOk);
  if (end < 0) return null;
  const path = grid.trace(end), p = grid.feet(end);
  if (!atDestination(area, p, goal) && s.exact(p)) path.push({ x: goal.x, y: goal.y });
  return { path, partial: false };
}

/** The whole way from where `a` stands to `goal` (cell centres), or null if there is none. */
export function findPath(w: World, a: Actor, goal: Goal, avoidActors = true): Point[] | null {
  return plan(w, a, goal, avoidActors, false)?.path ?? null;
}

/** The way to `goal`, as far as the next leg (see the file header): what a walker follows. Null: no way. */
export function planPath(w: World, a: Actor, goal: Goal, avoidActors = true): PathPlan | null {
  return plan(w, a, goal, avoidActors, true);
}

/**
 * Can `a` get to `goal` at all (ignoring other bodies)? Answered on the region graph, without a tile search: what
 * to ask when choosing between many candidates (which tree, which way out).
 */
export function reachable(w: World, a: Actor, goal: Goal): boolean {
  const s = setup(w, a, goal, false);
  return s.start >= 0 && s.goals.size > 0 && s.grid.corridor(s.grid.regionOf(s.start), s.goals, goal.x, goal.y) !== null;
}

/** Lower id keeps its route; the other actor backs into a reachable passing
 * place outside that route. No teleporting, pushing or disabling collision. */
function yieldPath(w: World, a: Actor): Point[] | null {
  const area = areaOf(w, a), grid = gridOf(area, actorDef(a).body.box);
  const peers = w.actors.filter((b) => b.id < a.id && b.area === a.area && b.job?.status === "running" && Math.hypot(b.x - a.x, b.y - a.y) < TS * 3)
    .sort((a, b) => a.id < b.id ? -1 : 1);
  const peer = peers[0];
  if (!peer) return null;
  const route = [peer, ...(peer.job?.nav?.path ?? [])];
  const cells: number[] = [], k0 = Math.floor((a.y - 3) / TS) * area.w + Math.floor(a.x / TS), sx = k0 % area.w, sy = Math.floor(k0 / area.w);
  for (let y = sy - 5; y <= sy + 5; y++) for (let x = sx - 5; x <= sx + 5; x++) {
    if (x < 0 || y < 0 || x >= area.w || y >= area.h) continue;
    const k = y * area.w + x, p = grid.feet(k);
    if (k !== k0 && grid.stand(k) && route.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= TS - 1)) cells.push(k);
  }
  cells.sort((i, j) => {
    const p = grid.feet(i), q = grid.feet(j);
    return Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y) || i - j;
  });
  for (const k of cells) {
    const path = findPath(w, a, { ...grid.feet(k), range: 1 });
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
  // Far from the player the walk is abstract (sim/lod.ts): the same path, no other bodies.
  const abstract = isAbstract(w, a);
  if (!nav.path.length) nav.path = ((abstract ? null : planPath(w, a, goal)) ?? planPath(w, a, goal, false))?.path ?? [];
  const start = { x: a.x, y: a.y }, grid = navGrid(area, a);
  let bodies = abstract ? [] : actorBoxes(w, a.area, a.id);
  // A body that finds itself inside another (two abstract walkers set down in one place) may always step out of it.
  if (bodies.length && hits(bodies, a.x, a.y, grid.size)) bodies = [];
  const free = bodies.length ? (x: number, y: number) => grid.free(x, y) && !hits(bodies, x, y, grid.size) : grid.free;
  let budget = actorSpeed(w, a) * dt;
  while (nav.path.length && budget > 0) {
    const p = nav.path[0], dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy);
    if (dist < 0.01) { nav.path.shift(); continue; }
    const step = abstract ? Math.min(dist, budget) : Math.min(dist, budget, 2), next = { x: a.x + dx / dist * step, y: a.y + dy / dist * step };
    if (!abstract && !sweptFree(a, next, free)) break;
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
    const yielding = abstract ? null : yieldPath(w, a);
    nav.yielding = !!yielding;
    nav.path = yielding ?? planPath(w, a, goal, !abstract)?.path ?? [];
    nav.replanIn = nav.path.length ? 0 : 0.2;
  }
  return "moving";
}
