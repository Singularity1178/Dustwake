// The worker golem's animation sequencer: pure (no DOM, no Math.random, no sim
// access), driven once per frame by the host with what the sim says about the
// body (powered, working, has a core). It never writes the sim: the golem's
// orders and power are the sim's; this only decides how the body gets between
// its postures, and says when something should be heard or kicked up as dust.
//
//   off       no power: crouched, lid down, core dark. The sequencer's rest state.
//   boot      a core goes in (3.6 s): the core sparks and gutters, the lamp sputters
//             on, the head comes up and looks left, then right (a self-check), the
//             arms unfold, it rises, plants its feet. Ends standing.
//   stand     powered and upright. Working, or on standby (core a little brighter
//             than dormant, lamp on) until it has been idle for IDLE_DELAY.
//   settle    idle too long (2.2 s): one slow scan, a blink, the lamp dims, arms
//             fold, it lowers itself into a crouch, the core eases down.
//   dormant   powered but crouched and idle: lid down, core faintly warm.
//   wake      dormant and given work: core flares, lamp opens, it stands (0.6 s).
//   shutdown  the core comes out (2.6 s): a jolt, lamp and core gutter out, the
//             head turns aside and drops, the arms go slack, it sags into a crouch.
//             Played relative to the posture it was in, so a dormant one only
//             gutters and nods.
// Switching modes mid-way never pops: the output blends from the last frame's.
// Walking and task motion are not here: they layer on top of `stand` (drawActor).
import type { Facing } from "./golem";
import { workerPose, WORKER_CORE, type WorkerPose } from "./workerArt";

export type AnimMode = "off" | "boot" | "stand" | "settle" | "dormant" | "wake" | "shutdown";

/** The continuous channels the sequencer drives (the rest of WorkerPose is motion). */
export interface Channels { rise: number; neck: number; yaw: number; arms: number; shake: number; dip: number; core: number; eye: number }

/** Things the host should react to as they happen (sound, dust, sparks): drained by the host each frame. */
export type AnimCue = "spark" | "creak" | "lamp" | "plant" | "jolt" | "lampOut" | "settle";

export interface WorkerAnim {
  mode: AnimMode;
  /** Seconds in this mode. */
  t: number;
  /** Seconds spent standing on standby (not working). */
  idle: number;
  /** The channels as of the last step (what is drawn). */
  out: Channels;
  /** The channels when this mode began (shutdown plays relative to them, and every mode blends from them). */
  from: Channels;
  /** Seconds the blend from `from` lasts, and how far it has got. */
  blendFor: number;
  cues: AnimCue[];
}

export interface WorkerInput { powered: boolean; active: boolean; moving: boolean; hasCore: boolean }

export const DUR = { boot: 3.6, wake: 0.6, settle: 2.2, shutdown: 2.6 } as const;
/** Seconds standing about with nothing to do before it settles down. */
export const IDLE_DELAY = 3.5;
/** Standby core glow (working is 1, dormant WORKER_CORE.idle). */
export const STANDBY_CORE = 0.7;

// ------------------------------------------------------------------ keyframes
const sm = (v: number) => v * v * (3 - 2 * v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Eased value of a [time, value] track at t (clamped outside its keys). */
export function track(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * sm(clamp01((t - t0) / (t1 - t0))); }
  }
  return keys[keys.length - 1][1];
}
/** 0..1 across [a, b], eased. */
const ramp = (t: number, a: number, b: number) => sm(clamp01((t - a) / (b - a)));
/** A deterministic gutter: 1 (lit) or `lo`, flipping fast. */
const flick = (t: number, lo = 0.12) => (Math.sin(t * 41) + Math.sin(t * 23.7) > 0.25 ? 1 : lo);

const REST: Channels = { rise: 0, neck: 0, yaw: 0, arms: 0, shake: 0, dip: 0, core: 0, eye: 0 };
const STAND: Channels = { rise: 1, neck: 1, yaw: 0, arms: 1, shake: 0, dip: 0, core: 1, eye: 1 };

/** The steady channels of a mode when nothing is moving between postures. */
export function steady(mode: AnimMode, powered: boolean, active: boolean, t = 0): Channels {
  switch (mode) {
    case "stand": return active ? STAND : { ...STAND, core: STANDBY_CORE + Math.sin(t * 2.2) * 0.06, eye: 0.9 };
    case "dormant": return { ...REST, core: powered ? WORKER_CORE.idle : 0 };
    default: return { ...REST };
  }
}

function boot(t: number): Channels {
  const eyeOn = t < 1.2 ? 0 : t < 1.9 ? flick(t) * (0.35 + 0.65 * ramp(t, 1.2, 1.9)) : 1;
  const core = track(t, [[0, 0], [0.28, 0], [0.34, 1], [0.7, 0.22], [1.4, 0.38], [2.2, 0.38], [2.6, 1], [3.0, 1], [3.6, STANDBY_CORE]]);
  const gutter = t > 0.34 && t < 1.3 ? (flick(t * 1.3, 0.55) - 1) * 0.3 * (1 - ramp(t, 0.34, 1.3)) : 0;
  return {
    rise: track(t, [[0, 0], [2.5, 0], [3.2, 1]]),
    neck: track(t, [[0, 0], [1.4, 0], [2.0, 1]]),
    yaw: track(t, [[0, 0], [2.0, 0], [2.25, -1], [2.65, -1], [2.95, 1], [3.25, 1], [3.5, 0]]),
    arms: track(t, [[0, 0], [2.4, 0], [3.0, 1]]),
    shake: t > 0.3 && t < 0.62 ? 0.9 : t > 1.2 && t < 1.8 ? 0.35 : t > 2.5 && t < 2.75 ? 0.25 : 0,
    dip: track(t, [[0, 0], [3.12, 0], [3.28, 1], [3.5, 0]]),
    core: Math.max(0, core + gutter),
    eye: eyeOn,
  };
}

function wake(t: number): Channels {
  return {
    rise: track(t, [[0, 0], [0.08, 0], [0.42, 1]]),
    neck: track(t, [[0, 0], [0.3, 1]]),
    yaw: 0,
    arms: track(t, [[0, 0], [0.12, 0], [0.36, 1]]),
    shake: t < 0.12 ? 0.5 : 0,
    dip: track(t, [[0, 0], [0.4, 0], [0.48, 1], [0.6, 0]]),
    core: track(t, [[0, WORKER_CORE.idle], [0.1, 1]]),
    eye: t < 0.1 ? 0 : t < 0.3 ? flick(t, 0.2) : 1,
  };
}

function settle(t: number): Channels {
  return {
    rise: track(t, [[0, 1], [1.3, 1], [2.1, 0]]),
    neck: track(t, [[0, 1], [1.3, 1], [2.0, 0]]),
    yaw: track(t, [[0, 0], [0.5, -0.8], [0.95, 0.8], [1.35, 0]]),
    arms: track(t, [[0, 1], [1.25, 1], [1.9, 0]]),
    shake: 0,
    dip: track(t, [[0, 0], [1.3, 0], [1.6, 1], [2.1, 0]]),
    core: track(t, [[0, STANDBY_CORE], [2.1, WORKER_CORE.idle]]),
    eye: track(t, [[0, 0.9], [0.4, 0.9], [0.46, 0.05], [0.6, 0.85], [1.0, 0.85], [1.5, 0.3], [1.85, 0]]),
  };
}

/** Relative to `s`, the channels when shutdown began. */
function shutdown(t: number, s: Channels): Channels {
  const up = s.rise > 0.5;
  const fade = (a: number, b: number) => 1 - ramp(t, a, b);
  const eye = t < 0.1 ? s.eye : t < 0.95 ? s.eye * flick(t * 1.1) * (1 - ramp(t, 0.1, 0.95)) : 0;
  const core = t < 0.2 ? s.core : t < 1.5 ? s.core * (0.25 + 0.75 * flick(t * 0.9, 0.2)) * (1 - ramp(t, 0.2, 1.5)) : 0;
  return {
    rise: s.rise * fade(0.9, 1.95),
    neck: s.neck * fade(0.5, 1.25),
    yaw: track(t, [[0, s.yaw], [0.65, -1], [2.0, -1], [2.6, 0]]),
    arms: s.arms * fade(0.7, 1.35),
    shake: (up ? 1 : 0.4) * (1 - ramp(t, 0.03, 0.7)),
    dip: up ? track(t, [[0, 0], [0.9, 0], [1.2, 1], [1.7, 2], [1.95, 0]]) : 0,
    core, eye,
  };
}

// ------------------------------------------------------------------ the sequencer
const copy = (c: Channels): Channels => ({ ...c });
function lerpC(a: Channels, b: Channels, k: number): Channels {
  const o = {} as Channels;
  for (const key of Object.keys(a) as (keyof Channels)[]) o[key] = a[key] + (b[key] - a[key]) * k;
  return o;
}

/** A sequencer at rest in the posture the sim's state implies (a loaded game, a body first seen): no animation plays. */
export function initWorkerAnim(i: WorkerInput): WorkerAnim {
  const mode: AnimMode = !i.powered ? "off" : i.active ? "stand" : "dormant";
  const out = steady(mode, i.powered, i.active);
  return { mode, t: 0, idle: 0, out, from: copy(out), blendFor: 0, cues: [] };
}

function enter(a: WorkerAnim, mode: AnimMode, blend: number) {
  a.from = copy(a.out); a.mode = mode; a.t = 0; a.blendFor = blend;
}

/** The mode's raw target at its current time. */
function target(a: WorkerAnim, i: WorkerInput): Channels {
  switch (a.mode) {
    case "boot": return boot(a.t);
    case "wake": return wake(a.t);
    case "settle": return settle(a.t);
    case "shutdown": return shutdown(a.t, a.from);
    default: return steady(a.mode, i.powered, i.active, a.t);
  }
}

/** The times in each mode at which a cue fires. */
const CUES: Record<string, [number, AnimCue][]> = {
  boot: [[0.3, "spark"], [1.4, "creak"], [1.5, "lamp"], [3.2, "plant"]],
  wake: [[0.05, "spark"], [0.44, "plant"]],
  settle: [[0.45, "lampOut"], [1.4, "settle"], [2.0, "plant"]],
  shutdown: [[0.02, "jolt"], [0.5, "lampOut"], [1.9, "plant"]],
};

export function stepWorkerAnim(a: WorkerAnim, dt: number, i: WorkerInput): void {
  a.t += dt;
  if (!i.powered) {
    if (a.mode !== "off" && a.mode !== "shutdown") enter(a, "shutdown", 0.12);
  } else if (a.mode === "off" || a.mode === "shutdown") {
    enter(a, "boot", a.mode === "shutdown" ? 0.45 : 0.05);
  } else if (i.active) {
    a.idle = 0;
    if (a.mode === "dormant") enter(a, "wake", 0.15);
    else if (a.mode === "settle") enter(a, "stand", 0.45);
  } else if (a.mode === "stand") {
    a.idle += dt;
    if (a.idle >= IDLE_DELAY) enter(a, "settle", 0.3);
  }
  // A body that starts walking or working cannot keep playing a crouched boot: cut to the quick stand.
  if (i.powered && (i.moving || i.active) && a.mode === "boot" && a.t > 0.6) enter(a, "wake", 0.25);
  // timed completion
  if (a.mode === "boot" && a.t >= DUR.boot) enter(a, "stand", 0);
  else if (a.mode === "wake" && a.t >= DUR.wake) enter(a, "stand", 0);
  else if (a.mode === "settle" && a.t >= DUR.settle) enter(a, "dormant", 0);
  else if (a.mode === "shutdown" && a.t >= DUR.shutdown) enter(a, "off", 0);
  for (const [at, cue] of CUES[a.mode] ?? []) if (a.t - dt < at && a.t >= at) a.cues.push(cue);
  const raw = target(a, i);
  a.out = a.blendFor > 0 && a.t < a.blendFor ? lerpC(a.from, raw, sm(a.t / a.blendFor)) : raw;
}

/** Take the cues that fired since the last call. */
export function drainCues(a: WorkerAnim): AnimCue[] { const c = a.cues; a.cues = []; return c; }

/** Is the body down (crouched, or lowering itself): it cannot walk or work from here. */
export const isDown = (a: WorkerAnim) => a.out.rise < 0.9;

// ------------------------------------------------------------------ the pose
/** What the body is doing with its arms, from the actor's task (`k` = t/dur). Walking and rune channelling add nothing here. */
export interface TaskMotion { swing: number; reach: number; dip: number }
export const NO_MOTION: TaskMotion = { swing: 0, reach: 0, dip: 0 };

/** The harvest blow lands at HIT of its duration; same shape as the maintainer's slam (golem.ts: slamPose). */
export function blowMotion(k: number, hit = 0.5): TaskMotion {
  const up = hit * 0.7, top = hit * 0.88;
  if (k <= 0) return NO_MOTION;
  if (k < up) return { swing: sm(k / up), reach: 0, dip: 0 };
  if (k < top) return { swing: 1, reach: 0, dip: -1 };
  if (k < hit) { const s = (k - top) / (hit - top); return { swing: 1 - 2 * s * s, reach: 0, dip: 0 }; }
  if (k < hit + 0.14) return { swing: -1, reach: 0, dip: 2 };
  const r = clamp01((k - hit - 0.14) / (1 - hit - 0.14));
  return { swing: -1 + sm(r), reach: 0, dip: Math.round(2 * (1 - r)) };
}

/** Task motion by kind. A rune channel is deliberately nothing: the worker just stands there (the host plays the rune's effect). */
export function taskMotion(kind: string | undefined, t: number, dur: number): TaskMotion {
  switch (kind) {
    case "punch": return blowMotion(t / dur);
    case "channel": return NO_MOTION;
    case undefined: return NO_MOTION;
    case "craft": return { swing: 0, reach: 0.45 + 0.5 * Math.abs(Math.sin(t * 9)), dip: 0 };
    default: return { swing: 0, reach: Math.sin(clamp01(t / dur) * Math.PI), dip: 0 };
  }
}

export function animPose(a: WorkerAnim, m: { facing: Facing; phase: number; moving: boolean; t: number; hasCore: boolean; task?: TaskMotion }): WorkerPose {
  const c = a.out, tk = m.task ?? NO_MOTION;
  const base = workerPose("off", { facing: m.facing, phase: m.phase, moving: false, t: m.t, hasCore: m.hasCore });
  const up = c.rise >= 0.9;
  return {
    ...base, rise: c.rise, neck: c.neck, yaw: c.yaw, arms: c.arms, shake: c.shake, dip: c.dip + (up ? tk.dip : 0),
    core: c.core, eye: c.eye, moving: m.moving && up,
    swing: up ? tk.swing : 0, reach: up ? tk.reach : 0,
  };
}
