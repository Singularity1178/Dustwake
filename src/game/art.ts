import type { MapData, ItemId, DecalDef } from "./map";
import { TS, T, FS, isWallMassT, isGroundFS } from "./content/tiles";
import { GLYPHS } from "./content/glyphs";
export { GLYPHS } from "./content/glyphs";
export { ITEM_NAMES } from "./content/items";
import { hash2, makeSprite, Sprite, Pen, Rng, mulberry, clamp } from "./util";

// ---------------- Palettes ----------------
export const S = { o: "#141016", d: "#2e2a33", m: "#4b4552", l: "#6a6372", h: "#8a8392" };
export const WD = { o: "#1a110b", d: "#3d2817", m: "#5b3d24", l: "#7a5634", h: "#93704a" };
export const IR = { d: "#2c3036", m: "#4c535c", l: "#717a85", h: "#9aa4ae" };
export const CL = { d: "#4a1418", m: "#6e1f24", l: "#8e3036" };
export const GD = { d: "#7a5a1c", m: "#b08a34", l: "#e0c060" };
export const BN = { d: "#8a8270", m: "#b8b09a", l: "#ddd5bd" };

// ---------------- Background baking ----------------
/** What background baking reads from an area. */
export type BakeSource = Pick<MapData, "w" | "h" | "grid" | "style" | "decals">;
type C3 = [number, number, number];
const isWall = (m: BakeSource, x: number, y: number) =>
  x < 0 || y < 0 || x >= m.w || y >= m.h ? true : isWallMassT(m.grid[y * m.w + x]);

function floorPix(style: number, tx: number, ty: number, lx: number, ly: number): C3 {
  const wx = tx * TS + lx, wy = ty * TS + ly;
  const n = (hash2(wx, wy, 7) - 0.5) * 12;
  if (isGroundFS(style)) return groundPix(style, tx, ty, wx, wy, n);
  if (style === FS.MARBLE) {
    if (lx === 15 || ly === 15) return [34 + n * 0.3, 32, 40];
    const light = (tx + ty) & 1;
    const base: C3 = light ? [86, 82, 94] : [50, 47, 58];
    const v = Math.sin(wx * 0.31 + wy * 0.17 + Math.sin(wy * 0.21 + tx * 3) * 2.4);
    let k = Math.abs(v) < 0.07 ? (light ? -16 : 14) : 0;
    if (hash2(wx >> 1, wy >> 1, 9) < 0.015) k -= 18;
    const age = 0.82 + hash2(tx, ty, 3) * 0.18;
    if (lx === 0 || ly === 0) k += 8;
    return [(base[0] + k + n) * age, (base[1] + k + n) * age, (base[2] + k + n) * age];
  }
  if (style === FS.BRICK) {
    const row = Math.floor(wy / 8);
    const off = row & 1 ? 4 : 0;
    if ((wx + off) % 8 === 7 || wy % 8 === 7) return [28, 24, 23];
    const b = Math.floor((wx + off) / 8);
    const t = (hash2(b, row, 4) - 0.5) * 16;
    const bev = (wx + off) % 8 === 0 || wy % 8 === 0 ? 7 : 0;
    return [54 + t + n + bev, 48 + t + n + bev, 44 + t + n + bev];
  }
  if (style === FS.WOOD) {
    const row = Math.floor(wy / 4);
    if (wy % 4 === 3) return [28, 19, 13];
    const off = Math.floor(hash2(row, 0, 11) * 24);
    const seg = Math.floor((wx + off) / 24);
    if ((wx + off) % 24 === 0) return [30, 21, 15];
    if (hash2(seg, row, 12) < 0.07) return [18, 13, 10];
    const g = Math.sin(wx * 0.7 + hash2(seg, row, 13) * 20) * 5;
    const t = (hash2(seg, row, 14) - 0.5) * 18;
    return [72 + g + t + n * 0.6, 50 + g * 0.7 + t * 0.7 + n * 0.5, 33 + g * 0.5 + t * 0.5 + n * 0.4];
  }
  if (style === FS.COBBLE) {
    const cs = 6;
    const cx = Math.floor(wx / cs), cy = Math.floor(wy / cs);
    let d1 = 99, d2 = 99, id = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const px = (cx + i) * cs + hash2(cx + i, cy + j, 21) * cs;
        const py = (cy + j) * cs + hash2(cx + i, cy + j, 22) * cs;
        const d = Math.hypot(wx - px, wy - py);
        if (d < d1) { d2 = d1; d1 = d; id = (cx + i) * 131 + (cy + j); }
        else if (d < d2) d2 = d;
      }
    if (d2 - d1 < 1.2) return [26, 24, 23];
    const t = (hash2(id, 1, 23) - 0.5) * 20;
    return [64 + t - d1 * 2 + n, 59 + t - d1 * 2 + n, 55 + t - d1 * 2 + n];
  }
  // FLAG
  const layout = Math.floor(hash2(tx, ty, 1) * 4);
  let sx0 = 0, sy0 = 0, sw = 16, sh = 16;
  const sp = 6 + Math.floor(hash2(tx, ty, 2) * 5);
  if (layout === 1) { if (ly < sp) sh = sp; else { sy0 = sp; sh = 16 - sp; } }
  else if (layout === 2) { if (lx < sp) sw = sp; else { sx0 = sp; sw = 16 - sp; } }
  else if (layout === 3) {
    if (lx < 8) sw = 8; else { sx0 = 8; sw = 8; }
    if (ly < 8) sh = 8; else { sy0 = 8; sh = 8; }
  }
  if (lx === sx0 + sw - 1 || ly === sy0 + sh - 1) return [32, 28, 26];
  const sid = tx * 977 + ty * 131 + sx0 * 7 + sy0;
  const t = (hash2(sid, 3, 5) - 0.5) * 16;
  let bev = 0;
  if (lx === sx0 || ly === sy0) bev = 9;
  else if (lx === sx0 + sw - 2 || ly === sy0 + sh - 2) bev = -7;
  return [60 + t + n + bev, 55 + t + n + bev, 50 + t * 0.9 + n + bev];
}

// ---- surface ground
const LEAF_PAL: C3[] = [[78, 56, 32], [96, 70, 36], [66, 46, 28], [88, 52, 30], [104, 82, 44], [52, 64, 32]];
let patchTx = -1, patchTy = -1, patchV = 0;
function groundPix(style: number, tx: number, ty: number, wx: number, wy: number, n: number): C3 {
  // per-tile brightness patch (memoised: the bake visits a tile's pixels together)
  if (tx !== patchTx || ty !== patchTy) { patchTx = tx; patchTy = ty; patchV = hash2(tx >> 1, ty >> 1, 41) * 0.5 + hash2(tx, ty, 42) * 0.5; }
  const patch = patchV;
  switch (style) {
    case FS.DIRT: {
      const peb = hash2(wx, wy, 43) < 0.04 ? 14 : 0;
      return [74 + n + patch * 10 + peb, 60 + n + patch * 6 + peb, 44 + n * 0.8 + peb];
    }
    case FS.EARTH: {
      // bare packed earth: lighter, pebbly, with hairline drying cracks
      const h = hash2(wx, wy, 101);
      const peb = h < 0.035 ? 16 : h > 0.985 ? -14 : 0;
      const crack = hash2(wx >> 3, wy, 102) < 0.05 && hash2(wx, wy >> 2, 103) < 0.5 ? -12 : 0;
      const k = peb + crack + patch * 8;
      return [80 + n + k, 64 + n * 0.9 + k * 0.85, 47 + n * 0.7 + k * 0.6];
    }
    case FS.MOSS: {
      // cushion moss: soft clumps with bright tips and dark seams between them
      const clump = hash2(wx >> 2, wy >> 2, 104), tip = hash2(wx, wy, 105);
      const seam = (wx & 3) === 0 && (wy & 3) === 0 && clump < 0.4 ? -14 : 0;
      const hi = tip > 0.93 ? 16 : tip < 0.05 ? -10 : 0;
      const k = (clump - 0.5) * 10 + seam + hi;
      return [44 + n * 0.5 + k * 0.6 + patch * 6, 72 + n + k + patch * 10, 30 + n * 0.4 + k * 0.3];
    }
    case FS.LEAF: {
      // leaf litter: overlapping 2-3px leaves in autumn browns, a few still green
      const lx = (wx + ((wy >> 1) & 1)) >> 1, ly = wy >> 1;
      const lf = hash2(lx, ly, 106);
      if (lf < 0.12) return [30 + n * 0.5, 24 + n * 0.4, 18 + n * 0.3];
      const c = LEAF_PAL[Math.floor(hash2(lx, ly, 107) * LEAF_PAL.length)];
      const vein = hash2(wx, wy, 108) < 0.1 ? -10 : 0;
      return [c[0] + n * 0.6 + vein, c[1] + n * 0.6 + vein, c[2] + n * 0.4 + vein];
    }
    case FS.MUD: {
      // dark wet mud with a faint sheen and the odd water film
      const sheen = hash2(wx >> 1, wy, 109) < 0.025 ? 26 : 0;
      const wet = hash2(wx >> 3, wy >> 2, 110) < 0.25 ? -8 : 0;
      const k = sheen + wet + patch * 6;
      return [46 + n * 0.6 + k * 0.8, 38 + n * 0.5 + k * 0.85, 30 + n * 0.5 + k];
    }
  }
  const blade = hash2(wx, wy >> 1, 44);
  const b = blade < 0.12 ? 12 : blade > 0.9 ? -10 : 0;
  return [40 + n * 0.6 + patch * 8 + b * 0.4, 64 + n + patch * 14 + b, 34 + n * 0.5 + patch * 4];
}

/**
 * Natural ground styles meet along ragged, noise-warped borders instead of tile
 * edges: each pixel samples the style of a jittered neighbour (4px blocks plus
 * a 1px dither), so meadows, moss, leaf litter and mud bleed into each other.
 */
function warpedGroundStyle(m: BakeSource, st: number, tx: number, ty: number, wx: number, wy: number): number {
  const d1 = (Math.imul(wx, 73856093) ^ Math.imul(wy, 19349663)) >>> 0;
  const jx = Math.floor((hash2(wx >> 2, wy >> 2, 111) - 0.5) * 11 + ((d1 & 3) - 1.5));
  const jy = Math.floor((hash2(wx >> 2, wy >> 2, 113) - 0.5) * 11 + (((d1 >> 2) & 3) - 1.5));
  const nx = (wx + jx) >> 4, ny = (wy + jy) >> 4;
  if ((nx === tx && ny === ty) || nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) return st;
  const k = ny * m.w + nx;
  if (m.grid[k] !== T.FLOOR) return st;
  const s2 = m.style[k];
  return isGroundFS(s2) ? s2 : st;
}

/** Does any neighbouring floor tile have a different natural ground style? (Only those tiles need the warped border.) */
function groundBorder(m: BakeSource, st: number, tx: number, ty: number): boolean {
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const x = tx + i, y = ty + j;
    if ((i === 0 && j === 0) || x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    const k = y * m.w + x;
    if (m.grid[k] === T.FLOOR && m.style[k] !== st && isGroundFS(m.style[k])) return true;
  }
  return false;
}

function thicketPix(tx: number, ty: number, lx: number, ly: number): C3 {
  const wx = tx * TS + lx, wy = ty * TS + ly;
  const leaf = hash2(wx >> 1, wy >> 1, 45), n = (hash2(wx, wy, 46) - 0.5) * 8;
  const hi = leaf > 0.82 ? 18 : leaf < 0.2 ? -8 : 0;
  return [16 + n + hi * 0.5, 32 + n + hi, 20 + n + hi * 0.4];
}

function wallFacePix(tx: number, ty: number, lx: number, ly: number): C3 {
  const wx = tx * TS + lx;
  const n = (hash2(wx, ty * 16 + ly, 8) - 0.5) * 10;
  if (ly === 0) return [104, 97, 110];
  if (ly === 1) return [84, 78, 90];
  if (ly === 2) return [30, 27, 34];
  const r = Math.floor((ly - 3) / 4);
  const off = r & 1 ? 4 : 0;
  if ((wx + off) % 8 === 7 || (ly - 3) % 4 === 3) return [28, 24, 30];
  const b = Math.floor((wx + off) / 8);
  const bid = b * 31 + ty * 7 + r;
  if (hash2(bid, 1, 33) < 0.05) return [14, 12, 16];
  let t = (hash2(bid, 2, 34) - 0.5) * 18;
  if ((ly - 3) % 4 === 0) t += 8;
  if (ly >= 14) t -= 14;
  if (ly > 9 && hash2(bid, 5, 35) < 0.22 && hash2(wx, ly, 36) < 0.6) return [48 + n, 62 + n, 38 + n];
  return [66 + t + n, 60 + t + n, 70 + t + n];
}

function wallTopPix(m: BakeSource, tx: number, ty: number, lx: number, ly: number): C3 {
  const n = hash2(tx * 16 + lx, ty * 16 + ly, 9) * 4;
  const L = !isWall(m, tx - 1, ty), R = !isWall(m, tx + 1, ty), U = !isWall(m, tx, ty - 1);
  const rim = (L && lx === 0) || (R && lx === 15) || (U && ly === 0);
  const rim2 = (L && lx === 1) || (R && lx === 14) || (U && ly === 1);
  if (rim) return [50, 45, 56];
  if (rim2) return [30, 26, 34];
  return [16 + n, 13 + n, 19 + n];
}

export function bakeRegion(ctx: CanvasRenderingContext2D, m: BakeSource, x0: number, y0: number, x1: number, y1: number) {
  const MW = m.w; x0 = clamp(x0, 0, m.w - 1); y0 = clamp(y0, 0, m.h - 1); x1 = clamp(x1, 0, m.w - 1); y1 = clamp(y1, 0, m.h - 1);
  const w = (x1 - x0 + 1) * TS, h = (y1 - y0 + 1) * TS;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const t = m.grid[ty * MW + tx];
      const wall = t === T.WALL;
      const face = wall && !isWall(m, tx, ty + 1);
      const st = m.style[ty * MW + tx];
      const aoU = !wall && isWall(m, tx, ty - 1);
      const aoL = !wall && isWall(m, tx - 1, ty);
      const aoR = !wall && isWall(m, tx + 1, ty);
      const dirty = t === T.RUBBLE || t === T.CRACKED;
      const ground = t === T.FLOOR && isGroundFS(st) && groundBorder(m, st, tx, ty);
      for (let ly = 0; ly < TS; ly++)
        for (let lx = 0; lx < TS; lx++) {
          let c: C3;
          if (t === T.THICKET) c = thicketPix(tx, ty, lx, ly);
          else if (wall) c = face ? wallFacePix(tx, ty, lx, ly) : wallTopPix(m, tx, ty, lx, ly);
          else {
            c = floorPix(ground ? warpedGroundStyle(m, st, tx, ty, tx * TS + lx, ty * TS + ly) : st, tx, ty, lx, ly);
            let f = 1;
            if (aoU && ly < 4) f *= [0.45, 0.6, 0.75, 0.88][ly];
            if (aoL && lx < 2) f *= lx === 0 ? 0.7 : 0.85;
            if (aoR && lx > 13) f *= lx === 15 ? 0.7 : 0.85;
            if (dirty) f *= 0.7;
            c = [c[0] * f, c[1] * f, c[2] * f];
          }
          const i = (((ty - y0) * TS + ly) * w + (tx - x0) * TS + lx) * 4;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
    }
  ctx.putImageData(img, x0 * TS, y0 * TS);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 * TS, y0 * TS, w, h);
  ctx.clip();
  const p = new Pen(ctx, false);
  const X0 = x0 * TS - 1, X1 = (x1 + 1) * TS + 1, Y0 = y0 * TS - 1, Y1 = (y1 + 1) * TS + 1;
  const b = decalBounds(m.decals);
  for (let i = 0, k = 0; i < m.decals.length; i++, k += 4) {
    if (b[k + 2] < X0 || b[k] > X1 || b[k + 3] < Y0 || b[k + 1] > Y1) continue;
    drawDecal(p, m.decals[i]);
  }
  ctx.restore();
}

/**
 * Pixel bounds [left, top, right, bottom] of a decal relative to its (x, y),
 * so chunked bakes only redraw the decals that actually reach the chunk.
 * Kinds without an entry use the original generous window.
 */
function decalExtent(dc: DecalDef): [number, number, number, number] | null {
  const w = dc.w ?? 0, h = dc.h ?? 0;
  switch (dc.kind) {
    case "tuft": return [-4, -5, 4, 1];
    case "flowers": return [-6, -4, 5, 4];
    case "roots": return [-9, 0, 9, 9];
    case "debris": return [0, 0, 8, 8];
    case "puddle": return [0, 0, (w || 30) + 1, (h || 12) + 1];
    case "hump": case "hollow": case "earthspill": {
      const rx = Math.min(dc.kind === "earthspill" ? 38 : 36, (w || 40) >> 1) + 1, ry = Math.min(30, (h || 20) >> 1) + 1;
      return [-rx, -ry, rx, ry];
    }
    case "ridge": { const len = Math.min(112, w || 48), m = (h || 10) + 4; return dc.v & 1 ? [-m, -m, m, len + m] : [-m, -m, len + m, m]; }
    case "shade": { const rr = Math.min(36, (w || 40) >> 1) + 1; return [-rr, -rr, rr, rr]; }
    case "mosspatch": return [-21, -21, 21, 21];
    case "leaves": return [-9, -7, 10, 8];
    case "wildflowers": return [-9, -6, 9, 8];
    case "weeds": return [-7, -10, 7, 1];
    case "ivy": { const l = Math.min(40, w || 18) + 2; return [-l, -l, l, l]; }
    case "pebbles": return [-7, -5, 8, 6];
    case "rootfall": return [-9, 0, 9, 22];
    case "stones": return [-7, -5, 12, 9];
  }
  return null;
}

/** Absolute bounds of every decal, cached per decal list (recomputed when decals are appended). */
const boundsCache = new WeakMap<DecalDef[], { n: number; b: Float32Array }>();
function decalBounds(decals: DecalDef[]): Float32Array {
  let c = boundsCache.get(decals);
  if (c && c.n === decals.length) return c.b;
  const b = new Float32Array(decals.length * 4);
  decals.forEach((dc, i) => {
    const e = decalExtent(dc) ?? [-40, -40, 120, 200];
    b[i * 4] = dc.x + e[0]; b[i * 4 + 1] = dc.y + e[1]; b[i * 4 + 2] = dc.x + e[2]; b[i * 4 + 3] = dc.y + e[3];
  });
  boundsCache.set(decals, (c = { n: decals.length, b }));
  return b;
}

function ellipseFill(p: Pen, cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number, edge: boolean) => string | null) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      const v = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (v <= 1) {
        const c = fn(x, y, v > 0.7);
        if (c) p.p(cx + x, cy + y, c);
      }
    }
}

function drawDecal(p: Pen, dc: DecalDef) {
  const r = mulberry(Math.floor(dc.x * 13 + dc.y * 7 + dc.v));
  const x = Math.round(dc.x), y = Math.round(dc.y);
  p.ox = 0; p.oy = 0;
  switch (dc.kind) {
    case "tuft": {
      const cols = ["#4e7a3a", "#628e44", "#3a5e2c"];
      for (let i = 0; i < 5; i++) { const bx = x + ((r() * 6) | 0) - 3, h = 2 + ((r() * 3) | 0); p.r(bx, y - h, 1, h, cols[(r() * 3) | 0]); }
      break;
    }
    case "flowers": {
      const cols = ["#d8d0e8", "#e8c860", "#c86a8a", "#8ab0e8"];
      const c = cols[dc.v % cols.length];
      for (let i = 0; i < 4; i++) { const fx = x + ((r() * 10) | 0) - 5, fy = y + ((r() * 6) | 0) - 3; p.p(fx, fy + 1, "#3a5e2c"); p.p(fx, fy, c); }
      break;
    }
    case "dirtmound": {
      const w = dc.w ?? 40, h = dc.h ?? 18;
      ellipseFill(p, x, y, w >> 1, h >> 1, (ex, ey, edge) => edge ? (hash2(ex, ey, 51) < 0.5 ? "#5a4630" : null) : ey < -2 ? "#7a6448" : hash2(ex, ey, 52) < 0.06 ? "#8a8392" : "#6a5440");
      break;
    }
    case "stoneline": {
      // the top course of a buried wall, peeking through the turf
      const w = dc.w ?? 48;
      for (let bx = 0; bx < w; bx += 8) {
        if (r() < 0.25) continue;
        const sink = (r() * 3) | 0;
        p.o(x + bx, y + sink, 7, 4 - sink + 2, "#7a7268", "#2e2a26"); p.r(x + bx + 1, y + sink + 1, 4, 1, "#9a9288");
      }
      break;
    }
    case "roots": {
      for (let i = 0; i < 3; i++) { let rx = x, ry = y; for (let k = 0; k < 8; k++) { p.p(rx, ry, "#4a3420"); rx += ((r() * 3) | 0) - 1; ry += r() < 0.6 ? 1 : 0; } }
      break;
    }
    case "crack": {
      let cx = x, cy = y;
      const len = 5 + ((r() * 7) | 0);
      for (let i = 0; i < len; i++) {
        p.p(cx, cy, "#1c1816");
        if (r() < 0.3) p.p(cx + 1, cy + 1, "#6a625a");
        cx += r() < 0.6 ? 1 : 0;
        cy += r() < 0.5 ? 1 : r() < 0.5 ? -1 : 0;
      }
      break;
    }
    case "debris": {
      const k = 2 + ((r() * 3) | 0);
      for (let i = 0; i < k; i++) {
        const dx = (r() * 6) | 0, dy = (r() * 5) | 0;
        const s = r() < 0.3 ? 2 : 1;
        p.r(x + dx, y + dy + s, s, 1, "#18141a");
        p.r(x + dx, y + dy, s, s, r() < 0.5 ? S.l : S.m);
        if (s === 2) p.p(x + dx, y + dy, S.h);
      }
      break;
    }
    case "bones": {
      if (dc.v === 0) {
        p.r(x, y, 3, 3, BN.m); p.p(x, y + 1, BN.d); p.p(x + 2, y + 1, BN.d); p.p(x + 1, y + 3, BN.d);
        p.r(x + 4, y + 2, 5, 1, BN.m); p.p(x + 4, y + 1, BN.l); p.p(x + 8, y + 3, BN.l);
      } else {
        p.r(x, y, 6, 1, BN.m); p.p(x - 1, y - 1, BN.l); p.p(x - 1, y + 1, BN.l); p.p(x + 6, y - 1, BN.l); p.p(x + 6, y + 1, BN.l);
        if (dc.v === 2) { p.r(x + 2, y + 3, 1, 4, BN.d); }
      }
      break;
    }
    case "cobweb": {
      const fx = dc.v ? -1 : 1, bx = dc.v ? x + 15 : x;
      for (let i = 0; i < 9; i++) { if (i % 2 === 0) p.p(bx + fx * i, y + i, "#6e6a74"); }
      for (let i = 0; i < 10; i++) { p.p(bx + fx * i, y, "#56525c"); if (i < 9) p.p(bx, y + i, "#56525c"); }
      for (let i = 0; i < 6; i++) { p.p(bx + fx * (5 - i + (i >> 1)), y + i + 1, "#4a4650"); }
      p.p(bx + fx * 3, y + 3, "#7a7680");
      break;
    }
    case "moss": {
      for (let i = 0; i < 9; i++) p.p(x + ((r() * 6) | 0), y + ((r() * 5) | 0), r() < 0.5 ? "#3e4a2a" : "#55633a");
      break;
    }
    case "puddle": {
      const rx = Math.round((dc.w ?? 30) / 2), ry = Math.round((dc.h ?? 12) / 2);
      ellipseFill(p, x + rx, y + ry, rx, ry, (ex, ey, edge) => {
        if (hash2(ex + x, ey + y, 4) < (edge ? 0.35 : 0)) return null;
        if (ey === -ry + 1 && hash2(ex, ey, 2) < 0.5) return "#3a5670";
        if (hash2(ex + x, ey + y, 5) < 0.04) return "#4c6e8a";
        return edge ? "#1f2a33" : "#151d26";
      });
      break;
    }
    case "carpet": {
      const w = dc.w ?? 32, h = dc.h ?? 64;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const wx = x + i, wy = y + j;
          const hole = hash2(wx >> 2, wy >> 2, 40 + dc.v);
          const endFray = j < 10 || j > h - 14 ? 0.55 : 0.12;
          if (hole < endFray && hash2(wx, wy, 41) < 0.8) continue;
          const border = i === 1 || i === w - 2;
          const edge = i === 0 || i === w - 1;
          let c = edge ? CL.d : border ? GD.d : (i + j) % 8 === 0 && i > 4 && i < w - 5 ? CL.l : CL.m;
          if (!edge && !border && i > 6 && i < w - 7 && j % 16 === 8 && Math.abs(i - w / 2) < 3) c = GD.d;
          if (hash2(wx, wy, 42) < 0.15) c = CL.d;
          p.p(wx, wy, c);
        }
      break;
    }
    case "dais": {
      const w = dc.w ?? 96, h = dc.h ?? 48;
      p.ctx.globalAlpha = 0.12;
      p.r(x, y, w, h - 3, "#c8c0d8");
      p.ctx.globalAlpha = 1;
      p.r(x, y + h - 3, w, 1, "#9a92a8");
      p.r(x, y + h - 2, w, 2, "#24202a");
      p.r(x, y, 1, h - 2, "#9a92a8");
      p.r(x + w - 1, y, 1, h - 2, "#24202a");
      break;
    }
    case "paper": {
      p.r(x, y, 4, 5, "#9a907a"); p.r(x + 1, y + 1, 2, 1, "#5a5040"); p.r(x + 1, y + 3, 2, 1, "#5a5040");
      break;
    }
    case "scorch": {
      for (let j = -8; j <= 8; j++) for (let i = -14; i <= 14; i++) {
        const v = (i * i) / 196 + (j * j) / 64;
        if (v < 1 && hash2(x + i, y + j, 50) > v * 0.9) p.p(x + i, y + j, v < 0.4 ? "#141010" : "#201a18");
      }
      break;
    }
    case "books": {
      const cols = ["#5a2a2a", "#2a3a5a", "#3a4a2a", "#5a4a2a", "#4a2a4a"];
      const c = cols[(r() * cols.length) | 0];
      if (dc.v < 2) { p.r(x, y, 4, 3, c); p.r(x, y + 3, 4, 1, "#1a1210"); p.p(x + 1, y, "#b0a080"); }
      else { p.r(x, y, 3, 4, c); p.r(x + 3, y, 1, 4, "#1a1210"); p.r(x, y + 1, 1, 2, "#a89878"); }
      if (dc.v === 3) { p.r(x + 4, y + 1, 4, 3, "#b0a888"); p.r(x + 6, y + 1, 1, 3, "#706858"); }
      break;
    }
    case "chalk": {
      const c = "#7e7a86";
      if (dc.v === 0) { for (let i = 0; i < 6; i++) if (i % 2 === 0) p.p(x + i, y + ((i * 0.5) | 0), c); }
      else if (dc.v === 1) { p.p(x, y, c); p.p(x + 1, y - 1, c); p.p(x + 2, y, c); p.p(x + 1, y + 1, c); p.p(x + 4, y, c); }
      else { p.r(x, y, 1, 3, c); p.r(x, y, 3, 1, c); p.p(x + 2, y + 2, c); }
      break;
    }
    case "coins": {
      p.p(x, y, GD.m); p.p(x + 1, y, GD.l); p.p(x, y + 1, GD.d);
      if (dc.v) { p.p(x + 3, y + 2, GD.m); p.p(x + 4, y + 2, GD.d); }
      break;
    }
    case "weapon": {
      if (dc.v === 0) { p.r(x, y, 7, 1, IR.l); p.p(x + 7, y, IR.h); p.r(x - 2, y - 1, 1, 3, WD.m); p.r(x - 4, y, 2, 1, WD.d); }
      else if (dc.v === 1) { ellipseFill(p, x + 3, y + 3, 3, 2, (_a, _b, e) => (e ? IR.d : "#5a3a24")); p.p(x + 3, y + 3, IR.l); }
      else { p.r(x, y, 1, 8, WD.m); p.r(x - 1, y - 2, 3, 2, IR.l); }
      break;
    }
    case "bars_broken": {
      p.r(x + 2, y + 6, 10, 1, IR.d); p.r(x + 3, y + 10, 9, 1, IR.m); p.r(x + 1, y + 13, 7, 1, IR.d);
      p.r(x + 4, y + 2, 1, 6, IR.m);
      break;
    }
    case "door_open": {
      p.r(x, y - 2, 4, 15, WD.o); p.r(x + 1, y - 1, 2, 13, WD.m); p.r(x, y + 2, 4, 1, IR.m); p.r(x, y + 8, 4, 1, IR.m);
      break;
    }
    default:
      drawWildDecal(p, dc, x, y, r);
  }
}


/** Shading-only mound: sunlit crest, shadowed foot, dithered so it stays pixel art. v=1 shows bare soil on the crest. */
function hump(p: Pen, cx: number, cy: number, rx: number, ry: number, bare: boolean, seed: number) {
  ellipseFill(p, cx, cy, rx, ry, (ex, ey, edge) => {
    const wx = cx + ex, wy = cy + ey, d = hash2(wx, wy, seed);
    const v = (ex * ex) / (rx * rx) + (ey * ey) / (ry * ry);
    if (ey > ry * 0.35) return edge ? ((wx + wy) & 1 ? "rgba(8,10,6,0.30)" : null) : d < 0.5 ? "rgba(8,10,6,0.16)" : null;
    if (ey < -ry * 0.2 && v < 0.75) {
      if (bare && v < 0.45 && d < 0.75) return d < 0.08 ? "#8a7c66" : d < 0.4 ? "#6e5a42" : "#7a6448";
      return d < 0.55 ? "rgba(255,236,190,0.10)" : null;
    }
    return edge && d < 0.3 ? null : d < 0.3 ? "rgba(255,236,190,0.05)" : null;
  });
}

/** Surface wilderness decals and the dungeon's collapsed-entrance decals. */
function drawWildDecal(p: Pen, dc: DecalDef, x: number, y: number, r: Rng) {
  switch (dc.kind) {
    case "hump": {
      hump(p, x, y, Math.min(36, (dc.w ?? 28) >> 1), Math.min(30, (dc.h ?? 14) >> 1), dc.v === 1, 120);
      break;
    }
    case "ridge": {
      // a long low bank of earth over a buried wall course: chained humps with a wobble
      const len = Math.min(112, dc.w ?? 48), th = dc.h ?? 10, vert = dc.v & 1, bare = (dc.v & 2) !== 0;
      for (let s = 0; s < len; s += 6) {
        const wob = Math.round((hash2(x + s, y, 121) - 0.5) * 4);
        const rr = (th >> 1) + ((hash2(x, y + s, 122) * 3) | 0);
        if (vert) hump(p, x + wob, y + s, Math.max(3, rr - 1), rr + 2, bare, 123);
        else hump(p, x + s, y + wob, rr + 3, Math.max(3, rr - 1), bare, 123);
      }
      break;
    }
    case "hollow": {
      // a sunken patch: the shadow falls on the far (top) lip, light on the near one
      const rx = Math.min(36, (dc.w ?? 40) >> 1), ry = Math.min(30, (dc.h ?? 20) >> 1);
      ellipseFill(p, x, y, rx, ry, (ex, ey, edge) => {
        const wx = x + ex, wy = y + ey, d = hash2(wx, wy, 124);
        if (ey < -ry * 0.45) return edge ? (d < 0.6 ? "rgba(6,8,4,0.26)" : null) : d < 0.7 ? "rgba(6,8,4,0.20)" : null;
        if (ey > ry * 0.5 && edge) return d < 0.5 ? "rgba(255,236,190,0.10)" : null;
        return d < 0.4 ? "rgba(6,8,4,0.08)" : null;
      });
      break;
    }
    case "mosspatch": {
      const rr = Math.min(20, (dc.w ?? 14) >> 1), cols = dc.v === 1 ? ["#5a7a2c", "#6e8e34", "#46622a"] : ["#3e5e2a", "#527636", "#2e4a22"];
      ellipseFill(p, x, y, rr, Math.max(2, rr - 2 - (dc.v & 1)), (ex, ey, edge) => {
        const d = hash2(x + ex, y + ey, 125);
        if (edge && d < 0.55) return null;
        return d < 0.08 ? "#8aa848" : cols[(d * 3) | 0];
      });
      break;
    }
    case "leaves": {
      const cols = ["#7a5630", "#946a34", "#5e4228", "#8a4a2a", "#a07c40", "#4e6230"];
      const k = 5 + ((r() * 6) | 0);
      for (let i = 0; i < k; i++) {
        const lx = x + ((r() * 16) | 0) - 8, ly = y + ((r() * 12) | 0) - 6, c = cols[(r() * cols.length) | 0];
        p.r(lx, ly, 2, 1, c); if (r() < 0.5) p.p(lx + (r() < 0.5 ? 0 : 1), ly + 1, "#2a2014");
      }
      break;
    }
    case "wildflowers": {
      const sets = [["#d8d0e8", "#e8c860"], ["#c86a8a", "#e8a0b8"], ["#8ab0e8", "#d8d0e8"], ["#e8c860", "#e89a40"]];
      const cs = sets[dc.v % sets.length], k = 7 + ((r() * 6) | 0);
      for (let i = 0; i < k; i++) {
        const fx = x + ((r() * 14) | 0) - 7, fy = y + ((r() * 9) | 0) - 4, h = 1 + ((r() * 2) | 0);
        p.r(fx, fy + 1, 1, h, r() < 0.5 ? "#3a5e2c" : "#4e7a3a");
        p.p(fx, fy, cs[(r() * 2) | 0]);
        if (r() < 0.3) { p.p(fx - 1, fy, cs[0]); p.p(fx + 1, fy, cs[0]); }
      }
      break;
    }
    case "weeds": {
      // taller, seed-headed weeds: they grow thick on the soil over buried walls
      const cols = ["#5e7e3a", "#6e8a40", "#4a6a30", "#7a8a48"], k = 6 + ((r() * 4) | 0);
      for (let i = 0; i < k; i++) {
        const bx = x + ((r() * 10) | 0) - 5, h = 4 + ((r() * 5) | 0), lean = r() < 0.5 ? -1 : 1;
        for (let j = 0; j < h; j++) p.p(bx + (j > h * 0.6 ? lean : 0), y - j, cols[(r() * cols.length) | 0]);
        if (r() < 0.5) p.p(bx + lean, y - h, "#a89a5a");
      }
      break;
    }
    case "ivy": {
      // a creeping vine with paired leaves; v picks the general heading
      const dir = [[1, 0], [0, 1], [1, 1], [-1, 1]][dc.v & 3];
      let vx = x, vy = y;
      const len = Math.min(40, dc.w ?? 18);
      for (let i = 0; i < len; i++) {
        p.p(vx, vy, "#2e3e1c");
        if (i % 3 === 1) { p.p(vx - dir[1], vy + dir[0] - 1, r() < 0.5 ? "#4e7a34" : "#3a6228"); if (r() < 0.6) p.p(vx + dir[1], vy - dir[0] + 1, "#5a8a3c"); }
        vx += dir[0] + (r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0) * (dir[0] ? 0 : 1);
        vy += dir[1] + (r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0) * (dir[1] ? 0 : 1);
      }
      break;
    }
    case "shade": {
      // dappled canopy shadow: soft dark blotches with sun flecks left open (2px dapples)
      const rr = Math.min(36, (dc.w ?? 40) >> 1), ry = Math.min(28, Math.round(rr * 0.7));
      for (let ey = -ry; ey <= ry; ey += 2) for (let ex = -rr; ex <= rr; ex += 2) {
        const v = (ex * ex) / (rr * rr) + (ey * ey) / (ry * ry);
        if (v > 1) continue;
        const wx = x + ex, wy = y + ey;
        const b = hash2(wx >> 2, wy >> 2, 126) * 0.6 + hash2(wx >> 3, wy >> 3, 127) * 0.4;
        if (b > 0.68 || (v > 0.7 && hash2(wx, wy, 128) < 0.5)) continue;
        p.r(wx, wy, 2, 2, b < 0.3 ? "rgba(4,8,10,0.22)" : "rgba(4,8,10,0.12)");
      }
      break;
    }
    case "pebbles": {
      const k = 3 + ((r() * 4) | 0);
      for (let i = 0; i < k; i++) {
        const sx = x + ((r() * 12) | 0) - 6, sy = y + ((r() * 8) | 0) - 4, big = r() < 0.3;
        p.r(sx, sy + 1, big ? 2 : 1, 1, "#2a2420");
        p.r(sx, sy, big ? 2 : 1, 1, r() < 0.5 ? "#8a8478" : "#6e685e");
        if (r() < 0.3) p.p(sx + 1, sy + 1, "#4e6a30");
      }
      break;
    }
    // ---- dungeon: the collapsed surface gate
    case "earthspill": {
      // a fan of earth that poured in when the gate fell; it thins toward the room
      const rx = Math.min(38, (dc.w ?? 48) >> 1), ry = Math.min(30, (dc.h ?? 24) >> 1);
      ellipseFill(p, x, y, rx, ry, (ex, ey) => {
        const wx = x + ex, wy = y + ey, d = hash2(wx, wy, 130), v = (ex * ex) / (rx * rx) + (ey * ey) / (ry * ry);
        if (d < v * 0.9 - 0.15) return null;
        if (d < 0.05) return "#8a8478";
        if (d > 0.97) return "#2a2018";
        return hash2(wx >> 1, wy >> 1, 131) < 0.4 ? "#5a4630" : ey < 0 ? "#6a5440" : "#4e3c2a";
      });
      break;
    }
    case "rootfall": {
      // roots forced through the broken vault: they hang and trail across the floor
      const k = 2 + (dc.v & 1);
      for (let i = 0; i < k; i++) {
        let rx = x + ((r() * 10) | 0) - 5, ry = y;
        const len = 8 + ((r() * 10) | 0);
        for (let j = 0; j < len; j++) {
          p.p(rx, ry, j < 3 ? "#5a4028" : "#3e2c1a");
          if (j > 2 && r() < 0.18) p.p(rx + (r() < 0.5 ? -1 : 1), ry + 1, "#2e2214");
          rx += r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0; ry += 1;
        }
      }
      break;
    }
    case "stones": {
      const k = 2 + ((r() * 3) | 0);
      for (let i = 0; i < k; i++) {
        const sx = x + ((r() * 12) | 0) - 6, sy = y + ((r() * 8) | 0) - 4, w = 2 + ((r() * 3) | 0), h = 2 + ((r() * 2) | 0);
        p.r(sx, sy + h, w, 1, "#141016");
        p.r(sx, sy, w, h, r() < 0.5 ? S.m : S.l);
        p.r(sx, sy, w - 1, 1, S.h);
        p.p(sx + w - 1, sy + h - 1, S.d);
      }
      break;
    }
  }
}

// ---------------- Props ----------------
const cache = new Map<string, Sprite>();
export function cached(key: string, make: () => Sprite) {
  let s = cache.get(key);
  if (!s) { s = make(); cache.set(key, s); }
  return s;
}

function stoneBlob(p: Pen, x: number, y: number, w: number, h: number, r: Rng) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const dx = (i + 0.5 - w / 2) / (w / 2), dy = (j + 0.5 - h / 2) / (h / 2);
      const v = dx * dx + dy * dy;
      if (v > 1.05) continue;
      let c = v > 0.62 ? S.o : dx + dy < -0.5 ? S.h : dx + dy < 0.1 ? S.l : dx + dy < 0.6 ? S.m : S.d;
      if (c !== S.o && r() < 0.06) c = S.d;
      p.p(x + i, y + j, c);
    }
}

export function rubbleSprite(v: number, cracked: boolean): Sprite {
  return cached(`rub${v}${cracked}`, () =>
    makeSprite(22, 26, 11, 24, 100 + v * 17 + (cracked ? 5 : 0), (p, r) => {
      if (cracked) {
        stoneBlob(p, 1, 10, 9, 8, r); stoneBlob(p, 12, 11, 9, 8, r);
        // big slab
        p.o(2, 2, 18, 20, S.m, S.o);
        p.r(3, 3, 16, 2, S.h); p.r(3, 5, 2, 16, S.l); p.r(15, 5, 4, 16, S.d);
        for (let i = 0; i < 6; i++) p.p(5 + ((r() * 10) | 0), 6 + ((r() * 14) | 0), S.d);
        // glowing cracks (light leaking from behind)
        const crack = [[10, 3], [10, 4], [9, 5], [9, 6], [10, 7], [11, 8], [11, 9], [10, 10], [9, 11], [9, 12], [8, 13], [8, 14], [9, 15], [10, 16], [10, 17], [11, 18], [11, 19], [12, 20], [12, 21]];
        for (const [cx, cy] of crack) p.g(cx, cy, 1, 1, "#5a6c9a");
        for (const [cx, cy] of [[11, 7], [12, 7], [13, 6], [8, 12], [7, 12], [6, 11], [12, 16], [13, 16], [14, 17]]) p.g(cx, cy, 1, 1, "#34405e");
        stoneBlob(p, 0, 17, 8, 7, r); stoneBlob(p, 14, 18, 8, 6, r); stoneBlob(p, 7, 20, 8, 5, r);
        return;
      }
      const n = 7 + ((r() * 3) | 0);
      const rocks: [number, number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const w = 5 + ((r() * 6) | 0), h = 4 + ((r() * 5) | 0);
        const t = i / n;
        rocks.push([((r() * (22 - w)) | 0), Math.round(2 + t * 16 + r() * 3), w, h]);
      }
      rocks.sort((a, b) => a[1] + a[3] - (b[1] + b[3]));
      if (v === 1) { p.r(2, 9, 18, 3, WD.o); p.r(3, 10, 16, 1, WD.m); p.p(19, 9, WD.d); }
      for (const [x, y, w, h] of rocks) stoneBlob(p, x, Math.min(y, 25 - h), w, h, r);
      if (v === 2) { p.r(4, 14, 3, 1, WD.d); p.r(16, 18, 4, 1, WD.l); }
    })
  );
}

export function pillarSprite(broken: boolean): Sprite {
  return cached(`pil${broken}`, () =>
    broken
      ? makeSprite(20, 22, 10, 20, 7, (p, r) => {
          p.o(1, 12, 18, 8, S.l, S.o); p.r(2, 13, 16, 1, S.h);
          for (let i = 3; i < 17; i++) {
            const top = 2 + ((r() * 5) | 0);
            p.r(i, top, 1, 13 - top, i === 3 || i === 16 ? S.o : i > 13 ? S.d : S.m);
            p.p(i, top, i === 3 || i === 16 ? S.o : S.h);
          }
          p.r(5, 5, 1, 7, S.h); p.r(9, 5, 1, 7, S.l); p.r(13, 5, 1, 7, S.d);
          p.p(8, 8, S.o); p.p(9, 9, S.o); p.p(9, 10, S.o);
          stoneBlob(p, 0, 16, 6, 5, r); stoneBlob(p, 15, 15, 5, 6, r);
        })
      : makeSprite(20, 48, 10, 44, 8, (p) => {
          p.o(1, 38, 18, 7, S.l, S.o); p.r(2, 39, 16, 1, S.h); p.r(2, 43, 16, 1, S.d);
          p.o(3, 7, 14, 32, S.m, S.o);
          for (let i = 0; i < 4; i++) { p.r(5 + i * 3, 8, 1, 30, S.h); p.r(6 + i * 3, 8, 1, 30, S.l); }
          p.r(14, 8, 2, 30, S.d);
          p.o(1, 1, 18, 7, S.l, S.o); p.r(2, 2, 16, 2, S.h); p.r(2, 6, 16, 1, S.d);
          p.p(7, 18, S.o); p.p(8, 19, S.o); p.p(8, 20, S.o); p.p(9, 21, S.o);
        })
  );
}

export function doorSprite(): Sprite {
  return cached("door", () =>
    makeSprite(16, 22, 8, 20, 9, (p) => {
      p.o(4, 0, 8, 20, WD.m, WD.o);
      p.r(5, 1, 2, 18, WD.l); p.r(9, 1, 2, 18, WD.d);
      for (const y of [3, 9, 15]) p.r(4, y, 8, 2, IR.m), p.r(4, y, 8, 1, IR.l);
      p.o(3, 7, 4, 5, GD.m, "#3a2a08"); p.p(4, 9, "#000"); p.p(4, 10, "#000");
    })
  );
}

export function barsSprite(): Sprite {
  return cached("bars", () =>
    makeSprite(16, 26, 8, 22, 10, (p) => {
      p.r(6, 0, 4, 2, IR.m);
      for (let j = 0; j < 6; j++) { p.r(7, 2 + j * 4, 2, 3, IR.d); p.p(7, 2 + j * 4, IR.l); p.r(6, 5 + j * 4, 4, 1, IR.m); }
      p.r(6, 22, 4, 2, IR.d);
    })
  );
}

function books(p: Pen, x: number, y: number, w: number, h: number, r: Rng, sparse = 0) {
  const cols = ["#6a2a2a", "#2a3a6a", "#3a5a2a", "#6a5a2a", "#5a2a5a", "#7a6a50"];
  let i = 0;
  while (i < w) {
    const bw = r() < 0.7 ? 1 : 2;
    if (r() < 0.15 + sparse) { i += 1 + ((r() * 2) | 0); continue; }
    const bh = h - ((r() * 2) | 0);
    const c = cols[(r() * cols.length) | 0];
    p.r(x + i, y + h - bh, bw, bh, c);
    p.p(x + i, y + h - bh, "#c0b090");
    i += bw;
  }
}

export function propSprite(kind: string, v: number, alt: boolean): Sprite | null {
  const key = `${kind}|${v}|${alt}`;
  const c = cache.get(key);
  if (c) return c;
  const s = makeProp(kind, v, alt);
  if (s) cache.set(key, s);
  return s;
}

/** Draws one prop sprite. `M` makes a sprite with the kind's deterministic seed and anchor. */
export type PropArt = (v: number, alt: boolean, M: SpriteMaker) => Sprite;
type SpriteMaker = (w: number, h: number, fn: (p: Pen, r: Rng) => void, ay?: number) => Sprite;

// ---- overgrowth helpers shared by the surface sprites
const MOSS = ["#2e4a22", "#3e5e2a", "#527636", "#6e8e34"];
/** Moss speckled over a rect (the upper faces of stone or wood), thinning toward the bottom. */
function mossOver(p: Pen, r: Rng, x: number, y: number, w: number, h: number, dens: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (r() > dens * (1 - j / (h + 1)) * (hash2(x + i >> 1, y + j >> 1, 140) * 0.8 + 0.4)) continue;
    p.p(x + i, y + j, MOSS[(r() * 4) | 0]);
  }
}
/** A strand of ivy hanging down from (x, y), with leaves. */
function ivyOn(p: Pen, r: Rng, x: number, y: number, len: number) {
  let vx = x;
  for (let j = 0; j < len; j++) {
    p.p(vx, y + j, "#2e3e1c");
    if (j % 2 === 0) p.p(vx + (j % 4 === 0 ? 1 : -1), y + j, r() < 0.5 ? "#4e7a34" : "#3a6228");
    if (r() < 0.2) vx += r() < 0.5 ? -1 : 1;
  }
}
/** A row of grass blades along a base line. */
function tufts(p: Pen, r: Rng, x: number, y: number, w: number, k: number) {
  const cols = ["#4e7a3a", "#628e44", "#3a5e2c"];
  for (let i = 0; i < k; i++) { const bx = x + ((r() * w) | 0), h = 1 + ((r() * 3) | 0); p.r(bx, y - h, 1, h, cols[(r() * 3) | 0]); }
}
function fernTuft(p: Pen, r: Rng, x: number, y: number) {
  for (let f = -2; f <= 2; f++) { let fx = x, fy = y; for (let s = 0; s < 4; s++) { fx += f * 0.6; fy -= 1; p.p(Math.round(fx), Math.round(fy), r() < 0.5 ? "#3e6a3a" : "#5a8a4e"); } }
}
function leafBlob(p: Pen, r: Rng, cx: number, cy: number, rr: number, leaf: string[]) {
  for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
    const d = (x * x + y * y) / (rr * rr);
    if (d > 1 || (d > 0.75 && r() < 0.35)) continue;
    let c = d > 0.75 ? leaf[0] : x + y < -rr * 0.5 ? leaf[3] : x + y < 0 ? leaf[2] : leaf[1];
    if (r() < 0.1) c = leaf[0];
    p.p(cx + x, cy + y, c);
  }
}

/** Prop sprite registry: kind -> draw function. Adding a prop kind = adding an entry. */
export const PROP_ART: Record<string, PropArt> = {
  // ---------- surface
  tree: (v, alt, M) => {
    if (alt) return M(18, 12, (p) => {
      p.r(2, 9, 14, 3, "#1a1208");
      p.o(4, 3, 10, 8, WD.m, WD.o); p.o(4, 1, 10, 4, "#b08a5a", WD.o); p.p(8, 2, WD.d); p.p(10, 3, WD.l);
      p.r(1, 10, 3, 1, WD.d); p.r(14, 10, 3, 1, WD.d);
    });
    const leaf = [["#1e3a1c", "#2e5226", "#3e6a30", "#5a8a40"], ["#24361a", "#365022", "#4a6a2c", "#6a8a3e"], ["#1a3226", "#284a34", "#386442", "#4e8456"]][v % 3];
    return M(34, 44, (p, r) => {
      p.r(9, 40, 16, 3, "rgba(0,0,0,0.35)");
      p.o(14, 26, 6, 17, WD.m, WD.o); p.r(15, 27, 1, 15, WD.l); p.r(18, 27, 1, 15, WD.d);
      p.r(12, 41, 3, 2, WD.d); p.r(19, 41, 3, 2, WD.d);
      const blob = (cx: number, cy: number, rr: number) => {
        for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
          const d = (x * x + y * y) / (rr * rr);
          if (d > 1) continue;
          let c = d > 0.8 ? leaf[0] : x + y < -rr * 0.5 ? leaf[3] : x + y < 0 ? leaf[2] : leaf[1];
          if (r() < 0.08) c = leaf[0];
          p.p(cx + x, cy + y, c);
        }
      };
      blob(17, 18, 10); blob(10, 22, 7); blob(24, 22, 7); blob(13, 11, 7); blob(22, 12, 6);
    });
  },
  rock: (v, alt, M) => {
    if (alt) return M(18, 8, (p, r) => { for (let i = 0; i < 5; i++) { const x = (r() * 14) | 0, y = 2 + ((r() * 5) | 0); p.r(x, y, 3, 2, S.m); p.p(x, y, S.h); } });
    return M(22, 18, (p, r) => {
      p.r(2, 15, 18, 3, "rgba(0,0,0,0.35)");
      stoneBlob(p, 1, 3 + (v & 1), 20, 14, r);
      stoneBlob(p, 11, 1, 9, 8, r);
      p.r(5, 9, 4, 1, S.d); p.p(14, 6, S.d);
      if (v >= 2) { mossOver(p, r, 2, 2, 18, 7, 0.55); tufts(p, r, 1, 17, 20, 5); }
    });
  },
  torch_post: (_v, alt, M) => M(8, 20, (p) => {
    p.r(1, 18, 6, 2, S.o); p.r(3, 6, 2, 13, WD.m); p.r(3, 6, 1, 13, WD.l);
    p.r(2, 3, 4, 3, IR.m); p.r(2, 3, 4, 1, IR.l);
    if (!alt) p.r(3, 2, 2, 2, "#120e0c"); else p.g(3, 2, 2, 2, "#ff9a3a");
  }),
  cart: (_v, _alt, M) => M(34, 22, (p) => {
    p.r(2, 19, 30, 3, "rgba(0,0,0,0.35)");
    p.o(3, 6, 24, 9, WD.m, WD.o); p.r(4, 7, 22, 1, WD.l); for (let x = 7; x < 26; x += 6) p.r(x, 8, 1, 6, WD.d);
    p.o(6, 12, 10, 10, WD.d, WD.o); p.r(10, 16, 2, 2, IR.m);
    p.r(26, 9, 8, 2, WD.m); p.r(20, 16, 9, 4, WD.o); p.r(21, 17, 7, 2, WD.d); // toppled second wheel
  }),
  // The buried surface gate: no arch, no opening. A low grassy swell where the
  // arch top lies, with one weathered lintel corner just breaking the turf.
  buriedgate: (_v, _alt, M) => M(44, 14, (p, r) => {
    for (let y = 0; y < 14; y++) for (let x = 0; x < 44; x++) {
      const dx = (x - 22) / 22, dy = (y - 8) / 6, v = dx * dx + dy * dy;
      if (v > 1 || r() < v * 0.5) continue;
      if (dy > 0.45) { if ((x + y) & 1) p.p(x, y, "rgba(8,10,6,0.22)"); }
      else if (dy < -0.3 && r() < 0.5) p.p(x, y, "rgba(255,236,190,0.08)");
    }
    // lintel corner: a squared, moss-capped block edge, mostly sunk
    p.r(27, 6, 7, 3, "#141016"); p.r(28, 6, 5, 2, "#7a7268"); p.r(28, 6, 5, 1, "#9a9288"); p.p(32, 7, "#5a544c");
    p.r(28, 5, 3, 1, MOSS[1]); p.p(31, 5, MOSS[2]); p.p(27, 7, MOSS[0]);
    tufts(p, r, 26, 9, 9, 4); tufts(p, r, 8, 9, 14, 5); tufts(p, r, 33, 8, 6, 3);
  }),
  // ---------- surface overgrowth
  bush: (v, _alt, M) => M(22, 17, (p, r) => {
    const pal = [[MOSS[0], "#2e5226", "#3e6a30", "#5a8a40"], ["#24361a", "#365022", "#4a6a2c", "#6a8a3e"], ["#1a3226", "#284a34", "#386442", "#4e8456"], ["#22381c", "#335026", "#466a30", "#628a3c"]][v & 3];
    p.r(4, 14, 14, 3, "rgba(0,0,0,0.3)");
    leafBlob(p, r, 11, 10, 7, pal); leafBlob(p, r, 6, 11, 5, pal); leafBlob(p, r, 16, 11, 5, pal); leafBlob(p, r, 10, 6, 5, pal);
    if ((v & 3) === 3) for (let i = 0; i < 5; i++) p.p(4 + ((r() * 14) | 0), 5 + ((r() * 8) | 0), r() < 0.5 ? "#a83040" : "#d04858");
    if ((v & 3) === 1) for (let i = 0; i < 4; i++) p.p(4 + ((r() * 14) | 0), 4 + ((r() * 8) | 0), "#d8d0e8");
  }),
  fern: (v, _alt, M) => M(20, 13, (p, r) => {
    const cols = v & 1 ? ["#2e5226", "#4a7a32", "#6a9a44"] : ["#28482a", "#3e6a3a", "#5a8a4e"];
    const fronds = 5 + (v % 3);
    for (let f = 0; f < fronds; f++) {
      const a = Math.PI * (0.08 + (0.84 * f) / (fronds - 1)) + (r() - 0.5) * 0.2, len = 6 + ((r() * 4) | 0);
      for (let s = 1; s <= len; s++) {
        const fx = 10 - Math.cos(a) * s, fy = 12 - Math.sin(a) * s * 0.9 + (s * s) / (len * 2.2);
        p.p(Math.round(fx), Math.round(fy), cols[0]);
        if (s > 1 && s < len) { p.p(Math.round(fx), Math.round(fy) - 1, cols[1]); if (s % 2 === 0) p.p(Math.round(fx - Math.sin(a)), Math.round(fy + Math.cos(a)) - 1, cols[2]); }
      }
    }
    p.p(10, 12, "#2a3a1c");
  }),
  tallgrass: (v, _alt, M) => M(16, 13, (p, r) => {
    const cols = ["#4e7a3a", "#628e44", "#3a5e2c", "#76984c", "#8a9a50"];
    const k = 9 + (v % 3) * 2;
    for (let i = 0; i < k; i++) {
      const bx = 2 + ((r() * 12) | 0), h = 5 + ((r() * 7) | 0), lean = r() < 0.5 ? -1 : 1;
      for (let j = 0; j < h; j++) p.p(bx + (j > h * 0.55 ? lean : 0) + (j > h * 0.85 ? lean : 0), 12 - j, cols[(r() * 4) | 0]);
      if (v === 2 && r() < 0.4) p.p(bx + lean * 2, 12 - h, "#b0a060");
    }
  }),
  sapling: (v, _alt, M) => M(14, 22, (p, r) => {
    const pal = v & 1 ? ["#24361a", "#365022", "#4a6a2c", "#6a8a3e"] : ["#1e3a1c", "#2e5226", "#3e6a30", "#5a8a40"];
    p.r(4, 20, 6, 2, "rgba(0,0,0,0.3)");
    p.r(7, 9, 1, 12, WD.m); p.p(6, 13, WD.l); p.p(8, 15, WD.d);
    leafBlob(p, r, 7, 7, 4, pal); leafBlob(p, r, 4, 10, 3, pal); leafBlob(p, r, 10, 9, 3, pal);
  }),
  stump: (v, _alt, M) => M(18, 13, (p, r) => {
    p.r(2, 10, 14, 3, "rgba(0,0,0,0.3)");
    p.o(4, 4, 10, 8, WD.m, WD.o); p.r(5, 5, 1, 6, WD.l); p.r(12, 5, 1, 6, WD.d);
    p.o(4, 2, 10, 4, "#8a6a44", WD.o); p.p(8, 3, WD.d); p.p(10, 4, WD.l);
    p.r(1, 11, 3, 1, WD.d); p.r(14, 11, 3, 1, WD.d); p.p(3, 10, WD.m);
    mossOver(p, r, 4, 2, 10, 3, 0.45);
    if (v & 1) { p.r(13, 7, 3, 1, "#c8a870"); p.r(13, 8, 2, 1, "#8a6a44"); }
    tufts(p, r, 2, 12, 14, 3);
  }),
  log: (v, alt, M) => {
    if (alt) return M(30, 9, (p, r) => {
      for (let i = 0; i < 6; i++) { const x = (r() * 24) | 0, y = 3 + ((r() * 5) | 0); p.r(x, y, 4, 1, WD.m); p.p(x, y, WD.l); p.p(x + 3, y + 1, WD.o); }
      mossOver(p, r, 2, 4, 24, 4, 0.12);
    });
    return M(36, 16, (p, r) => {
      p.r(3, 13, 30, 3, "rgba(0,0,0,0.32)");
      p.o(3, 4, 28, 10, WD.d, WD.o);
      for (let x = 4; x < 30; x++) { p.p(x, 5, r() < 0.6 ? WD.l : WD.m); if (r() < 0.3) p.p(x, 6 + ((r() * 6) | 0), WD.o); p.p(x, 12, "#2a1c10"); }
      // cut end: growth rings
      p.o(29, 4, 6, 10, "#8a6a44", WD.o); p.r(31, 7, 2, 4, "#6a4e30"); p.p(31, 8, "#a08050"); p.p(32, 10, WD.d);
      if (v & 1) { p.r(10, 1, 2, 4, WD.m); p.p(10, 0, WD.l); } else { p.r(18, 13, 1, 3, WD.d); }
      mossOver(p, r, 4, 4, 24, 4, 0.4);
      if (v % 3 === 2) { p.r(14, 9, 3, 2, "#c8b088"); p.p(14, 9, "#e0d0a8"); p.r(19, 10, 2, 1, "#c8b088"); }
      ivyOn(p, r, 6 + ((v * 7) % 14), 4, 8);
      tufts(p, r, 2, 14, 30, 6);
    });
  },
  boulder: (v, _alt, M) => M(28, 22, (p, r) => {
    p.r(3, 18, 22, 4, "rgba(0,0,0,0.32)");
    stoneBlob(p, 1, 4 + (v & 1), 26, 17, r);
    if (v % 3 !== 1) stoneBlob(p, 15, 2, 10, 9, r);
    p.r(7, 12, 5, 1, S.d); p.p(17, 9, S.d); p.p(8, 13, S.o);
    mossOver(p, r, 3, 3 + (v & 1), 22, 7, 0.55);
    if (v & 1) ivyOn(p, r, 20, 5, 10);
    tufts(p, r, 1, 20, 26, 6);
  }),
  outcrop: (v, _alt, M) => M(48, 32, (p, r) => {
    p.r(4, 27, 40, 5, "rgba(0,0,0,0.32)");
    stoneBlob(p, 0, 12, 22, 18, r); stoneBlob(p, 24, 13, 23, 17, r);
    stoneBlob(p, 10, 2 + (v & 1) * 2, 24, 24, r);
    p.line(18, 8, 22, 22, S.o); p.line(22, 22, 20, 26, S.d);
    p.r(5, 22, 6, 1, S.d); p.r(32, 20, 7, 1, S.d);
    mossOver(p, r, 12, 2 + (v & 1) * 2, 20, 8, 0.6); mossOver(p, r, 2, 12, 18, 5, 0.5); mossOver(p, r, 26, 13, 18, 5, 0.5);
    ivyOn(p, r, 30, 6, 16); ivyOn(p, r, 8, 14, 12);
    fernTuft(p, r, 3, 30); fernTuft(p, r, 42, 30); tufts(p, r, 2, 30, 44, 10);
  }),
  // ---------- remains breaking the surface
  wallstub: (v, _alt, M) => M(34, 24, (p, r) => {
    p.r(2, 21, 30, 3, "rgba(0,0,0,0.3)");
    // two or three courses of dressed stone; the top is broken and uneven
    const tops = [5, 3, 6, 9, 4, 7, 11, 8][v & 7];
    for (let c = 0; c < 4; c++) {
      const bx = 2 + c * 8, top = c === 1 ? tops - 2 : tops + ((c * 5 + v * 3) % 4) * 2;
      for (let y = top; y < 21; y += 4) {
        const off = ((y >> 2) & 1) * 3;
        p.o(bx + off - 1, y, 9, 5, (c + (y >> 2)) & 1 ? "#6a645c" : "#5e5850", "#24201e");
        p.r(bx + off, y + 1, 7, 1, "#8a847a");
      }
    }
    // earth heaped against its foot, moss on the broken top, ivy hanging down
    for (let x = 0; x < 34; x++) { const h = 3 + Math.round(Math.sin(x * 0.4 + v) * 1.5 + r() * 2); p.r(x, 21 - h, 1, h, x & 1 ? "#5a4630" : "#6a5440"); p.p(x, 21 - h, "#4e7a3a"); }
    mossOver(p, r, 1, tops - 2, 32, 6, 0.6);
    ivyOn(p, r, 7 + (v & 1) * 12, tops, 12); ivyOn(p, r, 24 - (v & 1) * 10, tops + 2, 9);
    tufts(p, r, 0, 22, 34, 7);
  }),
  masonry: (v, _alt, M) => M(24, 20, (p, r) => {
    p.r(2, 17, 20, 3, "rgba(0,0,0,0.3)");
    // a dressed block, fallen and leaning, half sunk into the soil
    const lean = v & 1 ? 1 : -1;
    for (let y = 2; y < 16; y++) {
      const sh = Math.round(((y - 2) / 14) * 3 * lean), x0 = 4 + sh;
      p.r(x0, y, 15, 1, y === 2 ? "#24201e" : y < 6 ? "#8a847a" : "#6a645c");
      p.p(x0, y, "#24201e"); p.p(x0 + 14, y, "#24201e");
      if (y === 9) p.r(x0 + 2, y, 9, 1, "#4e4a44");
    }
    p.r(9, 6, 1, 6, "#4e4a44");
    for (let x = 1; x < 23; x++) { const h = 2 + ((r() * 3) | 0); p.r(x, 17 - h, 1, h, x & 1 ? "#5a4630" : "#6a5440"); }
    mossOver(p, r, 3, 2, 17, 6, 0.6); ivyOn(p, r, 6 + v * 3, 3, 10);
    tufts(p, r, 0, 18, 24, 6);
  }),
  stoneslab: (v, _alt, M) => M(30, 13, (p, r) => {
    // a paving slab lying flush with the turf, cracked across, grass creeping over its edges
    p.o(2, 2, 26, 9, "#6e685e", "#2a2420"); p.r(3, 3, 24, 1, "#8a847a");
    p.line(10 + v * 4, 2, 15 + v * 2, 10, "#2a2420"); p.p(16 + v * 2, 7, "#4e4a44");
    mossOver(p, r, 3, 3, 24, 7, 0.28);
    for (let x = 0; x < 30; x++) { if (r() < 0.45) p.p(x, 1 + ((r() * 2) | 0), "#4e7a3a"); if (r() < 0.55) p.p(x, 10 + ((r() * 2) | 0), r() < 0.5 ? "#3a5e2c" : "#628e44"); }
    tufts(p, r, 0, 12, 8, 3); tufts(p, r, 22, 12, 8, 3);
  }),
  cairn: (v, _alt, M) => M(18, 22, (p, r) => {
    p.r(2, 19, 14, 3, "rgba(0,0,0,0.3)");
    stoneBlob(p, 1, 13, 16, 8, r); stoneBlob(p, 3, 8, 12, 7, r); stoneBlob(p, 5, 4, 8, 6, r);
    if (v & 1) stoneBlob(p, 7, 1, 5, 4, r);
    mossOver(p, r, 2, 4, 14, 12, 0.35);
    tufts(p, r, 0, 21, 18, 5);
  }),
  standingstone: (v, _alt, M) => M(16, 32, (p, r) => {
    p.r(2, 29, 12, 3, "rgba(0,0,0,0.32)");
    const lean = v & 1 ? 1 : 0;
    for (let y = 2; y < 29; y++) {
      const w = y < 5 ? 6 + y : y > 24 ? 12 : 11, x0 = Math.round(8 - w / 2 + (lean * (29 - y)) / 9);
      p.r(x0, y, w, 1, "#24201e");
      p.r(x0 + 1, y, w - 2, 1, y < 6 ? "#8a8478" : (y * 7 + v) % 9 === 0 ? "#4e4a44" : "#6a645c");
      p.p(x0 + 1, y, "#8a8478"); p.p(x0 + w - 2, y, "#4e4a44");
    }
    for (let i = 0; i < 6; i++) p.p(5 + ((r() * 6) | 0), 8 + ((r() * 16) | 0), "#a0a070");
    mossOver(p, r, 3, 2, 10, 8, 0.45); mossOver(p, r, 2, 22, 12, 6, 0.5);
    ivyOn(p, r, 6 + lean * 2, 10, 18);
    tufts(p, r, 0, 31, 16, 6);
  }),
  statue_toppled: (v, _alt, M) => M(38, 18, (p, r) => {
    p.r(2, 15, 34, 3, "rgba(0,0,0,0.32)");
    // the body lies on its side, sunk to the shoulders; the head rolled clear
    p.o(4, 5, 22, 10, "#6a645c", "#24201e"); p.r(5, 6, 20, 2, "#8a847a");
    p.r(8, 9, 12, 1, "#4e4a44"); p.r(22, 7, 1, 7, "#4e4a44"); p.r(6, 12, 3, 2, "#5e5850");
    p.o(27, 8, 7, 7, "#6a645c", "#24201e"); p.r(28, 9, 5, 2, "#8a847a"); p.p(29, 11, "#24201e"); p.p(32, 11, "#24201e");
    if (v & 1) { p.r(4, 2, 4, 4, "#24201e"); p.r(5, 3, 2, 2, "#6a645c"); }
    for (let x = 0; x < 38; x++) { const h = 1 + ((r() * 3) | 0); p.r(x, 15 - h, 1, h, x & 1 ? "#5a4630" : "#6a5440"); }
    mossOver(p, r, 4, 5, 22, 5, 0.6); mossOver(p, r, 27, 8, 7, 3, 0.5);
    ivyOn(p, r, 12, 5, 9); ivyOn(p, r, 20, 6, 7);
    tufts(p, r, 0, 16, 38, 8);
  }),
  capstone: (v, _alt, M) => M(16, 10, (p, r) => {
    // the squared top of a buried block, just breaking the soil; grass laps its edges
    p.r(2, 3, 11, 5, "#24201e"); p.r(3, 3, 9, 3, "#6e685e"); p.r(3, 3, 9, 1, "#8a847a");
    if (v & 1) { p.p(11, 4, "#24201e"); p.p(3, 5, "#4e4a44"); }
    mossOver(p, r, 3, 3, 9, 3, 0.4);
    for (let x = 0; x < 16; x++) if (r() < 0.6) p.p(x, 7 + ((r() * 2) | 0), r() < 0.5 ? "#3a5e2c" : "#4e7a3a");
    tufts(p, r, 0, 9, 16, 4);
  }),
  // ---------- dungeon: the collapsed surface gate
  rockpile: (v, _alt, M) => M(26, 26, (p, r) => {
    p.r(2, 22, 22, 4, "rgba(0,0,0,0.45)");
    for (let i = 0; i < 6; i++) { const x = (r() * 20) | 0; p.r(x, 18 + ((r() * 5) | 0), 4, 2, r() < 0.5 ? "#4e3c2a" : "#5a4630"); }
    stoneBlob(p, 0, 12, 13, 11, r); stoneBlob(p, 12, 13, 13, 10, r);
    if (v % 3 === 0) { p.o(6, 6, 12, 8, "#5e5850", "#141016"); p.r(7, 7, 10, 1, "#7a7268"); p.r(11, 8, 1, 5, "#3e3a36"); }
    else stoneBlob(p, 5, 4 + (v & 1), 15, 12, r);
    stoneBlob(p, 3 + (v & 1) * 10, 1, 8, 6, r);
    for (let i = 0; i < 3; i++) { let x = 4 + ((r() * 18) | 0), y = 6 + ((r() * 8) | 0); for (let k = 0; k < 6; k++) { p.p(x, y, "#3e2c1a"); x += ((r() * 3) | 0) - 1; y += 1; } }
  }),
  torch: (_v, alt, M) => {
    return M(8, 16, (p) => {
      p.r(2, 12, 4, 2, IR.d); p.r(3, 9, 2, 4, IR.m);
      p.r(2, 5, 4, 3, IR.m); p.r(2, 5, 4, 1, IR.l);
      p.r(3, 2, 2, 4, WD.m); p.p(3, 2, WD.l);
      if (!alt) p.r(3, 1, 2, 2, "#120e0c");
      else p.g(3, 1, 2, 2, "#ff9a3a");
    });
  },
  banner: (v, _alt, M) => {
    return M(14, 16, (p, r) => {
      p.r(0, 1, 14, 1, IR.l); p.p(0, 0, IR.h); p.p(13, 0, IR.h);
      for (let y = 2; y < 15; y++)
        for (let x = 2; x < 12; x++) {
          let cut = 15;
          if (v === 0) cut = 13 + ((r() * 3) | 0) - (x % 3 === 0 ? 2 : 0);
          if (v === 1) cut = x < 7 ? 9 + ((r() * 2) | 0) : 14 - ((r() * 2) | 0);
          if (v === 2) cut = 4 + x;
          if (y > cut) continue;
          const border = x === 2 || x === 11;
          let c = border ? GD.d : y % 5 === 0 ? CL.d : CL.m;
          if (x === 3 || x === 10) c = CL.l;
          p.p(x, y, c);
        }
      // sigil: eye in triangle
      if (v !== 2) { p.r(6, 5, 2, 1, GD.m); p.r(5, 6, 4, 1, GD.m); p.r(4, 7, 6, 1, GD.d); p.p(6, 6, "#1a0808"); p.p(7, 6, "#1a0808"); }
    });
  },
  chains: (_v, _alt, M) => {
    return M(10, 16, (p) => {
      p.r(1, 1, 8, 2, IR.d);
      for (let j = 0; j < 5; j++) { p.p(2, 3 + j * 2, j % 2 ? IR.l : IR.m); p.p(7, 3 + j * 2, j % 2 ? IR.m : IR.l); }
      p.o(1, 12, 3, 3, IR.d, IR.l); p.o(6, 12, 3, 3, IR.d, IR.l);
    });
  },
  bookshelf: (v, _alt, M) => {
    return M(16, 28, (p, r) => {
      p.o(0, 0, 16, 28, WD.d, WD.o);
      p.r(1, 1, 14, 3, WD.l); p.r(1, 1, 14, 1, WD.h);
      for (let s = 0; s < 3; s++) {
        const y = 5 + s * 7;
        p.r(1, y, 14, 6, "#140c08");
        if (v === 1) {
          for (let k = 0; k < 3; k++) if (r() < 0.8) { const x = 2 + k * 4; p.r(x, y + 2, 3, 4, ["#3a5a4a", "#5a4a3a", "#4a4a6a"][k]); p.p(x + 1, y + 1, "#7a7a6a"); p.p(x, y + 3, "#8aa090"); }
        } else if (v === 3) {
          for (let k = 0; k < 3; k++) if (r() < 0.8) { const x = 2 + k * 4; p.r(x, y + 2, 3, 4, "#7a4a2a"); p.r(x, y + 2, 3, 1, "#9a6a40"); }
        } else books(p, 1, y + 1, 14, 5, r, v === 2 ? 0.35 : 0);
        p.r(1, y + 6, 14, 1, WD.m);
      }
      if (v === 2) { p.r(2, 14, 12, 1, "#140c08"); p.line(2, 13, 13, 18, WD.m); }
    });
  },
  shelfrow: (v, _alt, M) => {
    return M(16, 22, (p, r) => {
      p.o(0, 0, 16, 22, WD.d, WD.o);
      p.r(1, 1, 14, 4, WD.l); p.r(1, 1, 14, 1, WD.h);
      for (let s = 0; s < 2; s++) { const y = 6 + s * 7; p.r(1, y, 14, 6, "#140c08"); books(p, 1, y + 1, 14, 5, r, v * 0.12); p.r(1, y + 6, 14, 1, WD.m); }
    });
  },
  shelf_fallen: (_v, _alt, M) => {
    return M(34, 18, (p, r) => {
      for (let i = 0; i < 9; i++) { const c = ["#6a2a2a", "#2a3a6a", "#3a5a2a", "#6a5a2a"][(r() * 4) | 0]; const bx = (r() * 32) | 0, by = 11 + ((r() * 6) | 0); p.r(bx, by, 3, 2, c); p.p(bx, by, "#c0b090"); }
      p.o(2, 2, 30, 11, WD.m, WD.o);
      p.r(3, 3, 28, 2, WD.l);
      for (let x = 8; x < 30; x += 7) p.r(x, 3, 1, 9, WD.d);
      p.r(3, 12, 28, 1, WD.o);
    });
  },
  table: (v, _alt, M) => {
    return M(28, 16, (p) => {
      p.r(2, 11, 2, 5, WD.o); p.r(24, 11, 2, 5, WD.o);
      p.o(0, 0, 28, 12, WD.l, WD.o);
      p.r(1, 1, 26, 1, WD.h); p.r(1, 5, 26, 1, WD.m); p.r(1, 9, 26, 2, WD.d);
      if (v === 1) {
        p.r(4, 3, 8, 5, "#a89a7c"); p.r(8, 3, 1, 5, "#6a604c"); p.r(5, 4, 2, 1, "#5a5040"); p.r(9, 5, 2, 1, "#5a5040");
        p.r(20, 3, 3, 4, "#d8d0b8"); p.r(20, 7, 3, 1, "#8a826a");
      }
    });
  },
  lectern: (_v, _alt, M) => {
    return M(14, 22, (p) => {
      p.o(4, 9, 6, 11, S.m, S.o); p.r(5, 10, 1, 9, S.h);
      p.o(2, 19, 10, 3, S.l, S.o);
      p.o(0, 3, 14, 8, WD.m, WD.o); p.r(1, 4, 12, 2, WD.l);
      p.r(2, 5, 10, 4, "#9a8e72"); p.r(7, 5, 1, 4, "#6a604c");
    });
  },
  chair: (_v, _alt, M) => {
    return M(10, 14, (p) => {
      p.o(1, 0, 8, 6, WD.m, WD.o); p.r(2, 1, 6, 1, WD.l);
      p.o(0, 6, 10, 5, WD.l, WD.o);
      p.r(1, 11, 2, 3, WD.o); p.r(7, 11, 2, 3, WD.o);
    });
  },
  chair_fallen: (_v, _alt, M) => {
    return M(14, 10, (p) => {
      p.o(0, 3, 9, 6, WD.l, WD.o); p.o(8, 1, 6, 8, WD.m, WD.o); p.r(1, 2, 2, 2, WD.o); p.r(5, 1, 2, 2, WD.o);
    });
  },
  bed: (v, _alt, M) => {
    return M(16, 30, (p, r) => {
      p.o(0, 0, 16, 30, WD.m, WD.o);
      p.r(1, 1, 14, 2, WD.l);
      p.r(2, 3, 12, 25, "#4a4234");
      for (let i = 0; i < 20; i++) p.p(2 + ((r() * 12) | 0), 3 + ((r() * 25) | 0), "#3a3428");
      p.o(3, 3, 10, 5, "#6a6250", "#2a261e");
      for (let y = 11; y < 27; y++) for (let x = 2; x < 14; x++) {
        if (y > 22 && r() < 0.3) continue;
        p.p(x, y, (x + y) % 4 === 0 ? "#2a3444" : "#3a4658");
      }
      if (v === 1) { p.r(0, 14, 16, 2, WD.o); p.r(2, 15, 12, 1, "#1a1410"); }
      p.r(1, 28, 14, 1, WD.d);
    });
  },
  footlocker: (_v, alt, M) => {
    return M(14, 11, (p) => {
      if (alt) {
        p.o(1, 0, 12, 4, WD.d, WD.o);
        p.o(0, 3, 14, 8, WD.m, WD.o); p.r(1, 4, 12, 3, "#120c08");
        p.r(0, 8, 14, 1, IR.m);
      } else {
        p.o(0, 1, 14, 10, WD.m, WD.o);
        p.r(1, 2, 12, 3, WD.l); p.r(1, 5, 12, 1, WD.o);
        p.r(3, 1, 1, 10, IR.m); p.r(10, 1, 1, 10, IR.m);
        p.r(6, 5, 2, 2, GD.d);
      }
    });
  },
  weaponrack: (_v, _alt, M) => {
    return M(24, 22, (p) => {
      p.r(1, 2, 2, 20, WD.o); p.r(21, 2, 2, 20, WD.o);
      p.r(0, 4, 24, 2, WD.m); p.r(0, 15, 24, 2, WD.m); p.r(0, 4, 24, 1, WD.l);
      p.r(6, 0, 1, 20, WD.l); p.r(5, 0, 3, 3, IR.l); p.p(6, 0, IR.h);
      p.r(16, 3, 1, 17, WD.l); p.r(15, 2, 3, 2, "#6a4a3a");
      p.line(10, 6, 13, 19, IR.d);
    });
  },
  limbrack: (_v, alt, M) => {
    return M(22, 28, (p) => {
      p.r(1, 0, 3, 28, IR.d); p.r(18, 0, 3, 28, IR.d); p.r(1, 0, 1, 28, IR.l); p.r(18, 0, 1, 28, IR.l);
      p.r(0, 2, 22, 3, IR.m); p.r(0, 2, 22, 1, IR.l);
      p.r(0, 24, 22, 3, IR.d);
      for (const x of [7, 11, 15]) { p.r(x, 5, 1, 3, IR.l); p.p(x + 1, 7, IR.l); }
      if (alt) { p.p(7, 9, IR.m); p.p(7, 11, IR.d); p.p(15, 9, IR.m); }
    });
  },
  armorstand: (v, _alt, M) => {
    if (v === 1)
      return M(18, 10, (p) => {
        p.r(1, 6, 14, 2, WD.m); p.r(1, 6, 14, 1, WD.l);
        p.o(11, 1, 7, 6, IR.m, IR.d); p.r(12, 3, 5, 1, "#101010");
      });
    return M(12, 22, (p) => {
      p.r(5, 6, 2, 14, WD.m); p.r(1, 9, 10, 2, WD.m); p.r(2, 20, 8, 2, WD.d);
      p.o(3, 0, 6, 7, IR.m, IR.d); p.r(4, 3, 4, 1, "#101010"); p.p(4, 1, IR.h);
    });
  },
  barrel: (v, _alt, M) => {
    if (v === 1)
      return M(14, 12, (p) => {
        p.r(0, 8, 5, 3, WD.m); p.r(9, 9, 5, 2, WD.d);
        p.o(2, 2, 10, 8, WD.m, WD.o); p.r(3, 3, 8, 3, "#1a1008"); p.r(2, 6, 10, 1, IR.m);
      });
    return M(12, 15, (p) => {
      p.o(0, 2, 12, 13, WD.m, WD.o);
      p.r(1, 3, 2, 11, WD.l); p.r(9, 3, 2, 11, WD.d);
      p.r(0, 5, 12, 1, IR.m); p.r(0, 11, 12, 1, IR.m);
      p.o(1, 0, 10, 4, WD.l, WD.o); p.r(3, 1, 6, 1, WD.h);
    });
  },
  crate: (v, _alt, M) => {
    if (v === 1)
      return M(16, 14, (p) => {
        p.o(1, 3, 14, 11, WD.m, WD.o); p.r(2, 4, 12, 4, "#160e08");
        p.line(2, 9, 13, 13, WD.l);
        p.r(0, 1, 6, 2, WD.l); p.r(11, 2, 5, 1, WD.d);
      });
    return M(14, 15, (p) => {
      p.o(0, 4, 14, 11, WD.m, WD.o);
      p.line(1, 5, 12, 13, WD.l); p.line(12, 5, 1, 13, WD.d);
      p.o(0, 0, 14, 5, WD.l, WD.o); p.r(1, 2, 12, 1, WD.m);
    });
  },
  sack: (_v, _alt, M) => {
    return M(10, 9, (p) => {
      p.o(0, 2, 10, 7, "#7a6a48", "#2a2216"); p.r(1, 3, 3, 3, "#9a8a60"); p.r(3, 0, 4, 3, "#5a4a30");
    });
  },
  statue: (v, _alt, M) => {
    return M(20, 38, (p) => {
      // pedestal
      p.o(0, 28, 20, 10, S.l, S.o); p.r(1, 29, 18, 1, S.h); p.r(1, 32, 18, 1, S.m); p.r(1, 36, 18, 1, S.d);
      // legs
      p.o(4, 22, 5, 7, S.l, S.o); p.o(11, 22, 5, 7, S.l, S.o);
      // torso
      p.o(2, 10, 16, 13, S.l, S.o); p.r(3, 11, 14, 2, S.h); p.r(14, 13, 3, 9, S.m);
      p.r(8, 15, 4, 3, S.m);
      // arms + greatsword planted
      p.o(0, 11, 4, 11, S.l, S.o); p.o(16, 11, 4, 11, S.m, S.o);
      p.r(9, 16, 2, 22, IR.d); p.r(9, 16, 1, 22, IR.l); p.r(6, 20, 8, 2, IR.m);
      if (v === 1) {
        p.r(7, 8, 6, 3, S.d); p.p(8, 8, S.o); p.p(11, 9, S.o);
        p.p(10, 13, S.o); p.p(11, 14, S.o); p.p(11, 15, S.o); p.p(12, 16, S.o);
      } else {
        p.o(5, 3, 10, 9, S.l, S.o); p.r(6, 4, 8, 2, S.h); p.r(7, 7, 6, 1, "#1a1620"); p.r(12, 5, 2, 6, S.m);
      }
    });
  },
  statue_fallen: (v, _alt, M) => {
    return M(36, 18, (p, r) => {
      p.o(2, 4, 22, 12, S.l, S.o); p.r(3, 5, 20, 2, S.h); p.r(3, 13, 20, 2, S.d);
      p.o(0, 2, 6, 6, S.m, S.o); p.o(18, 0, 6, 5, S.l, S.o);
      p.p(10, 8, S.o); p.p(11, 9, S.o); p.p(12, 9, S.o); p.p(13, 10, S.o);
      if (v === 0) { p.o(27, 6, 9, 8, S.l, S.o); p.r(29, 9, 1, 4, "#1a1620"); p.r(28, 7, 7, 1, S.h); }
      stoneBlob(p, 24, 12, 5, 5, r); stoneBlob(p, 30, 13, 4, 4, r);
    });
  },
  throne: (_v, _alt, M) => {
    return M(32, 36, (p, r) => {
      p.o(0, 28, 32, 8, S.l, S.o); p.r(1, 29, 30, 1, S.h); p.r(1, 34, 30, 1, S.d);
      // back
      p.o(6, 0, 20, 22, S.m, S.o);
      p.r(7, 1, 18, 2, GD.d); p.r(8, 4, 16, 16, CL.d);
      for (let i = 0; i < 30; i++) p.p(8 + ((r() * 16) | 0), 4 + ((r() * 16) | 0), CL.m);
      p.r(7, 3, 1, 18, GD.m); p.r(24, 3, 1, 18, GD.d);
      p.r(15, 1, 2, 3, GD.l);
      // broken top-right chunk
      for (let x = 19; x < 26; x++) for (let y = 0; y < 26 - x; y++) p.r(x, y, 1, 1, "rgba(0,0,0,0)");
      p.ctx.clearRect(p.flip ? 0 : 19, 0, 7, 6);
      p.line(18, 0, 26, 7, S.o);
      p.line(12, 6, 16, 14, "#140808"); p.line(16, 14, 14, 19, "#140808");
      // seat
      p.o(3, 18, 26, 11, S.l, S.o); p.r(5, 19, 22, 6, CL.m); p.r(5, 19, 22, 1, CL.l); p.r(4, 26, 24, 1, GD.d);
      // armrests (right broken)
      p.o(0, 14, 6, 15, S.l, S.o); p.r(1, 15, 4, 1, GD.l);
      p.o(26, 22, 6, 7, S.d, S.o);
      p.r(1, 2, 1, 1, S.o);
    });
  },
  maptable: (_v, alt, M) => {
    return M(30, 18, (p) => {
      p.r(3, 12, 2, 6, WD.o); p.r(25, 12, 2, 6, WD.o);
      p.o(0, 0, 30, 13, WD.l, WD.o); p.r(1, 11, 28, 1, WD.d);
      if (!alt) {
        p.r(3, 2, 14, 8, "#2a4a7a"); p.r(4, 3, 12, 6, "#34588a");
        for (let i = 0; i < 4; i++) p.r(5 + i * 3, 4, 1, 4, "#a8c0e0");
        p.r(5, 4, 10, 1, "#a8c0e0"); p.r(5, 7, 10, 1, "#a8c0e0");
        p.r(19, 3, 9, 2, "#3a5a9a"); p.r(19, 3, 1, 2, "#d0d8e8"); p.r(27, 3, 1, 2, "#d0d8e8");
      } else {
        p.r(4, 3, 5, 4, "#8a7e64"); p.r(18, 6, 4, 3, "#7a6e54"); p.r(12, 2, 2, 2, "#141414");
      }
    });
  },
  altar: (_v, _alt, M) => {
    return M(30, 20, (p) => {
      p.o(0, 4, 30, 16, S.l, S.o); p.r(1, 5, 28, 4, S.h); p.r(1, 17, 28, 2, S.d);
      p.r(10, 5, 10, 14, CL.m); p.r(10, 5, 10, 1, CL.l); p.r(10, 17, 10, 2, GD.d); p.r(14, 11, 2, 4, GD.m); p.r(13, 12, 4, 1, GD.m);
      for (const x of [3, 6, 24]) { p.r(x, 1, 2, 5, "#d8d0b0"); p.g(x, 0, 1, 1, "#ffb050"); p.g(x + 1, 0, 1, 1, "#ffe090"); }
      p.r(26, 3, 2, 3, "#c8c0a0");
    });
  },
  pew: (_v, _alt, M) => {
    return M(38, 13, (p) => {
      p.o(0, 0, 38, 5, WD.m, WD.o); p.r(1, 1, 36, 1, WD.l);
      p.o(0, 5, 38, 5, WD.l, WD.o);
      p.r(2, 10, 2, 3, WD.o); p.r(34, 10, 2, 3, WD.o); p.r(18, 10, 2, 3, WD.o);
    });
  },
  workbench: (_v, _alt, M) => {
    return M(32, 30, (p) => {
      p.o(2, 0, 28, 10, WD.d, WD.o);
      p.r(5, 2, 1, 6, IR.l); p.r(4, 2, 3, 2, IR.m);
      p.r(10, 2, 1, 6, WD.l); p.r(9, 2, 3, 1, IR.l);
      p.r(15, 3, 4, 4, "#0e0a08"); p.r(15, 3, 4, 1, IR.m);
      p.line(22, 2, 26, 7, IR.l);
      p.r(3, 24, 2, 6, WD.o); p.r(27, 24, 2, 6, WD.o);
      p.o(0, 10, 32, 15, WD.l, WD.o); p.r(1, 11, 30, 1, WD.h); p.r(1, 22, 30, 2, WD.d);
      p.r(1, 17, 30, 1, WD.m);
      p.o(24, 12, 6, 5, IR.m, IR.d);
      p.r(3, 13, 6, 2, "#9a907a"); p.r(4, 18, 3, 3, IR.d);
    });
  },
  forge: (_v, _alt, M) => {
    return M(32, 30, (p) => {
      p.o(6, 0, 20, 10, S.m, S.o); p.r(7, 1, 18, 1, S.h); p.r(8, 8, 16, 2, S.d);
      p.o(0, 10, 32, 18, S.l, S.o); p.r(1, 11, 30, 2, S.h);
      p.r(7, 14, 18, 8, "#0c0808");
      for (const [x, y, c] of [[9, 20, "#7a2a08"], [12, 21, "#c24a10"], [14, 20, "#5a1e06"], [17, 21, "#a03a0a"], [20, 20, "#7a2a08"], [22, 21, "#5a1e06"], [11, 21, "#ff7a20"]] as [number, number, string][]) p.g(x, y, 1, 1, c);
      p.r(1, 25, 30, 2, S.d);
      p.o(26, 18, 6, 9, "#4a3020", WD.o); p.r(27, 19, 4, 1, "#6a4a30");
    });
  },
  anvil: (_v, _alt, M) => {
    return M(16, 12, (p) => {
      p.o(4, 6, 8, 6, WD.m, WD.o);
      p.o(0, 0, 16, 5, IR.m, "#14161a"); p.r(1, 1, 14, 1, IR.h); p.r(0, 2, 3, 2, IR.d);
      p.o(5, 4, 6, 3, IR.d, "#14161a");
    });
  },
  cradle: (_v, _alt, M) => {
    return M(30, 34, (p, r) => {
      p.o(0, 30, 30, 4, S.m, S.o); p.r(4, 31, 22, 1, S.h);
      p.r(2, 0, 3, 31, IR.d); p.r(2, 0, 1, 31, IR.l);
      p.r(25, 0, 3, 31, IR.d); p.r(25, 0, 1, 31, IR.l);
      p.r(0, 2, 30, 3, IR.m); p.r(0, 2, 30, 1, IR.h);
      for (const x of [9, 20]) {
        const len = 6 + ((r() * 8) | 0);
        for (let j = 0; j < len; j++) p.p(x, 5 + j, j % 2 ? IR.l : IR.m);
        p.o(x - 1, 5 + len, 3, 3, IR.d, IR.l);
      }
      p.r(13, 5, 1, 4, IR.m); p.r(16, 5, 1, 3, IR.m);
    });
  },
  slab: (_v, _alt, M) => {
    return M(38, 20, (p) => {
      p.r(3, 14, 3, 6, S.o); p.r(32, 14, 3, 6, S.o);
      p.o(0, 4, 38, 12, S.l, S.o); p.r(1, 5, 36, 1, S.h); p.r(1, 13, 36, 2, S.d);
      // husk of a golem lying down
      p.o(9, 2, 18, 10, "#5a5650", "#24221f"); p.r(10, 3, 16, 2, "#7a756c");
      p.o(26, 3, 8, 8, "#5a5650", "#24221f"); p.r(27, 6, 1, 3, "#101010");
      p.o(4, 4, 6, 4, "#4a4640", "#24221f");
      p.line(14, 4, 18, 10, "#24221f"); p.line(18, 10, 21, 9, "#24221f");
      p.r(17, 6, 2, 2, "#1a1410");
    });
  },
  parts: (_v, _alt, M) => {
    return M(20, 12, (p, r) => {
      stoneBlob(p, 0, 5, 7, 6, r);
      p.o(5, 1, 8, 7, "#5a5650", "#24221f"); p.r(7, 4, 4, 1, "#101010"); p.r(6, 2, 6, 1, "#7a756c");
      p.o(12, 6, 8, 5, "#5a5650", "#24221f"); p.r(13, 7, 2, 1, "#7a756c"); p.r(17, 9, 1, 2, "#24221f");
      p.r(2, 9, 6, 1, IR.d);
    });
  },
  hearth: (_v, alt, M) => {
    return M(36, 28, (p, r) => {
      p.o(0, 2, 36, 26, S.m, S.o);
      for (let j = 0; j < 6; j++) for (let i = 0; i < 5; i++) { const bx = 1 + i * 7 + (j % 2 ? 3 : 0), by = 3 + j * 4; p.r(bx, by, 6, 3, r() < 0.5 ? S.l : S.m); }
      p.o(0, 0, 36, 4, S.l, S.o); p.r(1, 1, 34, 1, S.h);
      p.r(8, 9, 20, 17, "#080606"); p.r(9, 8, 18, 1, "#080606");
      p.r(9, 21, 18, 4, "#3a3634");
      for (let i = 0; i < 16; i++) p.p(9 + ((r() * 18) | 0), 21 + ((r() * 4) | 0), r() < 0.5 ? "#55504c" : "#2a2624");
      p.r(11, 20, 8, 2, WD.o); p.r(16, 19, 9, 2, "#1e140c");
      if (!alt) for (const [x, y, c] of [[12, 22, "#8a2e08"], [15, 23, "#c4500c"], [19, 22, "#6a2206"], [22, 23, "#a8400c"], [17, 21, "#ff8a2a"]] as [number, number, string][]) p.g(x, y, 1, 1, c);
      p.r(1, 26, 34, 2, S.d);
    });
  },
  longtable: (_v, _alt, M) => {
    return M(52, 17, (p) => {
      p.r(3, 12, 2, 5, WD.o); p.r(47, 12, 2, 5, WD.o); p.r(25, 12, 2, 5, WD.o);
      p.o(0, 0, 52, 13, WD.l, WD.o); p.r(1, 1, 50, 1, WD.h); p.r(1, 6, 50, 1, WD.m); p.r(1, 10, 50, 2, WD.d);
      for (const x of [6, 18, 34, 44]) { p.r(x, 3, 5, 3, IR.l); p.r(x + 1, 4, 3, 1, IR.d); }
      p.r(28, 7, 3, 2, IR.m); p.r(39, 2, 2, 2, "#7a4a2a");
    });
  },
  bench: (_v, _alt, M) => {
    return M(46, 7, (p) => {
      p.o(0, 0, 46, 4, WD.m, WD.o); p.r(1, 1, 44, 1, WD.l); p.r(2, 4, 2, 3, WD.o); p.r(42, 4, 2, 3, WD.o);
    });
  },
  chest: (v, alt, M) => {
    if (v === 2)
      return M(20, 14, (p) => {
        p.o(0, 4, 14, 10, WD.m, WD.o); p.r(1, 5, 12, 4, "#120c08"); p.r(0, 10, 14, 1, IR.m);
        p.o(13, 6, 7, 7, WD.d, WD.o); p.r(14, 8, 5, 1, IR.m);
      });
    return M(16, 14, (p) => {
      if (alt) {
        p.o(0, 0, 16, 5, WD.d, WD.o); p.r(1, 1, 14, 1, IR.m);
        p.o(0, 4, 16, 10, WD.m, WD.o); p.r(1, 5, 14, 4, "#0e0806");
        p.r(0, 10, 16, 1, IR.m); p.r(3, 4, 1, 10, IR.m); p.r(12, 4, 1, 10, IR.m);
      } else {
        p.o(0, 2, 16, 12, WD.m, WD.o);
        p.r(1, 3, 14, 4, WD.l); p.r(1, 3, 14, 1, WD.h); p.r(0, 7, 16, 1, WD.o);
        p.r(3, 2, 1, 12, IR.m); p.r(12, 2, 1, 12, IR.m);
        p.o(6, 6, 4, 4, GD.m, "#3a2a08"); p.p(7, 8, "#000");
      }
    });
  },
  pot: (v, _alt, M) => {
    if (v === 1)
      return M(14, 8, (p) => {
        p.r(1, 4, 4, 3, "#7a4a2a"); p.r(6, 5, 3, 2, "#5a3420"); p.r(10, 3, 3, 4, "#7a4a2a"); p.p(10, 3, "#9a6a40");
      });
    return M(10, 12, (p) => {
      p.o(0, 3, 10, 9, "#7a4a2a", "#24140a"); p.r(1, 4, 3, 5, "#9a6a40"); p.r(6, 5, 3, 6, "#5a3420");
      p.o(2, 0, 6, 4, "#6a3e22", "#24140a"); p.r(3, 1, 4, 1, "#1a0e06");
    });
  },
  brazier: (v, alt, M) => {
    return M(14, 18, (p) => {
      p.r(2, 9, 1, 8, IR.d); p.r(11, 9, 1, 8, IR.d); p.r(6, 10, 2, 8, IR.d);
      p.o(0, 4, 14, 6, IR.m, "#121418"); p.r(1, 5, 12, 1, IR.l);
      if (alt) { p.g(2, 3, 10, 2, "#c84a10"); p.g(3, 3, 3, 1, "#ffb040"); p.g(8, 3, 2, 1, "#ff8020"); }
      else { p.r(2, 3, 10, 2, "#3a3634"); p.p(5, 3, "#55504c"); }
      if (v === 1) p.r(0, 16, 14, 2, "rgba(0,0,0,0)");
    });
  },
  fountain: (_v, _alt, M) => {
    return M(34, 24, (p, r) => {
      for (let y = 0; y < 18; y++) for (let x = 0; x < 34; x++) {
        const dx = (x - 16.5) / 17, dy = (y - 10) / 8;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        let c = d > 0.62 ? (dy < 0 ? S.h : S.l) : d > 0.5 ? S.o : "#2a2620";
        if (c === "#2a2620" && r() < 0.15) c = "#3a3428";
        if (d <= 0.5 && r() < 0.04) c = "#3e4a2a";
        p.p(x, y + 4, c);
      }
      p.r(0, 14, 34, 1, "rgba(0,0,0,0)");
      p.o(13, 4, 8, 10, S.l, S.o); p.r(14, 5, 6, 1, S.h);
      p.o(15, 0, 4, 5, S.m, S.o);
      p.r(2, 18, 30, 2, S.d); p.p(18, 10, S.o); p.p(19, 11, S.o);
    });
  },
  pedestal: (_v, _alt, M) => {
    return M(12, 16, (p) => {
      p.o(0, 12, 12, 4, S.l, S.o);
      p.o(2, 4, 8, 9, S.m, S.o); p.r(3, 5, 2, 7, S.h);
      p.o(0, 1, 12, 4, S.l, S.o); p.r(3, 2, 6, 2, "#141016");
    });
  },
  mushrooms: (_v, _alt, M) => {
    return M(12, 10, (p) => {
      for (const [x, y, s] of [[1, 4, 3], [5, 1, 4], [8, 5, 3]] as [number, number, number][]) {
        p.r(x + 1, y + 2, 1, 10 - y - 3, "#a8b8a8");
        p.g(x, y, s, 2, "#2aa890"); p.g(x + 1, y, s - 2 || 1, 1, "#7ff8e0");
      }
    });
  },
  skeleton: (v, _alt, M) => {
    return M(18, 14, (p) => {
      p.r(7, 0, 4, 4, BN.l); p.p(8, 1, "#1a1410"); p.p(10, 1, "#1a1410"); p.r(8, 3, 2, 1, BN.d);
      for (let j = 0; j < 4; j++) p.r(6, 5 + j * 2, 6, 1, BN.m);
      p.r(8, 4, 1, 8, BN.d);
      p.r(3, 5, 1, 5, BN.m); p.r(14, 5, 1, 5, BN.m);
      p.r(5, 12, 8, 1, BN.m); p.r(4, 13, 3, 1, BN.l); p.r(11, 13, 4, 1, BN.l);
      if (v === 2) { p.r(2, 0, 1, 6, IR.m); p.r(15, 0, 1, 6, IR.m); p.r(1, 5, 3, 2, IR.d); p.r(14, 5, 3, 2, IR.d); }
      if (v === 1) { p.r(13, 10, 4, 3, "#9a907a"); p.r(14, 11, 2, 1, "#5a5040"); }
    });
  },
  candles: (v, _alt, M) => {
    return M(10, 6, (p) => {
      p.r(1, 2, 2, 4, "#c8c0a0"); p.r(5, 0, 2, 6, "#d8d0b0"); p.r(8, 3, 2, 3, "#b8b090");
      p.p(5, 0, "#2a2420"); p.p(1, 2, "#2a2420");
      if (v === 1) p.r(0, 5, 10, 1, "#a8a080");
    });
  },
  ladder: (_v, _alt, M) => {
    return M(12, 30, (p) => {
      p.r(1, 0, 2, 30, WD.m); p.r(9, 0, 2, 30, WD.m); p.r(1, 0, 1, 30, WD.l);
      for (let y = 3; y < 30; y += 5) p.r(3, y, 6, 1, WD.l);
      p.r(3, 13, 6, 1, "rgba(0,0,0,0)");
    });
  },
  bucket: (_v, _alt, M) => {
    return M(8, 8, (p) => {
      p.o(0, 2, 8, 6, WD.m, WD.o); p.r(0, 4, 8, 1, IR.m); p.r(1, 2, 6, 1, "#100c08"); p.r(2, 0, 4, 1, IR.l);
    });
  },
};

function makeProp(kind: string, v: number, alt: boolean): Sprite | null {
  const seed = kind.length * 101 + v * 13 + (alt ? 7 : 0);
  const M = (w: number, h: number, fn: (p: Pen, r: Rng) => void, ay = h) => makeSprite(w, h, Math.floor(w / 2), ay, seed, fn);
  const art = PROP_ART[kind];
  return art ? art(v, alt, M) : null;
}

// ---------------- Items ----------------
export function glyphPattern(p: Pen, gi: number, x: number, y: number, color: string, glow: boolean) {
  const pat = GLYPHS[gi].pat;
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (pat[j][i] === "#") glow ? p.g(x + i, y + j, 1, 1, color) : p.p(x + i, y + j, color);
}

/** Draws one 16x16 item icon. */
export type ItemArt = (p: Pen) => void;

const glyphIcon = (gi: number): ItemArt => (p) => {
  const g = GLYPHS[gi];
  p.o(2, 3, 12, 12, "#4a4552", S.o); p.r(3, 4, 10, 2, "#6a6372"); p.r(3, 12, 10, 2, "#2e2a33");
  glyphPattern(p, gi, 4, 5, g.color, true);
};

/** Item icon registry: item id -> draw function. Adding an item = adding an entry. */
export const ITEM_ART: Record<ItemId, ItemArt> = {
  chisel: (p) => {
    p.r(3, 11, 6, 3, "#14100c"); p.r(4, 12, 4, 1, WD.l);
    p.line(4, 12, 10, 6, WD.m); p.line(5, 12, 11, 6, WD.l);
    p.line(10, 6, 13, 3, IR.l); p.line(11, 6, 14, 3, IR.h); p.p(14, 2, "#e0e8f0");
    p.r(9, 6, 2, 2, IR.d);
  },
  arm: (p) => {
    p.o(5, 0, 6, 5, IR.m, "#14161a"); p.p(6, 1, IR.h); p.p(9, 1, IR.h);
    p.o(6, 4, 4, 6, IR.l, "#14161a"); p.p(7, 6, IR.h);
    p.o(5, 9, 6, 3, IR.d, "#14161a");
    p.o(4, 11, 8, 5, IR.m, "#14161a"); p.r(5, 12, 2, 2, IR.h); p.r(9, 14, 2, 1, IR.d);
    p.p(8, 2, "#c06020"); p.p(7, 7, "#c06020");
  },
  key: (p) => {
    p.o(2, 3, 6, 6, "#7a5a34", "#2a1a0c"); p.r(4, 5, 2, 2, "#2a1a0c");
    p.r(7, 5, 7, 2, "#8a6a3a"); p.r(7, 5, 7, 1, "#a8844a");
    p.r(11, 7, 1, 3, "#7a5a34"); p.r(13, 7, 1, 2, "#7a5a34"); p.p(9, 6, "#4a3418");
  },
  core: (p) => {
    p.r(5, 13, 6, 2, "#1a1a28");
    p.g(7, 2, 2, 1, "#c0ffff"); p.g(6, 3, 4, 2, "#60e0ff"); p.g(5, 5, 6, 4, "#30a8e8"); p.g(6, 9, 4, 2, "#2080c0"); p.g(7, 11, 2, 2, "#1860a0");
    p.g(7, 4, 1, 4, "#e0ffff"); p.g(9, 6, 1, 2, "#a0f0ff");
  },
  schematic: (p) => {
    p.o(1, 4, 14, 8, "#2a4a7a", "#0e1a2e"); p.r(2, 5, 12, 2, "#3a5a9a");
    p.r(0, 4, 2, 8, "#d0d8e8"); p.r(14, 4, 2, 8, "#d0d8e8"); p.r(0, 4, 1, 8, "#8a98b0");
    p.r(4, 8, 7, 1, "#8aa8d8"); p.r(4, 10, 5, 1, "#8aa8d8"); p.r(7, 7, 1, 4, "#8aa8d8");
    p.r(6, 3, 4, 10, "#6a2020"); p.r(6, 3, 4, 1, "#8a3030");
  },
  crown: (p) => {
    p.r(2, 11, 12, 3, GD.m); p.r(2, 13, 12, 1, GD.d); p.r(2, 11, 12, 1, GD.l);
    for (const x of [2, 7, 12]) { p.r(x, 6, 2, 5, GD.m); p.p(x, 6, GD.l); }
    p.r(4, 9, 3, 2, GD.d); p.p(7, 12, "#c02030"); p.p(4, 12, "#2040c0");
    p.r(10, 7, 2, 3, "rgba(0,0,0,0)"); p.line(9, 11, 11, 13, "#3a2a08");
  },
  goblet: (p) => {
    p.o(4, 2, 8, 6, IR.l, "#2a2e34"); p.r(5, 3, 2, 3, IR.h);
    p.r(7, 8, 2, 4, IR.m); p.o(4, 12, 8, 3, IR.l, "#2a2e34");
  },
  coin: (p) => {
    p.o(5, 7, 7, 7, GD.m, "#3a2a08"); p.r(6, 8, 2, 2, GD.l); p.r(8, 10, 2, 2, GD.d);
  },
  glyph0: glyphIcon(0), glyph1: glyphIcon(1), glyph2: glyphIcon(2), glyph3: glyphIcon(3),
  wood: (p) => {
    // two stacked logs
    for (const [x, y] of [[2, 9], [5, 5]] as [number, number][]) {
      p.o(x, y, 10, 5, WD.m, WD.o); p.r(x + 1, y + 1, 8, 1, WD.l);
      p.o(x + 8, y, 4, 5, "#b08a5a", WD.o); p.p(x + 9, y + 2, WD.d);
    }
  },
  stone: (p) => {
    p.o(2, 8, 7, 6, S.m, S.o); p.r(3, 9, 3, 1, S.h); p.r(3, 12, 5, 1, S.d);
    p.o(7, 5, 7, 8, S.l, S.o); p.r(8, 6, 3, 1, S.h); p.r(12, 7, 1, 5, S.d);
  },
  book_build: (p) => {
    p.o(2, 4, 12, 10, "#6a4a24", "#1a1008"); p.r(3, 5, 10, 1, "#8a6a34"); p.r(2, 12, 12, 2, "#d8ccb0"); p.r(3, 12, 10, 1, "#b8ac90");
    p.r(6, 7, 4, 1, GD.m); p.r(7, 8, 2, 3, GD.m); // hammer sigil
  },
  book_repair: (p) => {
    p.o(2, 4, 12, 10, "#2a4a5a", "#08141a"); p.r(3, 5, 10, 1, "#3a6a7a"); p.r(2, 12, 12, 2, "#d8ccb0"); p.r(3, 12, 10, 1, "#b8ac90");
    p.r(7, 6, 2, 5, "#a8c8d0"); p.r(5, 8, 6, 1, "#a8c8d0"); // mending cross
  },
  basket: (p) => {
    p.r(4, 2, 8, 1, WD.d); p.r(3, 3, 1, 4, WD.d); p.r(12, 3, 1, 4, WD.d);
    p.o(2, 6, 12, 9, "#a8844a", WD.o);
    for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) if ((x + y * 2) % 4 === 0) p.p(x, y, "#7a5a30");
    p.r(3, 7, 10, 1, "#c8a466");
  },
};

export function itemIcon(id: ItemId): Sprite {
  return cached("item" + id, () => makeSprite(16, 16, 8, 15, 3, (p) => ITEM_ART[id](p)));
}
