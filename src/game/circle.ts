import { makeCanvas, hash2 } from "./util";

export const CR = 64; // half size of circle canvas
export const GAP_A0 = (15 * Math.PI) / 180;
export const GAP_A1 = (75 * Math.PI) / 180;
import { SOCKET_R } from "./content/ritual";
export { SOCKET_R };

export interface CircleArt {
  base: HTMLCanvasElement; // carved grooves (non-gap) + dais
  chalk: HTMLCanvasElement; // gap guide marks (uncarved)
  gapCarved: HTMLCanvasElement;
  glow: HTMLCanvasElement; // emissive lines (non gap)
  glowGap: HTMLCanvasElement;
  ghost: HTMLCanvasElement;
  pixels: { x: number; y: number; gap: boolean }[];
}

export function inGap(dx: number, dy: number) {
  const a = Math.atan2(dy, dx);
  return a >= GAP_A0 && a <= GAP_A1 && dx * dx + dy * dy > 144;
}

/**
 * The carved grooves of a translocation circle, as a pure pixel set (no DOM):
 * key = y * 128 + x on the circle canvas, value = lies in the uncarved gap
 * (dungeon tutorial). Insertion order is the drawing order.
 */
export function circlePixelSet(): Map<number, boolean> {
  const S = CR * 2;
  const set = new Map<number, boolean>();
  const add = (x: number, y: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    set.set(y * S + x, inGap(x - CR, y - CR));
  };
  const ring = (r: number) => { for (let a = 0; a < Math.PI * 2; a += 0.5 / r) add(CR + Math.cos(a) * r, CR + Math.sin(a) * r); };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) add(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  };
  ring(57); ring(55); ring(44); ring(17); ring(11);
  // runes between rings
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + Math.PI / 24;
    const cx = Math.round(CR + Math.cos(a) * 49.5), cy = Math.round(CR + Math.sin(a) * 49.5);
    if (k % 6 === 5 || k % 6 === 0) { /* leave room for sockets */ }
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (hash2(k, (j + 1) * 3 + i + 1, 77) < 0.55) add(cx + i, cy + j);
    add(cx, cy - 2); 
  }
  // spokes
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    line(CR + Math.cos(a) * 17, CR + Math.sin(a) * 17, CR + Math.cos(a) * 44, CR + Math.sin(a) * 44);
  }
  // diamond between sockets
  const pts = [[0, -SOCKET_R], [SOCKET_R, 0], [0, SOCKET_R], [-SOCKET_R, 0]];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const sh = 0.16;
    line(CR + a[0] + (b[0] - a[0]) * sh, CR + a[1] + (b[1] - a[1]) * sh, CR + b[0] + (a[0] - b[0]) * sh, CR + b[1] + (a[1] - b[1]) * sh);
  }
  return set;
}

/** Carved pixels relative to the circle centre (the order buildCircle draws them in). */
export function circlePixels(): { x: number; y: number; gap: boolean }[] {
  const S = CR * 2, out: { x: number; y: number; gap: boolean }[] = [];
  for (const [k, gap] of circlePixelSet()) out.push({ x: (k % S) - CR, y: ((k / S) | 0) - CR, gap });
  return out;
}

export function buildCircle(): CircleArt {
  const S = CR * 2;
  const set = circlePixelSet();
  const mk = () => makeCanvas(S, S);
  const base = mk(), chalk = mk(), gapC = mk(), glow = mk(), glowGap = mk(), ghost = mk();
  // dais
  for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
    const d = x * x + y * y;
    if (d <= 100) {
      base.ctx.fillStyle = d <= 9 ? "#0e0b10" : d > 72 ? "#3a3542" : (x + y) < -4 ? "#7a7484" : "#5e5868";
      base.ctx.fillRect(CR + x, CR + y, 1, 1);
    }
  }
  const pixels: CircleArt["pixels"] = [];
  for (const [k, gap] of set) {
    const x = k % S, y = (k / S) | 0;
    pixels.push({ x: x - CR, y: y - CR, gap });
    const below = !set.has(k + S);
    const tgt = gap ? gapC.ctx : base.ctx;
    tgt.fillStyle = "#120e16"; tgt.fillRect(x, y, 1, 1);
    if (below) { tgt.fillStyle = "#5c5566"; tgt.fillRect(x, y + 1, 1, 1); }
    (gap ? glowGap : glow).ctx.fillStyle = "#a070ff";
    (gap ? glowGap : glow).ctx.fillRect(x, y, 1, 1);
    if (gap) {
      if ((x + y) % 2 === 0 && hash2(x, y, 3) < 0.7) { chalk.ctx.fillStyle = "#6e6a78"; chalk.ctx.fillRect(x, y, 1, 1); }
      if ((x + y) % 2 === 0) { ghost.ctx.fillStyle = "#5a46b0"; ghost.ctx.fillRect(x, y, 1, 1); }
    }
  }
  return { base: base.c, chalk: chalk.c, gapCarved: gapC.c, glow: glow.c, glowGap: glowGap.c, ghost: ghost.c, pixels };
}
