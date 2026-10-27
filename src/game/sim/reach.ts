// Walkable reachability over an area at tile granularity, using the same rule
// as locomotion (sim/collision.ts boxFree): a golem-sized 10x5 box must be
// free of solid tiles and blocking prop boxes. A cell is standable if the golem
// fits with its feet at the tile's centre; two neighbouring cells connect if
// the box stays free at every 4px along the straight step between them.
// Pure and deterministic; used by the surface builder (to open sealed pockets)
// and by the tests (to prove everything meaningful can be walked to).
import { TS, isSolidT } from "../content/tiles";

export type Box = [number, number, number, number];
export interface ReachGrid { w: number; h: number; grid: ArrayLike<number> }

/** Feet position used for a cell. */
export const cellFeet = (tx: number, ty: number) => ({ x: tx * TS + 8, y: ty * TS + 11 });

/** Is the golem box (feet at x, y) free? Same test as sim/collision.ts boxFree. */
export function freeAt(g: ReachGrid, boxes: readonly Box[], x: number, y: number, size: readonly [number, number] = [10, 5]): boolean {
  const x0 = x - size[0] / 2, x1 = x + size[0] / 2, y0 = y - size[1], y1 = y;
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++)
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++) {
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return false;
      if (isSolidT(g.grid[ty * g.w + tx])) return false;
    }
  for (const b of boxes) if (x1 > b[0] && x0 < b[2] && y1 > b[1] && y0 < b[3]) return false;
  return true;
}

/** Bucket boxes by tile so the flood fill stays cheap on big areas. */
function bucketBoxes(g: ReachGrid, boxes: Box[]) {
  const buckets = new Map<number, Box[]>();
  for (const b of boxes) {
    for (let ty = Math.floor(b[1] / TS) - 1; ty <= Math.floor(b[3] / TS) + 1; ty++)
      for (let tx = Math.floor(b[0] / TS) - 1; tx <= Math.floor(b[2] / TS) + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) continue;
        const k = ty * g.w + tx;
        let l = buckets.get(k);
        if (!l) buckets.set(k, (l = []));
        l.push(b);
      }
  }
  return (x: number, y: number) => buckets.get(Math.floor(y / TS) * g.w + Math.floor(x / TS)) ?? [];
}

/**
 * Flood fill from the cell containing `start` (px). Returns a per-tile array:
 * 1 = reachable standing cell, 0 = not.
 */
export function reachable(g: ReachGrid, boxes: Box[], start: { x: number; y: number }): Uint8Array {
  const near = bucketBoxes(g, boxes);
  const ok = (x: number, y: number) => freeAt(g, near(x, y), x, y);
  const stand = new Int8Array(g.w * g.h).fill(-1);
  const canStand = (tx: number, ty: number) => {
    const k = ty * g.w + tx;
    if (stand[k] < 0) { const f = cellFeet(tx, ty); stand[k] = ok(f.x, f.y) ? 1 : 0; }
    return stand[k] === 1;
  };
  const out = new Uint8Array(g.w * g.h);
  const sx = Math.floor(start.x / TS), sy = Math.floor((start.y - 3) / TS);
  if (sx < 0 || sy < 0 || sx >= g.w || sy >= g.h || !canStand(sx, sy)) return out;
  const q = [sy * g.w + sx];
  out[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!, tx = k % g.w, ty = (k / g.w) | 0;
    const a = cellFeet(tx, ty);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const nk = ny * g.w + nx;
      if (out[nk] || !canStand(nx, ny)) continue;
      let clear = true;
      for (let s = 4; s < TS; s += 4) if (!ok(a.x + dx * s, a.y + dy * s)) { clear = false; break; }
      if (!clear) continue;
      out[nk] = 1;
      q.push(nk);
    }
  }
  return out;
}

/** Is the point (px) within one tile of a reachable cell (i.e. something there can be walked up to)? */
export function nearReached(g: ReachGrid, reached: Uint8Array, x: number, y: number, rTiles = 1): boolean {
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  for (let j = -rTiles; j <= rTiles; j++) for (let i = -rTiles; i <= rTiles; i++) {
    const nx = tx + i, ny = ty + j;
    if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && reached[ny * g.w + nx]) return true;
  }
  return false;
}
