// How the Throne's roads are dressed (westRoad.ts, throneRoad.ts). Pure; no DOM.
//
// A metalled road is cobbles, and cobbles do not blend into meadow the way earth does: the bake gives the ground
// styles soft, noise-warped borders between each other but a paved tile a hard one. So the road is not cut straight
// into the grass. A verge of bare earth runs along both edges (ragged: it comes and goes, and grass takes the rest),
// grass and weeds creep in over the kerb where the labour golems have not been round to pull them, moss sits in the
// joints, and pebbles and the odd tuft lie along the verge. Nothing here is scattered on the lanes themselves.
import { TS, T, FS } from "./content/tiles";
import { hash2 } from "./core/rng";
import { vnoise } from "./surface";
import type { AreaKit } from "./town";

export type IsLane = (x: number, y: number) => boolean;

/** The verge: one or two tiles of earth beside the paving, thinning out by noise, so the edge of the road is never a ruled line. */
export function verge(style: Uint8Array, grid: Uint8Array, W: number, H: number, isLane: IsLane, seed: number) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (grid[i] !== T.FLOOR || isLane(x, y)) continue;
    let d = 9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isLane(x + dx, y + dy)) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
    if (d > 2) continue;
    const n = vnoise(x, y, 3, seed), h = hash2(x, y, seed + 1);
    // the first tile is mostly earth, the second only where the carts have pulled over
    if (d === 1 ? h < 0.82 : n > 0.62 && h < 0.55) style[i] = h < 0.3 || d === 2 ? FS.DIRT : FS.EARTH;
  }
}

/** Grass over the kerb, moss in the joints, pebbles and tufts on the verge: decals on and beside the paving. */
export function dress(k: AreaKit, W: number, H: number, isLane: IsLane, seed: number) {
  const { grid, style, D } = k;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === T.FLOOR;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    const bx = x * TS, by = y * TS, r = hash2(x, y, seed + 2), r2 = hash2(x, y, seed + 3);
    if (isLane(x, y)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!at(x + dx, y + dy) || isLane(x + dx, y + dy) || hash2(x * 3 + dx, y * 3 + dy, seed + 4) > 0.5) continue;
        const ex = bx + 8 + dx * 7 + (dx ? 0 : (hash2(x, y, seed + 5) - 0.5) * 12), ey = by + 9 + dy * 7 + (dy ? 0 : (hash2(x, y, seed + 6) - 0.5) * 10);
        D(hash2(x, y, seed + 7) < 0.22 ? "weeds" : "tuft", ex, ey);
      }
      if (r < 0.045) D("mosspatch", bx + 8, by + 8, 1, 7 + r2 * 8);
      else if (r < 0.1) D("pebbles", bx + 3 + r2 * 10, by + 3 + hash2(x, y, seed + 8) * 10, 0);
      continue;
    }
    const s = style[y * W + x];
    if (s === FS.DIRT || s === FS.EARTH) {
      if (r < 0.1) D("pebbles", bx + 3 + r2 * 10, by + 4 + hash2(x, y, seed + 8) * 9, 0);
      else if (r < 0.18) D("tuft", bx + 3 + r2 * 10, by + 6 + hash2(x, y, seed + 9) * 9, 0);
    }
  }
}
