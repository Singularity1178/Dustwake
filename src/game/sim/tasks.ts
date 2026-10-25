// Performing work. An actor holds one current Task and a queue. Each tick the
// task advances; at its fire point its Effect is applied to the world. This is
// the single path by which interactions change the world, for any actor.
import { TS, T, TILE_INTERACT } from "../content/tiles";
import { ITEMS, glyphItem, type ItemId } from "../content/items";
import { TASK_KINDS, type Effect, type TaskSpec, type Target } from "../content/tasks";
import { emit, setFlag, actorById, areaOf, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { checkRune, deactivate } from "./ritual";

export function beginTask(a: Actor, spec: TaskSpec, target?: Target) {
  a.task = { ...spec, t: 0, fired: false, target };
  a.vx = 0; a.vy = 0;
}

/** Add work to the actor's queue; it starts when the current task finishes. */
export function enqueueTask(a: Actor, spec: TaskSpec, target?: Target) {
  a.queue.push({ ...spec, t: 0, fired: false, target });
}

/** Advance the actor's work by dt. */
export function tickTask(w: World, a: Actor, dt: number) {
  if (!a.task && a.queue.length) { a.task = a.queue.shift()!; a.vx = 0; a.vy = 0; }
  const task = a.task;
  if (!task) return;
  task.t += dt;
  emit(w, { t: "taskTick", actor: a.id, task, dt });
  if (!task.fired && task.t >= TASK_KINDS[task.kind].fire(task.dur)) {
    task.fired = true;
    if (task.effect) applyEffect(w, a, task.effect, task.target);
  }
  // An effect may have replaced the task (e.g. picking up the arm begins attaching it).
  if (task.t >= task.dur && a.task === task) a.task = null;
}

export function faceTo(a: Actor, x: number, y: number) {
  const dx = x - a.x, dy = y - (a.y - 4);
  a.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

export function addItem(w: World, a: Actor, id: ItemId) {
  a.inventory.push(id);
  emit(w, { t: "itemGained", actor: a.id, item: id, stored: true });
}
export function removeItem(a: Actor, id: ItemId) {
  const i = a.inventory.indexOf(id);
  if (i >= 0) a.inventory.splice(i, 1);
}

/** Run an effect after `delay` seconds of simulation time. */
export function schedule(w: World, delay: number, actor: Actor, effect: Effect) {
  w.scheduled.push({ at: w.time + delay, actor: actor.id, effect });
}

/** Fire scheduled effects that are due. */
export function runScheduled(w: World) {
  if (!w.scheduled.length) return;
  const due = w.scheduled.filter((s) => s.at <= w.time);
  if (!due.length) return;
  w.scheduled = w.scheduled.filter((s) => s.at > w.time);
  for (const s of due) {
    const a = actorById(w, s.actor);
    if (a) applyEffect(w, a, s.effect);
  }
}

export function applyEffect(w: World, a: Actor, e: Effect, target?: Target) {
  const area = areaOf(w, a);
  switch (e.op) {
    case "cue":
      emit(w, { t: "cue", cue: e.cue, x: target?.x ?? a.x, y: target?.y ?? a.y });
      break;
    case "takeLoose": {
      const l = target?.looseId ? area.looseItem(target.looseId) : undefined;
      if (!l || l.taken) break;
      area.takeLoose(l.id);
      addItem(w, a, l.item);
      break;
    }
    case "takePropItem": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      if (!p || p.taken || !p.item) break;
      area.setPropState(p.id, { taken: true });
      const def = ITEMS[p.item];
      if (def.equip) {
        emit(w, { t: "itemGained", actor: a.id, item: p.item, stored: false });
        beginTask(a, { kind: def.equip.task.kind, dur: def.equip.task.dur, effect: { op: "equip", item: p.item } });
        break;
      }
      addItem(w, a, p.item);
      break;
    }
    case "openContainer": {
      const p = target?.propId ? area.prop(target.propId) : undefined;
      if (!p || p.open) break;
      const item = p.item;
      area.setPropState(p.id, { open: true, item: null });
      emit(w, { t: "containerOpened", x: p.x, y: p.y });
      if (item) schedule(w, 0.25, a, { op: "grantItem", item });
      break;
    }
    case "grantItem":
      addItem(w, a, e.item);
      break;
    case "equip": {
      const def = ITEMS[e.item];
      if (def.equip) setFlag(w, def.equip.flag);
      emit(w, { t: "equipped", actor: a.id, item: e.item });
      break;
    }
    case "unlockTile": {
      if (target?.tx === undefined || target.ty === undefined) break;
      const def = TILE_INTERACT[area.tile(target.tx, target.ty)];
      if (e.consume) removeItem(a, e.consume);
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
      removeItem(a, e.consume);
      r.core = true;
      area.touch();
      emit(w, { t: "corePlaced" });
      checkRune(w, area);
      break;
    }
    case "carveGap": {
      const r = area.ritual;
      if (!r) break;
      r.carved = true;
      area.touch();
      emit(w, { t: "carved" });
      checkRune(w, area);
      break;
    }
    case "takeGlyph": {
      const r = area.ritual;
      const i = target?.socket;
      if (!r || i === undefined || r.sockets[i] < 0) break;
      const g = r.sockets[i];
      r.sockets[i] = -1;
      r.wrong[i] = false;
      area.touch();
      addItem(w, a, glyphItem(g));
      if (r.active) deactivate(w, area);
      break;
    }
    case "checkRune":
      checkRune(w, area);
      break;
  }
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
