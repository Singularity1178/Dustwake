// Procedural art regression: renders every pre-existing prop sprite variant,
// item icon and the full dungeon background bake through a recording fake
// canvas, and compares the draw-call trace hash with a golden value captured
// from the original `switch`-based art.ts (before the registry refactor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { propSprite } from "../src/game/art/props";
import { itemIcon } from "../src/game/art/items";
import { bakeRegion } from "../src/game/art/tiles";
import { buildDungeon } from "../src/game/map";
import { makeCanvas } from "../src/game/util";
import type { ItemId } from "../src/game/content/items";

/** Prop kinds that existed before this change (sprite keys in art.ts). */
const LEGACY_PROPS = [
  "torch", "banner", "chains", "bookshelf", "shelfrow", "shelf_fallen", "table", "lectern", "chair", "chair_fallen",
  "bed", "footlocker", "weaponrack", "limbrack", "armorstand", "barrel", "crate", "sack", "statue", "statue_fallen",
  "throne", "maptable", "altar", "pew", "workbench", "forge", "anvil", "cradle", "slab", "parts", "hearth",
  "longtable", "bench", "chest", "pot", "brazier", "fountain", "pedestal", "mushrooms", "skeleton", "candles",
  "ladder", "bucket",
];
const LEGACY_ITEMS: ItemId[] = ["chisel", "arm", "key", "core", "glyph0", "glyph1", "glyph2", "glyph3", "schematic", "crown", "goblet", "coin"];

// bake: updated deliberately for the collapsed SURFACE GATE (map.ts): the
// corridor's floor style became spilled earth, two rubble tiles at the corridor
// mouth, and 39 entrance decals appended after the procedural pass (all within
// tiles x 32-39, y 46-49). Everything else in the dungeon is unchanged
// (was "558f8993").
// items: updated deliberately for the crown's retexture (its main stone is now the High-Grade Ruby, set in the
// band): with the old crown function swapped back in, this list still hashes to the previous "6cae5365", so
// no other legacy icon moved.
const GOLDEN = { props: "9b046139", items: "644c5ccf", bake: "c475d9be" };

test("legacy prop sprites are pixel-identical", () => {
  resetTrace();
  for (const k of LEGACY_PROPS) for (let v = 0; v < 4; v++) for (const alt of [false, true]) propSprite(k, v, alt);
  assert.equal(traceHash(), GOLDEN.props);
});

test("legacy item icons are pixel-identical", () => {
  resetTrace();
  for (const id of LEGACY_ITEMS) itemIcon(id);
  assert.equal(traceHash(), GOLDEN.items);
});

test("dungeon background bake is pixel-identical", () => {
  resetTrace();
  const d = buildDungeon();
  const c = makeCanvas(d.w * 16, d.h * 16);
  bakeRegion(c.ctx, d, 0, 0, d.w - 1, d.h - 1);
  assert.equal(traceHash(), GOLDEN.bake);
});
