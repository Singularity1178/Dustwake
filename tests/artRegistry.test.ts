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
import { TOWN_PROP_ART } from "../src/game/art/propsTown";
import { ITEM_ART, itemIcon, glyphPattern } from "../src/game/art/items";
import { rubbleSprite, pillarSprite, doorSprite, barsSprite, bakeRegion } from "../src/game/art/tiles";
import { GLYPHS } from "../src/game/content/glyphs";
import { buildSurface } from "../src/game/surface";
import { makeCanvas, Pen } from "../src/game/util";
import type { ItemId } from "../src/game/content/items";

// items: updated deliberately for the crown's retexture (its main stone is the High-Grade Ruby now); with the old
// crown swapped back in the list still hashes to the previous "6253c0e8", so no other legacy icon moved.
// props and tiles: updated deliberately for the dungeon audit (docs/ARCHITECTURE.md: "The dungeon audit").
// Compared pixel for pixel with the art as it was: of the prop sprites only `bed` and `brazier` differ
// (props was "e4c643ed"), and of the tile sprites only the cracked wall, redrawn as a stretch of the wall it
// stands in (tiles was "5eb324bb"); rubble, both pillars, the door and the bars are untouched.
// The entrance update (v14): props (was "9ff9b39a"): `buriedgate`, `forge`, `anvil`, `weaponrack` and
// `armorstand` were redrawn and eleven kinds added (ironore, toolboard, runetable, clayvat, husk, staffrack,
// wallhooks, armorpile, stairfoot, stairfall, stairlight); the 123 other sprites hash as before. surface (was
// "c332aec8"): only tiles inside 46-50,56-62 differ, where the round hollow and hump over the buried stair
// were taken out (compared pixel by pixel against the bake as it was).
const GOLDEN = { props: "b2f6aee3", items: "94b2678e", tiles: "c9958a0", glyphs: "25b715f1", surface: "6b2c4609" };

test("every PROP_ART sprite is pixel-identical", () => {
  resetTrace();
  // The surface's and the dungeon's sprites, in registry order. The market town's kinds were added after them
  // (art/propsTown.ts, checked in tests/town.test.ts) and are left out here, so this golden never has to move.
  for (const k of Object.keys(PROP_ART)) { if (k in TOWN_PROP_ART) continue; for (let v = 0; v < 4; v++) for (const alt of [false, true]) propSprite(k, v, alt); }
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
  // The wild as it was before the town: the old road west (cut last in the builder, with no rng) is left out, so
  // this golden proves that adding the road and the town's tile styles moved no pixel of the existing surface.
  const s = buildSurface({ westRoad: false });
  const c = makeCanvas(s.w * 16, s.h * 16);
  bakeRegion(c.ctx, s, 0, 0, s.w - 1, s.h - 1);
  assert.equal(traceHash(), GOLDEN.surface);
});
