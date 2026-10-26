// Golem sprite regression: draws the golem (albedo and emissive passes, as the
// host does) through the recording fake canvas for a matrix of poses and
// compares the draw-call trace hash with goldens.
//  - LEGACY: every pose that existed before gear and the slam (facings x arm x
//    gait phases x raise x reach x boot-up/eye states). Captured from golem.ts
//    before either change; it must never move.
//  - New states have their own goldens (gear on the back, the two-arm slam).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { drawGolem, slamPose, type Facing, type GolemPose } from "../src/game/golem";
import { SLAM_HIT } from "../src/game/content/tasks";
import { Pen, makeCanvas } from "../src/game/util";

const FACINGS: Facing[] = ["down", "up", "left", "right"];

/** The legacy pose matrix, with optional extra pose fields applied to every entry. */
export function legacyPoses(extra: Partial<GolemPose> = {}): GolemPose[] {
  const out: GolemPose[] = [];
  for (const facing of FACINGS) for (const hasArm of [false, true]) {
    const base: GolemPose = { facing, phase: 0, moving: false, hasArm, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: 0.3, eyeFixed: false, ...extra };
    out.push(base);
    for (const phase of [0.4, 1.3, 2.2, 3.6, 5.0]) out.push({ ...base, phase, moving: true });
    for (const raise of [-1, -0.5, 0.5, 1]) out.push({ ...base, raise });
    for (const reach of [0.5, 1]) out.push({ ...base, reach });
    out.push({ ...base, dormant: 1, eye: 0, core: 0 }, { ...base, dormant: 0.5, eye: 0.4, core: 0.6 }, { ...base, eyeFixed: true, t: 1.7 }, { ...base, eye: 1.6 });
  }
  return out;
}

export function golemTrace(list: GolemPose[]) {
  resetTrace();
  const c = makeCanvas(48, 48);
  for (const p of list) {
    drawGolem(new Pen(c.ctx, false), 24, 40, p);
    drawGolem(new Pen(c.ctx, true), 24, 40, p);
  }
  return traceHash();
}

const GOLDEN = { legacy: "44dd8ba5", basket: "ed623359", slam: "a263db97" };
const BASE: GolemPose = { facing: "down", phase: 0, moving: false, hasArm: false, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: 0.3, eyeFixed: false };

test("legacy golem poses are pixel-identical", () => {
  assert.equal(golemTrace(legacyPoses()), GOLDEN.legacy);
  assert.equal(golemTrace(legacyPoses({ back: undefined })), GOLDEN.legacy, "an empty back slot draws nothing extra");
});

test("the basket on the back: every facing, walking, slumped, with and without the arm", () => {
  const withBasket = legacyPoses({ back: "basket" });
  assert.equal(golemTrace(withBasket), GOLDEN.basket);
  // It changes every facing (it is visible from all four), and it rides the body bob.
  for (const facing of FACINGS) {
    const at = (p: Partial<GolemPose>) => golemTrace([{ ...withBasket[0], facing, ...p }]);
    assert.notEqual(at({}), at({ back: undefined }), `${facing}: basket visible`);
    assert.notEqual(at({ dormant: 1 }), at({ dormant: 0 }), `${facing}: moves with the body`);
  }
});

test("the two-arm slam: both arms (or the arm and the broken stub) through the arc, in every facing, with gear", () => {
  const list: GolemPose[] = [];
  for (const facing of FACINGS) for (const hasArm of [false, true]) for (const back of [undefined, "basket"])
    for (const k of [0.1, 0.3, 0.42, 0.47, 0.5, 0.6, 0.8, 0.95]) {
      const { lift, dip } = slamPose(k);
      list.push({ ...BASE, facing, hasArm, back, slam: lift, dip });
    }
  assert.equal(golemTrace(list), GOLDEN.slam);
  for (const facing of FACINGS) for (const hasArm of [false, true]) {
    const at = (p: Partial<GolemPose>) => golemTrace([{ ...BASE, facing, hasArm, ...p }]);
    assert.notEqual(at({ slam: 1 }), at({ slam: -1 }), `${facing}: overhead vs in the ground`);
    assert.notEqual(at({ slam: 1 }), at({}), `${facing}: raised is not the rest pose`);
  }
  // The impact frame is the fire point: the fists reach the ground exactly when the effect lands.
  assert.deepEqual(slamPose(SLAM_HIT), { lift: -1, dip: 2 });
  assert.ok(slamPose(SLAM_HIT - 0.005).lift > -1, "still swinging just before");
  assert.deepEqual(slamPose(0), { lift: 0, dip: 0 });
  assert.deepEqual(slamPose(1), { lift: 0, dip: 0 });
});
