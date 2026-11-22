# Dynamic areas: AreaSpec (Phase 0.3)

> Index: [docs/index.md](../index.md). Code: `world/areaSpec.ts`, `createArea` / `getArea` (`world/world.ts`), `world/save.ts`. Tests: `tests/areaSpec.test.ts`.

The authored areas stay a static id -> builder table (`world/areas.ts`). Floors, caves, outposts and generated wilds are made at runtime from a saved spec:

```ts
interface AreaSpec { id; kind; seed; w; h; parent?; depth?; link?: { area; x; y }; store?: "diff" | "grid"; label? }
```

- `kind` selects a builder in `AREA_KINDS` (today `floor`: rooms joined by corridors, torches, loose stone; `cave`: a cellular-automaton cave with braziers). Builders are deterministic in the spec.
- `createArea(w, spec)` registers the spec (`world.specs`, saved), instantiates the area and, with a `link`, gives the parent its way down at the link point: a portal added at runtime (`linkPortal`), re-attached by `attachLinks` whenever the parent is instantiated or loaded. The new area's way up is a stair nook (`up` portal) that comes out just north of the hole.
- Ids are `gen.<kind>.<n>`, never reused, never colliding with authored ids (the content linter checks the namespace).

## Saves (v20)
`SaveData.specs` holds the specs; each runtime area is rebuilt from its spec and then diffed exactly like an authored area. An area whose spec says `store: "grid"` (player-built ground), or any area with more than `RLE_MIN_TILES` (384) changed tiles, saves `gridRle` (the whole grid, run-length coded: `world/rle.ts`) instead of the `tiles` list. `MIGRATIONS[19]` adds `specs: []`; a v19 save loads unchanged.

## Trying it
System menu (Esc) > Game > "Create test floor here" / "Create cave here" / "Leave this generated area", or `window.dustwake.createFloor("cave")` with `?debug`. Exit criterion covered by `tests/areaSpec.test.ts`: a floor is created, entered, edited, saved, loaded (round trip exact), left by its stair and entered again.
