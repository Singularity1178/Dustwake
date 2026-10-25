// Rune network travel. Interacting with an active rune runs a `channel` task
// whose `travel` effect lands here: resolve the link, wake a dormant partner if
// the link says so, find a free arrival spot next to the destination rune and
// move the actor with enterArea().
import { RUNE_NODES, runeAt, runeDestination, type RuneNode } from "../content/runes";
import { FLAGS } from "../content/flags";
import { emit, enterArea, getArea, hasFlag, setFlag, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { nearestFree, actorBoxes } from "./collision";

export const runeActive = (w: World, n: RuneNode) => hasFlag(w, n.flag);

/** Arrival spot for a rune: its prop position + offset, nudged to the nearest free spot. */
export function arrivalSpot(w: World, n: RuneNode) {
  const area = getArea(w, n.area);
  const p = area.prop(n.prop);
  if (!p) throw new Error(`rune ${n.id}: prop ${n.prop} missing in ${n.area}`);
  return nearestFree(area, p.x + n.arrive.dx, p.y + n.arrive.dy, actorBoxes(w, area.id)) ?? { x: p.x, y: p.y };
}

export function travel(w: World, a: Actor, area: Area, propId: string): boolean {
  const from = runeAt(area.id, propId);
  if (!from) return false;
  if (!runeActive(w, from)) { emit(w, { t: "message", text: "THE RUNE IS DARK AND SILENT" }); return false; }
  const dest = runeDestination(from.id);
  if (!dest) { emit(w, { t: "message", text: "THE RUNE LEADS NOWHERE" }); return false; }
  const to = dest.node;
  if (!runeActive(w, to)) {
    if (!dest.link.awakens) { emit(w, { t: "message", text: "NOTHING ANSWERS ON THE OTHER SIDE" }); return false; }
    setFlag(w, to.flag);
    emit(w, { t: "runeAwakened", rune: to.id });
  }
  const spot = arrivalSpot(w, to);
  enterArea(w, a, to.area, spot.x, spot.y);
  a.facing = to.arrive.facing;
  setFlag(w, FLAGS.tutorialDone);
  emit(w, { t: "travelled", actor: a.id, from: from.id, to: to.id, rune: to.prop });
  return true;
}

export { RUNE_NODES };
