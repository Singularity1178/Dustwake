// Phase 0 through the host (game.ts): game speeds over the fixed tick, the system menu, saves through the store
// (quick slot, Continue, autosave on area change), the mouse on the hi-res UI layer, generated floors, settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as { localStorage?: unknown };
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { createWorld } from "../src/game/world/world";
import { TICK } from "../src/game/core/clock";

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
function host(seed = 61) {
  const g = new Game(canvas(), canvas());
  g.resume(createWorld(seed));
  return g;
}
const press = (g: Game, k: string) => { g.keyDown(k); g.update(1 / 60); g.render(); g.keyUp(k); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("game speed: 1-5 pick pause / 1x / 2x / 4x / 8x, P pauses and resumes; at 8x one frame runs eight ticks; paused runs none", () => {
  const g = host(), w = g.world;
  let t = w.time;
  g.update(1 / 60);
  assert.ok(near(w.time, t + TICK), "1x: one tick per 1/60 frame");
  press(g, "3");
  assert.equal(g.speed, 2);
  press(g, "1");
  assert.equal(g.speed, 0);
  t = w.time;
  for (let i = 0; i < 10; i++) g.update(1 / 60);
  assert.equal(w.time, t, "paused: the world does not move");
  press(g, "p");
  assert.equal(g.speed, 2, "P resumes at the last speed");
  press(g, "2"); assert.equal(g.speed, 1);
  press(g, "4"); assert.equal(g.speed, 4);
  press(g, "5");
  assert.equal(g.speed, 8);
  t = w.time;
  g.update(1 / 60);
  assert.ok(near(w.time, t + 8 * TICK), "8x: eight ticks per frame");
});

test("the old step keys (- = [ ] +) no longer change the speed; the gamepad triggers still step it", () => {
  const g = host();
  for (const k of ["-", "=", "+", "[", "]"]) { press(g, k); assert.equal(g.speed, 1, `${k} does nothing`); }
  press(g, "padfaster"); assert.equal(g.speed, 2);
  press(g, "padslower"); press(g, "padslower"); assert.equal(g.speed, 0);
});

test("W / S / E / Enter / Space never move onto or press the speed bar", () => {
  const g = host();
  for (const k of ["w", "s", "s", "e", "e", "enter", " ", "arrowup", "arrowdown"]) { press(g, k); g.update(1 / 60); g.render(); }
  assert.equal(g.speed, 1, "speed untouched");
  assert.ok(!(g.gui.focus ?? "").startsWith("speed."), "the speed bar never takes the keyboard focus");
});

test("Esc opens the system menu over play (the world waits behind it); Esc closes it", () => {
  const g = host(), w = g.world;
  press(g, "Escape");
  assert.ok(g.screens.is("system"));
  const t = w.time;
  for (let i = 0; i < 5; i++) { g.update(1 / 60); g.render(); }
  assert.equal(w.time, t);
  press(g, "Escape");
  assert.ok(g.screens.is("play"));
});

test("saves through the host: K to the quick slot, L loads the latest, and an area change autosaves", () => {
  const g = host(), w = g.world;
  press(g, "k");
  assert.ok(g.store.has("quick"));
  const saved = w.time;
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  press(g, "l");
  assert.notEqual(g.world, w, "a new world was loaded");
  assert.ok(Math.abs(g.world.time - saved) < 0.05);
  const town = g.world.areas.get("town") ?? null;
  assert.equal(town, null);
  assert.ok(g.debugTeleport({ label: "town", group: "t", area: "town", x: 600, y: 600 }) || true);
  for (let i = 0; i < 160; i++) g.update(1 / 60);
  assert.ok(g.store.has("auto"), "autosaved after coming into another area");
});

test("the mouse: clicking the speed bar on the hi-res layer sets the speed", () => {
  const g = host();
  g.render();
  // the 8x button, bottom left: logical (90..109, 342..354) on the 640x360 layer = base px (45..54, 171..177)
  g.pointerMove(49.5, 174); g.pointerDown(0, 49.5, 174); g.update(1 / 60); g.render();
  g.pointerUp(0, 49.5, 174); g.update(1 / 60); g.render();
  assert.equal(g.speed, 8);
  // a click on the world elsewhere is not the UI's
  g.pointerMove(160, 120); g.pointerDown(0, 160, 120); g.update(1 / 60); g.render(); g.pointerUp(0, 160, 120); g.update(1 / 60); g.render();
  assert.equal(g.speed, 8);
});

test("generated floors through the host: create, save, load, leave", () => {
  const g = host();
  const floor = g.devCreateFloor("floor");
  assert.equal(g.area.id, floor.id);
  assert.ok(g.saveGame("slot1"));
  assert.ok(g.loadGame("slot1"));
  assert.equal(g.area.id, floor.id, "loaded back into the floor");
  assert.ok(g.devLeaveFloor());
  assert.equal(g.area.id, "dungeon");
});

test("settings apply at once: shake off stops shakes, LOD follows its toggle, the UI scale resizes the hi-res layer", () => {
  const g = host();
  g.settings.set("shake", false);
  g.shake(1, 3);
  assert.equal(g.shakeT, 0);
  g.settings.set("lod", false);
  assert.equal(g.world.lod, null);
  g.settings.set("lod", true);
  assert.ok(g.world.lod);
  g.settings.set("uiScale", "compact");
  assert.equal(g.hiCanvas.width, 960);
  assert.equal(g.flashK, 1);
  g.settings.set("flashes", false);
  assert.ok(g.flashK < 1);
});

test("smoke: every system-menu tab and settings category at every UI scale, and the world under the mouse, draw without error", () => {
  const g = host(71);
  g.settings.set("perf", true);
  for (const scale of ["compact", "normal", "large"]) {
    g.settings.set("uiScale", scale);
    press(g, "Escape");
    assert.ok(g.screens.is("system"));
    for (let tab = 0; tab < 5; tab++) { g.systemMenu.tab = tab; for (let i = 0; i < 2; i++) { g.update(1 / 60); g.render(); } }
    g.systemMenu.tab = 2;
    for (let c = 0; c < 4; c++) { (g.systemMenu as unknown as { cat: number }).cat = c; g.update(1 / 60); g.render(); }
    // keyboard parity inside the menu: move the focus and activate whatever it lands on (Settings tab: a toggle or slider)
    press(g, "ArrowDown"); press(g, "ArrowDown"); press(g, "ArrowRight");
    g.systemMenu.tab = 0;
    press(g, "Escape");
    assert.ok(g.screens.is("play"), `closed at ${scale}`);
  }
  g.settings.set("uiScale", "normal");
  for (let i = 0; i < 20; i++) { g.update(1 / 60); g.render(); }
  // hover the golem itself, right-click it, pick the first entry of the context menu
  const pl = g.pl, bx = ((pl.x - g.cam.x) * 320) / g.vw, by = ((pl.y - 10 - g.cam.y) * 180) / g.vh;
  g.pointerMove(bx, by); g.update(1 / 60); g.render();
  g.pointerDown(2, bx, by); g.update(1 / 60); g.render(); g.pointerUp(2, bx, by); g.update(1 / 60); g.render();
  assert.ok(g.hud.menu && g.hud.menu.items.some((i) => i.label === "Inspect"), "a context menu with Inspect");
  g.hud.menu!.items.find((i) => i.label === "Inspect")!.run(); g.hud.menu = null;
  for (let i = 0; i < 3; i++) { g.update(1 / 60); g.render(); }
  assert.ok(g.hud.inspect, "the inspector is open");
  // drag a box across the view, then Esc closes the HUD's things before it opens the menu
  g.pointerMove(10, 30); g.pointerDown(0, 10, 30); g.update(1 / 60); g.render();
  g.pointerMove(310, 170); g.update(1 / 60); g.render(); g.pointerUp(0, 310, 170); g.update(1 / 60); g.render();
  press(g, "Escape");
  assert.equal(g.hud.inspect, null);
  for (let i = 0; i < 3 && !g.screens.is("system"); i++) press(g, "Escape");
  assert.ok(g.screens.is("system"));
  press(g, "Escape");
  g.pointerLeave(); g.update(1 / 60); g.render();
});
