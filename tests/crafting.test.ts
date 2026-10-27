// Crafting (planks, cut stone, rune carving) and the rebalanced build catalog:
// the craft task and effect, tools carried but not consumed, re-validation,
// overflow to the ground, any actor crafting, saves mid-work, the recipe data,
// and the v8 -> v9 migration of pending build work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { player, currentArea, setFlag, enterArea, makeActor, type World } from "../src/game/world/world";
import { serialize, deserialize, migrate, SAVE_VERSION } from "../src/game/world/save";
import { addItems, countItem, capacity } from "../src/game/sim/inventory";
import { enqueueTask } from "../src/game/sim/tasks";
import { orderBuild } from "../src/game/sim/commands";
import { craftEntries, orderCraft, craftLocked, craftReason } from "../src/game/sim/crafting";
import { catalogEntries, queryCatalog, sortEntries, matchesSearch, entryReason } from "../src/game/sim/catalog";
import { CRAFT_RECIPES, STATION_REQUIRES, rawValue } from "../src/game/content/crafting";
import { RECIPES, costTotal } from "../src/game/content/build";
import { ITEMS, ITEM_NAMES } from "../src/game/content/items";
import { FLAGS } from "../src/game/content/flags";
import { FONT_GLYPHS } from "../src/game/font";
import { CraftingUi } from "../src/game/screens/crafting";
import { ScreenStack } from "../src/game/ui/screens";
import { TS, T } from "../src/game/content/tiles";
import { newWorld, frame, frames, events, useOn, propItem } from "./helpers";

const finish = (w: World) => { let g = 0; while (player(w).task && g++ < 600) frame(w); };
const know = (w: World) => setFlag(w, FLAGS.knowBuild);
const BENCH = "workbench@13.5,37";
const loose = (w: World, item: string) => currentArea(w).loose.filter((l) => !l.taken && l.item === item).reduce((s, l) => s + (l.n ?? 1), 0);
/** The golem beside the dungeon's workbench with the chisel taken (it is a bench from then on). */
function atBench() {
  const w = newWorld(); frame(w);
  useOn(w, propItem(w, BENCH));
  know(w);
  const pl = player(w), bench = currentArea(w).prop(BENCH)!;
  pl.x = bench.x; pl.y = bench.y + 12; pl.facing = "up";
  return { w, pl, bench };
}

test("crafting data: planks and cut stone from raw materials, two runes carved from cut stone with the chisel as a tool", () => {
  const by = Object.fromEntries(CRAFT_RECIPES.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(by).sort(), ["cut_stone", "planks", "rune_glow", "rune_swift"]);
  assert.deepEqual(by.planks.inputs.map((c) => c.item), ["wood"]); assert.equal(by.planks.output.item, "planks");
  assert.deepEqual(by.cut_stone.inputs.map((c) => c.item), ["stone"]); assert.equal(by.cut_stone.output.item, "cut_stone");
  for (const id of ["rune_swift", "rune_glow"]) {
    assert.deepEqual(by[id].inputs.map((c) => c.item), ["cut_stone"], id);
    assert.deepEqual(by[id].tools, ["chisel"], id);
    assert.equal(by[id].output.item, id);
  }
  const ok = (s: string) => [...s].every((ch) => FONT_GLYPHS.has(ch));
  for (const r of CRAFT_RECIPES) {
    assert.ok(ok(r.name) && r.desc.length <= 3 && r.desc.every((l) => ok(l) && l.length <= 30), r.id);
    assert.ok(ITEMS[r.output.item] && r.inputs.every((c) => ITEMS[c.item]), r.id);
    // The existing building knowledge unlocks every craft: no new flag, no recipe-level gate.
    assert.equal(r.requires, undefined, r.id);
  }
  assert.deepEqual(STATION_REQUIRES.crafting, { flags: [FLAGS.knowBuild] });
  // new items: stack sizes, art names, effects only on runes
  assert.ok(ITEMS.planks.stack! > 1 && ITEMS.cut_stone.stack! > 1 && ITEMS.rune_swift.stack === undefined);
  assert.ok(ITEM_NAMES.planks === "PLANKS" && ITEM_NAMES.cut_stone === "CUT STONE");
});

test("the craft task consumes the inputs when it fires and gives the output; the chisel is carried, never used up", () => {
  const { w, pl, bench } = atBench();
  addItems(w, pl, "wood", 5);
  events(w);
  assert.equal(orderCraft(w, pl, "crafting", "planks", bench.id), true);
  assert.equal(pl.task!.kind, "craft");
  assert.equal(countItem(pl, "wood"), 5, "nothing happens until the task fires");
  finish(w);
  assert.equal(countItem(pl, "wood"), 3); assert.equal(countItem(pl, "planks"), 3);
  assert.ok(events(w).some((e) => e.t === "crafted" && e.item === "planks" && e.n === 3));
  // stone -> cut stone -> a rune, with the chisel along
  addItems(w, pl, "stone", 6);
  assert.equal(orderCraft(w, pl, "crafting", "cut_stone", bench.id), true); finish(w);
  assert.equal(countItem(pl, "stone"), 3); assert.equal(countItem(pl, "cut_stone"), 2);
  assert.equal(orderCraft(w, pl, "crafting", "rune_swift", bench.id), true); finish(w);
  assert.equal(countItem(pl, "cut_stone"), 0); assert.equal(countItem(pl, "rune_swift"), 1);
  assert.equal(countItem(pl, "chisel"), 1, "the tool is not consumed");
});

test("status and refusals: unknown craft, missing tool, missing materials; a refusal changes nothing and says why", () => {
  const w = newWorld(); frame(w);
  const pl = player(w);
  assert.ok(craftLocked(w, pl, "crafting"));
  events(w);
  assert.equal(orderCraft(w, pl, "crafting", "planks"), false);
  assert.ok(events(w).some((e) => e.t === "message" && e.text.includes("CRAFT")));
  know(w);
  addItems(w, pl, "cut_stone", 3);
  const swift = craftEntries(w, pl, "crafting").find((e) => e.recipe.id === "rune_swift")!;
  assert.equal(swift.status, "tools");
  assert.equal(craftReason(swift), "NEED THE RUNE CHISEL");
  const before = JSON.stringify(pl.inventory);
  events(w);
  assert.equal(orderCraft(w, pl, "crafting", "rune_swift"), false);
  assert.deepEqual(events(w), [{ t: "message", text: "NEED THE RUNE CHISEL" }]);
  assert.equal(JSON.stringify(pl.inventory), before);
  assert.equal(pl.task, null);
  assert.equal(craftEntries(w, pl, "crafting").find((e) => e.recipe.id === "planks")!.status, "cost");
  addItems(w, pl, "chisel", 1);
  assert.equal(craftEntries(w, pl, "crafting").find((e) => e.recipe.id === "rune_swift")!.status, "ok");
});

test("the effect re-validates when it fires: spent materials, a dropped tool or a taken-apart bench change nothing", () => {
  const { w, pl, bench } = atBench();
  addItems(w, pl, "wood", 2);
  assert.equal(orderCraft(w, pl, "crafting", "planks", bench.id), true);
  pl.inventory.forEach((s, i) => { if (s?.item === "wood") pl.inventory[i] = null; });
  events(w); finish(w);
  assert.equal(countItem(pl, "planks"), 0);
  assert.ok(events(w).some((e) => e.t === "message" && e.text === "NOT ENOUGH MATERIALS"));
  // the bench goes before the work completes
  addItems(w, pl, "wood", 2);
  assert.equal(orderCraft(w, pl, "crafting", "planks", bench.id), true);
  currentArea(w).removeProp(bench.id);
  events(w); finish(w);
  assert.equal(countItem(pl, "wood"), 2, "the wood is still there"); assert.equal(countItem(pl, "planks"), 0);
  assert.ok(events(w).some((e) => e.t === "message" && e.text.includes("BENCH")));
  // the chisel is gone from the pack when a rune is about to be carved
  const w2 = newWorld(); frame(w2); know(w2);
  const p2 = player(w2);
  addItems(w2, p2, "cut_stone", 2); addItems(w2, p2, "chisel", 1);
  assert.equal(orderCraft(w2, p2, "crafting", "rune_swift"), true);
  p2.inventory.forEach((s, i) => { if (s?.item === "chisel") p2.inventory[i] = null; });
  finish(w2);
  assert.equal(countItem(p2, "rune_swift"), 0); assert.equal(countItem(p2, "cut_stone"), 2);
});

test("overflow lands on the ground like any pickup; nothing is deleted", () => {
  const { w, pl, bench } = atBench();
  // the pack is full and the wood stack survives the crafting, so there is no room for the planks
  pl.inventory = pl.inventory.map(() => ({ item: "coin", n: 1 }));
  pl.inventory[0] = { item: "wood", n: 5 };
  events(w);
  assert.equal(orderCraft(w, pl, "crafting", "planks", bench.id), true); finish(w);
  assert.equal(countItem(pl, "wood"), 3);
  assert.equal(countItem(pl, "planks"), 0);
  assert.equal(loose(w, "planks"), 3, "the output is on the ground beside the golem");
  assert.ok(events(w).some((e) => e.t === "itemDropped" && e.item === "planks" && e.reason === "full"));
  assert.equal(pl.inventory.length, capacity(w, pl));
});

test("any actor can craft through its task queue, and a craft saved mid-work finishes after loading", () => {
  const w = newWorld(); frame(w); know(w);
  const helper = makeActor("helper", "fixture", "dungeon", 100, 100);
  w.actors.push(helper);
  helper.inventory = new Array(8).fill(null);
  addItems(w, helper, "wood", 4);
  enqueueTask(helper, { kind: "craft", dur: 1, effect: { op: "craft", recipe: "planks" } }, { kind: "craft", x: 100, y: 100 });
  frames(w, 90);
  assert.equal(countItem(helper, "planks"), 3); assert.equal(countItem(helper, "wood"), 2);
  // the player saves mid-craft
  const pl = player(w);
  addItems(w, pl, "wood", 2);
  assert.equal(orderCraft(w, pl, "crafting", "planks"), true);
  frames(w, 20);
  assert.ok(pl.task && !pl.task.fired);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.deepEqual(serialize(w2), serialize(w));
  finish(w2);
  assert.equal(countItem(player(w2), "planks"), 3);
});

test("the crafting screen: CRAFT closes it so the golem can work, and it comes back when the work is done", () => {
  const { w, pl, bench } = atBench();
  addItems(w, pl, "wood", 4);
  const ctx = (globalThis as any).document.createElement("canvas").getContext("2d");
  const keys: string[] = [];
  const host: any = {
    ctx, wctx: ctx, world: w, get pl() { return player(w); }, get area() { return currentArea(w); },
    t: 0.1, cam: { x: 0, y: 0 }, vw: 320, vh: 180, screens: new ScreenStack(), typed: [],
    sfx: new Proxy({}, { get: () => () => {} }), hit: (...k: string[]) => k.some((x) => keys.includes(x)),
    say: () => {}, renderNote: () => {}, drainEvents: () => { w.events = []; },
  };
  host.screens.set({ id: "play", opaque: true, t: 0, update() {}, render() {} });
  const ui = new CraftingUi(host);
  ui.open("crafting", bench.id);
  const tap = (...k: string[]) => { keys.splice(0, keys.length, ...k); host.screens.update(1 / 60); keys.length = 0; };
  tap("e"); assert.equal(ui.focus, "button");
  tap("e");
  assert.ok(host.screens.is("play"), "the screen steps aside while the golem works");
  assert.ok(ui.pending && pl.task!.kind === "craft");
  finish(w);
  ui.resume();
  assert.ok(host.screens.is("crafting") && !ui.pending);
  assert.equal(countItem(pl, "planks"), 3);
  ui.screen.render();
});

// ------------------------------------------------------------------ the rebalanced catalog
test("build costs: rough builds stay raw, finer ones use crafted materials, and the bench itself stays raw", () => {
  const crafted = new Set(CRAFT_RECIPES.map((r) => r.output.item));
  const usesCrafted = (id: string) => RECIPES[id].cost.some((c) => crafted.has(c.item));
  for (const id of ["torch_post", "craftbench", "barricade"]) assert.ok(!usesCrafted(id), `${id} is a rough build: raw only`);
  for (const id of ["table", "chair", "wall_banner", "wall_torch", "brazier"]) assert.ok(usesCrafted(id), `${id} uses crafted materials`);
  // replaced outright (furniture) and mixed raw + crafted (the lights)
  assert.deepEqual(RECIPES.table.cost, [{ item: "planks", n: 4 }]);
  assert.deepEqual(RECIPES.chair.cost, [{ item: "planks", n: 2 }]);
  assert.deepEqual(RECIPES.wall_torch.cost, [{ item: "cut_stone", n: 1 }, { item: "wood", n: 1 }]);
  assert.deepEqual(RECIPES.brazier.cost, [{ item: "cut_stone", n: 4 }, { item: "wood", n: 2 }]);
  // Planks come from a bench, so a bench that needed them could never be built (and a taken-apart one could never be rebuilt).
  assert.ok(RECIPES.craftbench.cost.every((c) => !crafted.has(c.item)));
});

test("build menu: cost lines, the can-build filter and the cost sort handle crafted materials", () => {
  const w = newWorld(); frame(w); know(w); setFlag(w, FLAGS.knowMasonry);
  const pl = player(w);
  addItems(w, pl, "planks", 2);
  const list = catalogEntries(w, pl);
  const table = list.find((e) => e.id === "table")!, chair = list.find((e) => e.id === "chair")!;
  assert.deepEqual(table.lines, [{ item: "planks", need: 4, have: 2 }]);
  assert.equal(table.status, "cost"); assert.equal(entryReason(table), "NEED 2 PLANKS MORE");
  assert.equal(chair.status, "ok");
  const q = { tab: "all", search: "", sort: "category" as const, affordableOnly: true, favorites: new Set<string>() };
  assert.deepEqual(queryCatalog(list, q).map((e) => e.id), ["chair"]);
  addItems(w, pl, "wood", 3);
  assert.deepEqual(queryCatalog(catalogEntries(w, pl), q).map((e) => e.id).sort(), ["barricade", "chair"]);
  // search finds buildables by crafted material names
  const hits = (s: string) => list.filter((e) => matchesSearch(e, s)).map((e) => e.id).sort();
  assert.deepEqual(hits("planks"), ["chair", "table", "wall_banner"]);
  assert.deepEqual(hits("cut stone"), ["brazier", "wall_banner", "wall_torch"]);
  // the cost sort weighs a crafted unit by what it costs to make (planks 2/3 of a wood, cut stone 1.5 stone)
  assert.equal(rawValue("planks"), 2 / 3); assert.equal(rawValue("cut_stone"), 1.5); assert.equal(rawValue("wood"), 1);
  assert.equal(costTotal(RECIPES.chair), 1.33); assert.equal(costTotal(RECIPES.table), 2.67);
  const byCost = sortEntries(list, "cost").map((e) => costTotal(e.recipe));
  assert.deepEqual(byCost, [...byCost].sort((a, b) => a - b));
  assert.equal(sortEntries(list, "cost")[0].id, "chair");
});

test("building with crafted materials consumes them and records what the prop cost", () => {
  const w = newWorld(); frame(w); know(w);
  const pl = player(w);
  pl.gear.back = "basket";
  addItems(w, pl, "planks", 6); addItems(w, pl, "wood", 1);
  enterArea(w, pl, "surface", 20 * TS + 8, 50 * TS + 14);
  const a = currentArea(w);
  for (let ty = 46; ty <= 54; ty++) for (let tx = 16; tx <= 24; tx++) a.setTile(tx, ty, T.FLOOR);
  for (const p of [...a.props]) if (Math.abs(p.x - pl.x) < 96 && Math.abs(p.y - pl.y) < 96) a.removeProp(p.id);
  assert.ok(orderBuild(w, pl, "table", 20, 52)); finish(w);
  assert.equal(countItem(pl, "planks"), 2);
  const t = a.props.find((p) => p.kind === "table")!;
  assert.deepEqual(t.refund, [{ item: "planks", n: 4 }]);
  assert.deepEqual(serialize(w).areas.surface.propsAdded.find((p) => p.id === t.id)!.refund, [{ item: "planks", n: 4 }]);
});

// ------------------------------------------------------------------ save v9
test("v8 -> v9: pending build work for a rebalanced recipe is dropped (nothing was consumed); unchanged recipes keep theirs", () => {
  const w = newWorld(); frame(w);
  const s: any = serialize(w);
  s.version = 8;
  const task = (recipe: string) => ({ kind: "reach", dur: 1, t: 0.1, fired: false, effect: { op: "build", recipe, tx: 3, ty: 4 }, area: "dungeon" });
  s.actors[0].task = task("table");
  s.actors[0].queue = [task("torch_post"), task("wall_banner"), task("craftbench")];
  const m: any = migrate(s);
  assert.equal(m.version, SAVE_VERSION); assert.equal(SAVE_VERSION, 11); // v11: the inner monologue
  assert.equal(m.actors[0].task, null);
  assert.deepEqual(m.actors[0].queue.map((t: any) => t.effect.recipe), ["torch_post", "craftbench"]);
  // the migrated save loads, and nothing the golem carries changed
  const w2 = deserialize(s);
  assert.deepEqual(player(w2).inventory, player(w).inventory);
});
