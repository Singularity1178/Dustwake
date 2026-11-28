// Per-frame simulation entry points. Deterministic given (world, dt, input)
// except where noted; no DOM. The host decides which of these run in which
// screen (e.g. overlays pause the world by simply not calling them).
import { TS } from "../content/tiles";
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
import { portalAt, portalOpen, walkThrough } from "./portals";
import { stepDay } from "./daytime";
import { tickFolk, folkCatchUp } from "./folk";
import { focusTick, lodDue, lodTier, stepIn, wakeZones, type CatchUp } from "./lod";
import { zoneAt, zoneById, zoneGap, inZone } from "../world/zones";
import { tickKeepers } from "./shops";
import { discover } from "../world/discovery";

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
  /** Walk through walls and props (debug/testing; the area's edge still holds). */
  noclip?: boolean;
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
  move(w, area, pl, dt, pl.task ? 0 : input.ix, pl.task ? 0 : input.iy, actorSpeed(w, pl) * (input.speed ?? 1), input.noclip);
  // Roads and doorways (sim/portals.ts): pushing on through one walks into the area beyond.
  if (!pl.task && (input.ix || input.iy)) {
    const way = portalAt(area, pl.x, pl.y, input.ix, input.iy, (p) => portalOpen(w, p));
    if (way && walkThrough(w, pl, area, way)) { reactToEvents(w); return { target: null, ui: null }; }
  }
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

/** Active-play time stat (shown on the chapter card that closes the first crossing). */
export function addPlayTime(w: World, dt: number) { w.playTime += dt; }

/** Advance everything that runs on world time: clock, scheduled effects, non-player actors, area features. */
//
// Off-screen policy (sim/lod.ts, docs/sim/lod.md). With `w.lod` null every loaded area is simulated every step, as it
// always was. With LOD on, actors are stepped by tier (active / near / far), areas other than the player's do not tick
// their own features, and coming back into one runs CATCH_UP for the time it went unticked. Non-player actors tick
// wherever they are; scheduled effects carry the area they were scheduled in.
/** What an area catches up on when the player comes back into it under LOD: its ritual's charge, its people's hour. */
export const CATCH_UP: CatchUp[] = [
  (_w, area, elapsed) => area.advanceRitual(elapsed),
  (w, area) => folkCatchUp(w, area),
];

export function stepWorld(w: World, dt: number) {
  w.time += dt;
  stepDay(w, dt);
  runScheduled(w);
  const lod = w.lod, pl = w.actors.find((a) => a.id === w.playerId);
  const here = pl && w.areas.get(pl.area);
  if (lod) { if (pl && here) wakeZones(w, pl, here); focusTick(w, dt, here, CATCH_UP); }
  if (pl && here) trackZone(w, pl, here);
  for (const a of orderedActors(w)) {
    reconcileGear(w, a);
    reconcileCapacity(w, a);
    if (a.id === w.playerId) continue;
    if (!lod) { tickTask(w, a, dt); tickJob(w, a, dt); continue; }
    // work to do: a task under way, one queued, or an order not finished (an idle body has nothing to step)
    if (!a.task && !a.queue.length && !(a.job && a.job.status !== "done")) continue;
    const due = lodDue(w, a, lodTier(w, a, pl), dt, true);
    if (due > 0) stepIn(w, due, (s) => { tickTask(w, a, s); tickJob(w, a, s); });
  }
  for (const area of w.areas.values()) {
    if (lod && pl && area.id !== pl.area) continue; // far areas wait; coming back catches them up (CATCH_UP)
    area.advanceRitual(dt);
    area.lastTicked = w.time;
  }
  // townsfolk live by their routines (sim/folk.ts): stepped in the player's area (by LOD tier), set down by the hour elsewhere
  tickFolk(w, dt);
  // shopkeepers keep their counters and their hours (sim/shops.ts): stepped in the room the golem is in
  tickKeepers(w, dt);
  // Inner-monologue event triggers see everything this step emitted (sim/monologue.ts).
  reactToEvents(w);
}

/** How far inside a zone's edge (px) the player must be before it counts as entered: walking along a border names nothing twice. */
const ZONE_EDGE = 20;

/**
 * Follow the player from zone to zone (world/zones.ts) and say so: `zoneEntered`. The first tick of a world only notes
 * where they are. Wherever the player is found to be is also put on record (world/discovery.ts): this is the one
 * place a zone is discovered by walking, and it uses the same edge rule as the name on the screen, so a place is
 * known from the moment it is announced, never from brushing its border.
 */
function trackZone(w: World, pl: Actor, area: Area) {
  const z = zoneAt(area, pl.x, pl.y), prev = w.focus;
  if (!prev) { w.focus = { area: area.id, zone: z?.id ?? null }; discover(w, area.id, z?.id); return; }
  const same = prev.area === area.id;
  if (same && prev.zone === (z?.id ?? null)) return;
  if (same) {
    // across an edge on foot: only once well inside the new zone, or well clear of the old one
    const b = ZONE_EDGE;
    if (z && !(inZone(z, pl.x - b, pl.y - b) && inZone(z, pl.x + b, pl.y + b))) return;
    const old = zoneById(area, prev.zone);
    if (!z && old) { const g = zoneGap(old, pl.x, pl.y); if (g.dx < b && g.dy < b) return; }
  }
  w.focus = { area: area.id, zone: z?.id ?? null };
  discover(w, area.id, z?.id);
  if (z) emit(w, { t: "zoneEntered", actor: pl.id, area: area.id, zone: z.id, from: same ? prev.zone : null, walked: same });
}

/**
 * The actors in id order (the order they are stepped in, so a world steps the same whatever order they were made
 * in). Sorted once and kept while the same actors are there: sorting hundreds of ids sixty times a second is real money.
 */
const ordered = new WeakMap<Actor[], { n: number; first: Actor | undefined; last: Actor | undefined; list: Actor[] }>();
function orderedActors(w: World): Actor[] {
  const src = w.actors, c = ordered.get(src);
  if (c && c.n === src.length && c.first === src[0] && c.last === src[src.length - 1]) return c.list;
  const list = [...src].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ordered.set(src, { n: src.length, first: src[0], last: src[src.length - 1], list });
  return list;
}

// ---------------------------------------------------------------- locomotion
/** Limping golem locomotion with wall sliding and corner nudging. */
export function move(w: World, area: Area, pl: Actor, dt: number, ix: number, iy: number, base: number, noclip = false) {
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
  const boxFree = noclip
    ? (a: Area, x: number, y: number) => x > 2 && y > 6 && x < a.w * TS - 2 && y < a.h * TS - 1
    : (a: Area, x: number, y: number) => boxFreeAt(a, x, y, bodies, actorDef(pl).body.box);
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
