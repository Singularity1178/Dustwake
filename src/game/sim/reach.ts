// Reachability over an area's static layout (pure, no DOM). Flood-fills the
// standing positions of a golem-sized box (10x5 px, feet at x,y — the same box
// as sim/collision.ts) on a 4 px lattice, treating solid tiles and blocking
// prop boxes as walls. Builders and tests use it to prove there are no sealed
// pockets; it is also the obvious seed for a future nav grid.
import { TS, isSolidT } from "../content/tiles";
import { propDef } from "../content/props";
import { HARVEST } from "../content/harvest";

export interface ReachSource {
  w: number; h: number; grid: Uint8Array;
  props: { kind: string; x: number; y: number; taken?: boolean }[];
}

const STEP = 4;

export interface ReachMap {
  /** Is a golem standing with its feet at (x, y) px reachable? (nearest lattice point) */
  at(x: number, y: number): boolean;
  /** Is any reachable standing point within `r` px of (x, y)? */
  near(x: number, y: number, r: number): boolean;
  /** Reachable lattice points (for stats). */
  count: number;
}

/** Blocked-pixel bitmap of the static layout. */
export function blockedPixels(a: ReachSource): Uint8Array {
  const W = a.w * TS, H = a.h * TS, b = new Uint8Array(W * H);
  for (let ty = 0; ty < a.h; ty++) for (let tx = 0; tx < a.w; tx++) {
    if (!isSolidT(a.grid[ty * a.w + tx])) continue;
    for (let y = ty * TS; y < ty * TS + TS; y++) b.fill(1, y * W + tx * TS, y * W + tx * TS + TS);
  }
  for (const p of a.props) {
    const bx = propDef(p.kind).box;
    if (!bx || (p.taken && HARVEST[p.kind]?.clearBox)) continue;
    const x0 = Math.max(0, Math.floor(p.x - bx[0] / 2)), x1 = Math.min(W, Math.ceil(p.x + bx[0] / 2));
    const y0 = Math.max(0, Math.floor(p.y - bx[1])), y1 = Math.min(H, Math.ceil(p.y));
    for (let y = y0; y < y1; y++) if (x1 > x0) b.fill(1, y * W + x0, y * W + x1);
  }
  return b;
}

/** Flood fill from the standing point (fx, fy) px. */
export function reachFrom(a: ReachSource, fx: number, fy: number): ReachMap {
  const W = a.w * TS, H = a.h * TS, blk = blockedPixels(a);
  const LW = Math.floor(W / STEP) + 1, LH = Math.floor(H / STEP) + 1;
  const free = (lx: number, ly: number) => {
    const x = lx * STEP, y = ly * STEP;
    if (x - 5 < 0 || x + 5 > W || y - 5 < 0 || y > H) return false;
    for (let py = y - 5; py < y; py++) { const row = py * W; for (let px = x - 5; px < x + 5; px++) if (blk[row + px]) return false; }
    return true;
  };
  const seen = new Uint8Array(LW * LH);
  const sx = Math.round(fx / STEP), sy = Math.round(fy / STEP);
  const stack: number[] = [];
  let count = 0;
  if (free(sx, sy)) { seen[sy * LW + sx] = 1; stack.push(sy * LW + sx); }
  while (stack.length) {
    const i = stack.pop()!; count++;
    const lx = i % LW, ly = (i / LW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = lx + dx, ny = ly + dy;
      if (nx < 0 || ny < 0 || nx >= LW || ny >= LH) continue;
      const j = ny * LW + nx;
      if (seen[j]) continue;
      seen[j] = 2; // visited (blocked unless proven free)
      if (free(nx, ny)) { seen[j] = 1; stack.push(j); }
    }
  }
  const ok = (lx: number, ly: number) => lx >= 0 && ly >= 0 && lx < LW && ly < LH && seen[ly * LW + lx] === 1;
  return {
    count,
    at: (x, y) => ok(Math.round(x / STEP), Math.round(y / STEP)),
    near: (x, y, r) => {
      const R = Math.ceil(r / STEP), cx = Math.round(x / STEP), cy = Math.round(y / STEP);
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= R * R && ok(cx + i, cy + j)) return true;
      return false;
    },
  };
}
