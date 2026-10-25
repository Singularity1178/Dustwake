// Collision queries shared by locomotion, drop placement, travel arrival and
// build placement. Pure sim.
import { TS, isSolidT } from "../content/tiles";
import { HARVEST } from "../content/harvest";
import type { Area, PropInst } from "../world/area";

/** Does this prop currently block movement / placement? */
export const propBlocks = (p: PropInst) => !!p.box && !(p.taken && HARVEST[p.kind]?.clearBox);

/** Is a golem-sized box (10x5 px, feet at x,y) free of solid tiles and props? */
export function boxFree(area: Area, x: number, y: number) {
  const x0 = x - 5, x1 = x + 5, y0 = y - 5, y1 = y;
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++)
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++) {
      if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) return false;
      if (isSolidT(area.grid[ty * area.w + tx])) return false;
    }
  for (const p of area.props) {
    if (!propBlocks(p)) continue;
    const b = p.box!;
    if (x1 > b[0] && x0 < b[2] && y1 > b[1] && y0 < b[3]) return false;
  }
  return true;
}

/**
 * Nearest free standing spot to (x, y): the spot itself, else rings of
 * candidates 8 px apart in a fixed order. Deterministic; null if nothing free
 * within ~6 tiles.
 */
export function nearestFree(area: Area, x: number, y: number): { x: number; y: number } | null {
  if (boxFree(area, x, y)) return { x, y };
  for (let r = 1; r <= 12; r++) {
    for (let i = -r; i <= r; i++)
      for (const [dx, dy] of [[i, r], [i, -r], [r, i], [-r, i]] as [number, number][]) {
        const px = x + dx * 8, py = y + dy * 8;
        if (boxFree(area, px, py)) return { x: px, y: py };
      }
  }
  return null;
}
