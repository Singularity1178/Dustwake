// The real host (Game, on the fake canvas, driven by keys) through the entrance update: E digs the stair head
// stroke by stroke and the host says what the sim reports, the open stair is walked both ways with the view
// following, and E on the smelter and the anvil opens the station screen under its own name. The sim side is
// tests/entrance.test.ts and tests/smithing.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { enterArea, getArea, hasFlag, player, setFlag, type World } from "../src/game/world/world";
import { addItems, countItem } from "../src/game/sim/inventory";
import { wearFromSlot } from "../src/game/sim/commands";
import { DIG_SITES } from "../src/game/content/digging";
import { ENTRANCES } from "../src/game/content/geography";
import { FLAGS } from "../src/game/content/flags";
import type { ItemId } from "../src/game/content/items";
import { newWorld } from "./helpers";

const GATE = "buriedgate@48,61", SITE = DIG_SITES.buriedgate;
const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const tick = (g: Game, n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) g.update(dt); };
const tap = (g: Game, key: string) => { g.keyDown(key); tick(g); g.keyUp(key); tick(g); };
/** Close the station screen and let the reach that opened it (paused beneath the screen) finish. */
const close = (g: Game) => { tap(g, "escape"); tick(g, 30); };
/** Press a key on the play screen and let the work it starts play out. */
function press(g: Game, w: World, key: string) {
  tap(g, key);
  for (let i = 0; i < 400 && player(w).task; i++) tick(g);
  tick(g, 5);
}
function hold(g: Game, key: string, done: () => boolean, max = 900) {
  g.keyDown(key);
  for (let i = 0; i < max && !done(); i++) tick(g);
  g.keyUp(key);
  tick(g);
  return done();
}
const fit = (w: World, id: ItemId) => { const pl = player(w); addItems(w, pl, id, 1); assert.equal(wearFromSlot(w, pl, pl.inventory.findIndex((s) => s?.item === id)), "ok"); };

test("the host: E digs the stair head out stroke by stroke, says when the earth gives out and when the stair opens, and the open stair is walked down and back up", () => {
  const w = newWorld(), pl = player(w), g = new Game(canvas(), canvas());
  const gate = getArea(w, "surface").prop(GATE)!;
  const stand = () => { pl.x = gate.x; pl.y = gate.y - 11; pl.vx = pl.vy = 0; pl.facing = "up"; };
  enterArea(w, pl, "surface", gate.x, gate.y - 11);
  g.resume(w);
  tick(g, 5);
  assert.ok(g.screens.is("play"));
  stand();
  press(g, w, "e");
  assert.match(g.note?.text ?? "", /SHOVEL HEAD/, "no tool: the golem says what it would take");
  assert.equal(gate.dmg, 0);
  fit(w, "head_shovel");
  stand(); press(g, w, "e");
  assert.equal(gate.dmg, 1); assert.equal(countItem(pl, "dirt"), 1);
  g.render(); // the cut turf: the stair head drawn at its dig stage
  for (let i = 1; i < SITE.layers[0].work; i++) { stand(); press(g, w, "e"); }
  assert.equal(countItem(pl, "dirt"), SITE.layers[0].work);
  assert.match(g.note?.text ?? "", /FALLEN STONE.*PICKAXE HEAD/, "the earth is out: the host says what lies under it");
  fit(w, "head_pickaxe");
  for (let i = 0; i < SITE.layers[1].work; i++) { stand(); press(g, w, "e"); g.render(); }
  assert.ok(gate.open && hasFlag(w, ENTRANCES.surface_stair.flag));
  assert.match(g.note?.text ?? "", /STAIR IS OPEN/);
  assert.equal(countItem(pl, "stone"), SITE.layers[1].work);
  assert.ok(pl.y > gate.y, "set down on the lip");
  g.render(); // the open stairwell, the glyph alight
  // down into the halls, the view following, the place named
  assert.ok(hold(g, "w", () => pl.area === "dungeon", 120), "pushing north into the stairwell walks down");
  assert.equal(g.area.id, "dungeon");
  assert.equal(g.note?.text, "THE HALLS: FIRST CELLAR");
  assert.ok(g.doorFade > 0);
  g.render(); // the stair from inside, the sky coming down it
  tick(g, 60);
  // and back up
  assert.ok(hold(g, "s", () => pl.area === "surface", 300), "walking south off the top of the flight comes out");
  assert.equal(g.area.id, "surface");
  assert.equal(g.note?.text, "THE SURFACE");
  assert.ok(g.screens.is("play"));
  g.render();
});

test("the host: E on the smelter and on the anvil opens the station screen under its own name, with the anvil's tabs", () => {
  const w = newWorld(), pl = player(w), g = new Game(canvas(), canvas());
  setFlag(w, FLAGS.knowBuild);
  g.resume(w);
  tick(g, 5);
  const a = getArea(w, "dungeon"), forge = a.prop("forge@5.5,37")!, anvil = a.prop("anvil@6,40")!;
  const at = (p: { x: number; y: number }) => { pl.x = p.x; pl.y = p.y + 11; pl.vx = pl.vy = 0; pl.facing = "up"; };
  // the smelter, before the golem has studied one: its screen opens, dark
  at(forge); press(g, w, "e");
  assert.ok(g.screens.is("crafting"), "the smelter opens the station screen");
  assert.equal(g.craftUi.station, "smelting"); assert.equal(g.craftUi.def.name, "SMELTER");
  assert.ok(g.craftUi.locked, "no plans until smelting is learned");
  g.render();
  close(g);
  assert.ok(g.screens.is("play"));
  // studied (the scan's own path is tests/smithing.test.ts): the rows are there, and SMELT sets the golem to work
  setFlag(w, FLAGS.knowSmelt);
  addItems(w, pl, "iron_ore", 2); addItems(w, pl, "wood", 1);
  at(forge); press(g, w, "e");
  assert.ok(g.screens.is("crafting") && !g.craftUi.locked);
  assert.deepEqual(g.craftUi.entries.map((e) => e.recipe.id), ["iron_ingot", "iron_ingot_charge"]);
  g.render();
  tap(g, "e"); tap(g, "e"); // to the button, then SMELT: the screen steps aside while the golem works
  assert.ok(g.screens.is("play") && g.craftUi.pending);
  for (let i = 0; i < 600 && !g.screens.is("crafting"); i++) tick(g);
  assert.equal(countItem(pl, "iron_ingot"), 2);
  assert.ok(g.screens.is("crafting"), "and comes back when the ingots are poured");
  assert.match(g.note?.text ?? "", /MADE 2 IRON INGOT/);
  close(g);
  // the anvil: four tabs, Q / R to turn them
  addItems(w, pl, "head_shovel_rusted", 1);
  at(anvil); press(g, w, "e");
  assert.ok(g.screens.is("crafting"));
  assert.equal(g.craftUi.station, "smithing"); assert.equal(g.craftUi.def.name, "ANVIL");
  assert.deepEqual(g.craftUi.tabs.map((t) => t.name), ["FORGE", "REPAIR", "MODIFY", "RUNES"]);
  assert.equal(g.craftUi.tabs[g.craftUi.tab].id, "forge"); assert.equal(g.craftUi.entries.length, 3);
  g.render();
  tap(g, "r");
  assert.equal(g.craftUi.tabs[g.craftUi.tab].id, "repair");
  assert.deepEqual(g.craftUi.entries.map((e) => e.recipe.id), ["repair_head_shovel"]);
  g.render();
  tap(g, "4");
  assert.equal(g.craftUi.tabs[g.craftUi.tab].id, "runes"); assert.equal(g.craftUi.entries.length, 0);
  g.render(); // an empty tab says what it needs
  tap(g, "q"); tap(g, "q");
  assert.equal(g.craftUi.tabs[g.craftUi.tab].id, "repair");
  tap(g, "e"); tap(g, "e"); // to the button, then REPAIR
  for (let i = 0; i < 600 && !g.screens.is("crafting"); i++) tick(g);
  assert.equal(countItem(pl, "head_shovel"), 1); assert.equal(countItem(pl, "head_shovel_rusted"), 0); assert.equal(countItem(pl, "iron_ingot"), 1);
  assert.equal(g.craftUi.tabs[g.craftUi.tab].id, "repair", "back on the tab it was working from");
  close(g);
  // one ingot forges nothing, but it mends: the screen opens on the first tab with something ready
  addItems(w, pl, "head_pickaxe_rusted", 1);
  at(anvil); press(g, w, "e");
  assert.equal(g.craftUi.tabs[g.craftUi.tab].id, "repair");
  assert.deepEqual(g.craftUi.entries.map((e) => [e.recipe.id, e.status]), [["repair_head_pickaxe", "ok"]]);
  close(g);
  assert.ok(g.screens.is("play"));
});
