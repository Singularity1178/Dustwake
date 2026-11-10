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
// props and bake: updated deliberately for the dungeon audit (docs/ARCHITECTURE.md: "The dungeon audit").
// Compared pixel for pixel with the art and the builder as they were before it:
//   props (was "9b046139"): of every prop sprite only `bed` (no black band across the unmade cot; two new
//     variants with the head to the south) and `brazier` (a tripod that shows on dark tiles) differ.
//   bake (was "c475d9be"): only the cracked wall's two tiles and the six round them differ (it bakes as wall
//     mass now: tiles 46-48,9-12), and tiles 32-33,48-50 and 38,48-50, where three root decals at the SURFACE
//     GATE were moved off the top of the south wall. The 667 other decals are where they were: the throne
//     hall's pillars were re-spaced without disturbing the scatter (map.ts).
// The entrance update (v14) redrew the artificery's smelter and anvil and the armory's rack and stand, and laid
// the stair up to the surface. Checked against the tree as it was, sprite by sprite and pixel by pixel:
//   props (was "4dffe010"): of the legacy sprites only `forge`, `anvil`, `weaponrack` and `armorstand` differ
//     (the town keeps the old rack and stand as `shoprack` / `shopstand`).
//   bake (was "21fe34d"): 35 tiles differ, all meant to: the stair (tiles 34-37,50-55 and the two wall tiles
//     beside its last row: steps under the fall, where there was earth and wall) and the six decals added to the
//     two rooms (scorch 5-6,40-41; chalk and paper 6,8,9,44; fallen weapons 65,8 and 63,9).
const GOLDEN = { props: "e200e828", items: "7dcab441", bake: "d198b0dd" };

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
