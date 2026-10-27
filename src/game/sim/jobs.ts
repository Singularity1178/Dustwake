// Orders outlive their short, area-bound tasks. All continuation state is
// plain data on Actor.job, including a receipt written at a task's fire point.
import { JOB_KINDS } from "../content/jobs";
import { actorDef, capable } from "../content/actors";
import { HARVEST } from "../content/harvest";
import { ITEMS, type ItemId } from "../content/items";
import { CRAFT_RECIPES } from "../content/crafting";
import { RUNE_NODES } from "../content/runes";
import { propDef, propReach } from "../content/props";
import { actorById, areaOf, emit, getArea, type Actor, type World } from "../world/world";
import type { Destination, Job, JobOrder, Json, PropRef } from "../world/jobs";
import type { TaskSpec, Target } from "../content/tasks";
import { AREAS } from "../world/areas";
import { beginTask, faceTo } from "./tasks";
import { countItem, roomFor } from "./inventory";
import { powered } from "./actorStats";
import { findPath, lineOfSight, walkTo } from "./navigation";
import { runeRoute } from "./runes";
import { craftEntry, craftLocked, orderCraft, outputFits } from "./crafting";
import { inventoryHandle, storageRef } from "./storage";
import { roomIn } from "./inventoryOps";
import { harvestStep } from "./harvesting";

export interface JobHandler {
  validate: (args: Record<string, Json>) => boolean;
  step: (w: World, a: Actor, job: Job, dt: number) => void;
}
const text = (x: Json | undefined): x is string => typeof x === "string" && x.length > 0;
const positive = (x: Json | undefined) => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const refOf = (x: Json | undefined): PropRef | null => x && typeof x === "object" && !Array.isArray(x) && text(x.area) && text(x.prop) ? { area: x.area, prop: x.prop } : null;
const validRef = (x: Json | undefined) => { const ref = refOf(x); return !!ref && !!AREAS[ref.area]; };
const quantity = (j: Job) => j.args.repeat === true ? Infinity : j.args.amount as number;
const stop = (a: Actor) => { a.vx = 0; a.vy = 0; a.moving = false; };

export function assignJob(w: World, a: Actor, order: JobOrder): boolean {
  const def = JOB_KINDS[order.kind], handler = JOB_HANDLERS[order.kind];
  if (!def || !handler || !handler.validate(order.args) || !def.capabilities.every((c) => capable(a, c))) return false;
  if (a.task && a.task.jobId === undefined) return false;
  cancelJob(w, a);
  a.job = {
    ...JSON.parse(JSON.stringify(order)), id: ++a.jobSeq, phase: def.phase, status: powered(a) ? "running" : "paused",
    completed: 0, waiting: false, transit: false, result: null, target: null, nav: null, retryAt: 0, failures: 0,
    reason: powered(a) ? null : "power",
  };
  emit(w, { t: "jobChanged", actor: a.id, status: a.job!.status });
  return true;
}

/** Walk-up management command. The future order screen only needs this API. */
export function setWorkerOrder(w: World, commander: Actor, targetId: string, order: JobOrder | null): boolean {
  const target = actorById(w, targetId);
  if (!target || !capable(target, "worker") || target.area !== commander.area || Math.hypot(target.x - commander.x, target.y - commander.y) > actorDef(target).body.reach + 8) return false;
  if (!lineOfSight(areaOf(w, commander), commander, target)) return false;
  if (order) return assignJob(w, target, order);
  cancelJob(w, target);
  return true;
}

export function cancelJob(w: World, a: Actor) {
  if (!a.job) return;
  if (a.task?.jobId === a.job.id) a.task = null;
  a.queue = a.queue.filter((t) => t.jobId !== a.job!.id);
  a.job = null; stop(a);
  emit(w, { t: "jobChanged", actor: a.id, status: "idle" });
}
export function pauseJob(w: World, a: Actor) {
  if (!a.job || a.job.status === "done") return;
  a.job.status = "paused"; a.job.reason = "manual"; stop(a);
  emit(w, { t: "jobChanged", actor: a.id, status: "paused" });
}
export function resumeJob(w: World, a: Actor) {
  if (!a.job || a.job.status === "done") return;
  a.job.status = powered(a) ? "running" : "paused";
  a.job.reason = powered(a) ? null : "power";
  a.job.failures = 0; a.job.retryAt = 0;
  emit(w, { t: "jobChanged", actor: a.id, status: a.job.status });
}

function block(w: World, a: Actor, reason: string) {
  const job = a.job!;
  job.status = "blocked"; job.reason = reason; job.failures++;
  job.retryAt = w.time + Math.min(8, 1 + job.failures); job.nav = null;
  stop(a);
  emit(w, { t: "jobChanged", actor: a.id, status: "blocked", reason });
}
function finish(w: World, a: Actor) {
  a.job!.status = "done"; a.job!.reason = null; a.job!.nav = null; stop(a);
  emit(w, { t: "jobChanged", actor: a.id, status: "done" });
}
function work(a: Actor, spec: TaskSpec, target: Target) {
  faceTo(a, target.x, target.y);
  beginTask(a, spec, target);
  a.task!.jobId = a.job!.id;
  a.job!.waiting = true; a.job!.result = null;
  stop(a);
}

/** Walk to a local target, or approach and channel the next hop of a route. */
function approach(w: World, a: Actor, goal: Destination, dt: number): boolean {
  if (a.area !== goal.area) {
    if (!capable(a, "travel")) { block(w, a, "noTravel"); return false; }
    const hop = runeRoute(w, a.area, goal.area)?.[0];
    if (!hop) { block(w, a, "noRuneRoute"); return false; }
    const node = RUNE_NODES[hop.from], p = areaOf(w, a).prop(node.prop);
    if (!p) { block(w, a, "missingRune"); return false; }
    const result = walkTo(w, a, { area: a.area, x: p.x, y: p.y, range: 15 }, dt);
    if (result === "stuck") block(w, a, "pathBlocked");
    if (result === "arrived") {
      beginTask(a, { kind: "channel", dur: 2.2, effect: { op: "travel", destination: hop.to } }, { kind: "rune", x: p.x, y: p.y, propId: p.id });
      a.task!.jobId = a.job!.id;
      a.job!.transit = true; a.job!.result = null;
      stop(a);
    }
    return false;
  }
  const result = walkTo(w, a, goal, dt);
  if (result === "stuck") block(w, a, "pathBlocked");
  return result === "arrived";
}

function gatherDeposit(w: World, a: Actor, j: Job, dt: number) {
  const item = j.args.resource as ItemId, storage = refOf(j.args.storage)!;
  if (j.waiting) {
    const failed = j.result === false;
    j.waiting = false; j.result = null;
    if (failed && j.phase === "deposit") { block(w, a, "storageFull"); return; }
    if (failed) j.target = null;
  }
  if (j.completed >= quantity(j)) { finish(w, a); return; }
  const stock = countItem(a, item), remaining = quantity(j) - j.completed;
  const resource = j.target && w.areas.get(j.target.area)?.prop(j.target.prop);
  if (stock > 0 && (stock >= remaining || roomFor(w, a, item) === 0 || resource?.taken)) { j.phase = "deposit"; j.target = null; }
  if (j.phase === "deposit") {
    const area = getArea(w, storage.area), p = area.prop(storage.prop);
    if (!p?.inventory) { block(w, a, "missingStorage"); return; }
    if (!stock) { j.phase = "gather"; j.target = null; return; }
    if (!approach(w, a, { area: area.id, x: p.x, y: p.y, range: propReach(p.kind) + 2 }, dt)) return;
    const h = inventoryHandle(w, storageRef(area.id, p.id));
    if (!h || !roomIn(h.inventory, h.capacity, item)) { block(w, a, "storageFull"); return; }
    work(a, { kind: "reach", dur: 0.45, effect: { op: "deposit", item, n: Math.min(stock, remaining) } }, { kind: "storage", propId: p.id, x: p.x, y: p.y });
    return;
  }
  const source = getArea(w, j.args.fromArea as string);
  if (a.area !== source.id) { approach(w, a, { area: source.id, ...source.start, range: 1 }, dt); return; }
  if (!roomFor(w, a, item)) { block(w, a, "packFull"); return; }
  let p = j.target ? source.prop(j.target.prop) : undefined;
  if (!p || p.taken) {
    const candidates = source.props.filter((p) => !p.taken && (HARVEST[p.kind]?.perHit.item === item || HARVEST[p.kind]?.final?.item === item))
      .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y) || (p.id < q.id ? -1 : 1));
    p = candidates.find((p) => findPath(w, a, { x: p.x, y: p.y, range: propReach(p.kind) + 2 }, false) !== null);
    if (!p) {
      if (stock) { j.phase = "deposit"; return; }
      block(w, a, "noResource"); return;
    }
    j.target = { area: source.id, prop: p.id };
  }
  if (!approach(w, a, { area: source.id, x: p.x, y: p.y, range: propReach(p.kind) + 2 }, dt)) return;
  const hit = harvestStep(a, p);
  if (!hit) { block(w, a, "cannotHarvest"); return; }
  if (hit.rewards.some((r) => roomFor(w, a, r.item) < r.n)) {
    if (stock) { j.phase = "deposit"; j.target = null; }
    else block(w, a, "packFull");
    return;
  }
  work(a, { kind: "punch", dur: 0.75, effect: { op: "harvest" } }, { kind: "harvest", propId: p.id, x: p.x, y: p.y });
}

function craftAt(w: World, a: Actor, j: Job, dt: number) {
  if (j.waiting) {
    const ok = j.result;
    j.waiting = false; j.result = null;
    if (ok) j.completed++;
    else { block(w, a, "craftChanged"); return; }
  }
  if (j.completed >= quantity(j)) { finish(w, a); return; }
  const station = refOf(j.args.station)!, area = getArea(w, station.area), p = area.prop(station.prop);
  const recipe = CRAFT_RECIPES.find((r) => r.id === j.args.recipe);
  if (!p || !recipe || propDef(p.kind).station !== recipe.station) { block(w, a, "missingStation"); return; }
  if (!approach(w, a, { area: area.id, x: p.x, y: p.y, range: propReach(p.kind) + 2 }, dt)) return;
  const entry = craftEntry(w, a, recipe, p);
  if (craftLocked(w, a, recipe.station) || entry.status !== "ok") { block(w, a, entry.status === "ok" ? "unknown" : entry.status); return; }
  if (!outputFits(w, a, recipe)) { block(w, a, "packFull"); return; }
  if (!orderCraft(w, a, recipe.station, recipe.id, p.id)) { block(w, a, "craftChanged"); return; }
  a.task!.jobId = j.id; j.waiting = true; j.result = null; stop(a);
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  gatherDeposit: {
    validate: (p) => text(p.resource) && !!ITEMS[p.resource as ItemId] && text(p.fromArea) && !!AREAS[p.fromArea] && validRef(p.storage) && (p.repeat === true || positive(p.amount)),
    step: gatherDeposit,
  },
  craftAt: {
    validate: (p) => validRef(p.station) && text(p.recipe) && CRAFT_RECIPES.some((r) => r.id === p.recipe) && (p.repeat === true || positive(p.amount)),
    step: craftAt,
  },
  walk: {
    validate: (p) => text(p.area) && !!AREAS[p.area] && typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y),
    step: (w, a, j, dt) => {
      if (approach(w, a, { area: j.args.area as string, x: j.args.x as number, y: j.args.y as number, range: 1 }, dt)) finish(w, a);
    },
  },
};

export function tickJob(w: World, a: Actor, dt: number) {
  const job = a.job;
  if (!job || job.status === "done") { if (!a.task) stop(a); return; }
  if (!powered(a)) { if (job.reason !== "manual") { job.status = "paused"; job.reason = "power"; } stop(a); return; }
  if (job.status === "paused" && job.reason === "power") { job.status = "running"; job.reason = null; }
  if (job.status === "paused") return;
  if (job.status === "blocked") {
    // Bounded retries. Impossible corridors and missing resources settle into
    // an explicit, savable blocked order, not an infinite active-work loop.
    if (job.failures >= 3 || w.time < job.retryAt) return;
    job.status = "running"; job.reason = null; job.nav = null;
  }
  if (a.task || a.queue.length) return;
  if (job.transit) {
    job.transit = false;
    const ok = job.result; job.result = null;
    if (!ok) { block(w, a, "arrivalBlocked"); return; }
  }
  const handler = JOB_HANDLERS[job.kind];
  if (!handler) { block(w, a, "unknownJob"); return; }
  handler.step(w, a, job, dt);
}

export const gatherOrder = (resource: ItemId, fromArea: string, storage: PropRef, amount: number, repeat = false): JobOrder => ({
  kind: "gatherDeposit", args: { resource, fromArea, storage: { ...storage }, amount, repeat },
});
export const craftOrder = (station: PropRef, recipe: string, amount: number, repeat = false): JobOrder => ({
  kind: "craftAt", args: { station: { ...station }, recipe, amount, repeat },
});