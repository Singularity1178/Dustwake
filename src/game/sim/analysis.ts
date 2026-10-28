import { RECIPES, type Recipe } from "../content/build";
import { HIGHLIGHT_RULES, SCAN_DURATION, analysisFlag, type Highlight } from "../content/vision";
import { ITEMS, type ItemId } from "../content/items";
import { propDef, propReach } from "../content/props";
import { actorDef, capable } from "../content/actors";
import { TILE_INTERACT, TS } from "../content/tiles";
import type { Target } from "../content/tasks";
import type { Area, PropInst } from "../world/area";
import { emit, type Actor, type World } from "../world/world";
import { meets } from "./requirements";
import { lineOfSight } from "./navigation";

/** The plans a prop of this kind teaches: the recipes that build it, and those that learn from it (`Recipe.learnFrom`). */
export const buildRows = (kind: string) => Object.entries(RECIPES).filter(([, r]) => r.prop === kind || !!r.learnFrom?.some((l) => l.kind === kind));

/**
 * Why a recipe is unknown to an actor: `knowledge` (its `requires`, e.g. the
 * Primer's know.build), `analysis` (its plan hasn't been read from an example
 * yet), or null when it is known. The catalog, the build effect and the menu's
 * reason all read this one gate.
 */
export type PlanLock = "knowledge" | "analysis";
export function planLock(w: World, a: Actor, r: Recipe): PlanLock | null {
  if (!meets(w, a, r.requires)) return "knowledge";
  if (r.analysis && !w.flags.has(analysisFlag(r.analysis))) return "analysis";
  return null;
}
export const recipeKnown = (w: World, a: Actor, r: Recipe) => planLock(w, a, r) === null;

/**
 * Read every plan a prop teaches (a scan, or taking it apart): grants each
 * unread analysis flag and emits one `analyzed` per plan. Returns the plans
 * read just now. Callers own the validation (reach, sight, capability).
 */
export function learnPlans(w: World, a: Actor, p: Pick<PropInst, "id" | "kind">): [string, Recipe][] {
  const fresh: [string, Recipe][] = [];
  for (const [id, r] of buildRows(p.kind)) {
    const flag = analysisFlag(r.analysis ?? id);
    if (w.flags.has(flag)) continue;
    w.flags.add(flag);
    fresh.push([id, r]);
    emit(w, { t: "analyzed", actor: a.id, prop: p.id, flag });
  }
  return fresh;
}

export function toggleScan(a: Actor) {
  if (capable(a, "scan")) a.mode = a.mode === "scan" ? "normal" : "scan";
}

export function scanSpec(a: Actor, p: PropInst | undefined) {
  return a.mode === "scan" && capable(a, "scan") && p && buildRows(p.kind).length
    ? { kind: "scan" as const, dur: SCAN_DURATION, effect: { op: "analyze" as const } } : null;
}

export function applyAnalysis(w: World, a: Actor, area: Area, target?: Target): boolean {
  const p = target?.propId ? area.prop(target.propId) : undefined;
  if (!p || a.area !== area.id || !capable(a, "scan") || Math.hypot(p.x - a.x, p.y - a.y) > propReach(p.kind) + 8 || !lineOfSight(area, a, p)) return false;
  const rows = buildRows(p.kind);
  if (!rows.length) return false;
  learnPlans(w, a, p);
  if (a.id === w.playerId) emit(w, { t: "message", text: `ANALYZED: ${rows[0][1].name}` });
  return true;
}

export function classifyHighlight(facts: { item?: ItemId; rune?: boolean; actor?: boolean; buildable?: boolean; interactable?: boolean }): Highlight | null {
  for (const r of HIGHLIGHT_RULES) {
    if (r.tags && facts.item && r.tags.some((tag) => ITEMS[facts.item!].tags.includes(tag))) return r.category;
    if (r.trait && facts[r.trait]) return r.category;
  }
  return null;
}

/**
 * What analysis still holds for a prop: `pending` while any of its plans is
 * unread, `done` once every one is, undefined for anything analysis can't read.
 * The same flags `applyAnalysis` grants, so it flips the moment a scan fires.
 */
export type AnalysisState = "pending" | "done";
export function analysisState(w: World, p: PropInst): AnalysisState | undefined {
  const rows = buildRows(p.kind);
  if (!rows.length) return undefined;
  return rows.every(([id, r]) => w.flags.has(analysisFlag(r.analysis ?? id))) ? "done" : "pending";
}

export interface VisionTarget {
  id: string; x: number; y: number; height: number; category: Highlight;
  /** What kind of thing it is (all wall torches share one), so the readout counts types, not copies. */
  kind: string;
  /** Absent: nothing to analyze. */
  analysis?: AnalysisState;
  /** Where it came from, so presentation can find its art without re-deriving it. */
  source: "prop" | "loose" | "actor" | "tile";
}

/** Interactive tiles only move when the layout does: scanning the whole grid every frame would cost O(w*h). */
const tileTargetCache = new WeakMap<Area, { rev: number; list: VisionTarget[] }>();
function tileTargets(area: Area): VisionTarget[] {
  const c = tileTargetCache.get(area);
  if (c && c.rev === area.revision) return c.list;
  const list: VisionTarget[] = [];
  for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) if (TILE_INTERACT[area.tile(x, y)]) {
    list.push({ id: `tile:${x},${y}`, kind: `tile:${area.tile(x, y)}`, x: x * TS + 8, y: y * TS + 16, height: 16, category: "interactable", source: "tile" });
  }
  tileTargetCache.set(area, { rev: area.revision, list });
  return list;
}

/** Presentation consumes this read-only projection, never decides interaction semantics. */
export function visionTargets(w: World, area: Area): VisionTarget[] {
  const out: VisionTarget[] = [];
  for (const p of area.props) {
    const d = propDef(p.kind);
    const category = classifyHighlight({
      item: !p.taken && !p.open ? p.item : undefined, rune: d.rune, buildable: buildRows(p.kind).length > 0,
      interactable: !!(d.station || d.storage || d.examine || (!p.taken && p.item) || (p.container && !p.open)),
    });
    if (category) out.push({ id: p.id, kind: `prop:${p.kind}`, x: p.x, y: p.y, height: p.itemZ ?? 14, category, analysis: analysisState(w, p), source: "prop" });
  }
  for (const l of area.loose) if (!l.taken) out.push({ id: l.id, kind: `item:${l.item}`, x: l.x, y: l.y, height: 8, category: classifyHighlight({ item: l.item, interactable: true })!, source: "loose" });
  for (const a of w.actors) if (a.area === area.id && a.id !== w.playerId) out.push({ id: a.id, kind: `actor:${a.npc ?? a.definition}`, x: a.x, y: a.y, height: actorDef(a).body.height, category: "npc", source: "actor" });
  for (const t of tileTargets(area)) out.push(t);
  return out;
}