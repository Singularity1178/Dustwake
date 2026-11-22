// Simulation level of detail (pure, no DOM). With hundreds of residents, stepping
// everyone loaded every tick does not hold, so actors are stepped by tier:
//
//   active  in view (a box round the player as wide as the widest zoom, plus a
//           margin): a full step every tick.
//   near    the player's area, off camera: stepped on a coarser beat (every
//           `nearDt` seconds, the step that long), in pieces no longer than
//           `maxStep` so walking and collision stay as fine as ever.
//   far     any other area: abstract. Routine actors (townsfolk) are not stepped
//           at all and are set down where the hour says when the player comes
//           in (sim/folk.ts: settle); an actor with work (a task, a queue, an
//           order) is stepped on the far beat (`farDt`), so a worker gathering
//           two areas away still gets its work done.
//
// The beat is a pure function of world time and the actor's id (no per-actor
// state), so LOD is deterministic, survives a save and load exactly, and gives
// the same world at 1x and at 8x (tests/timestep.test.ts, tests/lod.test.ts).
//
// Areas the player is not in do not tick their own features (the ritual's
// charge); entering one catches it up from `area.lastTicked` (catch-up hooks,
// run by sim/step.ts). LOD is a host policy: `World.lod` is null (everything
// stepped every tick, as before) unless the host enables it, which the game
// does from its settings and the soak harness does always.
import type { Actor, World } from "../world/world";
import type { Area } from "../world/area";
import { hash01 } from "../content/daycycle";

export type LodTier = "active" | "near" | "far";

export interface LodPolicy {
  /** Half the size of the box round the player that counts as in view (px). */
  halfW: number;
  halfH: number;
  /** The near beat (s). */
  nearDt: number;
  /** The far beat for actors with work (s). */
  farDt: number;
  /** Longest single step handed to an actor while it catches up (s). */
  maxStep: number;
}

/** The widest view is 640 x 360 world px (2x zoom); a 96 px margin keeps edge-walkers full-rate as they come in. */
export const DEFAULT_LOD: LodPolicy = { halfW: 320 + 96, halfH: 180 + 96, nearDt: 0.1, farDt: 0.5, maxStep: 0.1 };

export interface LodState {
  policy: LodPolicy;
  /** The area the player stood in last tick (entering another runs the catch-up hooks). Transient. */
  focusArea: string | null;
  /** Actors seen per tier on the last tick (presentation, the soak report). */
  counts: Record<LodTier, number>;
  /** Actor steps actually run on the last tick. */
  steps: number;
}

/** A catch-up hook: `area` has just become the player's again after `elapsed` seconds unticked. */
export type CatchUp = (w: World, area: Area, elapsed: number) => void;

export function enableLod(w: World, policy: Partial<LodPolicy> = {}): LodState {
  w.lod = { policy: { ...DEFAULT_LOD, ...policy }, focusArea: null, counts: { active: 0, near: 0, far: 0 }, steps: 0 };
  return w.lod;
}

export function disableLod(w: World) { w.lod = null; }

/** Which tier `a` is in this tick (the player is always active). */
export function lodTier(w: World, a: Actor, pl: Actor | undefined): LodTier {
  if (!pl || a.id === pl.id) return "active";
  if (a.area !== pl.area) return "far";
  const P = w.lod?.policy ?? DEFAULT_LOD;
  return Math.abs(a.x - pl.x) <= P.halfW && Math.abs(a.y - pl.y) <= P.halfH ? "active" : "near";
}

/**
 * Seconds to step `a` this tick (0: not this tick). `dt` is the tick just run, ending at `w.time`. Active actors
 * step every tick; near (and far ones with work) on their beat, offset per actor so the load spreads over ticks.
 */
export function lodDue(w: World, a: Actor, tier: LodTier, dt: number, hasWork: boolean): number {
  const lod = w.lod;
  if (lod) lod.counts[tier]++;
  if (!lod || tier === "active") return dt;
  if (tier === "far" && !hasWork) return 0;
  const period = tier === "near" ? lod.policy.nearDt : lod.policy.farDt;
  if (dt >= period) return dt;
  const t1 = w.time + hash01(a.id, 77) * period, t0 = t1 - dt;
  return Math.floor(t1 / period) !== Math.floor(t0 / period) ? period : 0;
}

/** Run `step` for `total` seconds in pieces no longer than the policy's `maxStep`. */
export function stepIn(w: World, total: number, step: (dt: number) => void) {
  const m = w.lod?.policy.maxStep ?? total;
  if (w.lod) w.lod.steps++;
  if (total <= m) { step(total); return; }
  let left = total;
  while (left > 1e-9) {
    const d = Math.min(m, left);
    step(d);
    left -= d;
  }
}

/**
 * Called by stepWorld at the start of each tick: when the player has come into another area, run the catch-up
 * hooks for the time that area went unticked. Returns the area that is in focus now.
 */
export function focusTick(w: World, dt: number, area: Area | undefined, hooks: readonly CatchUp[]) {
  const lod = w.lod;
  if (!lod || !area) return;
  lod.counts = { active: 0, near: 0, far: 0 };
  lod.steps = 0;
  if (lod.focusArea === area.id) return;
  const elapsed = w.time - dt - area.lastTicked;
  if (lod.focusArea !== null && elapsed > 1e-6) for (const h of hooks) h(w, area, elapsed);
  lod.focusArea = area.id;
}
