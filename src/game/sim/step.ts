// Per-frame simulation entry points. Deterministic given (world, dt, input)
// except where noted; no DOM. The host decides which of these run in which
// screen (e.g. overlays pause the world by simply not calling them).
import { isSolidT } from "../content/tiles";
import { RITUAL_SPOTS } from "../content/ritual";
import { FLAGS } from "../content/flags";
import { emit, hasFlag, player, areaOf, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { tickTask, runScheduled } from "./tasks";
import { findTarget, interact, type Interactable, type InteractUi } from "./interact";
import { TS } from "../content/tiles";

export interface PlayerInput {
  ix: number; iy: number; use: boolean;
  /** Movement speed multiplier (debug/testing). Defaults to 1. */
  speed?: number;
}
export interface PlayerStepResult { target: Interactable | null; ui: InteractUi | null }

/** Advance the player-controlled actor: work, locomotion, interaction, teleport. */
export function stepPlayer(w: World, dt: number, input: PlayerInput): PlayerStepResult {
  const pl = player(w);
  const area = areaOf(w, pl);
  tickTask(w, pl, dt);
  move(w, area, pl, dt, pl.task ? 0 : input.ix, pl.task ? 0 : input.iy, (hasFlag(w, FLAGS.golemArm) ? 30 : 24) * (input.speed ?? 1));
  const target = pl.task ? null : findTarget(area, pl);
  let ui: InteractUi | null = null;
  if (!pl.task && target && input.use) ui = interact(w, pl, area, target);
  // standing on an active circle teleports
  const r = area.ritual, c = area.ritualPos;
  if (r && r.active && r.actT > RITUAL_SPOTS.teleport.delay && !pl.task) {
    const dx = c.x - pl.x, dy = c.y + RITUAL_SPOTS.teleport.dy - pl.y;
    if (dx * dx + dy * dy < RITUAL_SPOTS.teleport.r2) {
      pl.facing = "down";
      emit(w, { t: "teleport", actor: pl.id });
    }
  }
  return { target, ui };
}

/** Active-play time stat (shown on the end screen). */
export function addPlayTime(w: World, dt: number) { w.playTime += dt; }

/** Advance everything that runs on world time: clock, scheduled effects, non-player actors, area features. */
export function stepWorld(w: World, dt: number) {
  w.time += dt;
  runScheduled(w);
  for (const a of w.actors) if (a.id !== w.playerId) tickTask(w, a, dt);
  for (const area of w.areas.values()) {
    const r = area.ritual;
    if (r?.active) r.actT += dt;
  }
}

// ---------------------------------------------------------------- locomotion
function boxFree(area: Area, x: number, y: number) {
  const x0 = x - 5, x1 = x + 5, y0 = y - 5, y1 = y;
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++)
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++) {
      if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) return false;
      if (isSolidT(area.grid[ty * area.w + tx])) return false;
    }
  for (const p of area.props) {
    const b = p.box;
    if (!b) continue;
    if (x1 > b[0] && x0 < b[2] && y1 > b[1] && y0 < b[3]) return false;
  }
  return true;
}

/** Limping golem locomotion with wall sliding and corner nudging. */
export function move(w: World, area: Area, pl: Actor, dt: number, ix: number, iy: number, base: number) {
  const mag = Math.hypot(ix, iy);
  if (mag > 0) { ix /= mag; iy /= mag; pl.facing = Math.abs(ix) > Math.abs(iy) ? (ix > 0 ? "right" : "left") : iy > 0 ? "down" : "up"; }
  const limp = 0.55 + 0.6 * Math.abs(Math.sin(pl.phase));
  const tx = ix * base * limp, ty = iy * base * limp;
  const acc = mag > 0 ? 7 : 10;
  pl.vx += (tx - pl.vx) * Math.min(1, acc * dt);
  pl.vy += (ty - pl.vy) * Math.min(1, acc * dt);
  const sp = Math.hypot(pl.vx, pl.vy);
  pl.moving = sp > 4;
  const nx = pl.x + pl.vx * dt;
  if (boxFree(area, nx, pl.y)) pl.x = nx;
  else {
    if (Math.abs(iy) < 0.3 && ix !== 0) for (const d of [2, 4, 6, 8]) {
      if (boxFree(area, nx, pl.y - d)) { pl.y -= Math.min(d, 20 * dt); break; }
      if (boxFree(area, nx, pl.y + d)) { pl.y += Math.min(d, 20 * dt); break; }
    }
    pl.vx *= 0.3;
  }
  const ny = pl.y + pl.vy * dt;
  if (boxFree(area, pl.x, ny)) pl.y = ny;
  else {
    if (Math.abs(ix) < 0.3 && iy !== 0) for (const d of [2, 4, 6, 8]) {
      if (boxFree(area, pl.x - d, ny)) { pl.x -= Math.min(d, 20 * dt); break; }
      if (boxFree(area, pl.x + d, ny)) { pl.x += Math.min(d, 20 * dt); break; }
    }
    pl.vy *= 0.3;
  }
  if (pl.moving) {
    const before = Math.sin(pl.phase);
    pl.phase += dt * (3.2 + sp * 0.09);
    const after = Math.sin(pl.phase);
    if ((before < 0) !== (after < 0)) {
      pl.steps++;
      emit(w, { t: "step", actor: pl.id, heavy: pl.steps % 2 === 0 });
    }
  } else pl.phase = pl.phase % Math.PI < 0.2 ? pl.phase : pl.phase + dt * 2;
}
