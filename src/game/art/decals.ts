// Decals: everything painted flat onto the baked background (dungeon debris,
// carpets, puddles, the surface's humps, ridges, moss, leaves, roots...).
// bakeRegion (art/tiles.ts) draws the ones whose bounds reach the baked region.
// Presentation only.
import type { DecalDef } from "../map";
import { hash2, Pen, Rng, mulberry } from "../util";
import { S, WD, IR, CL, GD, BN } from "./palette";

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
export function decalBounds(decals: DecalDef[]): Float32Array {
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

export function drawDecal(p: Pen, dc: DecalDef) {
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
