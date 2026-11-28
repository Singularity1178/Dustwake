// The old road: the stretch of country between Westwake's east gate and the
// wood that closed over the sunken keep. A site of the overworld (overworld.ts),
// authored like the others in its own coordinates. Pure, deterministic builder
// (no DOM): fixed seed, stable prop ids (kind@tx,ty).
//
// It is deliberately plain: open meadow, a few stands of trees, rock here and
// there, and the rutted track through the middle of it that the town's carts
// stopped using when there was no longer anywhere east to go. Thicket closes
// the north and south, as it does round the ruins. Nothing glows.
//
// The road keeps to the rows the two sites either side of it agree on
// (content/geography.ts: WEST_ROAD), so the three stretches meet end to end.
import { mulberry, hash2 } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import { propDef } from "./content/props";
import { WEST_ROAD } from "./content/geography";
import { vnoise } from "./surface";
import type { AreaData, DecalDef, PropDef } from "./map";

export const ROAD_W = 48, ROAD_H = 72;
const ROAD_SEED = 9203;

export function buildOldRoad(): AreaData {
  const W = ROAD_W, H = ROAD_H, n = W * H, rng = mulberry(ROAD_SEED);
  const grid = new Uint8Array(n).fill(T.FLOOR), style = new Uint8Array(n).fill(FS.GRASS), tvar = new Uint8Array(n);
  const I = (x: number, y: number) => y * W + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const { y0, y1 } = WEST_ROAD.surface, mid = (y0 + y1) >> 1;
  const onRoad = (y: number) => y >= y0 && y <= y1;
  const fbm = (x: number, y: number, s: number) => 0.6 * vnoise(x, y, 11, s) + 0.4 * vnoise(x, y, 5, s + 1);

  // ---- land: thicket closing the north and south, woods and meadow by noise, the track through the middle
  const wood = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y), edge = Math.min(y, H - 1 - y);
    // the thicket closing the north and south thins out toward the town (whose own land simply runs to the edge of the map)...
    if (edge < Math.floor((2 + fbm(x, y, 520) * 5 - 0.4) * Math.min(1, x / 12))) { grid[i] = T.THICKET; continue; }
    // ...and the wood round the ruins reaches out raggedly into the east of this land, so its edge is not a ruled line
    if (!onRoad(y) && W - 1 - x < Math.floor(fbm(x, y, 524) * 6 - 1 + vnoise(y, 7, 3, 525) * 2)) { grid[i] = T.THICKET; continue; }
    if (onRoad(y)) { style[i] = y === mid || hash2(x, y, 521) < 0.55 ? FS.EARTH : FS.DIRT; continue; }
    const wd = fbm(x, y, 501), pn = vnoise(x, y, 4, 506);
    if (wd > 0.58) { wood[i] = 1; style[i] = pn < 0.14 ? FS.GRASS : pn > 0.8 ? FS.MOSS : FS.LEAF; }
    else style[i] = vnoise(x, y, 5, 507) > 0.8 ? FS.DIRT : pn > 0.86 ? FS.MOSS : FS.GRASS;
  }
  // nothing sealed: floor the road cannot reach joins the thicket
  {
    const seen = new Uint8Array(n), q = [I(W >> 1, mid)];
    seen[q[0]] = 1;
    while (q.length) {
      const k = q.pop()!, x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = I(nx, ny);
        if (inb(nx, ny) && !seen[nk] && grid[nk] === T.FLOOR) { seen[nk] = 1; q.push(nk); }
      }
    }
    for (let k = 0; k < n; k++) if (grid[k] === T.FLOOR && !seen[k]) grid[k] = T.THICKET;
  }

  const props: PropDef[] = [], decals: DecalDef[] = [], ids = new Set<string>();
  /** Tiles a blocking footprint touches. Every blocking prop keeps a free ring of floor round it, so no pocket can form. */
  const occ = new Uint8Array(n), deco = new Uint8Array(n);
  const footprint = (kind: string, px: number, py: number) => {
    const b = propDef(kind).box;
    if (!b) return null;
    return { x0: Math.floor((px - b[0] / 2) / TS), x1: Math.floor((px + b[0] / 2 - 0.01) / TS), y0: Math.floor((py - b[1]) / TS), y1: Math.floor((py - 0.01) / TS) };
  };
  const canPlace = (kind: string, px: number, py: number) => {
    const tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    if (!inb(tx, ty) || grid[I(tx, ty)] !== T.FLOOR) return false;
    const f = footprint(kind, px, py);
    if (!f) return !deco[I(tx, ty)] && !occ[I(tx, ty)];
    // blocking things keep off the track and a tile either side of it, and off the site's outer columns (the seams)
    for (let y = f.y0 - 1; y <= f.y1 + 1; y++) for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
      if (!inb(x, y) || grid[I(x, y)] !== T.FLOOR || occ[I(x, y)]) return false;
      if (y >= y0 - 1 && y <= y1 + 1) return false;
      if (x < 1 || x > W - 2) return false;
      if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1 && deco[I(x, y)]) return false;
    }
    return true;
  };
  const P = (kind: string, px: number, py: number, v = 0, id?: string) => {
    const tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    let pid = id ?? `${kind}@${tx},${ty}`;
    for (let k = 2; ids.has(pid); k++) pid = `${kind}@${tx},${ty}#${k}`;
    ids.add(pid);
    const p: PropDef = { id: pid, kind, x: Math.round(px), y: Math.round(py), v };
    props.push(p);
    const f = footprint(kind, p.x, p.y);
    if (f) { for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (inb(x, y)) occ[I(x, y)] = 1; }
    else if (inb(tx, ty)) deco[I(tx, ty)] = 1;
    return p;
  };
  const tryPlace = (kind: string, tx: number, ty: number, v: number, jitter = 4) => {
    const x = tx * TS + 8 + Math.round((hash2(tx, ty, 560) - 0.5) * 2 * jitter), y = ty * TS + 16 - Math.round(hash2(tx, ty, 561) * jitter * 0.6);
    if (!canPlace(kind, x, y)) return false;
    P(kind, x, y, v);
    return true;
  };

  // ---- vegetation: tiles visited in a shuffled order, so nothing grows on a lattice
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const i of order) {
    if (grid[i] !== T.FLOOR) continue;
    const x = i % W, y = (i / W) | 0;
    if (onRoad(y)) continue;
    const r = rng(), clump = vnoise(x, y, 4, 530);
    let c = 0;
    const pick = (p: number) => { c += p; return r < c; };
    if (wood[i]) {
      if (pick(0.1 + 0.42 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
      else if (pick(0.06)) tryPlace("bush", x, y, (rng() * 4) | 0);
      else if (pick(0.03)) tryPlace("sapling", x, y, (rng() * 2) | 0);
      else if (pick(0.018)) tryPlace("log", x, y, (rng() * 3) | 0, 3);
      else if (pick(0.012)) tryPlace("stump", x, y, (rng() * 2) | 0);
      else if (pick(0.22)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
    } else {
      if (pick(0.03 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
      else if (pick(0.03 * (0.4 + clump))) tryPlace("bush", x, y, (rng() * 4) | 0);
      else if (pick(0.01)) tryPlace("sapling", x, y, (rng() * 2) | 0);
      else if (pick(0.012)) tryPlace("rock", x, y, (rng() * 4) | 0);
      else if (pick(0.004)) tryPlace("boulder", x, y, (rng() * 3) | 0);
      else if (pick(0.05 * (0.5 + clump))) tryPlace("tallgrass", x, y, (rng() * 3) | 0, 5);
    }
  }

  // ---- decals: shade and roots under the trees, cover on the ground, the track's ruts and its verges
  const D = (kind: string, x: number, y: number, v = 0, w?: number, h?: number) => { decals.push({ kind, x: Math.round(x), y: Math.round(y), v, w, h }); };
  const jit = (s: number) => (rng() - 0.5) * s;
  for (const p of props) if (p.kind === "tree") {
    if (hash2(p.x, p.y, 542) < 0.65) D("shade", p.x + 6 + jit(6), p.y - 12 + jit(4), 0, 44 + rng() * 14);
    if (rng() < 0.6) D("roots", p.x - 4 + jit(4), p.y - 4, 0);
  }
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR) continue;
    const bx = x * TS, by = y * TS, r = rng(), s = style[i];
    if (onRoad(y)) {
      if (r < 0.22) D("pebbles", bx + 8, by + 4 + rng() * 10, 0);
      if ((y === y0 || y === y1) && hash2(x, y, 585) < 0.6) D("weeds", bx + 3 + hash2(x, y, 586) * 10, by + (y === y0 ? 7 : 15), 0);
      continue;
    }
    if (s === FS.LEAF) { if (r < 0.38) D("leaves", bx + 8 + jit(6), by + 8 + jit(6), 0); else if (r < 0.43) D("mosspatch", bx + 8, by + 8, 0, 10 + rng() * 10); }
    else if (s === FS.MOSS) { if (r < 0.12) D("mosspatch", bx + 8 + jit(8), by + 8 + jit(8), (rng() * 2) | 0, 10 + rng() * 14); }
    else if (s === FS.DIRT) { if (r < 0.07) D("pebbles", bx + 8, by + 8, 0); }
    else if (vnoise(x, y, 5, 570) > 0.62 && r < 0.16) D("wildflowers", bx + 8 + jit(8), by + 8 + jit(8), (vnoise(x, y, 9, 571) * 4) | 0);
    else if (r < 0.3) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
    else if (r < 0.34) D("flowers", bx + 8, by + 8, (rng() * 4) | 0);
  }
  D("ruts", 0, mid * TS + 8, 0, W * TS);

  return {
    id: "oldroad", w: W, h: H, grid, plan: grid.slice(), style, tvar, rooms: [], props, decals, lights: [], loose: [],
    start: { x: (W >> 1) * TS + 8, y: mid * TS + 12 }, exits: [], drips: [], outdoor: true, ambient: [0.32, 0.31, 0.42], portals: [], spots: [],
  };
}
