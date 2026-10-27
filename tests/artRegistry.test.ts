// Procedural art regression for EVERYTHING the art modules draw, captured
// before art.ts was split into src/game/art/* (tests/art.test.ts only covers
// the pre-registry legacy sprites and the dungeon bake). Every PROP_ART kind
// (4 variants x alt), every ITEM_ART icon, the tile-standing sprites, glyph
// patterns and the full surface bake go through the recording fake canvas and
// are compared with golden draw-call trace hashes.
//
// Its own file on purpose: node --test runs each file in a fresh process, so
// the shared sprite cache starts empty and the traces don't depend on which
// other tests ran first. Keep the order of the tests below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { PROP_ART, propSprite } from "../src/game/art/props";
import { ITEM_ART, itemIcon, glyphPattern } from "../src/game/art/items";
import { rubbleSprite, pillarSprite, doorSprite, barsSprite, bakeRegion } from "../src/game/art/tiles";
import { GLYPHS } from "../src/game/content/glyphs";
import { buildSurface } from "../src/game/surface";
import { makeCanvas, Pen } from "../src/game/util";
import type { ItemId } from "../src/game/content/items";

const GOLDEN = { props: "e4c643ed", items: "6253c0e8", tiles: "5eb324bb", glyphs: "25b715f1", surface: "c332aec8" };

test("every PROP_ART sprite is pixel-identical", () => {
  resetTrace();
  for (const k of Object.keys(PROP_ART)) for (let v = 0; v < 4; v++) for (const alt of [false, true]) propSprite(k, v, alt);
  assert.equal(traceHash(), GOLDEN.props);
});

// The icons that existed before crafted materials, runes and slot silhouettes, in their original registry order.
// Items added since have their own golden below (tests/gearArt.test.ts); this one must never move.
const LEGACY_ITEMS: ItemId[] = ["chisel", "arm", "key", "core", "schematic", "crown", "goblet", "coin", "glyph0", "glyph1", "glyph2", "glyph3", "wood", "stone", "book_build", "book_repair", "basket"];

test("every ITEM_ART icon is pixel-identical", () => {
  resetTrace();
  for (const id of LEGACY_ITEMS) itemIcon(id);
  assert.equal(traceHash(), GOLDEN.items);
  assert.ok(LEGACY_ITEMS.every((id) => id in ITEM_ART));
});

test("tile sprites (rubble, cracked wall, pillars, door, bars) are pixel-identical", () => {
  resetTrace();
  for (let v = 0; v < 3; v++) for (const cracked of [false, true]) rubbleSprite(v, cracked);
  pillarSprite(false); pillarSprite(true); doorSprite(); barsSprite();
  assert.equal(traceHash(), GOLDEN.tiles);
});

test("glyph patterns (lit and unlit) are pixel-identical", () => {
  resetTrace();
  const c = makeCanvas(16, 16);
  for (const glow of [false, true]) {
    const p = new Pen(c.ctx, glow);
    GLYPHS.forEach((g, i) => glyphPattern(p, i, 1, 1, g.color, glow));
  }
  assert.equal(traceHash(), GOLDEN.glyphs);
});

test("surface background bake is pixel-identical", () => {
  resetTrace();
  const s = buildSurface();
  const c = makeCanvas(s.w * 16, s.h * 16);
  bakeRegion(c.ctx, s, 0, 0, s.w - 1, s.h - 1);
  assert.equal(traceHash(), GOLDEN.surface);
});
