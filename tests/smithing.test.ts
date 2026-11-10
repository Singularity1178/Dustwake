// Iron, tools and the two new stations: ore on the surface, the smelter, the
// anvil's four jobs, tool heads on the arm slots, hafted tools for workers,
// and the rooms they stand in. Headless, through the same sim entry points the
// play screen uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, setFlag, clearFlag, hasFlag, getArea, enterArea, actorById, type World } from "../src/game/world/world";
import { FLAGS } from "../src/game/content/flags";
import { ITEMS, ITEM_IDS, effectLines, type ItemId } from "../src/game/content/items";
import { ITEM_ART } from "../src/game/art/items";
import { PROP_ART } from "../src/game/art/props";
import { PROPS, propDef } from "../src/game/content/props";
import { HARVEST } from "../src/game/content/harvest";
import { RECIPES } from "../src/game/content/build";
import { CRAFT_RECIPES, STATIONS, STATION_IDS, STATION_REQUIRES, craftRecipesFor, rawValue } from "../src/game/content/crafting";
import { TOOL_TYPE_IDS, TOOL_RUNES, FORGE_COST, headId, rustedHeadId, fineHeadId, runedHeadId, fullToolId, fineToolId } from "../src/game/content/tools";
import { RUNE_GLOW_LIGHT, RUNE_SWIFT_SPEED_BONUS } from "../src/game/content/gear";
import { FONT_GLYPHS } from "../src/game/font";
import { analysisFlag } from "../src/game/content/vision";
import { addItems, countItem } from "../src/game/sim/inventory";
import { craftList, craftLocked, orderCraft, craftLockedText } from "../src/game/sim/crafting";
import { wearFromSlot, takeOffGear } from "../src/game/sim/commands";
import { slotUsable, speedMultiplier, golemGlow } from "../src/game/sim/gear";
import { toolBonus } from "../src/game/sim/tools";
import { harvestStep } from "../src/game/sim/harvesting";
import { stepPlayer } from "../src/game/sim/step";
import { tickTask } from "../src/game/sim/tasks";
import { buildDungeon, TS } from "../src/game/map";
import { buildSurface, IRON_VEINS } from "../src/game/surface";
import { TOWN_ID, ESTABLISHMENTS, interiorId } from "../src/game/content/town";
import { AREAS } from "../src/game/world/areas";
import { SURFACE_GATE_ZONE } from "../src/game/content/geography";
import { newWorld, frame, frames, events, find, useOn, slamAt, propItem } from "./helpers";

const TOWN_AREAS = [TOWN_ID, ...ESTABLISHMENTS.map(interiorId)];
const FORGE = "forge@5.5,37", ANVIL = "anvil@6,40", BENCH = "workbench@13.5,37";
const slotOf = (w: World, id: ItemId) => player(w).inventory.findIndex((s) => s?.item === id);
const wear = (w: World, id: ItemId) => wearFromSlot(w, player(w), slotOf(w, id));
const text = (s: string) => [...s].every((ch) => FONT_GLYPHS.has(ch));
/** Stand at a station, open it with E, and return its prop id. */
function openStation(w: World, propId: string) {
  events(w);
  useOn(w, find(w, (i) => i.kind === "station" && i.propId === propId));
  return events(w).find((e) => e.t === "openStation");
}
/** Press the station's action button for a row and let the golem finish the work. */
function make(w: World, station: string, propId: string, recipe: string) {
  const pl = player(w);
  const ok = orderCraft(w, pl, station, recipe, propId);
  let guard = 0;
  while (pl.task && guard++ < 2000) frame(w);
  frames(w, 5);
  return ok;
}

// ------------------------------------------------------------------ data
test("tool rows: three types; a head plain, rusted, fine and with either rune set in it; a hafted tool plain and fine; all named, described and drawn", () => {
  assert.deepEqual([...TOOL_TYPE_IDS], ["shovel", "pickaxe", "axe"]);
  for (const t of TOOL_TYPE_IDS) {
    const head = ITEMS[headId(t)], fine = ITEMS[fineHeadId(t)], rusted = ITEMS[rustedHeadId(t)], full = ITEMS[fullToolId(t)], fineFull = ITEMS[fineToolId(t)];
    assert.deepEqual(head.wear, { kind: "arm" }, `${t}: a head is gear for an arm slot`);
    assert.deepEqual(head.tool, { type: t, form: "head", bonus: 1 });
    assert.equal(fine.tool!.bonus, 2); assert.deepEqual(fine.wear, { kind: "arm" });
    assert.ok(!rusted.tool && !rusted.wear, `${t}: a rusted head does nothing until it is repaired`);
    assert.ok(!full.wear && full.tool!.form === "full" && fineFull.tool!.bonus > full.tool!.bonus, `${t}: a hafted tool is for hands, not for an arm slot`);
    for (const r of TOOL_RUNES) {
      const set = ITEMS[runedHeadId(t, r)];
      assert.equal(set.tool!.bonus, fine.tool!.bonus, "a rune only goes into a tempered head");
      assert.ok(set.worn && !set.worn.mark, "it carries the rune's effect; the sigil is drawn for rune slots only");
    }
    assert.equal(ITEMS[runedHeadId(t, "swift")].worn!.speed, RUNE_SWIFT_SPEED_BONUS);
    assert.equal(ITEMS[runedHeadId(t, "glow")].worn!.light, RUNE_GLOW_LIGHT);
  }
  // the pack's limits: a name of at most 20, up to three lines of 34 counting the generated effect lines, font glyphs only
  const fresh = ITEM_IDS.filter((id) => ITEMS[id].tool || /^head_|^iron_|^dirt$/.test(id));
  assert.equal(fresh.length, 3 * 7 + 3, "21 tool rows, and iron ore, iron ingot and dirt");
  for (const id of fresh) {
    const d = ITEMS[id], lines = [...(d.desc ?? []), ...effectLines(id)];
    assert.ok(d.name.length <= 20 && text(d.name), `${id}: name "${d.name}"`);
    assert.ok(lines.length >= 1 && lines.length <= 3, `${id}: ${lines.length} lines`);
    for (const l of lines) assert.ok(l.length <= 34 && text(l), `${id}: "${l}"`);
    assert.equal(typeof ITEM_ART[id], "function", `${id}: an icon`);
  }
  assert.deepEqual(ITEMS.iron_ore.stack, 20); assert.deepEqual(ITEMS.dirt.tags, ["material"]);
  assert.ok(effectLines("head_pickaxe").some((l) => /ON AN ARM/.test(l) && /X2/.test(l)));
  assert.ok(effectLines("head_axe_swift").some((l) => /SPEED/.test(l)), "an inset head lists the rune's effect too");
});

test("station rows: the smelter turns ore into ingots; the anvil forges, repairs, tempers and sets runes; the bench hafts; all within the screen's limits", () => {
  assert.deepEqual([...STATION_IDS], ["crafting", "smelting", "smithing"]);
  assert.deepEqual(STATION_REQUIRES.crafting, { flags: [FLAGS.knowBuild] });
  assert.deepEqual(STATION_REQUIRES.smelting, { flags: [FLAGS.knowSmelt] }, "smelting has its own knowledge, read off a smelter");
  assert.equal(PROPS.forge.station, "smelting"); assert.equal(PROPS.anvil.station, "smithing"); assert.equal(PROPS.workbench.station, "crafting");
  assert.deepEqual(craftRecipesFor("smelting").map((r) => r.id), ["iron_ingot", "iron_ingot_charge"]);
  for (const r of craftRecipesFor("smelting")) { assert.ok(r.inputs.some((c) => c.item === "iron_ore") && r.inputs.some((c) => c.item === "wood")); assert.equal(r.output.item, "iron_ingot"); }
  assert.equal(rawValue("iron_ingot"), 1.5, "valued by the single-ingot row, not the full charge");
  const tabs = STATIONS.smithing.tabs!;
  assert.deepEqual(tabs.map((t) => t.id), ["forge", "repair", "modify", "runes"]);
  const smith = craftRecipesFor("smithing"), tab = (id: string) => smith.filter((r) => r.tab === id);
  assert.ok(smith.every((r) => tabs.some((t) => t.id === r.tab)), "every anvil row is on a tab");
  assert.deepEqual(tab("forge").map((r) => r.output.item), TOOL_TYPE_IDS.map(headId));
  for (const t of TOOL_TYPE_IDS) {
    assert.deepEqual(tab("forge").find((r) => r.id === headId(t))!.inputs, [{ item: "iron_ingot", n: FORGE_COST[t] }]);
    const rep = tab("repair").find((r) => r.id === `repair_${headId(t)}`)!;
    assert.equal(rep.work, rustedHeadId(t)); assert.equal(rep.output.item, headId(t));
    assert.ok(rep.inputs.find((c) => c.item === "iron_ingot")!.n < FORGE_COST[t], "mending costs less iron than forging");
    assert.equal(tab("modify").find((r) => r.id === `temper_${headId(t)}`)!.output.item, fineHeadId(t));
    assert.equal(tab("modify").find((r) => r.id === `temper_${t}`)!.output.item, fineToolId(t));
    for (const r of TOOL_RUNES) {
      const set = tab("runes").find((x) => x.id === `inset_${r}_${t}`)!, unset = tab("runes").find((x) => x.id === `unset_${r}_${t}`)!;
      assert.deepEqual(set.inputs.map((c) => c.item), [fineHeadId(t), `rune_${r}`]); assert.equal(set.output.item, runedHeadId(t, r));
      assert.equal(unset.output.item, fineHeadId(t)); assert.deepEqual(unset.also, [{ item: `rune_${r}`, n: 1 }], "the rune comes back out whole");
    }
    const haft = craftRecipesFor("crafting").find((r) => r.id === t)!;
    assert.deepEqual(haft.inputs.map((c) => c.item), [headId(t), "wood"], "a full tool: a head, some wood, the workbench");
  }
  for (const id of STATION_IDS) {
    const s = STATIONS[id];
    assert.ok(text(s.name) && text(s.verb) && s.verb.length <= 6 && text(s.lockedText) && text(s.lockedHint) && s.lockedHint.length <= 27, id);
    assert.ok(PROP_ART[propDef(s.prop).art ?? s.prop], `${id}: its header sprite`);
    for (const t of s.tabs ?? []) { assert.ok(text(t.name) && t.name.length <= 8 && t.verb.length <= 6); assert.ok(t.empty.length <= 3 && t.empty.every((l) => l.length <= 27 && text(l)), t.id); }
  }
  for (const r of CRAFT_RECIPES) assert.ok((r.verb ?? "").length <= 6 && (!r.work || r.inputs.some((c) => c.item === r.work)), `${r.id}: the piece it works on is one of its inputs`);
});

// ------------------------------------------------------------------ iron ore
test("iron ore: veins on the surface, placed without the rng; two bare-handed blows a piece, three pieces a vein; a pickaxe head gets one a blow", () => {
  assert.deepEqual(HARVEST.ironore, { hp: 6, perHit: { item: "iron_ore", n: 0.5 }, clearBox: true, tool: "pickaxe" });
  const s = buildSurface(), veins = s.props.filter((p) => p.kind === "ironore");
  assert.equal(veins.length, IRON_VEINS);
  assert.deepEqual(buildSurface().props.filter((p) => p.kind === "ironore"), veins, "deterministic");
  const z = SURFACE_GATE_ZONE;
  for (const p of veins) assert.ok(!(p.x >= z.x0 * TS && p.x < (z.x1 + 1) * TS && p.y >= z.y0 * TS && p.y < (z.y1 + 1) * TS), `${p.id} keeps off the stair head`);
  // nothing else in the wild moved to make room for them
  const bare = buildSurface({ iron: false });
  assert.ok(!bare.props.some((p) => p.kind === "ironore"));
  assert.deepEqual(s.props.filter((p) => p.kind !== "ironore"), bare.props);
  assert.deepEqual(s.decals, bare.decals);

  const strike = (w: World, id: string, n: number) => {
    const pl = player(w), p = currentArea(w).prop(id)!;
    for (let i = 0; i < n; i++) { pl.x = p.x; pl.y = p.y + 10; pl.vx = 0; pl.vy = 0; pl.facing = "up"; slamAt(w); }
    return p;
  };
  const w = newWorld(), pl = player(w);
  enterArea(w, pl, "surface", veins[0].x, veins[0].y + 10);
  strike(w, veins[0].id, 1);
  assert.equal(countItem(pl, "iron_ore"), 0, "one blow: nothing yet");
  strike(w, veins[0].id, 1);
  assert.equal(countItem(pl, "iron_ore"), 1, "two blows: one piece");
  const p = strike(w, veins[0].id, 4);
  assert.equal(countItem(pl, "iron_ore"), 3); assert.ok(p.taken, "worked out after three pieces");
  strike(w, veins[0].id, 2);
  assert.equal(countItem(pl, "iron_ore"), 3, "and it does not grow back");
  // with the pickaxe head on the arm: a piece a blow
  addItems(w, pl, "head_pickaxe", 1); assert.equal(wear(w, "head_pickaxe"), "ok");
  strike(w, veins[1].id, 1);
  assert.equal(countItem(pl, "iron_ore"), 4);
});

// ------------------------------------------------------------------ heads on the arms
test("a tool head fits an arm slot and multiplies the work of its own resource only; the left arm takes one once the iron arm is on", () => {
  const w = newWorld(), pl = player(w); frame(w);
  const surface = getArea(w, "surface"), tree = surface.props.find((p) => p.kind === "tree")!, rock = surface.props.find((p) => p.kind === "rock")!;
  const work = (p: typeof tree) => harvestStep(pl, p)!.damage;
  assert.equal(work(tree), 1); assert.equal(work(rock), 1);
  addItems(w, pl, "head_axe", 1);
  assert.equal(wear(w, "head_axe"), "ok");
  assert.equal(pl.gear.armR, "head_axe"); assert.equal(countItem(pl, "head_axe"), 0);
  assert.equal(toolBonus(pl, "axe"), 1); assert.equal(toolBonus(pl, "pickaxe"), 0); assert.equal(toolBonus(pl, "shovel"), 0);
  assert.equal(work(tree), 2, "twice the work on wood"); assert.equal(work(rock), 1, "and nothing extra on stone");
  // the left arm: a broken stub takes nothing, so a second head swaps with the first
  assert.ok(!slotUsable(w, pl, "armL"));
  addItems(w, pl, "head_pickaxe", 1);
  assert.equal(wear(w, "head_pickaxe"), "ok");
  assert.equal(pl.gear.armR, "head_pickaxe"); assert.equal(pl.gear.armL, undefined); assert.equal(countItem(pl, "head_axe"), 1);
  // with the iron arm on, the left arm slot is usable and both heads work at once
  setFlag(w, FLAGS.golemArm);
  assert.ok(slotUsable(w, pl, "armL"));
  assert.equal(wear(w, "head_axe"), "ok");
  assert.equal(pl.gear.armL, "head_axe");
  assert.equal(work(tree), 2); assert.equal(work(rock), 2);
  // a tempered head bites deeper; two of a kind do not add up
  assert.equal(takeOffGear(w, pl, "armR"), "ok");
  addItems(w, pl, "head_axe_fine", 1); assert.equal(wear(w, "head_axe_fine"), "ok");
  assert.equal(pl.gear.armR, "head_axe_fine"); assert.equal(toolBonus(pl, "axe"), 2); assert.equal(work(tree), 3);
  // a slot that locks gives its head back to the pack (nothing is lost)
  clearFlag(w, FLAGS.golemArm); frame(w);
  assert.equal(pl.gear.armL, undefined); assert.equal(countItem(pl, "head_axe"), 1);
});

test("a rune set in a head works while the head is on the arm; a hafted tool works for a worker that carries it, not for the maintainer", () => {
  const w = newWorld(), pl = player(w); frame(w);
  addItems(w, pl, "head_shovel_swift", 1);
  assert.equal(speedMultiplier(w, pl), 1);
  assert.equal(wear(w, "head_shovel_swift"), "ok");
  assert.equal(speedMultiplier(w, pl), 1 + RUNE_SWIFT_SPEED_BONUS, "the rune of swift rides on the arm");
  assert.equal(toolBonus(pl, "shovel"), 2);
  assert.equal(takeOffGear(w, pl, "armR"), "ok");
  assert.equal(speedMultiplier(w, pl), 1);
  addItems(w, pl, "head_axe_glow", 1); assert.equal(wear(w, "head_axe_glow"), "ok");
  assert.equal(golemGlow(w, pl), RUNE_GLOW_LIGHT);
  assert.equal(takeOffGear(w, pl, "armR"), "ok");
  // hafted tools: in the maintainer's pack they are cargo; in a worker's they work
  addItems(w, pl, "pickaxe", 1);
  assert.equal(toolBonus(pl, "pickaxe"), 0);
  assert.equal(wear(w, "pickaxe"), "notWearable");
  const worker = actorById(w, "npc.worker.artificery")!;
  assert.equal(toolBonus(worker, "pickaxe"), 0);
  worker.inventory[0] = { item: "pickaxe_fine", n: 1 };
  assert.equal(toolBonus(worker, "pickaxe"), 2); assert.equal(toolBonus(worker, "axe"), 0);
  // (the worker's blow is half the maintainer's, and it only lands while it has a core: sim/actorStats.ts)
  worker.powerCore = "ruby_core";
  const rock = getArea(w, "surface").props.find((p) => p.kind === "rock")!;
  assert.equal(harvestStep(worker, rock)!.damage, 0.5 * 3);
});

// ------------------------------------------------------------------ scanning
test("scanning the smelter teaches smelting and gives the plan to build one; scanning the anvil gives the anvil's plan", () => {
  const w = newWorld(), pl = player(w), a = currentArea(w); frame(w);
  assert.equal(RECIPES.smelter.prop, "forge"); assert.equal(RECIPES.smelter.teaches, FLAGS.knowSmelt); assert.equal(RECIPES.anvil.prop, "anvil"); assert.equal(RECIPES.anvil.teaches, undefined);
  assert.ok(!RECIPES.smelter.cost.some((c) => c.item === "iron_ingot"), "the first smelter needs no iron");
  assert.ok(RECIPES.anvil.cost.some((c) => c.item === "iron_ingot"));
  // before: the smelter opens, but dark
  assert.ok(craftLocked(w, pl, "smelting"));
  const ev = openStation(w, FORGE);
  assert.deepEqual(ev, { t: "openStation", actor: pl.id, prop: FORGE, station: "smelting" });
  assert.deepEqual(craftList(w, pl, "smelting", FORGE), []);
  events(w);
  assert.equal(orderCraft(w, pl, "smelting", "iron_ingot", FORGE), false);
  assert.deepEqual(events(w), [{ t: "message", text: craftLockedText("smelting") }]);
  // scan it (Z, then E)
  const scan = (id: string) => {
    const p = a.prop(id)!;
    pl.mode = "normal"; pl.x = p.x; pl.y = p.y + 11; pl.vx = 0; pl.vy = 0; pl.facing = "up";
    events(w);
    stepPlayer(w, 0.01, { ix: 0, iy: 0, use: true, toggleScan: true });
    assert.equal(pl.task?.kind, "scan", id);
    tickTask(w, pl, 1);
    return events(w);
  };
  const got = scan(FORGE);
  assert.ok(hasFlag(w, analysisFlag("smelter")) && hasFlag(w, FLAGS.knowSmelt));
  assert.ok(got.some((e) => e.t === "learned" && e.flag === FLAGS.knowSmelt));
  assert.ok(got.some((e) => e.t === "message" && e.text === "ANALYZED: SMELTER"));
  assert.ok(!craftLocked(w, pl, "smelting"));
  assert.ok(!scan(FORGE).some((e) => e.t === "learned"), "learned once");
  assert.ok(!hasFlag(w, analysisFlag("anvil")));
  const anvil = scan(ANVIL);
  assert.ok(hasFlag(w, analysisFlag("anvil")));
  assert.ok(anvil.some((e) => e.t === "message" && e.text === "ANALYZED: ANVIL") && !anvil.some((e) => e.t === "learned"));
});

// ------------------------------------------------------------------ smelting
test("the smelter: E opens its screen's station; ore and a wood fire become ingots through the craft task", () => {
  const w = newWorld(), pl = player(w); frame(w);
  setFlag(w, FLAGS.knowSmelt);
  addItems(w, pl, "iron_ore", 8); addItems(w, pl, "wood", 3);
  assert.equal(openStation(w, FORGE)!.t, "openStation");
  const list = craftList(w, pl, "smelting", FORGE);
  assert.deepEqual(list.map((e) => [e.recipe.id, e.status]), [["iron_ingot", "ok"], ["iron_ingot_charge", "ok"]]);
  assert.ok(make(w, "smelting", FORGE, "iron_ingot"));
  assert.deepEqual([countItem(pl, "iron_ore"), countItem(pl, "wood"), countItem(pl, "iron_ingot")], [6, 2, 2]);
  assert.ok(make(w, "smelting", FORGE, "iron_ingot_charge"));
  assert.deepEqual([countItem(pl, "iron_ore"), countItem(pl, "wood"), countItem(pl, "iron_ingot")], [0, 0, 8]);
  events(w);
  assert.equal(make(w, "smelting", FORGE, "iron_ingot"), false, "no ore, no ingot");
  assert.deepEqual(events(w), [{ t: "message", text: "NOT ENOUGH MATERIALS" }]);
  // not at the anvil: a smelting row is the smelter's
  assert.equal(orderCraft(w, pl, "smithing", "iron_ingot", ANVIL), false);
});

// ------------------------------------------------------------------ smithing
test("the anvil: forge a head, repair a rusted one, temper it, set a rune in it and pry it out again; each tab lists what was brought", () => {
  const w = newWorld(), pl = player(w); frame(w);
  setFlag(w, FLAGS.knowBuild);
  const tab = (id: string) => craftList(w, pl, "smithing", ANVIL, id).map((e) => [e.recipe.id, e.status]);
  assert.deepEqual(openStation(w, ANVIL), { t: "openStation", actor: pl.id, prop: ANVIL, station: "smithing" });
  // FORGE always lists the three heads; the others list nothing until there is something to work on
  assert.deepEqual(tab("forge"), [["head_shovel", "cost"], ["head_pickaxe", "cost"], ["head_axe", "cost"]]);
  assert.deepEqual([tab("repair"), tab("modify"), tab("runes")], [[], [], []]);
  addItems(w, pl, "iron_ingot", 12);
  assert.ok(make(w, "smithing", ANVIL, "head_pickaxe"));
  assert.deepEqual([countItem(pl, "head_pickaxe"), countItem(pl, "iron_ingot")], [1, 9]);
  // REPAIR: the rusted shovel head from the artificery floor, for one ingot
  addItems(w, pl, "head_shovel_rusted", 1);
  assert.deepEqual(tab("repair"), [["repair_head_shovel", "ok"]]);
  assert.ok(make(w, "smithing", ANVIL, "repair_head_shovel"));
  assert.deepEqual([countItem(pl, "head_shovel_rusted"), countItem(pl, "head_shovel"), countItem(pl, "iron_ingot")], [0, 1, 8]);
  assert.deepEqual(tab("repair"), []);
  // MODIFY: temper what is carried (two heads now: two rows)
  assert.deepEqual(tab("modify"), [["temper_head_shovel", "ok"], ["temper_head_pickaxe", "ok"]]);
  assert.ok(make(w, "smithing", ANVIL, "temper_head_shovel"));
  assert.deepEqual([countItem(pl, "head_shovel"), countItem(pl, "head_shovel_fine"), countItem(pl, "iron_ingot")], [0, 1, 6]);
  // RUNES: a tempered head takes a rune; without the rune the row is there but cannot be made
  assert.deepEqual(tab("runes"), [["inset_swift_shovel", "cost"], ["inset_glow_shovel", "cost"]]);
  addItems(w, pl, "rune_swift", 1);
  assert.ok(make(w, "smithing", ANVIL, "inset_swift_shovel"));
  assert.deepEqual([countItem(pl, "head_shovel_fine"), countItem(pl, "rune_swift"), countItem(pl, "head_shovel_swift")], [0, 0, 1]);
  assert.deepEqual(tab("runes"), [["unset_swift_shovel", "ok"]]);
  assert.ok(make(w, "smithing", ANVIL, "unset_swift_shovel"));
  assert.deepEqual([countItem(pl, "head_shovel_fine"), countItem(pl, "rune_swift"), countItem(pl, "head_shovel_swift")], [1, 1, 0], "head and rune both come back");
  // a head worn on the arm is not at hand: it has to come off to be worked on
  assert.equal(wear(w, "head_pickaxe"), "ok");
  assert.deepEqual(tab("modify"), []);
});

test("a full tool is a head, wood and the workbench; the anvil tempers it on its haft", () => {
  const w = newWorld(), pl = player(w); frame(w);
  setFlag(w, FLAGS.knowBuild);
  useOn(w, propItem(w, BENCH)); // the chisel comes off the bench first, as in the tutorial
  addItems(w, pl, "head_axe", 1); addItems(w, pl, "wood", 4); addItems(w, pl, "iron_ingot", 2);
  openStation(w, BENCH);
  const bench = craftList(w, pl, "crafting", BENCH).map((e) => e.recipe.id);
  assert.ok(bench.includes("axe") && bench.includes("shovel") && bench.includes("planks"));
  assert.ok(!bench.includes("axe_fine"), "the fine haft row waits for a fine head");
  assert.ok(make(w, "crafting", BENCH, "axe"));
  assert.deepEqual([countItem(pl, "head_axe"), countItem(pl, "wood"), countItem(pl, "axe")], [0, 2, 1]);
  openStation(w, ANVIL);
  assert.deepEqual(craftList(w, pl, "smithing", ANVIL, "modify").map((e) => e.recipe.id), ["temper_axe"]);
  assert.ok(make(w, "smithing", ANVIL, "temper_axe"));
  assert.deepEqual([countItem(pl, "axe"), countItem(pl, "axe_fine"), countItem(pl, "iron_ingot")], [0, 1, 0]);
});

// ------------------------------------------------------------------ the rooms
test("the artificery and the armory: the smelter and the anvil where they were, the new pieces drawn, two rusted heads to find; the town's own stay whole and idle", () => {
  const d = buildDungeon(), kinds = (x0: number, y0: number, x1: number, y1: number) =>
    d.props.filter((p) => p.x >= x0 * TS && p.x < (x1 + 1) * TS && p.y > (y0 - 1) * TS && p.y <= (y1 + 1) * TS).map((p) => p.kind).sort();
  const art = kinds(4, 36, 16, 45), arm = kinds(62, 3, 68, 10);
  for (const k of ["forge", "anvil", "workbench", "cradle", "slab", "coalbin", "quench", "toolboard", "runetable", "clayvat", "husk"]) assert.ok(art.includes(k), `artificery: ${k}`);
  for (const k of ["limbrack", "weaponrack", "armorstand", "staffrack", "wallhooks", "armorpile"]) assert.ok(arm.includes(k), `armory: ${k}`);
  assert.equal(arm.filter((k) => k === "weaponrack").length, 2); assert.equal(arm.filter((k) => k === "armorstand").length, 3);
  for (const id of [FORGE, ANVIL, BENCH, "cradle@9,37", "limbrack@65.5,3", "weaponrack@63,3", "armorstand@63,7"]) assert.ok(d.props.some((p) => p.id === id), `${id} keeps its id`);
  for (const k of new Set([...art, ...arm])) assert.equal(typeof PROP_ART[propDef(k).art ?? k], "function", `${k}: a sprite`);
  const loose = Object.fromEntries(d.loose.map((l) => [l.id, l]));
  assert.equal(loose.rusted_shovel.item, "head_shovel_rusted"); assert.equal(loose.rusted_axe.item, "head_axe_rusted");
  assert.ok(loose.rusted_shovel.x < 17 * TS && loose.rusted_shovel.y > 36 * TS, "the coal shovel's head, by the smelter");
  assert.ok(loose.rusted_axe.x > 62 * TS && loose.rusted_axe.y < 11 * TS, "an old axe head, in the armory");
  // both can be picked up where they lie
  const w = newWorld(), pl = player(w); frame(w);
  useOn(w, find(w, (i) => i.looseId === "rusted_shovel"));
  assert.equal(countItem(pl, "head_shovel_rusted"), 1);
  // the town: its anvils work nothing and its racks and stands are not the halls' ruins
  for (const id of TOWN_AREAS) for (const p of AREAS[id]().props) assert.ok(!["anvil", "forge", "weaponrack", "armorstand"].includes(p.kind), `${id}: ${p.id}`);
  assert.equal(propDef("townanvil").station, undefined); assert.equal(propDef("townanvil").art, "anvil");
  assert.ok(PROP_ART.shoprack && PROP_ART.shopstand);
});
