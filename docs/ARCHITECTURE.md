# Dustwake architecture

Content: the tutorial dungeon, plus the surface slice (rune travel, harvesting, torch building). This structure is the smallest one I could find that lets the planned game (surface, harvesting, construction, NPCs, management screens) grow without another rewrite. Every abstraction here is used either by the tutorial or by the tests.

## Layers

```
src/game/
  core/        pure helpers (seeded RNG, hashing)                    no DOM
  content/     data: tiles, items, props, glyphs, flags, tasks,       no DOM
               interaction rules, ritual geometry
  map.ts       tutorial dungeon builder -> AreaData (deterministic)  no DOM
  world/       runtime state that is simulated and saved              no DOM
    area.ts      Area: one area's mutable state + change notifications
    world.ts     World: areas, actors, flags, clock, rng, schedule, events
    areas.ts     area registry (id -> builder)
    save.ts      versioned save/load, per-area diffs, migrations
  sim/         rules that change the World                            no DOM
    tasks.ts     performing work: Task -> Effect, queue, scheduler
    interact.ts  derived interactables, rule-driven interaction
    ritual.ts    translocation-circle puzzle
    step.ts      stepPlayer / stepWorld, locomotion
  view/        presentation of an Area (baked bg, light registry)
  ui/          screen stack
  game.ts      host: input, screens, camera, particles, audio, rendering
  art.ts light.ts golem.ts circle.ts schematic.ts font.ts audio.ts   procedural art/audio
tests/         headless sim tests (npm test)
```

**The main boundary is that the World does not know presentation exists.** `world/` and `sim/` never touch canvas, audio or `Math.random`, and the tests import them straight into Node. Presentation reads the World, calls sim entry points, and drains `world.events` to play sound and spawn particles. This boundary matters most for this genre. NPCs, animals and jobs will run every tick, including off-screen and in tests, and they have to be saveable. None of that is possible while sim code fires `sfx.*` and `setTimeout` inline.

## Key decisions

### Area: dimensions, identity, change propagation
- An `AreaData` carries its own `id`, `w` and `h`. Lighting (`computeVis`), background baking, collision, the camera clamp and the schematic all read those instead of global `MW/MH`. Adding the surface means adding a builder to `world/areas.ts`. `enterArea()` moves an actor between areas, and `Game.syncView()` rebuilds the view when the player's area changes. The tests travel to a fixture area of a different size.
- Props have **stable ids** (`kind@tx,ty`, or explicit ones like `ped0`), and loose items do too. Saves and prop-owned lights refer to these ids.
- **All mutation goes through `Area` methods.** Each one bumps `area.revision`. Tile and decal changes also publish a padded dirty rectangle to subscribers.
  - Derived data caches on `revision`: interactables now (`sim/interact.ts`), the nav grid later.
  - `AreaView` merges dirty rects and catches up once per frame. It re-bakes only that region and re-traces visibility only for lights whose window overlaps it.
  - The old code instead called `bakeRegion` + `refreshLightsNear` + `buildInters` by hand at each call site, with hard-coded tile coordinates. The new re-bake region is always a superset of the old one, so the pixels are identical.
- Lights are **reconciled from world state**: area lights (prop-owned ones follow their prop), glowing items on props, socket lights and the core light. The registry is insertion-ordered, so lights accumulate in the same order as before.

### Work: tasks and effects as data
The old `Action` held a closure. Now a `Task` is `{kind, dur, effect, target}`, and a fire point per kind comes from `content/tasks.ts`. `tickTask` advances any actor's task and applies its `Effect` through `applyEffect`, which is the single place interactions change the world. Every tutorial interaction runs this way. Because tasks are plain data:
- in-progress work is saved;
- any actor can perform it (`stepWorld` ticks non-player actors; tested with a fixture actor);
- actors have a queue (`enqueueTask`). The tutorial never queues, but the tests do.

Which task an interaction starts is decided by **rules in `content/interactions.ts`**: the first rule whose `{items, flags}` requirement is met wins. Delayed consequences, like a chest's item arriving 0.25s later, use `schedule()` on **simulation time** instead of `setTimeout`.

"Repair this tile" and "build a torch here" become new `Effect` ops plus rules. Tasks with no player attached become jobs. A job board is deliberately not built yet.

### Time
`world.time` advances only in `stepWorld`, i.e. only while the world simulates (overlays pause it, as before). Scheduled effects and the ritual charge run on this clock. `Game.t` is a separate real clock for animation, so flames still flicker while the pack is open, exactly as before. The host still passes the browser's variable `dt` (clamped to 0.05s, unchanged); see "Deferred".

### Determinism
The World owns a `SeededRng` whose state is saved. The puzzle solution and the debris scattered when the wall breaks come from it; both used `Math.random` before. Each new session draws a fresh seed, so players still get a different solution each time, with the same distribution. Presentation randomness (particles, flicker, shake, rumble timing, the golem's sputter) stays on `Math.random` on purpose. A test checks that the same seed plus the same inputs produce identical worlds, including after a save/load.

### Progression
`world.flags` is a set of namespaced strings, replacing the old booleans: `golem.arm` (was `pl.hasArm`), `know.schematic` (was `schemRead`), `tutorial.insight` (was `schemFirstClose`). Rule requirements read flags and items. The ritual's own state (`core`, `carved`, `sockets`) is the state of a world structure, so it lives on the area.

### Content as data
Items (`ITEMS`: name, tags, glyph index, equip behaviour, glow, show-on-prop, reading screen), props (`PROPS`: collision box, wall-mounted, alternate-sprite rule, emitted light, fire/embers, item offset), tiles (solidity, opacity, what interacting does, decals they leave), glyphs, task timings and interaction rules all live in `content/`. Sprites stay procedural code in `art.ts`, in two registries of draw functions (`PROP_ART` keyed by prop kind, `ITEM_ART` keyed by item id), with the albedo/emissive split unchanged. `tests/art.test.ts` renders every pre-registry sprite and the dungeon bake through a recording fake canvas. It checks that the draw-call trace hash matches the one captured from the original `switch` code.

### Screens
`ui/screens.ts` is a small stack, replacing the `State` string. Only the top screen gets `update`, and therefore input. Rendering starts at the highest opaque screen and draws upward. Scene screens (intro, play, tele) step the world themselves; overlays (pack, schematic) pause it just by sitting on top. A management screen is one more `Screen` pushed onto the stack.

### Save format
`serialize(world)` writes JSON: the world's scalar fields, flags, the schedule, actors (tasks included), and for each visited area a **diff against its deterministic builder** (changed tiles, prop state, taken loose items, decals added during play, ritual state). A mid-tutorial save is about 4 KB. `migrate()` runs `MIGRATIONS[n]` (v n → n+1) and rejects saves from newer versions. Rule: any schema change bumps `SAVE_VERSION` and adds a migration. Area builders must stay deterministic, and ids must stay stable.

There is **no save UI**, because that would be a new player-facing feature. Open the game with `?debug` to get `window.dustwake.save() / load() / serialize()`.

### Inventory
`Actor.inventory` is an ordered array of slots (`{item, n}` or `null`), owned by the actor so a second golem or an NPC can carry things. Items declare `stack` (max per slot; absent = unique) and `droppable` in `ITEMS`. **Capacity is derived, never stored**: `CAPACITY_TIERS` in `content/inventory.ts` is a list of `{requires, slots}` and the highest satisfied tier wins (8 / 16 with `golem.arm` / 48 with `golem.basket`). Tiers read flags because the arm and basket are *equip* items: they install on the golem instead of taking a slot, so they can't be dropped and shrink the pack. `reconcileCapacity` runs every world step: growth appends empty slots (nothing moves); a shrink (debug keys, odd saves) first repacks, then drops what doesn't fit next to the actor. Items are never deleted.

Anything that can't be stored lands on the ground as a loose stack (`giveItem`). Dropping (`Q`) is the `drop` effect: it places the item deterministically on the tile in front of the actor, else its own tile, else a fixed ring order around it (`dropSpot`). Same-item stacks on one spot merge. Loose items created in play get ids `drop<n>` from a saved per-area counter. Tutorial-critical items (chisel, key, core, glyphs, schematic) are `droppable: false`. Loose items never interact with ritual sockets (sockets only accept glyphs through the picker), which is tested.

### Rune network
`content/runes.ts` declares `RUNE_NODES` (a rune prop with a stable id in some area, its `rune.<id>.active` flag, and an arrival offset/facing) and `RUNE_LINKS` (declared once, bidirectional unless `oneWay`; `awakens` lets arriving wake a dormant destination). Interacting with an active rune runs a `channel` task whose `travel` effect resolves the link, places the actor at the destination prop + offset (nudged to the nearest free spot, deterministically), and calls `enterArea()`. The end of the tutorial uses the same path: standing on the charged circle starts the long first `channel` (one-shot, guarded by `tutorial.done`), and arriving wakes the surface rune. The dungeon circle is a `runesite` prop (`rune.dungeon`); its flag follows the ritual's active state.

### Harvesting and building
`content/harvest.ts`: hp and yields per prop kind. Each blow is a `harvest` effect: `Area.damageProp` stores progress on the prop (saved, bumps revision, any actor can contribute); depletion is permanent in v1, with a `regrow` hook that schedules into the prop's own area. `content/build.ts`: recipes with cost and knowledge requirement (`know.build`, learned from the Builder's Primer in the library). Placement validity is `sim/build.ts: placement()`. The placement screen only renders its answer. Building is the `build` effect (it re-validates) and `Area.addProp` (ids `kind#b<n>`). Built torches' lights are reconciled by `AreaView` from `area.revision` like every other light.

### Off-screen simulation
**Policy: tick everything that is loaded.** Every area the world has instantiated is simulated every `stepWorld`: non-player actors' tasks, the ritual charge, and the global schedule. Areas are tiny state records, so this is cheap, needs no catch-up maths, and keeps determinism trivial. Two guards make work that spans a trip safe:
- `Scheduled` entries carry the `area` they were scheduled in and always apply there (a regrowing tree regrows on the surface while the golem is underground).
- Tasks record the `area` they were started in. `enterArea` drops queued work aimed at the area being left, and `tickTask` discards a task that would fire in another area.
If areas ever become expensive (many NPCs), switch unvisited areas to catch-up on entry using `world.time - area.lastTicked`. The guards above already make that switch local.

### Large areas
`AreaView` bakes the background in 8x8-tile chunks: those under the camera on demand, the rest one chunk per frame. Light visibility is traced the first time a light reaches the view window. Dirty-rect re-bakes and re-traces are unchanged. Measured in Node with the recording canvas (`npm test` prints it), for the 96x72 surface. The overgrown surface (blended ground, about 2.4k decals) bakes fully in about 480 ms vs about 370 ms for the old ruined keep on the same machine. Chunked, the first frame takes about 85 ms (8 chunks, behind the arrival fade), then about 8 ms per background chunk vs 3.5 ms before. The recording canvas exaggerates per-`fillRect` decal cost compared to a browser. Only lights near the view are traced; the test adds a far built torch, since the rune is the surface's only builder light.

### Save size
A tile edit costs about 9 bytes in the diff (3000 surface edits: about 27 KB). That is fine for now. If terraforming ever touches tens of thousands of tiles, store a run-length or base64 grid per area once the diff exceeds a threshold.

### The surface and the buried dungeon
`content/geo.ts` holds the one dungeon->surface tile offset (`DUNGEON_TO_SURFACE = {12, 6}`) and the SURFACE GATE corridor. `map.ts` uses it for the collapsed corridor and the schematic's exit marker. `surface.ts` uses it for the buried entrance's outline, and reads the dungeon's `plan` through noise to raise earth humps and weedy ridges over buried walls. `buildSurface()` is layered value noise (meadow / woods / rocky rise / damp hollows), plus keep-clear masks (the rune circle, the gate zone, the cart's clearing, invisible game trails). Every solid prop keeps a one-tile free ring, so obstacles can never seal ground off. Unreachable open ground becomes thicket. `sim/reach.ts` flood-fills golem standing positions and the tests prove reachability with it. Nothing on the surface emits light except the rune (`runeglow`, dark while dormant). Ground styles `MOSS/LEAF/MUD/EARTH` bake through `groundPix`. Near style boundaries, `bakeRegion` samples the style at a noise-displaced position, so patches have organic edges, and thicket foliage overhangs adjacent ground. Surface decals stay within the bake's decal window (40 px left/up of the anchor), so chunked bakes stay pixel-identical.

The dungeon's collapsed gate is appended after all shared-rng work with its own seed, so no other room's art moved. That block is the only reason `GOLDEN.bake` changed.

### Surface rune
`surfaceRune.ts`: `runeLayout()` (pure) gives every carved pixel a sweep key (clockwise from north, slightly later outward). It picks survivors from 1D noise along each feature, so they form contiguous worn arcs, about 20%. It grows plant clumps along the missing carvings and past them. A clump's key is the minimum key of the carvings it covers, so it withers just before they are redrawn. Rim clumps outside the circle stay. `SurfaceRuneArt` writes albedo/emissive layers as ImageData. p = 0 and p = 1 are cached; in-between progress re-renders only when p changes. `Game.updateArrive()` drives the phases (`ARRIVE` constants: glow, sweep, pulse, summon, land; about 9.8 s).

### Save v4
The surface layout changed, so v3 surface diffs are discarded (`MIGRATIONS[3]`). The basket's taken state, id counters and built torches are kept. Dropped stacks move next to the rune, and actors on the surface move to the rune.

## Testing
`npm test` compiles `tests/` and the DOM-free modules they import with the project's TypeScript (to CommonJS in `.test-out/`), then runs them on Node's built-in test runner. No new dependencies. The suite plays the whole tutorial headlessly and covers change propagation, save round-trips, determinism, migrations, queued work by a non-player actor, sim-time scheduling and travel.

## Deliberately deferred
- **Fixed-timestep simulation.** It would make the sim independent of frame rate, but on high-refresh displays it changes motion feel unless rendering interpolates. That's a visible change, so the host keeps variable `dt`. `stepWorld/stepPlayer` already take `dt`, so the switch only touches the host.
- **Entity/component framework.** `Actor` is one plain record type. Add components only when a second actor kind shows real divergence.
- **Job board / work allocation / pathfinding.** The task queue and `area.revision` (for nav caching) are the hooks.
- **Per-actor upgrades and stats.** The flag set is world-wide (`golem.*`). Move these to the actor when there is a second golem.
- **Dialogue and archetype data.** There is nothing to define yet.
- **Save UI, autosave, multiple slots.** These are player-facing.

## Next up
- **Pathfinding and a fixed timestep** arrive with animal guards. The nav grid caches on `area.revision` (the same hook interactables use). Guards that patrol need frame-rate-independent movement, so do the fixed-timestep switch in the host at the same time.
- **Per-actor upgrades and stats** move off the world-wide `golem.*` flags when a second actor type appears. Inventory is already per actor. `CAPACITY_TIERS` requirements would then read actor state instead of world flags.
- More rune sites are rows in `RUNE_NODES` / `RUNE_LINKS`. More recipes, rows in `RECIPES`. Repair is a new effect gated by `know.repair` (the flag and its book exist; the effect does not).
- **Splitting `game.ts` rendering into per-screen modules.** It's now presentation only, so the split is mechanical once management screens arrive.
