// Actor, power, storage and work foundations. The optional rows are registered
// in this test process only; the production content lists remain unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTORS, actorDef } from "../src/game/content/actors";
import { POWER_CORES } from "../src/game/content/power";
import { CRAFT_RECIPES, rawValue } from "../src/game/content/crafting";
import { AUTHORED_SALVAGE } from "../src/game/content/build";
import { actorById, createWorld, enterArea, getArea, makeActor, player, setActorFlag, setFlag } from "../src/game/world/world";
import { deserialize, serialize } from "../src/game/world/save";
import { registerFoundations } from "../src/game/sim/debugFoundations";
import { addItems, capacity, countItem, reconcileCapacity, removeItems } from "../src/game/sim/inventory";
import { applyWear, slotUsable, usableSlots } from "../src/game/sim/gear";
import { actorSpeed, harvestPower, powered } from "../src/game/sim/actorStats";
import { coreCheck, insertPowerCore, removePowerCore } from "../src/game/sim/power";
import { inventoryHandle, packRef, storageRef, transferItems, nearbyStorage, craftSources, consumeInputs } from "../src/game/sim/storage";
import { applyCraft, orderCraft, craftEntry } from "../src/game/sim/crafting";
import { applyEffect, tickTask } from "../src/game/sim/tasks";
import { stepWorld } from "../src/game/sim/step";
import { navGrid } from "../src/game/sim/navigation";
import { interactables } from "../src/game/sim/interact";
import { applyDeconstruct, deconstructCheck, salvageOf } from "../src/game/sim/build";
import { relicCount } from "../src/game/sim/discovery";
import { T } from "../src/game/content/tiles";
import type { ItemId } from "../src/game/content/items";

registerFoundations();

function workshop() {
  const w = createWorld(11), area = getArea(w, "debug_workshop");
  const pl = player(w), bench = area.prop("bench.fixture")!, chest = area.prop("chest.fixture")!;
  enterArea(w, pl, area.id, bench.x, bench.y + 14);
  setFlag(w, "know.build");
  return { w, area, pl, bench, chest };
}
const total = (slots: readonly ({ item: ItemId; n: number } | null)[], item: ItemId) => slots.reduce((n, s) => n + (s?.item === item ? s.n : 0), 0);

test("definitions isolate bodies, speed, capacity and usable slots for every actor", () => {
  const { w, pl } = workshop();
  const small = makeActor("small", "worker_golem", pl.area, 40, 40), human = makeActor("human", "npc_worker", pl.area, 80, 40);
  small.powerCore = "ruby_core";
  w.actors.push(small, human);
  setFlag(w, "golem.arm");
  for (const f of ["golem.slot.armL", "golem.slot.rune1", "golem.slot.rune2", "golem.slot.rune3"]) setFlag(w, f);
  stepWorld(w, 0.01);
  assert.equal(capacity(w, pl), 16);
  assert.equal(small.inventory.length, 8); assert.equal(human.inventory.length, 8);
  assert.ok(slotUsable(w, human, "armL"), "the human does not inherit the maintainer's damaged-arm lock");
  assert.equal(actorById(w, "npc.guardian")!.inventory.length, 0);
  assert.deepEqual(usableSlots(w, small), ["rune0"]);
  setActorFlag(small, "golem.slot.rune1");
  assert.equal(slotUsable(w, small, "rune1"), false, "an unlock never creates a slot the body lacks");
  assert.ok(actorSpeed(w, small) < actorSpeed(w, pl));
  assert.ok(harvestPower(small) < harvestPower(pl));
  assert.notDeepEqual(actorDef(small).body.box, actorDef(pl).body.box);
  assert.equal(w.flags.has("golem.arm"), false, "body state is not world state");
  addItems(w, small, "rune_swift", 1); addItems(w, small, "rune_glow", 1);
  assert.ok(applyWear(w, small, 0).ok);
  assert.ok(applyWear(w, small, 1).ok);
  assert.equal(small.gear.rune0, "rune_glow");
  assert.equal(countItem(small, "rune_swift"), 1);
});

test("a new body and capacity tier are data rows; NPC overflow is conserved", () => {
  const { w, pl, area } = workshop();
  ACTORS.porter = { ...ACTORS.npc_worker, inventory: { slots: 2, tiers: [{ slots: 4, requires: { worn: ["basket"] } }] } };
  try {
    const a = makeActor("porter", "porter", area.id, pl.x - 48, pl.y);
    w.actors.push(a);
    addItems(w, a, "basket", 1); assert.ok(applyWear(w, a, 0).ok);
    assert.equal(capacity(w, a), 4);
    addItems(w, a, "coin", 4);
    a.gear = {};
    reconcileCapacity(w, a);
    assert.equal(a.inventory.length, 2);
    assert.equal(countItem(a, "coin") + area.loose.filter((l) => !l.taken && l.item === "coin").reduce((n, l) => n + (l.n ?? 1), 0), 4);
  } finally { delete ACTORS.porter; }
});

test("body power accepts a low-tier core but refuses to power a higher-rank actor; gear core mount is separate", () => {
  const { w, pl } = workshop();
  const small = makeActor("small", "worker_golem", pl.area, pl.x + 12, pl.y);
  const guardian = actorById(w, "npc.guardian")!;
  w.actors.push(small);
  assert.equal(powered(small), false);
  assert.deepEqual(coreCheck(small, "ruby_core"), { accepts: true, sufficient: true });
  assert.deepEqual(coreCheck(guardian, "ruby_core"), { accepts: true, sufficient: false });
  assert.equal(coreCheck(small, "core").accepts, false, "the ritual's aether core is not body fuel");
  addItems(w, pl, "ruby_core", 2);
  assert.ok(insertPowerCore(w, pl, small, "ruby_core"));
  assert.ok(powered(small)); assert.deepEqual(small.gear, {});
  enterArea(w, pl, guardian.area, guardian.x, guardian.y + 15);
  assert.ok(insertPowerCore(w, pl, guardian, "ruby_core"), "insufficient is not incompatible");
  assert.equal(powered(guardian), false); assert.equal(actorSpeed(w, guardian), 0);
  assert.equal(guardian.powerCore, "ruby_core"); assert.equal(guardian.gear.core, undefined);
  assert.ok(removePowerCore(w, pl, guardian)); assert.equal(countItem(pl, "ruby_core"), 1);
  assert.equal(insertPowerCore(w, pl, small, "ruby_core"), false, "not remotely across areas");
  const loaded = deserialize(serialize(w));
  assert.equal(actorById(loaded, small.id)!.powerCore, "ruby_core");
});

test("core tiers and effects are data, and ineffective cores grant no effects", () => {
  const { w, pl } = workshop();
  const a = makeActor("powered", "worker_golem", pl.area, 40, 40);
  const old = POWER_CORES.ruby_core;
  try {
    POWER_CORES.ruby_core = { family: "golem", tier: 3, effects: { speed: 0.25, harvest: 1 } };
    a.powerCore = "ruby_core";
    assert.equal(actorSpeed(w, a), ACTORS.worker_golem.speed * 1.25);
    assert.equal(harvestPower(a), 1);
    const g = actorById(w, "npc.guardian")!;
    g.powerCore = "ruby_core"; assert.ok(powered(g));
    POWER_CORES.ruby_core = { family: "golem", tier: 1, effects: { harvest: 20 } };
    assert.equal(harvestPower(g), 0, "tier must be sufficient before effects apply");
    assert.equal(coreCheck(makeActor("human", "npc_worker", pl.area, 0, 0), "ruby_core").accepts, false);
  } finally { POWER_CORES.ruby_core = old; }
});

test("generic inventories transfer and stack atomically without layout or interactable cache churn", () => {
  const { w, pl, area, chest } = workshop();
  const ref = storageRef(area.id, chest.id), grid = navGrid(area, pl), inter = interactables(area);
  const layout = area.layoutRevision, interaction = area.interactionRevision, revision = area.revision;
  addItems(w, pl, "wood", 53);
  assert.equal(transferItems(w, packRef(pl), ref, "wood", 53), 53);
  assert.equal(chest.inventory!.length, 32);
  assert.deepEqual(chest.inventory!.slice(0, 3), [{ item: "wood", n: 20 }, { item: "wood", n: 20 }, { item: "wood", n: 13 }]);
  assert.equal(countItem(pl, "wood"), 0);
  assert.equal(navGrid(area, pl), grid); assert.equal(interactables(area), inter);
  assert.equal(area.layoutRevision, layout); assert.equal(area.interactionRevision, interaction);
  assert.ok(area.revision > revision && area.storageRevision > 0);
  assert.equal(transferItems(w, ref, ref, "wood", 10), 0);
  assert.equal(transferItems(w, ref, packRef(pl), "wood", -1), 0);
  const snapshot = inventoryHandle(w, ref)!;
  snapshot.inventory[0] = null;
  assert.equal(total(chest.inventory!, "wood"), 53, "reading gives an isolated snapshot");
  const w2 = deserialize(serialize(w));
  assert.deepEqual(serialize(w2), serialize(w), "authored storage diffs round-trip");
  area.setTile(1, 1, T.WALL);
  assert.notEqual(navGrid(area, pl), grid);
});

test("full storage gives a partial transfer, never deletes the remainder", () => {
  const { w, pl, area, chest } = workshop();
  area.setInventory(chest.id, Array.from({ length: 32 }, () => ({ item: "wood", n: 20 })));
  const slots = chest.inventory!.map((s) => s ? { ...s } : null); slots[31]!.n = 18;
  area.setInventory(chest.id, slots);
  addItems(w, pl, "wood", 10);
  assert.equal(transferItems(w, packRef(pl), storageRef(area.id, chest.id), "wood", 10), 2);
  assert.equal(countItem(pl, "wood"), 8); assert.equal(total(chest.inventory!, "wood"), 640);
  assert.throws(() => area.setInventory(chest.id, [{ item: "wood", n: 21 }]), /stack/);
});

test("storage deconstruction spills every non-critical stack and never makes looted dungeon chests salvageable", () => {
  const { w, pl, area } = workshop();
  const chest = area.addProp("storage_chest", pl.x - 24, pl.y, { recipe: "storage_chest", refund: [{ item: "planks", n: 4 }] });
  area.setInventory(chest.id, [{ item: "wood", n: 20 }, { item: "stone", n: 7 }]);
  applyDeconstruct(w, pl, area, chest.id);
  assert.equal(area.prop(chest.id), undefined); assert.equal(countItem(pl, "planks"), 4);
  assert.equal(area.loose.filter((l) => l.item === "wood").reduce((n, l) => n + (l.n ?? 1), 0), 20);
  const locked = area.addProp("storage_chest", pl.x - 24, pl.y, { recipe: "storage_chest" });
  area.setInventory(locked.id, [{ item: "chisel", n: 1 }]);
  const chk = deconstructCheck(w, pl, area, locked.id);
  assert.ok(!chk.ok && chk.reason === "holds");
  assert.equal(AUTHORED_SALVAGE.chest, undefined);
  assert.equal(salvageOf(getArea(w, "dungeon").prop("chest@57,4")!), null);
  assert.deepEqual(serialize(deserialize(serialize(w))), serialize(w), "built storage diff survives too");
});

test("crafting draws from pack plus storage within two station tiles, but the tool must be carried", () => {
  const { w, pl, area, bench, chest } = workshop();
  addItems(w, pl, "wood", 1);
  area.setInventory(chest.id, [{ item: "wood", n: 1 }, { item: "cut_stone", n: 2 }, { item: "chisel", n: 1 }]);
  assert.ok(orderCraft(w, pl, "crafting", "planks", bench.id)); tickTask(w, pl, 2);
  assert.equal(countItem(pl, "planks"), 3); assert.equal(total(chest.inventory!, "wood"), 0);
  assert.equal(orderCraft(w, pl, "crafting", "rune_swift", bench.id), false);
  addItems(w, pl, "chisel", 1);
  assert.ok(orderCraft(w, pl, "crafting", "rune_swift", bench.id)); tickTask(w, pl, 3);
  assert.equal(countItem(pl, "chisel"), 1); assert.equal(total(chest.inventory!, "chisel"), 1);
  assert.equal(countItem(pl, "rune_swift"), 1);
  const near = area.addProp("storage_chest", bench.x + 32, bench.y), far = area.addProp("storage_chest", bench.x + 48, bench.y);
  assert.ok(nearbyStorage(area, bench).includes(near)); assert.ok(!nearbyStorage(area, bench).includes(far));
  area.setInventory(far.id, [{ item: "wood", n: 20 }]);
  assert.equal(craftEntry(w, pl, CRAFT_RECIPES.find((r) => r.id === "planks")!, bench).status, "cost");
});

test("two crafters competing for one chest revalidate atomically at the fire point", () => {
  const { w, pl, area, bench, chest } = workshop();
  pl.x = 40; pl.y = 40;
  const a = makeActor("a", "npc_worker", area.id, bench.x - 12, bench.y + 16), b = makeActor("b", "npc_worker", area.id, bench.x + 12, bench.y + 16);
  w.actors.push(a, b);
  area.setInventory(chest.id, [{ item: "wood", n: 2 }]);
  assert.ok(orderCraft(w, a, "crafting", "planks", bench.id)); assert.ok(orderCraft(w, b, "crafting", "planks", bench.id));
  stepWorld(w, 2);
  assert.equal(countItem(a, "planks") + countItem(b, "planks"), 3);
  assert.equal(total(chest.inventory!, "wood"), 0);
  assert.equal(w.events.filter((e) => e.t === "crafted").length, 1);
});

test("duplicate ingredients and changed stations cannot partially consume materials", () => {
  const { w, pl, area, bench } = workshop();
  addItems(w, pl, "wood", 3);
  assert.equal(consumeInputs(craftSources(w, pl, bench), [{ item: "wood", n: 2 }, { item: "wood", n: 2 }]), false);
  assert.equal(countItem(pl, "wood"), 3);
  assert.ok(orderCraft(w, pl, "crafting", "planks", bench.id));
  pl.x = 32; pl.y = 32; tickTask(w, pl, 2);
  assert.equal(countItem(pl, "wood"), 3); assert.equal(countItem(pl, "planks"), 0);
  pl.x = bench.x; pl.y = bench.y + 14;
  assert.ok(orderCraft(w, pl, "crafting", "planks", bench.id));
  area.removeProp(bench.id); tickTask(w, pl, 2);
  assert.equal(countItem(pl, "wood"), 3);
});

test("inverse recipes preserve raw values and relic discovery; core carving carries its tool", () => {
  const { w, pl, area, bench } = workshop();
  const before = [rawValue("stone"), rawValue("cut_stone"), rawValue("planks")];
  assert.deepEqual(before, [1, 1.5, 2 / 3]);
  assert.deepEqual([rawValue("stone", [...CRAFT_RECIPES].reverse()), rawValue("cut_stone", [...CRAFT_RECIPES].reverse()), rawValue("planks", [...CRAFT_RECIPES].reverse())], before);
  addItems(w, pl, "crown", 1); assert.equal(relicCount(w, pl), 1);
  assert.ok(applyCraft(w, pl, area, "unmake_crown", bench.id));
  assert.equal(countItem(pl, "crown"), 0); assert.equal(countItem(pl, "large_ruby"), 1); assert.equal(relicCount(w, pl), 1);
  assert.equal(applyCraft(w, pl, area, "ruby_core", bench.id), false);
  addItems(w, pl, "chisel", 1);
  assert.ok(applyCraft(w, pl, area, "ruby_core", bench.id));
  assert.equal(countItem(pl, "ruby_core"), 1); assert.equal(countItem(pl, "chisel"), 1);
  addItems(w, pl, "rune_glow", 1); assert.ok(applyCraft(w, pl, area, "unmake_rune_glow", bench.id));
  assert.equal(countItem(pl, "stone"), 1);
  assert.equal(relicCount(deserialize(serialize(w)), player(deserialize(serialize(w)))), 1);
  assert.ok(CRAFT_RECIPES.filter((r) => r.mode === "deconstruct").every((r) => !r.tools));
});

test("weak, strong and mixed harvesters get exactly the same finite yield, including a fractional-work save", () => {
  for (const powers of [[1], [0.5], [0.25, 1.75], [10]]) {
    const w = createWorld(6), area = getArea(w, "debug_yard"), p = area.prop("tree.fixture")!;
    const pl = player(w); enterArea(w, pl, area.id, p.x, p.y + 12);
    ACTORS.harvester = { ...ACTORS.golem, harvestPower: powers[0] };
    pl.definition = "harvester";
    let hits = 0;
    while (!p.taken && hits < 100) {
      ACTORS.harvester.harvestPower = powers[hits % powers.length];
      applyEffect(w, pl, { op: "harvest" }, { kind: "harvest", x: p.x, y: p.y, propId: p.id });
      if (++hits === 1) assert.deepEqual(serialize(deserialize(serialize(w))), serialize(w));
    }
    assert.equal(p.dmg, 4); assert.equal(countItem(pl, "wood"), 6);
    applyEffect(w, pl, { op: "harvest" }, { kind: "harvest", x: p.x, y: p.y, propId: p.id });
    assert.equal(countItem(pl, "wood"), 6);
    if (powers[0] === 0.5) assert.equal(hits, 8);
    delete ACTORS.harvester;
  }
});

test("removing storage between craft start and completion leaves every input intact", () => {
  const { w, pl, area, bench, chest } = workshop();
  addItems(w, pl, "wood", 1); area.setInventory(chest.id, [{ item: "wood", n: 1 }]);
  assert.ok(orderCraft(w, pl, "crafting", "planks", bench.id));
  area.removeProp(chest.id); tickTask(w, pl, 2);
  assert.equal(countItem(pl, "wood"), 1); assert.equal(countItem(pl, "planks"), 0);
  removeItems(pl, "wood");
});