// The attack (Space): a two-arm ground slam, separate from interacting (E).
// Always available when the golem could act; breaks cracked debris with the
// iron arm and only lands a hit without it. Headless, through stepPlayer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, setFlag, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { hasItem } from "../src/game/sim/inventory";
import { findTarget, interactables } from "../src/game/sim/interact";
import { SLAM_TASK } from "../src/game/content/interactions";
import { SLAM_HIT, SLAM_RADIUS } from "../src/game/content/tasks";
import { FLAGS } from "../src/game/content/flags";
import { T, TS } from "../src/game/content/tiles";
import { DT, events, find, frame, frames, newWorld, standAt, useOn, slamAt } from "./helpers";

const ATTACK = { ix: 0, iy: 0, use: false, attack: true };
const USE = { ix: 0, iy: 0, use: true };
/** What the world is (areas, flags, the golem's pack and gear), without clocks and gait. */
const worldState = (w: World) => {
  const s = serialize(w);
  return JSON.stringify({ areas: s.areas, flags: s.flags, inv: player(w).inventory, gear: player(w).gear });
};
const crack = (w: World) => find(w, (i) => i.kind === "cracked");
/** The golem's current task (a call, so the type checker doesn't narrow it between frames). */
const taskOf = (w: World) => player(w).task;

test("Space attacks with nothing in front: the slam plays in full, thuds, and changes nothing (arm or not)", () => {
  for (const arm of [false, true]) {
    const w = newWorld(), pl = player(w);
    if (arm) setFlag(w, FLAGS.golemArm);
    frames(w, 2);
    assert.equal(findTarget(currentArea(w), pl), null, "nothing to interact with here");
    const before = worldState(w);
    events(w);
    frame(w, ATTACK);
    assert.equal(pl.task?.kind, "slam");
    let n = 1;
    while (pl.task && n < 500) { frame(w); n++; }
    assert.ok(Math.abs(n * DT - SLAM_TASK.dur) <= 2 * DT, `plays in full (${n} frames)`);
    const ev = events(w);
    const slams = ev.filter((e) => e.t === "slam");
    assert.equal(slams.length, 1);
    assert.ok(slams[0].t === "slam" && !slams[0].hit, "just the ground");
    assert.ok(!ev.some((e) => e.t === "wallBroken" || e.t === "withstood" || e.t === "message"));
    assert.equal(worldState(w), before, "the world is unchanged");
  }
});

test("no attack while another action is in progress; pressing again mid-slam doesn't restart it", () => {
  const w = newWorld();
  standAt(w, find(w, (i) => i.kind === "door"));
  frame(w, USE);
  assert.equal(taskOf(w)?.kind, "reach");
  frame(w, ATTACK);
  assert.equal(taskOf(w)?.kind, "reach", "busy: Space does nothing");
  while (taskOf(w)) frame(w);
  frame(w, ATTACK);
  const task = taskOf(w);
  assert.ok(task && task.kind === "slam");
  frames(w, 10, ATTACK);
  assert.equal(taskOf(w), task, "the same slam carries on");
  assert.ok(task.t >= 10 * DT);
  frames(w, 5, { ix: 1, iy: 0, use: false });
  assert.equal(taskOf(w), task, "it can't be walked out of");
});

test("next to something interactable, E interacts and Space attacks instead, leaving it alone", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  const coin = find(w, (i) => i.looseId === "coin");
  standAt(w, coin);
  assert.equal(findTarget(area, pl)?.looseId, "coin", "the coin is the interaction target");
  events(w);
  slamAt(w);
  assert.ok(!hasItem(pl, "coin") && !area.looseItem("coin")!.taken, "Space didn't pick it up");
  assert.ok(events(w).some((e) => e.t === "slam" && !e.hit));
  useOn(w, coin);
  assert.ok(hasItem(pl, "coin"), "E picks it up");
  // The locked door: Space slams the floor in front of it, E tries the door.
  const door = find(w, (i) => i.kind === "door");
  standAt(w, door);
  events(w);
  slamAt(w);
  let ev = events(w);
  assert.ok(ev.some((e) => e.t === "slam") && !ev.some((e) => e.t === "cue"), "no door rattle");
  assert.equal(area.tile(51, 5), T.LOCKED);
  useOn(w, door);
  ev = events(w);
  assert.ok(ev.some((e) => e.t === "cue" && e.cue === "clank") && !ev.some((e) => e.t === "slam"));
});

test("with the iron arm the slam breaks cracked debris, the moment the fists land", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  setFlag(w, FLAGS.golemArm);
  standAt(w, crack(w));
  const decals0 = area.decals.length;
  events(w);
  frame(w, ATTACK);
  let at = -1, n = 1;
  for (; pl.task && n < 300; n++) {
    const t = pl.task.t;
    frame(w);
    const ev = events(w);
    if (ev.some((e) => e.t === "wallBroken")) {
      at = t + DT;
      assert.ok(ev.some((e) => e.t === "slam" && e.hit), "the same frame as the blow");
    }
  }
  assert.ok(Math.abs(at - SLAM_HIT * SLAM_TASK.dur) <= DT + 1e-9, `breaks at the impact (${at.toFixed(3)}s)`);
  assert.equal(area.tile(47, 10), T.FLOOR);
  assert.equal(area.tile(47, 11), T.FLOOR);
  assert.equal(area.decals.length, decals0 + 26, "the usual debris");
  assert.ok(!interactables(area).some((i) => i.kind === "cracked"));
});

/** Put the golem at (x, y) facing `facing`, slam, and report what the blow did. */
const slamFrom = (w: World, x: number, y: number, facing: "left" | "right" | "up" | "down") => {
  const pl = player(w);
  pl.x = x; pl.y = y; pl.vx = 0; pl.vy = 0; pl.facing = facing;
  events(w);
  frame(w, ATTACK);
  let g = 0;
  while (pl.task && g++ < 300) frame(w);
  return events(w);
};

test("the slam hits in a radius around the fists, not around the golem's centre", () => {
  // The cracked wall is tiles (47, 10-11): pixels x 752..768, y 160..192. Facing right, the fists land 10 px ahead.
  const left = 47 * TS, mid = 11 * TS;
  const cases: { name: string; x: number; facing: "left" | "right"; breaks: boolean }[] = [
    // The golem itself is 28 px from the wall, outside the radius, but its fists land 18 px from it: hit.
    { name: "fists reach it from beyond the golem's own radius", x: left - 28, facing: "right", breaks: true },
    // Only 24 px from the fists to the wall: just out of reach.
    { name: "fists land just out of reach", x: left - 34, facing: "right", breaks: false },
    // The golem is 12 px from the wall, well inside the radius, but facing away its fists land 22 px from it: no hit.
    { name: "facing away, the golem's own proximity doesn't count", x: left - 12, facing: "left", breaks: false },
    // Fists driven straight into the wall.
    { name: "fists in the wall", x: left - 8, facing: "right", breaks: true },
  ];
  for (const c of cases) {
    const w = newWorld(), area = currentArea(w);
    setFlag(w, FLAGS.golemArm);
    const ev = slamFrom(w, c.x, mid, c.facing);
    const slam = ev.find((e) => e.t === "slam");
    assert.ok(slam && slam.t === "slam", `${c.name}: the slam landed`);
    assert.equal(slam.x, c.x + (c.facing === "right" ? 10 : -10), `${c.name}: centred on the fists`);
    assert.equal(slam.hit, c.breaks, c.name);
    assert.equal(ev.some((e) => e.t === "wallBroken"), c.breaks, c.name);
    assert.equal(area.tile(47, 10), c.breaks ? T.FLOOR : T.CRACKED, c.name);
  }
});

test("the slam's reach is a small area, about the dust it throws up (a tile or so), whichever way the golem faces", () => {
  assert.ok(SLAM_RADIUS >= TS && SLAM_RADIUS <= 2 * TS, `radius ${SLAM_RADIUS}px`);
  const top = 10 * TS - 1, bottom = 12 * TS;
  const w = newWorld();
  setFlag(w, FLAGS.golemArm);
  // Above the wall facing down: the fists land 3 px below the golem; level with the wall's top edge they are in it.
  assert.ok(slamFrom(w, 47 * TS + 8, top - 4, "down").some((e) => e.t === "wallBroken"), "from above");
  const w2 = newWorld();
  setFlag(w2, FLAGS.golemArm);
  // Below the wall facing up (fists 7 px up): in reach from just under its foot, not from 4 tiles away.
  assert.ok(!slamFrom(w2, 47 * TS + 8, bottom + 4 * TS, "up").some((e) => e.t === "wallBroken"), "far below");
  assert.equal(currentArea(w2).tile(47, 11), T.CRACKED);
  assert.ok(slamFrom(w2, 47 * TS + 8, bottom + 10, "up").some((e) => e.t === "wallBroken"), "just below");
});

test("without the arm the debris takes the hit and holds: nothing changes, and it still breaks later", () => {
  const w = newWorld(), area = currentArea(w);
  frames(w, 2);
  const before = worldState(w);
  slamAt(w, crack(w));
  const ev = events(w);
  assert.ok(ev.some((e) => e.t === "slam" && e.hit), "the slam struck it");
  const held = ev.find((e) => e.t === "withstood");
  assert.ok(held?.t === "withstood" && held.tx === 47 && held.ty === 10, "it held (the shudder's tile)");
  assert.ok(ev.some((e) => e.t === "message" && /HOLDS/.test(e.text)));
  assert.ok(!ev.some((e) => e.t === "wallBroken"));
  assert.equal(area.tile(47, 10), T.CRACKED);
  assert.equal(worldState(w), before, "no world change at all");
  slamAt(w, crack(w));
  assert.equal(area.tile(47, 10), T.CRACKED, "again: still holds");
  setFlag(w, FLAGS.golemArm);
  slamAt(w, crack(w));
  assert.equal(area.tile(47, 10), T.FLOOR, "with the arm it breaks");
});

test("E on the cracked wall never breaks it: it shudders and hints at Space, with or without the arm", () => {
  for (const arm of [false, true]) {
    const w = newWorld();
    if (arm) setFlag(w, FLAGS.golemArm);
    useOn(w, crack(w));
    const ev = events(w);
    assert.ok(ev.some((e) => e.t === "cue" && e.cue === "push"));
    assert.ok(ev.some((e) => e.t === "message" && /\(SPACE\)/.test(e.text)));
    assert.ok(!ev.some((e) => e.t === "slam" || e.t === "wallBroken" || e.t === "withstood"));
    assert.equal(currentArea(w).tile(47, 10), T.CRACKED);
  }
});

test("the blow re-checks its target: debris gone by the impact means the slam just hits the ground", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  setFlag(w, FLAGS.golemArm);
  standAt(w, crack(w));
  frame(w, ATTACK);
  area.setTile(47, 10, T.FLOOR); area.setTile(47, 11, T.FLOOR);
  const decals = area.decals.length;
  events(w);
  while (pl.task) frame(w);
  const ev = events(w);
  assert.ok(ev.some((e) => e.t === "slam" && !e.hit));
  assert.ok(!ev.some((e) => e.t === "wallBroken"));
  assert.equal(area.decals.length, decals, "no second break");
});

test("a slam in progress is plain task data: saved mid-swing, it lands after loading", () => {
  const w = newWorld();
  setFlag(w, FLAGS.golemArm);
  standAt(w, crack(w));
  frame(w, ATTACK);
  frames(w, 10);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.equal(player(w2).task?.kind, "slam");
  let g = 0;
  while (player(w2).task && g++ < 300) frame(w2);
  assert.equal(currentArea(w2).tile(47, 10), T.FLOOR);
});
