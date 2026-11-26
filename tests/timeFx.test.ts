// The game speed's look (view/timeFx.ts): pause and 2x stay quiet, 4x and 8x are plain, 1x is untouched, the look
// eases between speeds, nothing strobes, the setting turns it off, and it shows over the play screen only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as { localStorage?: unknown };
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { createWorld } from "../src/game/world/world";
import { GAME_SPEEDS } from "../src/game/core/clock";
import { settingDef } from "../src/game/ui/settings";
import { TimeFx, TIME_LOOKS, NEUTRAL, lookFor, type TimeLook } from "../src/game/view/timeFx";

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const ctx = () => canvas().getContext("2d")!;

/** How strongly a look shows: the screen-darkening and colour work it does, and the motion it adds. */
const grade = (l: TimeLook) => Math.abs(l.sat - 1) + Math.abs(l.bright - 1) + Math.abs(l.contrast - 1) + Math.abs(l.hue) / 40;
const overlay = (l: TimeLook) => l.vigCool + l.vigWarm + l.streakN * l.streakA + l.sweepA;
const strength = (l: TimeLook) => grade(l) + overlay(l);
const settle = (fx: TimeFx, speed: number, on = true, secs = 4) => { for (let i = 0; i < secs * 60; i++) fx.update(1 / 60, speed, on); };

test("looks: 1x is nothing; pause and 2x are quiet; 4x and 8x are plainly stronger, in order", () => {
  assert.equal(strength(TIME_LOOKS[1]), 0, "1x is the baseline");
  const [p, x2, x4, x8] = [0, 2, 4, 8].map((s) => strength(lookFor(s)));
  assert.ok(p > 0 && x2 > 0, "pause and 2x have an effect");
  assert.ok(x2 < x4 && x4 < x8, "2x < 4x < 8x");
  assert.ok(p < x4 * 0.6 && x2 < x4 * 0.4, "pause and 2x are well under 4x (they are lived in)");
  assert.ok(x4 > x2 * 2.5 && x8 > x4 * 1.5, "4x and 8x are clearly stepped up");
  assert.equal(strength(lookFor(3)), 0, "an unknown speed is 1x");
  for (const s of GAME_SPEEDS) assert.ok(s === 0 ? TIME_LOOKS[s].sat < 1 : TIME_LOOKS[s].sat >= 1, "pause drains colour; running speeds never do");
});

test("looks: pause shows a PAUSED label, only sped-up has streaks, no speed is tinted, and nothing pulses fast enough to strobe", () => {
  const p = TIME_LOOKS[0];
  assert.ok(p.vigCool > 0 && p.vigWarm === 0 && p.streakN === 0, "pause: a hush, no motion lines");
  assert.equal(p.pauseA, 1, "pause: the label is fully shown");
  for (const s of GAME_SPEEDS) {
    const l = TIME_LOOKS[s] as unknown as Record<string, number>;
    assert.ok(!("tintA" in l) && !("fringeA" in l) && l.hue === 0, `${s}: no colour wash, no coloured fringe, no hue shift`);
    if (s !== 0) assert.equal(l.pauseA, 0, "only pause has the label");
  }
  for (const s of [2, 4, 8] as const) {
    const l = TIME_LOOKS[s];
    assert.ok(l.vigWarm > 0 && l.vigCool === 0 && l.streakN > 0, `${s}x: a vignette with streaks`);
  }
  assert.equal(TIME_LOOKS[2].sweepA, 0, "2x keeps to the quiet effects");
  assert.ok(TIME_LOOKS[4].sweepA > 0 && TIME_LOOKS[8].sweepA > TIME_LOOKS[4].sweepA);
  for (const s of GAME_SPEEDS) {
    assert.ok(TIME_LOOKS[s].pulseHz <= 1, "the breathing stays under 1 Hz");
    assert.ok(TIME_LOOKS[s].pulseAmp <= 0.06, "and shallow");
  }
});

test("easing: a speed change blends over a fraction of a second and settles on the look; putting it away settles on nothing", () => {
  const fx = new TimeFx();
  assert.ok(!fx.visible);
  fx.update(1 / 60, 8, true);
  assert.ok(fx.cur.vigWarm > 0 && fx.cur.vigWarm < TIME_LOOKS[8].vigWarm * 0.2, "one frame in: only just begun");
  settle(fx, 8);
  assert.ok(Math.abs(fx.cur.vigWarm - TIME_LOOKS[8].vigWarm) < 0.005 && Math.abs(fx.cur.sat - TIME_LOOKS[8].sat) < 0.005, "settled on 8x");
  // 8x -> pause passes through the middle, never jumping
  let prev = fx.cur.sat, worst = 0;
  for (let i = 0; i < 120; i++) { fx.update(1 / 60, 0, true); worst = Math.max(worst, Math.abs(fx.cur.sat - prev)); prev = fx.cur.sat; }
  assert.ok(worst < 0.06, `no jump in the grade between frames (${worst.toFixed(3)})`);
  assert.ok(Math.abs(fx.cur.sat - TIME_LOOKS[0].sat) < 0.01, "settled on pause");
  settle(fx, 0, false);
  assert.ok(!fx.visible && fx.filter() === "", "put away: nothing visible and no filter");
  assert.deepEqual(fx.cur, { ...NEUTRAL });
});

test("filter: empty at 1x, a desaturate when paused, a saturate / contrast grade at 8x (never a hue shift)", () => {
  const fx = new TimeFx();
  settle(fx, 1);
  assert.equal(fx.filter(), "");
  settle(fx, 0);
  assert.match(fx.filter(), /^saturate\(0\.8\d\)/);
  settle(fx, 8);
  assert.match(fx.filter(), /saturate\(1\.2\d\)/);
  assert.match(fx.filter(), /contrast\(1\.0\d\)/);
  assert.doesNotMatch(fx.filter(), /hue-rotate/);
  const el = { style: { filter: "" } };
  fx.applyFilter(el);
  assert.equal(el.style.filter, fx.filter());
  assert.doesNotThrow(() => fx.applyFilter({}), "a canvas without a style is left alone");
});

test("drawing: nothing at 1x; something at pause and every faster speed; streaks stay near the top and bottom", () => {
  const draw = (speed: number) => {
    const fx = new TimeFx(), c = ctx();
    settle(fx, speed);
    resetTrace(); fx.render(c);
    return traceHash();
  };
  resetTrace();
  const empty = traceHash();
  assert.equal(draw(1), empty, "1x draws nothing");
  const hashes = new Set([0, 2, 4, 8].map(draw));
  assert.ok(!hashes.has(empty) && hashes.size === 4, "each effect speed draws something of its own");

  // where the streaks go
  const fx = new TimeFx();
  settle(fx, 8);
  const rects: { y: number; w: number; h: number }[] = [];
  const spy = { fillStyle: "", globalAlpha: 1, drawImage() {}, fillRect: (_x: number, y: number, w: number, h: number) => { if (h === 1) rects.push({ y, w, h }); } } as unknown as CanvasRenderingContext2D;
  fx.render(spy);
  assert.ok(rects.length >= 28, "8x: the whole pool is out");
  assert.ok(rects.every((r) => r.y < 76 || r.y > 103), "no streak crosses the middle band of the screen");
  const outer = rects.filter((r) => r.y < 45 || r.y > 135).length;
  assert.ok(outer / rects.length >= 0.65, "most streaks hug the top and bottom edges, the middle stays clear to play in");
});

test("streaks drift rightward and wrap; faster speeds move them faster", () => {
  const travel = (speed: number) => {
    const fx = new TimeFx(), xs: number[] = [];
    settle(fx, speed);
    const spy = { fillStyle: "", globalAlpha: 1, drawImage() {}, fillRect: (x: number, _y: number, _w: number, h: number) => { if (h === 1) xs.push(x); } } as unknown as CanvasRenderingContext2D;
    fx.render(spy); const a = xs.slice(0, 1)[0]; xs.length = 0;
    fx.update(0.05, speed, true); fx.render(spy);
    return xs[0] - a;
  };
  assert.ok(travel(2) > 0, "moves right");
  assert.ok(travel(8) > travel(4) && travel(4) > travel(2), "8x streaks outrun 4x, which outrun 2x");
});

test("setting: Time speed effects is a Display toggle, on by default", () => {
  const d = settingDef("timeFx")!;
  assert.ok(d && d.kind === "toggle" && d.category === "display" && d.def === true);
  assert.ok(d.label.length <= 28, "the label fits the settings list");
});

function host(seed = 61) {
  const g = new Game(canvas(), canvas());
  g.resume(createWorld(seed));
  return g;
}
const press = (g: Game, k: string) => { g.keyDown(k); g.update(1 / 60); g.render(); g.keyUp(k); };
const run = (g: Game, secs: number) => { for (let i = 0; i < secs * 60; i++) { g.update(1 / 60); g.render(); } };

test("host: the play screen shows the speed's look; 1x shows none; the setting turns it off; menus put it away", () => {
  const g = host();
  run(g, 1);
  assert.ok(!g.timeFx.visible, "1x: nothing");
  press(g, "1");
  assert.equal(g.speed, 0);
  run(g, 2);
  assert.ok(g.timeFx.visible && g.timeFx.cur.vigCool > 0.2, "paused: the hush");
  press(g, "5");
  run(g, 2);
  assert.ok(g.timeFx.cur.vigWarm > 0.35 && g.timeFx.cur.streakN > 0.9, "8x: the strong look");
  press(g, "2");
  run(g, 2);
  assert.ok(!g.timeFx.visible, "back to 1x: gone");

  press(g, "5"); run(g, 2);
  g.settings.set("timeFx", false);
  run(g, 2);
  assert.ok(!g.timeFx.visible, "setting off: put away");
  g.settings.set("timeFx", true);
  run(g, 2);
  assert.ok(g.timeFx.visible, "setting back on: it returns");

  g.systemMenu.open();
  run(g, 1.5);
  assert.ok(!g.timeFx.visible, "the system menu over the world puts it away");
  g.systemMenu.close();
  run(g, 2);
  assert.ok(g.timeFx.visible, "and it is back on the play screen");
});

test("host: the look is presentation only: the same world at 8x with and without the effects", () => {
  const a = host(), b = host();
  b.settings.set("timeFx", false);
  for (const g of [a, b]) { press(g, "5"); }
  for (let i = 0; i < 120; i++) { a.update(1 / 60); a.render(); b.update(1 / 60); b.render(); }
  assert.equal(a.world.time, b.world.time);
  assert.equal(a.pl.x, b.pl.x);
  assert.equal(a.pl.y, b.pl.y);
});
