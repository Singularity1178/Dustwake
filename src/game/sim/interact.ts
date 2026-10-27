// Interactables are *derived* from area state (props, loose items, tiles,
// ritual) and cached on the area's revision, so no call site has to remember
// to rebuild them after changing the world.
import { TS, TILE_INTERACT } from "../content/tiles";
import { propDef, propReach } from "../content/props";
import { HARVEST } from "../content/harvest";
import { runeAt } from "../content/runes";
import { isGlyph } from "../content/items";
import { RULES, SLAM_TASK, type Rule } from "../content/interactions";
import { RITUAL_SPOTS, socketPositions } from "../content/ritual";
import type { Target } from "../content/tasks";
import { emit, hasFlag, type Actor, type World } from "../world/world";
import { FLAGS } from "../content/flags";
import { npcDef } from "../content/npcs";
import { meets } from "./requirements";
import type { Area } from "../world/area";
import { beginTask, faceTo, strikePoint } from "./tasks";
import { actorDef, capable } from "../content/actors";
import { buildRows, scanSpec } from "./analysis";

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
  if (c && c.rev === area.interactionRevision) return c.list;
  const list = deriveInteractables(area);
  cache.set(area, { rev: area.interactionRevision, list });
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
    if (def.storage) { I.push({ kind: "storage", x: p.x, y: p.y + 2, r: propReach(p.kind) + 2, propId: p.id }); continue; }
    // A station is used once nothing rests on it: the dungeon workbench hands over its chisel first (the tutorial
    // needs that), then works as a bench. Built benches carry no item, so they are stations straight away.
    if (def.station && !(p.item && !p.container && !p.taken)) { I.push({ kind: "station", x: p.x, y: p.y + 2, r: propReach(p.kind) + 2, propId: p.id }); continue; }
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

const scanCache = new WeakMap<Area, { rev: number; list: Interactable[] }>();
/**
 * Buildable props as scan targets. They are deliberately not normal
 * interactables: E on furniture does nothing unless vision/scan mode is on.
 * Cached on the same revision as interactables because props/taken state move.
 */
export function scanTargets(area: Area): Interactable[] {
  const c = scanCache.get(area);
  if (c && c.rev === area.interactionRevision) return c.list;
  const list: Interactable[] = [];
  for (const p of area.props) {
    if (p.taken || !buildRows(p.kind).length) continue;
    list.push({ kind: "buildable", x: p.x, y: p.y + 2, r: propReach(p.kind) + 2, propId: p.id });
  }
  scanCache.set(area, { rev: area.interactionRevision, list });
  return list;
}

/**
 * Interactables derived from the NPC actors standing in an area (actors live on
 * the World, not the Area, so these are not part of the area's cached list).
 * One generic path for every NPC: the talk target carries the actor id and the
 * NpcDef id; the "npc" rules (content/interactions.ts) decide the work.
 */
export function npcInteractables(w: World, area: Area): Interactable[] {
  const out: Interactable[] = [];
  for (const a of w.actors) {
    if (a.id === w.playerId || a.area !== area.id) continue;
    const d = actorDef(a).body;
    const kind = capable(a, "worker") ? "worker" : npcDef(a.npc) ? "npc" : null;
    if (kind) out.push({ kind, x: a.x, y: a.y + 2, r: d.reach, itemZ: d.height - 12, actorId: a.id, npc: a.npc });
  }
  return out;
}

/** Everything the golem could interact with in an area: area-derived plus NPCs. */
export const allInteractables = (w: World, area: Area) => [...interactables(area), ...npcInteractables(w, area)];

/** Closest interactable in front of the actor, within its reach radius (`extra`: NPC interactables). */
export function findTarget(area: Area, a: Actor, extra: readonly Interactable[] = []): Interactable | null {
  return findTargetIn([...interactables(area), ...extra], a);
}

/** The buildable prop in front of the actor, used only while scan mode is on. */
export const findScanTarget = (area: Area, a: Actor) => findTargetIn(scanTargets(area), a);

/** findTarget's geometry over any list (scan targets use their own list). */
export function findTargetIn(list: readonly Interactable[], a: Actor, accept: (it: Interactable) => boolean = () => true): Interactable | null {
  const fx = a.facing === "left" ? -1 : a.facing === "right" ? 1 : 0;
  const fy = a.facing === "up" ? -1 : a.facing === "down" ? 1 : 0;
  const px = a.x + fx * 6, py = a.y - 3 + fy * 6;
  let best: Interactable | null = null, bd = 1;
  for (const it of list) {
    if (!accept(it)) continue;
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
  if (a.task || a.area !== area.id) return null;
  faceTo(a, it.x, it.y - 4);
  const scan = scanSpec(a, it.propId ? area.prop(it.propId) : undefined);
  if (scan) { beginTask(a, scan, it); return null; }
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

/**
 * Start the attack: the two-arm ground slam, separate from interacting. It
 * needs only what interacting needs (no task in progress), so it works
 * anywhere, facing anything, with or without the iron arm. Nothing is aimed or
 * chosen here: the blow is an area one around where the fists land (the task's
 * target is just that ground), and what it reaches is looked up when it lands
 * (sim/tasks.ts, op "slam"). With nothing in range, the slam still plays in
 * full and only strikes the ground.
 */
export function startSlam(a: Actor): boolean {
  if (a.task || !capable(a, "attack")) return false;
  const at = strikePoint(a);
  beginTask(a, { ...SLAM_TASK, effect: { op: "slam" } }, { kind: "ground", x: at.x, y: at.y });
  return true;
}
