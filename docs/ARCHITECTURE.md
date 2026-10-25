# Dustwake architecture

Content: the tutorial dungeon (with its first NPC, the Treasury Guardian), plus the surface slice (rune travel, harvesting, torch building). This structure is the smallest one I could find that lets the planned game (surface, harvesting, construction, NPCs, management screens) grow without another rewrite. Every abstraction here is used either by the tutorial or by the tests.

## Layers

```
src/game/
  core/        pure helpers (seeded RNG, hashing)                    no DOM
  content/     data: tiles, items, props, glyphs, flags, tasks,       no DOM
               interaction rules, ritual geometry, NPCs, dialogue
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
    dialogue.ts  dialogue engine: segment choice, beats, NPC effects
    step.ts      stepPlayer / stepWorld, locomotion
  view/        presentation of an Area (baked bg, light registry), zoom model
  ui/          screen stack
  game.ts      host: input, screens, camera, particles, audio, rendering
  art.ts light.ts golem.ts npcArt.ts circle.ts schematic.ts font.ts audio.ts   procedural art/audio
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

Which task an interaction starts is decided by **rules in `content/interactions.ts`**: the first rule whose `{items, flags}` requirement is met wins. Delayed consequences, like a container's item arriving 0.25s later, use `schedule()` on **simulation time** instead of `setTimeout`.

"Repair this tile" and "build a torch here" become new `Effect` ops plus rules. Tasks with no player attached become jobs. A job board is deliberately not built yet.

### Time
`world.time` advances only in `stepWorld`, i.e. only while the world simulates (overlays pause it, as before). Scheduled effects and the ritual charge run on this clock. `Game.t` is a separate real clock for animation, so flames still flicker while the pack is open, exactly as before. The host still passes the browser's variable `dt` (clamped to 0.05s, unchanged); see "Deferred".

### Determinism
The World owns a `SeededRng` whose state is saved. The puzzle solution and the debris scattered when the wall breaks come from it; both used `Math.random` before. Each new session draws a fresh seed, so players still get a different solution each time, with the same distribution. Presentation randomness (particles, flicker, shake, rumble timing, the golem's sputter) stays on `Math.random` on purpose. A test checks that the same seed plus the same inputs produce identical worlds, including after a save/load.

### Progression
`world.flags` is a set of namespaced strings, replacing the old booleans: `golem.arm` (was `pl.hasArm`), `know.schematic` (was `schemRead`), `tutorial.insight` (was `schemFirstClose`), `golem.eye` (the eye mended by the guardian; unlocks zoom). NPC state is namespaced by the NPC actor's id: `npc.guardian.awake` (runtime state, reversible), `npc.guardian.met`, `npc.guardian.coreGiven`, `npc.guardian.farewell` (story progress). NPC state never goes under `golem.*`. Rule requirements read flags and items. The ritual's own state (`core`, `carved`, `sockets`) is the state of a world structure, so it lives on the area.

### Content as data
Items (`ITEMS`: name, tags, glyph index, equip behaviour, glow, show-on-prop, reading screen), props (`PROPS`: collision box, wall-mounted, alternate-sprite rule, emitted light, fire/embers, item offset), tiles (solidity, opacity, what interacting does, decals they leave), glyphs, task timings and interaction rules all live in `content/`. Sprites stay procedural code in `art.ts`, in two registries of draw functions (`PROP_ART` keyed by prop kind, `ITEM_ART` keyed by item id), with the albedo/emissive split unchanged. `tests/art.test.ts` renders every pre-registry sprite and the dungeon bake through a recording fake canvas. It checks that the draw-call trace hash matches the one captured from the original `switch` code.

### Screens
`ui/screens.ts` is a small stack, replacing the `State` string. Only the top screen gets `update`, and therefore input. Rendering starts at the highest opaque screen and draws upward. Scene screens (intro, play, tele) step the world themselves; overlays (pack, schematic) pause it just by sitting on top. A management screen is one more `Screen` pushed onto the stack. The `dialogue` screen is such an overlay (see "NPCs and dialogue").

### Two render layers and zoom
The page stacks two canvases with the same display rect. The **UI layer** stays at the base 320x180: HUD, notes, toasts, every overlay, the title and end cards draw there exactly as before (`Game.ctx`). The **world layer** (`Game.wctx`) holds the lit scene and anything in world space (the interaction marker, the build ghost). Its size is the current view: `view/zoom.ts` maps a zoom level z to `(320z) x (180z)`, snapped to multiples of 16x9 so it is always integer and 16:9. One world pixel is one canvas pixel at every zoom, and the browser scales both layers with nearest-neighbour (`image-rendering: pixelated`), so there is no resampling blur. `Game.setZoom` reallocates the scene, emissive and lighting buffers only when the snapped size changes. Camera clamps, culling windows, the chunk-bake `prepare()` window, light tracing, particle spawn areas and the surface arrival use `vw/vh`, not the constants. Zoom is a presentation preference: it is not in the sim or the save. Before `golem.eye` it is fixed at 1x. The eye repair eases it out to 1.5x over about a second. After that the wheel steps 1x/1.5x/2x on the play screen only (non-passive listener, so the page never scrolls). A world loaded with `golem.eye` starts at 1.5x. At 2x on the 96x72 surface the first frame bakes 24 chunks (about 110 ms with a cold JIT, behind the arrival fade) and lighting costs about 5 ms per frame (`npm test` prints it).

### Save format
`serialize(world)` writes JSON: the world's scalar fields, flags, the schedule, actors (tasks included), and for each visited area a **diff against its deterministic builder** (changed tiles, prop state, taken loose items, decals added during play, ritual state). A mid-tutorial save is about 4 KB. `migrate()` runs `MIGRATIONS[n]` (v n → n+1) and rejects saves from newer versions. **v5** (NPCs): `MIGRATIONS[4]` adds the dungeon's NPC actors (the guardian, dormant). If the v4 chest had been opened (or a core is in a pack, on the ground or seated in the circle), it sets `npc.guardian.coreGiven`, so the guardian still tells its story and mends the eye but never hands over a second core. Prop `open` is now diffed against the builder, because props can start open. Rule: any schema change bumps `SAVE_VERSION` and adds a migration. Area builders must stay deterministic, and ids must stay stable.

There is **no save UI**, because that would be a new player-facing feature. Open the game with `?debug` to get `window.dustwake.save() / load() / serialize()`.

### Inventory
`Actor.inventory` is an ordered array of slots (`{item, n}` or `null`), owned by the actor so a second golem or an NPC can carry things. Items declare `stack` (max per slot; absent = unique) and `droppable` in `ITEMS`. **Capacity is derived, never stored**: `CAPACITY_TIERS` in `content/inventory.ts` is a list of `{requires, slots}` and the highest satisfied tier wins (8 / 16 with `golem.arm` / 48 with `golem.basket`). Tiers read flags because the arm and basket are *equip* items: they install on the golem instead of taking a slot, so they can't be dropped and shrink the pack. `reconcileCapacity` runs every world step: growth appends empty slots (nothing moves); a shrink (debug keys, odd saves) first repacks, then drops what doesn't fit next to the actor. Items are never deleted.

Anything that can't be stored lands on the ground as a loose stack (`giveItem`). Dropping (`Q`) is the `drop` effect: it places the item deterministically on the tile in front of the actor, else its own tile, else a fixed ring order around it (`dropSpot`). Same-item stacks on one spot merge. Loose items created in play get ids `drop<n>` from a saved per-area counter. Tutorial-critical items (chisel, key, core, glyphs, schematic) are `droppable: false`. NPC actors have inventories too (the guardian's is empty). Capacity tiers read `golem.*`, so `reconcileCapacity` leaves NPC packs alone. Loose items never interact with ritual sockets (sockets only accept glyphs through the picker), which is tested.

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
`AreaView` bakes the background in 8x8-tile chunks: those under the camera on demand, the rest one chunk per frame. Light visibility is traced the first time a light reaches the view window. Dirty-rect re-bakes and re-traces are unchanged. Measured in Node with the recording canvas (`npm test` prints it), for the 96x72 surface: a full bake took 420–600 ms. Chunked, the first frame takes about 40 ms (8 chunks, behind the arrival fade), then about 4 ms per frame in the background. Only lights near the view are traced (4 of 8 at the rune).

### Save size
A tile edit costs about 9 bytes in the diff (3000 surface edits: about 27 KB). That is fine for now. If terraforming ever touches tens of thousands of tiles, store a run-length or base64 grid per area once the diff exceeds a threshold.

### NPCs and dialogue
**Every NPC is an Actor** of kind `"npc"` with a stable id (`npc.guardian`) and an `npc` field naming its row in `content/npcs.ts` (`NpcDef`: name, `type`, dialogue script id, art key, body box, talk reach, height, optional eye light). Nothing in the sim, the interaction path or the renderer branches on a particular NPC:
- *Placement*: an area builder lists `npcs` (spawn rows). `getArea` turns them into actors on first instantiation. After that they are saved like any actor. The guardian sits against the treasury's north wall between the looted chests. Its box keeps the doorway and rows 5 to 8 clear, which `sim/reach.ts` checks in the tests.
- *Collision*: `actorBox` (from the NpcDef box) feeds `boxFree`/`nearestFree`/`dropSpot`, so the golem can't walk through an NPC and dropped or overflowing items never land under one.
- *Interaction*: `npcInteractables(w, area)` derives one `"npc"` interactable per NPC actor (actors live on the World, not the Area, so these are not in the area's revision cache). The talk target carries `actorId` and `npc`. `RULES.npc` starts a short `talk` task whose `talk` effect opens the NPC's dialogue. The task is area-bound like every other task.
- *Rendering*: one generic path in `Game.drawNpc` looks up `NPC_ART[def.art]` (`npcArt.ts`, drawn twice like the golem, albedo and emissive) with a presentation pose (`NpcLook`: eased awake level, eye, flare, hand reach) derived from flags. The eye glow is a light in the AreaView registry (`dynamicLight`, keyed `npc:<id>`), so it is traced, culled and accumulated like any other light.
- *State*: an NPC's runtime state is a flag under its id (`npc.<id>.awake`; absent = dormant), set only through the `npcAwake` effect. I chose a flag over an actor field because dialogue requirements already read flags, saves need no actor schema change, and "dormant" stays a plain reversible switch: repair or speech later only sets it again.
- *Special vs generic*: `NpcType` is `"special"` only. Generic NPCs (archetypes, stats, randomized looks, personality) will add `"generic"` and their own fields. None of that exists yet.

**Dialogue** (`content/dialogue.ts`, `sim/dialogue.ts`): scripts are data keyed by script id. A script is ordered **segments** (`when`: a `Requirement`, `done`: completion flag, `pages`). Talking plays *the first segment whose requirement is met and whose done flag is unset*, so progress is derived from flags and there is no saved cursor. A page has lines, an optional speaker, optional `when` (flavour pages, e.g. the guardian noticing the iron arm), and optional **beats**: `beat` fires when the page shows, `then` when it is dismissed. Beats are a registry (`BEATS`) of named handlers that return plain Effects (`npcAwake`, `repairEye`, `npcGive` with a `once` guard flag, `segmentDone`). Every effect is idempotent, so replaying or resuming never repeats a gift. The commands `talkTo`, `dialogueBeat` (validated: the segment must be playable and contain the beat) and `finishSegment` are what the screen calls. Tests call them too, through `playSegment`.

The **dialogue screen** is a non-opaque overlay: the world pauses beneath it while presentation (particles, NPC pose, zoom) keeps animating. It shows a bottom box with the speaker tag and a typewriter reveal with a per-character blip. `E`/`Enter`/`Space` completes the page, then advances. `Esc` leaves, and the next talk resumes at the first unfinished segment. Beat timing (holds) is presentation-only (`BEAT_HOLD`). Sound and particles come from the `dialogue`, `npcState` and `eyeRepaired` events. Text is linted by a test: font glyphs only, at most 26 characters per line, at most 4 lines per page.

**The Treasury Guardian** (first special NPC): segments `intro` (wake beat), `repair` (`repairEye`: `golem.eye`, crackle-to-chime sfx, sparks, eye flare, the guardian's hand holds still, the camera eases out), `core` (`giveCore` via `giveItem`, so a full pack drops the core on the ground), and `farewell` (`goDormant` on the last page). Afterwards talking shows its idle line. The treasury's `chest@57,4` is built open and empty (`PropDef.open`). The core exists only with the guardian, who stands in the always-reachable treasury before the core matters. In play, the eye no longer gutters once `golem.eye` is set (the random sputter now drives only the core, since the body is still damaged), and the golem art's eye flicker stops.

**Planned (not built)**: repair knowledge and speech will make the guardian repairable and recruitable. Each is a new segment row gated on new flags, with a `wake` beat, plus new effects for the repair work itself. Generic NPCs reuse the actor, interaction and render paths with their own data source.

## Testing
`npm test` compiles `tests/` and the DOM-free modules they import with the project's TypeScript (to CommonJS in `.test-out/`), then runs them on Node's built-in test runner. No new dependencies. The suite plays the whole tutorial headlessly (the core now from the guardian) and covers change propagation, save round-trips, determinism, migrations (including v4 to v5 both ways), queued work by a non-player actor, sim-time scheduling, travel, the guardian encounter (interrupted and resumed, full pack, reachability, collision), a data-only second NPC, dialogue text lint, the zoom model and the guardian's sprite states.

## Deliberately deferred
- **Fixed-timestep simulation.** It would make the sim independent of frame rate, but on high-refresh displays it changes motion feel unless rendering interpolates. That's a visible change, so the host keeps variable `dt`. `stepWorld/stepPlayer` already take `dt`, so the switch only touches the host.
- **Entity/component framework.** `Actor` is one plain record type. NPCs added a single optional field (`npc`). Add components only when a second actor kind shows real divergence (generic NPCs with stats may be that point).
- **Job board / work allocation / pathfinding.** The task queue and `area.revision` (for nav caching) are the hooks.
- **Per-actor upgrades and stats.** The flag set is world-wide (`golem.*`). Move these to the actor when there is a second golem.
- **Archetype, stats and personality data for generic NPCs.** Dialogue exists (special NPCs). Generic-NPC data waits for the generic-NPC work.
- **Recruiting, following, NPC jobs and NPC pathfinding.** NPCs are actors with task queues, so the hooks are in place.
- **Save UI, autosave, multiple slots.** These are player-facing.

## Next up
- **Pathfinding and a fixed timestep** arrive with animal guards. The nav grid caches on `area.revision` (the same hook interactables use). Guards that patrol need frame-rate-independent movement, so do the fixed-timestep switch in the host at the same time.
- **Per-actor upgrades and stats** move off the world-wide `golem.*` flags. NPCs are now a second actor type, but none of them needs upgrades yet, so their state lives in `npc.<id>.*` flags. When recruits carry things or level up, `CAPACITY_TIERS` and `golem.*` move to actor state.
- **Guardian repair and recruitment**: the effect for `know.repair` (the flag and its book exist), then guardian segments gated on it, plus speech. These are data rows plus a repair effect.
- **Generic NPCs**: add `"generic"` to `NpcType` with their own generated data. Spawning, collision, talk and drawing already go through the generic NPC paths.
- More rune sites are rows in `RUNE_NODES` / `RUNE_LINKS`. More recipes, rows in `RECIPES`. Repair is a new effect gated by `know.repair` (the flag and its book exist; the effect does not).
- **Splitting `game.ts` rendering into per-screen modules.** It's now presentation only, so the split is mechanical once management screens arrive.
