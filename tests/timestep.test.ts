// Phase 0.1 / 0.2: the fixed-timestep clock, deterministic replay at any speed, render interpolation, and
// simulation LOD (tiers, beats, far-area catch-up, determinism across a save and load).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimClock, TICK, stepSpeed, GAME_SPEEDS } from "../src/game/core/clock";
import { createWorld, player, getArea, enterArea, actorById } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { enableLod, lodTier, lodDue, stepIn } from "../src/game/sim/lod";
import { playStream, InputLog, simTick, type TickInput } from "../src/game/sim/replay";
import { Interpolator } from "../src/game/view/interp";
import { isFolk } from "../src/game/sim/folk";

test("the clock hands out whole ticks: 1/60 fed sixty times is sixty; speed multiplies; pause runs none; a huge frame is capped", () => {
  const c = new SimClock(TICK);
  let n = 0;
  for (let i = 0; i < 60; i++) n += c.advance(1 / 60, 1);
  assert.equal(n, 60);
  assert.equal(c.advance(1 / 60, 8), 8);
  assert.equal(c.advance(1 / 60, 0), 0);
  assert.equal(c.advance(0.05, 1), 3);
  const capped = new SimClock(TICK, 10);
  assert.equal(capped.advance(1, 1), 10);
  assert.ok(capped.dropped > 0 && capped.acc === 0);
  assert.equal(stepSpeed(1, 1), 2); assert.equal(stepSpeed(8, 1), 8); assert.equal(stepSpeed(1, -1), 0); assert.equal(stepSpeed(0, -1), 0);
  assert.deepEqual([...GAME_SPEEDS], [0, 1, 2, 4, 8]);
});

/** A town afternoon: its people about, the player walking a square and pressing E now and then. */
function townSave(seed = 4242): string {
  const w = createWorld(seed), pl = player(w), town = getArea(w, "town");
  enterArea(w, pl, "town", town.start.x, town.start.y);
  w.day = Math.floor(w.day) + 1 + 13 / 24;
  w.events = [];
  return JSON.stringify(serialize(w));
}
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const stream = (t: number): TickInput => { const d = DIRS[Math.floor(t / 240) % 4]; return { ix: d[0], iy: d[1], use: t % 400 === 399 }; };

test("acceptance (0.1): the same save and input stream give an identical world at 1x and at 8x (LOD on), whatever the frame rate", () => {
  const save = townSave(), TICKS = 1500;
  const run = (speed: number, frames: number[]) => {
    const w = deserialize(JSON.parse(save));
    enableLod(w);
    assert.equal(playStream(w, stream, TICKS, speed, frames), TICKS);
    return JSON.stringify(serialize(w));
  };
  const at1 = run(1, [1 / 60]);
  assert.equal(run(8, [0.013, 0.021, 1 / 60, 0.04, 0.009]), at1, "8x with a ragged frame rate");
  assert.equal(run(2, [1 / 144]), at1, "2x on a 144 Hz display");
  // and it was a real run: the clock moved by exactly the ticks, the player walked
  const a = deserialize(JSON.parse(at1)), b = deserialize(JSON.parse(save));
  assert.ok(Math.abs(a.time - b.time - TICKS * TICK) < 1e-6);
  assert.notDeepEqual([player(a).x, player(a).y, player(a).area], [player(b).x, player(b).y, player(b).area]);
});

test("an input log keeps runs, replays tick for tick, and survives JSON", () => {
  const log = new InputLog();
  for (let t = 0; t < 1000; t++) log.record(t, stream(t));
  assert.ok(log.runs.length < 40, `${log.runs.length} runs`);
  const back = InputLog.fromJSON(JSON.parse(JSON.stringify(log)));
  for (const t of [0, 1, 239, 240, 398, 399, 400, 999]) assert.deepEqual(back.at(t), stream(t));
  assert.throws(() => log.record(5, stream(5)));
});

test("the picture is drawn between ticks: lerp by alpha, a jump drawn where it lands, and the sim's own positions come back", () => {
  const w = createWorld(7), pl = player(w), ip = new Interpolator();
  ip.capture(w, pl.area);
  const x0 = pl.x;
  pl.x += 2; ip.alpha = 0.5;
  const restore = ip.apply(w, pl.area);
  assert.equal(pl.x, x0 + 1);
  restore();
  assert.equal(pl.x, x0 + 2);
  ip.capture(w, pl.area); pl.x += 100; ip.alpha = 0.25;
  const r2 = ip.apply(w, pl.area);
  assert.equal(pl.x, x0 + 102, "a jump is not swept");
  r2();
  ip.enabled = false; ip.capture(w, pl.area); pl.x += 1; ip.alpha = 0.5;
  ip.apply(w, pl.area)();
  assert.equal(pl.x, x0 + 103);
});

test("LOD tiers: in view is active, the rest of the area near, other areas far; the player is always active", () => {
  const w = createWorld(11), pl = player(w), town = getArea(w, "town");
  enterArea(w, pl, "town", town.start.x, town.start.y);
  enableLod(w);
  const folk = w.actors.filter(isFolk);
  assert.ok(folk.length > 4);
  const [a, b, c] = folk;
  a.area = "town"; a.x = pl.x + 30; a.y = pl.y;
  b.area = "town"; b.x = pl.x + 2000; b.y = pl.y;
  c.area = "dungeon";
  assert.equal(lodTier(w, pl, pl), "active");
  assert.equal(lodTier(w, a, pl), "active");
  assert.equal(lodTier(w, b, pl), "near");
  assert.equal(lodTier(w, c, pl), "far");
});

test("near actors step on their beat (every 0.1 s, the step that long, offset per actor); steps are cut to maxStep", () => {
  const w = createWorld(12), pl = player(w);
  enableLod(w);
  const a = actorById(w, "npc.guardian")!;
  let due = 0, steps = 0;
  for (let i = 0; i < 600; i++) { w.time += TICK; const d = lodDue(w, a, "near", TICK, true); if (d) { steps++; due += d; assert.ok(Math.abs(d - 0.1) < 1e-9); } }
  assert.ok(Math.abs(steps - 100) <= 1, `${steps} steps in 10 s`);
  assert.ok(Math.abs(due - 10) < 0.11);
  assert.equal(lodDue(w, a, "far", TICK, false), 0, "a far actor with no work is not stepped");
  assert.equal(lodDue(w, pl, "active", TICK, true), TICK);
  const pieces: number[] = [];
  stepIn(w, 0.5, (d) => pieces.push(d));
  assert.equal(pieces.length, 5);
});

test("far areas wait and catch up on entry: the circle's charge is advanced by the time away", () => {
  const w = createWorld(13), pl = player(w), town = getArea(w, "town"), d = getArea(w, "dungeon");
  enterArea(w, pl, "town", town.start.x, town.start.y);
  d.ritual!.active = true; d.ritual!.actT = 0;
  enableLod(w);
  for (let i = 0; i < 120; i++) simTick(w);
  assert.equal(d.ritual!.actT, 0, "unticked while the player is away");
  enterArea(w, pl, "dungeon", d.start.x, d.start.y);
  simTick(w);
  assert.ok(Math.abs(d.ritual!.actT - 121 * TICK) < 1e-6, `caught up to ${d.ritual!.actT}`);
  // without LOD every area ticks every step, as before
  const w2 = createWorld(13), d2 = getArea(w2, "dungeon"), p2 = player(w2);
  enterArea(w2, p2, "town", getArea(w2, "town").start.x, getArea(w2, "town").start.y);
  d2.ritual!.active = true; d2.ritual!.actT = 0;
  for (let i = 0; i < 60; i++) simTick(w2);
  assert.ok(Math.abs(d2.ritual!.actT - 60 * TICK) < 1e-6);
});

test("LOD is deterministic and survives a save and load exactly (the beat is a function of time and id)", () => {
  const save = townSave(77);
  const w = deserialize(JSON.parse(save));
  enableLod(w);
  playStream(w, stream, 600, 1, [1 / 60]);
  const mid = JSON.stringify(serialize(w));
  const resumed = deserialize(JSON.parse(mid));
  enableLod(resumed);
  playStream(w, (t) => stream(t + 600), 600, 1, [1 / 60]);
  playStream(resumed, (t) => stream(t + 600), 600, 4, [1 / 60]);
  assert.equal(JSON.stringify(serialize(resumed)), JSON.stringify(serialize(w)));
});
