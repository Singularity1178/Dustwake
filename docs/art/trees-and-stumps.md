# Trees and stumps, redrawn

> Follows [Rocks and the stair, redrawn](rocks-and-stair.md). Index: [docs/index.md](../index.md).

Art only. Nothing here is simulated or saved: no prop moved or changed size, footprint, variant or id, no tile or style changed, the builders place what they placed, and `tree` is still the one harvestable (`HARVEST.tree`). So **there is no schema change and no migration** (`SAVE_VERSION` stays 20; `tests/treeArt.test.ts` pins the sizes, anchors and boxes that claim rests on). It was done the way the rocks were: render it, look, fix, render again (`scripts/treePreview.mjs`).

What was wrong:

- **The woods were the one thing in the wild still in the old style.** After the rocks were redrawn (cut chunks, one light, an outline, four tones, crevices) the trees were still the first sprites of the game: a trunk that was a four-pixel brown stick with two stripes, and a crown that was five flat discs of leaf, each a dotted circle with no outline, so a tree standing beside a rock looked like another game.
- **The stump was not the tree's.** The trunk of the tree was 6 pixels wide, outline included (4 inside), and the stump's body was 10 (8 inside): two and a half times as thick. The stump a felled tree leaves (the tree's depleted state, `taken`) was a third drawing of its own, just as thick. Three trunks, and only the tree's was a tree's.

### One trunk (`art/trees.ts`)

`trunkSpan(z, roots)` is the only place the trunk's width is decided: eight pixels at the foot, seven from seven pixels up, six from eleven (what a tree is under its crown), the roots adding up to two pixels each side of the first two rows. The standing tree, the stump a felled tree leaves (the tree's `taken` state) and the stump that stands in the woods are all painted from it by one function (`paintTrunk`), with the same bark, and each tree variant has its own `ROOTS`, so a felled tree's stump has the foot of the tree it was. A stump is therefore exactly as thick as the tree it was cut from, at the height it was cut. A cut at height `z` is a face as wide as the trunk is at `z`. `tests/treeArt.test.ts` does not trust the code to say so: it rasterises every sprite and measures the unbroken run of pixels through the trunk at every height, and compares it with `trunkSpan` and with the tree's.

The trunk is a round post lit like everything else: the west edge and first columns light, the middle mid, the east shaded, with bark furrows running down in strips (a hash of column and height, so the same bark on the tree and its stump), a few bright flecks, an outline down both sides, the foot in its own shade (not a black plinth), moss up the west foot of some, and grass round it, never over it. Under the crown it is a tone darker, in the crown's shadow.

### The crown

A crown is not a stack of discs. It is a heap of leaf masses, each a ball in space (`crownForm(v)`: a golden-angle spiral of big masses inside an elliptical envelope, a ring of smaller lobes on its rim; higher and nearer the eye toward the middle). It is painted the way `paintRock` paints a chunk: every pixel casts a ray `P(t) = (x, y + t, t)`, the last point of it inside a ball is what shows, and the ball's surface angle to the rocks' own `LIGHT` picks the tone, with a share of the whole crown's dome so it reads as one rounded mass, lit on the upper left and dark under and on the east. A leaf mass in front of another leaves the one behind in a dark seam; the silhouette is outlined; a few short bright strokes lie on what is lit and a few dark ones in the shade. A ball facing the eye is already well lit by that light, so the thresholds sit higher than the rocks' (the first draft had a whole crown in the two lightest tones and no shade side). Three leaf ramps (a green, an olive, a deeper green), each outline, deep shade, shade, mid, light, glint. The shape and the leaf masses are data: `SHAPES` and `TREE_SEEDS`, picked by eye with `node scripts/treePreview.mjs pick`, which draws forty crowns a shape under their seed numbers (the way `ROCK_SEEDS` was).

The sprite is the size and anchor it was (34 x 44, the trunk on the column of the anchor), so the footprint box, the shade decals under trees and the sway are untouched. The host sways the top 55% of the sprite by a pixel; the crown covers that row across the whole trunk, and a test says so.

### The stumps

Both the stump of a felled tree and the stump of the woods are `drawStump`. The cut is a sawn face (`paintCut`): an ellipse as wide as the trunk at that height, outlined at the back and the sides; its front edge is the bark's lit lip, which runs on into the body (an outline across the front made it a lid on a box); the wood across it takes the light, brightest on the west, shaded on the east and the front, with the pith one dark pixel. (Rings did not survive: on a face five pixels wide they came out as a face. They were tried and taken out.) What differs is its age and how it ended:

- **A felled tree's stump** (`tree`, `taken`): cut at eight pixels, the wood pale and wet, the pale chips the axe took out of it on the ground either side.
- **A stump in the woods, variant 0**: cut at nine, weathered grey-brown wood with a split in it, moss on the back rim and the west foot.
- **A stump in the woods, variant 1**: not cut but snapped, at twelve, in a slant of split fibres, pale where the light is on them and dark on the east, a long splinter standing out of it.

### Goldens and tests

One hash moved, checked against the tree as it was. Sprite by sprite (trace hash per kind, six variants, both states): of 147 kinds exactly two differ, `tree` and `stump`; none was added or removed. (`towntree` draws the tree, and follows it.) `surface` did not move. The tests' own golden is in `tests/treeArt.test.ts`, which holds the rest: that it is art only (sizes, anchors, boxes, harvest, save version, every placed variant has a shape); the trunk is one trunk (above); stumps stand on the ground row and rise to their cut, fresh against weathered wood, the snapped one higher than the sawn; the crown uses its tones, is lighter on the upper left than on the lower right, never touches clear sprite except by its outline, covers the sway line and emits nothing; and that no two variants share a silhouette.

`node scripts/treePreview.mjs` (`tests/support/treeSnapshot.ts`) renders it all through the real art and the real host: a labelled sheet of every sprite beside its neighbours, a sheet that holds each tree, its felled stump and the standing stumps against one ruler on a shared ground line, close-ups, and the surface at noon and at night with trees felled among standing ones.

**Left alone on purpose.** `sapling`, `bush`, `log` and `fern` (still the older leaf blobs), the sprite sizes and anchors, and the `shade` and `roots` decals the surface builder lays under trees.
