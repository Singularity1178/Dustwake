import { test } from "node:test";
import assert from "node:assert/strict";
import { actorDef } from "../src/game/content/actors";
import { JOB_KINDS } from "../src/game/content/jobs";
import { RUNE_LINKS, RUNE_NODES } from "../src/game/content/runes";
import { T, TS } from "../src/game/content/tiles";
import { createWorld, getArea, player, makeActor, actorById, clearFlag, setFlag, type Actor, type World } from "../src/game/world/world";
import { AREAS } from "../src/game/world/areas";
import { buildFoundationArea } from "../src/game/world/foundationAreas";
import { serialize, deserialize } from "../src/game/world/save";
import { foundationDemo, registerFoundations } from "../src/game/sim/debugFoundations";
import { assignJob, cancelJob, pauseJob, resumeJob, craftOrder, gatherOrder, setWorkerOrder, JOB_HANDLERS } from "../src/game/sim/jobs";
import { stepWorld, stepPlayer } from "../src/game/sim/step";
import { addItems, countItem } from "../src/game/sim/inventory";
import { actorBox, actorBoxes, boxFree } from "../src/game/sim/collision";
import { navGrid, findPath } from "../src/game/sim/navigation";
import { runeRoute } from "../src/game/sim/runes";
import type { JobOrder } from "../src/game/world/jobs";

registerFoundations();
const DT = 0.05;
const worker = (w: World) => actorById(w, "debug.worker")!;
const stock = (w: World) => getArea(w, "debug_workshop").prop("chest.fixture")!.inventory!.reduce((n, s) => n + (s?.item === "wood" ? s.n : 0), 0);
function until(w: World, check: () => boolean, limit = 4000) {
  for (let i = 0; i < limit && !check(); i++) stepWorld(w, DT);
  assert.ok(check(), JSON.stringify(w.actors.filter((a) => a.job).map((a) => ({ id: a.id, x: a.x, y: a.y, area: a.area, job: a.job }))));
}
const walk = (area: string, x: number, y: number): JobOrder => ({ kind: "walk", args: { area, x, y } });

test("a smaller worker walks, travels, harvests eight times and deposits six wood across areas", () => {
  const w = foundationDemo(), a = worker(w);
  clearFlag(w, "tutorial.done");
  assert.notDeepEqual(actorDef(a).body.box, actorDef(player(w)).body.box);
  const origin = { x: a.x, y: a.y };
  until(w, () => a.job?.status === "done");
  assert.equal(stock(w), 6); assert.equal(countItem(a, "wood"), 0); assert.equal(a.inventory.length, 8);
  assert.equal(a.area, "debug_workshop");
  assert.ok(Math.hypot(a.x - origin.x, a.y - origin.y) > 16);
  const hops = w.events.filter((e) => e.t === "travelled" && e.actor === a.id);
  assert.equal(hops.length, 2);
  assert.equal(w.events.filter((e) => e.t === "harvestHit" && e.actor === a.id).length, 8);
  assert.equal(w.flags.has("tutorial.done"), false, "workers cannot complete the player's tutorial");
  assert.equal(a.task, null); assert.equal(a.moving, false);
  const pos = [a.x, a.y];
  for (let i = 0; i < 100; i++) stepWorld(w, DT);
  assert.deepEqual([a.x, a.y], pos, "no idle wandering");
});

for (const phase of ["walking", "channel", "harvest", "deposit-fired"] as const) {
  test(`save/load during ${phase}: the order, path and receipts continue identically`, () => {
    const w = foundationDemo();
    until(w, () => {
      const a = worker(w);
      if (phase === "walking") return !!a.job?.nav?.path.length && a.moving;
      if (phase === "channel") return a.task?.kind === "channel" && a.task.t > 0.5;
      if (phase === "harvest") return a.task?.kind === "punch" && a.task.t > 0.15 && !a.task.fired;
      return a.task?.effect?.op === "deposit" && a.task.fired;
    });
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(w))));
    assert.deepEqual(serialize(loaded), serialize(w));
    for (let i = 0; i < 4000 && worker(w).job?.status !== "done"; i++) { stepWorld(w, DT); stepWorld(loaded, DT); }
    assert.equal(worker(w).job?.status, "done"); assert.equal(stock(loaded), 6);
    assert.deepEqual(serialize(loaded), serialize(w));
  });
}

test("a non-golem with a worker capability runs the same job; actor.kind is irrelevant", () => {
  const w = foundationDemo(), a = worker(w);
  cancelJob(w, a);
  a.definition = "npc_worker"; a.kind = "special-villager"; a.powerCore = null;
  assert.ok(assignJob(w, a, gatherOrder("stone", "debug_yard", { area: "debug_workshop", prop: "chest.fixture" }, 5)));
  until(w, () => a.job?.status === "done");
  assert.equal(getArea(w, "debug_workshop").prop("chest.fixture")!.inventory!.reduce((n, s) => n + (s?.item === "stone" ? s.n : 0), 0), 5);
  assert.equal(w.events.filter((e) => e.t === "harvestHit" && e.actor === a.id).length, 4);
});

test("power loss and manual pause preserve a partial task and do not consume anything twice", () => {
  const w = foundationDemo(), a = worker(w);
  until(w, () => a.task?.kind === "punch" && !a.task.fired && a.task.t > 0.1);
  const t = a.task!.t, damage = getArea(w, a.area).prop("tree.fixture")!.dmg;
  a.powerCore = null;
  for (let i = 0; i < 50; i++) stepWorld(w, DT);
  assert.equal(a.task!.t, t); assert.equal(a.job?.reason, "power");
  assert.equal(getArea(w, a.area).prop("tree.fixture")!.dmg, damage);
  const loaded = deserialize(serialize(w)), b = worker(loaded);
  pauseJob(loaded, b); b.powerCore = "ruby_core";
  for (let i = 0; i < 20; i++) stepWorld(loaded, DT);
  assert.equal(b.task!.t, t); assert.equal(b.job?.reason, "manual");
  resumeJob(loaded, b);
  until(loaded, () => b.job?.status === "done");
  assert.equal(stock(loaded), 6);
});

test("walk-up order changes cancel only owned work, and cannot be issued remotely", () => {
  const w = foundationDemo(), a = worker(w), pl = player(w);
  const previousId = a.job!.id;
  assert.ok(setWorkerOrder(w, pl, a.id, walk(a.area, 88, 123)));
  assert.ok(a.job!.id > previousId);
  const snapshot = JSON.stringify(a.job);
  pl.x = 20; pl.y = 20;
  assert.equal(setWorkerOrder(w, pl, a.id, null), false); assert.equal(JSON.stringify(a.job), snapshot);
  pl.x = a.x; pl.y = a.y + 12;
  assert.ok(setWorkerOrder(w, pl, a.id, null)); assert.equal(a.job, null); assert.equal(a.task, null);
  assert.equal(countItem(a, "wood"), 0);
});

test("crafting jobs stay at the station, use nearby storage and retain the chisel across a fired-task save", () => {
  const w = foundationDemo(), a = worker(w), area = getArea(w, "debug_workshop"), bench = area.prop("bench.fixture")!;
  cancelJob(w, a); a.x = bench.x - 20; a.y = bench.y + 16;
  area.setInventory("chest.fixture", [{ item: "cut_stone", n: 4 }]);
  addItems(w, a, "chisel", 1);
  assert.ok(assignJob(w, a, craftOrder({ area: area.id, prop: bench.id }, "rune_swift", 2)));
  until(w, () => !!a.task?.fired && a.job?.result === true);
  assert.equal(a.job!.completed, 0, "completion receipt is waiting for the task to finish");
  const loaded = deserialize(serialize(w));
  until(loaded, () => worker(loaded).job?.status === "done");
  assert.equal(worker(loaded).job!.completed, 2);
  assert.equal(countItem(worker(loaded), "rune_swift"), 2); assert.equal(countItem(worker(loaded), "chisel"), 1);
  assert.equal(getArea(loaded, area.id).prop("chest.fixture")!.inventory!.filter(Boolean).length, 0);
});

test("a crafter with a full pack blocks before consumption and can be resumed after making room", () => {
  const w = foundationDemo(), a = worker(w), area = getArea(w, a.area), bench = area.prop("bench.fixture")!;
  cancelJob(w, a); a.x = bench.x - 20; a.y = bench.y + 16;
  addItems(w, a, "coin", 8); area.setInventory("chest.fixture", [{ item: "wood", n: 2 }]);
  assert.ok(assignJob(w, a, craftOrder({ area: area.id, prop: bench.id }, "planks", 1)));
  until(w, () => a.job?.status === "blocked");
  assert.equal(a.job!.reason, "packFull"); assert.equal(stock(w), 2);
  a.inventory[0] = null; resumeJob(w, a);
  until(w, () => a.job?.status === "done");
  assert.equal(countItem(a, "planks"), 3); assert.equal(stock(w), 0);
});

test("a full deposit chest blocks and a removed resource never loops a harvest task", () => {
  const w = foundationDemo(), a = worker(w), area = getArea(w, "debug_workshop");
  area.setInventory("chest.fixture", Array.from({ length: 32 }, () => ({ item: "coin", n: 1 })));
  until(w, () => a.job?.status === "blocked" && a.job.reason === "storageFull");
  assert.equal(countItem(a, "wood"), 6); assert.equal(a.task, null);
  const loaded = deserialize(serialize(w));
  getArea(loaded, area.id).setInventory("chest.fixture", []);
  resumeJob(loaded, worker(loaded));
  until(loaded, () => worker(loaded).job?.status === "done");
  assert.equal(stock(loaded), 6);
  const empty = foundationDemo(), b = worker(empty);
  getArea(empty, "debug_yard").removeProp("tree.fixture");
  until(empty, () => b.job?.status === "blocked" && b.job.reason === "noResource");
  assert.equal(b.task, null);
});

function corridor(bay: boolean) {
  AREAS.corridor = () => {
    const area = buildFoundationArea("debug_yard");
    area.id = "corridor"; area.props = []; area.grid.fill(T.WALL);
    for (let x = 1; x < area.w - 1; x++) area.grid[4 * area.w + x] = T.FLOOR;
    if (bay) { area.grid[3 * area.w + 8] = T.FLOOR; area.grid[3 * area.w + 9] = T.FLOOR; }
    area.plan = area.grid.slice(); return area;
  };
  const w = createWorld(77); getArea(w, "corridor");
  const a = makeActor("a", "worker_golem", "corridor", 3 * TS + 8, 4 * TS + 11);
  const b = makeActor("z", "worker_golem", "corridor", 12 * TS + 8, 4 * TS + 11);
  a.powerCore = b.powerCore = "ruby_core"; w.actors.push(a, b);
  assignJob(w, a, walk(a.area, b.x, b.y)); assignJob(w, b, walk(b.area, a.x, a.y));
  return { w, a, b };
}
function overlaps(a: Actor, b: Actor) {
  const x = actorBox(a)!, y = actorBox(b)!;
  return x[0] < y[2] - 0.001 && x[2] > y[0] + 0.001 && x[1] < y[3] - 0.001 && x[3] > y[1] + 0.001;
}

test("opposing workers yield into a passing bay without overlap or teleporting", () => {
  const { w, a, b } = corridor(true);
  let yielded = false;
  for (let i = 0; i < 2400 && (a.job?.status !== "done" || b.job?.status !== "done"); i++) {
    const positions = [[a.x, a.y], [b.x, b.y]];
    stepWorld(w, DT);
    yielded ||= !!a.job?.nav?.yielding || !!b.job?.nav?.yielding;
    assert.equal(overlaps(a, b), false);
    for (const [n, actor] of [a, b].entries()) assert.ok(Math.hypot(actor.x - positions[n][0], actor.y - positions[n][1]) <= 16 * DT + 0.01);
  }
  assert.equal(a.job?.status, "done", JSON.stringify(a.job));
  assert.equal(b.job?.status, "done", JSON.stringify(b.job));
  assert.ok(yielded, "the narrower corridor needs explicit cooperation");
});

test("impossible bottlenecks settle into resumable blocked orders with bounded retries", () => {
  const { w, a, b } = corridor(false);
  for (let i = 0; i < 2600; i++) { stepWorld(w, DT); assert.equal(overlaps(a, b), false); }
  const blocked = [a, b].filter((a) => a.job?.status === "blocked");
  assert.ok(blocked.length, "impossible traffic is reported, not left doing work forever");
  for (const a of blocked) { assert.equal(a.job?.reason, "pathBlocked"); assert.equal(a.job?.failures, 3); assert.equal(a.moving, false); }
  const loaded = deserialize(serialize(w));
  assert.deepEqual(serialize(loaded), serialize(w));
  const area = getArea(w, "corridor");
  for (let x = 1; x < area.w - 1; x++) area.setTile(x, 3, T.FLOOR);
  for (const a of blocked) resumeJob(w, a);
  until(w, () => a.job?.status === "done" && b.job?.status === "done");
});

test("navigation caches per body and layout, and replans after a wall changes", () => {
  const w = foundationDemo(), a = worker(w), area = getArea(w, a.area);
  cancelJob(w, a);
  const grid = navGrid(area, a);
  assert.equal(navGrid(area, a), grid);
  assert.notEqual(navGrid(area, player(w)), grid, "different footprints have different grids");
  assert.ok(findPath(w, a, { x: 40, y: 43, range: 1 }));
  area.setTile(2, 2, T.WALL);
  assert.notEqual(navGrid(area, a), grid);
  assignJob(w, a, walk(area.id, 40, 123));
  until(w, () => a.job?.status === "done");
  assert.ok(boxFree(area, a.x, a.y, actorBoxes(w, area.id, a.id), actorDef(a).body.box));
});

test("rune routing respects direction, activation and data-only multi-hop links", () => {
  const w = foundationDemo();
  const link = RUNE_LINKS.find((l) => l.a === "debug_yard")!;
  link.oneWay = true;
  assert.equal(runeRoute(w, "debug_workshop", "debug_yard"), null);
  assert.equal(runeRoute(w, "debug_yard", "debug_workshop")!.length, 1);
  delete link.oneWay;
  RUNE_NODES.annex = { id: "annex", area: "annex", prop: "annex", flag: "rune.annex.active", name: "ANNEX", arrive: { dx: 0, dy: 10, facing: "down" } };
  const extra = { a: "debug_yard", b: "annex", awakens: false };
  RUNE_LINKS.push(extra);
  assert.equal(runeRoute(w, "debug_workshop", "annex"), null);
  extra.awakens = true;
  assert.deepEqual(runeRoute(w, "debug_workshop", "annex"), [{ from: "debug_workshop", to: "debug_yard" }, { from: "debug_yard", to: "annex" }]);
  RUNE_LINKS.splice(RUNE_LINKS.indexOf(extra), 1); delete RUNE_NODES.annex;
});

test("blocked rune arrivals preserve the actor and its order instead of overlapping a body or looping channels", () => {
  const w = foundationDemo(), a = worker(w), yard = getArea(w, "debug_yard");
  until(w, () => a.task?.kind === "channel");
  yard.removeProp("rune.debug_yard");
  until(w, () => a.job?.status === "blocked");
  assert.equal(a.area, "debug_workshop"); assert.equal(a.job?.reason, "arrivalBlocked");
  assert.equal(a.task, null);
});

test("the player can run an order through the same handler and locomotion path", () => {
  const w = foundationDemo(), pl = player(w); cancelJob(w, worker(w));
  assert.ok(assignJob(w, pl, walk(pl.area, 72, 139)));
  for (let i = 0; i < 500 && pl.job?.status !== "done"; i++) {
    stepPlayer(w, DT, { ix: 0, iy: 0, use: false }); stepWorld(w, DT);
  }
  assert.equal(pl.job?.status, "done");
});

test("a new job kind is a registry row and a small handler, with no scheduler branch", () => {
  JOB_KINDS.waitFixture = { phase: "wait", capabilities: [] };
  JOB_HANDLERS.waitFixture = { validate: (args) => typeof args.until === "number", step: (w, a, job) => {
    if (w.time >= (job.args.until as number)) { job.status = "done"; job.completed = 1; a.moving = false; }
  } };
  try {
    const w = foundationDemo(), a = worker(w); cancelJob(w, a);
    assert.ok(assignJob(w, a, { kind: "waitFixture", args: { until: 1 } }));
    stepWorld(w, 0.25);
    const loaded = deserialize(serialize(w));
    until(loaded, () => worker(loaded).job?.status === "done");
    assert.equal(worker(loaded).job?.completed, 1);
  } finally { delete JOB_HANDLERS.waitFixture; delete JOB_KINDS.waitFixture; }
});

test("a dormant worker resumes its saved order when powered without a new assignment", () => {
  const w = foundationDemo(), a = worker(w); a.powerCore = null;
  stepWorld(w, DT); assert.equal(a.job?.status, "paused");
  const loaded = deserialize(serialize(w)), b = worker(loaded); b.powerCore = "ruby_core";
  setFlag(loaded, "know.build");
  until(loaded, () => b.job?.status === "done");
  assert.equal(stock(loaded), 6);
});