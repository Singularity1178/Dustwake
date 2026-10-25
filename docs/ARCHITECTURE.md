# Dustwake architecture

The tutorial is the only content right now. This structure is the smallest one I could find that lets the planned game (surface, harvesting, construction, NPCs, management screens) grow without another rewrite. Every abstraction here is used either by the tutorial or by the tests.

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
Items (`ITEMS`: name, tags, glyph index, equip behaviour, glow, show-on-prop, reading screen), props (`PROPS`: collision box, wall-mounted, alternate-sprite rule, emitted light, fire/embers, item offset), tiles (solidity, opacity, what interacting does, decals they leave), glyphs, task timings and interaction rules all live in `content/`. Sprites stay procedural code in `art.ts`, keyed by kind or id, with the albedo/emissive split unchanged.

### Screens
`ui/screens.ts` is a small stack, replacing the `State` string. Only the top screen gets `update`, and therefore input. Rendering starts at the highest opaque screen and draws upward. Scene screens (intro, play, tele) step the world themselves; overlays (pack, schematic) pause it just by sitting on top. A management screen is one more `Screen` pushed onto the stack.

### Save format
`serialize(world)` writes JSON: the world's scalar fields, flags, the schedule, actors (tasks included), and for each visited area a **diff against its deterministic builder** (changed tiles, prop state, taken loose items, decals added during play, ritual state). A mid-tutorial save is about 4 KB. `migrate()` runs `MIGRATIONS[n]` (v n → n+1) and rejects saves from newer versions. Rule: any schema change bumps `SAVE_VERSION` and adds a migration. Area builders must stay deterministic, and ids must stay stable.

There is **no save UI**, because that would be a new player-facing feature. Open the game with `?debug` to get `window.dustwake.save() / load() / serialize()`.

## Testing
`npm test` compiles `tests/` and the DOM-free modules they import with the project's TypeScript (to CommonJS in `.test-out/`), then runs them on Node's built-in test runner. No new dependencies. The suite plays the whole tutorial headlessly and covers change propagation, save round-trips, determinism, migrations, queued work by a non-player actor, sim-time scheduling and travel.

## Deliberately deferred
- **Fixed-timestep simulation.** It would make the sim independent of frame rate, but on high-refresh displays it changes motion feel unless rendering interpolates. That's a visible change, so the host keeps variable `dt`. `stepWorld/stepPlayer` already take `dt`, so the switch only touches the host.
- **Entity/component framework.** `Actor` is one plain record type. Add components only when a second actor kind shows real divergence.
- **Job board / work allocation / pathfinding.** The task queue and `area.revision` (for nav caching) are the hooks.
- **Per-actor upgrades and stats.** The flag set is world-wide (`golem.*`). Move these to the actor when there is a second golem.
- **Data-driven sprites.** Item and prop art is still a `switch` in `art.ts`. It's procedural on purpose; a registry of draw functions only pays off once content volume grows.
- **Dialogue and archetype data.** There is nothing to define yet.
- **Save UI, autosave, multiple slots.** These are player-facing.
- **Splitting `game.ts` rendering into per-screen modules.** It's now presentation only, so the split is mechanical once management screens arrive.
