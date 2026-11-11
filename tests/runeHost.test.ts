// The rune's refusal as the real host plays it (Game on the fake canvas, driven by keys), and the maths under it
// (view/runeFx.ts). The sim's side (when a rune will not carry, and that nothing is woken) is tests/routes.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { clearFlag, enterArea, getArea, player, setFlag } from "../src/game/world/world";
import { RUNE_NODES } from "../src/game/content/runes";
import { FLAGS } from "../src/game/content/flags";
import { RUNE_DUD, linkedGlow, runeDudGlow, severedGlow } from "../src/game/view/runeFx";
import { newWorld } from "./helpers";

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const tick = (g: Game, n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) g.update(dt); };
const tap = (g: Game, key: string) => { g.keyDown(key); tick(g); g.keyUp(key); tick(g); };

test("the refusal's glow: a surge past full, an uneven guttering that weakens, and back to rest; the same every time", () => {
  const rest = severedGlow(0), D = RUNE_DUD;
  assert.equal(runeDudGlow(0, rest), rest); assert.equal(runeDudGlow(D.dur, rest), rest); assert.equal(runeDudGlow(99, rest), rest);
  assert.ok(runeDudGlow(D.surge * 0.999, rest) > 1.1, "overdriven at the top of the surge");
  const at = (i: number) => runeDudGlow(D.surge + (i / 200) * (D.gutter - D.surge), rest);
  const gutter = Array.from({ length: 200 }, (_, i) => at(i));
  assert.ok(gutter.some((v) => v > 0.6) && gutter.some((v) => v < rest), "bright and dark by turns");
  assert.ok(Math.max(...gutter.slice(133)) < Math.max(...gutter.slice(0, 66)), "weaker toward the end");
  const tail = [0.25, 0.5, 0.75].map((k) => runeDudGlow(D.gutter + k * (D.dur - D.gutter), rest));
  assert.ok(tail[0] > tail[1] && tail[1] > tail[2] && tail[2] >= rest, "dying back to rest");
  // the guttering is beats, as data: flashes inside it, each weaker than the last, each long enough to be seen at
  // 60 Hz, and the rune dark between them (drawn from noise it was dark for most of the guttering: rendered, it read
  // as one flash and nothing)
  const F = D.flashes;
  assert.ok(F.length >= 4);
  F.forEach(([start, len, level], i) => {
    assert.ok(start >= D.surge && start + len <= D.gutter && len >= 2 / 60, `flash ${i}: inside the guttering, two frames or more`);
    assert.ok(Math.abs(runeDudGlow(start + len / 2, rest) - level) < 1e-9, `flash ${i}: lit at its level`);
    if (!i) return;
    const prev = F[i - 1];
    assert.ok(level < prev[2], `flash ${i}: weaker than the last`);
    assert.ok(start > prev[0] + prev[1] && runeDudGlow((prev[0] + prev[1] + start) / 2, rest) < rest, `dark before flash ${i}`);
  });
  assert.ok(runeDudGlow((D.surge + F[0][0]) / 2, rest) < rest, "dark after the surge, before the first flash");
  assert.deepEqual(gutter, Array.from({ length: 200 }, (_, i) => at(i)), "a function of time alone");
  // left alone: a linked rune pulses high, a severed one breathes low and never comes near it
  for (let t = 0; t < 12; t += 0.37) assert.ok(severedGlow(t) > 0.03 && severedGlow(t) < 0.2 && linkedGlow(t) > 0.3, `t ${t}`);
  // a dark rune only spits: half the flare, and nothing once it is over
  assert.ok(runeDudGlow(D.surge * 0.999, 0, 0.5) < 0.7 && runeDudGlow(D.surge * 0.999, 0, 0.5) > 0.4);
  assert.equal(runeDudGlow(D.dur, 0, 0.5), 0);
});

test("the host: a severed surface rune burns low, and E on it plays the refusal: a surge, a guttering with sparks, then embers again, going nowhere", () => {
  const w = newWorld(), pl = player(w), g = new Game(canvas(), canvas());
  const rp = getArea(w, "surface").prop(RUNE_NODES.surface.prop)!;
  for (const f of [RUNE_NODES.surface.flag, RUNE_NODES.dungeon.flag, FLAGS.tutorialDone]) setFlag(w, f);
  enterArea(w, pl, "surface", rp.x, rp.y + 9); pl.facing = "up";
  g.resume(w); tick(g, 5);
  assert.ok(g.screens.is("play"));
  const light = g.view.byId("runeglow")!;
  assert.ok(g.surfaceRuneState().glow > 0.3 && light.cur > 0.2, "linked: the steady pulse, and its light");
  // the circle below goes dark: still carved (it was restored), but embers
  clearFlag(w, RUNE_NODES.dungeon.flag);
  tick(g, 3);
  const rest = g.surfaceRuneState();
  assert.equal(rest.t, 1); assert.ok(rest.glow > 0 && rest.glow < 0.2, `embers (${rest.glow})`);
  assert.ok(light.cur < 0.15, "and its light all but gone");
  assert.equal(g.runeDud, null);
  // E: the golem reaches, the rune refuses
  tap(g, "e");
  const glows: number[] = [];
  let sparks = 0, lit = 0;
  for (let i = 0; i < 300 && (pl.task || g.runeDud || !glows.length); i++) {
    tick(g);
    if (!g.runeDud) continue;
    glows.push(g.surfaceRuneState().glow);
    sparks = Math.max(sparks, g.particles.filter((p) => p.kind === "spark").length);
    lit = Math.max(lit, light.cur);
    if (glows.length === 4) g.render(); // a frame of it, drawn
  }
  assert.ok(glows.length > 40, "the refusal played out over many frames");
  assert.equal(g.note?.text, "THE RUNE GUTTERS OUT. NOTHING ANSWERS ON THE OTHER SIDE");
  assert.ok(Math.max(...glows) > 1, "it surges past its full glow");
  assert.ok(glows.some((v) => v < 0.1) && glows.some((v) => v > 0.5), "and gutters, bright and dark by turns");
  // frame by frame, as the screen shows it: the rune comes back out of the dark again and again
  let flashes = 0;
  for (let i = 1; i < glows.length; i++) if (glows[i - 1] < 0.1 && glows[i] > 0.3) flashes++;
  assert.ok(flashes >= RUNE_DUD.flashes.length, `it stutters: ${flashes} flashes out of the dark over ${glows.length} frames`);
  assert.ok(sparks >= 10, "throwing sparks");
  assert.ok(lit > 0.5, "its light flaring with it");
  assert.equal(g.runeDud, null);
  assert.ok(g.surfaceRuneState().glow < 0.2, "back to embers");
  assert.ok(g.screens.is("play") && pl.area === "surface" && !w.flags.has(RUNE_NODES.dungeon.flag), "nobody went anywhere, and nothing below was woken");
  // lit again below, E carries as before
  setFlag(w, RUNE_NODES.dungeon.flag);
  pl.x = rp.x; pl.y = rp.y + 9; pl.facing = "up";
  tap(g, "e");
  assert.ok(g.screens.is("tele"), "the jump's lift-off");
});

test("the host: a worker stepping through a door or off along a road is only heard; the player's view, fade and note are left alone", () => {
  const w = newWorld(), pl = player(w), g = new Game(canvas(), canvas());
  const rp = getArea(w, "surface").prop(RUNE_NODES.surface.prop)!;
  enterArea(w, pl, "surface", rp.x, rp.y + 9);
  g.resume(w); tick(g, 5);
  const before = { area: g.area.id, note: g.note, fade: g.doorFade, particles: g.particles.length };
  w.events.push({ t: "portal", actor: "npc.worker.artificery", fromArea: "surface", from: "west_road", toArea: "town", to: "east_road" });
  w.events.push({ t: "portal", actor: "npc.worker.artificery", fromArea: "dungeon", from: "stair_up", toArea: "surface", to: "stair_down" });
  g.drainEvents();
  assert.deepEqual({ area: g.area.id, note: g.note, fade: g.doorFade, particles: g.particles.length }, before);
  assert.ok(g.screens.is("play") && pl.area === "surface");
});
