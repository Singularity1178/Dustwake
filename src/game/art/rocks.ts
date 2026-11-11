// Standing rock: the surface's rocks, iron veins, boulders and outcrops. Presentation only.
//
// A rock here is not a blob. It is a few convex chunks, each the solid left when
// a handful of planes are cut off a block (steep sides round the footprint,
// gentler shoulders, a tilted top), seen as the rest of the game is seen: from
// the south and above, a unit of height drawn a pixel up the screen. Every pixel
// casts a ray at the chunks; the plane it lands on gives the facet, and the
// facet's angle to one light (upper left, as every other sprite is lit) gives
// one of four tones. So a rock has a lit top, a front face, a side in shade and
// hard ridges where they meet, and no two shapes are the same ellipse.
//
// What is cut into the stone (cracks, ore seams, moss) is placed on the solid,
// not on the sprite: a seam is a sheet through the rock, so it runs across a
// facet, turns at the ridge and comes out the other side.
//
// The rounded stone of art/common.ts (stoneBlob) stays what loose stone is made
// of: rubble, rock piles, cairns, the fall on the stair.
import { mulberry } from "../util";
import type { Pen, Rng } from "../util";
import { S } from "./palette";

type V3 = readonly [number, number, number];
const unit = (x: number, y: number, z: number): V3 => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
/** Upper left and a little toward the viewer: tops brightest, west and south faces lit, east faces in shade. */
const LIGHT = unit(-0.45, 0.35, 0.82);

/** A convex chunk: the solid where n . P <= d for every plane, above the ground (x east, y south, z up; pixels). */
export interface Chunk { n: V3[]; d: number[] }
export interface ChunkOpt {
  /** Faces round the footprint. Few reads as a split block, many as a worn boulder. */
  sides?: number;
  /** How far the side faces lean in (radians off upright). */
  steep?: number;
  /** Gentler faces cut across the shoulders. */
  shoulders?: number;
  /** Tilt of the top face toward the east (negative: west). */
  lean?: number;
}

/** A chunk standing on the ground at (cx, cy): footprint radii rx, ry, height h. All its irregularity comes from `r`. */
export function chunk(r: Rng, cx: number, cy: number, rx: number, ry: number, h: number, o: ChunkOpt = {}): Chunk {
  const n: V3[] = [], d: number[] = [];
  const cut = (a: number, phi: number, px: number, py: number, pz: number) => {
    // the footprint is an ellipse, so a face's ground direction follows its gradient
    const gx = Math.cos(a) / rx, gy = Math.sin(a) / ry, gl = Math.hypot(gx, gy);
    const u = unit((gx / gl) * Math.cos(phi), (gy / gl) * Math.cos(phi), Math.sin(phi));
    n.push(u); d.push(u[0] * px + u[1] * py + u[2] * pz);
  };
  const sides = o.sides ?? 6, steep = o.steep ?? 0.26, ph = r() * 6.2832;
  for (let j = 0; j < sides; j++) {
    const a = ph + ((j + (r() - 0.5) * 0.8) / sides) * 6.2832, rho = 0.84 + r() * 0.22;
    cut(a, steep * (0.6 + r() * 0.8), cx + Math.cos(a) * rx * rho, cy + Math.sin(a) * ry * rho, 0);
  }
  for (let j = 0, k = o.shoulders ?? 3; j < k; j++) {
    const a = r() * 6.2832, at = 0.45 + r() * 0.25;
    cut(a, 0.7 + r() * 0.4, cx + Math.cos(a) * rx * at, cy + Math.sin(a) * ry * at, h * (0.72 + r() * 0.22));
  }
  const top = unit((r() - 0.5) * 0.5 + (o.lean ?? 0), (r() - 0.5) * 0.3, 1);
  n.push(top); d.push(top[0] * cx + top[1] * cy + top[2] * h);
  return { n, d };
}

export interface RockLook {
  /** Outline, shade, mid, light, highlight. The halls' stone ramp unless given. */
  ramp?: readonly string[];
  /** Fracture lines run down the lit faces. */
  cracks?: number;
  /** Moss on what faces the sky: colours dark to light, and how thick (0..1). */
  moss?: { cols: readonly string[]; dens: number };
  /** Ore: sheets (seams) through the solid and pockets in it. Colours shade, mid, light, glint, and the stain that runs down from it. */
  ore?: { cols: readonly string[]; seams: number; pockets: number };
}

/** Paint chunks into a w x h sprite: cast, shade, outline, then what is cut into the stone. */
export function paintRock(p: Pen, r: Rng, w: number, h: number, chunks: readonly Chunk[], look: RockLook = {}) {
  const N = w * h, tone = new Int8Array(N).fill(-1), who = new Int16Array(N), up = new Float32Array(N);
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    // The ray through this pixel: P(t) = (X, Y + t, t). Further along t is nearer the eye, so the last point
    // still inside a chunk is what shows.
    const X = sx + 0.5, Y = sy + 0.5, i = sy * w + sx;
    let best = 0, face: V3 | null = null, id = 0;
    chunks.forEach((c, ci) => {
      let far = 1e9, near = 0, f = -1;
      for (let k = 0; k < c.n.length; k++) {
        const nn = c.n[k], run = nn[1] + nn[2], b = c.d[k] - nn[0] * X - nn[1] * Y;
        if (run > 1e-6) { if (b / run < far) { far = b / run; f = k; } }
        else if (run < -1e-6) near = Math.max(near, b / run);
        else if (b < 0) return;
      }
      if (f < 0 || far <= near || far <= best) return;
      best = far; face = c.n[f]; id = ci * 32 + f;
    });
    if (!face) continue;
    const nn = face as V3, s = nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2];
    tone[i] = s > 0.8 ? 4 : s > 0.56 ? 3 : s > 0.28 ? 2 : 1;
    who[i] = id; up[i] = nn[2]; px[i] = X; py[i] = Y + best; pz[i] = best;
  }
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tone[y * w + x] >= 0;
  const edge = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (tone[i] < 0) continue;
    if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) { edge[i] = 1; continue; }
    // where one chunk stands in front of another, the one behind is lost in the crevice between them
    if (who[i] >> 5 !== who[i + w] >> 5 && pz[i] < pz[i + w] + 2) edge[i] = 1;
  }
  // a ridge catches the light: the last row of a face above a darker one is a tone brighter, and the foot of
  // the rock sits in its own shadow
  const lit = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (tone[i] < 0 || edge[i]) continue;
    if (tone[i + w] > 0 && !edge[i + w] && who[i + w] !== who[i] && tone[i + w] < tone[i]) lit[i] = 1;
    else if (pz[i] < 1.3 && tone[i] > 1) tone[i]--;
  }
  for (let i = 0; i < N; i++) if (lit[i]) tone[i] = Math.min(5, tone[i] + 1);
  // weathering: a few pits
  for (let i = 0; i < N; i++) if (tone[i] > 1 && tone[i] < 5 && !edge[i] && r() < 0.035) tone[i]--;
  // fractures: a line that starts on a lit face and runs down it, a pixel aside now and then
  for (let k = 0, tries = 0; k < (look.cracks ?? 0) && tries < 60; tries++) {
    let x = 2 + ((r() * (w - 4)) | 0), y = 1 + ((r() * (h - 6)) | 0);
    if (!solid(x, y) || edge[y * w + x] || tone[y * w + x] < 3) continue;
    k++;
    for (let s = 0, len = 3 + ((r() * 5) | 0); s < len && solid(x, y) && !edge[y * w + x]; s++) {
      tone[y * w + x] = tone[y * w + x] > 2 ? 1 : 0;
      y++; if (r() < 0.45) x += r() < 0.5 ? -1 : 1;
    }
  }
  const ramp = look.ramp ?? STONE;
  const col: (string | null)[] = new Array(N).fill(null);
  if (look.ore) {
    // seams: sheets through the solid, each a little warped; pockets: lumps of ore inside it
    const seams: { v: V3; c: number; t: number; wv: V3 }[] = [], pockets: [number, number, number, number][] = [];
    const inside: number[] = [];
    for (let i = 0; i < N; i++) if (tone[i] > 0 && !edge[i]) inside.push(i);
    const any = () => inside[(r() * inside.length) | 0] ?? 0;
    for (let k = 0; k < look.ore.seams; k++) {
      const a = (r() - 0.5) * 1.6 + (k & 1 ? 1.57 : 0), v = unit(Math.cos(a), 0.25 + r() * 0.5, Math.sin(a) * 0.9), i = any();
      seams.push({ v, c: v[0] * px[i] + v[1] * py[i] + v[2] * pz[i], t: 0.3 + r() * 0.2, wv: unit(r() - 0.5, r() - 0.5, r() - 0.5) });
    }
    for (let k = 0; k < look.ore.pockets; k++) { const i = any(); pockets.push([px[i], py[i], pz[i], 1 + r() * 0.7]); }
    const oc = look.ore.cols;
    for (const i of inside) {
      let ore = false;
      for (const s of seams) {
        const wob = Math.sin((s.wv[0] * px[i] + s.wv[1] * py[i] + s.wv[2] * pz[i]) * 0.9) * 0.7;
        if (Math.abs(s.v[0] * px[i] + s.v[1] * py[i] + s.v[2] * pz[i] - s.c + wob) < s.t) ore = true;
      }
      for (const q of pockets) if (Math.hypot(px[i] - q[0], py[i] - q[1], pz[i] - q[2]) < q[3]) ore = true;
      if (ore) col[i] = tone[i] <= 1 ? oc[0] : tone[i] === 2 ? oc[1] : r() < 0.25 ? oc[3] : oc[2];
    }
    // rust runs down from the ore over the face below it
    for (let y = h - 2; y > 0; y--) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (col[i] || tone[i] < 1 || edge[i] || up[i] > 0.7) continue;
      if (col[i - w] && col[i - w] !== oc[4] && r() < 0.4) col[i] = oc[4];
    }
  }
  if (look.moss) {
    // moss lies in cushions on what faces the sky, creeps a little over the rim, and leaves the steep faces bare
    const m = look.moss, a = r() * 6.28, b = r() * 6.28;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tone[i] < 0 || col[i]) continue;
      const lie = up[i] > 0.8 ? 1 : up[i] > 0.55 ? 0.5 : 0.03;
      const patch = Math.sin(px[i] * 0.55 + a) * Math.sin(py[i] * 0.8 + b) > 0.1 - m.dens * 0.5 ? 1 : 0.12;
      if (r() < m.dens * lie * patch) col[i] = m.cols[edge[i] ? 0 : tone[i] > 3 ? 2 + ((r() * 2) | 0) : 1 + ((r() * 2) | 0)];
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (tone[i] < 0) continue;
    p.p(x, y, col[i] ?? ramp[edge[i] ? 0 : tone[i]]);
  }
}

/** The halls' stone ramp (outline, shade, mid, light, highlight) and the glint a lit ridge takes. */
export const STONE = [S.o, S.d, S.m, S.l, S.h, "#a39cab"] as const;
/** Ironstone: the host rock of an iron vein, darker and warmer than the halls' stone so the ore shows against it. */
export const IRONSTONE = ["#120e12", "#2a242a", "#433a41", "#5e545a", "#7a7074", "#92888a"] as const;
/** Ore in the rock: shade, mid, light, glint, and the rust stain below it (the iron ore icon's colours). */
export const ORE = ["#6a3420", "#8e4a2a", "#c8783e", "#e0a060", "#4e3430"] as const;

/**
 * The shape of each variant, by kind: seeds picked by eye from a contact sheet
 * (`node scripts/rockPreview.mjs pick`). A seed is the whole shape: the chunks
 * below draw everything from it and nothing from the sprite's own rng, so a
 * variant can be reshaped by changing one number here.
 */
export const ROCK_SEEDS: Record<string, number[]> = {
  rock: [4, 16, 33, 27],
  ironore: [9, 4, 7],
  boulder: [1, 17, 25],
  outcrop: [1, 16],
};

/** Sprite size per kind (unchanged from the sprites these replace, so every footprint and anchor holds). */
export const ROCK_SIZE: Record<string, [number, number]> = { rock: [22, 18], ironore: [22, 18], boulder: [28, 22], outcrop: [48, 32] };

/** The chunks of one rock. Kinds differ in build, not only in size. */
export function rockForm(kind: string, seed: number): Chunk[] {
  const r = mulberry(seed * 7919 + kind.length * 104729);
  if (kind === "ironore") {
    // a vein stands up out of the ground: a tall broken tooth with a lower shelf against it and a fallen piece
    const side = r() < 0.5 ? -1 : 1, mx = 11 - side * (1 + r() * 1.5);
    return [
      chunk(r, mx, 11.8, 5.6 + r() * 1.2, 3.6, 9 + r() * 1.5, { sides: 5, steep: 0.18, shoulders: 2, lean: side * 0.35 }),
      chunk(r, mx + side * (5.5 + r()), 12.8, 4.6 + r(), 3, 4.5 + r() * 2, { sides: 5, steep: 0.24, shoulders: 1, lean: side * 0.2 }),
      chunk(r, mx - side * (5 + r()), 14, 2.6, 1.8, 2.2 + r(), { sides: 4, steep: 0.3, shoulders: 0 }),
    ];
  }
  if (kind === "boulder") {
    // an old stone, long settled: broad, many-faced, its shoulders worn off; a lesser one leaning on it
    const out = [chunk(r, 13 + r() * 2, 15.4, 10.5 + r() * 1.5, 4.9, 9 + r() * 2.5, { sides: 8, steep: 0.24, shoulders: 6 })];
    if (r() < 0.6) out.push(chunk(r, r() < 0.5 ? 6 : 22, 17, 4.5, 2.8, 3.5 + r() * 2, { sides: 6, steep: 0.32, shoulders: 3 }));
    return out;
  }
  if (kind === "outcrop") {
    // bedrock breaking the surface: one tilted mass with ledges stepping down either side of it
    const cx = 22 + r() * 4;
    return [
      chunk(r, cx, 22.5, 12 + r() * 2, 6.2, 14 + r() * 4, { sides: 7, steep: 0.22, shoulders: 4, lean: (r() - 0.5) * 0.6 }),
      chunk(r, cx - 13 - r() * 2, 25, 8.5 + r() * 2, 4.8, 7 + r() * 3, { sides: 6, steep: 0.24, shoulders: 2, lean: -0.2 }),
      chunk(r, cx + 13 + r() * 2, 25.4, 8.5 + r() * 2, 4.6, 6 + r() * 3, { sides: 6, steep: 0.24, shoulders: 2, lean: 0.2 }),
      chunk(r, cx + (r() - 0.5) * 16, 28.2, 5, 2.6, 3 + r() * 2, { sides: 5, steep: 0.3, shoulders: 1 }),
    ];
  }
  // a rock to be broken for stone: one block with clean faces, most with a piece already split from it
  const mx = 10 + r() * 2.5, out = [chunk(r, mx, 12.4, 7.4 + r() * 1.6, 4, 7.5 + r() * 2, { sides: 5 + ((r() * 2) | 0), steep: 0.17, shoulders: 2 + ((r() * 2) | 0), lean: (r() - 0.5) * 0.5 })];
  if (r() < 0.75) { const side = mx > 11 ? -1 : 1; out.push(chunk(r, mx + side * (6.5 + r() * 1.5), 13.6, 3.6 + r(), 2.6, 3 + r() * 2.5, { sides: 5, steep: 0.28, shoulders: 1 })); }
  return out;
}
