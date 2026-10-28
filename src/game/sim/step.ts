// Per-frame simulation entry points. Deterministic given (world, dt, input)
// except where noted; no DOM. The host decides which of these run in which
// screen (e.g. overlays pause the world by simply not calling them).
import { RITUAL_SPOTS } from "../content/ritual";
import { FLAGS } from "../content/flags";
import { emit, hasFlag, player, areaOf, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { tickTask, runScheduled, beginTask } from "./tasks";
import { reconcileCapacity } from "./inventory";
import { reconcileGear } from "./gear";
import { boxFree as boxFreeAt, actorBoxes } from "./collision";
import { RULES } from "../content/interactions";
import { findTarget, findScanTarget, interact, npcInteractables, startSlam, type Interactable, type InteractUi } from "./interact";
import { actorDef } from "../content/actors";
import { actorSpeed } from "./actorStats";
import { cancelJob, tickJob } from "./jobs";
import { toggleScan } from "./analysis";
import { reactToEvents } from "./monologue";
import { coreKey } from "./commands";

export interface PlayerInput {
  ix: number; iy: number; use: boolean;
  /** Attack (Space on the play screen): the two-arm ground slam. Independent of `use` (E). */
  attack?: boolean;
  /** Slot or remove a power core in the golem body in front (C on the play screen; sim/commands.ts: coreKey). */
  core?: boolean;
  /** Toggle the sim's interaction mode (the host only forwards a key press). */
  toggleScan?: boolean;
  /** Movement speed multiplier (debug/testing). Defaults to 1. */
  speed?: number;
}
export interface PlayerStepResult { target: Interactable | null; ui: InteractUi | null }

/** Advance the player-controlled actor: work, locomotion, interaction, teleport. */
export function stepPlayer(w: World, dt: number, input: PlayerInput): PlayerStepResult {
  const pl = player(w);
  const area = areaOf(w, pl);
  if (input.toggleScan) toggleScan(pl);
  if (pl.job && pl.job.status !== "done" && (input.ix || input.iy || input.use || input.attack || input.core)) cancelJob(w, pl);
  tickTask(w, pl, dt);
  if (pl.job && pl.job.status !== "done" && (pl.job.status !== "paused" || pl.job.reason === "power")) {
    tickJob(w, pl, dt);
    reactToEvents(w);
    return { target: null, ui: null };
  }
  move(w, area, pl, dt, pl.task ? 0 : input.ix, pl.task ? 0 : input.iy, actorSpeed(w, pl) * (input.speed ?? 1));
  const scan = pl.task || pl.mode !== "scan" ? null : findScanTarget(area, pl);
  const target = pl.task ? null : scan ?? findTarget(area, pl, npcInteractables(w, area));
  let ui: InteractUi | null = null;
  if (!pl.task && target && input.use) ui = interact(w, pl, area, target);
  // C: the core seam, its own key so talking (E) can never slot or remove one by accident.
  if (!pl.task && !ui && input.core) coreKey(w, pl, area);
  // The attack is separate from interacting: available whenever the golem could act, target or not.
  if (!pl.task && !ui && input.attack) startSlam(pl);
  // Tutorial beat (one-shot): standing on the freshly charged circle starts the
  // first jump through the rune network. Afterwards runes are used with E.
  const r = area.ritual;
  if (r && r.active && r.actT > RITUAL_SPOTS.teleport.delay && !pl.task && !hasFlag(w, FLAGS.tutorialDone)) {
    const c = area.ritualPos;
    const dx = c.x - pl.x, dy = c.y + RITUAL_SPOTS.teleport.dy - pl.y;
    if (dx * dx + dy * dy < RITUAL_SPOTS.teleport.r2) {
      pl.facing = "down";
      const first = RULES.rune[RULES.rune.length - 1].task;
      beginTask(pl, first, { kind: "rune", x: c.x, y: c.y, propId: "rune.dungeon" });
      emit(w, { t: "teleport", actor: pl.id, first: true, x: c.x, y: c.y });
    }
  }
  reactToEvents(w);
  return { target, ui };
}

/** Active-play time stat (shown on the end screen). */
export function addPlayTime(w: World, dt: number) { w.playTime += dt; }

/** Advance everything that runs on world time: clock, scheduled effects, non-player actors, area features. */
//
// Off-screen policy: every loaded area is simulated every step (see
// ARCHITECTURE.md). Non-player actors tick wherever they are; scheduled effects
// carry the area they were scheduled in.
export function stepWorld(w: World, dt: number) {
  w.time += dt;
  runScheduled(w);
  for (const a of [...w.actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    reconcileGear(w, a);
    reconcileCapacity(w, a);
    if (a.id !== w.playerId) { tickTask(w, a, dt); tickJob(w, a, dt); }
  }
  for (const area of w.areas.values()) {
    area.advanceRitual(dt);
  }
  // Inner-monologue event triggers see everything this step emitted (sim/monologue.ts).
  reactToEvents(w);
}

// ---------------------------------------------------------------- locomotion
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
  // Other actors' bodies (NPCs) block like props do.
  const bodies = actorBoxes(w, area.id, pl.id);
  const boxFree = (a: Area, x: number, y: number) => boxFreeAt(a, x, y, bodies, actorDef(pl).body.box);
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
