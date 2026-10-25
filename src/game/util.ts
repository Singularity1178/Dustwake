export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = () => number;

export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgb(r: number, g: number, b: number) {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function shade(c: string, f: number) {
  const [r, g, b] = hex(c);
  return rgb(clamp(r * f, 0, 255), clamp(g * f, 0, 255), clamp(b * f, 0, 255));
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Pixel painter writing either albedo or emissive layer. In emissive mode,
 * non-glowing pixels are written black so they occlude glow behind them. */
export class Pen {
  ox = 0;
  oy = 0;
  flip = false;
  constructor(public ctx: CanvasRenderingContext2D, public emit: boolean) {}
  private X(x: number, w: number) {
    return this.flip ? this.ox - x - w : this.ox + x;
  }
  r(x: number, y: number, w: number, h: number, c: string) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = this.emit ? "#000" : c;
    this.ctx.fillRect(Math.round(this.X(x, w)), Math.round(this.oy + y), w, h);
  }
  /** glowing pixels */
  g(x: number, y: number, w: number, h: number, c: string) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(this.X(x, w)), Math.round(this.oy + y), w, h);
  }
  p(x: number, y: number, c: string) {
    this.r(x, y, 1, 1, c);
  }
  gp(x: number, y: number, c: string) {
    this.g(x, y, 1, 1, c);
  }
  /** outlined box */
  o(x: number, y: number, w: number, h: number, fill: string, line = "#141016") {
    this.r(x, y, w, h, line);
    this.r(x + 1, y + 1, w - 2, h - 2, fill);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string, glow = false) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 400; i++) {
      if (glow) this.gp(x0, y0, c); else this.p(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

export interface Sprite {
  a: HTMLCanvasElement;
  e: HTMLCanvasElement;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export function makeSprite(
  w: number,
  h: number,
  ax: number,
  ay: number,
  seed: number,
  fn: (p: Pen, rng: Rng) => void
): Sprite {
  const A = makeCanvas(w, h);
  const E = makeCanvas(w, h);
  fn(new Pen(A.ctx, false), mulberry(seed));
  fn(new Pen(E.ctx, true), mulberry(seed));
  return { a: A.c, e: E.c, w, h, ax, ay };
}
