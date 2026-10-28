// Art added with the production rollout. Own file: node --test runs each file
// in a fresh process, so the sprite cache starts empty and the traces don't
// depend on other tests. The High-Grade Ruby, the Ruby Golem Core and the
// worker golem body are new art (they had no goldens before); among the
// existing goldens only the crown's moved (tests/art.test.ts,
// tests/artRegistry.test.ts). The golem's and the guardian's are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { itemIcon } from "../src/game/art/items";
import { drawWorker, workerPose, workerState, BODY_ART, WORKER_CORE, type WorkerState } from "../src/game/workerArt";
import { drawActor, actorActive } from "../src/game/view/actors";
import { RCanvas } from "./support/uiSnapshot";
import { Pen, makeCanvas } from "../src/game/util";
import type { Facing } from "../src/game/golem";
import { createWorld, actorById } from "../src/game/world/world";
import { ARTIFICERY_WORKER } from "../src/game/map";
import { powered } from "../src/game/sim/actorStats";

const GOLDEN = { icons: "24c7cf22", worker: "c9aea7c7" };
const FACINGS: Facing[] = ["down", "left", "up", "right"];
const STATES: WorkerState[] = ["off", "idle", "work"];
const pose = (state: WorkerState, facing: Facing, extra: Partial<{ moving: boolean; phase: number; raise: number; reach: number; boot: number }> = {}) =>
  workerPose(state, { facing, phase: extra.phase ?? 0, moving: !!extra.moving, t: 0.3, hasCore: state !== "off", raise: extra.raise, reach: extra.reach, boot: extra.boot });

/** Rasterise one pass of one pose at feet (16, 26) on a 32x32 canvas; returns its RGBA pixels. */
function raster(p: ReturnType<typeof pose>, emit: boolean) {
  const c = new RCanvas(32, 32), ctx = c.getContext() as unknown as CanvasRenderingContext2D;
  drawWorker(new Pen(ctx, emit), 16, 26, p);
  return c.data;
}
const glow = (d: Uint8ClampedArray) => {
  const out: { i: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 0) out.push({ i: i / 4, r: d[i], g: d[i + 1], b: d[i + 2] });
  return out;
};

test("new icons: the High-Grade Ruby and the Ruby Golem Core are pixel-stable", () => {
  resetTrace();
  for (const id of ["large_ruby", "ruby_core"] as const) itemIcon(id);
  assert.equal(traceHash(), GOLDEN.icons);
});

test("the worker body: three states in every facing, walking, punching and reaching, both passes, pixel-stable", () => {
  assert.equal(BODY_ART.worker, drawWorker);
  resetTrace();
  const c = makeCanvas(32, 32);
  const all = [...STATES.flatMap((s) => FACINGS.map((f) => pose(s, f))), ...FACINGS.flatMap((f) => [pose("work", f, { moving: true, phase: 1.3 }), pose("work", f, { moving: true, phase: 4.4 }), pose("work", f, { raise: 1 }), pose("work", f, { reach: 1 }), pose("idle", f, { boot: 1 })])];
  for (const p of all) { drawWorker(new Pen(c.ctx, false), 16, 26, p); drawWorker(new Pen(c.ctx, true), 16, 26, p); }
  assert.equal(traceHash(), GOLDEN.worker);
});

test("glow by state: unpowered emits nothing; powered-idle only a faint core; working a bright core and a lit eye", () => {
  for (const f of FACINGS) {
    assert.deepEqual(glow(raster(pose("off", f), true)), [], `${f}: switched off, no glow at all`);
    const idle = glow(raster(pose("idle", f), true)), work = glow(raster(pose("work", f), true));
    assert.ok(idle.length > 0, `${f}: the core shows`);
    const amber = (px: { r: number; g: number; b: number }) => px.g > px.b * 1.8 && px.g > 60;
    assert.ok(!idle.some(amber), `${f}: idle, the eye stays shuttered`);
    const peak = (l: typeof idle) => Math.max(...l.map((px) => Math.max(px.r, px.g, px.b)));
    // from behind the core shows only through the grille (60%), so there "bright" means well above idle
    assert.ok(peak(idle) <= 0.45 * 255 && peak(work) >= (f === "up" ? 2 * peak(idle) : 0.9 * 255), `${f}: idle faint (${peak(idle)}), working bright (${peak(work)})`);
    if (f !== "up") assert.ok(work.some(amber), `${f}: working, the lamp-eye is lit`);
  }
  assert.ok(WORKER_CORE.idle < WORKER_CORE.work / 2 && WORKER_CORE.off === 0);
  assert.ok(pose("idle", "down", { boot: 1 }).core > pose("idle", "down").core, "a core flares as it boots, then settles");
});

test("powered-idle keeps the dormant posture: against unpowered, only the core window's pixels change", () => {
  for (const f of FACINGS) {
    const a = raster(pose("off", f), false), b = raster(pose("idle", f), false), diff: number[] = [];
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) diff.push(i / 4);
    assert.ok(diff.length > 0 && diff.length <= 4, `${f}: ${diff.length} pixels differ`);
    for (const i of diff) assert.ok(Math.floor(i / 32) >= 26 - 12 && Math.floor(i / 32) <= 26 - 9, `${f}: a change outside the core (${i % 32},${Math.floor(i / 32)})`);
    const work = raster(pose("work", f), false);
    assert.notDeepEqual([...work], [...b], `${f}: working stands differently`);
  }
});

test("through drawActor (and so golem vision's per-frame retrace into its scratch canvas) the worker draws in every state", () => {
  const w = createWorld(3), wk = actorById(w, ARTIFICERY_WORKER.id)!;
  const look = { awake: 0, eye: 0, flare: 0, reach: 0 };
  const states: WorkerState[] = [];
  for (const setup of [() => {}, () => { wk.powerCore = "ruby_core"; }, () => { wk.task = { kind: "punch", dur: 0.75, t: 0.2, fired: false }; }]) {
    setup();
    states.push(workerState(powered(wk), actorActive(wk)));
    const sc = new RCanvas(56, 64), ec = new RCanvas(56, 64); // view/vision.ts: ACTOR_BOX, feet at (28, 58)
    drawActor(sc.getContext() as unknown as CanvasRenderingContext2D, ec.getContext() as unknown as CanvasRenderingContext2D, w, wk, Math.round(wk.x) - 28, Math.round(wk.y) - 58, 0.3, look);
    let opaque = 0; for (let i = 3; i < sc.data.length; i += 4) if (sc.data[i] > 0) opaque++;
    assert.ok(opaque > 100, `${states[states.length - 1]}: drawn into the scratch canvas`);
    assert.equal(glow(ec.data).length > 0, powered(wk), "glows only when powered");
  }
  assert.deepEqual(states, ["off", "idle", "work"]);
});
