import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTORS } from "../src/game/content/actors";
import { T } from "../src/game/content/tiles";
import { AREAS } from "../src/game/world/areas";
import { buildFoundationArea } from "../src/game/world/foundationAreas";
import { actorById, createWorld, enterArea, getArea, makeActor, player } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { foundationDemo, registerFoundations } from "../src/game/sim/debugFoundations";
import { assignJob, cancelJob, gatherOrder } from "../src/game/sim/jobs";
import { countItem, addItems } from "../src/game/sim/inventory";
import { transferItems, storageRef, packRef, inventoryHandle, consumeInputs } from "../src/game/sim/storage";
import { stepWorld, stepPlayer } from "../src/game/sim/step";
import { applyCraft } from "../src/game/sim/crafting";
import { applyEffect } from "../src/game/sim/tasks";
import { relicCount } from "../src/game/sim/discovery";
import { findPath } from "../src/game/sim/navigation";
import { insertPowerCore } from "../src/game/sim/power";
import { meets } from "../src/game/sim/requirements";
import { setFlag } from "../src/game/world/world";
import { CRAFT_RECIPES } from "../src/game/content/crafting";
import { slotUsable } from "../src/game/sim/gear";
import { setActorFlag } from "../src/game/world/world";

registerFoundations();

test("authored storage is deterministic data and an emptied chest stays empty after loading", () => {
  AREAS.stocked = () => {
    const area = buildFoundationArea("debug_workshop"); area.id = "stocked";
    area.props.find((p) => p.id === "chest.fixture")!.inventory = [{ item: "wood", n: 7 }, null, { item: "stone", n: 3 }];
    return area;
  };
  try {
    assert.deepEqual(AREAS.stocked(), AREAS.stocked());
    const w = createWorld(1), area = getArea(w, "stocked"), chest = area.prop("chest.fixture")!;
    assert.equal(chest.inventory![0]!.n, 7);
    assert.equal(serialize(w).areas.stocked.props[chest.id], undefined, "no diff for builder contents");
    area.setInventory(chest.id, []);
    assert.equal(area.base.props.find((p) => p.id === chest.id)!.inventory![0]!.n, 7, "runtime slots do not alias builder data");
    const save = serialize(w);
    assert.deepEqual(save.areas.stocked.props[chest.id].inventory, [], "empty is an explicit diff against a non-empty builder");
    const loaded = deserialize(save);
    assert.ok(getArea(loaded, area.id).prop(chest.id)!.inventory!.every((s) => !s));
    assert.deepEqual(serialize(loaded), save);
    assert.throws(() => area.addProp("storage_chest", 20, 20, {}, chest.id), /duplicate/);
  } finally { delete AREAS.stocked; }
});

test("a worker deposits before a final harvest bonus that would spill out of its pack", () => {
  const w = foundationDemo(), a = actorById(w, "debug.worker")!, yard = getArea(w, "debug_yard"), tree = yard.prop("tree.fixture")!;
  cancelJob(w, a); enterArea(w, a, yard.id, tree.x, tree.y + 12);
  addItems(w, a, "coin", 7); addItems(w, a, "wood", 19);
  yard.damageProp(tree.id, 3.5);
  assignJob(w, a, gatherOrder("wood", yard.id, { area: "debug_workshop", prop: "chest.fixture" }, 20));
  for (let i = 0; i < 4000 && a.job?.status !== "done"; i++) stepWorld(w, 0.05);
  assert.equal(a.job?.status, "done", JSON.stringify(a.job));
  const chest = getArea(w, "debug_workshop").prop("chest.fixture")!;
  assert.equal(chest.inventory!.reduce((n, s) => n + (s?.item === "wood" ? s.n : 0), 0), 20);
  assert.equal(countItem(a, "wood"), 2);
  assert.ok(yard.loose.every((l) => l.item !== "wood"), "no stranded harvest overflow");
});

test("storage transfers and inverse recipes retain relic discovery credit", () => {
  const w = foundationDemo(), pl = player(w), area = getArea(w, pl.area), bench = area.prop("bench.fixture")!;
  pl.inventory = [];
  w.flags.delete("relic.found.crown");
  area.setInventory("chest.fixture", [{ item: "crown", n: 1 }]);
  assert.equal(transferItems(w, storageRef(area.id, "chest.fixture"), packRef(pl), "crown", 1), 1);
  assert.ok(w.flags.has("relic.found.crown"));
  pl.x = bench.x; pl.y = bench.y + 12;
  assert.ok(applyCraft(w, pl, area, "unmake_crown", bench.id));
  assert.equal(relicCount(w, pl), 1);
});

test("mixed actors share one harvest work counter; changing bodies never changes total yield", () => {
  const w = foundationDemo(), small = actorById(w, "debug.worker")!, pl = player(w), area = getArea(w, "debug_yard"), tree = area.prop("tree.fixture")!;
  cancelJob(w, small);
  enterArea(w, small, area.id, tree.x - 12, tree.y + 8);
  enterArea(w, pl, area.id, tree.x + 12, tree.y + 8);
  const target = { kind: "harvest", propId: tree.id, x: tree.x, y: tree.y };
  for (let i = 0; !tree.taken && i < 20; i++) applyEffect(w, i % 2 ? pl : small, { op: "harvest" }, target);
  assert.equal(countItem(small, "wood") + countItem(pl, "wood"), 6);
  assert.equal(tree.dmg, 4);
});

test("pathfinding uses the moving actor's width through a narrow doorway", () => {
  AREAS.doorway = () => {
    const area = buildFoundationArea("debug_workshop"); area.id = "doorway"; area.props = [];
    for (let x = 1; x < area.w - 1; x++) area.grid[5 * area.w + x] = x === 7 ? T.FLOOR : T.WALL;
    area.plan = area.grid.slice(); return area;
  };
  ACTORS.wide = { ...ACTORS.golem, body: { box: [24, 10], reach: 20, height: 40 } };
  try {
    const w = createWorld(3); getArea(w, "doorway");
    const small = makeActor("small", "worker_golem", "doorway", 120, 59), wide = makeActor("wide", "wide", "doorway", 120, 59);
    assert.ok(findPath(w, small, { x: 120, y: 123, range: 1 }, false));
    assert.equal(findPath(w, wide, { x: 120, y: 123, range: 1 }, false), null);
  } finally { delete AREAS.doorway; delete ACTORS.wide; }
});

test("slotting a core requires walking up, not reaching through a wall", () => {
  const w = foundationDemo(), pl = player(w), a = actorById(w, "debug.worker")!, area = getArea(w, pl.area);
  cancelJob(w, a); a.powerCore = null;
  pl.x = 56; pl.y = 75; a.x = 80; a.y = 75;
  area.setTile(4, 4, T.WALL); addItems(w, pl, "ruby_core", 1);
  assert.equal(insertPowerCore(w, pl, a, "ruby_core"), false);
  assert.equal(countItem(pl, "ruby_core"), 1);
});

test("a complete off-screen job and save round-trip need neither DOM nor ambient randomness", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"), random = Math.random;
  Object.defineProperty(globalThis, "document", { configurable: true, get: () => { throw new Error("simulation touched DOM"); } });
  Math.random = () => { throw new Error("simulation used ambient randomness"); };
  try {
    const w = foundationDemo(), a = actorById(w, "debug.worker")!;
    for (let i = 0; i < 3000 && a.job?.status !== "done"; i++) stepWorld(w, 0.05);
    assert.equal(a.job?.status, "done");
    assert.deepEqual(serialize(deserialize(serialize(w))), serialize(w));
  } finally {
    Math.random = random;
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete (globalThis as { document?: unknown }).document;
  }
});

test("the same inventory cannot be counted twice in one material transaction", () => {
  const w = foundationDemo(), pl = player(w); addItems(w, pl, "wood", 1);
  const a = inventoryHandle(w, packRef(pl))!, b = inventoryHandle(w, packRef(pl))!;
  assert.equal(consumeInputs([a, b], [{ item: "wood", n: 2 }]), false);
  assert.equal(countItem(pl, "wood"), 1);
});

test("legacy body-flag requirements are actor-relative, never borrowed from the player", () => {
  const w = foundationDemo(), pl = player(w), a = actorById(w, "debug.worker")!;
  setFlag(w, "golem.arm");
  assert.equal(meets(w, pl, { flags: ["golem.arm"] }), true);
  assert.equal(meets(w, a, { flags: ["golem.arm"] }), false);
});

test("recipe data cannot consume a declared tool or spend inputs on an invalid output", () => {
  const w = foundationDemo(), pl = player(w), area = getArea(w, pl.area), bench = area.prop("bench.fixture")!;
  pl.x = bench.x; pl.y = bench.y + 12;
  const base = CRAFT_RECIPES.find((r) => r.id === "rune_swift")!;
  const invalid = { ...base, inputs: [{ item: "chisel" as const, n: 1 }] };
  assert.equal(applyCraft(w, pl, area, invalid.id, bench.id, [invalid]), false);
  assert.equal(countItem(pl, "chisel"), 1);
  addItems(w, pl, "cut_stone", 2);
  assert.equal(applyCraft(w, pl, area, base.id, bench.id, [{ ...base, output: { item: "rune_swift", n: 0 } }]), false);
  assert.equal(countItem(pl, "cut_stone"), 2);
});

test("manual player input cancels automatic work and immediately restores direct control", () => {
  const w = foundationDemo(), pl = player(w);
  assignJob(w, pl, { kind: "walk", args: { area: pl.area, x: 72, y: 139 } });
  stepPlayer(w, 0.05, { ix: 0, iy: 0, use: false });
  assert.ok(pl.job);
  stepPlayer(w, 0.05, { ix: 1, iy: 0, use: false });
  assert.equal(pl.job, null); assert.equal(pl.task, null); assert.ok(pl.vx > 0);
});

test("another actor definition can put its own lock on a normally open slot", () => {
  ACTORS.sealed = { ...ACTORS.worker_golem, gearUnlocks: { rune0: { actorFlags: ["body.runeSocket"] } } };
  try {
    const w = foundationDemo(), a = makeActor("sealed", "sealed", "debug_workshop", 40, 40);
    assert.equal(slotUsable(w, a, "rune0"), false);
    setActorFlag(a, "body.runeSocket");
    assert.equal(slotUsable(w, a, "rune0"), true);
    assert.equal(slotUsable(w, a, "rune1"), false);
  } finally { delete ACTORS.sealed; }
});