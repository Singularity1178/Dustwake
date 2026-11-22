// Dynamic areas (pure, no DOM). The authored areas are a static id -> builder
// table (world/areas.ts). Floors, caves, outposts and generated wilds are made at
// runtime instead: an `AreaSpec` is saved with the world and selects a builder by
// `kind`, with its parameters (seed, size, parent, depth). Builders must be
// deterministic in the spec, so a save keeps the same diff-against-builder model
// as the authored areas; a spec with `store: "grid"` (player-built ground) keeps
// its whole tile grid, run-length coded, instead (world/save.ts, world/rle.ts).
//
// A spec may be linked under a parent area at a point: the parent gains a way
// down there (a portal added at runtime, re-attached on every load) and the new
// area's way up comes out beside it. Add a kind: write a builder here and put it
// in AREA_KINDS (docs/howto/add-a-room.md).
import { mulberry } from "../core/rng";
import { TS, T, FS } from "../content/tiles";
import { areaKit } from "../town";
import type { AreaData, Portal, Room } from "../map";
import type { Area } from "./area";

/** Where a runtime area hangs off its parent: the point in the parent (px) its way down is cut at. */
export interface AreaLink { area: string; x: number; y: number }

export interface AreaSpec {
  id: string;
  /** Which builder (AREA_KINDS). */
  kind: string;
  seed: number;
  /** Size in tiles (builders may grow it to fit the widest view). */
  w: number;
  h: number;
  /** The area it was made from (a floor's parent, a cave's surface). */
  parent?: string;
  /** How many levels down from the authored world it lies (1: under an authored area). */
  depth?: number;
  link?: AreaLink;
  /** How saves keep its tiles: a diff against the builder (default) or the whole grid, compressed. */
  store?: "diff" | "grid";
  /** Its name, shown on arrival and in lists. */
  label?: string;
}

export type SpecBuilder = (spec: AreaSpec) => AreaData;

/** At least the widest zoom's view (40 x 22.5 tiles) plus a rim, so the camera never runs off the edge. */
const MIN_W = 48, MIN_H = 32;

export const linkPortalId = (id: string) => `link.${id}`;

/** A dim underground light, so a generated floor reads even away from its torches. */
const DEEP_AMBIENT: [number, number, number] = [0.14, 0.13, 0.18];

/** Rooms joined by corridors: a test floor, a mine level. */
export function buildFloor(spec: AreaSpec): AreaData {
  const W = Math.max(MIN_W, spec.w | 0), H = Math.max(MIN_H, spec.h | 0);
  const k = areaKit(W, H), rng = mulberry((spec.seed >>> 0) || 1);
  const R = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const want = R(5, 8), rooms: Room[] = [];
  for (let tries = 0; rooms.length < want && tries < 400; tries++) {
    const w = R(6, 12), h = R(5, 8), x = R(2, W - w - 3), y = R(4, H - h - 3);
    if (rooms.some((r) => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
    rooms.push({ num: rooms.length + 1, name: `HALL ${rooms.length + 1}`, x, y, w, h });
  }
  // always at least one room, whatever the seed
  if (!rooms.length) rooms.push({ num: 1, name: "HALL 1", x: 4, y: 5, w: 10, h: 7 });
  for (const r of rooms) k.rect(r.x, r.y, r.w, r.h, T.FLOOR, FS.FLAG);
  // corridors two tiles wide, each room to the one before it (an L: across, then down)
  const mid = (r: Room) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
  for (let i = 1; i < rooms.length; i++) {
    const a = mid(rooms[i - 1]), b = mid(rooms[i]);
    k.rect(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x) + 2, 2, T.FLOOR, FS.FLAG);
    k.rect(b.x, Math.min(a.y, b.y), 2, Math.abs(b.y - a.y) + 2, T.FLOOR, FS.FLAG);
  }
  const r0 = rooms[0];
  for (const r of rooms) {
    k.Pt("torch", r.x + 1, r.y - 1, { lit: true });
    if (r.w > 7) k.Pt("torch", r.x + r.w - 2, r.y - 1, { lit: true });
    k.spot(`wander.${r.num}`, "wander", (r.x + r.w / 2) * TS, (r.y + r.h / 2) * TS + 8, "down");
  }
  // something to pick up in the far rooms (the soak's item census counts these)
  rooms.slice(1).forEach((r, i) => k.loose.push({ id: `stone.${i + 1}`, item: "stone", n: 1 + (i % 3), x: (r.x + r.w - 2) * TS + 8, y: (r.y + r.h - 1) * TS + 10 }));
  return finish(spec, k, W, H, rooms, r0.x + (r0.w >> 1), r0.y, FS.FLAG);
}

/** An organic cave: cellular automaton walls, the largest open region kept. */
export function buildCave(spec: AreaSpec): AreaData {
  const W = Math.max(MIN_W, spec.w | 0), H = Math.max(MIN_H, spec.h | 0);
  const k = areaKit(W, H), rng = mulberry((spec.seed >>> 0) || 7);
  const edge = (x: number, y: number) => x < 2 || y < 4 || x >= W - 2 || y >= H - 2;
  let cell = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cell[y * W + x] = edge(x, y) || rng() < 0.44 ? 1 : 0;
  for (let pass = 0; pass < 5; pass++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (edge(x, y)) { next[y * W + x] = 1; continue; }
      let n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) n += cell[(y + j) * W + x + i];
      next[y * W + x] = n >= 5 ? 1 : 0;
    }
    cell = next;
  }
  // the largest open region (flood fill); everything else is filled in
  const region = new Int32Array(W * H).fill(-1);
  let best = -1, bestN = 0, id = 0;
  for (let s = 0; s < W * H; s++) {
    if (cell[s] || region[s] >= 0) continue;
    const stack = [s];
    region[s] = id;
    let n = 0;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      for (const d of [1, -1, W, -W]) {
        const q = c + d;
        if (q >= 0 && q < W * H && !cell[q] && region[q] < 0) { region[q] = id; stack.push(q); }
      }
    }
    if (n > bestN) { bestN = n; best = id; }
    id++;
  }
  if (best < 0) { for (let y = 6; y < 12; y++) for (let x = 6; x < 16; x++) region[y * W + x] = best = 0; }
  for (let i = 0; i < W * H; i++) if (region[i] === best) k.set(i % W, Math.floor(i / W), T.FLOOR, FS.EARTH);
  // the way up: the open cell nearest the north-west with solid rock above it
  let ux = -1, uy = -1;
  for (let y = 5; y < H - 3 && ux < 0; y++) for (let x = 3; x < W - 3 && ux < 0; x++) {
    const i = y * W + x;
    if (region[i] === best && region[i - W] !== best && region[i + W] === best && region[i - 1] === best && region[i + 1] === best) { ux = x; uy = y; }
  }
  if (ux < 0) { ux = 8; uy = 7; k.rect(6, 7, 6, 4, T.FLOOR, FS.EARTH); }
  // braziers about the cave, kept off the way in
  let placed = 0;
  for (let t = 0; t < 600 && placed < 4; t++) {
    const x = 3 + Math.floor(rng() * (W - 6)), y = 5 + Math.floor(rng() * (H - 8));
    if (region[y * W + x] !== best || Math.hypot(x - ux, y - uy) < 6) continue;
    k.Pt("brazier", x, y, { lit: true });
    k.spot(`wander.${placed + 1}`, "wander", x * TS + 8, y * TS + 30, "up");
    placed++;
  }
  const rooms: Room[] = [{ num: 1, name: "CAVE", x: 2, y: 4, w: W - 4, h: H - 6 }];
  return finish(spec, k, W, H, rooms, ux, uy, FS.EARTH);
}

/** The way up (a stair nook cut into the rock north of tile (ux, uy)), and the AreaData. */
function finish(spec: AreaSpec, k: ReturnType<typeof areaKit>, W: number, H: number, rooms: Room[], ux: number, uy: number, _floor: number): AreaData {
  k.set(ux, uy - 1, T.FLOOR, FS.STAIR);
  const back = spec.link?.area ?? spec.parent;
  const arrive = { x: ux * TS + 8, y: uy * TS + 14 };
  if (back) {
    k.portals.push({
      id: "up", x: ux * TS + 1, y: (uy - 1) * TS + 1, w: TS - 2, h: 12, dir: "up",
      to: { area: back, portal: linkPortalId(spec.id) }, arrive, label: spec.label ? `UP FROM ${spec.label.toUpperCase()}` : undefined,
    });
  }
  return {
    id: spec.id, w: W, h: H, grid: k.grid, plan: k.grid.slice(), style: k.style, tvar: k.tvar, rooms,
    props: k.props, decals: k.decals, lights: k.lights, loose: k.loose, portals: k.portals, spots: k.spots,
    start: arrive, exits: [], drips: [], ambient: DEEP_AMBIENT,
  };
}

/** The builders a spec can name. */
export const AREA_KINDS: Record<string, SpecBuilder> = { floor: buildFloor, cave: buildCave };

export function buildFromSpec(spec: AreaSpec): AreaData {
  const b = AREA_KINDS[spec.kind];
  if (!b) throw new Error(`unknown area kind "${spec.kind}" (area "${spec.id}")`);
  return b(spec);
}

/** The parent's way down to a linked spec: a hole at the link point, pushed into going south. */
export function linkPortal(s: AreaSpec): Portal {
  const { x, y } = s.link!;
  return {
    id: linkPortalId(s.id), x: Math.round(x) - 10, y: Math.round(y) - 6, w: 20, h: 12, dir: "down",
    to: { area: s.id, portal: "up" }, arrive: { x: Math.round(x), y: Math.round(y) - 20 },
    label: s.label ? s.label.toUpperCase() : undefined,
  };
}

/** Give `area` the way down to every spec linked under it (idempotent; a runtime area keeps them in its base). */
export function attachLinks(specs: Iterable<AreaSpec>, area: Area) {
  let ps = area.base.portals;
  for (const s of specs) {
    if (s.link?.area !== area.id) continue;
    const id = linkPortalId(s.id);
    if (!ps) ps = (area.base as { portals?: Portal[] }).portals = [];
    if (!ps.some((p) => p.id === id)) ps.push(linkPortal(s));
  }
}

/** A fresh id for a new area of `kind`: gen.<kind>.<n>, never one in use. */
export function nextSpecId(specs: ReadonlyMap<string, AreaSpec>, kind: string, taken: (id: string) => boolean): string {
  for (let n = 1; ; n++) {
    const id = `gen.${kind}.${n}`;
    if (!specs.has(id) && !taken(id)) return id;
  }
}
