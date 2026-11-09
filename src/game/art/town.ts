// Town art that is painted flat into the baked background: whole buildings
// (roof and street front, drawn once per building from its row in
// content/town.ts and cached) and the town's ground decals (rugs, cart ruts,
// the flat-footed tracks of labour golems, garden plots, straw...).
// art/decals.ts hands every decal here first. Presentation only.
//
// A building is seen the way the dungeon's walls are: from the south and above.
// The bottom 32 px of its footprint are the street front (plinth, door, a row
// of windows, a smaller row under the eave); everything above is roof. Lit
// windows, signs and lamps are props laid over this by the builder, because
// only sprites can glow.
import type { DecalDef } from "../map";
import { hash2, makeCanvas, mulberry, shade, Pen, type Rng } from "../util";
import { IR, GD } from "./palette";
import { BUILDINGS, DOOR, FRONT_H, UPWIN, WIN, chimneyPx, dormerPx, ridgeY, roofH, type Building, type RoofKind } from "../content/town";

const OUT = "#141016";
/** Roof ramps: outline, dark, mid, light, highlight. Two weatherings each. */
const ROOF: Record<RoofKind, string[][]> = {
  slate: [["#15171c", "#2b3038", "#3c444e", "#4d5763", "#62707e"], ["#17161c", "#2e2c38", "#403e4e", "#524f63", "#69667c"]],
  tile: [["#1e0f0b", "#5a2618", "#7c3a22", "#96492a", "#b05c36"], ["#1e120b", "#5e3018", "#804522", "#9a562a", "#b46a3a"]],
  thatch: [["#1c160a", "#5c4a22", "#7e6a30", "#9a843e", "#b8a252"], ["#1a160c", "#544a2a", "#746838", "#8e8046", "#aa9c5a"]],
  shingle: [["#16120e", "#3a2e24", "#52412f", "#68553c", "#80694a"], ["#15130f", "#35302a", "#4a4438", "#5e5746", "#766d58"]],
  flat: [["#141016", "#3a3640", "#55505a", "#6c6672", "#88828e"]],
};
const PLASTER = ["#c9bc98", "#c8a870", "#c4a694", "#cdc6b6", "#aeb48e", "#a6b0ba"];
const PAINT = ["#6e2a2a", "#2e4a6a", "#3a5a3a", "#7a5e24", "#4a3266", "#2e5a5a"];
const STONE = ["#8c8478", "#868a90", "#9a8c72", "#9c968c", "#7c7880"];
const BEAM = { d: "#2a1c12", m: "#3e2a1a", l: "#573a22" };
const GLASS = "#18222e";
const MOSS = ["#2e4a22", "#3e5e2a", "#527636", "#6e8e34"];

// ---------------------------------------------------------------- roofs
/** Courses of slates, tiles or shingles over a rect. `sh` shifts the ramp: -1 a slope in shade, 0 lit. */
function courses(p: Pen, x0: number, y0: number, w: number, h: number, pal: string[], seed: number, sh: number) {
  p.r(x0, y0, w, h, pal[2 + sh]);
  for (let j = 0, y = y0; y < y0 + h; j++, y += 4) {
    const bh = Math.min(4, y0 + h - y);
    p.r(x0, y, w, 1, pal[3 + sh]);
    if (bh > 3) p.r(x0, y + 3, w, 1, pal[1 + sh]);
    for (let x = x0 + (j & 1 ? 3 : 0); x < x0 + w; x += 6) {
      p.r(x, y + 1, 1, Math.min(2, bh - 1), pal[1 + sh]);
      const k = hash2(x, y, seed), tw = Math.min(4, x0 + w - x - 1);
      if (k < 0.12) p.r(x + 1, y + 1, tw, Math.min(2, bh - 1), pal[1 + sh]);
      else if (k > 0.86) p.r(x + 1, y + 1, tw, Math.min(2, bh - 1), pal[3 + sh]);
    }
  }
}
/** Thatch: long streaks of straw running down the slope. */
function thatch(p: Pen, x0: number, y0: number, w: number, h: number, pal: string[], seed: number, sh: number) {
  for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h;) {
    const run = 3 + Math.floor(hash2(x, y, seed) * 7);
    const c = pal[Math.min(4, Math.max(1, 1 + sh + Math.floor(hash2(x, y, seed + 1) * 3)))];
    p.r(x, y, 1, Math.min(run, y0 + h - y), c);
    y += run;
  }
}

/** Ridge east-west: a strip of the far slope, the ridge, then the long slope down to the eave over the street. */
function roofEW(p: Pen, b: Building, W: number, RH: number, pal: string[], seed: number) {
  const ridge = ridgeY(b), cover = b.roof === "thatch" ? thatch : courses;
  cover(p, 0, 0, W, ridge, pal, seed, -1);
  cover(p, 0, ridge, W, RH + 2 - ridge, pal, seed + 7, 0);
  p.r(0, ridge - 1, W, 1, pal[0]); p.r(0, ridge, W, 1, pal[4]); p.r(0, ridge + 1, W, 1, pal[3]);
  if (b.roof === "thatch") {
    // hazel spars pinning the ridge and the eave course
    for (let x = 3; x < W - 4; x += 6) { p.p(x, ridge + 3, pal[1]); p.p(x + 1, ridge + 4, pal[1]); p.p(x + 2, ridge + 3, pal[1]); p.p(x + 1, ridge + 2, pal[1]); }
    for (let x = 2; x < W - 2; x += 3) p.p(x, RH - 4, pal[1]);
    for (let x = 1; x < W - 1; x++) if (hash2(x, seed, 91) < 0.5) p.p(x, RH + 2, pal[2]);
  }
  // bargeboards on the gable ends, the dark line under the eave
  p.r(1, 0, 2, RH + 2, BEAM.m); p.r(1, 0, 1, RH + 2, BEAM.l); p.r(W - 3, 0, 2, RH + 2, BEAM.d);
  p.r(0, 0, 1, RH + 3, OUT); p.r(W - 1, 0, 1, RH + 3, OUT); p.r(0, 0, W, 1, OUT);
  p.r(0, RH + 2, W, 1, OUT);
  p.r(1, RH + 3, W - 2, 3, "rgba(0,0,0,0.34)");
}

/** Ridge north-south: two slopes falling away east and west, a gable turned to the street. */
function roofNS(p: Pen, b: Building, W: number, RH: number, pal: string[], seed: number) {
  const cx = W >> 1;
  if (b.roof === "thatch") { thatch(p, 0, 0, cx, RH, pal, seed, 0); thatch(p, cx, 0, W - cx, RH, pal, seed + 3, -1); }
  else for (let x = 0; x < W; x += 4) {
    const sh = x < cx ? 0 : -1;
    p.r(x, 0, 4, RH, pal[2 + sh]); p.r(x, 0, 1, RH, pal[3 + sh]); p.r(x + 3, 0, 1, RH, pal[1 + sh]);
    for (let y = (x >> 2) & 1 ? 3 : 0; y < RH; y += 6) {
      p.r(x + 1, y, 2, 1, pal[1 + sh]);
      const k = hash2(x, y, seed);
      if (k < 0.12) p.r(x + 1, y + 1, 2, 4, pal[1 + sh]); else if (k > 0.86) p.r(x + 1, y + 1, 2, 4, pal[3 + sh]);
    }
  }
  p.r(cx - 1, 0, 1, RH, pal[4]); p.r(cx, 0, 1, RH, pal[0]);
  p.r(0, 0, W, 1, OUT); p.r(0, 0, 1, RH, OUT); p.r(W - 1, 0, 1, RH, OUT);
}

/** The gable of a north-south roof: a triangle of wall rising in front of the slopes, with an attic window. */
function gable(p: Pen, b: Building, W: number, RH: number, wall: string) {
  const cx = W >> 1, G = Math.max(10, Math.min(RH - 8, Math.round(W * 0.2)));
  for (let y = RH - G; y <= RH; y++) {
    const hw = Math.round(((y - (RH - G)) / G) * (cx - 1));
    p.r(cx - hw, y, hw * 2, 1, b.wall === "stone" && (y & 3) === 3 ? shade(wall, 0.62) : wall);
    p.r(cx - hw - 2, y, 3, 1, BEAM.d); p.r(cx + hw - 1, y, 3, 1, BEAM.d);
    p.p(cx - hw - 2, y, BEAM.l);
  }
  if (b.wall !== "stone") { p.r(cx - 1, RH - G + 2, 2, G - 2, BEAM.m); p.r(cx - Math.round(cx * 0.45), RH - Math.round(G * 0.45), Math.round(cx * 0.9), 1, BEAM.m); }
  const wy = RH - Math.round(G * 0.42);
  p.r(cx - 3, wy - 3, 6, 6, BEAM.d); p.r(cx - 2, wy - 2, 4, 4, GLASS); p.p(cx - 1, wy - 1, "#3a5068");
  p.r(0, RH, W, 2, BEAM.m); p.r(0, RH, W, 1, BEAM.l);
}

/** A tower's top: a paved platform inside a ring of merlons. */
function flatRoof(p: Pen, W: number, RH: number, pal: string[], seed: number) {
  p.r(0, 0, W, RH + 2, pal[1]);
  for (let y = 5, j = 0; y < RH - 5; y += 6, j++) for (let x = 5 + (j & 1 ? 3 : 0); x < W - 6; x += 8) {
    p.r(x, y, Math.min(7, W - 5 - x), 5, hash2(x, y, seed) < 0.2 ? pal[1] : pal[2]); p.r(x, y, Math.min(7, W - 5 - x), 1, pal[3]);
  }
  for (let x = 0; x < W; x += 8) { p.r(x, 0, 5, 4, pal[4]); p.r(x, 3, 5, 1, pal[2]); p.r(x, RH - 2, 5, 4, pal[3]); p.r(x, RH + 1, 5, 1, pal[0]); }
  for (let y = 0; y < RH; y += 8) { p.r(0, y, 4, 5, pal[4]); p.r(3, y, 1, 5, pal[2]); p.r(W - 4, y, 4, 5, pal[2]); }
  p.r(0, 0, W, 1, OUT); p.r(0, 0, 1, RH + 2, OUT); p.r(W - 1, 0, 1, RH + 2, OUT);
  p.r(1, RH + 2, W - 2, 2, "rgba(0,0,0,0.3)");
}

// ---------------------------------------------------------------- fronts
function limewash(p: Pen, r: Rng, x: number, y: number, w: number, h: number, col: string, stains: number) {
  p.r(x, y, w, h, col);
  for (let i = 0; i < (w * h * stains) / 60; i++) {
    const sx = x + Math.floor(r() * (w - 3)), sy = y + Math.floor(r() * (h - 1));
    p.r(sx, sy, 2 + Math.floor(r() * 3), 1, shade(col, r() < 0.7 ? 0.9 : 1.07));
  }
  p.r(x, y + h - 4, w, 4, shade(col, 0.9));
}

function wallOf(p: Pen, r: Rng, b: Building, W: number, y0: number): string {
  const h = FRONT_H - 3, H = y0 + FRONT_H;
  switch (b.wall) {
    case "stone": case "tower": {
      const base = STONE[b.tint % STONE.length], bw = b.wall === "tower" ? 12 : 10, bh = b.wall === "tower" ? 6 : 5;
      p.r(0, y0, W, h, shade(base, 0.5));
      for (let y = y0, j = 0; y < y0 + h; y += bh, j++) for (let x = j & 1 ? -(bw >> 1) : 0; x < W; x += bw) {
        const xx = Math.max(0, x), ww = Math.min(x + bw - 1, W) - xx, hh = Math.min(bh - 1, y0 + h - y);
        p.r(xx, y, ww, hh, shade(base, 0.86 + hash2(x, y, 72) * 0.26)); p.r(xx, y, ww, 1, shade(base, 1.14));
      }
      if (b.wall === "stone") {
        // a string course between the storeys, pale quoins up both corners
        p.r(0, y0 + 11, W, 2, shade(base, 1.24)); p.r(0, y0 + 13, W, 1, shade(base, 0.55));
        for (let y = y0, j = 0; y < y0 + h - 2; y += 5, j++) { const q = j & 1 ? 6 : 4; p.r(0, y, q, 4, shade(base, 1.2)); p.r(W - q, y, q, 4, shade(base, 1.06)); }
      }
      return base;
    }
    case "brick": {
      p.r(0, y0, W, h, "#3a2620");
      for (let y = y0, j = 0; y < y0 + h; y += 3, j++) for (let x = j & 1 ? -3 : 0; x < W; x += 6) {
        const xx = Math.max(0, x);
        p.r(xx, y, Math.min(x + 5, W) - xx, 2, shade("#8a4a36", 0.78 + hash2(x, y, 73) * 0.4));
      }
      p.r(0, y0, W, 9, "rgba(10,8,8,0.28)"); p.r(0, y0 + 9, W, 5, "rgba(10,8,8,0.12)");
      return "#8a4a36";
    }
    case "plank": {
      const base = ["#6a5238", "#5c5040", "#70583a"][b.tint % 3];
      for (let x = 0; x < W; x += 4) { p.r(x, y0, 4, h, shade(base, 0.84 + hash2(x, b.y, 74) * 0.3)); p.r(x + 3, y0, 1, h, "#2e2218"); }
      p.r(0, y0 + 12, W, 2, shade(base, 0.62)); p.r(0, y0 + 12, W, 1, shade(base, 1.1)); p.r(0, y0, W, 2, shade(base, 0.6));
      for (let x = 1; x < W; x += 4) { p.p(x, y0 + 13, "#1e1610"); p.p(x, y0 + 3, "#1e1610"); }
      return base;
    }
    case "daub": {
      // limewash over wattle: stained, cracked, a patch fallen away to the withies, on a footing of field stones
      const col = ["#c4bca4", "#b8ac8e", "#c0b49c"][b.tint % 3];
      limewash(p, r, 0, y0, W, h, col, 2.4);
      for (let i = 0; i < b.w; i++) { let cx = 6 + i * 16 + Math.floor(r() * 6), cy = y0 + 4 + Math.floor(r() * 8); for (let k = 0; k < 6; k++) { p.p(cx, cy, shade(col, 0.6)); cx += r() < 0.5 ? 1 : 0; cy += 1; } }
      const wx = 5 + Math.floor(r() * (W - 16)), wy = y0 + 15 + Math.floor(r() * 4);
      p.r(wx, wy, 7, 5, "#5a4028"); for (let k = 0; k < 7; k += 2) p.r(wx + k, wy, 1, 5, "#3a2818"); p.r(wx, wy + 2, 7, 1, "#7a5a38");
      p.r(0, y0, W, 2, BEAM.m); p.r(0, y0, 2, h, BEAM.m); p.r(W - 2, y0, 2, h, BEAM.d);
      for (let x = 0; x < W; x += 6) { const sh = 3 + Math.floor(hash2(x, b.x, 75) * 3); p.r(x, H - 3 - sh, 5, sh, shade("#7a756c", 0.8 + hash2(x, b.y, 76) * 0.4)); p.r(x, H - 3 - sh, 5, 1, "#9a958a"); }
      return col;
    }
    default: {
      // timber frame: limewashed panels between oak posts, a rail at the storey, braces where no window is
      const col = PLASTER[b.tint % PLASTER.length];
      limewash(p, r, 0, y0, W, h, col, 1);
      p.r(0, y0, W, 2, BEAM.m); p.r(0, y0 + 11, W, 2, BEAM.m); p.r(0, y0 + 11, W, 1, BEAM.l); p.r(0, H - 5, W, 2, BEAM.d);
      const door = b.door?.col ?? -9;
      for (let c = 0; c < b.w; c++) {
        const bx = c * 16, isWin = !!b.win?.includes(c), isDoor = c === door || (b.door?.kind === "hauler" && c === door + 1);
        if (!isWin && !isDoor) {
          if (hash2(c, b.x, 71) < 0.5) p.line(bx + 2, y0 + 10, bx + 10, y0 + 2, BEAM.m); else p.line(bx + 13, y0 + 10, bx + 5, y0 + 2, BEAM.m);
          p.line(bx + 2, H - 6, bx + 13, y0 + 13, BEAM.m);
          if (hash2(c, b.y, 77) < 0.5) p.line(bx + 13, H - 6, bx + 2, y0 + 13, BEAM.m);
        }
      }
      for (let x = 0; x <= W; x += 16) { const px = x === 0 ? 0 : x === W ? W - 2 : x - 1; p.r(px, y0, 2, h, BEAM.m); p.r(px, y0, 1, h, BEAM.l); }
      return col;
    }
  }
}

function windowAt(p: Pen, cx: number, top: number, b: Building, r: Rng) {
  const x = cx - 5, stone = b.wall === "stone", paint = PAINT[(b.tint + 2) % PAINT.length];
  p.r(x, top, WIN.w, WIN.h, BEAM.d);
  p.r(x + 1, top + 1, 8, 7, GLASS);
  p.r(x + 4, top + 1, 2, 7, BEAM.m); p.r(x + 1, top + 4, 8, 1, BEAM.m);
  p.p(x + 2, top + 2, "#3a5068"); p.p(x + 7, top + 6, "#26364a");
  if (stone) { const s = STONE[b.tint % STONE.length]; p.r(x - 1, top - 2, 12, 2, shade(s, 1.3)); p.r(x - 1, top + WIN.h, 12, 2, shade(s, 1.3)); p.r(x - 1, top + WIN.h + 1, 12, 1, shade(s, 0.6)); }
  else {
    // shutters folded back either side, a sill, now and then a window box
    for (const sx of [x - 3, x + WIN.w]) { p.r(sx, top, 3, WIN.h, paint); p.r(sx, top, 1, WIN.h, shade(paint, 1.35)); p.r(sx, top + 4, 3, 1, shade(paint, 0.6)); }
    p.r(x - 1, top + WIN.h, 12, 1, BEAM.l);
    if (b.light !== "none" && r() < 0.55) {
      p.r(x, top + WIN.h + 1, 10, 2, "#4a3020");
      for (let i = 0; i < 10; i++) p.p(x + i, top + WIN.h - (i & 1), ["#4e7a3a", "#628e44", "#c84858", "#e0c060", "#d8d0e8"][Math.floor(r() * 5)]);
    }
  }
}

function doorAt(p: Pen, b: Building, cx: number, H: number) {
  const kind = b.door?.kind ?? "plain", d = DOOR[kind], x = cx - d.w / 2, top = H - 2 - d.h;
  const stone = b.wall === "stone", paint = kind === "hauler" ? "#5a4028" : PAINT[b.tint % PAINT.length];
  p.r(x - 2, top - 2, d.w + 4, d.h + 2, stone ? shade(STONE[b.tint % STONE.length], 1.3) : BEAM.m);
  p.r(x - 1, top - 1, d.w + 2, d.h + 1, OUT);
  p.r(x, top, d.w, d.h, paint);
  for (let i = 3; i < d.w; i += 3) p.r(x + i, top, 1, d.h, shade(paint, 0.68));
  p.r(x, top, d.w, 1, shade(paint, 1.35));
  if (kind !== "plain") p.r(cx - 1, top, 1, d.h, OUT);
  for (const f of [0.2, 0.68]) { const sy = top + Math.round(d.h * f); p.r(x, sy, kind === "plain" ? 6 : d.w, 1, IR.m); p.r(x, sy + 1, kind === "plain" ? 6 : d.w, 1, IR.d); }
  if (stone && kind !== "hauler") { p.r(x, top, 2, 1, OUT); p.r(x + d.w - 2, top, 2, 1, OUT); p.p(x, top + 1, OUT); p.p(x + d.w - 1, top + 1, OUT); }
  if (kind === "plain") {
    p.p(x + d.w - 3, top + 10, GD.l); p.p(x + d.w - 3, top + 11, GD.d);
    // the better doors have a pane of glass in them
    if (b.light === "rune") { p.r(x + 3, top + 3, 6, 4, BEAM.d); p.r(x + 4, top + 4, 4, 2, GLASS); }
  } else if (kind === "double") {
    p.r(cx - 4, top + 11, 2, 2, GD.m); p.r(cx + 2, top + 11, 2, 2, GD.m);
    for (let i = 2; i < d.w; i += 4) { p.p(x + i, top + 3, IR.l); p.p(x + i, top + d.h - 3, IR.l); }
  } else {
    // cut for labour golems: ring pulls set high, iron kick plates scuffed bright, the sill worn into two flat tracks
    p.r(cx - 7, top + 7, 3, 3, IR.h); p.p(cx - 6, top + 8, OUT); p.r(cx + 4, top + 7, 3, 3, IR.h); p.p(cx + 5, top + 8, OUT);
    p.r(x, H - 7, d.w, 5, IR.d); p.r(x, H - 7, d.w, 1, IR.m);
    for (let i = 2; i < d.w; i += 3) p.p(x + i, H - 5 + (i & 1), IR.h);
  }
  p.r(x - 2, H - 2, d.w + 4, 2, "#8a847a"); p.r(x - 2, H - 1, d.w + 4, 1, "#5e5850");
  if (kind === "hauler") { p.r(x + 4, H - 2, 6, 1, "#5a544c"); p.r(x + d.w - 10, H - 2, 6, 1, "#5a544c"); }
}

function front(p: Pen, r: Rng, b: Building, W: number, RH: number): string {
  const y0 = RH, H = RH + FRONT_H;
  const wall = wallOf(p, r, b, W, y0);
  if (b.wall !== "daub") { p.r(0, H - 3, W, 3, "#4a4640"); p.r(0, H - 3, W, 1, "#6a665e"); for (let x = 6; x < W; x += 7) p.p(x, H - 2, "#2e2a28"); }
  if (b.wall === "tower") {
    for (let c = 0; c < b.w; c++) { p.r(c * 16 + 7, y0 + 5, 2, 9, OUT); p.p(c * 16 + 7, y0 + 5, "#3a3640"); }
    p.r(0, y0, 1, FRONT_H, OUT); p.r(W - 1, y0, 1, FRONT_H, OUT);
    return wall;
  }
  const door = b.door ? b.door.col : -9;
  for (const c of b.win ?? []) windowAt(p, c * 16 + 8, y0 + WIN.top, b, r);
  // the upper storey: a small window over each window and over the door
  for (let c = 0; c < b.w; c++) {
    if (!(b.win?.includes(c) || c === door)) continue;
    const cx = c * 16 + 8 + (c === door && b.door?.kind === "hauler" ? 8 : 0), y = y0 + UPWIN.top;
    p.r(cx - 3, y, UPWIN.w, UPWIN.h, BEAM.d); p.r(cx - 2, y + 1, 4, 5, GLASS); p.r(cx - 2, y + 3, 4, 1, BEAM.m); p.p(cx - 1, y + 1, "#3a5068");
  }
  if (b.door) doorAt(p, b, b.door.col * 16 + (b.door.kind === "hauler" ? 16 : 8), H);
  p.r(0, y0, 1, FRONT_H, OUT); p.r(W - 1, y0, 1, FRONT_H, OUT);
  return wall;
}

/** The labour golems' stands: an open-fronted shed of numbered bays, each with a standing slab worn into two hollows. */
function bays(p: Pen, W: number, RH: number) {
  const y0 = RH, H = RH + FRONT_H, n = Math.max(2, Math.round(W / 40)), bw = W / n;
  p.r(0, y0, W, FRONT_H, "#17141a"); p.r(0, y0 + 18, W, 14, "#1f1b20"); p.r(0, H - 4, W, 4, "#3a342e");
  for (let i = 0; i < n; i++) {
    const bx = Math.round(i * bw), mid = Math.round(bx + bw / 2);
    // back wall: a hook and a hanging chain; on the floor, the slab
    p.r(mid - 8, y0 + 8, 1, 9, IR.d); p.r(mid + 7, y0 + 8, 1, 7, IR.d); p.p(mid - 8, y0 + 17, IR.m);
    p.r(mid - 12, H - 8, 24, 6, "#24201e"); p.r(mid - 11, H - 8, 22, 4, "#6e685e"); p.r(mid - 11, H - 8, 22, 1, "#8a847a");
    p.r(mid - 8, H - 7, 6, 3, "#4a4640"); p.r(mid + 2, H - 7, 6, 3, "#4a4640");
    // tally strokes on the lintel: bay one, two, three...
    for (let k = 0; k <= i; k++) p.r(mid - i * 1.5 + k * 3 - 1, y0 + 2, 1, 4, "#d8d0b8");
  }
  p.r(0, y0, W, 7, BEAM.m); p.r(0, y0, W, 1, BEAM.l); p.r(0, y0 + 7, W, 1, OUT);
  for (let i = 0; i < n; i++) { const mid = Math.round(i * bw + bw / 2); for (let k = 0; k <= i; k++) p.r(mid - i * 1.5 + k * 3 - 1, y0 + 2, 1, 4, "#d8d0b8"); }
  for (let i = 0; i <= n; i++) {
    const px = Math.min(W - 4, Math.max(0, Math.round(i * bw) - 2));
    p.r(px, y0, 4, FRONT_H, BEAM.m); p.r(px, y0, 1, FRONT_H, BEAM.l); p.r(px + 3, y0, 1, FRONT_H, BEAM.d);
    p.r(px + 1, y0 + 14, 2, 2, IR.h); p.p(px + 1, y0 + 16, IR.m);
  }
}

/** A house going up: sill beams and joists seen from above, a few boards laid, bare studs along the street on a new footing. */
function site(p: Pen, r: Rng, W: number, H: number, RH: number) {
  p.r(0, 0, W, H, "#2a2420");
  for (let i = 0; i < 60; i++) p.p(Math.floor(r() * W), Math.floor(r() * RH), r() < 0.5 ? "#3a3026" : "#1e1a18");
  for (let x = 8; x < W - 4; x += 8) { p.r(x, 3, 2, RH - 3, BEAM.l); p.r(x + 2, 3, 1, RH - 3, "#1a1410"); }
  for (let y = 6; y < RH * 0.55; y += 4) { p.r(4, y, Math.round(W * 0.42), 3, shade("#8a6a44", 0.85 + hash2(y, 3, 78) * 0.3)); p.r(4, y + 3, Math.round(W * 0.42), 1, "#3a2818"); }
  p.r(0, 0, W, 4, "#6a4a2c"); p.r(0, 0, W, 1, "#8a6a44"); p.r(0, 0, 4, RH, "#6a4a2c"); p.r(W - 4, 0, 4, RH, "#573a22"); p.r(0, RH - 2, W, 4, "#6a4a2c");
  for (const [x, y] of [[0, 0], [W - 4, 0], [W >> 1, 0]]) { p.r(x, y, 4, 4, "#93704a"); p.p(x + 1, y + 1, "#1a110b"); }
  // a ladder left lying across the joists
  p.r(W - 30, 14, 2, 30, "#93704a"); p.r(W - 23, 14, 2, 30, "#93704a"); for (let y = 17; y < 44; y += 5) p.r(W - 28, y, 5, 1, "#7a5634");
  // the street side: bare studs on a fresh stone footing
  const y0 = RH;
  p.r(0, y0 + 2, W, FRONT_H - 2, "#1c1816");
  for (let x = 0; x < W; x += 8) { p.r(x, y0, 2, FRONT_H - 8, "#93704a"); p.r(x + 2, y0, 1, FRONT_H - 8, "#573a22"); }
  p.r(0, y0, W, 2, "#93704a"); p.r(0, y0 + 12, W, 2, "#7a5634"); p.line(2, y0 + 22, 14, y0 + 13, "#7a5634"); p.line(W - 3, y0 + 22, W - 15, y0 + 13, "#7a5634");
  for (let x = 0; x < W; x += 10) { p.r(x, H - 8, 9, 7, shade("#9c968c", 0.85 + hash2(x, 5, 79) * 0.3)); p.r(x, H - 8, 9, 1, "#b8b2a8"); }
  p.r(0, H - 1, W, 1, "#2e2a28"); p.r(0, 0, 1, H, OUT); p.r(W - 1, 0, 1, H, OUT); p.r(0, 0, W, 1, OUT);
}

export function paintBuilding(p: Pen, b: Building, r: Rng) {
  const W = b.w * 16, H = b.h * 16, RH = roofH(b), seed = b.x * 7 + b.y * 13;
  const pal = ROOF[b.roof][b.tint % ROOF[b.roof].length];
  if (b.wall === "frame") { site(p, r, W, H, RH); return; }
  let wall = "#000";
  if (b.wall === "bays") bays(p, W, RH); else wall = front(p, r, b, W, RH);
  if (b.roof === "flat") flatRoof(p, W, RH, pal, seed);
  else if (b.ridge === "ns") { roofNS(p, b, W, RH, pal, seed); gable(p, b, W, RH, wall); }
  else roofEW(p, b, W, RH, pal, seed);
  // dormers on the long slope: a little gabled roof over a cheek of wall and one window
  for (const c of b.ridge === "ns" ? [] : b.dormers ?? []) {
    const d = dormerPx(b, c), cx = d.x - b.x * 16, sy = d.y - b.y * 16;
    for (let j = 0; j < 7; j++) { p.r(cx - 1 - j, sy - 15 + j, 2 + j * 2, 1, pal[j < 2 ? 4 : 3]); p.p(cx - 1 - j, sy - 15 + j, pal[0]); p.p(cx + j, sy - 15 + j, pal[0]); }
    p.r(cx - 6, sy - 8, 12, 9, pal[0]); p.r(cx - 5, sy - 8, 10, 8, wall === "#000" ? "#6a665e" : shade(wall, 0.92));
    p.r(cx - 3, sy - 7, 6, 7, BEAM.d); p.r(cx - 2, sy - 6, 4, 5, GLASS); p.r(cx - 2, sy - 4, 4, 1, BEAM.m); p.p(cx - 1, sy - 6, "#3a5068");
    p.r(cx - 6, sy + 1, 12, 2, "rgba(0,0,0,0.3)");
  }
  const ch = chimneyPx(b);
  if (ch) {
    const cx = ch.x - b.x * 16, ty = ch.y - b.y * 16;
    p.r(cx - 5, ty, 10, 13, OUT); p.r(cx - 4, ty + 1, 8, 11, "#7a4a3a"); p.r(cx - 4, ty + 1, 2, 11, "#96604a"); p.r(cx + 2, ty + 1, 2, 11, "#5a3428");
    for (let y = ty + 4; y < ty + 12; y += 3) p.r(cx - 4, y, 8, 1, "#4a2c22");
    p.r(cx - 5, ty, 10, 2, "#8a847a"); p.r(cx - 5, ty, 10, 1, "#a8a296");
    p.r(cx - 3, ty + 13, 8, 2, "rgba(0,0,0,0.3)");
  }
  // weather: moss on thatch and shingle, more of it on the old roofs; ivy up one corner of the humbler walls
  if (b.roof === "thatch" || b.roof === "shingle") {
    const ry = ridgeY(b);
    for (let i = 0; i < (W * RH) / (b.roof === "thatch" ? 40 : 70); i++) {
      const x = 3 + Math.floor(r() * (W - 6)), y = ry + 2 + Math.floor(r() * (RH - ry - 2));
      if (hash2(x >> 3, y >> 3, seed) < 0.42) p.p(x, y, MOSS[Math.floor(r() * 4)]);
    }
  }
  if ((b.wall === "daub" || b.wall === "timber" || b.wall === "stone") && hash2(b.x, b.y, 80) < 0.45) {
    const left = hash2(b.y, b.x, 81) < 0.5, x0 = left ? 3 : W - 4, ht = 12 + Math.floor(r() * 14);
    for (let i = 0; i < ht * 5; i++) { const up = r() * ht, xx = x0 + (r() - 0.5) * (3 + up * 0.5) * (left ? 1 : 1); p.p(Math.max(1, Math.min(W - 2, Math.round(xx))), Math.round(H - 3 - up), MOSS[Math.floor(r() * 4)]); }
  }
}

const built = new Map<string, HTMLCanvasElement>();
/** A building's painting (roof + front), drawn once and kept. */
export function buildingCanvas(b: Building): HTMLCanvasElement {
  let c = built.get(b.id);
  if (!c) {
    const k = makeCanvas(b.w * 16, b.h * 16);
    paintBuilding(new Pen(k.ctx, false), b, mulberry(b.x * 131 + b.y * 17 + b.w));
    built.set(b.id, (c = k.c));
  }
  return c;
}

// ---------------------------------------------------------------- ground decals
/** Rug schemes: border, field, pattern, fringe. */
const RUGS = [["#3a1014", "#7a2428", "#c89a4a", "#d8c8a0"], ["#101a3a", "#24407a", "#b8c4d8", "#d8d8e0"], ["#14301c", "#2e5a3a", "#d0c088", "#e0d8b0"], ["#2a1030", "#5a2a66", "#c8a0d0", "#e0d0e0"]];

/** Pixel bounds of the town's decal kinds relative to their (x, y); null for a kind that is not the town's. */
export function townDecalExtent(dc: DecalDef): [number, number, number, number] | null {
  const w = dc.w ?? 0, h = dc.h ?? 0;
  switch (dc.kind) {
    case "building": case "plot": case "planks": case "shadowband": return [0, 0, w, h];
    case "rug": return [-1, -1, w + 1, h + 1];
    case "doormat": return [-8, -4, 8, 4];
    case "threshold": return [0, 0, w || 16, 16];
    case "ruts": case "golemtrack": return dc.v & 1 ? [-7, 0, 7, w] : [0, -7, w, 7];
    case "straw": case "wear": case "stain": { const rx = (w || 20) / 2 + 2, ry = (h || w || 20) / 2 + 2; return [-rx, -ry, rx, ry]; }
    case "drain": return [-5, -5, 5, 5];
  }
  return null;
}

/** Draw a town decal. False if `dc` is not one of the town's kinds (art/decals.ts then draws it). */
export function drawTownDecal(p: Pen, dc: DecalDef, r: Rng): boolean {
  const x = Math.round(dc.x), y = Math.round(dc.y), w = Math.round(dc.w ?? 0), h = Math.round(dc.h ?? 0);
  switch (dc.kind) {
    case "building": { const b = BUILDINGS[dc.v]; if (b) p.ctx.drawImage(buildingCanvas(b), x, y); return true; }
    case "rug": {
      const C = RUGS[dc.v % RUGS.length];
      p.r(x, y, w, h, C[0]); p.r(x + 1, y + 1, w - 2, h - 2, C[2]); p.r(x + 2, y + 2, w - 4, h - 4, C[0]); p.r(x + 3, y + 3, w - 6, h - 6, C[1]);
      for (let j = 5; j < h - 5; j++) for (let i = 5; i < w - 5; i++) {
        const u = i % 8, v = j % 8, d = Math.abs(u - 4) + Math.abs(v - 4);
        if (d === 3) p.p(x + i, y + j, C[2]); else if (d === 0) p.p(x + i, y + j, C[3]); else if (d === 7 || (u === 0 && v === 0)) p.p(x + i, y + j, C[0]);
      }
      if (w >= h) for (let j = 1; j < h; j += 2) { p.p(x - 1, y + j, C[3]); p.p(x + w, y + j, C[3]); }
      else for (let i = 1; i < w; i += 2) { p.p(x + i, y - 1, C[3]); p.p(x + i, y + h, C[3]); }
      return true;
    }
    case "doormat": {
      p.r(x - 7, y - 3, 14, 6, "#3a2c1c"); p.r(x - 6, y - 2, 12, 4, "#7a6440");
      for (let i = -5; i < 6; i += 2) p.r(x + i, y - 2, 1, 4, "#5e4c30");
      return true;
    }
    case "threshold": {
      // the way out: a worn stone sill, and the night beyond the open door
      const ww = w || 16;
      p.r(x, y, ww, 16, "#6e685e"); p.r(x, y, ww, 1, "#8a847a");
      for (let i = 3; i < ww; i += 6) p.r(x + i, y + 1, 1, 9, "#5a544c");
      p.r(x, y + 10, ww, 6, "#1a2030"); p.r(x, y + 10, ww, 1, "#2e2a28"); p.r(x + 1, y + 12, ww - 2, 3, "#2a3448");
      p.r(x, y + 3, ww, 3, "rgba(60,50,40,0.25)");
      return true;
    }
    case "ruts": case "golemtrack": {
      const vert = (dc.v & 1) === 1, len = w || 48;
      const px = (a: number, o: number, ww: number, hh: number, c: string) => vert ? p.r(x + o, y + a, hh, ww, c) : p.r(x + a, y + o, ww, hh, c);
      if (dc.kind === "ruts") {
        for (let a = 0; a < len; a++) {
          const wob = Math.round(Math.sin(a * 0.11 + dc.x * 0.3) * 1.2);
          if (hash2(a, y + x, 92) < 0.88) { px(a, -4 + wob, 1, 2, "rgba(20,14,8,0.34)"); px(a, 3 + wob, 1, 2, "rgba(20,14,8,0.34)"); }
          if (hash2(a, x, 93) < 0.5) { px(a, -5 + wob, 1, 1, "rgba(200,180,140,0.12)"); px(a, 2 + wob, 1, 1, "rgba(200,180,140,0.12)"); }
        }
      } else {
        // broad, square, flat prints in pairs, deeper than any boot leaves: something heavy walks this line every day
        for (let a = 2, k = 0; a < len - 5; a += 9, k++) {
          const o = k & 1 ? 2 : -6;
          if (r() < 0.12) continue;
          px(a, o, 6, 5, "rgba(16,12,8,0.3)"); px(a + 1, o + 1, 4, 3, "rgba(16,12,8,0.22)"); px(a, o + 5, 6, 1, "rgba(210,190,150,0.12)");
        }
      }
      return true;
    }
    case "plot": {
      p.r(x, y, w, h, "#46321f");
      for (let j = 1; j < h - 1; j += 4) {
        p.r(x, y + j, w, 1, "#5e4630"); p.r(x, y + j + 2, w, 1, "#32240f");
        for (let i = 1 + ((j >> 2) & 1); i < w - 2; i += 4 + (dc.v % 3)) {
          if (r() < 0.14) continue;
          if (dc.v % 3 === 0) { p.r(x + i, y + j - 1, 2, 2, "#4e8a3a"); p.p(x + i, y + j - 1, "#7ab050"); }
          else if (dc.v % 3 === 1) { p.r(x + i, y + j - 2, 1, 3, "#6a9a44"); p.p(x + i + 1, y + j - 1, "#3e6a30"); }
          else { p.p(x + i, y + j, "#3e6a30"); p.p(x + i, y + j - 1, ["#c84858", "#e0c060", "#d8d0e8"][Math.floor(r() * 3)]); }
        }
      }
      return true;
    }
    case "planks": {
      // a boardwalk laid over the mud
      const across = w >= h;
      for (let a = 0; a < (across ? w : h); a += 4) {
        const c = shade("#6e5438", 0.8 + hash2(a, x + y, 94) * 0.35);
        if (across) { p.r(x + a, y, 3, h, c); p.r(x + a + 3, y, 1, h, "#241a10"); p.p(x + a + 1, y + 1, "#1e1610"); p.p(x + a + 1, y + h - 2, "#1e1610"); }
        else { p.r(x, y + a, w, 3, c); p.r(x, y + a + 3, w, 1, "#241a10"); p.p(x + 1, y + a + 1, "#1e1610"); p.p(x + w - 2, y + a + 1, "#1e1610"); }
      }
      return true;
    }
    case "shadowband": p.r(x, y, w, h, "rgba(0,0,0,0.26)"); return true;
    case "straw": {
      const rad = (w || 20) / 2;
      for (let i = 0; i < rad * 2.2; i++) {
        const a = r() * 6.283, d = Math.sqrt(r()) * rad, sx = Math.round(x + Math.cos(a) * d), sy = Math.round(y + Math.sin(a) * d * 0.7);
        if (r() < 0.5) p.r(sx, sy, 2, 1, r() < 0.5 ? "#b8a252" : "#9a843e"); else p.r(sx, sy, 1, 2, "#a89048");
      }
      return true;
    }
    case "wear": case "stain": {
      const rx = Math.max(2, (w || 20) / 2), ry = Math.max(2, (h || w || 20) / 2);
      const c = dc.kind === "wear" ? "rgba(214,196,160,0.16)" : dc.v === 1 ? "rgba(40,60,90,0.3)" : "rgba(8,6,6,0.34)";
      for (let j = -Math.ceil(ry); j <= ry; j++) for (let i = -Math.ceil(rx); i <= rx; i++) {
        const v = (i * i) / (rx * rx) + (j * j) / (ry * ry);
        if (v > 1 || (v > 0.55 && ((i + j) & 1)) || (v > 0.85 && hash2(i, j, 95) < 0.5)) continue;
        p.p(x + i, y + j, c);
      }
      return true;
    }
    case "drain": {
      p.r(x - 4, y - 4, 8, 8, "#2e2e34"); p.r(x - 3, y - 3, 6, 6, "#0c0c10");
      for (let i = -2; i < 3; i += 2) p.r(x + i, y - 3, 1, 6, "#4c535c");
      return true;
    }
  }
  return false;
}
