import { TS, isOpaqueT } from "./content/tiles";

/** Anything with a tile grid and its dimensions (an Area). */
export interface TileGrid { grid: Uint8Array; w: number; h: number }

export interface Light {
  x: number; y: number; rad: number;
  r: number; g: number; b: number;
  int: number; flick: number;
  id?: string;
  on: boolean;
  cur: number;
  seed: number;
  vis: Float32Array;
  ox: number; oy: number; n: number;
  vx: number; vy: number;
}

export function makeLight(x: number, y: number, rad: number, col: [number, number, number], int: number, flick: number, id?: string): Light {
  return { x, y, rad, r: col[0], g: col[1], b: col[2], int, flick, id, on: true, cur: int, seed: Math.random() * 100, vis: new Float32Array(0), ox: 0, oy: 0, n: 0, vx: -999, vy: -999 };
}

export function computeVis(L: Light, area: TileGrid) {
  const { grid, w: MW, h: MH } = area;
  const R = Math.ceil(L.rad / TS) + 1;
  const ltx = Math.floor(L.x / TS), lty = Math.floor(L.y / TS);
  const n = 2 * R + 1;
  L.ox = ltx - R; L.oy = lty - R; L.n = n;
  if (L.vis.length !== n * n) L.vis = new Float32Array(n * n);
  const vis = L.vis;
  L.vx = L.x; L.vy = L.y;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const tx = L.ox + i, ty = L.oy + j;
      let v = 0;
      if (tx >= 0 && ty >= 0 && tx < MW && ty < MH) {
        const t = grid[ty * MW + tx];
        const x0 = tx * TS, y0 = ty * TS;
        let px: number, py: number;
        if (isOpaqueT(t)) {
          px = Math.min(Math.max(L.x, x0 + 1), x0 + 14);
          py = Math.min(Math.max(L.y, y0 + 1), y0 + 14);
        } else { px = x0 + 8; py = y0 + 8; }
        const dx = px - L.x, dy = py - L.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= L.rad + 16) {
          v = 1;
          const steps = Math.ceil(dist / 3);
          for (let s = 1; s < steps; s++) {
            const sx = L.x + (dx * s) / steps, sy = L.y + (dy * s) / steps;
            const cx = Math.floor(sx / TS), cy = Math.floor(sy / TS);
            if (cx === tx && cy === ty) break;
            if (cx === ltx && cy === lty) continue;
            if (isOpaqueT(grid[cy * MW + cx])) { v = 0; break; }
          }
        }
      }
      vis[j * n + i] = v;
    }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export class Lighting {
  ar: Float32Array; ag: Float32Array; ab: Float32Array;
  constructor(public W: number, public H: number) {
    this.ar = new Float32Array(W * H);
    this.ag = new Float32Array(W * H);
    this.ab = new Float32Array(W * H);
  }

  accumulate(lights: Light[], camX: number, camY: number) {
    const { W, H, ar, ag, ab } = this;
    ar.fill(0); ag.fill(0); ab.fill(0);
    for (const L of lights) {
      if (!L.on || L.cur <= 0.01) continue;
      const rad = L.rad, rad2 = rad * rad;
      const x0 = Math.max(0, Math.floor(L.x - rad - camX)), x1 = Math.min(W - 1, Math.ceil(L.x + rad - camX));
      const y0 = Math.max(0, Math.floor(L.y - rad - camY)), y1 = Math.min(H - 1, Math.ceil(L.y + rad - camY));
      if (x0 > x1 || y0 > y1) continue;
      const n = L.n, vis = L.vis, ox = L.ox, oy = L.oy;
      const lr = L.r * L.cur, lg = L.g * L.cur, lb = L.b * L.cur;
      for (let sy = y0; sy <= y1; sy++) {
        const wy = sy + camY;
        const dy = wy - L.y;
        const dy2 = dy * dy;
        if (dy2 >= rad2) continue;
        const gy = wy / TS - 0.5 - oy;
        const gy0 = Math.floor(gy);
        if (gy0 < 0 || gy0 >= n - 1) continue;
        const fy = gy - gy0;
        const r0 = gy0 * n, r1 = r0 + n;
        let i = sy * W + x0;
        for (let sx = x0; sx <= x1; sx++, i++) {
          const wx = sx + camX;
          const dx = wx - L.x;
          const d2 = dx * dx + dy2;
          if (d2 >= rad2) continue;
          const gx = wx / TS - 0.5 - ox;
          const gx0 = Math.floor(gx);
          if (gx0 < 0 || gx0 >= n - 1) continue;
          const fx = gx - gx0;
          const a0 = vis[r0 + gx0], a1 = vis[r0 + gx0 + 1], b0 = vis[r1 + gx0], b1 = vis[r1 + gx0 + 1];
          let v = (a0 + (a1 - a0) * fx) * (1 - fy) + (b0 + (b1 - b0) * fx) * fy;
          if (v <= 0.001) continue;
          v = v * v * (3 - 2 * v);
          let f = 1 - Math.sqrt(d2) / rad;
          f = f * f * v;
          ar[i] += f * lr; ag[i] += f * lg; ab[i] += f * lb;
        }
      }
    }
  }

  compose(scene: Uint8ClampedArray, emit: Uint8ClampedArray, out: Uint8ClampedArray, amb: [number, number, number], steps = 6) {
    const { W, H, ar, ag, ab } = this;
    for (let y = 0; y < H; y++) {
      const brow = (y & 3) * 4;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        const b = BAYER[brow + (x & 3)];
        let qr = Math.floor((amb[0] + ar[i]) * steps + b) / steps;
        let qg = Math.floor((amb[1] + ag[i]) * steps + b) / steps;
        let qb = Math.floor((amb[2] + ab[i]) * steps + b) / steps;
        if (qr > 1.5) qr = 1.5; if (qg > 1.5) qg = 1.5; if (qb > 1.5) qb = 1.5;
        out[o] = scene[o] * qr + emit[o];
        out[o + 1] = scene[o + 1] * qg + emit[o + 1];
        out[o + 2] = scene[o + 2] * qb + emit[o + 2];
        out[o + 3] = 255;
      }
    }
  }
}
