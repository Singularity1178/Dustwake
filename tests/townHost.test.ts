// The real host (Game, on the fake canvas, driven by held keys) in Westwake:
// walking the old road and a shop door through the play screen, the host's
// answer to the `portal` event (the view follows, a fade, the place's name as a
// note), drawing the town and a room, and a lived-in room staying quiet (no
// cave rumble). The sim side of all this is tests/town.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { Area } from "../src/game/world/area";
import { AREAS } from "../src/game/world/areas";
import { enterArea, player } from "../src/game/world/world";
import { portalArrival, portalById } from "../src/game/sim/portals";
import { WEST_ROAD } from "../src/game/content/geography";
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
  const out = portalArrival(portalById(new Area(AREAS.surface()), WEST_ROAD.portal)!);
  enterArea(w, pl, "surface", out.x + 24, out.y);
  g.resume(w);
  tick(g, 5);
  assert.ok(g.screens.is("play"));

  assert.ok(hold(g, "a", () => pl.area === "town"), "holding west walks out of the wild and into the town");
  assert.equal(g.area.id, "town", "the view follows");
  assert.equal(g.note?.text, "WESTWAKE, MARKET TOWN");
  assert.ok(g.doorFade > 0, "arriving fades up from dark");
  g.render();
  tick(g, 60);
  assert.equal(g.doorFade, 0, "and the fade is short");
  g.render(); // the east gate, lit: nothing throws

  const door = portalArrival(portalById(g.area, "door.tavern")!);
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

  assert.ok(hold(g, "s", () => pl.area === "town", 600), "walking down onto the sill goes back out");
  assert.equal(g.note?.text, "LOW STREET");
  assert.ok(g.screens.is("play"));
  g.render();
});
