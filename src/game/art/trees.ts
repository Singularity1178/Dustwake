// Trees and stumps: the surface's standing tree, the stump a felled one leaves, and the stump that stands on its
// own in the woods. Presentation only.
//
// Drawn the way the rocks are (art/rocks.ts): seen from the south and above, one light (upper left, a little toward
// the viewer: `LIGHT`, the same for every sprite), a dark outline round the silhouette, a ramp of tones, a seam
// where one mass stands in front of another, and the ground's own growth (moss, grass) at the foot.
//
//  - The CROWN is not a clover of flat discs. It is a heap of leaf masses, each a little ball in space; every pixel
//    casts a ray at the heap (`P(t) = (x, y + t, t)`, the last point inside a ball is what shows), and the ball's
//    surface angle to the light picks the tone, with a share of the whole crown's own dome so it reads as one
//    rounded mass lit from the upper left. Where one mass stands in front of another there is a dark seam.
//  - The TRUNK is a tapering round post, shaded across its width (light on the west, shade on the east), with
//    bark furrows running down it and roots flaring at the foot.
//
// One trunk, three users. `trunkSpan` is the only place the trunk's width is decided, and the tree, the stump left
// where a tree was felled (the tree's "taken" state) and the stump that stands in the woods are all painted from it,
// so a stump is exactly as thick as the tree it was cut from, at the height it was cut, and cannot drift from it.
import { hash2, mulberry } from "../util";
import type { Pen, Rng } from "../util";
import { WD } from "./palette";
import { LIGHT } from "./rocks";
import { MOSS } from "./overgrowth";
import type { PropArt } from "./common";

// ---------------------------------------------------------------------------------------------------- the trunk

/** Sprite sizes. The anchor of each is the middle of its bottom row, and the trunk stands on that column. */
export const TREE_SIZE = { w: 34, h: 44 } as const;
export const STUMP_SIZE = { w: 20, h: 19 } as const;

/** How far the trunk flares past its own width at the foot, by height (0 = the ground row), west and east. */
export interface Roots { l: number[]; r: number[] }
/** One set of roots a tree variant, so a tree and the stump of the same variant share a foot. */
export const ROOTS: Roots[] = [
  { l: [2, 1], r: [1, 1] },
  { l: [1, 1], r: [2, 1] },
  { l: [2, 1], r: [2, 1] },
];

/**
 * The trunk at height `z` (pixels above the ground row), as the first and last column it covers, counted from the
 * centre column, outline pixels included. Eight wide at the foot, seven from seven pixels up and six from eleven,
 * which is what a tree is under its crown. Roots add to the first rows.
 */
export function trunkSpan(z: number, roots: Roots): [number, number] {
  return [-4 + (z >= 7 ? 1 : 0) - (roots.l[z] ?? 0), 3 - (z >= 11 ? 1 : 0) + (roots.r[z] ?? 0)];
}

/** Bark: outline, shade, mid, light, highlight (the game's wood ramp). */
const BARK = [WD.o, WD.d, WD.m, WD.l, WD.h] as const;

/** The tone of the bark at column `xr` (counted from the centre) and height `z`, `k` columns in from the lit edge of `n` interior ones. */
function barkTone(k: number, n: number, xr: number, z: number, seed: number): number {
  const f = n > 1 ? k / (n - 1) : 0;
  let t = f < 0.25 ? 3 : f < 0.65 ? 2 : 1;
  // furrows: each column breaks into dark runs of its own length, so the bark runs down the trunk in strips
  const len = 3 + (xr & 1 ? 2 : 0) + (xr % 3 === 0 ? 1 : 0), off = Math.floor(hash2(xr, 7, seed) * len);
  if (hash2(xr, Math.floor((z + off) / len), seed + 1) < 0.34) t--;
  else if (hash2(xr, z, seed + 2) < 0.07) t++;
  return Math.max(1, Math.min(4, t));
}

/** Paint the trunk from the ground up to `zTop`. `dim(y)` darkens a row (the crown's shadow lies on the trunk under it). */
function paintTrunk(p: Pen, cx: number, gy: number, zTop: number, roots: Roots, seed: number, dim: (y: number) => number = () => 0) {
  for (let z = 0; z <= zTop; z++) {
    const y = gy - z, [l, rr] = trunkSpan(z, roots), n = rr - l - 1;
    for (let x = l; x <= rr; x++) {
      if (x === l || x === rr) { p.p(cx + x, y, BARK[0]); continue; }
      if (z === 0) { p.p(cx + x, y, BARK[1]); continue; }   // the foot sits in its own shade, not on a black plinth
      p.p(cx + x, y, BARK[Math.max(1, barkTone(x - l - 1, n, x, z, seed) - dim(y))]);
    }
  }
}

/** Moss creeping up the west foot of a trunk, thickest at the ground and thinning with height and toward the east. */
function mossFoot(p: Pen, r: Rng, cx: number, gy: number, roots: Roots, height: number, dens: number) {
  for (let z = 1; z <= height; z++) {
    const [l, rr] = trunkSpan(z, roots);
    for (let x = l + 1; x < rr; x++) {
      const reach = (x - l) / (rr - l), fade = 1 - z / (height + 1);
      if (r() < dens * fade * (1 - reach * 1.1) * (hash2(x >> 1, z >> 1, 91) * 0.7 + 0.5)) p.p(cx + x, gy - z, MOSS[1 + ((r() * 3) | 0)]);
    }
  }
}

/** Grass blades round a foot, leaving the trunk itself clear. */
function grassFoot(p: Pen, r: Rng, cx: number, gy: number, roots: Roots, reach: number, k: number) {
  const cols = ["#4e7a3a", "#628e44", "#3a5e2c"], [l, rr] = trunkSpan(0, roots);
  for (let i = 0; i < k; i++) {
    const west = r() < 0.5, d = 1 + ((r() * reach) | 0), x = cx + (west ? l - d : rr + d), h = 1 + ((r() * 3) | 0);
    p.r(x, gy + 1 - h, 1, h, cols[(r() * 3) | 0]);
  }
}

/** A soft shadow on the ground, thrown a little east (the light is in the west). */
function groundShadow(p: Pen, cx: number, gy: number, half: number) {
  const c = "rgba(0,0,0,0.35)";
  p.r(cx - half + 3, gy - 2, half * 2 - 3, 1, c);
  p.r(cx - half + 1, gy - 1, half * 2 + 1, 1, c);
  p.r(cx - half + 2, gy, half * 2, 1, c);
}

// ---------------------------------------------------------------------------------------------------- the crown

/** A leaf mass: a ball in space (x east, y south, z up; pixels). */
export interface Ball { x: number; y: number; z: number; R: number }

/** The envelope of a crown: centre row, half width and half height, how many big masses and rim lobes, and the big masses' radius. */
export interface Shape { cy: number; rx: number; ry: number; big: number; rim: number; bigR: number }
export const SHAPES: Shape[] = [
  { cy: 17.5, rx: 14.5, ry: 12.5, big: 17, rim: 12, bigR: 4.4 },
  { cy: 17.5, rx: 12.5, ry: 14, big: 17, rim: 12, bigR: 4.2 },
  { cy: 19, rx: 15.5, ry: 11.5, big: 18, rim: 12, bigR: 4.3 },
];
/** Picked by eye, like art/rocks.ts ROCK_SEEDS: `node scripts/treePreview.mjs pick` shows crowns a shape with their numbers. */
export const TREE_SEEDS: number[] = [17, 14, 24];

/** The leaf masses of one tree variant, from its seed and nothing else (not the sprite's rng). */
export function crownForm(v: number): Ball[] {
  const s = SHAPES[v % SHAPES.length], rr = mulberry(TREE_SEEDS[v % TREE_SEEDS.length] * 7919 + 13), balls: Ball[] = [];
  const cx = TREE_SIZE.w / 2, phase = rr() * 6.2832;
  // the dome: masses near the middle stand nearer the eye and higher, those at the rim fall away
  const place = (px: number, py: number, R: number) => {
    const u = (px - cx) / s.rx, w = (py - s.cy) / s.ry, dome = Math.sqrt(Math.max(0, 1 - u * u - w * w)), z = 9 + dome * 6 + (rr() - 0.5) * 5;
    balls.push({ x: px, y: py + z, z, R });
  };
  for (let k = 0; k < s.big; k++) {
    const rad = Math.sqrt((k + 0.6) / s.big), a = k * 2.39996 + phase, R = s.bigR + rr() * 0.9 - rad * 0.5;
    place(cx + Math.cos(a) * rad * (s.rx - R * 0.55), s.cy + Math.sin(a) * rad * (s.ry - R * 0.55), R);
  }
  for (let k = 0; k < s.rim; k++) {
    const a = phase + ((k + (rr() - 0.5) * 0.7) / s.rim) * 6.2832, R = 2.6 + rr() * 1.4;
    place(cx + Math.cos(a) * (s.rx - R * 0.75), s.cy + Math.sin(a) * (s.ry - R * 0.75), R);
  }
  return balls;
}

/** Leaf ramps: outline, deep shade, shade, mid, light, glint. Darker and bluer than the grass so a crown stands off it. */
export const LEAF: string[][] = [
  ["#0e1c10", "#1a3318", "#264d22", "#376a2e", "#52893c", "#7aa84e"],
  ["#141a0c", "#26361a", "#3a5222", "#55722c", "#788f38", "#a0b450"],
  ["#0c1a14", "#16301f", "#21472b", "#306438", "#46834a", "#6aa66a"],
];

/** Paint a heap of leaf masses into a w x h sprite: cast, shade, outline and seams, then leaf flecks. */
export function paintCrown(p: Pen, r: Rng, w: number, h: number, balls: readonly Ball[], ramp: readonly string[], shape: Shape) {
  const N = w * h, tone = new Int8Array(N).fill(-1), who = new Int16Array(N), depth = new Float32Array(N);
  const cx = w / 2;
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    const X = sx + 0.5, Y = sy + 0.5, i = sy * w + sx;
    let best = -1e9, id = -1, sNorm = 0;
    balls.forEach((b, bi) => {
      // |(X, Y + t, t) - C|^2 <= R^2 is a quadratic in t; the larger root is the point nearest the eye
      const dx = X - b.x, dy = Y - b.y, B = dy - b.z, c = dx * dx + dy * dy + b.z * b.z - b.R * b.R, disc = B * B - 2 * c;
      if (disc < 0) return;
      const t = (-B + Math.sqrt(disc)) / 2;
      if (t <= best) return;
      const nx = dx / b.R, ny = (Y + t - b.y) / b.R, nz = (t - b.z) / b.R;
      best = t; id = bi; sNorm = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
    });
    if (id < 0) continue;
    // the crown's own dome: lit on the upper left, shaded underneath and on the east
    const u = (X - cx) / shape.rx, v = (Y - shape.cy) / shape.ry, dome = 0.52 - 0.5 * (0.6 * u + 0.95 * v);
    const s = 0.68 * sNorm + 0.32 * dome + (hash2(sx, sy, 61) - 0.5) * 0.08;
    // a ball facing the eye is already well lit by this light, so the thresholds sit higher than the rocks'
    tone[i] = s > 0.92 ? 5 : s > 0.72 ? 4 : s > 0.5 ? 3 : s > 0.24 ? 2 : 1;
    who[i] = id; depth[i] = best;
  }
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tone[y * w + x] >= 0;
  const out = new Int8Array(N).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (tone[i] < 0) continue;
    out[i] = tone[i];
    if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) { out[i] = 0; continue; }
    // where one mass stands in front of another, the one behind is lost in the crevice between them
    if (y + 1 < h && who[i] !== who[i + w] && depth[i] < depth[i + w] - 1.5) out[i] = 1;
    else if (x + 1 < w && who[i] !== who[i + 1] && depth[i] < depth[i + 1] - 2.5) out[i] = 1;
  }
  // leaf flecks: short bright strokes where it is lit, a few dark ones in the shade
  const flecked = out.slice();
  for (let k = 0; k < 70; k++) {
    const x = 1 + ((r() * (w - 3)) | 0), y = 1 + ((r() * (h - 3)) | 0), i = y * w + x;
    if (flecked[i] < 2 || flecked[i + 1] < 2 || who[i] !== who[i + 1]) continue;
    if (flecked[i] >= 3 && flecked[i] === flecked[i + 1]) { out[i] = Math.min(5, flecked[i] + 1); if (r() < 0.6) out[i + 1] = Math.min(5, flecked[i + 1] + 1); }
    else if (flecked[i] === 2 && r() < 0.6) out[i] = 1;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = out[y * w + x]; if (t >= 0) p.p(x, y, ramp[t]); }
}

// ---------------------------------------------------------------------------------------------------- the cut

/** Wood of a cut face: shade (growth ring), mid, light, bright. Fresh is pale and wet, old has weathered grey. */
export const CUT_FRESH = ["#8e6a3e", "#b8935c", "#d2ae74", "#e8cc94"] as const;
export const CUT_OLD = ["#4e3d2a", "#6c5840", "#85704f", "#9c8760"] as const;

/**
 * The sawn top of a trunk cut at height `z`: an ellipse as wide as the trunk is at that height, a bark rim, the
 * wood inside with its rings and a split. Lit from the upper left like everything else.
 */
function paintCut(p: Pen, r: Rng, cx: number, gy: number, z: number, roots: Roots, fresh: boolean, moss: boolean) {
  const [l, rr] = trunkSpan(z, roots), rx = (rr - l + 1) / 2, ry = 3.3;
  const ccx = cx + (l + rr + 1) / 2, yb = gy - z, ccy = yb - ry + 0.5 - 0.35, wood = fresh ? CUT_FRESH : CUT_OLD;
  const inside = (x: number, y: number) => ((x + 0.5 - ccx) / rx) ** 2 + ((y + 0.5 - ccy) / ry) ** 2 <= 1;
  const crack = r() * 2 - 1, crackLen = 1.6 + r() * 1.4;
  for (let y = Math.floor(ccy - ry) - 1; y <= yb + 1; y++) for (let x = cx + l - 1; x <= cx + rr + 1; x++) {
    if (!inside(x, y)) continue;
    const dx = (x + 0.5 - ccx) / rx, dy = (y + 0.5 - ccy) / ry, d = Math.hypot(dx, dy);
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
      // the back and sides of the cut are outlined; its front edge is the bark's lit lip, which runs on into the body below
      p.p(x, y, dy > 0.45 && Math.abs(dx) < 0.85 ? (dx < 0.1 ? BARK[4] : BARK[3]) : WD.o);
      continue;
    }
    let c: string;
    if (d > 0.72) c = dy > 0.2 && dx > -0.3 ? BARK[1] : dx + dy < -0.3 ? BARK[3] : BARK[2];     // the bark rim, dark on the front and east
    else {
      // the cut face is too small for rings to read as rings (they came out as a face): it takes the light across
      // its width instead, brightest on the west, shaded on the east and the front, with the pith as one dark pixel
      c = dx + dy < -0.5 ? wood[2] : dx + dy * 0.6 > 0.45 ? wood[0] : wood[1];
      if (fresh && dx + dy < -0.9) c = wood[3];
      if (Math.abs(dx - 0.1) < 0.2 && Math.abs(dy + 0.1) < 0.3) c = wood[0];                  // the pith
      if (!fresh && Math.abs(dy - crack * dx) < 0.17 && d > 0.3 && d < 0.3 + crackLen * 0.25) c = wood[0];
    }
    p.p(x, y, c);
  }
  if (moss) {
    // moss gathers on the back rim and the west shoulder of an old stump
    for (let y = Math.floor(ccy - ry); y <= yb; y++) for (let x = cx + l; x <= cx + rr; x++) {
      if (!inside(x, y) || !inside(x - 1, y) || !inside(x, y - 1) || !inside(x + 1, y) || !inside(x, y + 1)) continue;
      const dx = (x + 0.5 - ccx) / rx, dy = (y + 0.5 - ccy) / ry;
      if (dx + dy * 0.6 < -0.25 && Math.hypot(dx, dy) > 0.45 && r() < 0.6) p.p(x, y, MOSS[1 + ((r() * 3) | 0)]);
    }
  }
}

/** A trunk snapped off short: the bark body, then a ragged slant of split fibres, rising toward the east, with one splinter standing out. */
function paintSnap(p: Pen, cx: number, gy: number, z: number, roots: Roots) {
  const [l, rr] = trunkSpan(z, roots), jag = [2, 3, 4, 6].slice(0, rr - l - 1), fibre = ["#d6bb88", "#b39662", "#85703f"], x0 = cx + l + 1;
  // the split wood: the lit west faces pale, the east ones in shade, with a dark fibre line down each
  jag.forEach((up, k) => {
    for (let j = 0; j < up; j++) p.p(x0 + k, gy - z - j, j === up - 1 && k < 2 ? fibre[0] : k === jag.length - 1 || (j + k) % 3 === 2 ? fibre[2] : k < 2 ? fibre[0] : fibre[1]);
  });
  // an outline along the tops and down the steps between them
  jag.forEach((up, k) => {
    p.p(x0 + k, gy - z - up, WD.o);
    const left = k === 0 ? 0 : jag[k - 1];
    for (let j = left; j < up; j++) p.p(x0 + k - 1, gy - z - j, WD.o);
  });
  p.p(cx + l, gy - z, WD.o);
  for (let j = 0; j <= jag[jag.length - 1]; j++) p.p(x0 + jag.length, gy - z - j, WD.o);
}

// ---------------------------------------------------------------------------------------------------- sprites

interface StumpLook { z: number; fresh: boolean; snapped?: boolean; moss?: boolean; chips?: boolean }
/** A stump, the same trunk as the tree's, cut or snapped at height `z`. */
function drawStump(p: Pen, r: Rng, v: number, o: StumpLook) {
  const { w, h } = STUMP_SIZE, cx = w >> 1, gy = h - 1, roots = ROOTS[v % ROOTS.length];
  groundShadow(p, cx, gy, 8);
  // the body runs up to the widest row of the cut (the ellipse's middle), where the cut face closes it
  paintTrunk(p, cx, gy, o.snapped ? o.z : o.z + 3, roots, 40 + v);
  if (o.moss) mossFoot(p, r, cx, gy, roots, Math.min(o.z - 1, 6), 0.55);
  if (o.snapped) paintSnap(p, cx, gy, o.z, roots);
  else paintCut(p, r, cx, gy, o.z, roots, o.fresh, !!o.moss);
  grassFoot(p, r, cx, gy, roots, 4, o.fresh ? 3 : 6);
  // what the axe took out of it: pale chips on the ground either side
  if (o.chips) for (const [x, y, c] of [[-7, 0, 2], [-6, 1, 1], [6, 0, 1], [7, 1, 2], [-5, 0, 0], [8, 0, 1]] as [number, number, number][]) p.p(cx + x, gy - y, ["#d2ae74", "#b8935c", "#e8cc94"][c]);
}

export const TREE_ART: Record<string, PropArt> = {
  tree: (v, alt, M) => {
    if (alt) return M(STUMP_SIZE.w, STUMP_SIZE.h, (p, r) => drawStump(p, r, v, { z: 8, fresh: true, chips: true }));
    const { w, h } = TREE_SIZE, shape = SHAPES[v % SHAPES.length], roots = ROOTS[v % ROOTS.length];
    return M(w, h, (p, r) => {
      const cx = w >> 1, gy = h - 1;
      groundShadow(p, cx, gy, 10);
      // the trunk, up under the crown; the crown's shadow lies on it
      paintTrunk(p, cx, gy, 24, roots, 40 + v, (y) => (y < 35 ? 1 : 0));
      if (v !== 1) mossFoot(p, r, cx, gy, roots, 7, 0.5);
      paintCrown(p, r, w, h, crownForm(v), LEAF[v % LEAF.length], shape);
      grassFoot(p, r, cx, gy, roots, 4, 5);
    });
  },
  stump: (v, _alt, M) => M(STUMP_SIZE.w, STUMP_SIZE.h, (p, r) => drawStump(p, r, v, v & 1 ? { z: 12, fresh: false, snapped: true, moss: true } : { z: 9, fresh: false, moss: true })),
};
