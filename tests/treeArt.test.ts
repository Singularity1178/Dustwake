// The tree and stump retexture: the surface's standing tree (art/trees.ts), the stump a felled tree leaves (the tree's
// "taken" state) and the stump that stands in the woods. Own file: node --test runs each file in a fresh process, so
// the sprite cache starts empty and the traces don't depend on other tests.
//
// It is art only: no prop moved, changed size, changed footprint, variant or id, no tile changed, and nothing that is
// saved changed, so there is no save version bump and no migration (pinned below). What moved among the existing
// goldens is told in tests/artRegistry.test.ts (the props): of 147 kinds exactly `tree` and `stump` differ.
//
// The point of the redraw, and so of most of what follows: the stump had a body of ten pixels where the tree's trunk
// was four, and the felled tree left a third, different stump. All three are painted from one trunk now
// (`trunkSpan`), and the tests measure the sprites themselves to hold them to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { PROP_ART, propSprite } from "../src/game/art/props";
import { TREE_SIZE, STUMP_SIZE, ROOTS, SHAPES, TREE_SEEDS, LEAF, CUT_FRESH, CUT_OLD, trunkSpan, crownForm } from "../src/game/art/trees";
import { RCanvas } from "./support/uiSnapshot";
import { Pen, mulberry, hex, type Sprite } from "../src/game/util";
import { propDef } from "../src/game/content/props";
import { HARVEST } from "../src/game/content/harvest";
import { buildSurface } from "../src/game/surface";
import { SAVE_VERSION } from "../src/game/world/save";

const GOLDEN = { trees: "2e8af012" };

/** One pass of one prop sprite with real pixels (the seed is art/props.ts makeProp's). */
function raster(kind: string, v: number, alt = false, emit = false): RCanvas {
  let out!: RCanvas;
  PROP_ART[kind](v, alt, (w, h, fn) => {
    out = new RCanvas(w, h);
    fn(new Pen(out.getContext() as unknown as CanvasRenderingContext2D, emit), mulberry(kind.length * 101 + v * 13 + (alt ? 7 : 0)));
    return { a: out, e: out, w, h, ax: w >> 1, ay: h } as unknown as Sprite;
  });
  return out;
}
const key = (c: string) => hex(c).join(",");
const px = (c: RCanvas, x: number, y: number) => { const i = (y * c.width + x) * 4; return c.data[i + 3] === 255 ? `${c.data[i]},${c.data[i + 1]},${c.data[i + 2]}` : ""; };
/** Width of the unbroken run of opaque pixels through the centre column on a row: the trunk, where nothing else touches it. */
function trunkWidth(c: RCanvas, z: number): number {
  const cx = c.width >> 1, y = c.height - 1 - z;
  let l = cx, r = cx - 1;
  while (l > 0 && px(c, l - 1, y)) l--;
  while (r < c.width - 1 && px(c, r + 1, y)) r++;
  return r - l + 1;
}
const lum = (c: RCanvas, x0: number, y0: number, x1: number, y1: number) => {
  let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * c.width + x) * 4; if (c.data[i + 3] !== 255) continue; s += c.data[i] + c.data[i + 1] + c.data[i + 2]; n += 3; }
  return n ? s / n : 0;
};
const silhouette = (c: RCanvas) => { let s = ""; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) s += px(c, x, y) ? "1" : "0"; return s; };

test("the retextured sprites are pixel-stable", () => {
  resetTrace();
  for (let v = 0; v < 3; v++) for (const alt of [false, true]) propSprite("tree", v, alt);
  for (let v = 0; v < 2; v++) propSprite("stump", v, false);
  assert.equal(traceHash(), GOLDEN.trees);
});

test("art only: sizes, anchors, footprints, what is harvested and what is saved are as they were", () => {
  assert.equal(SAVE_VERSION, 22, "the retexture changed no saved field");
  const tree = propSprite("tree", 0, false)!, taken = propSprite("tree", 0, true)!, stump = propSprite("stump", 0, false)!;
  // the standing tree is the size it always was, and stands on the same anchor
  assert.deepEqual([tree.w, tree.h, tree.ax, tree.ay], [34, 44, 17, 44]);
  assert.deepEqual([TREE_SIZE.w, TREE_SIZE.h], [34, 44]);
  // the stumps share one size, so a felled tree's stump and a stump of the woods are drawn on one footing
  assert.deepEqual([taken.w, taken.h, taken.ax, taken.ay], [STUMP_SIZE.w, STUMP_SIZE.h, STUMP_SIZE.w >> 1, STUMP_SIZE.h]);
  assert.deepEqual([stump.w, stump.h, stump.ax, stump.ay], [taken.w, taken.h, taken.ax, taken.ay]);
  assert.deepEqual([propDef("tree").box, propDef("stump").box, propDef("towntree").box], [[10, 6], [10, 5], [10, 6]]);
  assert.equal(propDef("tree").alt, "taken");
  assert.deepEqual(Object.keys(HARVEST).sort(), ["ironore", "log", "rock", "tree"], "a stump is still not harvestable");
  assert.deepEqual(HARVEST.tree, { hp: 4, perHit: { item: "wood", n: 1 }, final: { item: "wood", n: 2 }, tool: "axe" });
  assert.equal(propDef("towntree").art, "tree", "the town's trees are this tree");
  // every variant a builder places has a shape and a foot of its own
  const placed = buildSurface().props.filter((p) => p.kind === "tree" || p.kind === "stump");
  assert.ok(placed.some((p) => p.kind === "tree") && placed.some((p) => p.kind === "stump"));
  for (const p of placed) assert.ok((p.v ?? 0) < (p.kind === "tree" ? SHAPES.length : 2), `${p.kind} v${p.v}`);
  assert.equal(SHAPES.length, 3); assert.equal(ROOTS.length, 3); assert.equal(TREE_SEEDS.length, 3); assert.equal(LEAF.length, 3);
});

test("one trunk: the tree's trunk, the stump a felled tree leaves and the stump of the woods are the same width at every height", () => {
  for (const [kind, v, alt, cutZ] of [["tree", 0, false, 11], ["tree", 1, false, 11], ["tree", 2, false, 11], ["tree", 0, true, 8], ["tree", 1, true, 8], ["tree", 2, true, 8], ["stump", 0, false, 9], ["stump", 1, false, 12]] as const) {
    const c = raster(kind, v, alt), roots = ROOTS[v % ROOTS.length];
    // from above the roots to under the cut (or the crown): what is measured is `trunkSpan` and nothing else
    for (let z = 4; z <= cutZ - 2; z++) {
      const [l, r] = trunkSpan(z, roots);
      assert.equal(trunkWidth(c, z), r - l + 1, `${kind} v${v}${alt ? " taken" : ""} at ${z} up`);
    }
  }
  // so a stump is as thick as the tree it stands for: at every height they share, the same number of pixels, and
  // never the ten-pixel body against four that it was
  for (const v of [0, 1, 2]) {
    const tree = raster("tree", v), taken = raster("tree", v, true), stump = raster("stump", v & 1);
    for (let z = 4; z <= 6; z++) assert.equal(trunkWidth(taken, z), trunkWidth(tree, z), `felled stump ${v} at ${z}`);
    for (let z = 4; z <= 6; z++) assert.equal(trunkWidth(stump, z), trunkWidth(raster("tree", v & 1), z), `stump ${v & 1} at ${z}`);
  }
  for (const v of [0, 1, 2]) for (let z = 0; z < 24; z++) { const [l, r] = trunkSpan(z, ROOTS[v]); assert.ok(r - l + 1 <= 12 && r - l + 1 >= 6, `the trunk is 6 to 8 wide, 12 at the very foot (z ${z})`); }
  const [l0, r0] = trunkSpan(30, ROOTS[0]); assert.equal(r0 - l0 + 1, 6);
  // the footprint box is 10 wide: the trunk (8) stands well inside it, only the roots reach out
  assert.ok(trunkSpan(2, ROOTS[2])[1] - trunkSpan(2, ROOTS[2])[0] + 1 <= 8);
});

test("a stump stands inside its sprite on the anchor, from the ground up to a cut or a break", () => {
  for (const [kind, v, alt, top] of [["tree", 0, true, 8], ["tree", 2, true, 8], ["stump", 0, false, 9], ["stump", 1, false, 12]] as const) {
    const c = raster(kind, v, alt);
    let lowest = -1, highest = c.height;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px(c, x, y)) { lowest = Math.max(lowest, y); highest = Math.min(highest, y); }
    assert.equal(lowest, c.height - 1, `${kind} v${v}: the foot is on the ground row`);
    assert.ok(c.height - 1 - highest >= top + 2 && c.height - 1 - highest <= top + 8, `${kind} v${v}: it rises to its cut (${c.height - 1 - highest} up)`);
    assert.ok(trunkWidth(c, 5) >= 7 && trunkWidth(c, 5) <= 8, `${kind} v${v}: trunk-thick`);
  }
  // a stump of the woods is old (weathered wood), the felled tree's is fresh (pale and wet)
  const has = (c: RCanvas, cols: readonly string[]) => { let n = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (cols.map(key).includes(px(c, x, y))) n++; return n; };
  assert.ok(has(raster("tree", 0, true), CUT_FRESH) >= 6, "fresh cut");
  assert.equal(has(raster("tree", 0, true), CUT_OLD), 0);
  assert.ok(has(raster("stump", 0), CUT_OLD) >= 6, "weathered cut");
  assert.equal(has(raster("stump", 0), CUT_FRESH), 0);
  // the snapped one rises higher than the sawn one, to a ragged top
  const top = (c: RCanvas) => { for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px(c, x, y)) return y; return c.height; };
  assert.ok(top(raster("stump", 1)) < top(raster("stump", 0)) - 1);
});

test("a crown is one lit, outlined mass of leaf: every tone, lighter above than below, closed by its outline, no glow", () => {
  for (let v = 0; v < 3; v++) {
    const c = raster("tree", v), ramp = LEAF[v].map(key);
    const used = new Set<number>();
    for (let y = 0; y < 34; y++) for (let x = 0; x < c.width; x++) {
      const k = px(c, x, y), i = ramp.indexOf(k);
      if (i >= 0) used.add(i);
      // anything of the crown that borders clear sprite is its outline
      if (i > 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, out = nx < 0 || ny < 0 || nx >= c.width || ny >= c.height || (c.data[(ny * c.width + nx) * 4 + 3] === 0);
        assert.ok(!out, `v${v}: crown pixel ${x},${y} (tone ${i}) must not touch clear`);
      }
    }
    assert.ok([0, 1, 2, 3, 4].every((t) => used.has(t)), `v${v}: tones used ${[...used].sort()}`);
    // lit from the upper left: the upper-left quarter of the crown is lighter than the lower-right one
    assert.ok(lum(c, 4, 3, 16, 15) > lum(c, 18, 16, 30, 28) + 12, `v${v}: lit from the upper left`);
    // the crown stands over the trunk: the trunk is not seen above where the crown ends
    const e = raster("tree", v, false, true);
    assert.ok(e.data.every((x, i) => i % 4 === 3 || x === 0), `v${v}: no glow`);
  }
  // the trunk comes out under the crown, and the crown hides the top of it
  const c = raster("tree", 0);
  assert.ok(px(c, 17, 40) && px(c, 17, 34), "the trunk reaches the crown");
  assert.ok(!px(c, 17, 0) && !px(c, 0, 20), "the crown stands inside the sprite");
});

test("crowns: a form is a function of its seed, the variants are different, and the tree sways without breaking", () => {
  for (let v = 0; v < 3; v++) assert.deepEqual(crownForm(v), crownForm(v));
  const sil = [0, 1, 2].map((v) => silhouette(raster("tree", v)));
  assert.equal(new Set(sil).size, 3, "no two variants share a silhouette");
  // the host shifts the top 55% of a swaying sprite by a pixel (view/worldRenderer.ts drawSwaying): the crown has
  // to cover that row from end to end of the trunk, or the trunk would shear against the part below it
  const cut = Math.floor(TREE_SIZE.h * 0.55);
  for (let v = 0; v < 3; v++) { const c = raster("tree", v), ramp = LEAF[v].map(key); for (let x = 14; x <= 19; x++) assert.ok(ramp.includes(px(c, x, cut)), `v${v}: crown over the sway line at column ${x}`); }
  // the flare of the roots, not the trunk, is what the tree and its stump share at the foot
  for (let v = 0; v < 3; v++) { const [l, r] = trunkSpan(0, ROOTS[v]); assert.ok(r - l + 1 <= 12); assert.ok(l >= -6 && r <= 5); }
});
