// Interactables are *derived* from area state (props, loose items, tiles,
// ritual) and cached on the area's revision, so no call site has to remember
// to rebuild them after changing the world.
import { TS, TILE_INTERACT } from "../content/tiles";
import { propDef, propReach } from "../content/props";
import { HARVEST } from "../content/harvest";
import { runeAt } from "../content/runes";
import { isGlyph } from "../content/items";
import { RULES, type Rule } from "../content/interactions";
import { RITUAL_SPOTS, socketPositions } from "../content/ritual";
import type { Target } from "../content/tasks";
import { emit, hasFlag, type Actor, type World } from "../world/world";
import { FLAGS } from "../content/flags";
import { meets } from "./requirements";
import type { Area } from "../world/area";
import { beginTask, faceTo } from "./tasks";

export interface Interactable extends Target {
  r: number;
  /** Height of the item above the anchor (marker/glint placement). */
  itemZ?: number;
  /** Something pickable is visible here (for glints). */
  hasItem?: boolean;
}

const cache = new WeakMap<Area, { rev: number; list: Interactable[] }>();

export function interactables(area: Area): Interactable[] {
  const c = cache.get(area);
  if (c && c.rev === area.revision) return c.list;
  const list = deriveInteractables(area);
  cache.set(area, { rev: area.revision, list });
  return list;
}

function deriveInteractables(area: Area): Interactable[] {
  const I: Interactable[] = [];
  for (const p of area.props) {
    if (p.kind === "pedestal") continue;
    const def = propDef(p.kind);
    if (def.rune) {
      // The dungeon circle only becomes a usable rune once its core is seated (before that its centre is the "center" spot).
      if (!(area.ritual && !area.ritual.core)) I.push({ kind: "rune", x: p.x, y: p.y, r: 18, propId: p.id });
      continue;
    }
    if (HARVEST[p.kind] && !p.taken) { I.push({ kind: "harvest", x: p.x, y: p.y + 2, r: propReach(p.kind) + 2, propId: p.id }); continue; }
    if (def.examine) { I.push({ kind: "examine", x: p.x, y: p.y + 2, r: propReach(p.kind) + 4, propId: p.id }); continue; }
    const r = propReach(p.kind);
    if (p.container && !p.open) I.push({ kind: "container", x: p.x, y: p.y + 2, r, propId: p.id, itemZ: p.itemZ, hasItem: !!p.item });
    else if (p.item && !p.container && !p.taken) I.push({ kind: "propItem", x: p.x, y: p.y + 2, r, propId: p.id, itemZ: p.itemZ, hasItem: true });
  }
  for (const l of area.loose) if (!l.taken) I.push({ kind: "item", x: l.x, y: l.y, r: 16, looseId: l.id, hasItem: true });
  for (let ty = 0; ty < area.h; ty++)
    for (let tx = 0; tx < area.w; tx++) {
      const t = area.grid[ty * area.w + tx];
      const def = TILE_INTERACT[t];
      if (!def) continue;
      if (def.anchorTopOfRun && area.tile(tx, ty - 1) === t) continue;
      I.push({ kind: def.kind, x: tx * TS + def.dx, y: ty * TS + def.dy, r: def.r, tx, ty });
    }
  const r = area.ritual;
  if (r) {
    const c = area.ritualPos;
    socketPositions(c).forEach((s, i) => I.push({ kind: "socket", x: s.x, y: s.y + RITUAL_SPOTS.socket.dy, r: RITUAL_SPOTS.socket.r, socket: i }));
    if (!r.core) I.push({ kind: "center", x: c.x, y: c.y, r: RITUAL_SPOTS.center.r });
    if (!r.carved) I.push({ kind: "gap", x: c.x + RITUAL_SPOTS.gap.dx, y: c.y + RITUAL_SPOTS.gap.dy, r: RITUAL_SPOTS.gap.r });
  }
  return I;
}

/** Closest interactable in front of the actor, within its reach radius. */
export function findTarget(area: Area, a: Actor): Interactable | null {
  const fx = a.facing === "left" ? -1 : a.facing === "right" ? 1 : 0;
  const fy = a.facing === "up" ? -1 : a.facing === "down" ? 1 : 0;
  const px = a.x + fx * 6, py = a.y - 3 + fy * 6;
  let best: Interactable | null = null, bd = 1;
  for (const it of interactables(area)) {
    const d = Math.hypot(it.x - px, it.y - py) / it.r;
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

export { meets };

const pick = (w: World, a: Actor, rules: Rule[]) => rules.find((r) => meets(w, a, r.when));

/** UI the interaction needs before work can start (the presentation layer opens it). */
export type InteractUi = { ui: "selectGlyph"; socket: number };

/** Start the work implied by interacting with `it`. Returns a UI request if a choice is needed first. */
export function interact(w: World, a: Actor, area: Area, it: Interactable): InteractUi | null {
  faceTo(a, it.x, it.y - 4);
  let rules = RULES[it.kind];
  if (it.kind === "socket") {
    const filled = (area.ritual?.sockets[it.socket!] ?? -1) >= 0;
    if (!filled && a.inventory.some((s) => s && isGlyph(s.item))) return { ui: "selectGlyph", socket: it.socket! };
    rules = filled ? RULES.socketFilled : RULES.socketEmpty;
  }
  let first = false;
  if (it.kind === "rune") {
    const node = runeAt(area.id, it.propId!);
    if (!node || !hasFlag(w, node.flag)) rules = RULES.runeDormant;
    else first = !hasFlag(w, FLAGS.tutorialDone);
  }
  const rule = rules && pick(w, a, rules);
  if (!rule) return null;
  const { r: _r, itemZ: _z, hasItem: _h, ...target } = it;
  beginTask(a, rule.task, target);
  if (rule.task.kind === "channel") emit(w, { t: "teleport", actor: a.id, first, x: it.x, y: it.y });
  return null;
}
