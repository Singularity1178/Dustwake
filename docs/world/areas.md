# Areas

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

> Since v21 the surface is one area composed of sites, with zones, collision buckets and per-sector layout revisions: see [the overworld](overworld.md).

## Area: dimensions, identity, change propagation
- An `AreaData` carries its own `id`, `w` and `h`. Lighting (`computeVis`), background baking, collision, the camera clamp and the schematic all read those instead of global `MW/MH`. Adding the surface means adding a builder to `world/areas.ts`. `enterArea()` moves an actor between areas, and `Game.syncView()` rebuilds the view when the player's area changes. The tests travel to a fixture area of a different size.
- Props have **stable ids** (`kind@tx,ty`, or explicit ones like `ped0`), and loose items do too. Saves and prop-owned lights refer to these ids.
- **All mutation goes through `Area` methods.** `revision` counts all changes; `layoutRevision` tracks collision/layout, `interactionRevision` tracks interactables/light ownership, and `storageRevision` tracks contents. Storage deposits, fractional harvest progress and clock animation do not invalidate layout or interaction caches. Tile and decal changes also publish a padded dirty rectangle to subscribers.
  - Interactables and light reconciliation cache on `interactionRevision`; body-specific nav grids cache on `layoutRevision`. Save restoration and ritual changes also use Area methods.
  - `AreaView` merges dirty rects and catches up once per frame. It re-bakes only that region and re-traces visibility only for lights whose window overlaps it.
  - The old code instead called `bakeRegion` + `refreshLightsNear` + `buildInters` by hand at each call site, with hard-coded tile coordinates. The new re-bake region is always a superset of the old one, so the pixels are identical.
- Lights are **reconciled from world state**: area lights (prop-owned ones follow their prop), glowing items on props, socket lights and the core light. The registry is insertion-ordered, so lights accumulate in the same order as before.
