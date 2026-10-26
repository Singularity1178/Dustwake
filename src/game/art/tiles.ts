// Tiles: the background bake (floors, walls, surface ground, thicket, plus the
// decal pass over them) and the sprites that stand on tiles and depth-sort with
// props (rubble, the cracked wall, pillars, the locked door, gaol bars).
// Presentation only.
import type { MapData } from "../map";
import { TS, T, FS, isWallMassT, isGroundFS } from "../content/tiles";
import { hash2, makeSprite, Sprite, Pen, clamp } from "../util";
import { S, WD, IR, GD } from "./palette";
import { cached, stoneBlob } from "./common";
import { decalBounds, drawDecal } from "./decals";

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

// ---------------- Tile sprites ----------------
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
