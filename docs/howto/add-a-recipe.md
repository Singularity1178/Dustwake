# How to add a recipe

> Index: [docs/index.md](../index.md). Background: [content/data.md](../content/data.md), [sim/building.md](../sim/building.md), [sim/storage.md](../sim/storage.md).

**A build recipe** (something placed in the world): add a row to `RECIPES` in `content/build.ts` with its `prop` kind, `cost` (`{ item, n }` rows), category and placement rule. The prop kind must exist in `PROPS` (`content/props.ts`) with art in `PROP_ART` (`art/props.ts`). Recipes are analysis-gated: give the prop something to scan, or grant the `analysis.<id>` flag where the story teaches it.

**A station recipe** (crafted at a bench, smelter or anvil): add a row to `CRAFT_RECIPES` in `content/crafting.ts` with its `station`, tab, inputs and output. Names are drawn in the bitmap font: uppercase letters, digits and the font's punctuation.

**Check it**: `node scripts/lint-content.mjs` (every item, prop and station resolves; every name fits the font), then `npm test` (`tests/build.test.ts`, `tests/crafting.test.ts`). A recipe that changes what saved props refund needs a save migration (see [world/saves.md](../world/saves.md): v9 is the precedent).
