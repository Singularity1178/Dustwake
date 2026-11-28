// The real host (Game, on the fake canvas, driven by held keys) in Westwake:
// walking the old road and a shop door through the play screen, the host's
// answer to the `portal` event (the view follows, a fade, the place's name as a
// note), drawing the town and a room, and a lived-in room staying quiet (no
// cave rumble). The sim side of all this is tests/town.test.ts.
import { TOWN_AT, inTown } from "./support/places";
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";


import { enterArea, player } from "../src/game/world/world";
import { portalArrival, portalById } from "../src/game/sim/portals";

import { newWorld } from "./helpers";

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const tick = (g: Game, n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) g.update(dt); };
/** Hold a key until `done` (or give up). */
function hold(g: Game, key: string, done: () => boolean, max = 900) {
  g.keyDown(key);
  for (let i = 0; i < max && !done(); i++) tick(g);
  g.keyUp(key);
  tick(g);
  return done();
}

test("the host: west along the old road into Westwake, into the tavern and out again", () => {
  const w = newWorld(), pl = player(w), g = new Game(canvas(), canvas());
  // on the old road, a little east of the town's edge
  enterArea(w, pl, "surface", TOWN_AT.x + 96 * 16 + 120, 34 * 16 + 12);
  g.resume(w);
  tick(g, 5);
  assert.ok(g.screens.is("play"));

  assert.ok(hold(g, "a", () => inTown(pl) && pl.x < TOWN_AT.x + 96 * 16 - 30), "holding west walks along the road and into the town: nothing is crossed");
  assert.equal(g.area.id, "surface", "one area: the view never changed");
  assert.equal(g.note?.text, "WESTWAKE, MARKET TOWN");
  assert.equal(g.doorFade, 0, "no fade: there was no door and no edge of a map");
  g.render();
  tick(g, 60);
  assert.equal(g.doorFade, 0, "and the fade is short");
  g.render(); // the east gate, lit: nothing throws

  const door = portalArrival(portalById(g.area, "westwake/door.tavern")!);
  pl.x = door.x; pl.y = door.y; pl.vx = pl.vy = 0;
  tick(g, 2);
  g.render(); // Low Street and the tavern front
  assert.ok(hold(g, "w", () => pl.area === "town_tavern", 240), "pushing on the tavern door goes in");
  assert.equal(g.area.id, "town_tavern");
  assert.equal(g.note?.text, "THE SUNKEN CROWN");
  g.render();

  // a lived-in room: however long the golem stands in it, the buried halls' rumble never comes
  const quiet = (g as unknown as { rumbleT: number }).rumbleT;
  tick(g, 60 * 20);
  assert.equal((g as unknown as { rumbleT: number }).rumbleT, quiet);
  g.render();

  assert.ok(hold(g, "s", () => pl.area === "surface", 600), "walking down onto the sill goes back out");
  assert.equal(g.note?.text, "LOW STREET");
  assert.ok(g.screens.is("play"));
  g.render();
});
