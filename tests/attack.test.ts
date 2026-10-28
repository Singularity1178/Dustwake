// The attack (Space): a two-arm ground slam, separate from interacting (E).
// Always available when the golem could act; breaks cracked debris with the
// iron arm and only lands a hit without it. It is also how the golem harvests:
// every tree, rock and log in the blow's radius takes one blow of work.
// Headless, through stepPlayer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, getArea, setFlag, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { hasItem, countItem } from "../src/game/sim/inventory";
import { findTarget, interactables } from "../src/game/sim/interact";
import { visionTargets } from "../src/game/sim/analysis";
import { HARVEST } from "../src/game/content/harvest";
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

// ---------------------------------------------------------------- harvesting
// Trees, rocks and logs are not interactables (E does nothing, the golem's
// vision skips them). The golem harvests by attacking near them instead.
const HARVESTABLES = Object.keys(HARVEST);
const wood = (w: World) => countItem(player(w), "wood");
const stone = (w: World) => countItem(player(w), "stone");
const harvestHits = (ev: ReturnType<typeof events>) => ev.filter((e) => e.t === "harvestHit");

test("standing trees, rocks and logs are not interactables: E finds nothing and the golem's vision skips them", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  const props = HARVESTABLES.map((k, i) => area.addProp(k, pl.x + 14, pl.y + i * 24));
  const ids = new Set(props.map((p) => p.id));
  assert.ok(!interactables(area).some((i) => (i.propId && ids.has(i.propId)) || i.kind === "harvest"));
  assert.ok(!visionTargets(w, area).some((v) => ids.has(v.id)), "not in the dungeon's vision");
  for (const p of props) {
    pl.x = p.x - 12; pl.y = p.y; pl.vx = 0; pl.vy = 0; pl.facing = "right";
    assert.equal(findTarget(area, pl), null, `${p.kind}: nothing to interact with`);
    frame(w, USE);
    assert.equal(pl.task, null, `${p.kind}: E starts no work`);
    assert.equal(p.dmg, 0);
  }
  // The same on the wild surface, which is full of them.
  const surface = getArea(w, "surface"), wild = surface.props.filter((p) => HARVEST[p.kind]);
  assert.ok(wild.length > 60, "the surface has plenty of harvestables");
  const wildIds = new Set(wild.map((p) => p.id));
  assert.ok(!interactables(surface).some((i) => (i.propId && wildIds.has(i.propId)) || i.kind === "harvest"));
  assert.ok(!visionTargets(w, surface).some((v) => wildIds.has(v.id)), "not in the surface's vision");
});

test("a slam harvests the tree it lands in: one blow of work each, wood per blow, then the final bonus on depletion", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  const tree = area.addProp("tree", pl.x + 14, pl.y), d = HARVEST.tree;
  const at = { x: pl.x, y: pl.y };
  for (let i = 1; i < d.hp; i++) {
    const ev = slamFrom(w, at.x, at.y, "right");
    assert.ok(ev.some((e) => e.t === "slam" && e.hit), `blow ${i} struck it`);
    assert.equal(harvestHits(ev).length, 1);
    assert.equal(tree.dmg, i);
    assert.equal(wood(w), i * d.perHit.n);
    assert.equal(tree.taken, false);
  }
  const last = slamFrom(w, at.x, at.y, "right");
  const hit = harvestHits(last)[0];
  assert.ok(hit?.t === "harvestHit" && hit.depleted && hit.prop === tree.id && hit.actor === pl.id);
  assert.equal(tree.taken, true);
  assert.equal(wood(w), d.hp * d.perHit.n + d.final!.n);
  // A stump isn't harvestable: the slam just hits the ground.
  const after = slamFrom(w, at.x, at.y, "right");
  assert.ok(after.some((e) => e.t === "slam" && !e.hit) && !harvestHits(after).length);
  assert.equal(wood(w), d.hp * d.perHit.n + d.final!.n, "no more wood");
  // Rocks pay stone the same way.
  const rock = area.addProp("rock", pl.x + 14, pl.y + 40), rd = HARVEST.rock;
  for (let i = 0; i < rd.hp; i++) slamFrom(w, at.x, at.y + 40, "right");
  assert.equal(rock.taken, true);
  assert.equal(stone(w), rd.hp * rd.perHit.n + rd.final!.n);
});

test("a slam in reach of several harvestables harvests all of them at once", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  // Fists land at (x + 10, y). All three footprints are within the radius of that point; the fourth tree is not.
  const tree = area.addProp("tree", pl.x + 14, pl.y);
  const rock = area.addProp("rock", pl.x + 14, pl.y + 6);
  const log = area.addProp("log", pl.x + 14, pl.y - 8);
  const far = area.addProp("tree", pl.x + 10 + 3 * TS * 4, pl.y);
  const ev = slamFrom(w, pl.x, pl.y, "right");
  const hits = harvestHits(ev);
  assert.deepEqual(hits.map((e) => e.t === "harvestHit" && e.prop).sort(), [tree.id, rock.id, log.id].sort());
  assert.ok(ev.some((e) => e.t === "slam" && e.hit));
  assert.equal(wood(w), 2, "one wood from the tree and one from the log");
  assert.equal(stone(w), 1, "one stone from the rock");
  for (const p of [tree, rock, log]) assert.equal(p.dmg, 1, p.kind);
  assert.equal(far.dmg, 0, "out of reach");
  // Once one is used up, the rest carry on in the same blows.
  for (let i = 0; i < HARVEST.rock.hp; i++) slamFrom(w, pl.x, pl.y, "right");
  assert.equal(rock.taken, true);
  assert.equal(tree.taken || log.taken, true, "the quicker ones were depleted along the way too");
  assert.equal(far.dmg, 0);
});

test("a slam harvests only what is within the radius of the fists, wherever the golem stands", () => {
  const edge = SLAM_RADIUS + 5; // a tree's box is 10 px wide, centred on its x
  const cases: { name: string; at: number; facing: "left" | "right"; hit: boolean }[] = [
    { name: "box edge just inside the radius of the fists", at: 10 + edge, facing: "right", hit: true },
    { name: "box edge just outside it", at: 10 + edge + 1, facing: "right", hit: false },
    { name: "the golem is close, but its fists land away from the tree", at: 30, facing: "left", hit: false },
    { name: "the same tree, fists toward it", at: 30, facing: "right", hit: true },
  ];
  for (const c of cases) {
    const w = newWorld(), pl = player(w), area = currentArea(w), x = pl.x, y = pl.y;
    const tree = area.addProp("tree", x + c.at, y);
    const ev = slamFrom(w, x, y, c.facing);
    assert.equal(tree.dmg > 0, c.hit, c.name);
    assert.equal(harvestHits(ev).length, c.hit ? 1 : 0, c.name);
    assert.equal(ev.some((e) => e.t === "slam" && e.hit), c.hit, c.name);
    assert.equal(wood(w), c.hit ? 1 : 0, c.name);
  }
});

test("harvesting needs the attack to land: a slam saved mid-swing harvests after loading, and a busy golem harvests nothing", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  const tree = area.addProp("tree", pl.x + 14, pl.y);
  pl.facing = "right";
  frame(w, ATTACK);
  frames(w, 10);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.equal(player(w2).task?.kind, "slam");
  assert.equal(currentArea(w2).prop(tree.id)!.dmg, 0, "nothing yet: the blow hasn't landed");
  let g = 0;
  while (player(w2).task && g++ < 300) frame(w2);
  assert.equal(currentArea(w2).prop(tree.id)!.dmg, 1);
  assert.equal(countItem(player(w2), "wood"), 1);
  // Mid-task, Space is ignored, so nothing is harvested.
  const w3 = newWorld(), busy = player(w3), t3 = currentArea(w3).addProp("tree", busy.x + 14, busy.y);
  busy.facing = "right";
  const door = find(w3, (i) => i.kind === "door");
  standAt(w3, door);
  frame(w3, USE);
  frame(w3, ATTACK);
  assert.equal(taskOf(w3)?.kind, "reach");
  assert.equal(t3.dmg, 0);
});
