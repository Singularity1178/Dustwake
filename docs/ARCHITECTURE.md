# Dustwake architecture

Content: the tutorial dungeon (with its first NPC, the Treasury Guardian), plus the surface slice (rune travel, harvesting), and a catalog-driven build menu with deconstruction and a crafting-bench UI shell. This structure is the smallest one I could find that lets the planned game (surface, harvesting, construction, NPCs, management screens) grow without another rewrite. Every abstraction here is used either by the tutorial or by the tests.

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
  ui/          screen stack, overlay kit + UiHost, text wrap, dialogue layout (no DOM)
  screens/     overlay screens and cards, talking to the host only through UiHost
  game.ts      host: input, screen stack, camera, particles, audio, event reactions,
               world rendering, render loop
  art/         procedural sprites by family: palette, common (cache), tiles (bake +
               tile sprites), decals, props (+ propsSurface / propsDungeon), items
  light.ts golem.ts npcArt.ts circle.ts schematic.ts font.ts audio.ts   procedural art/audio
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
Items (`ITEMS`: name, tags, glyph index, equip behaviour, glow, show-on-prop, reading screen), props (`PROPS`: collision box, wall-mounted, alternate-sprite rule, emitted light, fire/embers, item offset), tiles (solidity, opacity, what interacting does, decals they leave), glyphs, task timings and interaction rules all live in `content/`. Sprites stay procedural code in `art/`, in two registries of draw functions (`PROP_ART` keyed by prop kind, `ITEM_ART` keyed by item id), with the albedo/emissive split unchanged. `art/` is split by what it draws: `tiles.ts` (background bake and tile sprites), `decals.ts`, `props.ts` (registry and `propSprite`; draw functions in `propsSurface.ts` and `propsDungeon.ts`, merged in that order), `items.ts`, plus `palette.ts` and `common.ts` (the one shared sprite cache and the registry types). Dependencies point one way: props/items/tiles -> common -> palette, tiles -> decals. `tests/art.test.ts` renders every pre-registry sprite and the dungeon bake through a recording fake canvas and checks the draw-call trace hash against the one captured from the original `switch` code. `tests/artRegistry.test.ts` does the same for every `PROP_ART`/`ITEM_ART` entry, the tile sprites, glyph patterns and the surface bake, with goldens captured from the single-file `art.ts` before the split.

### Screens
`ui/screens.ts` is a small stack, replacing the `State` string. Only the top screen gets `update`, and therefore input. Rendering starts at the highest opaque screen and draws upward. Scene screens (intro, play, tele) step the world themselves; overlays (pack, schematic) pause it just by sitting on top. A management screen is one more `Screen` pushed onto the stack. The `dialogue` screen is such an overlay (see "NPCs and dialogue"). Screens that don't need the game class live in `screens/` and talk to the host through `ui/kit.ts: UiHost` (contexts, world, input, sfx, notes, toast, plus `read(item)`, `boostEye`, and `animate(dt)` for overlays that keep the scene alive): the build menu and tools (`buildMenu.ts`), the crafting bench (`crafting.ts`), the pack (`pack.ts`), books (`book.ts`), the schematic (`schematic.ts`, which owns the rendered plan) and dialogue (`dialogue.ts`). The title and end cards are pure render functions (`cards.ts`); their update logic (screen changes) stays in the host. The host keeps input, the stack, camera, particles, audio, event reactions, the scene screens (intro, play, tele, arrive) and world rendering. Cross-screen moves go through the host (the pack opens a book with `host.read`), so screens never import each other.

### Two render layers and zoom
The page stacks two canvases with the same display rect. The **UI layer** stays at the base 320x180: HUD, notes, toasts, every overlay, the title and end cards draw there exactly as before (`Game.ctx`). The **world layer** (`Game.wctx`) holds the lit scene and anything in world space (the interaction marker, the build ghost). Its size is the current view: `view/zoom.ts` maps a zoom level z to `(320z) x (180z)`, snapped to multiples of 16x9 so it is always integer and 16:9. One world pixel is one canvas pixel at every zoom, and the browser scales both layers with nearest-neighbour (`image-rendering: pixelated`), so there is no resampling blur. `Game.setZoom` reallocates the scene, emissive and lighting buffers only when the snapped size changes. Camera clamps, culling windows, the chunk-bake `prepare()` window, light tracing, particle spawn areas and the surface arrival use `vw/vh`, not the constants. Zoom is a presentation preference: it is not in the sim or the save. Before `golem.eye` it is fixed at 1x. The eye repair eases it out to 1.5x over about a second. After that the wheel steps 1x/1.5x/2x on the play screen only (non-passive listener, so the page never scrolls). A world loaded with `golem.eye` starts at 1.5x. At 2x on the 96x72 surface the first frame bakes 24 chunks (about 110 ms with a cold JIT, behind the arrival fade) and lighting costs about 5 ms per frame (`npm test` prints it).

### Save format
`serialize(world)` writes JSON: the world's scalar fields, flags, the schedule, actors (tasks included), and for each visited area a **diff against its deterministic builder** (changed tiles, prop state, taken loose items, decals added during play, ritual state). A mid-tutorial save is about 4 KB. `migrate()` runs `MIGRATIONS[n]` (v n → n+1) and rejects saves from newer versions. **v5** (NPCs): `MIGRATIONS[4]` adds the dungeon's NPC actors (the guardian, dormant). If the v4 chest had been opened (or a core is in a pack, on the ground or seated in the circle), it sets `npc.guardian.coreGiven`, so the guardian still tells its story and mends the eye but never hands over a second core. Prop `open` is now diffed against the builder, because props can start open. **v6** (building overhaul): areas gain `propsRemoved`, the ids of builder-placed props that were deconstructed. `diffArea` derives it (base ids missing from the area) and `restoreArea` removes them again, so they never come back. Built props carry `recipe`. `MIGRATIONS[5]` adds empty `propsRemoved` and rewrites pending build work from the old recipe id `torch` to `torch_post`. **v7**: the crafting bench no longer has its own prop kind; `MIGRATIONS[6]` turns built `craftbench` props into `workbench` (ids and the recipe id `craftbench` are unchanged, so pending work and favorites still match). Rule: any schema change bumps `SAVE_VERSION` and adds a migration. Area builders must stay deterministic, and ids must stay stable.

Player-facing save/load is deliberately minimal: `K` on the play screen writes the one localStorage slot (`saveToStorage`), and `L` on the play or title screen loads it (`loadFromStorage` -> `Game.resume`). It is the same format and the same functions as the debug hooks; no slots, no autosave, no menu. Open the game with `?debug` to get `window.dustwake.save() / load() / serialize()`.

### Inventory
`Actor.inventory` is an ordered array of slots (`{item, n}` or `null`), owned by the actor so a second golem or an NPC can carry things. Items declare `stack` (max per slot; absent = unique) and `droppable` in `ITEMS`. **Capacity is derived, never stored**: `CAPACITY_TIERS` in `content/inventory.ts` is a list of `{requires, slots}` and the highest satisfied tier wins (8 / 16 with `golem.arm` / 48 with `golem.basket`). Tiers read flags because the arm and basket are *equip* items: they install on the golem instead of taking a slot, so they can't be dropped and shrink the pack. `reconcileCapacity` runs every world step: growth appends empty slots (nothing moves); a shrink (debug keys, odd saves) first repacks, then drops what doesn't fit next to the actor. Items are never deleted.

Anything that can't be stored lands on the ground as a loose stack (`giveItem`). Dropping (`Q`) is the `drop` effect: it places the item deterministically on the tile in front of the actor, else its own tile, else a fixed ring order around it (`dropSpot`). Same-item stacks on one spot merge. Loose items created in play get ids `drop<n>` from a saved per-area counter. Tutorial-critical items (chisel, key, core, glyphs, schematic) are `droppable: false`. NPC actors have inventories too (the guardian's is empty). Capacity tiers read `golem.*`, so `reconcileCapacity` leaves NPC packs alone. Loose items never interact with ritual sockets (sockets only accept glyphs through the picker), which is tested.

### Rune network
`content/runes.ts` declares `RUNE_NODES` (a rune prop with a stable id in some area, its `rune.<id>.active` flag, and an arrival offset/facing) and `RUNE_LINKS` (declared once, bidirectional unless `oneWay`; `awakens` lets arriving wake a dormant destination). Interacting with an active rune runs a `channel` task whose `travel` effect resolves the link, places the actor at the destination prop + offset (nudged to the nearest free spot, deterministically), and calls `enterArea()`. The end of the tutorial uses the same path: standing on the charged circle starts the long first `channel` (one-shot, guarded by `tutorial.done`), and arriving wakes the surface rune. The dungeon circle is a `runesite` prop (`rune.dungeon`); its flag follows the ritual's active state.

### Harvesting and building
`content/harvest.ts`: hp and yields per prop kind. Each blow is a `harvest` effect: `Area.damageProp` stores progress on the prop (saved, bumps revision, any actor can contribute). Depletion is permanent in v1, with a `regrow` hook that schedules into the prop's own area.

**Catalog (data).** `content/build.ts` is the build catalog. `RECIPES` maps an id to `{name, category, desc, prop, v?, cost, requires, unknown?, place?, lit?, dur?, order?}`. `BUILD_CATEGORIES` gives the tab order. `requires` is a normal `Requirement` (`know.build`, `know.masonry`, ...). While it isn't met, an entry shows as locked (`unknown: "locked"`, the default, with "UNKNOWN RECIPE") or is left out of the menu (`"hidden"`), so a book or NPC can unlock recipes later just by setting a flag. Adding a buildable means adding a row here, its `PROPS` entry if the kind is new, and a `PROP_ART` sprite. The current rows:
- LIGHT: torch post (floor), wall torch (wall), brazier (floor, needs `know.masonry`, which has no book yet, so it shows locked)
- CRAFT: crafting bench
- DEFENSE: barricade (blocks movement)
- FURNITURE: table, chair
- DECOR: wall banner (the authored `banner` prop, intact variant `v: 3`)

Most of these reuse existing prop kinds and art. The crafting bench builds the dungeon's own `workbench` prop (same sprite, same station), so the one new kind is `barricade`.

**Catalog queries.** `sim/catalog.ts` holds pure functions. `catalogEntries` gives per-entry status (`ok` / `cost` / `unknown`) and cost-versus-carried lines. `matchesSearch` checks that every query word appears in the name, the category or a material name. `sortEntries` sorts by type, name or cost, and the order is total. `queryCatalog` combines tab, favorites, search, the can-build filter and the sort. `entryReason` produces the "why not" text. Tests drive these with synthetic catalogs of hundreds of entries.

**Placement rules.** `sim/build.ts` holds the rules. `placement()` = knowledge + cost (`canBuild`), reach (`BUILD_REACH` tiles, Chebyshev), then `siteFor()` by `place` rule:
- `floor`: the anchor tile and every tile under the prop's collision box must be open floor (`footprint()`; the bench and table span three tiles). No prop may be anchored in the footprint or block it. It may not overlap the rune or circle rings or any actor body.
- `wall`: the dungeon builder already anchors its wall torches, banners and chains this way, so "on a wall" means the **visible south face of a plain `WALL` tile with open floor directly below**. The prop anchors at the bottom edge of the wall tile (`tx*16+8, ty*16+16`), so it sorts like the authored ones (`wallMounted`). Side and back faces aren't drawn in this 3/4 view, so they never take props. Doors, cracked walls, pillars, rubble and thicket don't count as walls, so tutorial walls can never be covered. One wall-mounted prop is allowed per face (an authored torch or banner occupies its face). The surface has no masonry walls, so wall torches are dungeon-only for now; the torch post is the outdoor light.

`suggestTile()` starts the ghost on the front tile if it fits, else on the nearest fitting tile in reach (a wall torch snaps to the closest face). Building is the `build` effect: it re-validates, then calls `Area.addProp` (ids `kind#b<n>`, and the prop records its `recipe`). Built props' lights are reconciled by `AreaView` from `area.revision`.

**Deconstruction.** `orderDeconstruct` starts a `dismantle` task (`DECONSTRUCT_DUR`). Its `deconstruct` effect re-validates when it fires, because the prop may be gone or the actor out of reach. It then calls `Area.removeProp`, spills anything resting on or in the prop to the ground (generic `p.item` rule; this is the documented contents rule for future containers), and refunds through `giveItem` for each cost row. A full pack drops the overflow on the ground like any pickup. Nothing is ever deleted. `salvageOf(prop)` decides the refund:
- *Built props* (`dyn`) refund 100% of the recipe that built them (`prop.recipe`, else the recipe for the kind, for older saves).
- *Authored props* are only deconstructable if their kind has a row in **`AUTHORED_SALVAGE`**, either `{recipe}` (that recipe's full cost) or `{refund}`. Today the only row is `torch: {recipe: "wall_torch"}`: the dungeon's wall torches and built wall torches are the same `torch` prop, with the same art, light and refund. Opting another authored kind in is one data row.

Removing a prop bumps `revision`. Prop-owned area lights (`LightDef.owner`) and built-prop lights drop out of `AreaView.wantedLights`, and cached interactables re-derive. `deconTargetAt` picks the prop a remove cursor points at: one anchored in the tile, deconstructable ones first, else one whose box covers the tile.

**Build UI** (`screens/buildMenu.ts`). This is one `build` overlay with three modes:
- *menu*: tabs, a 6x5 scrolling grid of procedural sprite previews, a detail panel (preview, category, placement rule, description, cost vs carried, the reason it can't be built), search, sort, a can-build filter and favorites. Favorites are a presentation preference in `localStorage`, not world state.
- *place*: footprint or wall-face ghost, valid wall faces in reach marked, reach outline, status bar.
- *remove*: amber brackets on every deconstructable prop in view, the refund shown before confirming, a polite refusal otherwise.

Search uses a modal text field (`ui/kit.ts: TextField`): `/` or `T` enters typing mode, where letters go to the field and only arrows browse, so WASD and E never conflict. `Game.keyDown` collects raw printable characters into `Game.typed` each frame. The last used recipe is remembered (`B` opens on it, `V` re-places it). With repeat on (`T`), the play screen reopens the same tool once the ordered work finishes (`BuildUi.pending`). Rotation is deferred, since every sprite has a single orientation.

**Work stations and crafting (UI shell).** `PropKindDef.station` (`workbench: "crafting"`) makes `deriveInteractables` emit a `station` interactable. `RULES.station` runs a short task whose `useStation` effect emits `openStation`, and the host pushes `screens/crafting.ts` (player only), so the sim has no special case. The crafting bench you build and the dungeon's authored workbench are the same `workbench` prop. While something rests on a station prop, picking that up is offered first (`propItem`), so the dungeon workbench still hands over its chisel (the tutorial needs that) and is a bench from then on. **Knowledge**: `STATION_REQUIRES` (`content/crafting.ts`) says what a crafter must know to read a station's plans (`know.build` for the crafting bench). Without it the station still opens, but the screen is greyed out: `craftEntries` returns nothing, CRAFT only reports `CRAFT_LOCKED_TEXT`, and learning the craft unlocks the plans with no other change. The crafting screen lists `content/crafting.ts` rows (`CRAFT_RECIPES`: name, station, desc, inputs, optional output, requires, placeholder) and shows inputs against the crafter's own pack, since stations have no slots. Its CRAFT button calls `sim/crafting.ts: orderCraft`, which only validates and reports. There is one clearly marked placeholder row. Real crafting = rows with `output` plus a craft task/effect in `orderCraft`.

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

The **dialogue screen** is a non-opaque overlay: the world pauses beneath it while presentation (particles, NPC pose, zoom) keeps animating. It shows a bottom box with the speaker tag and a typewriter reveal with a per-character blip. `E`/`Enter`/`Space` completes the page, then advances. `Esc` leaves, and the next talk resumes at the first unfinished segment. Beat timing (holds) is presentation-only (`BEAT_HOLD`). Sound and particles come from the `dialogue`, `npcState` and `eyeRepaired` events.

**Dialogue text** is authored as one plain paragraph per page (`DialoguePage.text`; `\n` forces a break). `ui/dialogueLayout.ts` word-wraps it (`ui/textWrap.ts`: greedy, words longer than a line are broken) to the box's real text width and paginates it to the box's line capacity, both derived from the box geometry: 292 px box, 10 px inset each side, 4 px per character including the shadow = **68 characters**; lines at a 10 px pitch must clear the footer row = **4 lines**. One authored page can become several screens. Its `beat` fires on the first and its `then` on the last, so beats still land on the right page. The typewriter, blips, speaker tag and skip/advance run on the wrapped screens unchanged. Author page breaks where the speaker pauses, not to fit the box. Tests lint the wrapped output (font glyphs only, nothing wider than the box, at most 4 lines), cover the wrapper and pagination (long words, exact fits), and render every guardian screen through `tests/support/uiSnapshot.ts` to check that no text pixel leaves the box and that long pages reach the right margin.

**The Treasury Guardian** (first special NPC): segments `intro` (wake beat), `repair` (`repairEye`: `golem.eye`, crackle-to-chime sfx, sparks, eye flare, the guardian's hand holds still, the camera eases out), `core` (`giveCore` via `giveItem`, so a full pack drops the core on the ground), and `farewell` (`goDormant` on the last page). Afterwards talking shows its idle line. The treasury's `chest@57,4` is built open and empty (`PropDef.open`). The core exists only with the guardian, who stands in the always-reachable treasury before the core matters. In play, the eye no longer gutters once `golem.eye` is set (the random sputter now drives only the core, since the body is still damaged), and the golem art's eye flicker stops.

**Planned (not built)**: repair knowledge and speech will make the guardian repairable and recruitable. Each is a new segment row gated on new flags, with a `wake` beat, plus new effects for the repair work itself. Generic NPCs reuse the actor, interaction and render paths with their own data source.

## Testing
`npm test` compiles `tests/` and the DOM-free modules they import with the project's TypeScript (to CommonJS in `.test-out/`), then runs them on Node's built-in test runner. No new dependencies. The suite plays the whole tutorial headlessly (plus dialogue wrapping/pagination and full-registry art goldens) (the core now from the guardian) and covers change propagation, save round-trips, determinism, migrations (including v4 to v5 both ways), queued work by a non-player actor, sim-time scheduling, travel, the guardian encounter (interrupted and resumed, full pack, reachability, collision), a data-only second NPC, dialogue text lint, the zoom model and the guardian's sprite states.

## Deliberately deferred
- **Fixed-timestep simulation.** It would make the sim independent of frame rate, but on high-refresh displays it changes motion feel unless rendering interpolates. That's a visible change, so the host keeps variable `dt`. `stepWorld/stepPlayer` already take `dt`, so the switch only touches the host.
- **Entity/component framework.** `Actor` is one plain record type. NPCs added a single optional field (`npc`). Add components only when a second actor kind shows real divergence (generic NPCs with stats may be that point).
- **Job board / work allocation / pathfinding.** The task queue and `area.revision` (for nav caching) are the hooks.
- **Per-actor upgrades and stats.** The flag set is world-wide (`golem.*`). Move these to the actor when there is a second golem.
- **Archetype, stats and personality data for generic NPCs.** Dialogue exists (special NPCs). Generic-NPC data waits for the generic-NPC work.
- **Recruiting, following, NPC jobs and NPC pathfinding.** NPCs are actors with task queues, so the hooks are in place.
- **Save slots, autosave, a save menu.** Only the single K/L slot exists.

## Next up
- **Pathfinding and a fixed timestep** arrive with animal guards. The nav grid caches on `area.revision` (the same hook interactables use). Guards that patrol need frame-rate-independent movement, so do the fixed-timestep switch in the host at the same time.
- **Per-actor upgrades and stats** move off the world-wide `golem.*` flags. NPCs are now a second actor type, but none of them needs upgrades yet, so their state lives in `npc.<id>.*` flags. When recruits carry things or level up, `CAPACITY_TIERS` and `golem.*` move to actor state.
- **Guardian repair and recruitment**: the effect for `know.repair` (the flag and its book exist), then guardian segments gated on it, plus speech. These are data rows plus a repair effect.
- **Generic NPCs**: add `"generic"` to `NpcType` with their own generated data. Spawning, collision, talk and drawing already go through the generic NPC paths.
- More rune sites are rows in `RUNE_NODES` / `RUNE_LINKS`. More recipes, rows in `RECIPES`. Repair is a new effect gated by `know.repair` (the flag and its book exist; the effect does not).
- ~~Splitting `game.ts` into per-screen modules~~ **Done**: build, crafting, pack, books, schematic and dialogue live in `screens/` behind `UiHost`; the title and end cards are in `screens/cards.ts`; `art.ts` is split into `art/`. Next candidates if the host keeps growing: world rendering (`renderWorld` and the `draw*` helpers) into a `view/` renderer, and the arrival cutscene into its own screen. Both read a lot of host presentation state (look, particles, rune animation), so they need a wider interface than `UiHost`.
- **Crafting**: add `output` to `CRAFT_RECIPES` rows and a craft task/effect behind `orderCraft`. The screen already renders it.
