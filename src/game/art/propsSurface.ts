// Surface prop sprites (trees, rocks, foliage, ruins in the wild, the buried
// gate) plus the dungeon's collapsed-gate rock piles, which share the stone and
// overgrowth helpers. Registered into PROP_ART by art/props.ts.
import { hash2, rgb } from "../util";
import type { Pen, Rng } from "../util";
import { S, WD, IR } from "./palette";
import { stoneBlob, type PropArt } from "./common";
import { facetBody, paintStone, crackOn, traceOn, stoneTone, stepPix, stoneFall, type Facet, type StoneBody } from "./stone";

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

// ---- rocks and iron veins: the stone the golem breaks. Broken, faceted rock (art/stone.ts), where the boulders,
// outcrops and cairns that are only scenery stay round and water-worn (the stone blob): what can be worked reads
// as a node at a glance. Each variant is a rock of its own, not one shape nudged a pixel. Planes are listed back
// to front; tones 0-1 face the sky, 2 is the face towards the light, 3 the face away from it.
interface RockShape { w: number; h: number; facets: Facet[]; cracks: number[][] }
const ROCKS: RockShape[] = [
  // a squared block, its top tilted to the light and one corner sheared off
  { w: 22, h: 18, facets: [[0, 5,6, 10,2, 17,3, 13,9], [1, 17,3, 20,7, 13,9], [2, 2,10, 5,6, 13,9, 11,16, 5,16, 2,13], [3, 13,9, 20,7, 20,13, 17,16, 11,16]],
    cracks: [[9,4, 11,7, 12,9, 11,13], [5,10, 7,12, 6,15]] },
  // split in two: a tall shard, and the block that came away from it lying against its foot
  { w: 22, h: 19, facets: [[0, 3,9, 7,2, 11,6, 8,10], [2, 2,15, 3,9, 8,10, 7,17, 3,17], [3, 8,10, 11,6, 12,12, 11,17, 7,17],
      [0, 11,11, 15,8, 20,10, 16,13], [2, 10,14, 11,11, 16,13, 15,17, 11,17], [3, 16,13, 20,10, 21,14, 19,17, 15,17]],
    cracks: [[6,5, 7,9], [13,13, 13,16]] },
  // a low ledge of bedded stone, wider than it is tall, a slab of it slid off the front
  { w: 24, h: 16, facets: [[0, 3,8, 9,5, 18,4, 16,9, 7,10], [1, 18,4, 22,7, 16,9], [2, 2,11, 3,8, 7,10, 16,9, 15,13, 5,13], [3, 16,9, 22,7, 22,10, 19,13, 15,13],
      [0, 1,11, 4,10, 9,11, 6,13], [2, 1,11, 6,13, 9,11, 9,14, 2,14]],
    cracks: [[10,11, 15,11], [16,11, 21,9], [11,6, 12,8]] },
  // a tooth of rock with a splinter at its foot
  { w: 20, h: 22, facets: [[0, 6,10, 9,2, 10,10, 7,12], [1, 3,18, 6,10, 7,12, 10,10, 10,20, 5,20], [2, 9,2, 13,6, 12,11, 10,10], [3, 10,10, 12,11, 13,6, 16,12, 17,18, 14,20, 10,20],
      [0, 1,17, 3,15, 6,16, 4,18], [2, 1,17, 4,18, 6,16, 6,20, 2,20]],
    cracks: [[8,13, 7,17], [13,9, 14,14]] },
];
/** A vein: a rock, the seams of ore through it (a wide one is two pixels thick) and where the ore shows bright. */
interface VeinShape extends RockShape { veins: [wide: boolean, ...line: number[]][]; glints: [number, number][] }
const VEINS: VeinShape[] = [
  // a block peaked to the right, a thick seam down its near corner
  { w: 22, h: 18, facets: [[0, 3,8, 8,4, 15,2, 11,8], [1, 15,2, 19,5, 14,9, 11,8], [2, 2,12, 3,8, 11,8, 14,9, 12,16, 5,16], [3, 14,9, 19,5, 20,12, 17,16, 12,16]],
    cracks: [[5,9, 4,13]], veins: [[true, 8,5, 10,8, 9,12, 7,15], [false, 15,4, 16,8, 18,11, 17,14], [false, 3,10, 6,11, 9,10]], glints: [[9,7], [8,13], [17,10]] },
  // a spire, taller than it is wide, seamed from crown to root, a ledge broken off at its foot
  { w: 20, h: 23, facets: [[0, 6,9, 10,2, 13,6, 10,11], [2, 4,19, 4,12, 6,9, 10,11, 9,21, 5,21], [3, 10,11, 13,6, 15,12, 15,19, 13,21, 9,21],
      [0, 11,16, 14,14, 18,16, 15,18], [2, 11,16, 15,18, 15,21, 11,21], [3, 15,18, 18,16, 18,20, 15,21]],
    cracks: [[5,12, 5,16]], veins: [[true, 9,4, 9,10, 7,15, 6,20], [false, 12,6, 12,11, 14,15], [false, 12,18, 14,17, 17,18]], glints: [[9,7], [7,14], [13,16]] },
  // a low slab, wider than it is tall, with one thick seam bedded through it
  { w: 24, h: 15, facets: [[0, 2,8, 7,5, 16,4, 20,5, 12,9], [1, 20,5, 22,8, 12,9], [2, 2,8, 12,9, 11,13, 4,13, 2,11], [3, 12,9, 22,8, 22,10, 19,13, 11,13]],
    cracks: [[14,5, 15,8]], veins: [[true, 2,10, 7,10, 11,11, 16,10, 22,9], [false, 5,7, 9,7, 12,6], [false, 14,12, 17,12]], glints: [[5,10], [13,11], [19,9], [8,7]] },
];
/** Ore by the tone of the plane it crosses, and the rust it bleeds into the stone beside it. */
const RUST = ["#e09a58", "#d08848", "#b86a36", "#8e4a2a"], STAIN = ["#9c8684", "#8a7274", "#7e6668", "#5e484c"];

function drawRock(p: Pen, r: Rng, sh: RockShape): StoneBody {
  p.r(2, sh.h - 3, sh.w - 4, 3, "rgba(0,0,0,0.35)");
  const b = facetBody(sh.w, sh.h, sh.facets);
  paintStone(p, r, b);
  for (const c of sh.cracks) crackOn(p, b, c);
  return b;
}
/** Moss on a rock: thick on the planes that face the sky, a little creeping down the others. */
function mossOnStone(p: Pen, r: Rng, b: StoneBody, dens: number) {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const t = stoneTone(b, x, y);
    if (t < 0 || r() > (t <= 1 ? dens : dens * 0.15) * (hash2(x >> 1, y >> 1, 140) * 0.8 + 0.4)) continue;
    p.p(x, y, MOSS[(r() * 4) | 0]);
  }
}
/** Chips lying at a rock's foot. */
function scree(p: Pen, r: Rng, w: number, h: number, n: number, ore = false) {
  for (let i = 0; i < n; i++) { const x = 1 + ((r() * (w - 4)) | 0); p.r(x, h - 2, 2, 1, S.m); p.p(x, h - 2, ore && i & 1 ? RUST[2] : S.h); }
}
/** A rock broken up: a few sharp pieces and their chips (rust-streaked if it was a vein). */
function shards(p: Pen, r: Rng, ore: boolean) {
  for (let i = 0; i < 6; i++) {
    const x = 1 + ((r() * 13) | 0), y = 1 + ((r() * 5) | 0);
    if (i < 2) { p.r(x, y + 1, 4, 2, S.o); p.r(x, y, 3, 2, S.m); p.r(x, y, 2, 1, S.h); p.p(x + 2, y + 1, S.d); if (ore) p.p(x + 1, y + 1, RUST[1]); }
    else { p.r(x, y, 2, 1, S.l); p.p(x, y, S.h); p.p(x + 1, y + 1, S.d); if (ore && i & 1) p.p(x + 1, y, RUST[2]); }
  }
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
  // A rock veined with iron (one of three, by variant): seams of ore run through the stone along its breaks,
  // bright where they cross a lit plane and dark rust in the shade, and the stone beside them is stained with it.
  ironore: (v, alt, M) => {
    if (alt) return M(18, 8, (p, r) => shards(p, r, true));
    const sh = VEINS[v % VEINS.length];
    return M(sh.w, sh.h, (p, r) => {
      const b = drawRock(p, r, sh);
      const ore = new Set<number>();
      for (const [, ...line] of sh.veins) traceOn(b, line, (x, y) => ore.add(y * b.w + x));
      for (const i of ore) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const x = (i % b.w) + dx, y = ((i / b.w) | 0) + dy, t = stoneTone(b, x, y);
        if (t >= 0 && !ore.has(y * b.w + x) && r() < 0.4) p.p(x, y, STAIN[t]);
      }
      // a wide seam is the body of the ore: bright along its top, dark rust under it. The thin ones are stringers:
      // a tone duller, and broken, as a seam is that only shows where the rock happened to split along it.
      for (const [wide, ...line] of sh.veins) traceOn(b, line, (x, y, t) => {
        if (!wide) { if (hash2(x, y, 161) > 0.28) p.p(x, y, RUST[Math.min(3, t + 1)]); return; }
        if (stoneTone(b, x, y + 1) >= 0 && hash2(x, y, 162) > 0.2) p.p(x, y + 1, t >= 2 ? "#6e3a22" : RUST[3]);
        p.p(x, y, RUST[t]);
      });
      for (const [x, y] of sh.glints) if (stoneTone(b, x, y) >= 0) p.p(x, y, "#f4c88a");
      scree(p, r, sh.w, sh.h, 4, true);
      tufts(p, r, 1, sh.h - 1, sh.w - 2, 3);
    });
  },
  // A rock to break for stone (one of four, by variant; 2 and 3 are the mossed ones: all the woods have, some of the meadow's).
  rock: (v, alt, M) => {
    if (alt) return M(18, 8, (p, r) => shards(p, r, false));
    const sh = ROCKS[v % ROCKS.length];
    return M(sh.w, sh.h, (p, r) => {
      const b = drawRock(p, r, sh);
      if (v >= 2) { mossOnStone(p, r, b, 0.6); tufts(p, r, 1, sh.h - 1, sh.w - 2, 5); }
      else { scree(p, r, sh.w, sh.h, 3); tufts(p, r, 1, sh.h - 1, sh.w - 2, 2); }
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
  // 1-2 the turf cut and the earth going down; 3-4 the fallen vault laid bare, then broken through;
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
    // The stair's own steps where they show (broken through, and open): the stone of the flight below, pixel for
    // pixel (art/stone.ts: stepPix), going down away to the north from the south lip. Each step is a little
    // shorter, narrower and darker than the one above it, and the side walls' inner faces come into view as the
    // well deepens: the east wall's towards the light, the west wall's away from it. Returns where the last ends.
    const HS = [8, 7, 6, 5, 4, 3], DIM = [1, 0.86, 0.72, 0.58, 0.44, 0.31];
    const flight = (count: number) => {
      let y1 = Y1;
      for (let j = 0; j < count; j++) {
        const h = HS[j], y0 = y1 - h, wid = X1 - X0 - j * 2, f = DIM[j];
        for (let s = 0; s < h; s++) {
          for (let u = 0; u < wid; u++) { const c = stepPix(u, wid, s, h, 60 + j); p.p(X0 + j + u, y0 + s, rgb(c[0] * f, c[1] * f, c[2] * f)); }
          const k = f * (((y0 + s) & 7) === 7 ? 0.6 : 1);
          for (let i = 0; i < j; i++) { p.p(X0 + i, y0 + s, rgb(26 * k, 23 * k, 30 * k)); p.p(X1 - 1 - i, y0 + s, rgb(75 * k, 69 * k, 82 * k)); }
        }
        y1 = y0;
      }
      return y1;
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
    } else if (v <= 4) {
      // The vault that fell into the stairwell, laid bare: the same tumbled stone that chokes the stair's foot in
      // the halls below (art/stone.ts: stoneFall, the rock piles' boulders), earth packed between them, roots
      // through it. Then (4) broken through: the same fall with stones gone, most of them from the south lip where
      // the digging is, the dark of the stairwell in the gaps and the stair's own top steps bare under it.
      fill(Y0, Y1, EARTH[0], EARTH[1], "#241a12");
      p.r(X0, Y0, X1 - X0, 9, EARTH[1]); for (let x = X0; x < X1; x++) if (r() < 0.5) p.p(x, Y0 + 2 + ((r() * 6) | 0), EARTH[2]);
      p.r(X0, Y0, X1 - X0, 1, "#241a12"); p.r(X0, Y0 + 9, X1 - X0, 1, "#141016");
      if (v === 4) {
        for (let x = X0; x < X1; x++) { const top = Y0 + 21 + Math.round(Math.sin(x * 0.45) * 2 + hash2(x, 3, 163) * 3); p.r(x, top, 1, Y1 - top, "#07060a"); }
        flight(2);
      }
      for (let i = 0; i < 16; i++) { const x = X0 + ((r() * 56) | 0), y = Y0 + 11 + ((r() * (v === 4 ? 12 : 31)) | 0); p.r(x, y, 4, 2, r() < 0.5 ? "#4e3c2a" : "#5a4630"); }
      stoneFall(p, X0, Y0 + 9, X1 - X0, Y1 - Y0 - 9, v === 3 ? undefined : (fx, fy, i) => hash2(i, 1, 160) < 0.12 + 0.88 * Math.min(1, Math.max(0, 1.2 - fy * 1.45 + Math.abs(fx - 0.5) * 0.8)));
      for (let i = 0; i < 4; i++) { let x = X0 + 6 + ((r() * 46) | 0), y = Y0 + 10 + ((r() * 8) | 0); for (let k = 0; k < 7; k++) { p.p(x, y, "#3e2c1a"); x += ((r() * 3) | 0) - 1; y += 1; } }
      p.r(X0, Y0 + 10, 2, Y1 - Y0 - 10, "rgba(0,0,0,0.3)"); p.r(X1 - 2, Y0 + 10, 2, Y1 - Y0 - 10, "rgba(0,0,0,0.3)");
      kerb(1);
    } else {
      // Open: the flight going down under the lintel into the dark, between the side walls. Past the last step that
      // can be made out, two more nosings all but lost, and the walls running on down.
      p.r(X0, Y0, X1 - X0, Y1 - Y0, "#050408");
      const top = flight(HS.length), deep = HS.length;
      for (let y = Y0 + 5; y < top; y++) { p.r(X0, y, deep, 1, "#09080c"); p.r(X1 - deep, y, deep, 1, "#14111a"); }
      for (const [dy, f, id] of [[2, 0.17, 70], [4, 0.09, 71]]) {
        const wid = X1 - X0 - deep * 2;
        for (let u = 0; u < wid; u++) { const c = stepPix(u, wid, 0, 2, id); p.p(X0 + deep + u, top - dy, rgb(c[0] * f, c[1] * f, c[2] * f)); }
      }
      // the lintel's south face, the top of the far wall, over the dark: the halls' own stone, in the kerb's shade
      p.r(X0, Y0 + 1, X1 - X0, 4, "#322d38"); p.r(X0, Y0 + 1, X1 - X0, 1, S.m); p.r(X0, Y0 + 4, X1 - X0, 1, "#1c1820");
      for (let x = X0 + 9; x < X1; x += 12) p.r(x, Y0 + 2, 1, 2, "#1c1820");
      for (const [x, y] of [[18, 53], [47, 47], [33, 56]] as [number, number][]) { p.r(x, y, 2, 1, EARTH[2]); p.p(x, y, EARTH[3]); }
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
};
