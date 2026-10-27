// The real host (Game) on the fake canvas, driven by key presses: on the play
// screen Space attacks and E / Enter interact, independently, even facing the
// same interactable; overlays keep their own keys (Space still confirms in the
// pack, and nothing attacks behind it). No browser: update() only, no render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { player, currentArea } from "../src/game/world/world";
import { addItems, countItem } from "../src/game/sim/inventory";
import { allSlotsUnlocked } from "../src/game/sim/debug";
import { GOLEM_LIGHT, RUNE_GLOW_LIGHT } from "../src/game/content/gear";
import { FLAGS } from "../src/game/content/flags";
import { wornIn } from "../src/game/sim/gear";
import { find, newWorld, standAt } from "./helpers";

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
function play() {
  const g = new Game(canvas(), canvas());
  const w = newWorld();
  g.resume(w);
  return { g, w };
}
const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.update(1 / 60); };
const press = (g: Game, key: string) => { g.keyDown(key); tick(g); g.keyUp(key); };

test("play screen: Space slams and E / Enter interact, independently, facing the same interactable", () => {
  const { g, w } = play();
  standAt(w, find(w, (i) => i.looseId === "coin"));
  tick(g);
  press(g, " ");
  assert.equal(player(w).task?.kind, "slam", "Space attacks");
  assert.ok(!currentArea(w).looseItem("coin")!.taken, "Space doesn't interact");
  tick(g, 90);
  assert.equal(player(w).task, null, "the slam finished");
  press(g, "e");
  assert.equal(player(w).task?.kind, "reach", "E interacts");
  tick(g, 60);
  assert.ok(currentArea(w).looseItem("coin")!.taken);
  standAt(w, find(w, (i) => i.kind === "door"));
  tick(g);
  press(g, "enter");
  assert.equal(player(w).task?.kind, "reach", "Enter is still an interact alias");
});

test("overlays keep their keys: in the pack Space uses the selected item, and no slam starts behind it", () => {
  const { g, w } = play();
  addItems(w, player(w), "basket", 1);
  press(g, "i");
  assert.ok(g.screens.is("inv"), "pack open");
  press(g, " ");
  assert.equal(wornIn(player(w), "back"), "basket", "Space put it on, like E");
  assert.equal(player(w).task, null, "nothing attacked behind the pack");
  press(g, "escape");
  assert.ok(g.screens.is("play"));
});

test("Ctrl+6 gear kit: unlocks every slot, and the pack's paper doll wears a rune the glow follows", () => {
  const { g, w } = play();
  const pl = player(w);
  g.debugKey(6);
  assert.ok(allSlotsUnlocked(w), "all locked slots are open");
  assert.equal(g.debugMsg?.text, "DEBUG: GEAR KIT ON - ALL SLOTS UNLOCKED");
  tick(g);
  assert.equal(g.glight.rad, GOLEM_LIGHT.rad, "the standard glow before the rune");
  press(g, "i");
  assert.ok(g.screens.is("inv"));
  // put the rune of glow on from the pack (move the cursor to it, E)
  g.packUi.cursor = pl.inventory.findIndex((s) => s?.item === "rune_glow");
  press(g, "e");
  assert.equal(wornIn(pl, "rune0"), "rune_glow");
  assert.equal(g.packUi.slot, "rune0", "the cursor follows the rune onto the doll");
  press(g, "escape");
  tick(g, 3);
  assert.equal(g.glight.rad, RUNE_GLOW_LIGHT.rad, "the light system applies the sim's glow");
  g.debugKey(6);
  assert.ok(!allSlotsUnlocked(w), "second press locks them again");
  assert.equal(g.debugMsg?.text, "DEBUG: GEAR KIT OFF - SLOTS LOCKED AGAIN");
});

test("crafting through the host: E at a bench opens the plans, CRAFT works at the bench, and the plans reopen after", () => {
  const { g, w } = play();
  const pl = player(w);
  w.flags.add(FLAGS.knowBuild);
  addItems(w, pl, "chisel", 1);
  addItems(w, pl, "wood", 4);
  const bench = currentArea(w).prop("workbench@13.5,37")!;
  currentArea(w).setPropState(bench.id, { taken: true }); // its chisel is already in the pack
  standAt(w, find(w, (i) => i.propId === bench.id));
  tick(g);
  press(g, "e");
  tick(g, 30);
  assert.ok(g.screens.is("crafting"), "the bench opened its plans");
  press(g, "e"); press(g, "e");
  assert.ok(g.screens.is("play") && pl.task?.kind === "craft", "CRAFT starts the work with the world running");
  tick(g, 90);
  assert.equal(countItem(pl, "planks"), 3);
  assert.ok(g.screens.is("crafting"), "the plans are back for the next one");
  press(g, "escape");
  assert.ok(g.screens.is("play"));
});
