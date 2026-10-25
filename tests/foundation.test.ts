// Foundations: change propagation, save/load + migration, determinism,
// non-player actors performing queued work, travel between areas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, makeActor, enterArea, getArea, type World } from "../src/game/world/world";
import { AREAS } from "../src/game/world/areas";
import { serialize, deserialize, migrate, SAVE_VERSION } from "../src/game/world/save";
import { enqueueTask, schedule } from "../src/game/sim/tasks";
import { stepWorld } from "../src/game/sim/step";
import { interactables } from "../src/game/sim/interact";
import { T } from "../src/game/content/tiles";
import { FLAGS } from "../src/game/content/flags";
import type { AreaData } from "../src/game/map";
import { events, find, frame, frames, newWorld, propItem, useOn } from "./helpers";

test("tile changes publish padded dirty rects and invalidate derived data", () => {
  const w = newWorld();
  const a = currentArea(w);
  const rects: unknown[] = [];
  const off = a.onChange((r) => rects.push(r));
  const before = interactables(a);
  assert.equal(interactables(a), before, "cached while unchanged");
  a.setTile(51, 5, T.FLOOR);
  assert.deepEqual(rects, [{ x0: 49, y0: 3, x1: 53, y1: 7 }]);
  assert.notEqual(interactables(a), before);
  assert.ok(!interactables(a).some((i) => i.kind === "door"));
  off();
  a.setTile(0, 0, T.FLOOR);
  assert.equal(rects.length, 1, "unsubscribed");
});

/** A mid-tutorial world with pending scheduled work and an in-progress task. */
function midGame(): World {
  const w = newWorld(4242);
  useOn(w, propItem(w, "limbrack@65.5,3"));
  useOn(w, find(w, (i) => i.kind === "cracked"));
  useOn(w, propItem(w, "skeleton@66,32"));
  useOn(w, find(w, (i) => i.kind === "door"));
  useOn(w, propItem(w, "lectern@5,29"));
  // open a container and stop before the delayed grant fires, mid-task
  const hearth = propItem(w, "hearth@60.5,43");
  const pl = player(w);
  pl.x = hearth.x; pl.y = hearth.y + 9; pl.facing = "up";
  frame(w, { ix: 0, iy: 0, use: true });
  while (!w.scheduled.length) frame(w);
  events(w);
  return w;
}

test("save/load round-trips world changes, pending schedule and in-progress work", () => {
  const w = midGame();
  const json = JSON.stringify(serialize(w));
  const w2 = deserialize(JSON.parse(json));
  assert.deepEqual(serialize(w2), serialize(w));
  const a2 = currentArea(w2);
  assert.equal(a2.tile(51, 5), T.FLOOR);
  assert.equal(a2.tile(47, 10), T.FLOOR);
  assert.ok(w2.flags.has(FLAGS.golemArm));
  assert.ok(player(w2).task, "task in progress survives");
  assert.equal(w2.scheduled.length, 1);
  assert.ok(json.length < 20000, `save is a diff, not a dump (${json.length} bytes)`);
  // ...and both continue identically (determinism)
  frames(w, 120); frames(w2, 120);
  assert.deepEqual(serialize(w2), serialize(w));
  assert.ok(player(w2).inventory.includes("glyph0"), "scheduled grant fired after load");
});

test("same seed + same inputs => identical worlds", () => {
  assert.deepEqual(serialize(midGame()), serialize(midGame()));
});

test("migrations upgrade old saves and newer saves are rejected", () => {
  const s = serialize(newWorld()) as any;
  assert.equal(s.version, SAVE_VERSION);
  assert.throws(() => migrate({ ...s, version: SAVE_VERSION + 1 }), /newer/);
  assert.throws(() => migrate({ nope: 1 }), /not a Dustwake save/);
  // fixture: pretend v1 -> v2 renamed playTime
  const v2 = migrate(s, { 1: (o: any) => ({ ...o, version: 2, stats: { playTime: o.playTime } }) }, 2) as any;
  assert.equal(v2.version, 2);
  assert.equal(v2.stats.playTime, s.playTime);
});

test("non-player actors perform queued work over world time", () => {
  const w = newWorld();
  const a = makeActor("helper", "fixture", "dungeon", 100, 100);
  w.actors.push(a);
  enqueueTask(a, { kind: "reach", dur: 0.5, effect: { op: "cue", cue: "scrape" } });
  enqueueTask(a, { kind: "push", dur: 0.5, effect: { op: "cue", cue: "clank" } });
  for (let i = 0; i < 30; i++) stepWorld(w, 1 / 60);
  assert.equal(a.queue.length, 1, "second task waits");
  for (let i = 0; i < 60; i++) stepWorld(w, 1 / 60);
  const cues = events(w).flatMap((e) => (e.t === "cue" ? [e.cue] : []));
  assert.deepEqual(cues, ["scrape", "clank"]);
  assert.equal(a.task, null);
  // actors are saved
  const w2 = deserialize(serialize(w));
  assert.ok(w2.actors.some((x) => x.id === "helper" && x.kind === "fixture"));
});

test("scheduled effects run on simulation time only", () => {
  const w = newWorld();
  schedule(w, 1, player(w), { op: "grantItem", item: "coin" });
  for (let i = 0; i < 59; i++) stepWorld(w, 1 / 60);
  assert.ok(!player(w).inventory.includes("coin"));
  stepWorld(w, 2 / 60);
  assert.ok(player(w).inventory.includes("coin"));
});

test("travel to a second area of a different size; both areas persist", () => {
  const fixture = (): AreaData => {
    const W = 10, H = 6, n = W * H;
    const grid = new Uint8Array(n).fill(T.FLOOR);
    return {
      id: "fixture", w: W, h: H, grid, plan: grid.slice(), style: new Uint8Array(n), tvar: new Uint8Array(n),
      rooms: [], props: [], decals: [], lights: [], loose: [], ritual: { x: 80, y: 48 }, start: { x: 40, y: 40 }, exits: [], drips: [],
    };
  };
  AREAS.fixture = fixture;
  try {
    const w = newWorld();
    const pl = player(w);
    currentArea(w).setTile(51, 5, T.FLOOR);
    enterArea(w, pl, "fixture", 40, 40);
    assert.equal(currentArea(w).id, "fixture");
    assert.equal(currentArea(w).w, 10);
    assert.ok(events(w).some((e) => e.t === "areaEntered"));
    frames(w, 30, { ix: 1, iy: 0, use: false });
    assert.ok(pl.x > 40, "can move in the new area");
    const w2 = deserialize(serialize(w));
    assert.equal(currentArea(w2).id, "fixture");
    assert.equal(getArea(w2, "dungeon").tile(51, 5), T.FLOOR, "dungeon changes kept while away");
  } finally {
    delete AREAS.fixture;
  }
});
