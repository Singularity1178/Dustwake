// Runes: the Rune of Swift's speed (through the sim) and the Rune of Glow's light
// (through the light system), both only while equipped, both data-driven; and
// carving them from cut stone end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { player, currentArea, setFlag, enterArea, type World } from "../src/game/world/world";
import { addItems, countItem } from "../src/game/sim/inventory";
import { wearFromSlot, takeOffGear } from "../src/game/sim/commands";
import { orderCraft } from "../src/game/sim/crafting";
import { speedMultiplier, golemGlow, runeMarks, activeGear } from "../src/game/sim/gear";
import { RUNE_SWIFT_SPEED_BONUS, RUNE_GLOW_LIGHT, GOLEM_LIGHT } from "../src/game/content/gear";
import { ITEMS, effectLines, type ItemId } from "../src/game/content/items";
import { FLAGS } from "../src/game/content/flags";
import { FONT_GLYPHS } from "../src/game/font";
import { Lighting, applyGlow, computeVis, makeLight } from "../src/game/light";
import { TS, T } from "../src/game/content/tiles";
import { newWorld, frame, frames, useOn, propItem } from "./helpers";

const give = (w: World, id: ItemId) => addItems(w, player(w), id, 1);
const slotOf = (w: World, id: ItemId) => player(w).inventory.findIndex((s) => s?.item === id);
const wear = (w: World, id: ItemId) => assert.equal(wearFromSlot(w, player(w), slotOf(w, id)), "ok");

/** The golem in a cleared patch of the surface, walking right for `n` frames: how far it gets. */
function walk(runes: ItemId[], n = 90) {
  const w = newWorld(); frame(w);
  const pl = player(w);
  setFlag(w, FLAGS.golemArm);
  enterArea(w, pl, "surface", 10 * TS + 8, 50 * TS + 14);
  const a = currentArea(w);
  for (let ty = 46; ty <= 54; ty++) for (let tx = 4; tx <= 80; tx++) a.setTile(tx, ty, T.FLOOR);
  a.props = a.props.filter((p) => Math.abs(p.y - pl.y) > 90);
  for (const id of runes) { give(w, id); wear(w, id); }
  const x0 = pl.x;
  for (let i = 0; i < n; i++) frame(w, { ix: 1, iy: 0, use: false });
  return pl.x - x0;
}

test("Rune of Swift: +150% speed (2.5x) through the sim, only while worn, one tunable constant", () => {
  assert.equal(RUNE_SWIFT_SPEED_BONUS, 1.5);
  assert.equal(ITEMS.rune_swift.worn!.speed, RUNE_SWIFT_SPEED_BONUS, "the item row reads the constant");
  const w = newWorld(); frame(w);
  assert.equal(speedMultiplier(w, player(w)), 1);
  give(w, "rune_swift");
  assert.equal(speedMultiplier(w, player(w)), 1, "carried in the pack: nothing");
  wear(w, "rune_swift");
  assert.equal(speedMultiplier(w, player(w)), 2.5);
  assert.equal(takeOffGear(w, player(w), "rune0"), "ok");
  assert.equal(speedMultiplier(w, player(w)), 1, "taken off: the effect is gone");
  // movement itself: the same walk, with and without it
  const base = walk([]), fast = walk(["rune_swift"]);
  assert.ok(base > 20, "the golem actually walks");
  assert.ok(fast / base > 2.2 && fast / base < 2.8, `ratio ${(fast / base).toFixed(2)} is about 2.5x`);
});

test("Rune of Glow: a bright white light in a wider radius than the standard glow, only while worn, applied by the light system", () => {
  const w = newWorld(); frame(w);
  const pl = player(w);
  assert.deepEqual(golemGlow(w, pl), GOLEM_LIGHT);
  give(w, "rune_glow");
  assert.deepEqual(golemGlow(w, pl), GOLEM_LIGHT, "in the pack: standard glow");
  wear(w, "rune_glow");
  const g = golemGlow(w, pl);
  assert.deepEqual(g, RUNE_GLOW_LIGHT);
  assert.ok(g.rad > GOLEM_LIGHT.rad);
  assert.deepEqual(g.col, [1, 1, 1], "white");
  assert.ok(g.int >= GOLEM_LIGHT.int, "at least as bright");
  // the light object follows it, and a wider reach invalidates the traced visibility
  const L = makeLight(100, 100, GOLEM_LIGHT.rad, GOLEM_LIGHT.col, 0, 0, "golem");
  L.vx = 100;
  assert.equal(applyGlow(L, GOLEM_LIGHT), false); assert.equal(L.vx, 100, "no change, no re-trace");
  assert.equal(applyGlow(L, g), true);
  assert.deepEqual([L.rad, L.r, L.g, L.b, L.glow, L.vx], [g.rad, 1, 1, 1, g.int, -999]);
  assert.equal(takeOffGear(w, pl, "rune0"), "ok");
  assert.deepEqual(golemGlow(w, pl), GOLEM_LIGHT, "taken off: standard glow again");
});

test("the dark is easier to see in: lit pixels beyond the standard radius, and white instead of amber", () => {
  const W = 320, H = 180, grid = new Uint8Array(40 * 24).fill(T.FLOOR);
  const area = { grid, w: 40, h: 24 };
  const light = (g: typeof GOLEM_LIGHT) => {
    const L = makeLight(160, 90, g.rad, g.col, 1, 0);
    L.cur = 1; applyGlow(L, g); computeVis(L, area);
    const lt = new Lighting(W, H);
    lt.accumulate([L], 0, 0);
    return lt;
  };
  const base = light(GOLEM_LIGHT), rune = light(RUNE_GLOW_LIGHT);
  const at = (lt: Lighting, x: number, y: number) => [lt.ar[y * W + x], lt.ag[y * W + x], lt.ab[y * W + x]];
  // 140 px away: dark for the standard glow, lit with the rune
  assert.deepEqual(at(base, 300, 90), [0, 0, 0]);
  assert.ok(at(rune, 300, 90)[0] > 0.01);
  const lit = (lt: Lighting) => lt.ar.reduce((s, v) => s + (v > 0.02 ? 1 : 0), 0);
  assert.ok(lit(rune) > lit(base) * 1.5, "a much larger lit area");
  // white: equal channels (the standard glow is warm: red > blue)
  const [r, g, b] = at(rune, 200, 90);
  assert.ok(Math.abs(r - g) < 1e-6 && Math.abs(g - b) < 1e-6);
  const [r0, , b0] = at(base, 200, 90);
  assert.ok(r0 > b0);
});

test("both runes together once a second slot is open: effects combine", () => {
  const w = newWorld(); frame(w);
  setFlag(w, FLAGS.slotRune1);
  give(w, "rune_swift"); give(w, "rune_glow");
  wear(w, "rune_swift"); wear(w, "rune_glow");
  const pl = player(w);
  assert.deepEqual(activeGear(w, pl).sort(), ["rune_glow", "rune_swift"]);
  assert.equal(speedMultiplier(w, pl), 2.5);
  assert.deepEqual(golemGlow(w, pl), RUNE_GLOW_LIGHT);
  // the body shows what is worn: a sigil per worn rune, in slot order
  const marks = runeMarks(w, pl);
  assert.deepEqual(marks.map((m) => m?.col ?? null), [ITEMS.rune_swift.worn!.mark!.col, ITEMS.rune_glow.worn!.mark!.col, null, null]);
});

test("effects are data: a new rune is just a new row (speeds add, the widest light wins), no code change", () => {
  const w = newWorld(); frame(w);
  setFlag(w, FLAGS.slotRune1); setFlag(w, FLAGS.slotRune2);
  const items = ITEMS as unknown as Record<string, unknown>;
  items.rune_test = { name: "RUNE OF TEST", tags: ["rune"], wear: { kind: "rune" }, worn: { speed: 0.5, light: { rad: 300, col: [0.5, 1, 0.5], int: 1 } } };
  try {
    give(w, "rune_swift"); give(w, "rune_glow"); give(w, "rune_test" as ItemId);
    for (const id of ["rune_swift", "rune_glow", "rune_test"] as ItemId[]) wear(w, id);
    const pl = player(w);
    assert.equal(speedMultiplier(w, pl), 1 + 1.5 + 0.5);
    assert.equal(golemGlow(w, pl).rad, 300);
    assert.deepEqual(effectLines("rune_test" as ItemId), ["WORN: SPEED X1.5", "WORN: BRIGHT WHITE LIGHT X2.8"]);
  } finally { delete items.rune_test; }
  for (const id of ["rune_swift", "rune_glow"] as ItemId[]) assert.ok(effectLines(id).length > 0 && effectLines(id).every((l) => [...l].every((c) => FONT_GLYPHS.has(c)) && l.length <= 34), id);
});

test("carving end to end: stone -> cut stone -> rune (chisel carried) -> worn -> effect", () => {
  const w = newWorld(); frame(w);
  const pl = player(w);
  useOn(w, propItem(w, "workbench@13.5,37")); // the tutorial's chisel
  setFlag(w, FLAGS.knowBuild);
  const bench = currentArea(w).prop("workbench@13.5,37")!;
  pl.x = bench.x; pl.y = bench.y + 12; pl.facing = "up";
  addItems(w, pl, "stone", 6);
  for (const id of ["cut_stone", "cut_stone", "rune_glow"]) { assert.equal(orderCraft(w, pl, "crafting", id, bench.id), true, id); let g = 0; while (pl.task && g++ < 600) frame(w); }
  assert.equal(countItem(pl, "rune_glow"), 1);
  assert.equal(countItem(pl, "stone"), 0);
  wear(w, "rune_glow");
  assert.equal(golemGlow(w, pl).rad, RUNE_GLOW_LIGHT.rad);
  frames(w, 3);
  assert.equal(pl.gear.rune0, "rune_glow");
});
