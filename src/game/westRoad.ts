// The Throne's road west of Westwake: the country between the West Bar and the edge of the map. A site of the
// overworld (overworld.ts), authored in its own coordinates. Pure, deterministic builder (no DOM): fixed seed, stable
// prop ids (kind@tx,ty).
//
// This is the road the empire's carriers arrive by, the one that "runs four days to anywhere larger" (the tollbar's
// words). It is built like one: three lanes of cobbles on the High Street's rows, earth verges either side, kept
// clear by the town's labour golems for as far as their rounds go. Past the last milestone it wanders a little, as a
// road does that was laid along the easy ground rather than ruled across it, bows north through the meadow and comes
// back to the line (so it still meets the bar square-on), and runs off the edge of the map. Pasture and scattered
// trees either side, and no thicket anywhere: like the town's own land beside it, the map simply ends. Nothing glows:
// the town's runes stop at the wall, and this road is not lit.
import { mulberry, hash2 } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import { propDef } from "./content/props";
import { WEST_PAD, WEST_ROAD } from "./content/geography";
import { dress, verge } from "./roadKit";
import { areaKit } from "./town";
import { vnoise } from "./surface";
import type { AreaData } from "./map";

export const WEST_H = 72;
const SEED = 9407;

export function buildWestRoad(): AreaData {
  const W = WEST_PAD, H = WEST_H, k = areaKit(W, H), rng = mulberry(SEED);
  const { grid, style, tvar } = k;
  const I = (x: number, y: number) => y * W + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const { y0, y1 } = WEST_ROAD.surface, mid = (y0 + y1) >> 1;
  const fbm = (x: number, y: number, s: number) => 0.6 * vnoise(x, y, 11, s) + 0.4 * vnoise(x, y, 5, s + 1);

  // the line of the road: straight where it meets the bar (the site's east edge), bowing two rows north at the middle
  const drift = (x: number) => -Math.round(2.2 * Math.sin(((W - 1 - x) / (W - 1)) * Math.PI));
  const isLane = (x: number, y: number) => inb(x, y) && y >= y0 + drift(x) && y <= y1 + drift(x);

  // ---- land: pasture and meadow by noise, the road through the middle
  grid.fill(T.FLOOR);
  const wood = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y), pn = vnoise(x, y, 4, SEED + 6);
    if (isLane(x, y)) { style[i] = FS.ROAD; continue; }
    const wd = fbm(x, y, SEED + 1);
    if (wd > 0.62) { wood[i] = 1; style[i] = pn < 0.14 ? FS.GRASS : pn > 0.8 ? FS.MOSS : FS.LEAF; }
    else style[i] = vnoise(x, y, 5, SEED + 2) > 0.82 ? FS.DIRT : pn > 0.86 ? FS.MOSS : FS.GRASS;
  }
  verge(style, grid, W, H, isLane, SEED + 60);
  // nothing sealed: floor the road cannot reach joins the thicket
  {
    const seen = new Uint8Array(W * H), q = [I(W - 1, mid)];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop()!, x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = I(nx, ny);
        if (inb(nx, ny) && !seen[nk] && grid[nk] === T.FLOOR) { seen[nk] = 1; q.push(nk); }
      }
    }
    for (let c = 0; c < W * H; c++) if (grid[c] === T.FLOOR && !seen[c]) grid[c] = T.THICKET;
  }

  // ---- vegetation: tiles visited in a shuffled order, so nothing grows on a lattice. Blocking things keep a free ring of
  // floor round them (no pockets) and stay two tiles off the paving.
  const occ = new Uint8Array(W * H), deco = new Uint8Array(W * H);
  const nearRoad = (x: number, y: number, m: number) => { for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) if (isLane(x + dx, y + dy)) return true; return false; };
  const footprint = (kind: string, px: number, py: number) => {
    const b = propDef(kind).box;
    if (!b) return null;
    return { x0: Math.floor((px - b[0] / 2) / TS), x1: Math.floor((px + b[0] / 2 - 0.01) / TS), y0: Math.floor((py - b[1]) / TS), y1: Math.floor((py - 0.01) / TS) };
  };
  const canPlace = (kind: string, px: number, py: number) => {
    const tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    if (!inb(tx, ty) || grid[I(tx, ty)] !== T.FLOOR || isLane(tx, ty)) return false;
    const f = footprint(kind, px, py);
    if (!f) return !deco[I(tx, ty)] && !occ[I(tx, ty)] && ty >= 1;
    for (let y = f.y0 - 1; y <= f.y1 + 1; y++) for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
      if (!inb(x, y) || grid[I(x, y)] !== T.FLOOR || occ[I(x, y)] || nearRoad(x, y, 2)) return false;
      if (x < 1 || x > W - 2 || y < 4 || y > H - 3) return false;
      if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1 && deco[I(x, y)]) return false;
    }
    return true;
  };
  const P = (kind: string, px: number, py: number, v = 0) => {
    const p = k.P(kind, px, py, { v });
    const f = footprint(kind, p.x, p.y), tx = Math.floor(p.x / TS), ty = Math.floor((p.y - 1) / TS);
    if (f) { for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (inb(x, y)) occ[I(x, y)] = 1; }
    else if (inb(tx, ty)) deco[I(tx, ty)] = 1;
  };
  const tryPlace = (kind: string, tx: number, ty: number, v: number, jitter = 4) => {
    const x = tx * TS + 8 + Math.round((hash2(tx, ty, 560) - 0.5) * 2 * jitter), y = ty * TS + 16 - Math.round(hash2(tx, ty, 561) * jitter * 0.6);
    if (canPlace(kind, x, y)) P(kind, x, y, v);
  };
  const order = Array.from({ length: W * H }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const i of order) {
    if (grid[i] !== T.FLOOR) continue;
    const x = i % W, y = (i / W) | 0;
    if (isLane(x, y)) continue;
    const r = rng(), clump = vnoise(x, y, 4, SEED + 30);
    let c = 0;
    const pick = (p: number) => { c += p; return r < c; };
    if (wood[i]) {
      if (pick(0.08 + 0.34 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
      else if (pick(0.06)) tryPlace("bush", x, y, (rng() * 4) | 0);
      else if (pick(0.03)) tryPlace("sapling", x, y, (rng() * 2) | 0);
      else if (pick(0.012)) tryPlace("stump", x, y, (rng() * 2) | 0);
      else if (pick(0.2)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
    } else {
      if (pick(0.025 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
      else if (pick(0.03 * (0.4 + clump))) tryPlace("bush", x, y, (rng() * 4) | 0);
      else if (pick(0.01)) tryPlace("sapling", x, y, (rng() * 2) | 0);
      else if (pick(0.008)) tryPlace("rock", x, y, (rng() * 4) | 0);
      else if (pick(0.06 * (0.5 + clump))) tryPlace("tallgrass", x, y, (rng() * 3) | 0, 5);
    }
  }
  // the carriers' road is marked: a milestone on the north verge by the bar (the road's own, not the old track's)
  P("kingsmilestone_w", (W - 6) * TS + 8, (y0 + drift(W - 6) - 2) * TS + 14);

  // ---- decals: shade and roots under the trees, cover on the ground; then the road's own dressing
  const D = k.D, jit = (s: number) => (rng() - 0.5) * s;
  for (const p of k.props) if (p.kind === "tree") {
    if (hash2(p.x, p.y, 542) < 0.65) D("shade", p.x + 6 + jit(6), p.y - 12 + jit(4), 0, 44 + rng() * 14);
    if (rng() < 0.6) D("roots", p.x - 4 + jit(4), p.y - 4, 0);
  }
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR || isLane(x, y)) continue;
    const bx = x * TS, by = y * TS, r = rng(), s = style[i];
    if (s === FS.LEAF) { if (r < 0.38) D("leaves", bx + 8 + jit(6), by + 8 + jit(6), 0); else if (r < 0.43) D("mosspatch", bx + 8, by + 8, 0, 10 + rng() * 10); }
    else if (s === FS.MOSS) { if (r < 0.12) D("mosspatch", bx + 8 + jit(8), by + 8 + jit(8), (rng() * 2) | 0, 10 + rng() * 14); }
    else if (s === FS.GRASS) {
      if (vnoise(x, y, 5, SEED + 70) > 0.62 && r < 0.16) D("wildflowers", bx + 8 + jit(8), by + 8 + jit(8), (vnoise(x, y, 9, SEED + 71) * 4) | 0);
      else if (r < 0.3) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
      else if (r < 0.34) D("flowers", bx + 8, by + 8, (rng() * 4) | 0);
    }
  }
  dress(k, W, H, isLane, SEED + 80);

  return {
    id: "westroad", w: W, h: H, grid, plan: grid.slice(), style, tvar, rooms: [], props: k.props, decals: k.decals, lights: [], loose: [],
    start: { x: (W >> 1) * TS + 8, y: mid * TS + 12 }, exits: [], drips: [], outdoor: true, ambient: [0.32, 0.31, 0.42], portals: [], spots: [],
  };
}
