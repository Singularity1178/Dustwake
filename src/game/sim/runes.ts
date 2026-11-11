// Rune network travel. Interacting with a rune that will carry runs a `channel`
// task whose `travel` effect lands here: resolve the link, wake a dormant
// partner if the link says so, find a free arrival spot next to the destination
// rune and move the actor with enterArea().
import { RUNE_NODES, runeAt, runeDestinations, type RuneHop, type RuneNode } from "../content/runes";
import { FLAGS } from "../content/flags";
import { emit, enterArea, getArea, hasFlag, setFlag, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { nearestFree, actorBoxes } from "./collision";
import { actorDef, capable } from "../content/actors";
import type { Point } from "../world/jobs";
import { powered } from "./actorStats";
import { actorMessage } from "./messages";
import { advanceDayTo } from "./daytime";
import { FIRST_ARRIVAL_HOUR } from "../content/daycycle";

export const runeActive = (w: World, n: RuneNode) => hasFlag(w, n.flag);
/** Does the far end of a hop answer: it is lit, or going this way is what wakes it. */
export const runeAnswers = (w: World, d: RuneHop) => runeActive(w, d.node) || d.wakes;

/**
 * What a rune is to someone who would use it. `dormant`: dark (its own flag is unset). `severed`: lit, but nothing
 * answers it: every rune it is linked to is dark and it cannot wake them (the surface rune while the circle below
 * has a glyph out of it). `linked`: lit, with somewhere to go. Derived from the nodes' flags, never stored, so the
 * two ends of a link cannot get out of step.
 */
export type RuneState = "dormant" | "severed" | "linked";
export function runeState(w: World, n: RuneNode): RuneState {
  if (!runeActive(w, n)) return "dormant";
  return runeDestinations(n.id).some((d) => runeAnswers(w, d)) ? "linked" : "severed";
}

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
  // The link asked for, else the first that answers (a rune with several links never picks a dead one over a live one).
  const ways = runeDestinations(from.id).filter((d) => !destination || d.node.id === destination);
  const dest = ways.find((d) => runeAnswers(w, d)) ?? ways[0];
  if (!dest) { actorMessage(w, a, "THE RUNE LEADS NOWHERE"); return false; }
  const to = dest.node;
  // A dark far end is woken only by the hop that is allowed to wake it. Refused, nothing is set and nobody moves.
  if (!runeAnswers(w, dest)) { actorMessage(w, a, "NOTHING ANSWERS ON THE OTHER SIDE"); return false; }
  const spot = arrivalSpot(w, to, a);
  if (!spot) return false;
  if (!runeActive(w, to)) {
    setFlag(w, to.flag);
    emit(w, { t: "runeAwakened", rune: to.id, actor: a.id });
  }
  enterArea(w, a, to.area, spot.x, spot.y);
  a.facing = to.arrive.facing;
  if (a.id === w.playerId) {
    // The first crossing is not instant: the far anchor has to be rewritten on the way (the cutscene shows it), and
    // the golem comes up in the last dark before dawn however long the halls took. Later hops take no time.
    if (!hasFlag(w, FLAGS.tutorialDone)) advanceDayTo(w, FIRST_ARRIVAL_HOUR);
    setFlag(w, FLAGS.tutorialDone);
  }
  emit(w, { t: "travelled", actor: a.id, from: from.id, to: to.id, rune: to.prop });
  return true;
}

export { RUNE_NODES };

/**
 * The rune hops out of an area, in stable id order: from every lit rune in it (or the one woken on the way here,
 * `awake`), to every far end that answers. `woke` names a far rune this hop would wake (it is dark now).
 */
export function runeWays(w: World, area: string, awake = ""): { from: RuneNode; to: RuneNode; woke: string }[] {
  const out: { from: RuneNode; to: RuneNode; woke: string }[] = [];
  const nodes = Object.values(RUNE_NODES).filter((n) => n.area === area && (runeActive(w, n) || n.id === awake)).sort((a, b) => a.id < b.id ? -1 : 1);
  for (const n of nodes) for (const d of runeDestinations(n.id).sort((a, b) => a.node.id < b.node.id ? -1 : 1)) {
    if (runeAnswers(w, d)) out.push({ from: n, to: d.node, woke: runeActive(w, d.node) ? "" : d.node.id });
  }
  return out;
}

/** Ordered hops by rune alone, respecting one-way links, activation and arrival awakening.
 * Routes are derived afresh; a saved job only keeps its destination. (Orders route over runes and portals
 * together: sim/routes.ts.) */
export function runeRoute(w: World, fromArea: string, toArea: string): { from: string; to: string }[] | null {
  if (fromArea === toArea) return [];
  const queue = [{ area: fromArea, awake: "", hops: [] as { from: string; to: string }[] }], seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i], key = `${s.area}:${s.awake}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const e of runeWays(w, s.area, s.awake)) {
      const hops = [...s.hops, { from: e.from.id, to: e.to.id }];
      if (e.to.area === toArea) return hops;
      queue.push({ area: e.to.area, awake: e.woke, hops });
    }
  }
  return null;
}
