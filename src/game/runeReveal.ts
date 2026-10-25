// The surface rune's wear and re-awakening, as a pure model (no DOM): which
// carved pixels survived erosion, the order in which the awakening sweep
// redraws the rest, and the plants that grew over the missing carvings.
// Presentation (surfaceRune.ts) only rasterises this; the tests check it.
//
// - Every carved pixel gets a sweep key in [0, 1]. At awakening progress p a
//   pixel is visible if it survived or key <= p, so the sweep is monotonic and
//   p = 1 shows the full carved circle.
// - Survivors come from low-frequency noise sampled along the circle (arc
//   length x radius), thresholded at a fixed percentile: contiguous worn arcs,
//   broken spokes and the odd rune, not salt-and-pepper.
// - Plants grow in small clumps over the missing carvings (moss on the lines,
//   spreading past them, with tufts, ferns, flowers and creeping roots/vines).
//   A clump's key is the smallest key of the carvings it covers, so it clears
//   just as the sweep reaches it. A plant pixel is never drawn on a carving
//   that is currently visible. Growth on the rim outside the circle persists.
import { hash2 } from "./core/rng";

/** Fraction of carved pixels that survive erosion. */
export const RUNE_SURVIVE = 0.2;
/** Canvas half size the model is laid out in (matches circle.ts CR). */
export const RUNE_HALF = 64;
const S = RUNE_HALF * 2;

export interface RunePixel { x: number; y: number; key: number; survives: boolean }
export interface PlantPx { x: number; y: number; c: string }
export interface Clump { x: number; y: number; key: number; persist: boolean; px: PlantPx[] }
export interface RuneModel {
  pixels: RunePixel[];
  clumps: Clump[];
  /** Per canvas position (y * 128 + x): visibility threshold of a carving there (-1 survivor, 2 = no carving). */
  carvedAt: Float32Array;
}

const vnoise = (x: number, y: number, s: number) => {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let tx = x - x0, ty = y - y0;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
};

/**
 * Sweep order: the glow sets out from the top of the circle and runs down both
 * sides at once, its front leaning outward (inner lines light a little first).
 */
export function sweepRaw(x: number, y: number) {
  const ang = Math.abs(Math.atan2(x, -y)) / Math.PI; // 0 at the top, 1 at the bottom
  return 0.72 * ang + 0.28 * Math.min(1, Math.hypot(x, y) / 58);
}

const MOSS = ["#2e4a22", "#3e5e2a", "#527636", "#46622a"];
const BLADES = ["#4e7a3a", "#628e44", "#3a5e2c"];
const FLOWERS = ["#d8d0e8", "#e8c860", "#c86a8a", "#8ab0e8"];
const ROOT = ["#4a3420", "#3a2a18"];
const VINE = ["#2e3e1c", "#3a6228", "#4e7a34"];

export function runeModel(carved: { x: number; y: number }[]): RuneModel {
  // ---- erosion: noise along arc length (u) and radius (v), fixed percentile
  const wear = carved.map((p) => {
    const a = Math.atan2(p.y, p.x) + Math.PI, r = Math.hypot(p.x, p.y);
    return vnoise(a * 9, r / 4.5, 301) * 0.8 + vnoise(a * 3, r / 12, 302) * 0.2;
  });
  const sorted = wear.slice().sort((a, b) => a - b);
  const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - RUNE_SURVIVE)))];
  let maxRaw = 0;
  for (const p of carved) maxRaw = Math.max(maxRaw, sweepRaw(p.x, p.y));
  const pixels: RunePixel[] = carved.map((p, i) => ({ x: p.x, y: p.y, key: Math.min(1, sweepRaw(p.x, p.y) / maxRaw), survives: wear[i] > thr }));

  const carvedAt = new Float32Array(S * S).fill(2);
  const inCanvas = (x: number, y: number) => x >= -RUNE_HALF && y >= -RUNE_HALF && x < RUNE_HALF && y < RUNE_HALF;
  for (const p of pixels) carvedAt[(p.y + RUNE_HALF) * S + p.x + RUNE_HALF] = p.survives ? -1 : p.key;

  // ---- plants over the missing carvings, in 5px clumps
  const B = 5;
  const bins = new Map<number, RunePixel[]>();
  for (const p of pixels) {
    if (p.survives) continue;
    const k = Math.floor((p.y + RUNE_HALF) / B) * 64 + Math.floor((p.x + RUNE_HALF) / B);
    let l = bins.get(k);
    if (!l) bins.set(k, (l = []));
    l.push(p);
  }
  const clumps: Clump[] = [];
  for (const [k, list] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    const bx = (k % 64) * B - RUNE_HALF, by = Math.floor(k / 64) * B - RUNE_HALF;
    const cx = Math.round(list.reduce((s, p) => s + p.x, 0) / list.length), cy = Math.round(list.reduce((s, p) => s + p.y, 0) / list.length);
    const key = Math.min(...list.map((p) => p.key));
    const px: PlantPx[] = [];
    const put = (x: number, y: number, c: string) => { if (inCanvas(x, y)) px.push({ x, y, c }); };
    // moss along the lost line, spreading a little past it
    for (const p of list) {
      const h = hash2(p.x, p.y, 310);
      if (h < 0.9) put(p.x, p.y, MOSS[(h * 40) & 3]);
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        if ((i || j) && hash2(p.x + i, p.y + j, 311) < 0.16 / (Math.abs(i) + Math.abs(j))) put(p.x + i, p.y + j, MOSS[(hash2(p.x + i, p.y + j, 312) * 4) | 0]);
      }
    }
    // something taller on top
    const d = hash2(bx, by, 313), rr = (n: number) => hash2(bx + n, by - n, 314);
    if (d < 0.32) { // grass tuft
      for (let b = 0; b < 3 + ((rr(1) * 3) | 0); b++) { const x = cx - 2 + ((rr(b + 2) * 5) | 0), h = 2 + ((rr(b + 9) * 3) | 0); for (let j = 0; j < h; j++) put(x, cy - j, BLADES[(rr(b + j) * 3) | 0]); }
    } else if (d < 0.44) { // flowers
      const c = FLOWERS[(rr(3) * 4) | 0];
      for (let f = 0; f < 2; f++) { const x = cx - 2 + ((rr(f + 4) * 5) | 0), y = cy - 1 + ((rr(f + 6) * 3) | 0); put(x, y + 1, BLADES[2]); put(x, y, c); }
    } else if (d < 0.6) { // fern sprig
      for (let f = -1; f <= 1; f++) for (let s = 1; s <= 3; s++) put(cx + f * s, cy - s + (f === 0 ? -1 : 0), s === 3 ? "#5a8a4e" : "#3e6a3a");
    } else if (d < 0.78) { // a root or vine creeping away along the ground
      const vine = rr(5) < 0.5, ang = rr(6) * Math.PI * 2;
      let x = cx, y = cy;
      for (let s = 0; s < 6 + ((rr(7) * 6) | 0); s++) {
        put(Math.round(x), Math.round(y), vine ? VINE[s % 3 === 2 ? 2 : 0] : ROOT[s & 1]);
        x += Math.cos(ang + Math.sin(s * 0.9) * 0.8); y += Math.sin(ang + Math.sin(s * 0.9) * 0.8);
      }
    }
    clumps.push({ x: cx, y: cy, key, persist: false, px });
  }
  // moss over the dais: it clears the moment the glow first stirs
  {
    const px: PlantPx[] = [];
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) if (x * x + y * y <= 100 && hash2(x, y, 320) < 0.55) px.push({ x, y, c: MOSS[(hash2(x, y, 321) * 4) | 0] });
    clumps.push({ x: 0, y: 0, key: 0, persist: false, px });
  }
  // growth on the rim outside the circle: it stays when the rune is restored
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + hash2(i, 0, 330) * 0.12, r = 59.5 + hash2(i, 1, 330) * 3.5;
    const cx = Math.round(Math.cos(a) * r), cy = Math.round(Math.sin(a) * r);
    const px: PlantPx[] = [];
    const put = (x: number, y: number, c: string) => { if (inCanvas(x, y) && carvedAt[(y + RUNE_HALF) * S + x + RUNE_HALF] > 1) px.push({ x, y, c }); };
    for (let j = -1; j <= 1; j++) for (let k = -2; k <= 2; k++) if (hash2(cx + k, cy + j, 331) < 0.55) put(cx + k, cy + j, MOSS[(hash2(cx + k, cy + j, 332) * 4) | 0]);
    if (hash2(i, 2, 330) < 0.5) for (let b = 0; b < 3; b++) { const x = cx - 1 + b, h = 1 + ((hash2(i, b, 333) * 3) | 0); for (let j = 1; j <= h; j++) put(x, cy - j, BLADES[b % 3]); }
    clumps.push({ x: cx, y: cy, key: Infinity, persist: true, px });
  }
  return { pixels, clumps, carvedAt };
}

/** Is carved pixel `p` visible at awakening progress `t` (0 dormant .. 1 fully redrawn)? */
export const carvingVisible = (p: RunePixel, t: number) => p.survives || (t > 0 && p.key <= t);
/** Has clump `c` cleared at progress `t`? (Persisting rim growth never does.) */
export const clumpCleared = (c: Clump, t: number) => !c.persist && t > 0 && c.key <= t;
/** Should plant pixel `px` of clump `c` be drawn at progress `t`? Never over a visible carving. */
export function plantVisible(m: RuneModel, c: Clump, px: PlantPx, t: number) {
  if (clumpCleared(c, t)) return false;
  const k = m.carvedAt[(px.y + RUNE_HALF) * S + px.x + RUNE_HALF];
  return !(k < 2 && (k < 0 || (t > 0 && k <= t)));
}
