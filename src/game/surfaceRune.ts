// The surface rune circle: reclaimed by nature while dormant, redrawn by a
// sweep of light as it wakes.
//
// Layout (pure, deterministic — `runeLayout`): every carved pixel of the
// circle gets a sweep `key` in [0, 1) (clockwise from north, nudged outward
// with radius), and a `survive` flag chosen from hash noise along each
// feature (ring arcs, glyphs, spokes, diamond), so the fragments that remain
// are contiguous worn segments rather than speckle. Where carvings are missing,
// plant clumps (moss, tufts, ferns, flowers, vines, roots) grow along the lines
// and spill past them. A clump's key is the smallest key of any carving it
// covers, so it is gone exactly before the carving beneath it is redrawn.
// Clumps outside the circle (`keep`) survive activation.
//
// Rendering (`SurfaceRuneArt`): albedo (`scene`) and emissive (`emitSurv`,
// `emitRev`) layers, written as ImageData in one pass. Dormant (p = 0) and
// active (p = 1) renders are cached; in-between progress re-renders only when p
// changes. No per-frame pixel scans while idle.
import { CR, type CircleArt } from "./circle";
import { hash2, makeCanvas, mulberry } from "./util";

export interface RunePixel { x: number; y: number; key: number; survive: boolean }
export interface PlantPx { dx: number; dy: number; c: number }
export type PlantKind = "moss" | "tuft" | "fern" | "flowers" | "vine" | "roots";
export interface PlantClump {
  x: number; y: number; kind: PlantKind;
  /** Sweep progress at which it withers away (meaningless when `keep`). */
  key: number;
  /** Outside the circle: overgrowth that stays after activation. */
  keep: boolean;
  px: PlantPx[];
}
export interface RuneLayout { pixels: RunePixel[]; plants: PlantClump[] }

/** Width of the sweep's leading edge: plants wither and fresh carvings flare within it. */
export const SWEEP_FRONT = 0.07;
const RINGS = [57, 55, 44, 17, 11];
const TAU = Math.PI * 2;

/** Clockwise sweep order from north, slightly later further out. Always in [0, 0.985]. */
export function sweepKey(x: number, y: number): number {
  let t = (Math.atan2(y, x) + Math.PI / 2) / TAU;
  t -= Math.floor(t);
  return Math.min(0.985, t * 0.86 + Math.min(1, Math.hypot(x, y) / 60) * 0.12);
}

/** 1D value noise along a feature (contiguous segments). */
function seg(u: number, id: number, s: number) {
  const i = Math.floor(u), f = u - i, k = f * f * (3 - 2 * f);
  const a = hash2(i, id, s), b = hash2(i + 1, id, s);
  return a + (b - a) * k;
}

/** Which carved pixels survive erosion. */
function survives(x: number, y: number): boolean {
  const d = Math.hypot(x, y), ang = Math.atan2(y, x);
  let t = ang / TAU; t -= Math.floor(t);
  for (let ri = 0; ri < RINGS.length; ri++) {
    const R = RINGS[ri];
    if (Math.abs(d - R) <= 1.1) return seg((t * TAU * R) / 15, ri, 91) < 0.3;
  }
  if (d >= 45.5 && d <= 54) {
    const k = ((Math.round((ang - Math.PI / 24) / (TAU / 24)) % 24) + 24) % 24;
    return hash2(k, 0, 93) < 0.28;
  }
  // spokes: some keep a stub of their length
  const k8 = ((Math.round((ang - Math.PI / 8) / (TAU / 8)) % 8) + 8) % 8;
  const sa = (k8 / 8) * TAU + Math.PI / 8;
  const off = Math.abs(Math.sin(ang - sa)) * d;
  if (off < 1.6 && Math.cos(ang - sa) > 0) {
    if (hash2(k8, 1, 94) > 0.55) return false;
    const a0 = 18 + hash2(k8, 2, 94) * 16, len = 4 + hash2(k8, 3, 94) * 8;
    return d >= a0 && d <= a0 + len;
  }
  // the diamond between the sockets
  return seg(t * 48, 9, 95) < 0.22;
}

const PAL = {
  moss: [0x2a3c22, 0x3e5a2c, 0x557434, 0x76964a],
  grass: [0x2e4824, 0x3e5c2a, 0x4e7a3a, 0x628e44],
  fern: [0x26381f, 0x3e6a30, 0x5a8a40],
  flower: [0xd8d0e8, 0xe8c860, 0xc86a8a, 0x8ab0e8],
  vine: [0x24401f, 0x3c6230, 0x5e8a3e],
  root: [0x3a2a1a, 0x4a3420, 0x5a4430],
};

function makeClump(kind: PlantKind, x: number, y: number, tang: number, seed: number): PlantPx[] {
  const r = mulberry(seed), out: PlantPx[] = [];
  const put = (dx: number, dy: number, c: number) => out.push({ dx: Math.round(dx), dy: Math.round(dy), c });
  if (kind === "moss") {
    const rad = 1.5 + r() * 1.8;
    for (let j = -3; j <= 3; j++) for (let i = -4; i <= 4; i++) {
      const v = (i * i) / (rad * rad * 1.4) + (j * j) / (rad * rad);
      if (v > 1 || (v > 0.6 && r() < 0.4)) continue;
      put(i, j, PAL.moss[v > 0.7 ? 0 : r() < 0.2 ? 3 : r() < 0.6 ? 2 : 1]);
    }
  } else if (kind === "tuft") {
    for (let k = 0; k < 4 + ((r() * 3) | 0); k++) {
      const bx = ((r() * 5) | 0) - 2, h = 2 + ((r() * 3) | 0);
      for (let j = 0; j < h; j++) put(bx + (j === h - 1 && r() < 0.4 ? 1 : 0), -j, PAL.grass[j === 0 ? 0 : 1 + ((r() * 3) | 0)]);
    }
  } else if (kind === "fern") {
    for (let k = 0; k < 4; k++) {
      const a = Math.PI * (1.1 + k * 0.27) + (r() - 0.5) * 0.2;
      for (let i = 1; i <= 4; i++) put(Math.cos(a) * i, Math.sin(a) * i * 0.8 + (i * i) / 10, PAL.fern[i === 1 ? 0 : 1 + (i & 1)]);
    }
    put(0, 0, PAL.fern[0]);
  } else if (kind === "flowers") {
    const c = PAL.flower[(r() * 4) | 0];
    for (let k = 0; k < 3; k++) { const fx = ((r() * 5) | 0) - 2, fy = ((r() * 3) | 0) - 1; put(fx, fy + 1, PAL.grass[0]); put(fx, fy, c); }
    put(0, 1, PAL.grass[2]);
  } else {
    // vines and roots creep along the carving's direction
    const cols = kind === "vine" ? PAL.vine : PAL.root;
    let vx = 0, vy = 0;
    const len = 5 + ((r() * 5) | 0), dir = tang + (r() < 0.5 ? 0 : Math.PI);
    for (let i = 0; i < len; i++) {
      put(vx, vy, cols[0]);
      if (kind === "vine" && i % 2 === 1) put(vx, vy - 1, cols[1 + ((r() * 2) | 0)]);
      if (kind === "roots" && r() < 0.3) put(vx + 1, vy, cols[2]);
      vx += Math.cos(dir + (r() - 0.5) * 0.9); vy += Math.sin(dir + (r() - 0.5) * 0.9);
    }
  }
  // de-duplicate (later pixels win)
  const m = new Map<number, PlantPx>();
  for (const p of out) m.set((p.dy + 64) * 256 + p.dx + 64, p);
  void x; void y;
  return [...m.values()];
}

/** Deterministic layout of the surface rune: carvings with sweep keys and survival, plus plant clumps. */
export function runeLayout(carved: { x: number; y: number }[]): RuneLayout {
  const pixels: RunePixel[] = carved.map((p) => ({ x: p.x, y: p.y, key: sweepKey(p.x, p.y), survive: survives(p.x, p.y) }));
  const at = new Map<number, RunePixel>();
  for (const p of pixels) at.set((p.y + CR) * 256 + p.x + CR, p);
  const plants: PlantClump[] = [];
  const centres: { x: number; y: number }[] = [];
  const spaced = (x: number, y: number, s: number) => !centres.some((c) => (c.x - x) ** 2 + (c.y - y) ** 2 < s * s);
  const add = (x: number, y: number, kind: PlantKind, keep: boolean) => {
    const d = Math.hypot(x, y), tang = Math.atan2(y, x) + Math.PI / 2;
    const stay = keep && d > 58.5;
    const px = makeClump(kind, x, y, tang, (x + 97) * 7919 + (y + 61) * 104729)
      // surviving fragments stay clean and readable
      .filter((q) => !at.get((y + q.dy + CR) * 256 + x + q.dx + CR)?.survive)
      // overgrowth that stays never covers a carving (the active circle is clean)
      .filter((q) => !stay || (!at.has((y + q.dy + CR) * 256 + x + q.dx + CR) && Math.hypot(x + q.dx, y + q.dy) > 58.5))
      .filter((q) => Math.abs(x + q.dx) < CR && Math.abs(y + q.dy) < CR);
    if (!px.length) return;
    let key = stay ? 1 : sweepKey(x, y);
    if (!stay) for (const q of px) { const c = at.get((y + q.dy + CR) * 256 + x + q.dx + CR); if (c) key = Math.min(key, c.key); }
    centres.push({ x, y });
    plants.push({ x, y, kind, key: Math.max(0, key - 0.004), keep: stay, px });
  };
  const kindAt = (x: number, y: number, h: number): PlantKind => {
    const d = Math.hypot(x, y);
    if (d < 12) return h < 0.75 ? "moss" : "tuft";
    return h < 0.34 ? "moss" : h < 0.56 ? "tuft" : h < 0.68 ? "vine" : h < 0.78 ? "fern" : h < 0.9 ? "flowers" : "roots";
  };
  // 1) along every missing carving, in sweep order
  const missing = pixels.filter((p) => !p.survive).sort((a, b) => a.key - b.key || a.y - b.y || a.x - b.x);
  for (const p of missing) {
    if (!spaced(p.x, p.y, 3.4)) continue;
    add(p.x, p.y, kindAt(p.x, p.y, hash2(p.x, p.y, 301)), false);
  }
  // 2) spilling past the lines: scattered clumps over the whole disc and the dais
  for (let k = 0; k < 140; k++) {
    const a = hash2(k, 1, 302) * TAU, d = Math.sqrt(hash2(k, 2, 302)) * 57;
    const x = Math.round(Math.cos(a) * d), y = Math.round(Math.sin(a) * d);
    if (!spaced(x, y, 4.5)) continue;
    add(x, y, kindAt(x, y, hash2(k, 3, 302)), false);
  }
  // 3) an overgrown rim just outside the circle that stays once it wakes
  for (let k = 0; k < 70; k++) {
    const a = hash2(k, 4, 303) * TAU, d = 59.5 + hash2(k, 5, 303) * 3.5;
    const x = Math.round(Math.cos(a) * d), y = Math.round(Math.sin(a) * d);
    if (seg((a / TAU) * 14, 3, 304) < 0.45 || !spaced(x, y, 3.5)) continue;
    add(x, y, hash2(k, 6, 303) < 0.5 ? "tuft" : hash2(k, 7, 303) < 0.6 ? "moss" : "fern", true);
  }
  return { pixels, plants };
}

/** Is this carving drawn at sweep progress p? (survivors always; others once the sweep passes). */
export const carvingShown = (px: RunePixel, p: number) => px.survive || px.key < p;
/** Is this clump still (at least partly) there at progress p? */
export const plantShown = (c: PlantClump, p: number) => c.keep || c.key + witherSpan(c.key) > p;
/** The wither window, shortened near the end of the sweep so everything is gone at p = 1. */
export const witherSpan = (key: number) => Math.max(0.01, Math.min(SWEEP_FRONT, 1 - key));

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const GROOVE = rgb(0x120e16), WORN = rgb(0x221c26), LIP = rgb(0x5c5566), GLOW = rgb(0xa070ff), FRESH = rgb(0xe4d4ff);

type Layer = { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/** Cached, progressively revealed surface rune art. */
export class SurfaceRuneArt {
  readonly layout: RuneLayout;
  private readonly S = CR * 2;
  private dais: Uint8ClampedArray;
  private cache = new Map<string, Layer>();
  private live: { scene: Layer; rev: Layer; p: number } | null = null;
  private survLayer: Layer | null = null;
  /** Renders performed (for tests: idle frames must not re-render). */
  renders = 0;

  constructor(circle: Pick<CircleArt, "pixels">) {
    this.layout = runeLayout(circle.pixels);
    // the worn dais at the centre (stone, always present; moss sits on it while dormant)
    const S = this.S, d = new Uint8ClampedArray(S * S * 4);
    for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
      const r2 = x * x + y * y;
      if (r2 > 100) continue;
      const c = r2 <= 9 ? 0x0e0b10 : r2 > 72 ? 0x3a3542 : x + y < -4 ? 0x7a7484 : 0x5e5868;
      const n = (hash2(x, y, 310) - 0.5) * 14, o = ((y + CR) * S + x + CR) * 4, [R, G, B] = rgb(c);
      d[o] = R + n; d[o + 1] = G + n; d[o + 2] = B + n; d[o + 3] = 255;
    }
    this.dais = d;
  }

  private layer(): Layer { return makeCanvas(this.S, this.S); }

  private paintScene(L: Layer, p: number) {
    const S = this.S, img = L.ctx.createImageData(S, S), d = img.data;
    d.set(this.dais);
    const shown = new Uint8Array(S * S);
    for (const q of this.layout.pixels) if (carvingShown(q, p)) shown[(q.y + CR) * S + q.x + CR] = 1;
    const put = (x: number, y: number, c: [number, number, number]) => {
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      const o = (y * S + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    };
    for (const q of this.layout.pixels) {
      if (!carvingShown(q, p)) continue;
      const x = q.x + CR, y = q.y + CR;
      put(x, y, q.survive && p < 1 ? WORN : GROOVE);
      if (y + 1 < S && !shown[(y + 1) * S + x]) put(x, y + 1, LIP);
    }
    for (const c of this.layout.plants) {
      if (!plantShown(c, p)) continue;
      const age = c.keep ? 0 : Math.max(0, (p - c.key) / witherSpan(c.key)); // 0 fresh .. 1 gone
      for (let i = 0; i < c.px.length; i++) {
        const q = c.px[i];
        if (age > 0 && hash2(i, c.x * 31 + c.y, 311) < age) continue; // shrinking away
        let [R, G, B] = rgb(q.c);
        if (age > 0) { R = R + (120 - R) * age * 0.8; G = G + (96 - G) * age * 0.8; B = B + (50 - B) * age * 0.8; } // withering to straw
        put(c.x + q.dx + CR, c.y + q.dy + CR, [R, G, B]);
      }
    }
    L.ctx.putImageData(img, 0, 0);
    this.renders++;
  }

  private paintRev(L: Layer, p: number) {
    const S = this.S, img = L.ctx.createImageData(S, S), d = img.data;
    for (const q of this.layout.pixels) {
      if (q.survive || q.key >= p) continue;
      const fresh = p < 1 && q.key > p - SWEEP_FRONT;
      const c = fresh ? FRESH : GLOW, o = ((q.y + CR) * S + q.x + CR) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    L.ctx.putImageData(img, 0, 0);
    this.renders++;
  }

  /** Emissive glow of the surviving fragments (static). */
  emitSurv(): HTMLCanvasElement {
    if (!this.survLayer) {
      const L = this.layer(), S = this.S, img = L.ctx.createImageData(S, S), d = img.data;
      for (const q of this.layout.pixels) {
        if (!q.survive) continue;
        const o = ((q.y + CR) * S + q.x + CR) * 4;
        d[o] = GLOW[0]; d[o + 1] = GLOW[1]; d[o + 2] = GLOW[2]; d[o + 3] = 255;
      }
      L.ctx.putImageData(img, 0, 0);
      this.renders++;
      this.survLayer = L;
    }
    return this.survLayer.c;
  }

  private cached(key: string, paint: (L: Layer) => void): HTMLCanvasElement {
    let L = this.cache.get(key);
    if (!L) { L = this.layer(); paint(L); this.cache.set(key, L); }
    return L.c;
  }

  private liveAt(p: number) {
    if (!this.live) this.live = { scene: this.layer(), rev: this.layer(), p: -1 };
    if (this.live.p !== p) { this.paintScene(this.live.scene, p); this.paintRev(this.live.rev, p); this.live.p = p; }
    return this.live;
  }

  /** Albedo: dais, visible carvings, plants. */
  scene(p: number): HTMLCanvasElement {
    if (p <= 0) return this.cached("s0", (L) => this.paintScene(L, 0));
    if (p >= 1) return this.cached("s1", (L) => this.paintScene(L, 1));
    return this.liveAt(p).scene.c;
  }

  /** Emissive glow of the carvings the sweep has redrawn (fresh ones flare). */
  emitRev(p: number): HTMLCanvasElement {
    if (p <= 0) return this.cached("r0", (L) => this.paintRev(L, 0));
    if (p >= 1) return this.cached("r1", (L) => this.paintRev(L, 1));
    return this.liveAt(p).rev.c;
  }

  /** Fraction of carvings that survive while dormant. */
  get survivingFraction() { return this.layout.pixels.filter((q) => q.survive).length / this.layout.pixels.length; }
}
