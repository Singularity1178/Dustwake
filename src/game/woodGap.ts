// The ground between the old road and the ruins. Each of those two sites closes
// its own side with thicket (the wood reaching out of the old road's east end,
// and the closed west edge of the ruins). Set side by side on the overworld the
// two made one solid band from north to south, with the road the only way past.
//
// This runs on the composed area, after the sites are down, and opens that band
// into ordinary open country. The thicket closing the north and south of the
// land stays. Only tiles that were part of the band change: the sites' builders
// draw the same rng stream as before, so every prop, decal and id they make is
// where it was, and saves (diffs against the builder) load onto the new ground.
// Pure and deterministic (no DOM).
import { TS, T, FS } from "./content/tiles";
import { propDef } from "./content/props";
import { SITE_AT, ZONE, zoneRef } from "./content/places";
import { WEST_ROAD } from "./content/geography";
import { hash2, mulberry } from "./core/rng";
import { roadFbm, roadRim } from "./oldRoad";
import { fbm, vnoise, wildRim } from "./surface";
import type { AreaData } from "./map";

/** The columns (overworld tiles, x1 exclusive) the band lay in: the last of the old road and the first of the ruins. */
export const WOOD_GAP = { x0: SITE_AT.ruins.x - 8, x1: SITE_AT.ruins.x + 8 } as const;
const SEED = 9407;

type Land = "meadow" | "woods" | "rocky" | "hollow";

/** What grows at an overworld tile: the old road's rules west of the join, the wild's east of it, the line between them ragged. */
function landAt(x: number, y: number): { land: Land; style: number } {
  const wild = x + (vnoise(x, y, 4, SEED) - 0.5) * 6 >= SITE_AT.ruins.x;
  const lx = x - (wild ? SITE_AT.ruins.x : SITE_AT.oldroad.x);
  if (!wild) {
    const pn = vnoise(lx, y, 4, 506);
    if (roadFbm(lx, y, 501) > 0.58) return { land: "woods", style: pn < 0.14 ? FS.GRASS : pn > 0.8 ? FS.MOSS : FS.LEAF };
    return { land: "meadow", style: vnoise(lx, y, 5, 507) > 0.8 ? FS.DIRT : pn > 0.86 ? FS.MOSS : FS.GRASS };
  }
  const wood = fbm(lx, y, 201), wet = fbm(lx, y, 202), rock = fbm(lx, y, 203), pn = vnoise(lx, y, 4, 206);
  if (wet > 0.6) return { land: "hollow", style: wet > 0.67 ? FS.MUD : pn > 0.3 ? FS.MOSS : FS.GRASS };
  if (wood > 0.55) return { land: "woods", style: wet > 0.5 && pn > 0.58 ? FS.MOSS : pn < 0.12 ? FS.GRASS : FS.LEAF };
  if (rock > 0.58) return { land: "rocky", style: pn > 0.58 ? FS.EARTH : pn > 0.36 ? FS.DIRT : FS.GRASS };
  return { land: "meadow", style: vnoise(lx, y, 5, 62) > 0.78 ? FS.DIRT : pn > 0.84 ? FS.MOSS : FS.GRASS };
}

/** Opens the band in a freshly composed overworld (in place) and returns it. */
export function openWoodGap(d: AreaData): AreaData {
  const W = d.w, H = d.h, n = W * H, rng = mulberry(SEED);
  const I = (x: number, y: number) => y * W + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const { y0, y1 } = WEST_ROAD.surface;

  // ---- which tiles: thicket in the band's columns, inside the rim that closes the north and south
  const open = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = WOOD_GAP.x0; x < WOOD_GAP.x1; x++) {
    const i = I(x, y), edge = Math.min(y, H - 1 - y);
    const rim = x < SITE_AT.ruins.x ? roadRim(x - SITE_AT.oldroad.x, y) : wildRim(x - SITE_AT.ruins.x, y);
    if (d.grid[i] === T.THICKET && edge >= rim) { open[i] = 1; d.grid[i] = T.FLOOR; }
  }
  // seal nothing: opened ground that cannot be walked to stays thicket
  {
    const seen = new Uint8Array(n), q = [I(Math.floor(d.start.x / TS), Math.floor(d.start.y / TS))];
    seen[q[0]] = 1;
    while (q.length) {
      const k = q.pop()!, x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = I(nx, ny);
        if (inb(nx, ny) && !seen[nk] && d.grid[nk] === T.FLOOR) { seen[nk] = 1; q.push(nk); }
      }
    }
    for (let k = 0; k < n; k++) if (open[k] && !seen[k]) { open[k] = 0; d.grid[k] = T.THICKET; }
  }
  const tiles: number[] = [], land: Land[] = [];
  for (let i = 0; i < n; i++) {
    if (!open[i]) continue;
    const g = landAt(i % W, (i / W) | 0);
    d.plan[i] = T.FLOOR; d.style[i] = g.style; land[i] = g.land;
    tiles.push(i);
  }

  // ---- vegetation, on the opened tiles only, visited in a shuffled order so nothing grows on a lattice
  const occ = new Uint8Array(n), deco = new Uint8Array(n);
  const footprint = (kind: string, px: number, py: number) => {
    const b = propDef(kind).box;
    if (!b) return null;
    return { x0: Math.floor((px - b[0] / 2) / TS), x1: Math.floor((px + b[0] / 2 - 0.01) / TS), y0: Math.floor((py - b[1]) / TS), y1: Math.floor((py - 0.01) / TS) };
  };
  for (const p of d.props) {
    const f = footprint(p.kind, p.x, p.y);
    if (f) for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (inb(x, y)) occ[I(x, y)] = 1;
  }
  const spots = d.spots ?? [];
  const tryPlace = (kind: string, tx: number, ty: number, v: number, jitter = 4) => {
    const px = tx * TS + 8 + Math.round((hash2(tx, ty, SEED + 1) - 0.5) * 2 * jitter), py = ty * TS + 16 - Math.round(hash2(tx, ty, SEED + 2) * jitter * 0.6);
    const cx = Math.floor(px / TS), cy = Math.floor((py - 1) / TS);
    if (!open[I(cx, cy)]) return;
    const f = footprint(kind, px, py);
    if (!f) { if (deco[I(cx, cy)] || occ[I(cx, cy)]) return; }
    else {
      // a blocking thing stands wholly on opened ground, keeps a free ring (so no pocket can form), stays off the
      // track and a tile either side of it, and away from anywhere people stand
      for (let y = f.y0 - 1; y <= f.y1 + 1; y++) for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
        if (!inb(x, y) || d.grid[I(x, y)] !== T.FLOOR || occ[I(x, y)]) return;
        if (y >= y0 - 1 && y <= y1 + 1) return;
        if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1 && (!open[I(x, y)] || deco[I(x, y)])) return;
      }
      if (spots.some((s) => Math.hypot(s.x - px, s.y - py) < 3 * TS)) return;
    }
    const zone = tx < SITE_AT.ruins.x ? zoneRef(ZONE.oldroad, "") : "";
    d.props.push({ id: `${zone}gap.${kind}@${tx},${ty}`, kind, x: px, y: py, v });
    if (f) { for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) occ[I(x, y)] = 1; }
    else deco[I(cx, cy)] = 1;
  };
  const first = d.props.length;
  const order = tiles.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const i of order) {
    const x = i % W, y = (i / W) | 0;
    const r = rng(), clump = vnoise(x, y, 4, SEED + 3);
    let c = 0;
    const pick = (p: number) => { c += p; return r < c; };
    switch (land[i]) {
      case "woods":
        if (pick(0.12 + 0.45 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
        else if (pick(0.07)) tryPlace("bush", x, y, (rng() * 4) | 0);
        else if (pick(0.035)) tryPlace("sapling", x, y, (rng() * 2) | 0);
        else if (pick(0.02)) tryPlace("log", x, y, (rng() * 3) | 0, 3);
        else if (pick(0.012)) tryPlace("stump", x, y, (rng() * 2) | 0);
        else if (pick(0.24)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
        break;
      case "hollow":
        if (pick(0.22)) tryPlace("fern", x, y, (rng() * 3) | 0, 5);
        else if (pick(0.1)) tryPlace("tallgrass", x, y, (rng() * 2) | 0, 5);
        else if (pick(0.05 * (0.5 + clump))) tryPlace("tree", x, y, 2);
        else if (pick(0.05)) tryPlace("bush", x, y, 2 + ((rng() * 2) | 0));
        break;
      case "rocky":
        if (pick(0.03)) tryPlace("rock", x, y, (rng() * 2) | 0);
        else if (pick(0.012)) tryPlace("boulder", x, y, (rng() * 3) | 0);
        else if (pick(0.03)) tryPlace("tree", x, y, (rng() * 3) | 0);
        else if (pick(0.035)) tryPlace("bush", x, y, (rng() * 4) | 0);
        else if (pick(0.04)) tryPlace("tallgrass", x, y, (rng() * 3) | 0, 5);
        break;
      default: // meadow
        if (pick(0.035 * clump)) tryPlace("tree", x, y, (rng() * 3) | 0);
        else if (pick(0.035 * (0.4 + clump))) tryPlace("bush", x, y, (rng() * 4) | 0);
        else if (pick(0.012)) tryPlace("sapling", x, y, (rng() * 2) | 0);
        else if (pick(0.01)) tryPlace("rock", x, y, (rng() * 4) | 0);
        else if (pick(0.05 * (0.5 + clump))) tryPlace("tallgrass", x, y, (rng() * 3) | 0, 5);
    }
  }

  // ---- decals: shade and roots under the new trees, then cover and small plants on the opened ground
  const D = (kind: string, x: number, y: number, v = 0, w?: number, h?: number) => { d.decals.push({ kind, x: Math.round(x), y: Math.round(y), v, w, h }); };
  const jit = (s: number) => (rng() - 0.5) * s;
  for (const p of d.props.slice(first)) if (p.kind === "tree") {
    if (hash2(p.x, p.y, SEED + 4) < 0.65) D("shade", p.x + 6 + jit(6), p.y - 12 + jit(4), 0, 44 + rng() * 14);
    if (rng() < 0.6) D("roots", p.x - 4 + jit(4), p.y - 4, 0);
  }
  for (const i of tiles) {
    const x = i % W, y = (i / W) | 0, bx = x * TS, by = y * TS, r = rng(), s = d.style[i];
    if (s === FS.LEAF) { if (r < 0.39) D("leaves", bx + 8 + jit(6), by + 8 + jit(6), 0); else if (r < 0.44) D("mosspatch", bx + 8, by + 8, 0, 10 + rng() * 10); }
    else if (s === FS.MOSS) { if (r < 0.12) D("mosspatch", bx + 8 + jit(8), by + 8 + jit(8), (rng() * 2) | 0, 10 + rng() * 14); else if (r < 0.22) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0); }
    else if (s === FS.MUD) { if (r < 0.06) D("puddle", bx + jit(6), by + 4 + jit(4), (rng() * 2) | 0, 14 + rng() * 14, 6 + rng() * 4); else if (r < 0.14) D("weeds", bx + 8 + jit(8), by + 12, 0); }
    else if (s === FS.EARTH || s === FS.DIRT) { if (r < 0.07) D("pebbles", bx + 8 + jit(6), by + 8 + jit(6), 0); else if (r < 0.14) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0); }
    else if (vnoise(x, y, 5, SEED + 5) > 0.62 && r < 0.16) D("wildflowers", bx + 8 + jit(8), by + 8 + jit(8), (vnoise(x, y, 9, SEED + 6) * 4) | 0);
    else if (r < 0.3) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
    else if (r < 0.34) D("flowers", bx + 8, by + 8, (rng() * 4) | 0);
  }
  return d;
}
