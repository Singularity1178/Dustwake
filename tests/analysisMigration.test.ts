import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES } from "../src/game/content/build";
import { FLAGS } from "../src/game/content/flags";
import { ITEMS } from "../src/game/content/items";
import { HIGHLIGHT_RULES } from "../src/game/content/vision";
import { actorById, createWorld, enterArea, getArea, makeActor, player, setFlag } from "../src/game/world/world";
import { SAVE_VERSION, deserialize, serialize, migrate, saveToStorage, loadFromStorage } from "../src/game/world/save";
import { registerFoundations } from "../src/game/sim/debugFoundations";
import { classifyHighlight, visionTargets } from "../src/game/sim/analysis";
import { applyEffect, tickTask } from "../src/game/sim/tasks";
import { capacity, addItems, countItem } from "../src/game/sim/inventory";
import { stepPlayer, stepWorld } from "../src/game/sim/step";
import { canBuild } from "../src/game/sim/build";
import { entryFor } from "../src/game/sim/catalog";
import { interact, interactables, npcInteractables } from "../src/game/sim/interact";
import { slotUsable } from "../src/game/sim/gear";
import { relicCount } from "../src/game/sim/discovery";

registerFoundations();
function scanWorld() {
  const w = createWorld(12), area = getArea(w, "debug_workshop"), pl = player(w), chest = area.prop("chest.fixture")!;
  enterArea(w, pl, area.id, chest.x, chest.y + 11); pl.facing = "up";
  setFlag(w, FLAGS.knowBuild); addItems(w, pl, "planks", 8);
  return { w, pl, area, chest };
}

test("input toggles sim scan mode; using a storage prop analyzes instead of opening it", () => {
  const { w, pl, area, chest } = scanWorld();
  assert.deepEqual(canBuild(w, pl, "storage_chest"), { ok: false, reason: "unknown" });
  assert.equal(entryFor(w, pl, "storage_chest")!.status, "unknown");
  const result = stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true });
  assert.equal(result.target?.propId, chest.id); assert.equal(pl.mode, "scan"); assert.equal(pl.task?.kind, "scan");
  assert.equal(w.flags.has("analysis.storage_chest"), false);
  tickTask(w, pl, 1);
  assert.ok(w.flags.has("analysis.storage_chest"));
  assert.deepEqual(canBuild(w, pl, "storage_chest"), { ok: true });
  assert.ok(w.events.some((e) => e.t === "analyzed"));
  assert.ok(!w.events.some((e) => e.t === "openStorage"));
  stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true }); tickTask(w, pl, 1);
  assert.equal(pl.mode, "normal"); assert.ok(w.events.some((e) => e.t === "openStorage"));
  assert.equal(area.storageRevision, 0, "scanning does not touch contents");
});

test("buildable furniture is a scan-only target, and analysis gating is an optional data row", () => {
  const { w, pl, area } = scanWorld();
  const table = area.addProp("table", 80, 80);
  assert.ok(!interactables(area).some((i) => i.propId === table.id), "not a normal interactable");
  pl.x = table.x; pl.y = table.y + 12; pl.facing = "up";
  const old = RECIPES.table.analysis;
  RECIPES.table.analysis = "table";
  try {
    assert.equal(entryFor(w, pl, "table")!.status, "unknown");
    const normal = stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true });
    assert.equal(normal.target, null, "outside scan mode the table is not a target");
    assert.equal(Boolean(pl.task), false);
    assert.equal(w.flags.has("analysis.table"), false, "normal interaction never analyzes");
    stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true });
    assert.equal(pl.task?.kind, "scan");
    tickTask(w, pl, 1);
    assert.equal(entryFor(w, pl, "table")!.status, "ok");
    assert.deepEqual(canBuild(w, pl, "torch_post"), { ok: false, reason: "cost" }, "a recipe without an analysis key needs only knowledge/materials");
  } finally {
    if (old) RECIPES.table.analysis = old; else delete RECIPES.table.analysis;
  }
});

test("scan at an occupied workbench never steals its chisel; normal mode still picks up first", () => {
  const w = createWorld(14), area = getArea(w, "dungeon"), pl = player(w), p = area.prop("workbench@13.5,37")!;
  pl.x = p.x; pl.y = p.y + 12; pl.facing = "up";
  stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true }); tickTask(w, pl, 1);
  assert.equal(p.taken, false); assert.equal(countItem(pl, "chisel"), 0); assert.ok(w.flags.has("analysis.craftbench"));
  stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true }); tickTask(w, pl, 1);
  assert.ok(p.taken); assert.equal(countItem(pl, "chisel"), 1);
});

test("scan work is saved, fires once, and revalidates a missing or distant prop", () => {
  const { w, pl, area, chest } = scanWorld();
  stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true }); tickTask(w, pl, 0.3);
  const loaded = deserialize(serialize(w));
  assert.equal(player(loaded).mode, "scan"); assert.equal(player(loaded).task!.kind, "scan");
  tickTask(loaded, player(loaded), 1); tickTask(loaded, player(loaded), 1);
  assert.equal(loaded.events.filter((e) => e.t === "analyzed").length, 1);
  area.removeProp(chest.id); tickTask(w, pl, 1);
  assert.equal(w.flags.has("analysis.storage_chest"), false);
  const second = scanWorld();
  stepPlayer(second.w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true }); second.pl.x = 32;
  tickTask(second.w, second.pl, 1);
  assert.equal(second.w.flags.has("analysis.storage_chest"), false);
});

test("highlight classification is data-driven with important items, interactables, NPCs and buildables", () => {
  for (const item of ["arm", "book_build", "crown", "rune_swift", "glyph0", "core"] as const) assert.equal(classifyHighlight({ item, buildable: true }), "important");
  assert.equal(classifyHighlight({ item: "wood", interactable: true }), "interactable");
  assert.equal(classifyHighlight({ actor: true }), "npc");
  assert.equal(classifyHighlight({ buildable: true, interactable: true }), "buildable");
  assert.equal(classifyHighlight({}), null);
  const { w, area, pl, chest } = scanWorld();
  const a = makeActor("small", "worker_golem", area.id, pl.x - 60, pl.y); w.actors.push(a);
  const targets = visionTargets(w, area);
  assert.equal(targets.find((t) => t.id === a.id)!.category, "npc");
  assert.equal(targets.find((t) => t.id === chest.id)!.category, "buildable");
  const old = HIGHLIGHT_RULES.length;
  HIGHLIGHT_RULES.unshift({ category: "important", tags: ["material"] });
  assert.equal(classifyHighlight({ item: "wood" }), "important");
  HIGHLIGHT_RULES.shift(); assert.equal(HIGHLIGHT_RULES.length, old);
  assert.ok(ITEMS.ruby_core && ITEMS.large_ruby);
});

test("interacting with a worker asks for actor management, not a player-only dialogue", () => {
  const { w, area, pl } = scanWorld();
  const a = makeActor("small", "worker_golem", area.id, pl.x - 40, pl.y); w.actors.push(a);
  const it = npcInteractables(w, area).find((i) => i.actorId === a.id)!;
  assert.equal(it.kind, "worker");
  pl.x = a.x; pl.y = a.y + 12;
  interact(w, pl, area, it); tickTask(w, pl, 1);
  assert.ok(w.events.some((e) => e.t === "manageActor" && e.target === a.id));
  assert.ok(!w.events.some((e) => e.t === "dialogue"));
});

/** Actual v9 actor shape: none of v10's fields sneak into this fixture. */
function oldSave(knowledge: boolean) {
  const s: any = serialize(createWorld(19));
  s.version = 9;
  s.flags = ["golem.arm", "golem.slot.rune1", "golem.eye", ...(knowledge ? ["know.build"] : [])];
  for (const a of s.actors) for (const key of ["definition", "upgrades", "powerCore", "mode", "job", "jobSeq"]) delete a[key];
  s.actors[0].gear = { back: "basket", rune1: "rune_swift" };
  s.actors[0].inventory = [{ item: "wood", n: 12 }, ...Array.from({ length: 47 }, () => null)];
  s.areas.dungeon.looseTaken.push("crown");
  return s;
}

test("v9 migrates body flags onto only the player, preserves gear and grants only frozen legacy analyses", () => {
  const raw = oldSave(true), original = JSON.stringify(raw), w = deserialize(raw), pl = player(w), guardian = actorById(w, "npc.guardian")!;
  assert.equal(SAVE_VERSION, 11); assert.equal(serialize(w).version, 11); // v11: the inner monologue
  assert.equal(JSON.stringify(raw), original, "migrating never mutates the caller's JSON");
  assert.equal(pl.definition, "golem"); assert.equal(guardian.definition, "guardian");
  assert.deepEqual(pl.upgrades, ["golem.arm", "golem.slot.rune1"]); assert.deepEqual(guardian.upgrades, []);
  assert.equal(capacity(w, pl), 48); assert.equal(capacity(w, guardian), 0);
  assert.ok(slotUsable(w, pl, "rune1")); assert.ok(!slotUsable(w, guardian, "rune1"));
  assert.equal(pl.gear.rune1, "rune_swift"); assert.equal(countItem(pl, "wood"), 12);
  assert.equal(pl.mode, "normal"); assert.equal(pl.powerCore, null); assert.equal(pl.job, null); assert.equal(pl.jobSeq, 0);
  for (const id of ["wall_torch", "brazier", "craftbench", "table", "chair", "wall_banner"]) assert.ok(w.flags.has(`analysis.${id}`));
  assert.equal(w.flags.has("analysis.storage_chest"), false, "new content is not accidentally grandfathered");
  assert.ok(w.flags.has("golem.eye"), "story eye repair stays progression");
  assert.equal(w.flags.has("golem.arm"), false);
  assert.equal(relicCount(w, pl), 1, "a discovered but no longer carried crown keeps credit");
  stepWorld(w, 0.05);
  assert.deepEqual(serialize(deserialize(serialize(w))), serialize(w));
});

test("old players who knew building remain able to build when a legacy row opts into analysis", () => {
  const old = RECIPES.table.analysis; RECIPES.table.analysis = "table";
  try {
    const w = deserialize(oldSave(true)), pl = player(w); addItems(w, pl, "planks", 4);
    assert.ok(canBuild(w, pl, "table").ok);
    const unlearned = deserialize(oldSave(false)); setFlag(unlearned, "know.build"); addItems(unlearned, player(unlearned), "planks", 4);
    assert.deepEqual(canBuild(unlearned, player(unlearned), "table"), { ok: false, reason: "unknown" });
  } finally { if (old) RECIPES.table.analysis = old; else delete RECIPES.table.analysis; }
});

test("v1 saves migrate through the whole chain, including gear, NPCs and actor upgrades", () => {
  const s = oldSave(true); s.version = 1; s.flags.push("golem.basket");
  s.actors = s.actors.filter((a: any) => a.kind !== "npc");
  s.actors[0].inventory = ["chisel", "wood", "wood", "crown"];
  delete s.actors[0].gear;
  const w = deserialize(s), pl = player(w);
  assert.equal(countItem(pl, "wood"), 2); assert.equal(pl.gear.back, "basket");
  assert.ok(pl.upgrades.includes("golem.arm")); assert.equal(capacity(w, pl), 48);
  assert.ok(actorById(w, "npc.guardian")); assert.equal(relicCount(w, pl), 1);
  assert.equal(w.flags.has("golem.basket"), false);
});

test("legacy in-flight harvest keeps its work and remaining yield after migration", () => {
  const { w, pl } = scanWorld(), yard = getArea(w, "debug_yard"), tree = yard.prop("tree.fixture")!;
  enterArea(w, pl, yard.id, tree.x, tree.y + 12);
  yard.damageProp(tree.id, 2); addItems(w, pl, "wood", 2);
  const s: any = serialize(w); s.version = 9;
  for (const a of s.actors) for (const key of ["definition", "upgrades", "powerCore", "mode", "job", "jobSeq"]) delete a[key];
  s.actors[0].task = { kind: "punch", dur: 0.75, t: 0.2, fired: false, area: yard.id, effect: { op: "harvest" }, target: { kind: "harvest", propId: tree.id, x: tree.x, y: tree.y } };
  const loaded = deserialize(s), a = player(loaded), area = getArea(loaded, yard.id);
  tickTask(loaded, a, 1);
  assert.equal(area.prop(tree.id)!.dmg, 3); assert.equal(countItem(a, "wood"), 3);
  applyEffect(loaded, a, { op: "harvest" }, { kind: "harvest", propId: tree.id, x: tree.x, y: tree.y });
  assert.equal(countItem(a, "wood"), 6);
});

test("save persistence is injected, DOM-free, and rejects unknown future versions", () => {
  const w = createWorld(12), values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(loadFromStorage(storage), null); saveToStorage(w, storage);
  assert.deepEqual(serialize(loadFromStorage(storage)!), serialize(w));
  assert.throws(() => migrate({ ...serialize(w), version: SAVE_VERSION + 1 }), /newer/);
});