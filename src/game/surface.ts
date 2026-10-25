// The surface above the buried dungeon, as an area definition. Pure,
// deterministic builder (no DOM): fixed seed, stable prop ids (kind@tx,ty).
//
// Layout story: the keep that once stood here is gone, sunk and buried. Soil
// heaped over its halls and walls, then the wild took it: meadow, dense woods,
// rocky ground and damp hollows, all on uneven, noise-shaped land. The buried
// footprint only shows if you look for it. Low earth humps sit over the halls
// and grassy banks run along the old wall courses (both warped, so they never
// match the plan exactly). A handful of moss-eaten remains break the turf. To
// the south the old SURFACE GATE lies under plain-looking ground. Nothing glows
// except the rune circle, which sits in a small clearing of bare earth.
import { mulberry, hash2 } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import { propDef } from "./content/props";
import { DUNGEON_TO_SURFACE, SURFACE_GATE, SURFACE_GATE_CORRIDOR, SURFACE_GATE_ZONE } from "./content/geography";
import { reachable, type Box } from "./sim/reach";
import { buildDungeon, type AreaData, type DecalDef, type LightDef, type LooseItem, type PropDef } from "./map";

export const SW = 96, SH = 72;
const SURFACE_SEED = 7331;
/** Rune circle centre tile. */
export const RUNE_T = { x: 48, y: 26 };
/** Radius (px) of the rune circle's own art; the builder keeps decals clear of it (plus a margin). */
export const RUNE_ART_R = 64;
/** No builder prop is placed within this many tiles of the rune centre (sprites never overlap the circle). */
export const RUNE_CLEAR_PROPS = 7;
export const CART_T = { x: 72, y: 36 };

export const enum Zone { MEADOW, WOODS, ROCKY, HOLLOW, CLEARING, GATE }

/** Smoothstepped value noise in [0, 1] at cell size k. */
export function vnoise(x: number, y: number, k: number, s: number) {
  const fx = x / k, fy = y / k, x0 = Math.floor(fx), y0 = Math.floor(fy);
  let tx = fx - x0, ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
/** Three octaves, roughly [0.1, 0.9], mean 0.5. */
const fbm = (x: number, y: number, s: number) => 0.5 * vnoise(x, y, 13, s) + 0.3 * vnoise(x, y, 6, s + 1) + 0.2 * vnoise(x, y, 3, s + 2);

export function buildSurface(): AreaData {
  const rng = mulberry(SURFACE_SEED);
  const n = SW * SH;
  const grid = new Uint8Array(n).fill(T.FLOOR);
  const style = new Uint8Array(n).fill(FS.GRASS);
  const tvar = new Uint8Array(n);
  const zone = new Uint8Array(n);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < SW && y < SH;
  const G = (x: number, y: number) => (inb(x, y) ? grid[y * SW + x] : T.THICKET);
  const dRune = (x: number, y: number) => Math.hypot(x - RUNE_T.x, y - RUNE_T.y);
  const inGate = (x: number, y: number, m = 0) =>
    x >= SURFACE_GATE_ZONE.x0 - m && x <= SURFACE_GATE_ZONE.x1 + m && y >= SURFACE_GATE_ZONE.y0 - m && y <= SURFACE_GATE_ZONE.y1 + m;

  // ---- what lies beneath: the dungeon's undamaged plan, sampled through a
  // gentle warp so the land follows the footprint without copying it.
  const dg = buildDungeon();
  const under = new Int8Array(n).fill(-1); // -1 outside the footprint, 0 buried wall mass, 1 buried hall/corridor
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const ux = x - DUNGEON_TO_SURFACE.dx + Math.round((vnoise(x, y, 7, 210) - 0.5) * 3.2);
    const uy = y - DUNGEON_TO_SURFACE.dy + Math.round((vnoise(x, y, 7, 211) - 0.5) * 3.2);
    if (ux < 0 || uy < 0 || ux >= dg.w || uy >= dg.h) continue;
    under[y * SW + x] = dg.plan[uy * dg.w + ux] === T.WALL ? 0 : 1;
  }
  const U = (x: number, y: number) => (inb(x, y) ? under[y * SW + x] : -1);
  /** A buried wall course: wall mass right next to a buried hall. */
  const wallLine = (x: number, y: number) => U(x, y) === 0 && (U(x - 1, y) === 1 || U(x + 1, y) === 1 || U(x, y - 1) === 1 || U(x, y + 1) === 1);

  // ---- land: zones from layered noise, the world's edge closed by thicket
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = y * SW + x;
    const edge = Math.min(x, y, SW - 1 - x, SH - 1 - y);
    if (edge < 2 + Math.floor(fbm(x, y, 220) * 7 - 0.6)) { grid[i] = T.THICKET; continue; }
    const wood = fbm(x, y, 201), wet = fbm(x, y, 202), rock = fbm(x, y, 203), dr = dRune(x, y);
    let z: Zone;
    if (inGate(x, y)) z = Zone.GATE;
    else if (dr < 6.2 + (vnoise(x, y, 3, 205) - 0.5) * 1.6) z = Zone.CLEARING;
    else if (Math.hypot(x - CART_T.x - 1, y - CART_T.y) < 3.2) z = Zone.MEADOW;
    else if (wet > 0.6 && !wallLine(x, y)) z = Zone.HOLLOW;
    else if (wood > 0.55) z = Zone.WOODS;
    else if (rock > 0.58) z = Zone.ROCKY;
    else z = Zone.MEADOW;
    zone[i] = z;
    let s: number = FS.GRASS;
    const pn = vnoise(x, y, 4, 206);
    switch (z) {
      case Zone.CLEARING: s = dr < 4.6 ? FS.EARTH : pn > 0.62 ? FS.MOSS : FS.GRASS; break;
      case Zone.GATE: s = x === SURFACE_GATE_ZONE.x0 || x === SURFACE_GATE_ZONE.x1 ? FS.MOSS : FS.GRASS; break;
      case Zone.HOLLOW: s = wet > 0.67 ? FS.MUD : pn > 0.3 ? FS.MOSS : FS.GRASS; break;
      case Zone.WOODS: s = wet > 0.5 && pn > 0.58 ? FS.MOSS : pn < 0.12 ? FS.GRASS : FS.LEAF; break;
      case Zone.ROCKY: s = pn > 0.58 ? FS.EARTH : pn > 0.36 ? FS.DIRT : FS.GRASS; break;
      default: s = vnoise(x, y, 5, 62) > 0.78 ? FS.DIRT : pn > 0.84 ? FS.MOSS : FS.GRASS;
    }
    // soil banked over the buried wall courses: bare earth in places, moss where stone lies shallow
    if (wallLine(x, y) && z !== Zone.CLEARING && z !== Zone.GATE) {
      const b = vnoise(x, y, 4, 215);
      if (b > 0.6) s = FS.EARTH; else if (b < 0.24) s = FS.MOSS;
    }
    style[i] = s;
  }
  // seal nothing: any floor not connected to the rune becomes part of the thicket
  {
    const seen = new Uint8Array(n), q = [RUNE_T.y * SW + RUNE_T.x];
    seen[q[0]] = 1;
    while (q.length) {
      const k = q.pop()!, x = k % SW, y = (k / SW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = ny * SW + nx;
        if (inb(nx, ny) && !seen[nk] && grid[nk] === T.FLOOR) { seen[nk] = 1; q.push(nk); }
      }
    }
    for (let k = 0; k < n; k++) if (grid[k] === T.FLOOR && !seen[k]) grid[k] = T.THICKET;
  }
  // the entrance zone is always open ground
  for (let y = SURFACE_GATE_ZONE.y0; y <= SURFACE_GATE_ZONE.y1; y++) for (let x = SURFACE_GATE_ZONE.x0; x <= SURFACE_GATE_ZONE.x1; x++) grid[y * SW + x] = T.FLOOR;

  const plan = grid.slice();
  const props: PropDef[] = [], lights: LightDef[] = [], decals: DecalDef[] = [], loose: LooseItem[] = [];
  const ids = new Set<string>();
  /** Blocking footprints (tiles touched by a collision box). Every blocking prop keeps a one-tile free ring, so no pockets can form. */
  const occ = new Uint8Array(n);
  /** Tiles holding a non-blocking sprite (ferns, grass), so they don't stack. */
  const deco = new Uint8Array(n);
  /** Tiles where nothing blocking may stand: the entrance, the cart's clearing, trails. */
  const noBlock = new Uint8Array(n);
  const mark = (arr: Uint8Array, cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (inb(x, y) && Math.hypot(x - cx, y - cy) <= r) arr[y * SW + x] = 1;
  };
  for (let y = SURFACE_GATE_ZONE.y0 - 1; y <= SURFACE_GATE_ZONE.y1 + 1; y++) for (let x = SURFACE_GATE_ZONE.x0 - 1; x <= SURFACE_GATE_ZONE.x1 + 1; x++) if (inb(x, y)) noBlock[y * SW + x] = 1;
  mark(noBlock, CART_T.x + 1.5, CART_T.y + 0.5, 3.2);
  // game trails (never drawn): keep the woods open between the rune, the cart and the old gate
  const trail = (ax: number, ay: number, bx: number, by: number, s: number) => {
    const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
    for (let t = 0; t <= len; t += 0.5) {
      const f = t / len, wob = (vnoise(t, s, 6, 250) - 0.5) * 6 * Math.sin(f * Math.PI);
      mark(noBlock, ax + (bx - ax) * f + nx * wob, ay + (by - ay) * f + ny * wob, 1.1);
    }
  };
  trail(RUNE_T.x, RUNE_T.y + 5, SURFACE_GATE.x, SURFACE_GATE_ZONE.y0 - 1, 1);
  trail(RUNE_T.x + 5, RUNE_T.y + 1, CART_T.x - 1, CART_T.y, 2);
  trail(RUNE_T.x - 5, RUNE_T.y + 2, 30, 34, 3);

  const footprint = (kind: string, px: number, py: number) => {
    const b = propDef(kind).box;
    if (!b) return null;
    return { x0: Math.floor((px - b[0] / 2) / TS), x1: Math.floor((px + b[0] / 2 - 0.01) / TS), y0: Math.floor((py - b[1]) / TS), y1: Math.floor((py - 0.01) / TS) };
  };
  const tooNearRune = (px: number, py: number) => Math.hypot(px - (RUNE_T.x * TS + 8), py - (RUNE_T.y * TS + 8)) < RUNE_CLEAR_PROPS * TS;
  /** Can a prop stand at (px, py)? Blocking ones need floor under the box and a free floor ring around it. */
  const canPlace = (kind: string, px: number, py: number, strict = true) => {
    if (tooNearRune(px, py)) return false;
    const tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    if (!inb(tx, ty) || G(tx, ty) !== T.FLOOR) return false;
    const f = footprint(kind, px, py);
    if (!f) return !deco[ty * SW + tx] && !occ[ty * SW + tx];
    for (let y = f.y0 - 1; y <= f.y1 + 1; y++) for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
      if (!inb(x, y) || G(x, y) !== T.FLOOR || occ[y * SW + x]) return false;
      const inside = x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
      if (inside && (noBlock[y * SW + x] && strict)) return false;
      if (inside && (deco[y * SW + x] || inGate(x, y))) return false;
    }
    return true;
  };
  const P = (kind: string, px: number, py: number, o: Partial<PropDef> = {}) => {
    const tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    let id = o.id ?? `${kind}@${tx},${ty}`;
    for (let k = 2; ids.has(id); k++) id = `${kind}@${tx},${ty}#${k}`;
    ids.add(id);
    const p: PropDef = { kind, x: Math.round(px), y: Math.round(py), v: 0, ...o, id };
    props.push(p);
    const f = footprint(kind, p.x, p.y);
    if (f) { for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (inb(x, y)) occ[y * SW + x] = 1; }
    else if (inb(tx, ty)) deco[ty * SW + tx] = 1;
    const L = propDef(kind).light;
    if (L && (L.when === "always" || p.lit)) lights.push({ x: p.x + L.dx, y: p.y + L.dy, rad: L.rad, col: L.col, int: L.int, flick: L.flick, owner: id });
    return p;
  };
  /** Tile anchor -> px, with an optional sub-tile jitter so nothing lines up on the grid. */
  const at = (tx: number, ty: number, jitter = 0) => ({
    x: tx * TS + 8 + (jitter ? Math.round((hash2(tx, ty, 260) - 0.5) * 2 * jitter) : 0),
    y: ty * TS + 16 - (jitter ? Math.round(hash2(tx, ty, 261) * jitter * 0.6) : 0),
  });

  // ---- the rune circle (dormant, dark and overgrown until the dungeon rune wakes it)
  const rc = { x: RUNE_T.x * TS + 8, y: RUNE_T.y * TS + 8 };
  props.push({ id: "rune.surface", kind: "runecircle", x: rc.x, y: rc.y, v: 0 });
  // No baseline glow: presentation drives this light from 0 (dormant) to full.
  lights.push({ x: rc.x, y: rc.y, rad: 78, col: [0.6, 0.38, 1], int: 0.75, flick: 0.06, id: "runeglow" });

  // ---- the buried surface gate: walkable, flat markers only
  const gate = at(SURFACE_GATE.x, SURFACE_GATE.y);
  P("buriedgate", gate.x, gate.y);
  const cor = SURFACE_GATE_CORRIDOR, wL = SURFACE_GATE_ZONE.x0, wR = SURFACE_GATE_ZONE.x1;
  P("capstone", wL * TS + 9, (cor.y + 1) * TS + 15);
  P("capstone", wR * TS + 7, (cor.y + 3) * TS + 14, { v: 1 });

  // ---- the few remains that still break the surface (on buried walls and halls)
  const remains: [string, number, number, number][] = [
    ["wallstub", 41, 22, 0], ["wallstub", 70, 18, 1], ["masonry", 58, 15, 0], ["masonry", 25, 37, 1],
    ["stoneslab", 50, 39, 0], ["statue_toppled", 22, 15, 0], ["statue_toppled", 77, 41, 1],
    ["standingstone", 44, 12, 0], ["standingstone", 53, 10, 1], ["cairn", 30, 47, 1],
  ];
  const placedRemains: PropDef[] = [];
  for (const [kind, tx, ty, v] of remains) {
    const a = at(tx, ty);
    if (canPlace(kind, a.x, a.y, false)) placedRemains.push(P(kind, a.x, a.y, { v }));
  }

  // ---- the cart and the basket it spilled
  P("cart", CART_T.x * TS + 8, CART_T.y * TS + 16);
  loose.push({ id: "basket", item: "basket", x: 75 * TS + 4, y: 37 * TS + 10 });

  // ---- vegetation: visit tiles in a shuffled order so nothing grows on a lattice
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  const tryPlace = (kind: string, tx: number, ty: number, v: number, jitter = 4) => {
    const a = at(tx, ty, jitter);
    if (!canPlace(kind, a.x, a.y)) return false;
    P(kind, a.x, a.y, { v });
    return true;
  };
  for (const i of order) {
    const x = i % SW, y = (i / SW) | 0;
    if (grid[i] !== T.FLOOR) continue;
    const z = zone[i] as Zone;
    if (z === Zone.CLEARING) continue;
    const r = rng(), clump = vnoise(x, y, 4, 230), rockN = fbm(x, y, 203), wl = wallLine(x, y);
    if (z === Zone.GATE) {
      // taller weeds along the two buried wall lines; nothing else
      if ((x === wL || x === wR) && r < 0.4) tryPlace("tallgrass", x, y, 2, 3);
      continue;
    }
    let c = 0;
    const pick = (p: number) => { c += p; return r < c; };
    switch (z) {
      case Zone.WOODS:
        if (pick(0.12 + 0.5 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
        else if (pick(0.07)) tryPlace("bush", x, y, (rng() * 4) | 0);
        else if (pick(0.04)) tryPlace("sapling", x, y, (rng() * 2) | 0);
        else if (pick(0.02)) tryPlace("log", x, y, (rng() * 3) | 0, 3);
        else if (pick(0.012)) tryPlace("stump", x, y, (rng() * 2) | 0);
        else if (pick(0.016)) tryPlace("rock", x, y, 2 + ((rng() * 2) | 0));
        else if (pick(0.26)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
        break;
      case Zone.HOLLOW:
        if (pick(0.22)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
        else if (pick(0.1)) tryPlace("tallgrass", x, y, (rng() * 2) | 0, 5);
        else if (pick(0.05 * (0.5 + clump))) tryPlace("tree", x, y, 2);
        else if (pick(0.05)) tryPlace("bush", x, y, 2 + ((rng() * 2) | 0));
        else if (pick(0.015)) tryPlace("log", x, y, (rng() * 3) | 0, 3);
        else if (pick(0.012)) tryPlace("boulder", x, y, 1);
        break;
      case Zone.ROCKY: {
        const rk = Math.max(0, rockN - 0.5) * 2.2 * (0.4 + clump);
        if (pick(0.16 * rk)) tryPlace("rock", x, y, (rng() * 2) | 0);
        else if (pick(0.06 * rk)) tryPlace("boulder", x, y, (rng() * 3) | 0);
        else if (pick(rockN > 0.66 ? 0.03 : 0)) tryPlace("outcrop", x, y, (rng() * 2) | 0, 2);
        else if (pick(0.03)) tryPlace("tree", x, y, (rng() * 3) | 0);
        else if (pick(0.035)) tryPlace("bush", x, y, (rng() * 4) | 0);
        else if (pick(0.04)) tryPlace("tallgrass", x, y, (rng() * 3) | 0, 5);
        else if (pick(0.03)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
        break;
      }
      default: // meadow
        if (pick(0.035 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
        else if (pick(0.035 * (0.4 + clump))) tryPlace("bush", x, y, (rng() * 4) | 0);
        else if (pick(0.012)) tryPlace("sapling", x, y, (rng() * 2) | 0);
        else if (pick(0.005)) tryPlace("stump", x, y, (rng() * 2) | 0);
        else if (pick(0.006)) tryPlace("rock", x, y, (rng() * 4) | 0);
        else if (pick((wl ? 0.16 : 0.05) * (0.5 + clump))) tryPlace("tallgrass", x, y, (rng() * 3) | 0, 5);
    }
  }

  // ---- safety net: blocking props keep a free ring, so this should never fire;
  // if a pocket ever appears, open it by removing the vegetation around it.
  const blockBoxes = (): Box[] => props.flatMap((p) => {
    const b = propDef(p.kind).box;
    return b ? [[p.x - b[0] / 2, p.y - b[1], p.x + b[0] / 2, p.y] as Box] : [];
  });
  for (let pass = 0; pass < 4; pass++) {
    const boxes = blockBoxes();
    const reach = reachable({ w: SW, h: SH, grid }, boxes, { x: rc.x, y: rc.y + 4 });
    const sealed: number[] = [];
    for (let k = 0; k < n; k++) if (!reach[k] && grid[k] === T.FLOOR && !occ[k]) sealed.push(k);
    if (!sealed.length) break;
    const near = (p: PropDef) => sealed.some((k) => Math.abs((k % SW) * TS + 8 - p.x) < 40 && Math.abs(((k / SW) | 0) * TS + 8 - p.y) < 40);
    const keep = new Set(placedRemains);
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (propDef(p.kind).box && !keep.has(p) && p.kind !== "cart" && near(p)) props.splice(i, 1);
    }
    occ.fill(0);
    for (const p of props) { const f = footprint(p.kind, p.x, p.y); if (f) for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) occ[y * SW + x] = 1; }
  }

  // ---- decals, in three layers: land shape, ground cover, small plants
  const D = (kind: string, x: number, y: number, v = 0, w?: number, h?: number) => decals.push({ kind, x: Math.round(x), y: Math.round(y), v, w, h });
  /** Decals stay off the rune circle's footprint: nothing there the rune's own plants wouldn't explain. */
  const clearOfRune = (x: number, y: number, rad: number) => Math.hypot(x - rc.x, y - rc.y) > RUNE_ART_R + 6 + rad;
  const jit = (s: number) => (rng() - 0.5) * s;

  // land shape: humps over the buried halls, low banks along the wall courses, hollows, canopy shade
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
    const i = y * SW + x;
    if (grid[i] !== T.FLOOR || zone[i] === Zone.GATE) continue;
    const bx = x * TS + 8, by = y * TS + 8, h = hash2(x, y, 240);
    if (under[i] === 1 && h < 0.05) {
      const w = 26 + rng() * 44, hh = 12 + rng() * 14;
      if (clearOfRune(bx, by, w / 2)) D("hump", bx + jit(10), by + jit(8), style[i] === FS.EARTH || zone[i] === Zone.ROCKY ? 1 : 0, w, hh);
    } else if (wallLine(x, y) && h < 0.34 && vnoise(x, y, 5, 241) > 0.3) {
      const w = 18 + rng() * 14;
      if (clearOfRune(bx, by, w / 2)) D("hump", bx + jit(6), by + jit(6), style[i] === FS.EARTH ? 1 : 0, w, 9 + rng() * 6);
    } else if (zone[i] === Zone.HOLLOW && h > 0.95) {
      if (clearOfRune(bx, by, 30)) D("hollow", bx + jit(8), by + jit(8), 0, 30 + rng() * 30, 16 + rng() * 14);
    }
  }
  for (const p of props) if (p.kind === "tree" && hash2(p.x, p.y, 242) < 0.65 && clearOfRune(p.x + 6, p.y - 12, 28)) D("shade", p.x + 6 + jit(6), p.y - 12 + jit(4), 0, 44 + rng() * 14);

  // the buried entrance, readable only if you look: two parallel low banks over
  // the corridor walls, a faint sunken strip between them, a swell where the arch lies
  {
    const top = SURFACE_GATE_ZONE.y0 * TS + 4, len = (SURFACE_GATE.y - SURFACE_GATE_ZONE.y0) * TS + 4;
    D("ridge", wL * TS + 8, top, 1, len, 10);
    D("ridge", wR * TS + 8, top + 6, 1, len - 6, 10);
    D("hollow", (cor.x + cor.w / 2) * TS, (cor.y + cor.h / 2) * TS + 4, 0, cor.w * TS - 8, cor.h * TS);
    D("hump", gate.x, gate.y - 6, 0, 64, 18);
  }

  // ground cover
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
    const i = y * SW + x;
    if (grid[i] !== T.FLOOR) continue;
    const bx = x * TS, by = y * TS, r = rng(), s = style[i];
    if (!clearOfRune(bx + 8, by + 8, 14)) continue;
    if (zone[i] === Zone.GATE) {
      if ((x === wL || x === wR) && r < 0.45) D("mosspatch", bx + 8 + jit(6), by + 8 + jit(10), 1, 10 + rng() * 8);
      continue;
    }
    if (s === FS.MOSS) { if (r < 0.12) D("mosspatch", bx + 8 + jit(8), by + 8 + jit(8), (rng() * 2) | 0, 10 + rng() * 14); }
    else if (s === FS.LEAF) { if (r < 0.4) D("leaves", bx + 8 + jit(6), by + 8 + jit(6), 0); else if (r < 0.45) D("mosspatch", bx + 8, by + 8, 0, 10 + rng() * 10); }
    else if (s === FS.MUD) { if (r < 0.06) D("puddle", bx + jit(6), by + 4 + jit(4), (rng() * 2) | 0, 14 + rng() * 14, 6 + rng() * 4); else if (r < 0.1) D("pebbles", bx + 8, by + 8, 0); }
    else if (s === FS.EARTH) { if (r < 0.09) D("pebbles", bx + 8 + jit(6), by + 8 + jit(6), 0); }
    else if (s === FS.DIRT) { if (r < 0.06) D("pebbles", bx + 8, by + 8, 0); else if (r < 0.09) D("debris", bx + rng() * 12, by + rng() * 12, (rng() * 4) | 0); }
    else if (r < 0.025) D("mosspatch", bx + 8 + jit(8), by + 8 + jit(8), 1, 8 + rng() * 10);
  }

  // small plants
  const meadowFlowers = (x: number, y: number) => vnoise(x, y, 5, 270) > 0.62;
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
    const i = y * SW + x;
    if (grid[i] !== T.FLOOR) continue;
    const bx = x * TS, by = y * TS, r = rng(), s = style[i], z = zone[i] as Zone;
    if (!clearOfRune(bx + 8, by + 8, 10)) continue;
    if (z === Zone.GATE) {
      // sparse grass in the sunken strip, thick weeds along the buried walls
      if (x === wL || x === wR) { if (r < 0.7) D("weeds", bx + 8 + jit(8), by + 12 + jit(6), 0); }
      else if (r < 0.06) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
      continue;
    }
    if (wallLine(x, y) && r < 0.22) { D("weeds", bx + 8 + jit(10), by + 12 + jit(8), 0); continue; }
    if (s === FS.GRASS) {
      if (z === Zone.MEADOW && meadowFlowers(x, y) && r < 0.16) D("wildflowers", bx + 8 + jit(8), by + 8 + jit(8), (vnoise(x, y, 9, 271) * 4) | 0);
      else if (r < 0.3) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
      else if (r < 0.34) D("flowers", bx + 8, by + 8, (rng() * 4) | 0);
      if (rng() < 0.12) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
    } else if (s === FS.MOSS) { if (r < 0.1) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0); else if (r < 0.13) D("flowers", bx + 8, by + 8, 0); }
    else if (s === FS.LEAF) { if (r < 0.05) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0); }
    else if (s === FS.MUD) { if (r < 0.08) D("weeds", bx + 8 + jit(8), by + 12, 0); }
    else if (r < 0.1) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
  }
  // roots at tree feet; moss, ivy and weeds creeping over the remains
  for (const p of props) {
    if ((p.kind === "tree" || p.kind === "stump") && rng() < 0.6) D("roots", p.x - 4 + jit(4), p.y - 4, 0);
    if (placedRemains.includes(p)) {
      for (let k = 0; k < 4; k++) D("ivy", p.x + jit(28), p.y - 2 + jit(6), (rng() * 4) | 0, 10 + rng() * 14);
      for (let k = 0; k < 2; k++) D("mosspatch", p.x + jit(30), p.y + jit(8), (rng() * 2) | 0, 10 + rng() * 10);
      D("weeds", p.x + jit(20), p.y + 2, 0);
    }
  }

  return {
    id: "surface", w: SW, h: SH, grid, plan, style, tvar, rooms: [], props, decals, lights, loose,
    start: { x: rc.x, y: rc.y + 4 }, exits: [], drips: [], outdoor: true, ambient: [0.32, 0.31, 0.42],
  };
}
