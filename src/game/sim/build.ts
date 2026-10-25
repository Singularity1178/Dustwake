// Building and deconstruction: placement validity, salvage rules and the two
// effects live here (sim, testable headless), not in the renderer. The build
// screens only ask `placement()` / `deconstructCheck()` and, on confirm, start
// a task whose effect re-validates when it fires (the world may have changed).
import { RECIPES, BUILD_REACH, AUTHORED_SALVAGE, placeRule, recipeForProp, type Cost, type Recipe } from "../content/build";
import { TS, T, isSolidT } from "../content/tiles";
import { propDef } from "../content/props";
import { emit, type Actor, type World } from "../world/world";
import type { Area, PropInst } from "../world/area";
import { meets } from "./requirements";
import { countItem, removeItems, giveItem, dropSpot, spawnLoose } from "./inventory";
import { actorBox, actorBoxes, propBlocks } from "./collision";
import type { Box } from "./reach";

export type BuildBlock = "unknown" | "cost" | "reach" | "solid" | "occupied" | "noWall" | "wallFace";
export type Placement = { ok: true } | { ok: false; reason: BuildBlock };

export const BLOCK_TEXT: Record<BuildBlock, string> = {
  unknown: "YOU DON'T KNOW HOW TO BUILD THAT",
  cost: "NOT ENOUGH MATERIALS",
  reach: "TOO FAR AWAY",
  solid: "CAN'T BUILD THERE",
  occupied: "SOMETHING IS IN THE WAY",
  noWall: "MUST HANG ON A WALL",
  wallFace: "ONLY ON A WALL FACE WITH FLOOR BELOW",
};

/** Knowledge + materials, independent of where. */
export function canBuild(w: World, a: Actor, recipe: string): Placement {
  const r = RECIPES[recipe];
  if (!r || !meets(w, a, r.requires)) return { ok: false, reason: "unknown" };
  if (!r.cost.every((c) => countItem(a, c.item) >= c.n)) return { ok: false, reason: "cost" };
  return { ok: true };
}

/** Anchor (feet) of a floor prop built on a tile. */
export const buildAnchor = (tx: number, ty: number) => ({ x: tx * TS + 8, y: ty * TS + 14 });
/**
 * Anchor of a recipe's prop on a tile. Wall props hang at the bottom edge of
 * their wall tile (tx*16+8, ty*16+16): the same anchor the dungeon builder gives
 * its wall torches, banners and chains, so they sort just in front of the wall.
 */
export function recipeAnchor(recipe: string, tx: number, ty: number) {
  const r = RECIPES[recipe];
  return r && placeRule(r) === "wall" ? { x: tx * TS + 8, y: ty * TS + 16 } : buildAnchor(tx, ty);
}

/** The tile directly in front of the actor (default placement target). */
export function frontTile(a: Actor) {
  const fx = a.facing === "left" ? -1 : a.facing === "right" ? 1 : 0;
  const fy = a.facing === "up" ? -1 : a.facing === "down" ? 1 : 0;
  return { tx: Math.floor(a.x / TS) + fx, ty: Math.floor((a.y - 3) / TS) + fy };
}
export const actorTile = (a: Actor) => ({ tx: Math.floor(a.x / TS), ty: Math.floor((a.y - 3) / TS) });
const inReach = (a: Actor, tx: number, ty: number) => {
  const t = actorTile(a);
  return Math.max(Math.abs(tx - t.tx), Math.abs(ty - t.ty)) <= BUILD_REACH;
};

/**
 * Space a floor recipe claims on tile (tx, ty), in px [x0, y0, x1, y1]: the
 * tile itself plus the prop's collision box (wide props like the bench and
 * the table spill into the neighbouring tiles).
 */
export function footprint(r: Recipe, tx: number, ty: number): Box {
  const x0 = tx * TS, y0 = ty * TS, x1 = x0 + TS, y1 = y0 + TS;
  const bx = propDef(r.prop).box;
  if (!bx) return [x0, y0, x1, y1];
  const a = buildAnchor(tx, ty);
  return [Math.min(x0, a.x - bx[0] / 2), Math.min(y0, a.y - bx[1]), Math.max(x1, a.x + bx[0] / 2), Math.max(y1, a.y)];
}

const overlaps = (a: Box, b: Box) => a[2] > b[0] && a[0] < b[2] && a[3] > b[1] && a[1] < b[3];

/** Blocking bodies of every actor in the area (the golem has no body box, so use its feet box). */
function bodies(w: World, area: Area): Box[] {
  const out = actorBoxes(w, area.id);
  for (const a of w.actors) if (a.area === area.id && !actorBox(a)) out.push([a.x - 5, a.y - 5, a.x + 5, a.y]);
  return out;
}

/** Where-only check for a floor recipe. */
function floorSite(w: World, area: Area, r: Recipe, tx: number, ty: number): Placement {
  if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h || isSolidT(area.grid[ty * area.w + tx])) return { ok: false, reason: "solid" };
  const fp = footprint(r, tx, ty);
  for (let y = Math.floor(fp[1] / TS); y <= Math.floor((fp[3] - 0.01) / TS); y++)
    for (let x = Math.floor(fp[0] / TS); x <= Math.floor((fp[2] - 0.01) / TS); x++)
      if (isSolidT(area.tile(x, y))) return { ok: false, reason: "solid" };
  const [x0, y0, x1, y1] = fp;
  for (const p of area.props) {
    // Rune circles keep a clear ring; any prop anchored in the footprint or a blocking box overlapping it occupies it.
    if (propDef(p.kind).rune && Math.hypot(p.x - (tx * TS + 8), p.y - (ty * TS + 8)) < 40) return { ok: false, reason: "occupied" };
    if (propDef(p.kind).wallMounted) continue;
    if (p.x >= x0 && p.x < x1 && p.y > y0 && p.y <= y1 + 2 && !(p.taken && !propBlocks(p))) return { ok: false, reason: "occupied" };
    if (p.box && propBlocks(p) && overlaps(p.box, fp)) return { ok: false, reason: "occupied" };
  }
  if (area.ritual) {
    const c = area.ritualPos;
    if (Math.hypot(c.x - (tx * TS + 8), c.y - (ty * TS + 8)) < 64) return { ok: false, reason: "occupied" };
  }
  // not on top of anyone (the builder included)
  for (const b of bodies(w, area)) if (overlaps(b, fp)) return { ok: false, reason: "occupied" };
  return { ok: true };
}

/**
 * Where-only check for a wall recipe. "On a wall" means the visible (south)
 * face of a plain WALL tile: the tile itself is WALL (not a door, cracked wall,
 * pillar or rubble, so tutorial walls are never covered) and the tile directly
 * below it is open floor, which is where the face shows and where the golem
 * stands to reach it. Side and back faces aren't drawn in this 3/4 view, so
 * they can't carry anything. One wall-mounted prop per face tile.
 */
function wallSite(area: Area, tx: number, ty: number): Placement {
  if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) return { ok: false, reason: "noWall" };
  if (area.tile(tx, ty) !== T.WALL) return { ok: false, reason: "noWall" };
  if (isSolidT(area.tile(tx, ty + 1))) return { ok: false, reason: "wallFace" };
  const ax = tx * TS + 8, ay = ty * TS + 16;
  for (const p of area.props) {
    if (propDef(p.kind).wallMounted && Math.abs(p.x - ax) < 12 && Math.abs(p.y - ay) < 8) return { ok: false, reason: "occupied" };
  }
  return { ok: true };
}

/** Is (tx, ty) a site this recipe could stand on (ignoring knowledge, cost and reach)? */
export function siteFor(w: World, area: Area, recipe: string, tx: number, ty: number): Placement {
  const r = RECIPES[recipe];
  if (!r) return { ok: false, reason: "unknown" };
  return placeRule(r) === "wall" ? wallSite(area, tx, ty) : floorSite(w, area, r, tx, ty);
}

/** Full validity check for placing `recipe` on tile (tx, ty). */
export function placement(w: World, a: Actor, area: Area, recipe: string, tx: number, ty: number): Placement {
  const can = canBuild(w, a, recipe);
  if (!can.ok) return can;
  if (!inReach(a, tx, ty)) return { ok: false, reason: "reach" };
  return siteFor(w, area, recipe, tx, ty);
}

/**
 * Where the placement ghost should start: the tile in front of the builder if
 * the recipe fits there, else the nearest fitting tile in reach (so a wall
 * torch's ghost snaps to the closest wall face), else the front tile.
 */
export function suggestTile(w: World, a: Actor, area: Area, recipe: string) {
  const f = frontTile(a), t = actorTile(a);
  if (siteFor(w, area, recipe, f.tx, f.ty).ok) return f;
  let best: { tx: number; ty: number } | null = null, bd = Infinity;
  for (let dy = -BUILD_REACH; dy <= BUILD_REACH; dy++)
    for (let dx = -BUILD_REACH; dx <= BUILD_REACH; dx++) {
      const tx = t.tx + dx, ty = t.ty + dy;
      const d = Math.hypot(tx - f.tx, ty - f.ty);
      if (d < bd && siteFor(w, area, recipe, tx, ty).ok) { bd = d; best = { tx, ty }; }
    }
  return best ?? f;
}

/** The `build` effect. Re-validates (the world may have changed since the order). */
export function applyBuild(w: World, a: Actor, area: Area, recipe: string, tx: number, ty: number) {
  const ok = placement(w, a, area, recipe, tx, ty);
  if (!ok.ok) { emit(w, { t: "message", text: BLOCK_TEXT[ok.reason] }); return; }
  const r = RECIPES[recipe];
  for (const c of r.cost) removeItems(a, c.item, c.n);
  const at = recipeAnchor(recipe, tx, ty);
  const p = area.addProp(r.prop, at.x, at.y, { recipe, ...(r.v ? { v: r.v } : {}), ...(r.lit ? { lit: true } : {}) });
  emit(w, { t: "built", actor: a.id, prop: p.id, x: p.x, y: p.y });
}

// ---------------------------------------------------------------- deconstruction
export type DeconBlock = "none" | "fixed" | "reach";
export type Deconstruct = { ok: true; prop: PropInst; refund: Cost[] } | { ok: false; reason: DeconBlock; prop?: PropInst };

export const DECON_TEXT: Record<DeconBlock, string> = {
  none: "NOTHING TO TAKE APART HERE",
  fixed: "THAT CAN'T BE TAKEN APART",
  reach: "TOO FAR AWAY",
};

/**
 * What taking a prop apart gives back, or null if it can't be. Built props
 * refund the full cost of the recipe that built them (older saves didn't record
 * it: fall back to the recipe for the kind). Authored props only if their kind
 * opts in through AUTHORED_SALVAGE (a recipe's full cost, or an explicit refund).
 */
export function salvageOf(p: PropInst): Cost[] | null {
  if (p.dyn) {
    const id = p.recipe && RECIPES[p.recipe] ? p.recipe : recipeForProp(p.kind);
    return id ? RECIPES[id].cost.map((c) => ({ ...c })) : null;
  }
  const s = AUTHORED_SALVAGE[p.kind];
  if (!s) return null;
  if ("refund" in s) return s.refund.map((c) => ({ ...c }));
  const r = RECIPES[s.recipe];
  return r ? r.cost.map((c) => ({ ...c })) : null;
}
export const isDeconstructable = (p: PropInst) => salvageOf(p) !== null;

/** Tile a prop is anchored in (wall props: their wall tile). */
export const propTile = (p: PropInst) => ({ tx: Math.floor(p.x / TS), ty: Math.floor((p.y - 1) / TS) });

/**
 * The prop a deconstruct cursor on tile (tx, ty) points at: one anchored in
 * the tile (deconstructable ones first), else one whose blocking box covers
 * it. Rune circles are never targets.
 */
export function deconTargetAt(area: Area, tx: number, ty: number): PropInst | null {
  const cands = area.props.filter((p) => !propDef(p.kind).rune && p.kind !== "pedestal");
  const anchored = cands.filter((p) => { const t = propTile(p); return t.tx === tx && t.ty === ty; });
  const pick = anchored.find(isDeconstructable) ?? anchored[0];
  if (pick) return pick;
  const r: Box = [tx * TS, ty * TS, tx * TS + TS, ty * TS + TS];
  const boxed = cands.filter((p) => p.box && propBlocks(p) && overlaps(p.box, r));
  return boxed.find(isDeconstructable) ?? boxed[0] ?? null;
}

/** Can actor `a` take apart prop `propId` right now? */
export function deconstructCheck(_w: World, a: Actor, area: Area, propId: string | undefined): Deconstruct {
  const p = propId ? area.prop(propId) : undefined;
  if (!p) return { ok: false, reason: "none" };
  const refund = salvageOf(p);
  if (!refund) return { ok: false, reason: "fixed", prop: p };
  const t = propTile(p);
  if (!inReach(a, t.tx, t.ty)) return { ok: false, reason: "reach", prop: p };
  return { ok: true, prop: p, refund };
}

/**
 * The `deconstruct` effect. Re-validates, removes the prop (its light and
 * interactables follow via area.revision), spills anything resting on or in
 * it onto the ground, then refunds the full recipe cost through giveItem, so a
 * full pack drops the overflow on the ground like any pickup.
 */
export function applyDeconstruct(w: World, a: Actor, area: Area, propId: string | undefined) {
  const chk = deconstructCheck(w, a, area, propId);
  if (!chk.ok) { emit(w, { t: "message", text: DECON_TEXT[chk.reason] }); return; }
  const p = chk.prop;
  const held = p.item && !p.taken ? p.item : undefined;
  area.removeProp(p.id);
  if (held) {
    const spot = dropSpot(area, a, actorBoxes(w, area.id, a.id));
    const x = spot ? spot.x : a.x, y = spot ? spot.y : a.y;
    spawnLoose(area, held, 1, x, y);
    emit(w, { t: "itemDropped", actor: a.id, item: held, n: 1, x, y, reason: "overflow" });
  }
  for (const c of chk.refund) giveItem(w, a, c.item, c.n);
  emit(w, { t: "deconstructed", actor: a.id, prop: p.id, kind: p.kind, x: p.x, y: p.y });
}
