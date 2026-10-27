// Zoom model, the guardian's sprite, and rendering cost at the widest zoom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { viewSize, nextZoomStep, ZOOM_STEPS, ZOOM_DEFAULT, BASE_W, BASE_H } from "../src/game/view/zoom";
import { NPC_ART, drawGuardian, type NpcPose } from "../src/game/npcArt";
import { NPCS } from "../src/game/content/npcs";
import { ACTORS } from "../src/game/content/actors";
import { makeCanvas, Pen } from "../src/game/util";
import { getArea } from "../src/game/world/world";
import { AreaView } from "../src/game/view/areaView";
import { Lighting, makeLight, computeVis } from "../src/game/light";
import { newWorld } from "./helpers";

test("zoom levels are integer, 16:9 views; the wheel steps 1x / 1.5x / 2x", () => {
  assert.deepEqual(viewSize(1), { w: BASE_W, h: BASE_H });
  assert.deepEqual(viewSize(1.5), { w: 480, h: 270 });
  assert.deepEqual(viewSize(2), { w: 640, h: 360 });
  for (let z = 1; z <= 2; z += 0.01) {
    const v = viewSize(z);
    assert.ok(Number.isInteger(v.w) && Number.isInteger(v.h) && v.w * 9 === v.h * 16, `z=${z}`);
  }
  assert.ok((ZOOM_STEPS as readonly number[]).includes(ZOOM_DEFAULT));
  assert.equal(nextZoomStep(1, 1), 1.5);
  assert.equal(nextZoomStep(1.5, 1), 2);
  assert.equal(nextZoomStep(2, 1), 2);
  assert.equal(nextZoomStep(2, -1), 1.5);
  assert.equal(nextZoomStep(1, -1), 1);
  assert.equal(nextZoomStep(1.3, 1), 2, "mid-animation: steps from the nearest level");
});

test("the guardian sprite is registered by its NpcDef art key and renders dormant and awake states", () => {
  for (const d of Object.values(NPCS)) assert.ok(NPC_ART[ACTORS[d.actor].art.key], d.actor);
  const draw = (pose: Partial<NpcPose>) => {
    resetTrace();
    const c = makeCanvas(64, 64);
    const p: NpcPose = { facing: "down", awake: 0, eye: 0, reach: 0, t: 0, ...pose };
    drawGuardian(new Pen(c.ctx, false), 32, 60, p);
    drawGuardian(new Pen(c.ctx, true), 32, 60, p);
    return traceHash();
  };
  const dormant = draw({}), awake = draw({ awake: 1, eye: 1 }), reaching = draw({ awake: 1, eye: 1, reach: 1 });
  assert.equal(draw({}), dormant, "deterministic");
  assert.notEqual(dormant, awake);
  assert.notEqual(awake, reaching, "the hand pose shows");
  assert.notEqual(draw({ awake: 1, eye: 0 }), awake, "the eye is drawn only when lit");
});

test("perf report: the 96x72 surface at 2x zoom (640x360 view)", () => {
  const s = getArea(newWorld(), "surface");
  const rp = s.prop("rune.surface")!;
  const out: string[] = [];
  for (const z of ZOOM_STEPS) {
    const { w, h } = viewSize(z);
    const v = new AreaView(s);
    let t0 = performance.now();
    v.prepare(rp.x - w / 2, rp.y - h / 2, w, h);
    const first = performance.now() - t0;
    const chunks = v.stats.chunksBaked;
    const L = new Lighting(w, h);
    const lights = [...v.lights.values(), makeLight(rp.x, rp.y, 108, [1, 0.78, 0.5], 1, 0.05)];
    for (const l of lights) if (l.n === 0) computeVis(l, s);
    const sc = new Uint8ClampedArray(w * h * 4), em = new Uint8ClampedArray(w * h * 4), o = new Uint8ClampedArray(w * h * 4);
    t0 = performance.now();
    for (let i = 0; i < 10; i++) { L.accumulate(lights, rp.x - w / 2, rp.y - h / 2); L.compose(sc, em, o, [0.2, 0.2, 0.3]); }
    const light = (performance.now() - t0) / 10;
    let n = 0; while (v.idle()) n++;
    assert.ok(v.fullyBaked);
    out.push(`${z}x ${w}x${h}: first frame ${first.toFixed(1)}ms (${chunks} chunks), lighting ${light.toFixed(1)}ms/frame, ${n} chunks left for idle`);
  }
  console.log(`# PERF zoom (surface ${s.w}x${s.h}) | ${out.join(" | ")}`);
});
