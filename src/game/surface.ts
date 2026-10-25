// The surface above the destroyed dungeon, as an area definition. Pure,
// deterministic builder (no DOM): fixed seed, stable prop ids (kind@tx,ty).
//
// Layout story: the keep that once stood over the dungeon is a ring of broken,
// moss-eaten walls. The land has swallowed the rest: buried wall courses peek
// through the turf, sinkholes and grates open onto the halls below, and to the
// south the old SURFACE GATE (marked on the schematic) is a sunken arch choked
// with earth and rubble. The rune circle sits on the keep's old plaza.
import { mulberry, hash2 } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import { propDef } from "./content/props";
import type { AreaData, DecalDef, LightDef, LooseItem, PropDef } from "./map";

export const SW = 96, SH = 72;
const SURFACE_SEED = 7331;
/** Rune circle centre tile. */
export const RUNE_T = { x: 48, y: 26 };

export function buildSurface(): AreaData {
  const rng = mulberry(SURFACE_SEED);
  const n = SW * SH;
  const grid = new Uint8Array(n).fill(T.FLOOR);
  const style = new Uint8Array(n).fill(FS.GRASS);
  const tvar = new Uint8Array(n);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < SW && y < SH;
  const set = (x: number, y: number, t: number, s?: number) => { if (!inb(x, y)) return; grid[y * SW + x] = t; if (s !== undefined) style[y * SW + x] = s; };
  const G = (x: number, y: number) => (inb(x, y) ? grid[y * SW + x] : T.THICKET);
  const smooth = (x: number, y: number, k: number, s: number) => {
    const fx = x / k, fy = y / k, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };

  // ---- ground: grass with dirt patches; thicket closes the world's edge
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const edge = Math.min(x, y, SW - 1 - x, SH - 1 - y);
    if (edge < 2 + Math.floor(smooth(x, y, 5, 61) * 4)) set(x, y, T.THICKET);
    else if (smooth(x, y, 7, 62) > 0.72) style[y * SW + x] = FS.DIRT;
  }

  // ---- the keep's ruined outline (follows the buried dungeon's footprint)
  const K = { x0: 26, y0: 10, x1: 70, y1: 46 };
  const wall = (x: number, y: number) => {
    const h = hash2(x, y, 63);
    if (h < 0.42) return; // collapsed gap
    if (h < 0.55) set(x, y, T.RUBBLE); else set(x, y, T.WALL, FS.RUIN);
  };
  for (let x = K.x0; x <= K.x1; x++) { wall(x, K.y0); if (Math.abs(x - 48) > 3) wall(x, K.y1); }
  for (let y = K.y0; y <= K.y1; y++) { wall(K.x0, y); wall(K.x1, y); }
  for (let y = K.y0; y < 20; y++) wall(56, y); // an inner wall over the old throne hall
  for (let x = K.x0; x < 38; x++) wall(x, 31);

  // ---- plaza around the rune: old flagstones, half reclaimed by turf
  for (let y = RUNE_T.y - 8; y <= RUNE_T.y + 8; y++) for (let x = RUNE_T.x - 8; x <= RUNE_T.x + 8; x++) {
    const d = Math.hypot(x - RUNE_T.x, y - RUNE_T.y);
    if (d > 7.5) continue;
    set(x, y, T.FLOOR, hash2(x, y, 64) < d / 12 ? FS.GRASS : FS.FLAG);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2, x = Math.round(RUNE_T.x + Math.cos(a) * 9), y = Math.round(RUNE_T.y + Math.sin(a) * 8);
    if (i === 2) continue; // south: the road
    if (i % 3 === 1) set(x, y, T.RUBBLE); else { set(x, y, T.PILLAR); tvar[y * SW + x] = 1; }
  }

  // ---- the old road south to the buried surface gate
  for (let y = RUNE_T.y + 7; y <= 59; y++) for (let x = 46; x <= 50; x++) if (hash2(x, y, 65) > 0.22) set(x, y, T.FLOOR, FS.COBBLE);
  const GATE = { x: 48, y: 61 };
  for (let y = 62; y < SH; y++) for (let x = 36; x <= 60; x++) if (Math.abs(x - 48) < 12 - (y - 62) * -0.5) set(x, y, T.THICKET);
  for (let x = 41; x <= 55; x++) if (x < 46 || x > 50) { set(x, 61, T.RUBBLE); if (hash2(x, 60, 66) < 0.5) set(x, 60, T.RUBBLE); }

  // ---- sinkholes into the dungeon below
  const pits = [{ x: 31, y: 20, w: 3, h: 2 }, { x: 61, y: 38, w: 2, h: 2 }, { x: 39, y: 39, w: 2, h: 2 }];
  for (const p of pits) {
    for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) if (hash2(x, y, 67) < 0.35) set(x, y, T.RUBBLE);
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) set(x, y, T.PIT);
  }

  const plan = grid.slice();
  const props: PropDef[] = [], lights: LightDef[] = [], decals: DecalDef[] = [], loose: LooseItem[] = [];
  const ids = new Set<string>();
  const occ = new Uint8Array(n);
  const P = (kind: string, tx: number, ty: number, o: Partial<PropDef> = {}) => {
    const id = o.id ?? `${kind}@${tx},${ty}`;
    ids.add(id);
    const p: PropDef = { kind, x: tx * TS + 8, y: ty * TS + 16, v: 0, ...o, id };
    props.push(p);
    occ[Math.floor(ty) * SW + Math.floor(tx)] = 1;
    const L = propDef(kind).light;
    if (L && (L.when === "always" || p.lit)) lights.push({ x: p.x + L.dx, y: p.y + L.dy, rad: L.rad, col: L.col, int: L.int, flick: L.flick, owner: id });
    return p;
  };
  const D = (kind: string, x: number, y: number, v = 0, w?: number, h?: number) => decals.push({ kind, x, y, v, w, h });

  // ---- the rune circle (dormant until the dungeon rune wakes it)
  const rc = { x: RUNE_T.x * TS + 8, y: RUNE_T.y * TS + 8 };
  props.push({ id: "rune.surface", kind: "runecircle", x: rc.x, y: rc.y, v: 0 });
  lights.push({ x: rc.x, y: rc.y, rad: 70, col: [0.6, 0.38, 1], int: 0.18, flick: 0.06, id: "runeglow" });

  // ---- hints of what lies beneath
  P("buriedgate", GATE.x, GATE.y);
  D("dirtmound", GATE.x * TS + 8, GATE.y * TS + 6, 0, 120, 30);
  for (const [x, y] of [[44, 58], [53, 59], [40, 60]]) D("dirtmound", x * TS, y * TS + 8, 1, 36, 14);
  for (const [x, y, w] of [[30, 26, 64], [60, 24, 48], [34, 44, 40], [58, 14, 56], [74, 30, 40], [20, 36, 36], [44, 50, 32]]) D("stoneline", x * TS, y * TS + 6, 0, w);
  for (const [x, y] of [[44, 34], [58, 28], [36, 16], [64, 44]]) {
    P("grate", x, y);
    lights.push({ x: x * TS + 8, y: y * TS + 10, rad: 26, col: [0.5, 0.42, 1], int: 0.3, flick: 0.05 });
  }
  for (const p of pits) lights.push({ x: (p.x + p.w / 2) * TS, y: (p.y + p.h / 2) * TS, rad: 40, col: [0.55, 0.4, 1], int: 0.32, flick: 0.04 });
  P("statue_fallen", 36, 14);
  P("statue_fallen", 60, 32, { v: 1 });
  P("statue", 66, 12, { v: 1 });
  P("cart", 72, 36);
  loose.push({ id: "basket", item: "basket", x: 75 * TS + 4, y: 37 * TS + 10 });
  for (const p of pits) for (let k = 0; k < 4; k++) D("debris", (p.x + rng() * p.w) * TS, (p.y + p.h + rng()) * TS, (rng() * 4) | 0);

  // ---- vegetation: trees in noisy clusters (sparser inside the ruin), rocks
  const nearRune = (x: number, y: number) => Math.hypot(x - RUNE_T.x, y - RUNE_T.y) < 10;
  const road = (x: number, y: number) => x >= 44 && x <= 52 && y >= RUNE_T.y && y <= 62;
  const freeAround = (x: number, y: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (G(x + i, y + j) !== T.FLOOR || occ[(y + j) * SW + x + i]) return false;
    return true;
  };
  for (let y = 3; y < SH - 3; y++) for (let x = 3; x < SW - 3; x++) {
    if (nearRune(x, y) || road(x, y) || !freeAround(x, y) || (x > 68 && x < 78 && y > 33 && y < 40)) continue;
    const inKeep = x > K.x0 && x < K.x1 && y > K.y0 && y < K.y1;
    const dens = smooth(x, y, 6, 68) * (inKeep ? 0.08 : 0.32);
    const r = rng();
    if (r < dens) P("tree", x, y, { v: (rng() * 3) | 0 });
    else if (r < dens + (inKeep ? 0.025 : 0.012)) P("rock", x, y, { v: (rng() * 2) | 0 });
  }
  for (let y = 2; y < SH - 2; y++) for (let x = 2; x < SW - 2; x++) {
    if (G(x, y) !== T.FLOOR) continue;
    const r = rng(), bx = x * TS, by = y * TS;
    if (style[y * SW + x] === FS.GRASS) {
      if (r < 0.22) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
      else if (r < 0.26) D("flowers", bx + 8, by + 8, (rng() * 4) | 0);
    } else if (r < 0.1) D("debris", bx + rng() * 14, by + rng() * 14, (rng() * 4) | 0);
    if ([G(x - 1, y), G(x + 1, y), G(x, y - 1), G(x, y + 1)].some((t) => t === T.RUBBLE || t === T.WALL) && rng() < 0.4) D("debris", bx + rng() * 16, by + rng() * 16, (rng() * 4) | 0);
    if (occ[y * SW + x] && rng() < 0.5) D("roots", bx + 4, by + 12, 0);
  }

  return {
    id: "surface", w: SW, h: SH, grid, plan, style, tvar, rooms: [], props, decals, lights, loose,
    start: { x: rc.x, y: rc.y + 4 }, exits: [], drips: [], outdoor: true, ambient: [0.34, 0.3, 0.42],
  };
}
