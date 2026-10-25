// Building: placement validity lives here (sim, testable headless), not in the
// renderer. The placement screen only asks `placement()` and, on confirm,
// starts a task whose `build` effect calls applyBuild (which re-validates).
import { RECIPES, BUILD_REACH } from "../content/build";
import { TS, isSolidT } from "../content/tiles";
import { propDef } from "../content/props";
import { emit, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { meets } from "./requirements";
import { countItem, removeItems } from "./inventory";
import { propBlocks } from "./collision";

export type BuildBlock = "unknown" | "cost" | "reach" | "solid" | "occupied";
export type Placement = { ok: true } | { ok: false; reason: BuildBlock };

export const BLOCK_TEXT: Record<BuildBlock, string> = {
  unknown: "YOU DON'T KNOW HOW TO BUILD THAT",
  cost: "NOT ENOUGH MATERIALS",
  reach: "TOO FAR AWAY",
  solid: "CAN'T BUILD THERE",
  occupied: "SOMETHING IS IN THE WAY",
};

/** Knowledge + materials, independent of where. */
export function canBuild(w: World, a: Actor, recipe: string): Placement {
  const r = RECIPES[recipe];
  if (!r || !meets(w, a, r.requires)) return { ok: false, reason: "unknown" };
  if (!r.cost.every((c) => countItem(a, c.item) >= c.n)) return { ok: false, reason: "cost" };
  return { ok: true };
}

/** Anchor (feet) of a prop built on a tile. */
export const buildAnchor = (tx: number, ty: number) => ({ x: tx * TS + 8, y: ty * TS + 14 });

/** The tile directly in front of the actor (default placement target). */
export function frontTile(a: Actor) {
  const fx = a.facing === "left" ? -1 : a.facing === "right" ? 1 : 0;
  const fy = a.facing === "up" ? -1 : a.facing === "down" ? 1 : 0;
  return { tx: Math.floor(a.x / TS) + fx, ty: Math.floor((a.y - 3) / TS) + fy };
}

/** Full validity check for placing `recipe` on tile (tx, ty). */
export function placement(w: World, a: Actor, area: Area, recipe: string, tx: number, ty: number): Placement {
  const can = canBuild(w, a, recipe);
  if (!can.ok) return can;
  const atx = Math.floor(a.x / TS), aty = Math.floor((a.y - 3) / TS);
  if (Math.max(Math.abs(tx - atx), Math.abs(ty - aty)) > BUILD_REACH) return { ok: false, reason: "reach" };
  if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h || isSolidT(area.grid[ty * area.w + tx])) return { ok: false, reason: "solid" };
  const x0 = tx * TS, y0 = ty * TS, x1 = x0 + TS, y1 = y0 + TS;
  for (const p of area.props) {
    // Rune circles keep a clear ring; any prop anchored on the tile or a blocking box overlapping it occupies it.
    if (propDef(p.kind).rune && Math.hypot(p.x - (x0 + 8), p.y - (y0 + 8)) < 40) return { ok: false, reason: "occupied" };
    if (p.x >= x0 && p.x < x1 && p.y > y0 && p.y <= y1 + 2 && !(p.taken && !propBlocks(p))) return { ok: false, reason: "occupied" };
    const b = p.box;
    if (b && propBlocks(p) && b[2] > x0 && b[0] < x1 && b[3] > y0 && b[1] < y1) return { ok: false, reason: "occupied" };
  }
  if (area.ritual) {
    const c = area.ritualPos;
    if (Math.hypot(c.x - (x0 + 8), c.y - (y0 + 8)) < 64) return { ok: false, reason: "occupied" };
  }
  // not on top of the builder
  if (a.x + 5 > x0 && a.x - 5 < x1 && a.y > y0 && a.y - 5 < y1) return { ok: false, reason: "occupied" };
  return { ok: true };
}

/** The `build` effect. Re-validates (the world may have changed since the order). */
export function applyBuild(w: World, a: Actor, area: Area, recipe: string, tx: number, ty: number) {
  const ok = placement(w, a, area, recipe, tx, ty);
  if (!ok.ok) { emit(w, { t: "message", text: BLOCK_TEXT[ok.reason] }); return; }
  const r = RECIPES[recipe];
  for (const c of r.cost) removeItems(a, c.item, c.n);
  const at = buildAnchor(tx, ty);
  const p = area.addProp(r.prop, at.x, at.y, r.lit ? { lit: true } : {});
  emit(w, { t: "built", actor: a.id, prop: p.id, x: p.x, y: p.y });
}
