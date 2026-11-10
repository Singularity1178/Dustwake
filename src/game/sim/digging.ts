// Digging (content/digging.ts). One stroke of the right tool clears work from
// the layer a dig site has reached and pays what that layer is made of; when
// the column is through, the site opens and, if it is an entrance, so does the
// way between its two areas. Pure sim: any actor with the tool can dig.
//
// `digSpot` is the one place that knows a site is a prop. Everything after it
// works on a column and a depth, which is what a later "dig any tile" needs to
// return from the same function.
import { DIG_SITES, DIG_MATERIALS, digLayerAt, digTotal, type DigSiteDef } from "../content/digging";
import { ENTRANCES } from "../content/geography";
import { TOOL_TYPES } from "../content/tools";
import { TS, T } from "../content/tiles";
import { actorDef } from "../content/actors";
import type { Target } from "../content/tasks";
import type { Area, PropInst } from "../world/area";
import { emit, getArea, hasFlag, setFlag, type Actor, type World } from "../world/world";
import { giveItem } from "./inventory";
import { toolBonus } from "./tools";
import { actorBoxes, nearestFree } from "./collision";
import { actorMessage } from "./messages";

export interface DigSpot { prop: PropInst; def: DigSiteDef; layer: NonNullable<ReturnType<typeof digLayerAt>> }

/** What can be dug at a prop and how far it has got. Null: not a dig site, or already through. */
export function digSpot(area: Area, propId: string | undefined): DigSpot | null {
  const prop = propId ? area.prop(propId) : undefined, def = prop && DIG_SITES[prop.kind];
  if (!prop || !def || prop.open) return null;
  const layer = digLayerAt(def, prop.dmg);
  return layer ? { prop, def, layer } : null;
}

/** The RULES row for E on a dig site now: by the material of the layer reached. */
export function digRules(area: Area, propId: string | undefined): string | null {
  const s = digSpot(area, propId);
  return s ? DIG_MATERIALS[s.layer.material].rules : null;
}

/**
 * The `dig` effect: one stroke. Re-validates when it lands (the site, the
 * reach, the tool still fitted) and changes nothing if any of it fails. A
 * stroke never runs on into the next layer: that one needs its own tool.
 */
export function applyDig(w: World, a: Actor, area: Area, target?: Target): boolean {
  const spot = digSpot(area, target?.propId);
  if (!spot || a.area !== area.id) return false;
  const { prop, def, layer } = spot, mat = DIG_MATERIALS[layer.material];
  if (Math.hypot(prop.x - a.x, prop.y + def.dy - a.y) > def.reach + 12) return false;
  const power = toolBonus(a, mat.tool);
  if (power <= 0) { actorMessage(w, a, `THE ${mat.name} NEEDS A ${TOOL_TYPES[mat.tool].full} HEAD ON YOUR ARM`); return false; }
  const work = Math.min(power, layer.left);
  // Pay per whole unit of the layer crossed, like harvesting: fractional strokes conserve the total.
  const units = Math.floor(layer.into + work + 1e-9) - Math.floor(layer.into + 1e-9);
  const done = Math.round((prop.dmg + work) * 1e9) / 1e9;
  const through = done >= digTotal(def) - 1e-9;
  if (units > 0) giveItem(w, a, mat.yields, units);
  // (an opened site is also `lit`: whatever light its kind has wakes with it, like the stair head's ward glyph)
  area.setPropState(prop.id, through ? { dmg: done, open: true, lit: true } : { dmg: done });
  const after = through ? null : digLayerAt(def, done);
  emit(w, {
    t: "dug", actor: a.id, prop: prop.id, x: prop.x, y: prop.y + def.dy, material: layer.material, n: units,
    next: after && after.index !== layer.index ? after.material : undefined, opened: through,
  });
  if (through) {
    // The site is a hole now (PropKindDef.openBox): nobody is left standing in it.
    area.touch("layout");
    evict(w, area, prop);
    if (def.opens) openEntrance(w, a, def.opens);
  }
  return true;
}

/** Set every body that stands in a prop's footprint down on the nearest free ground, its south lip first. */
function evict(w: World, area: Area, p: PropInst) {
  const b = p.box;
  if (!b) return;
  for (const o of w.actors) {
    if (o.area !== area.id) continue;
    const [bw, bh] = actorDef(o).body.box;
    if (!(o.x + bw / 2 > b[0] && o.x - bw / 2 < b[2] && o.y > b[1] && o.y - bh < b[3])) continue;
    const spot = nearestFree(area, o.x, b[3] + bh + 1, actorBoxes(w, area.id, o.id), [bw, bh]);
    if (spot) { o.x = spot.x; o.y = spot.y; o.vx = 0; o.vy = 0; }
  }
}

export const entranceOpen = (w: World, id: string) => !!ENTRANCES[id] && hasFlag(w, ENTRANCES[id].flag);

/**
 * Open an entrance (content/geography.ts: ENTRANCES), once: its flag is set, so
 * both portals pass; at its lower end the fall is gone: the choked tiles are
 * floor, the rock that stood on them is removed, and its light comes on.
 */
export function openEntrance(w: World, by: Actor, id: string): boolean {
  const e = ENTRANCES[id];
  if (!e || hasFlag(w, e.flag)) return false;
  setFlag(w, e.flag);
  const below = getArea(w, e.below.area), c = e.below.clear;
  for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (below.tile(x, y) !== T.FLOOR) below.setTile(x, y, T.FLOOR);
  const x0 = c.x * TS - 8, x1 = (c.x + c.w) * TS + 8, y0 = c.y * TS - 4, y1 = (c.y + c.h) * TS + 8;
  for (const p of [...below.props]) if (e.below.removes.includes(p.kind) && p.x >= x0 && p.x <= x1 && p.y > y0 && p.y <= y1) below.removeProp(p.id);
  for (const p of below.props) if (p.kind === e.below.lights && !p.lit) below.setPropState(p.id, { lit: true });
  emit(w, { t: "entranceOpened", actor: by.id, entrance: id });
  return true;
}
