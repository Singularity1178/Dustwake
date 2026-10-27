// Rune network travel. Interacting with an active rune runs a `channel` task
// whose `travel` effect lands here: resolve the link, wake a dormant partner if
// the link says so, find a free arrival spot next to the destination rune and
// move the actor with enterArea().
import { RUNE_NODES, runeAt, runeDestination, runeDestinations, type RuneNode } from "../content/runes";
import { FLAGS } from "../content/flags";
import { emit, enterArea, getArea, hasFlag, setFlag, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { nearestFree, actorBoxes } from "./collision";
import { actorDef, capable } from "../content/actors";
import type { Point } from "../world/jobs";
import { powered } from "./actorStats";
import { actorMessage } from "./messages";

export const runeActive = (w: World, n: RuneNode) => hasFlag(w, n.flag);

/** Arrival spot for a rune: its prop position + offset, nudged to the nearest free spot. */
export function arrivalSpot(w: World, n: RuneNode): Point;
export function arrivalSpot(w: World, n: RuneNode, actor: Actor): Point | null;
export function arrivalSpot(w: World, n: RuneNode, actor?: Actor): Point | null {
  const area = getArea(w, n.area);
  const p = area.prop(n.prop);
  if (!p) {
    if (actor) return null;
    throw new Error(`rune ${n.id}: prop ${n.prop} missing in ${n.area}`);
  }
  const spot = nearestFree(area, p.x + n.arrive.dx, p.y + n.arrive.dy, actorBoxes(w, area.id, actor?.id), actor ? actorDef(actor).body.box : undefined);
  if (!spot && !actor) throw new Error(`rune ${n.id}: no free arrival`);
  return spot;
}

export function travel(w: World, a: Actor, area: Area, propId: string, destination?: string): boolean {
  if (!capable(a, "travel") || !powered(a) || a.area !== area.id) return false;
  const from = runeAt(area.id, propId);
  if (!from) return false;
  if (!runeActive(w, from)) { actorMessage(w, a, "THE RUNE IS DARK AND SILENT"); return false; }
  const dest = runeDestination(from.id, destination);
  if (!dest) { actorMessage(w, a, "THE RUNE LEADS NOWHERE"); return false; }
  const to = dest.node;
  const spot = arrivalSpot(w, to, a);
  if (!spot) return false;
  if (!runeActive(w, to)) {
    if (!dest.link.awakens) { actorMessage(w, a, "NOTHING ANSWERS ON THE OTHER SIDE"); return false; }
    setFlag(w, to.flag);
    emit(w, { t: "runeAwakened", rune: to.id, actor: a.id });
  }
  enterArea(w, a, to.area, spot.x, spot.y);
  a.facing = to.arrive.facing;
  if (a.id === w.playerId) setFlag(w, FLAGS.tutorialDone);
  emit(w, { t: "travelled", actor: a.id, from: from.id, to: to.id, rune: to.prop });
  return true;
}

export { RUNE_NODES };

/** Ordered hops, respecting one-way links, activation and arrival awakening.
 * Routes are derived afresh; a saved job only keeps its destination. */
export function runeRoute(w: World, fromArea: string, toArea: string): { from: string; to: string }[] | null {
  if (fromArea === toArea) return [];
  const queue = [{ area: fromArea, awake: "", hops: [] as { from: string; to: string }[] }], seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i], key = `${s.area}:${s.awake}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nodes = Object.values(RUNE_NODES).filter((n) => n.area === s.area && (runeActive(w, n) || n.id === s.awake)).sort((a, b) => a.id < b.id ? -1 : 1);
    for (const n of nodes) for (const d of runeDestinations(n.id).sort((a, b) => a.node.id < b.node.id ? -1 : 1)) {
      if (!runeActive(w, d.node) && !d.link.awakens) continue;
      const hops = [...s.hops, { from: n.id, to: d.node.id }];
      if (d.node.area === toArea) return hops;
      queue.push({ area: d.node.area, awake: d.link.awakens ? d.node.id : "", hops });
    }
  }
  return null;
}
