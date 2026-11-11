// Surface prop sprites (trees, rocks, foliage, ruins in the wild, the buried
// gate) plus the dungeon's collapsed-gate rock piles, which share the stone and
// overgrowth helpers. Registered into PROP_ART by art/props.ts.
import { hash2, mulberry, clamp, rgb } from "../util";
import type { Pen, Rng } from "../util";
import { S, WD, IR } from "./palette";
import { stoneBlob, type PropArt } from "./common";
import { paintRock, rockForm, ROCK_SEEDS, IRONSTONE, ORE } from "./rocks";
import { stepShade, cornerShade, treadTone, stairRGB, TOP_LEVEL } from "./stairs";

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

/** What a rock leaves when it is broken up: a few angular chips, lit on top, and grit between them (flecked with ore for a vein). */
function shards(p: Pen, r: Rng, ore: boolean) {
  for (let i = 0; i < 7; i++) p.p(1 + ((r() * 16) | 0), 3 + ((r() * 5) | 0), ore && i % 3 === 0 ? ORE[1] : i % 2 ? S.d : S.m);
  ([[1, 4, 4], [7, 2, 3], [12, 5, 4], [6, 6, 3], [14, 2, 2]] as [number, number, number][]).forEach(([x, y, w], i) => {
    const ox = x + ((r() * 2) | 0);
    p.r(ox, y + 1, w, 1, S.d); p.r(ox, y, w - 1, 1, S.l); p.p(ox, y, S.h); p.p(ox + w - 1, y + 1, S.o);
    if (ore && i % 2 === 0) p.p(ox + 1, y, ORE[2]);
  });
}

export const SURFACE_PROP_ART: Record<string, PropArt> = {
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
  // An iron vein: a broken tooth of dark ironstone standing out of the ground, a shelf against it and a piece
  // fallen from it. The ore is in the rock, not on it: rust-red seams run through the mass and show on every
  // face they cut, with brighter metal where a seam is richest and rust washed down the stone beneath.
  ironore: (v, alt, M) => {
    if (alt) return M(18, 8, (p, r) => shards(p, r, true));
    return M(22, 18, (p, r) => {
      p.r(3, 15, 17, 2, "rgba(0,0,0,0.35)"); p.r(5, 17, 14, 1, "rgba(0,0,0,0.35)");
      paintRock(p, r, 22, 18, rockForm("ironore", ROCK_SEEDS.ironore[v % ROCK_SEEDS.ironore.length]), { ramp: IRONSTONE, cracks: 1, ore: { cols: ORE, seams: 2, pockets: 1 } });
      tufts(p, r, 1, 17, 20, 3);
    });
  },
  // A rock to be broken for stone: one angular block with clean faces (a lit top, a front, a side in shade), a
  // piece or two already split from it, and fractures down its lit faces. Four shapes; the forest's (2, 3) are mossed.
  rock: (v, alt, M) => {
    if (alt) return M(18, 8, (p, r) => shards(p, r, false));
    return M(22, 18, (p, r) => {
      p.r(3, 15, 17, 2, "rgba(0,0,0,0.35)"); p.r(5, 17, 14, 1, "rgba(0,0,0,0.35)");
      paintRock(p, r, 22, 18, rockForm("rock", ROCK_SEEDS.rock[v % ROCK_SEEDS.rock.length]), { cracks: 2, moss: v >= 2 ? { cols: MOSS, dens: 0.6 } : undefined });
      tufts(p, r, 1, 17, 20, v >= 2 ? 5 : 2);
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
  // The head of the old stair, by how far it has been dug (the variant is its dig stage, content/digging.ts):
  // 0 buried: a square-cut sunken patch, kerb stones through the grass, a ward glyph cut in the lintel, dark;
  // 1-2 the turf cut and the earth going down; 3 the fall laid bare: the same heap of boulders that chokes the
  // stair below; 4 the heap broken through, the stair showing down the breach;
  // 5 open: stone steps going down to the north, into the dark under the lintel, and the glyph alight.
  buriedgate: (v, _alt, M) => M(72, 58, (p, r) => {
    const X0 = 6, X1 = 66, Y0 = 14, Y1 = 58, EARTH = ["#33261a", "#3e2e20", "#4e3c2a", "#5a4630"];
    const fill = (y0: number, y1: number, base: string, a: string, b: string) => {
      p.r(X0, y0, X1 - X0, y1 - y0, base);
      for (let i = 0; i < (y1 - y0) * 5; i++) p.p(X0 + ((r() * (X1 - X0)) | 0), y0 + ((r() * (y1 - y0)) | 0), r() < 0.5 ? a : b);
    };
    const kerb = (show: number) => {
      for (let x = 4; x < 68; x += 8) if (x === 28 || x === 36 || r() < show) { p.o(x, 9, 8, 5, "#7a7268", "#141016"); p.r(x + 1, 10, 6, 1, "#9a9288"); p.p(x + 6, 12, "#5a544c"); if (v < 3 && r() < 0.6) p.r(x + 1, 9, 2 + ((r() * 4) | 0), 1, MOSS[1]); }
      for (let y = 14; y < 58; y += 8) for (const x of [2, 66]) if (r() < show) { p.o(x, y, 4, 8, "#6a645c", "#141016"); p.r(x + 1, y + 1, 1, 6, "#8a8278"); if (v < 3 && r() < 0.5) p.p(x + 1, y, MOSS[2]); }
    };
    // The open stairwell, looked down into from its south lip: the flight's top steps (art/stairs.ts, the same
    // step as below), each lower one shorter, narrower and darker as it goes down under the lintel, between the
    // well's two walls: the east one catching the light, the west one in its own shade. `dim` is how much of the
    // day gets in (less while the fall still roofs most of it).
    const well = (dim: number) => {
      p.r(X0, Y0, X1 - X0, Y1 - Y0, "#050408");
      let y1 = Y1;
      [8, 7, 6, 5, 5, 4, 3, 3].forEach((pitch, i) => {
        const y0 = y1 - pitch, inset = 3 + Math.round(i * 1.5), x0 = X0 + inset, w = X1 - X0 - inset * 2, f = Math.pow(0.79, i) * dim;
        const tread = (treadTone(TOP_LEVEL - i) - 2) * f, tone = (k: number) => { const c = stairRGB(Math.max(4, tread + k * f)); return rgb(c[0], c[1], c[2]); };
        for (let s = 0; s < pitch; s++) {
          const k = stepShade(s, pitch);
          p.r(x0, y0 + s, w, 1, tone(k));
          // worn down the middle, as below: paler, the lip rounded off
          if (i < 6) p.r(x0 + Math.round(w * 0.33), y0 + s, Math.round(w * 0.34), 1, tone(k + (s === 0 ? -9 : s === 1 && pitch >= 6 ? 11 : s < pitch - 3 ? 5 : 0)));
        }
        for (let n = 0; n < 6 - i; n++) { const cx = x0 + 1 + ((r() * (w - 2)) | 0); if (r() < 0.4) p.p(cx, y0, tone(8)); else p.p(cx, y0 + 1 + ((r() * Math.max(1, pitch - 3)) | 0), tone(-12)); }
        if (i < 5) p.r(x0 + 4 + ((r() * (w - 8)) | 0), y0 + 1, 1, Math.max(1, pitch - 3), tone(-13));
        // the walls: a course of blocks to each step, the west face shaded and throwing its shadow on the tread ends
        const wl = 30 * f, wr = 74 * f, wall = (v: number) => { const c = stairRGB(Math.max(4, v)); return rgb(c[0], c[1], c[2]); };
        p.r(X0, y0, inset, pitch, wall(wl)); p.r(x0 + w, y0, inset, pitch, wall(wr));
        p.r(X0, y1 - 1, inset, 1, wall(wl - 14 * f)); p.r(x0 + w, y1 - 1, inset, 1, wall(wr - 30 * f));
        p.r(x0 + w, y0, 1, pitch, wall(wr + 26 * f)); p.r(x0, y0, 2, pitch, tone(-40));
        // the wedge of shadow in each corner, as on the flight below
        for (let s = 0; s < pitch; s++) { const c = cornerShade(s, pitch); if (c) { p.r(x0, y0 + s, c + 2, 1, tone(-64)); p.r(x0 + w - c, y0 + s, c, 1, tone(-64)); } }
        if (i & 1) { p.p(X0 + (inset >> 1), y0 + 1, wall(wl - 14 * f)); p.p(X1 - 1 - (inset >> 1), y0 + 1, wall(wr - 30 * f)); }
        y1 = y0;
      });
    };
    // The fall, as it is met from below (the dungeon's `rockpile`): boulders heaped to the kerb, earth packed
    // between them, a block or two of the vault's dressed stone among them and roots through the lot. Broken
    // through, the same heap with a breach in it and the stair showing down the hole.
    const heap = (broken: boolean) => {
      const hr = mulberry(0x57a1e), W = X1 - X0, top = Y0 + 7;
      if (!broken) fill(top, Y1, EARTH[0], EARTH[1], "#241a12");
      p.r(X0, Y0, W, 7, EARTH[1]); for (let x = X0; x < X1; x++) if (hr() < 0.5) p.p(x, Y0 + 2 + ((hr() * 4) | 0), EARTH[2]);
      p.r(X0, Y0, W, 1, "#241a12"); p.r(X0, top, W, 1, "#141016");
      const gone = (x: number, y: number, k: number) => broken && Math.hypot((x - 37) / 1.4, y - 42) < 7.5 + k * 3.5;
      const rocks: [number, number, number, number, number][] = [];
      for (let row = 0; row < 5; row++) for (let col = 0; col < 7; col++) {
        const w = 9 + ((hr() * 6) | 0), h = 7 + ((hr() * 4) | 0);
        rocks.push([clamp(X0 - 3 + col * 9 + ((hr() * 5) | 0) + (row & 1 ? 4 : 0), X0, X1 - w), clamp(top - 1 + row * 7 + ((hr() * 4) | 0), top, Y1 - h), w, h, hr()]);
      }
      rocks.sort((a, b) => a[1] + a[3] - (b[1] + b[3]));
      rocks.forEach(([x, y, w, h, k], i) => {
        if (gone(x + w / 2, y + h / 2, k)) return;
        if (i % 11 === 5) { p.o(x, y, 12, 8, "#5e5850", "#141016"); p.r(x + 1, y + 1, 10, 1, "#7a7268"); p.r(x + 5, y + 2, 1, 5, "#3e3a36"); }
        else stoneBlob(p, x, y, w, h, hr);
      });
      for (let i = 0; i < 9; i++) { const w = 4 + ((hr() * 3) | 0), x = X0 + ((hr() * (W - w)) | 0), y = top + 1 + ((hr() * (Y1 - top - 6)) | 0); if (!gone(x + 2, y + 2, 1.6)) stoneBlob(p, x, y, w, w - 1, hr); }
      for (let i = 0; i < 4; i++) { let x = X0 + 6 + ((hr() * (W - 12)) | 0), y = top + 2 + ((hr() * 22) | 0); for (let k = 0; k < 7; k++) { if (!gone(x, y, 1.6)) p.p(x, y, "#3e2c1a"); x += ((hr() * 3) | 0) - 1; y += 1; } }
      // stone the pick has split, lying on the steps in the breach
      if (broken) for (const [x, y] of [[31, 45], [42, 39], [38, 49]] as [number, number][]) { p.r(x, y, 3, 2, S.m); p.p(x, y, S.h); p.p(x + 2, y + 1, S.o); }
    };
    if (v === 0) {
      // square, not round: straight sunken edges and a faint settling of the turf between them
      for (let x = X0; x < X1; x++) for (const y of [Y0, Y1 - 1]) if ((x + y) & 1 && r() < 0.6) p.p(x, y, "rgba(8,10,6,0.22)");
      for (let y = Y0; y < Y1; y++) for (const x of [X0, X1 - 1]) if ((x + y) & 1 && r() < 0.6) p.p(x, y, "rgba(8,10,6,0.22)");
      for (let i = 0; i < 90; i++) p.p(X0 + 1 + ((r() * 58) | 0), Y0 + 1 + ((r() * 42) | 0), "rgba(8,10,6,0.12)");
      for (let x = X0 + 1; x < X1 - 1; x += 2) if (r() < 0.5) p.p(x, Y0 + 1, "rgba(255,236,190,0.07)");
      kerb(0.3);
      tufts(p, r, 8, 16, 20, 6); tufts(p, r, 40, 30, 22, 6); tufts(p, r, 14, 50, 40, 8);
    } else if (v <= 2) {
      // the turf cut back and the earth going down: the far wall of the pit shows its strata
      fill(Y0, Y1, EARTH[v === 1 ? 2 : 1], EARTH[3], EARTH[0]);
      const wall = v === 1 ? 3 : 8;
      p.r(X0, Y0, X1 - X0, wall, EARTH[2]); p.r(X0, Y0, X1 - X0, 1, "#241a12");
      for (let y = Y0 + 2; y < Y0 + wall; y += 2) for (let x = X0; x < X1; x++) if (r() < 0.55) p.p(x, y, EARTH[3]);
      p.r(X0, Y0 + wall, X1 - X0, 1, "#241a12");
      if (v === 2) { p.r(X0, Y0 + wall, 3, Y1 - Y0 - wall, "rgba(0,0,0,0.28)"); p.r(X1 - 3, Y0 + wall, 3, Y1 - Y0 - wall, "rgba(0,0,0,0.28)"); for (const [x, y] of [[20, 40], [44, 33], [52, 48]] as [number, number][]) { p.r(x, y, 3, 2, S.m); p.p(x, y, S.h); } }
      for (let x = X0; x < X1; x++) if (r() < 0.5) p.p(x, Y1 - 1, MOSS[(r() * 3) | 0]);
      kerb(v === 1 ? 0.6 : 0.85);
    } else if (v === 3) {
      heap(false);
      kerb(1);
    } else if (v === 4) {
      well(0.6);
      heap(true);
      kerb(1);
    } else {
      well(1);
      // what the digging left: crumbs of earth on the upper steps
      for (const [x, y] of [[18, 52], [47, 47], [33, 55], [26, 41]] as [number, number][]) { p.r(x, y, 2, 1, EARTH[2]); p.p(x, y, EARTH[3]); }
      kerb(1);
      p.r(X0, Y0, X1 - X0, 1, "#141016");
    }
    // the ward glyph cut in the lintel: what is left of the upper hall's magic. Dark while the stair lies buried
    // (nothing up here glows but the rune); it wakes when the stair is open.
    for (const [x, y] of [[34, 10], [37, 10], [35, 11], [36, 11], [34, 12], [37, 12]] as [number, number][]) { if (v >= 5) p.gp(x, y, "#d8c4ff"); else p.p(x, y, "#4a4458"); }
    if (v >= 5) { p.gp(32, 11, "#8a6ae0"); p.gp(39, 11, "#8a6ae0"); }
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
  // Scenery, not a resource: an old stone long settled, broad and many-faced with its shoulders worn off, under moss.
  boulder: (v, _alt, M) => M(28, 22, (p, r) => {
    p.r(3, 18, 22, 4, "rgba(0,0,0,0.32)");
    paintRock(p, r, 28, 22, rockForm("boulder", ROCK_SEEDS.boulder[v % ROCK_SEEDS.boulder.length]), { cracks: 1, moss: { cols: MOSS, dens: 0.75 } });
    tufts(p, r, 1, 20, 26, 6);
  }),
  // Bedrock breaking the surface: one tilted mass with ledges stepping down either side of it.
  outcrop: (v, _alt, M) => M(48, 32, (p, r) => {
    p.r(4, 27, 40, 5, "rgba(0,0,0,0.32)");
    paintRock(p, r, 48, 32, rockForm("outcrop", ROCK_SEEDS.outcrop[v % ROCK_SEEDS.outcrop.length]), { cracks: 4, moss: { cols: MOSS, dens: 0.7 } });
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
};
