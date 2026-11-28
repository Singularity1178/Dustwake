// Simulation level of detail (pure, no DOM). With hundreds of residents, and an
// overworld that is one continuous area meant to hold many settlements, stepping
// everyone loaded every tick does not hold. Actors are stepped by tier:
//
//   active  in view (a box round the player as wide as the widest zoom, plus a
//           margin): a full step every tick.
//   near    in the player's area and close: inside the bubble (`nearW` x
//           `nearH` round the player), or anywhere in a settlement that is
//           awake. Stepped on a coarser beat (every `nearDt` seconds, the step
//           that long), in pieces no longer than `maxStep` so walking and
//           collision stay as fine as ever.
//   far     everything else: another area, or the same area a long way off.
//           Abstract. Routine actors (townsfolk) are not stepped at all: what
//           they are doing is a function of the hour, and they are set down
//           where it says when someone comes near (sim/folk.ts: settle). An
//           actor with work (a task, a queue, an order) is stepped on the far
//           beat (`farDt`) and walks abstractly: along its planned path with no
//           collision against other bodies (sim/navigation.ts), so a worker sent
//           to the far end of the overworld still walks there and does the job,
//           at the pace it would have, for a fraction of the cost.
//
// Zones are the unit a settlement wakes by (world/zones.ts). A zone that wakes
// "whole" (a town) is awake when the player's bubble touches any part of it, and
// then all of it is near: a town is never half simulated, with people frozen at
// an invisible line. Wild country wakes only where the bubble is.
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
import { zoneAt, zoneGap, zonesOf } from "../world/zones";

export type LodTier = "active" | "near" | "far";

export interface LodPolicy {
  /** Half the size of the box round the player that counts as in view (px). */
  halfW: number;
  halfH: number;
  /** Half the size of the bubble round the player that is simulated in place (px): about three screens each way. */
  nearW: number;
  nearH: number;
  /** The near beat (s). */
  nearDt: number;
  /** The far beat for actors with work (s). */
  farDt: number;
  /** Longest single step handed to an actor while it catches up (s). */
  maxStep: number;
}

/** The widest view is 640 x 360 world px (2x zoom); a 96 px margin keeps edge-walkers full-rate as they come in. */
export const DEFAULT_LOD: LodPolicy = { halfW: 320 + 96, halfH: 180 + 96, nearW: 1040, nearH: 720, nearDt: 0.1, farDt: 0.5, maxStep: 0.1 };

export interface LodState {
  policy: LodPolicy;
  /** The area the player stood in last tick (entering another runs the catch-up hooks). Transient. */
  focusArea: string | null;
  /** Zones of the player's area that are awake as a whole this tick (settlements the bubble touches). Transient. */
  awake: Set<string>;
  /** Actors seen per tier on the last tick (presentation, the soak report). */
  counts: Record<LodTier, number>;
  /** Actor steps actually run on the last tick. */
  steps: number;
}

/** A catch-up hook: `area` has just become the player's again after `elapsed` seconds unticked. */
export type CatchUp = (w: World, area: Area, elapsed: number) => void;

export function enableLod(w: World, policy: Partial<LodPolicy> = {}): LodState {
  w.lod = { policy: { ...DEFAULT_LOD, ...policy }, focusArea: null, awake: new Set(), counts: { active: 0, near: 0, far: 0 }, steps: 0 };
  return w.lod;
}

export function disableLod(w: World) { w.lod = null; }

/** Which tier `a` is in this tick (the player is always active). */
export function lodTier(w: World, a: Actor, pl: Actor | undefined): LodTier {
  if (!pl || a.id === pl.id) return "active";
  if (a.area !== pl.area) return "far";
  const P = w.lod?.policy ?? DEFAULT_LOD;
  const dx = Math.abs(a.x - pl.x), dy = Math.abs(a.y - pl.y);
  if (dx <= P.halfW && dy <= P.halfH) return "active";
  if (dx <= P.nearW && dy <= P.nearH) return "near";
  const awake = w.lod?.awake;
  if (awake?.size) {
    const area = w.areas.get(a.area), z = area ? zoneAt(area, a.x, a.y) : null;
    if (z && awake.has(z.id)) return "near";
  }
  return "far";
}

/** Is this zone of the player's area awake (LOD off: everything is)? */
export const zoneAwake = (w: World, zone: string | undefined) => !w.lod || !zone || w.lod.awake.has(zone);

/**
 * Does `a` move abstractly this tick: LOD is on and it is far from the player? Such a body follows its planned path
 * without testing other bodies (nobody is there to see it squeeze past), which is what makes distant work cheap.
 */
export function isAbstract(w: World, a: Actor): boolean {
  if (!w.lod || a.id === w.playerId) return false;
  const pl = w.actors.find((p) => p.id === w.playerId);
  return !!pl && lodTier(w, a, pl) === "far";
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

/**
 * Called by stepWorld each tick, before focusTick: which settlements of the player's area are awake. A zone that wakes
 * whole is awake while the player's bubble touches its rect. Cheap whatever the number of zones (a few comparisons
 * each); nothing is done on waking, because nobody in a sleeping zone holds state that needs advancing: its people
 * are set down by the hour the first time they are stepped again (sim/folk.ts: the STALE rule).
 */
export function wakeZones(w: World, pl: Actor, area: Area) {
  const lod = w.lod;
  if (!lod) return;
  const zones = zonesOf(area);
  if (!zones.length) { if (lod.awake.size) lod.awake = new Set(); return; }
  const P = lod.policy, next = new Set<string>();
  for (const z of zones) {
    if (z.wake !== "whole") continue;
    const g = zoneGap(z, pl.x, pl.y);
    if (g.dx <= P.nearW && g.dy <= P.nearH) next.add(z.id);
  }
  lod.awake = next;
}
