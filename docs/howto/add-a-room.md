# How to add a room or an area kind

> Index: [docs/index.md](../index.md). Background: [world/areas.md](../world/areas.md), [world/dynamic-areas.md](../world/dynamic-areas.md).

**An authored room** (a shop interior, a hall): write a deterministic builder returning `AreaData` (`townInteriors.ts` shows the pattern: `areaKit(w, h)`, a floor rect, walls, props with `Pt`, spots, a portal pair) and add it to `AREAS` in `world/areas.ts`. The area must be at least the widest view (40 x 22.5 tiles) so the camera never runs off its edge. Declare portals in pairs: the room's door and the street's door point at each other. Keep ids stable: saves diff against the builder.

**A generated kind** (floors, caves, outposts): write `(spec: AreaSpec) => AreaData` in `world/areaSpec.ts`, deterministic in `spec.seed`, and register it in `AREA_KINDS`. End with `finish(...)` so the area gets its way up (a stair nook whose portal returns to the parent's link point). Make one with `createArea(w, { kind, seed, w, h, parent, depth, link, label })`. Use `store: "grid"` for ground the player builds (the save keeps the whole grid, compressed).

**Check it**: `tests/areaSpec.test.ts` shows the round trip to copy (create, enter, edit, save, load, leave); the content linter refuses an authored id in the `gen.` namespace.
