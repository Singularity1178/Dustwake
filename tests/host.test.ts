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
import { addItems } from "../src/game/sim/inventory";
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
