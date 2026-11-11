// Stone that more than one sprite family draws, kept in one place so it is the same stone wherever it shows:
//   - faceted rock: the surface's rocks and iron veins (art/propsSurface.ts). Flat planes meeting at hard edges,
//     where the shared stone blob (art/common.ts) is a round, water-worn boulder.
//   - the steps of the stair between the halls and the surface: baked into the halls' floor (art/tiles.ts) and
//     drawn by the props at both ends (the foot in the Vestibule, the stair head above), all from `stepPix`.
//   - the fall: tumbled boulders filling a rect, the stone of the halls' rock piles (the stair head's stone layer).
// Presentation only.
import { clamp, hash2, mulberry, type Pen, type Rng } from "../util";
import { S } from "./palette";
import { stoneBlob } from "./common";

type C3 = [number, number, number];

// ---------------- Faceted rock ----------------
/** One flat plane of a rock: its tone (0 the lit top .. 3 the side in shadow), then its outline x0,y0,x1,y1,.. in sprite pixels. */
export type Facet = [tone: number, ...outline: number[]];
/** A rasterised rock: per pixel -1 nothing, -2 its outline, else the tone of the plane there. */
export interface StoneBody { w: number; h: number; tone: Int8Array }

/** Rasterise planes (later ones lie in front) and ring the whole with a one pixel outline. */
export function facetBody(w: number, h: number, facets: readonly Facet[]): StoneBody {
  const tone = new Int8Array(w * h).fill(-1);
  for (const [t, ...q] of facets) {
    const n = q.length >> 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = q[i * 2], yi = q[i * 2 + 1], xj = q[j * 2], yj = q[j * 2 + 1];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) tone[y * w + x] = t;
    }
  }
  const edge: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tone[y * w + x] !== -1) continue;
    if ((x > 0 && tone[y * w + x - 1] >= 0) || (x < w - 1 && tone[y * w + x + 1] >= 0) || (y > 0 && tone[(y - 1) * w + x] >= 0) || (y < h - 1 && tone[(y + 1) * w + x] >= 0)) edge.push(y * w + x);
  }
  for (const i of edge) tone[i] = -2;
  return { w, h, tone };
}

/**
 * The stone ramp the planes are painted from, index = tone + 1: a step to spare above the lit top (a ridge
 * catching the light) and below the shaded face (its foot, a crack). A rock's faces sit a step lighter than
 * the ramp's own names would put them, so a broken rock is as bright as the round boulders beside it.
 */
const FACE = ["#a8a1b0", S.h, "#7a7382", S.l, S.m, S.d, "#211d27"];
export const stoneTone = (b: StoneBody, x: number, y: number) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? -1 : b.tone[y * b.w + x]);

/**
 * Paint a rasterised rock. Each plane is one flat tone; what makes it read as broken stone is at the edges: the
 * rim towards the light (up and left, as the stone blob is lit) is a step brighter, so is the edge of any plane
 * that stands over a darker one (a ridge catches the light), and the foot and far side fall a step into shadow.
 */
export function paintStone(p: Pen, r: Rng, b: StoneBody) {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const t = b.tone[y * b.w + x];
    if (t === -1) continue;
    if (t === -2) { p.p(x, y, S.o); continue; }
    const up = stoneTone(b, x, y - 1), lf = stoneTone(b, x - 1, y), dn = stoneTone(b, x, y + 1), rt = stoneTone(b, x + 1, y);
    let k = t + 1;
    if (t <= 1 && (up === -2 || lf === -2)) k--;
    else if (dn > t || (t <= 1 && rt > t)) k--;
    else if (t >= 2 && (dn === -2 || rt === -2)) k++;
    const g = r();
    if (g < 0.07) k++; else if (g > 0.96 && t >= 1) k--;
    p.p(x, y, FACE[clamp(k, 0, 6)]);
  }
}

/** Walk a polyline (x0,y0,x1,y1,..) over a rock, calling `f` once for each pixel of it that lies on stone. */
export function traceOn(b: StoneBody, pts: readonly number[], f: (x: number, y: number, tone: number) => void) {
  const seen = new Set<number>();
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / n), y = Math.round(y0 + ((y1 - y0) * s) / n), t = stoneTone(b, x, y);
      if (t < 0 || seen.has(y * b.w + x)) continue;
      seen.add(y * b.w + x);
      f(x, y, t);
    }
  }
}

/** A crack: the darkest stone, a little less hard across a plane that faces the sky. */
export function crackOn(p: Pen, b: StoneBody, pts: readonly number[]) {
  traceOn(b, pts, (x, y, t) => p.p(x, y, FACE[Math.min(6, t + 5)]));
}

// ---------------- The stair's steps ----------------
/** A step's tread on screen, in pixels: two steps to a tile. */
export const STEP_PX = 8;
/** The kerb block that closes each end of a step, in pixels. */
const CHEEK = 3;

/**
 * One pixel of a step of the stair between the halls and the surface. The flight climbs south and is seen from
 * the south and above, so risers never show: a step is its tread, from a bright worn nosing (its north edge)
 * to the shadow the next step up drops across it. What makes it a stair and not a boarded floor: that shadow
 * is a gradient over the back of the tread, not a line; each step is closed at both ends by a kerb block of its
 * own; each is a stone of its own shade; and the flight is trodden pale and round-edged down the middle.
 *
 * `u` is the pixel across the flight (0 at its west edge) and `wid` the flight's width; `s` the row within the
 * step (0 the nosing) and `h` the rows the step shows (STEP_PX in the halls; fewer where the stair head draws
 * it sinking away); `id` tells one step from the next.
 */
export function stepPix(u: number, wid: number, s: number, h: number, id: number): C3 {
  const e = Math.min(u, wid - 1 - u), n = (hash2(u, s + id * 8, 151) - 0.5) * 6;
  const tone = (hash2(id, 3, 152) - 0.5) * 10;
  let v: number;
  if (e < CHEEK) {
    // the kerb: a block to a step, its top lit, a dark joint where it meets the tread
    const k = e === CHEEK - 1 ? -56 : s === h - 1 ? -46 : s === 0 ? 26 : e === 0 ? -16 : 6;
    v = 84 + k + tone * 0.6 + n;
  } else {
    const c = Math.abs(u - (wid - 1) / 2) / (wid / 2), worn = c < 0.3;
    const chip = hash2(u >> 1, id, 153) < 0.06, d = h - 1 - s;
    // down the tread: the nosing and its rounded lip, the flat of the step, then the shadow of the step above
    // deepening over its last rows. That sawtooth of light is what reads as a rise; a line would read as a joint.
    let k: number;
    if (s === 0) k = chip ? -24 : worn ? 30 : 38;
    else if (d === 0) k = -56;
    else if (s === 1 && h >= 6) k = chip ? 30 : worn ? 20 : 12;
    else if (d === 1) k = h >= 5 ? -30 : h === 4 ? -22 : -8;
    else if (d === 2) k = h >= 7 ? -16 : -10;
    else if (d === 3 && h >= 7) k = -6;
    else k = 0;
    // slab joints: hairlines across the flat of the tread only, two to a wide step and one to a narrow one, placed
    // by the step so they never line up into the bond of a wall
    const j1 = Math.floor(wid * (wid >= 40 ? 0.2 + 0.18 * hash2(id, 5, 154) : 0.32 + 0.36 * hash2(id, 5, 154)));
    const j2 = wid >= 40 ? Math.floor(wid * (0.6 + 0.18 * hash2(id, 7, 154))) : -9;
    if ((u === j1 || u === j2) && s >= 1 && d >= 2) k -= 10;
    const sp = hash2(u, s + id * 8, 155), blot = (hash2(u >> 2, (s >> 1) + id * 4, 156) - 0.5) * 8;
    v = 96 + tone + k + (worn ? 6 : c < 0.42 ? 3 : 0) + (sp < 0.045 ? -13 : sp > 0.97 ? 9 : 0) + blot + n;
  }
  // whole values: the bake rounds what it is given and a sprite's pen truncates, and both must land on the same pixel
  v = Math.round(v);
  return [v, Math.round(v * 0.955), Math.round(v * 1.085)];
}

// ---------------- The fall ----------------
/**
 * Tumbled stone filling a rect: the boulders of the halls' rock piles (the same stone blob), packed, the nearer
 * over the farther. Round stone only: a squared block among them reads as brickwork. The fall is always the
 * same fall: `keep` (by where a stone lies, 0..1 across and down the rect) only says which stones are still
 * there, so a later dig stage shows it with stones gone, not a new heap.
 */
export function stoneFall(p: Pen, x0: number, y0: number, w: number, h: number, keep: (fx: number, fy: number, i: number) => boolean = () => true) {
  const g = mulberry(0x57a1), cols = Math.max(1, Math.round(w / 9)), rows = Math.max(1, Math.round(h / 7));
  const rocks: { i: number; x: number; y: number; w: number; h: number }[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const rw = 7 + ((g() * 7) | 0), rh = clamp(rw - 1 - ((g() * 3) | 0), 6, 11);
    const cx = x0 + ((i + 0.5 + (j & 1 ? 0.25 : -0.25)) * w) / cols + (g() - 0.5) * 4, cy = y0 + ((j + 0.5) * h) / rows + (g() - 0.5) * 3;
    rocks.push({ i: rocks.length, x: clamp(Math.round(cx - rw / 2), x0, x0 + w - rw), y: clamp(Math.round(cy - rh / 2), y0, y0 + h - rh), w: rw, h: rh });
  }
  rocks.sort((a, b) => a.y + a.h - (b.y + b.h) || a.i - b.i);
  for (const k of rocks) if (keep((k.x + k.w / 2 - x0) / w, (k.y + k.h / 2 - y0) / h, k.i)) stoneBlob(p, k.x, k.y, k.w, k.h, mulberry(0x9000 + k.i));
}
