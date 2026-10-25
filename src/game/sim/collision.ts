// Collision queries shared by locomotion, drop placement, travel arrival and
// build placement. Pure sim.
import { TS, isSolidT } from "../content/tiles";
import { HARVEST } from "../content/harvest";
import type { Area, PropInst } from "../world/area";
import type { Actor, World } from "../world/world";
import { npcDef } from "../content/npcs";
import type { Box } from "./reach";

/**
 * Body box [x0, y0, x1, y1] of an actor that blocks movement, or null. Today
 * that is NPCs, whose footprint comes from their NpcDef (same convention as
 * prop boxes: centred on x, ending at the feet). The golem itself has no body
 * box (two golems would need one; add it here when that happens).
 */
export function actorBox(a: Actor): Box | null {
  const d = a.kind === "npc" ? npcDef(a.npc) : undefined;
  if (!d) return null;
  return [a.x - d.box[0] / 2, a.y - d.box[1], a.x + d.box[0] / 2, a.y];
}

/** Blocking bodies of the actors in an area, except one (usually the mover). */
export function actorBoxes(w: World, areaId: string, except?: string): Box[] {
  const out: Box[] = [];
  for (const a of w.actors) {
    if (a.area !== areaId || a.id === except) continue;
    const b = actorBox(a);
    if (b) out.push(b);
  }
  return out;
}

/** Does this prop currently block movement / placement? */
export const propBlocks = (p: PropInst) => !!p.box && !(p.taken && HARVEST[p.kind]?.clearBox);

/** Is a golem-sized box (10x5 px, feet at x,y) free of solid tiles, props and the given actor bodies? */
export function boxFree(area: Area, x: number, y: number, bodies: readonly Box[] = []) {
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
  for (const b of bodies) if (x1 > b[0] && x0 < b[2] && y1 > b[1] && y0 < b[3]) return false;
  return true;
}

/**
 * Nearest free standing spot to (x, y): the spot itself, else rings of
 * candidates 8 px apart in a fixed order. Deterministic; null if nothing free
 * within ~6 tiles.
 */
export function nearestFree(area: Area, x: number, y: number, bodies: readonly Box[] = []): { x: number; y: number } | null {
  if (boxFree(area, x, y, bodies)) return { x, y };
  for (let r = 1; r <= 12; r++) {
    for (let i = -r; i <= r; i++)
      for (const [dx, dy] of [[i, r], [i, -r], [r, i], [-r, i]] as [number, number][]) {
        const px = x + dx * 8, py = y + dy * 8;
        if (boxFree(area, px, py, bodies)) return { x: px, y: py };
      }
  }
  return null;
}
