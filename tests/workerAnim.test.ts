// The worker golem's animation sequencer (src/game/workerAnim.ts): booting up and standing when a core goes in,
// settling dormant when it has been idle, powering down when the core comes out, the quick stand for a body
// that is given work, no pops between any of them, and no animation of its own while it channels a rune.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initWorkerAnim, stepWorkerAnim, drainCues, animPose, taskMotion, blowMotion, track, steady,
  DUR, IDLE_DELAY, STANDBY_CORE, NO_MOTION, type AnimCue, type Channels, type WorkerAnim, type WorkerInput,
} from "../src/game/workerAnim";
import { WORKER_CORE } from "../src/game/workerArt";
import { drawActor } from "../src/game/view/actors";
import { RCanvas } from "./support/uiSnapshot";
import { createWorld, actorById, type Actor } from "../src/game/world/world";
import { ARTIFICERY_WORKER } from "../src/game/map";

const OFF: WorkerInput = { powered: false, active: false, moving: false, hasCore: false };
const IDLE: WorkerInput = { powered: true, active: false, moving: false, hasCore: true };
const WORK: WorkerInput = { powered: true, active: true, moving: false, hasCore: true };
const DT = 1 / 60;
const KEYS: (keyof Channels)[] = ["rise", "neck", "yaw", "arms", "shake", "dip", "core", "eye"];

/** Run `seconds` at 60 fps, calling `each` after every frame; returns the cues that fired in order. */
function run(a: WorkerAnim, i: WorkerInput, seconds: number, each?: (a: WorkerAnim, t: number) => void): AnimCue[] {
  const cues: AnimCue[] = [];
  for (let t = 0; t < seconds; t += DT) { stepWorkerAnim(a, DT, i); cues.push(...drainCues(a)); each?.(a, t); }
  return cues;
}
/** The biggest one-frame change of the smooth posture channels while `fn` runs (flicker channels, eye and shake, are excluded). */
function maxStep(a: WorkerAnim, fn: (watch: () => void) => void) {
  let prev = { ...a.out }, worst = 0, where = "";
  fn(() => { for (const k of ["rise", "neck", "arms"] as const) { const d = Math.abs(a.out[k] - prev[k]); if (d > worst) { worst = d; where = k; } } prev = { ...a.out }; });
  return { worst, where };
}

test("a body at rest starts in the posture the sim implies, with no animation", () => {
  assert.equal(initWorkerAnim(OFF).mode, "off");
  assert.equal(initWorkerAnim(IDLE).mode, "dormant");
  assert.equal(initWorkerAnim(WORK).mode, "stand");
  const off = initWorkerAnim(OFF).out, dormant = initWorkerAnim(IDLE).out, stand = initWorkerAnim(WORK).out;
  assert.deepEqual([off.rise, off.neck, off.arms, off.eye, off.core], [0, 0, 0, 0, 0], "off: crouched, lid down, core dark");
  assert.deepEqual([dormant.rise, dormant.eye, dormant.core], [0, 0, WORKER_CORE.idle], "dormant: crouched, lid down, core faintly warm");
  assert.deepEqual([stand.rise, stand.neck, stand.arms, stand.eye, stand.core], [1, 1, 1, 1, 1]);
});

test("slotting a core in: it boots (spark, lamp, a look left and right), stands, and plants its feet", () => {
  const a = initWorkerAnim(OFF), seen: { mode: string; yaw: number; rise: number }[] = [];
  const cues = run(a, IDLE, DUR.boot + 0.2, (x) => seen.push({ mode: x.mode, yaw: x.out.yaw, rise: x.out.rise }));
  assert.deepEqual(cues, ["spark", "creak", "lamp", "plant"], "in the order a body comes alive");
  assert.ok(seen.some((s) => s.mode === "boot") && seen[seen.length - 1].mode === "stand", "boot, then standing");
  assert.ok(seen.some((s) => s.yaw < -0.9) && seen.some((s) => s.yaw > 0.9), "it looks one way then the other");
  // it does not stand until its head is up and the lamp is lit
  const early = initWorkerAnim(OFF); run(early, IDLE, 1.0);
  assert.ok(early.out.rise === 0 && early.out.neck === 0, "still crouched, head down, a second in");
  assert.ok(Math.max(...seen.map((s) => s.rise)) === 1);
  assert.ok(a.out.rise === 1 && a.out.neck === 1 && a.out.arms === 1 && a.out.eye >= 0.85, "up, lamp lit (a touch under working brightness on standby)");
  assert.ok(Math.abs(a.out.core - STANDBY_CORE) < 0.1, "core settles to standby, not working brightness");
  assert.ok(a.out.yaw === 0 && a.out.shake === 0, "eyes front, still");
});

test("idle for a while: it settles into the dormant crouch, lamp out, core down, and stays there", () => {
  const a = initWorkerAnim(WORK);
  run(a, IDLE, IDLE_DELAY - 0.2);
  assert.equal(a.mode, "stand", "it waits about on standby first");
  assert.ok(a.out.eye > 0.8 && a.out.core > WORKER_CORE.idle + 0.2);
  const cues = run(a, IDLE, 0.2 + DUR.settle + 0.2);
  assert.equal(a.mode, "dormant");
  assert.deepEqual(a.out, steady("dormant", true, false), "ends exactly on the dormant pose");
  assert.deepEqual(cues, ["lampOut", "settle", "plant"]);
  run(a, IDLE, 5);
  assert.equal(a.mode, "dormant", "stays down while idle");
  // work arrives while it is still settling: it just stands again
  const b = initWorkerAnim(WORK); run(b, IDLE, IDLE_DELAY + 1.0);
  assert.equal(b.mode, "settle");
  run(b, WORK, 0.1);
  assert.equal(b.mode, "stand");
  run(b, WORK, 0.6);
  assert.deepEqual([b.out.rise, b.out.neck, b.out.arms, b.out.eye], [1, 1, 1, 1]);
});

test("taking the core out: a jolt, the lamp and core gutter out, the head turns aside, it sags down", () => {
  const a = initWorkerAnim(WORK), yaws: number[] = [], cores: number[] = [], eyes: number[] = [], rises: number[] = [];
  const cues = run(a, OFF, DUR.shutdown + 0.2, (x) => { yaws.push(x.out.yaw); cores.push(x.out.core); eyes.push(x.out.eye); rises.push(x.out.rise); });
  assert.deepEqual(cues, ["jolt", "lampOut", "plant"]);
  assert.equal(a.mode, "off");
  assert.deepEqual(a.out, steady("off", false, false), "ends on the off pose, centred");
  assert.ok(Math.min(...yaws) <= -0.95, "the head turns aside on the way down");
  assert.ok(cores.some((c, i) => i > 1 && c < cores[i - 1]) && cores[cores.length - 1] === 0, "the core gutters, then dark");
  assert.ok(eyes.some((e) => e > 0.5) && eyes[eyes.length - 1] === 0);
  // it stays upright through the first part (the jolt), then sags
  assert.ok(rises[20] > 0.95 && rises[rises.length - 1] === 0);
  assert.ok(rises.every((r, i) => i === 0 || r <= rises[i - 1] + 1e-9), "it never gets up again on the way down");
  // a dormant body powered down only gutters: it never stands, never rises
  const d = initWorkerAnim(IDLE), top: number[] = [];
  run(d, OFF, DUR.shutdown + 0.2, (x) => top.push(x.out.rise));
  assert.equal(Math.max(...top), 0);
  assert.equal(d.mode, "off");
});

test("work for a dormant body: it wakes and stands quickly; a boot that has to walk is cut to the quick stand", () => {
  const a = initWorkerAnim(IDLE);
  const cues = run(a, WORK, 0.1);
  assert.equal(a.mode, "wake");
  cues.push(...run(a, WORK, 0.7));
  assert.equal(a.mode, "stand");
  assert.deepEqual(cues, ["spark", "plant"]);
  assert.deepEqual([a.out.rise, a.out.neck, a.out.arms], [1, 1, 1]);
  // boot with an order already waiting: standing in under a second or two, not the full boot
  const b = initWorkerAnim(OFF);
  run(b, { ...WORK, moving: true }, 0.8);
  assert.notEqual(b.mode, "boot");
  run(b, { ...WORK, moving: true }, 0.9);
  assert.equal(b.mode, "stand");
  assert.equal(b.out.rise, 1);
});

test("no pops: posture never jumps between frames across every transition, including interrupted ones", () => {
  const a = initWorkerAnim(OFF);
  const m = maxStep(a, (watch) => {
    const go = (i: WorkerInput, s: number) => run(a, i, s, () => watch());
    go(IDLE, 1.5);      // booting
    go(OFF, 0.9);       // core pulled mid-boot
    go(IDLE, 1.2);      // and put back mid-shutdown
    go(IDLE, 6);        // booted, settled
    go(WORK, 0.3);      // work: wake
    go(IDLE, IDLE_DELAY + 1.0); // mid-settle...
    go(WORK, 1);        // ...work again
    go(OFF, 4);         // power off
  });
  assert.ok(m.worst < 0.12, `largest one-frame change ${m.worst.toFixed(3)} in ${m.where}`);
});

test("the sequencer is pure and deterministic", () => {
  const trace = () => { const a = initWorkerAnim(OFF), out: number[] = []; run(a, IDLE, 4, (x) => out.push(...KEYS.map((k) => x.out[k]))); return out; };
  assert.deepEqual(trace(), trace());
  assert.equal(track(0.5, [[0, 0], [1, 1]]), 0.5, "eased tracks hit their midpoint");
  assert.equal(track(5, [[0, 2], [1, 7]]), 7);
});

test("task motion: harvest swings overhead and lands at its fire point; a rune channel is deliberately nothing", () => {
  assert.deepEqual(taskMotion("channel", 1.1, 2.2), NO_MOTION, "no animation while teleporting");
  assert.deepEqual(taskMotion(undefined, 0, 1), NO_MOTION);
  assert.ok(taskMotion("reach", 0.225, 0.45).reach > 0.99);
  assert.ok(taskMotion("craft", 0.3, 2).reach > 0.4);
  const k = (v: number) => blowMotion(v).swing;
  assert.ok(k(0.2) > 0 && k(0.4) === 1 && k(0.5) === -1, "up, overhead, fists in the ground exactly at the fire point");
  assert.ok(k(0.499) > -1 && k(0.6) === -1 && k(1) === 0);
  assert.equal(taskMotion("punch", 0.375, 0.75).swing, -1, "the punch task fires at half its duration, and that is the landing");
});

test("a pose never walks or works while the body is down", () => {
  const a = initWorkerAnim(IDLE);
  const p = animPose(a, { facing: "down", phase: 1, moving: true, t: 0, hasCore: true, task: { swing: 1, reach: 1, dip: 2 } });
  assert.deepEqual([p.moving, p.swing, p.reach, p.dip], [false, 0, 0, 0]);
  const s = animPose(initWorkerAnim(WORK), { facing: "down", phase: 1, moving: true, t: 0, hasCore: true, task: { swing: 1, reach: 0, dip: 0 } });
  assert.deepEqual([s.moving, s.swing], [true, 1]);
});

// ------------------------------------------------------------------ through drawActor
function drawn(setup: (wk: Actor) => void, look: Record<string, unknown> = {}) {
  const w = createWorld(3), wk = actorById(w, ARTIFICERY_WORKER.id)!;
  wk.powerCore = "ruby_core"; setup(wk);
  const sc = new RCanvas(56, 64), ec = new RCanvas(56, 64);
  drawActor(sc.getContext() as unknown as CanvasRenderingContext2D, ec.getContext() as unknown as CanvasRenderingContext2D, w, wk, Math.round(wk.x) - 28, Math.round(wk.y) - 58, 0.3, { awake: 0, eye: 0, flare: 0, reach: 0, ...look });
  return { sc, ec };
}
const running = (wk: Actor) => { wk.job = { status: "running" } as never; };

test("a worker channelling a rune is drawn exactly as one standing (no reach, no gesture of its own)", () => {
  const channel = drawn((wk) => { wk.task = { kind: "channel", dur: 2.2, t: 0.9, fired: false, effect: { op: "travel", destination: "x" }, target: { kind: "rune", x: wk.x, y: wk.y, propId: "p" } } as never; });
  const standing = drawn(running);
  assert.deepEqual([...channel.sc.data], [...standing.sc.data]);
  assert.deepEqual([...channel.ec.data], [...standing.ec.data]);
  // whereas a deposit reach visibly moves the arms
  const reach = drawn((wk) => { wk.task = { kind: "reach", dur: 0.45, t: 0.22, fired: false } as never; });
  assert.notDeepEqual([...reach.sc.data], [...standing.sc.data]);
});

test("a rune holds a worker off the ground by `lift` px: the whole body rises (the shadow is translucent and stays)", () => {
  const down = drawn(running), up = drawn(running, { lift: 5 });
  const top = (c: RCanvas) => { for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (c.data[(y * c.width + x) * 4 + 3] > 200) return y; return -1; };
  assert.equal(top(down.sc) - top(up.sc), 5);
});
