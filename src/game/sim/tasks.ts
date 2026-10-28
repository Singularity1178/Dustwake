// Performing work. An actor holds one current Task and a queue. Each tick the
// task advances; at its fire point its Effect is applied to the world. This is
// the single path by which interactions change the world, for any actor.
import { TS, T, TILE_INTERACT } from "../content/tiles";
import { ITEMS, glyphItem, isDroppable } from "../content/items";
import { propDef, propReach } from "../content/props";
import { HARVEST } from "../content/harvest";
import { TASK_KINDS, SLAM_RADIUS, type Effect, type TaskSpec, type Target } from "../content/tasks";
import { SLAM_RULES } from "../content/interactions";
import { meets } from "./requirements";
import { emit, setFlag, setActorFlag, hasFlag, actorById, areaOf, getArea, type Actor, type World } from "../world/world";
import type { Area, PropInst } from "../world/area";
import { checkRune, deactivate } from "./ritual";
import { addItems, dropSpot, giveItem, removeItems, spawnLoose } from "./inventory";
import { travel } from "./runes";
import { applyBuild, applyDeconstruct } from "./build";
import { actorBoxes } from "./collision";
import { applyDialogueEffect } from "./dialogue";
import { applyWear, applyTakeOff, gearRefusal } from "./gear";
import { applyCraft } from "./crafting";
import { powered } from "./actorStats";
import { harvestReach, harvestStep } from "./harvesting";
import { capable } from "../content/actors";
import { applyAnalysis } from "./analysis";
import { packRef, storageRef, transferItems } from "./storage";
import { actorMessage } from "./messages";
import { lineOfSight } from "./navigation";
import { think } from "./monologue";

export function beginTask(a: Actor, spec: TaskSpec, target?: Target) {
  a.task = { ...spec, t: 0, fired: false, target, area: a.area };
  a.vx = 0; a.vy = 0;
}

/** Add work to the actor's queue; it starts when the current task finishes. */
export function enqueueTask(a: Actor, spec: TaskSpec, target?: Target) {
  a.queue.push({ ...spec, t: 0, fired: false, target, area: a.area });
}

/** Advance the actor's work by dt. */
export function tickTask(w: World, a: Actor, dt: number) {
  if (!a.task && a.queue.length) { a.task = a.queue.shift()!; a.vx = 0; a.vy = 0; }
  const task = a.task;
  if (!task) return;
  if (task.jobId !== undefined && (!powered(a) || a.job?.status === "paused")) return;
  // Work is bound to the area it was started in; never let it fire elsewhere.
  if (task.area && task.area !== a.area) { a.task = null; return; }
  task.t += dt;
  emit(w, { t: "taskTick", actor: a.id, task, dt });
  if (!task.fired && task.t >= TASK_KINDS[task.kind].fire(task.dur)) {
    task.fired = true;
    const ok = task.effect ? applyEffect(w, a, task.effect, task.target) : true;
    if (task.jobId !== undefined && a.job?.id === task.jobId) a.job.result = ok !== false;
  }
  // An effect may have replaced the task (e.g. picking up the arm begins attaching it).
  if (task.t >= task.dur && a.task === task) a.task = null;
}

/** Where a slam's fists meet the ground: just in front of the actor. */
export function strikePoint(a: Actor) {
  const fx = a.facing === "left" ? -1 : a.facing === "right" ? 1 : 0;
  const fy = a.facing === "up" ? -1 : a.facing === "down" ? 1 : 0;
  return { x: a.x + fx * 10, y: a.y + (fy > 0 ? 3 : fy < 0 ? -7 : 0) };
}

/**
 * The slammable tiles a blow at (x, y) reaches: any tile with SLAM_RULES that
 * has some part of it within `radius` of the blow (so a wall the fists land in,
 * or just beside, is hit, but the golem's own position is irrelevant). Runs of
 * tiles that act as one thing (anchorTopOfRun, like the cracked wall) count
 * once, as the same anchored target an interaction would carry. Nearest first.
 */
export function slamReach(area: Area, x: number, y: number, radius: number): Target[] {
  const found = new Map<string, { target: Target; d2: number }>();
  const tx0 = Math.floor((x - radius) / TS), tx1 = Math.floor((x + radius) / TS);
  const ty0 = Math.floor((y - radius) / TS), ty1 = Math.floor((y + radius) / TS);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const tile = area.tile(tx, ty), def = TILE_INTERACT[tile];
      if (!def || !SLAM_RULES[def.kind]) continue;
      // Distance from the blow to the nearest point of this tile's square.
      const dx = Math.max(tx * TS - x, 0, x - (tx + 1) * TS), dy = Math.max(ty * TS - y, 0, y - (ty + 1) * TS);
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      let ay = ty;
      if (def.anchorTopOfRun) while (area.tile(tx, ay - 1) === tile) ay--;
      const key = `${tx},${ay}`, prev = found.get(key);
      if (!prev) found.set(key, { target: { kind: def.kind, x: tx * TS + def.dx, y: ay * TS + def.dy, tx, ty: ay }, d2 });
      else if (d2 < prev.d2) prev.d2 = d2;
    }
  return [...found.values()].sort((p, q) => p.d2 - q.d2).map((f) => f.target);
}

export function faceTo(a: Actor, x: number, y: number) {
  const dx = x - a.x, dy = y - (a.y - 4);
  a.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

/**
 * Run an effect after `delay` seconds of simulation time. It applies in the
 * area it was scheduled from (default: the actor's area now), even if the
 * actor has since travelled.
 */
export function schedule(w: World, delay: number, actor: Actor, effect: Effect, area = actor.area) {
  w.scheduled.push({ at: w.time + delay, actor: actor.id, area, effect });
}

/** Fire scheduled effects that are due. */
export function runScheduled(w: World) {
  if (!w.scheduled.length) return;
  const due = w.scheduled.filter((s) => s.at <= w.time);
  if (!due.length) return;
  w.scheduled = w.scheduled.filter((s) => s.at > w.time);
  for (const s of due) {
    const a = actorById(w, s.actor);
    if (a) applyEffect(w, a, s.effect, undefined, s.area);
  }
}

/** Apply one effect. `areaId` overrides the area it acts on (scheduled effects). */
export function applyEffect(w: World, a: Actor, e: Effect, target?: Target, areaId?: string): boolean | void {
  const area = areaId ? getArea(w, areaId) : areaOf(w, a);
  switch (e.op) {
    case "cue":
      emit(w, { t: "cue", cue: e.cue, x: target?.x ?? a.x, y: target?.y ?? a.y, actor: a.id });
      break;
    case "message":
      actorMessage(w, a, e.text);
      if (e.cue) emit(w, { t: "cue", cue: e.cue, x: target?.x ?? a.x, y: target?.y ?? a.y, actor: a.id });
      break;
    case "examine": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      const text = p && propDef(p.kind).examine;
      if (text) emit(w, { t: "message", text });
      break;
    }
    case "takeLoose": {
      const l = target?.looseId ? area.looseItem(target.looseId) : undefined;
      if (!l || l.taken) break;
      const def = ITEMS[l.item];
      if (def.equip) {
        area.takeLoose(l.id);
        emit(w, { t: "itemGained", actor: a.id, item: l.item, stored: false });
        beginTask(a, { kind: def.equip.task.kind, dur: def.equip.task.dur, effect: { op: "equip", item: l.item } });
        break;
      }
      const n = l.n ?? 1;
      const left = addItems(w, a, l.item, n);
      if (left === n) { emit(w, { t: "packFull", actor: a.id, item: l.item }); break; }
      area.setLooseCount(l.id, left);
      emit(w, { t: "itemGained", actor: a.id, item: l.item, stored: true, n: n - left });
      if (left > 0) emit(w, { t: "packFull", actor: a.id, item: l.item });
      break;
    }
    case "takePropItem": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      if (!p || p.taken || !p.item) break;
      const def = ITEMS[p.item];
      if (def.equip) {
        area.setPropState(p.id, { taken: true });
        emit(w, { t: "itemGained", actor: a.id, item: p.item, stored: false });
        beginTask(a, { kind: def.equip.task.kind, dur: def.equip.task.dur, effect: { op: "equip", item: p.item } });
        break;
      }
      // Full pack: leave it where it is rather than dropping it on the floor.
      if (addItems(w, a, p.item, 1) > 0) { emit(w, { t: "packFull", actor: a.id, item: p.item }); break; }
      area.setPropState(p.id, { taken: true });
      emit(w, { t: "itemGained", actor: a.id, item: p.item, stored: true, n: 1 });
      break;
    }
    case "openContainer": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      if (!p || p.open) break;
      const item = p.item;
      area.setPropState(p.id, { open: true, item: null });
      emit(w, { t: "containerOpened", x: p.x, y: p.y });
      if (item) schedule(w, 0.25, a, { op: "grantItem", item }, area.id);
      break;
    }
    case "grantItem":
      giveItem(w, a, e.item, 1);
      break;
    case "equip": {
      const def = ITEMS[e.item];
      if (def.equip) setActorFlag(a, def.equip.flag);
      emit(w, { t: "equipped", actor: a.id, item: e.item });
      break;
    }
    case "unlockTile": {
      if (target?.tx === undefined || target.ty === undefined) break;
      const def = TILE_INTERACT[area.tile(target.tx, target.ty)];
      if (e.consume) removeItems(a, e.consume, 1);
      area.setTile(target.tx, target.ty, T.FLOOR);
      if (def?.openDecal) area.addDecal({ kind: def.openDecal.kind, x: target.tx * TS + def.openDecal.dx, y: target.ty * TS + def.openDecal.dy, v: 0 });
      emit(w, { t: "doorUnlocked", x: target.x, y: target.y });
      break;
    }
    case "breakTile":
      if (target?.tx !== undefined && target.ty !== undefined) breakTileRun(w, area, target);
      break;
    case "placeCore": {
      const r = area.ritual;
      if (!r) break;
      removeItems(a, e.consume, 1);
      area.updateRitual({ core: true });
      emit(w, { t: "corePlaced" });
      checkRune(w, area);
      break;
    }
    case "carveGap": {
      const r = area.ritual;
      if (!r) break;
      area.updateRitual({ carved: true });
      emit(w, { t: "carved" });
      checkRune(w, area);
      break;
    }
    case "takeGlyph": {
      const r = area.ritual;
      const i = target?.socket;
      if (!r || i === undefined || r.sockets[i] < 0) break;
      const g = r.sockets[i];
      const sockets = [...r.sockets], wrong = [...r.wrong];
      sockets[i] = -1; wrong[i] = false;
      area.updateRitual({ sockets, wrong });
      giveItem(w, a, glyphItem(g), 1);
      if (r.active) deactivate(w, area);
      break;
    }
    case "checkRune":
      checkRune(w, area);
      break;
    case "drop": {
      const s = a.inventory[e.slot];
      if (!s) break;
      if (!isDroppable(s.item)) { emit(w, { t: "message", text: "THAT IS TOO IMPORTANT TO DROP" }); break; }
      const spot = dropSpot(area, a, actorBoxes(w, area.id, a.id));
      if (!spot) { emit(w, { t: "message", text: "NO ROOM TO DROP IT HERE" }); break; }
      const n = Math.min(e.n, s.n), item = s.item;
      s.n -= n;
      if (s.n === 0) a.inventory[e.slot] = null;
      spawnLoose(area, item, n, spot.x, spot.y);
      emit(w, { t: "itemDropped", actor: a.id, item, n, x: spot.x, y: spot.y, reason: "drop" });
      break;
    }
    case "wear": {
      const r = applyWear(w, a, e.slot, e.into);
      if (!r.ok && r.reason !== "empty") emit(w, { t: "message", text: gearRefusal(r) });
      break;
    }
    case "takeOff": {
      const r = applyTakeOff(w, a, e.gear);
      if (!r.ok && r.reason !== "empty") emit(w, { t: "message", text: gearRefusal(r) });
      break;
    }
    case "slam": {
      // The blow lands: both fists into the ground in front of the actor, and
      // everything slammable within SLAM_RADIUS of the fists (not of the actor)
      // takes it. Targets are looked up now, in the world as it is at impact.
      // Harvestables (trees, rocks, logs) are slammable too: each one in reach
      // takes one blow of work and pays out, however many there are.
      const p = strikePoint(a);
      const hits = slamReach(area, p.x, p.y, SLAM_RADIUS)
        .map((t) => ({ t, rule: SLAM_RULES[t.kind].find((r) => meets(w, a, r.when)) }))
        .filter((h) => h.rule);
      const harvestables = harvestReach(area, p.x, p.y, SLAM_RADIUS);
      emit(w, { t: "slam", actor: a.id, x: p.x, y: p.y, hit: hits.length > 0 || harvestables.length > 0 });
      for (const h of hits) applyEffect(w, a, h.rule!.then, h.t);
      for (const hp of harvestables) harvestProp(w, a, area, hp);
      break;
    }
    case "withstand":
      // The target takes the blow and holds: nothing in the world changes.
      emit(w, { t: "withstood", actor: a.id, x: target?.x ?? a.x, y: target?.y ?? a.y, tx: target?.tx, ty: target?.ty });
      if (e.text) emit(w, { t: "message", text: e.text });
      break;
    case "travel":
      return !!target?.propId && travel(w, a, area, target.propId, e.destination);
    case "analyze": return applyAnalysis(w, a, area, target);
    case "deposit": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      if (!p?.inventory || a.area !== area.id || Math.hypot(a.x - p.x, a.y - p.y) > propReach(p.kind) + 8) return false;
      const n = transferItems(w, packRef(a), storageRef(area.id, p.id), e.item, e.n);
      if (a.job && a.task?.jobId === a.job.id) a.job.completed += n;
      return n > 0;
    }
    case "useStorage":
      if (target?.propId && area.prop(target.propId)?.inventory) emit(w, { t: "openStorage", actor: a.id, prop: target.propId });
      break;
    case "manageActor":
      if (target?.actorId && actorById(w, target.actorId)) emit(w, { t: "manageActor", actor: a.id, target: target.actorId });
      break;
    case "harvest": {
      // A worker's blow at a chosen prop (jobs). The golem's own harvesting is the slam, which finds props itself.
      const p = target?.propId ? area.prop(target.propId) : undefined;
      if (!p || Math.hypot(p.x - a.x, p.y - a.y) > propReach(p.kind) + 8 || !lineOfSight(area, a, p)) return false;
      return harvestProp(w, a, area, p);
    }
    case "regrow":
      area.setPropState(e.prop, { taken: false, dmg: 0 });
      break;
    case "build":
      applyBuild(w, a, area, e.recipe, e.tx, e.ty);
      break;
    case "deconstruct":
      applyDeconstruct(w, a, area, target?.propId);
      break;
    case "craft":
      return applyCraft(w, a, area, e.recipe, target?.propId);
    case "useStation": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      const station = p && propDef(p.kind).station;
      if (p && station) emit(w, { t: "openStation", actor: a.id, prop: p.id, station });
      break;
    }
    case "learn":
      if (!hasFlag(w, e.flag)) { setFlag(w, e.flag); emit(w, { t: "learned", flag: e.flag }); }
      break;
    case "think":
      return think(w, a, e.line, { target });
    case "talk": case "npcAwake": case "repairEye": case "npcGive": case "segmentDone":
      applyDialogueEffect(w, a, e, target);
      break;
  }
}

/**
 * One blow of work against a harvestable prop, by any actor: stores the damage
 * on the prop, pays for the cumulative work crossed, and depletes it. Reach is
 * the caller's business (a worker's job, or the slam's radius). False when
 * nothing came of it (not harvestable, already depleted, or the actor can't).
 */
function harvestProp(w: World, a: Actor, area: Area, p: PropInst): boolean {
  const def = HARVEST[p.kind];
  if (!def || p.taken || !capable(a, "harvest")) return false;
  const hit = harvestStep(a, p);
  if (!hit) return false;
  area.damageProp(p.id, hit.damage);
  // Pay for cumulative work crossed, not the number of blows. Fractional,
  // mixed-actor and overkill hits conserve the original total yield.
  for (const reward of hit.rewards) giveItem(w, a, reward.item, reward.n);
  if (hit.depleted) {
    area.setPropState(p.id, { taken: true });
    if (def.regrow) schedule(w, def.regrow, a, { op: "regrow", prop: p.id }, area.id);
  }
  emit(w, { t: "harvestHit", actor: a.id, prop: p.id, kind: p.kind, x: p.x, y: p.y, depleted: hit.depleted });
  return true;
}

/** Clear a vertical run of breakable tiles starting at the anchor and scatter debris. */
function breakTileRun(w: World, area: Area, target: Target) {
  const tx = target.tx!, ty = target.ty!;
  const t0 = area.tile(tx, ty);
  const def = TILE_INTERACT[t0];
  for (let y = ty; area.tile(tx, y) === t0; y++) area.setTile(tx, y, T.FLOOR);
  const d = def?.breakDebris;
  if (d) {
    for (let i = 0; i < d.count; i++)
      area.addDecal({ kind: "debris", x: (tx + d.dxTiles) * TS + w.rng.next() * d.w, y: (ty + d.dyTiles) * TS + w.rng.next() * d.h, v: (w.rng.next() * 4) | 0 });
  }
  emit(w, { t: "wallBroken", x: target.x, y: target.y });
}
