# Dustwake

> A golem wakes in the ruins.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Move |
| `E` / `Enter` | Interact / use |
| `Space` | Attack: a heavy two-arm ground slam. Works anywhere, facing anything, with or without the iron arm, even right next to something you could interact with (that stays on `E`) |
| `I` / `Tab` | Open pack (inventory) |
| `E` (pack open) | Use / read the selected item, or put on gear: it goes to the first free usable slot of its kind (the basket on the back: 48 slots; a rune into a rune slot). On a worn slot `E` takes the item off, if everything still fits without it. A locked slot does nothing |
| Movement keys (pack open) | Move the cursor over the paper doll (helm, back, right/left arm, core, four rune slots, all always shown; greyed slots with a padlock are locked and say why in the description panel) and the pack grid. `A` / left off the pack's first column steps onto the doll, `D` / right off the doll's right-hand edge goes back to the pack |
| `Q` (pack open) | Drop one of the selected pack item in front of the golem |
| `M` | Read schematic (once found) |
| `B` | Build menu (once you know how). Opens on the last thing you built |
| Movement keys (build menu) | Move the catalog cursor |
| `Q` / `R` or `1`-`7` (build menu) | Previous / next category tab, or jump to a tab (ALL, FAV, LIGHT, CRAFT, DEFENSE, FURNITURE, DECOR) |
| `/` or `T` (build menu) | Search: type letters, digits and spaces. Arrows still browse, `Backspace` deletes, `Enter` keeps the filter, `Esc` clears it |
| `O` / `G` / `F` (build menu) | Cycle sort (type / name / cost) / toggle "can build only" / toggle favorite |
| `E` (build menu) | Pick the entry and go to placement |
| `V` | Quick re-place: straight to the ghost with the last used entry |
| Movement keys / `E` (placement) | Move the ghost / place |
| `T` (placement or remove) | Toggle repeat (on by default: the tool comes back after each build or removal) |
| `X` (build menu or placement) | Deconstruct tool: take apart highlighted props for a full refund, crafted materials included (`E` confirm, `X` back to building). Everything buildable can go, the dungeon's braziers, banners, tables, chairs, torches and workbench too; a prop that still holds something the story needs (the workbench's chisel, the library table's primer) refuses until you take it |
| `B` / `Q` (placement or remove) | Back to the build menu |
| `Esc` (build tools) | Close |
| `E` on a workbench (the dungeon's, or a crafting bench you built) | Open the crafting screen (`W`/`S` choose, `D` or `E` to the CRAFT button, `E` craft, `Esc` close): planks from wood, cut stone from stone, and runes carved from cut stone (the rune chisel must be in your pack; it is not used up). The golem works at the bench, then the plans come back. It opens greyed out, with no plans shown, until you know how to build |
| `E` on a storage chest | Open the storage screen: your pack on the left, the chest on the right. Movement keys move the cursor, `A` / `D` off the edge cross to the other side, `E` moves the whole stack under the cursor, `Q` one item, `R` renames the chest (type, `Enter` keeps, `Esc` cancels, empty goes back to the default name), `Esc` / `I` / `Tab` close. A chest is named as the orders call it (DUNGEON CHEST 1, DUNGEON CHEST 2) until renamed; the name is saved and shown in orders. As much as fits moves; a full side, an empty slot and the story's undroppable items say so and change nothing |
| `E` on a worker golem | While it has never had a core in it, nothing opens: the golem only thinks INTEGRITY INTACT, MISSING POWER SOURCE (slot a core in with `C`). Once a core has been slotted in, this opens its management screen, even after the core is taken out again: power, order, phase and why it is blocked, what it carries and wears. `W` / `S` choose a row, `A` / `D` change a value in a form, `E` confirms, `C` slots a core in or takes it out, `Esc` goes back then closes. The worker golem is a small clay body that animates by what it is doing: slot a core in and it boots up and stands, left idle it settles back into a dormant crouch, take the core out and it powers down (and turns its head aside as it sags), give it work and it stands and swings, walks and hauls. Going through a rune it does nothing of its own: it walks up to the rune and the rune's teleport effect lifts it away. Rows: the core (the golem does the swap, then the screen returns), GATHER (resource, source area, storage chest, amount or repeat), CRAFT (bench, recipe, amount or repeat), GO TO, TRANSFER (your pack beside its pack and what it wears: `E` gives / takes a stack, `Q` one item, `F` equips the item under the cursor, e.g. a rune into its rune slot, `E` on a worn slot takes it off into its pack, `Esc` back), RENAME (`R` too: type, `Enter` keeps, `Esc` cancels, empty clears; the name goes before its kind, e.g. BOB - WORKER GOLEM), pause / resume / retry, cancel. Only valid targets are offered; a refusal says why |
| `E` on a teleport rune | Travel to its linked rune |
| Walk into a shop door, or on along a road that runs off the map | Go through. No key: keep pushing the way you are going. Doors open into the room behind them (walk down onto the sill at the bottom of a room to leave); the old road at the west edge of the surface leads to the market town of Westwake, and the town's east gate leads back |
| `Space` near a tree, rock or log | Harvest wood / stone: the slam works every tree, rock and log within about a tile of where the fists land, one blow of work each (so one slam can work several at once). They aren't interactable: `E` does nothing on them and the vision mode doesn't highlight them |
| `Z` | Toggle vision (scan) mode: a scanner sweep from the golem's eye highlights what it can see within its light's radius, each category with its own hologram (gold: important, cyan: interactable, violet: someone, green: buildable). A pulsing diamond marks something still to analyze; a dim, still outline with a check mark means it's already analyzed. `E` on a buildable analyzes its pattern. The top-right readout counts both within sight |
| `Space` facing a cracked wall | Slam it down once the iron arm is attached. Without the arm it takes the hit and holds. `E` only pushes it (with a hint) |
| `E` on someone | Talk (dialogue: `E` / `Space` / `Enter` finish the line, then next; `Esc` leave) |
| Mouse wheel | Zoom 1x / 1.5x / 2x (once your eye has been mended) |
| `Esc` / `I` / `Tab` | Close menu |
| `K` | Save the game (one slot, kept in the browser's localStorage) |
| `L` | Load the saved game (also on the title screen, to continue) |
| `Esc` (during a cutscene) | Skip it: the opening, and the first jump through the translocation rune (any time from lift-off to the chapter card). The hint sits in the lower black bar. The world ends up the same as if you had watched: the same hour, the same thoughts on record |
| `R` | Wake again (restart): at the chapter card that closes the first crossing to the surface |

Click or press any key on the title screen to begin. The opening plays by itself: the golem wakes, runs its diagnostics and reports. You have control once the black bars slide away (about 12 seconds in). `Esc` skips it.

Worker golem sprites: `node scripts/preview.mjs` renders pose sheets and animation strips (boot, settle, shutdown, wake, blows) to `.preview/*.png` without a browser.

Debug menu (testing only): `Ctrl+0` opens (and closes) a tabbed menu over the play screen; the world is paused behind it. `Q` / `R` or `1`-`5` switch tab, `W` / `S` (or `PgUp` / `PgDn`) move, `Esc` / `Tab` closes. **ITEMS**: every item in the game; `A` / `D` set the quantity (`Shift` for tens, `M` for a full stack), `E` summons it into the pack (what does not fit lands on the ground; the iron arm installs itself), `G` drops it on the ground in front, `X` deletes from the pack, `F` wears it (gear), `/` searches. **PLAYER**: iron arm, mended eye, super speed (off / x3 / x6 / x12), noclip, all gear slots, the gear / build / story kits, learn all plans, fill materials, wear a basket, clear the pack. **FLAGS**: every progression flag, rune site, build plan and NPC awake state, toggled with `E` (searchable). **TELEPORT**: any area's start, room, rune site, circle or NPC (searchable; an area you have not visited yet is entered at its start). **WORLD**: coordinate HUD, zoom, time of day (`E` steps the clock to the next mark of the day), clock speed (x1 / x20 / x60), unlock everything, save, load, a new game without the intro, the foundation fixture. The logic is in `src/game/sim/debug.ts` (tested in `tests/debugMenu.test.ts`), the screen in `src/game/screens/debug.ts`.

Debug keys (testing only): `Ctrl+1` toggle iron arm, `Ctrl+2` runes + core + tools, `Ctrl+3` super speed, `Ctrl+4` build + masonry knowledge, the basket worn on the golem's back (the one in the pack if it has one), 40 each of wood, stone, planks and cut stone (enough to try every buildable), `Ctrl+5` toggle the mended eye (`golem.eye`) and its zoom, `Ctrl+6` toggle the gear kit: build + masonry knowledge, the basket worn, the rune chisel, wood, stone, planks and cut stone topped up to 40, both runes (Swift, Glow; one of each, never a second), and every locked gear slot unlocked (the left arm and the other three rune slots); press again to lock them (what they hold goes back to the pack).

## Day and night

The world keeps a clock. A full day is 12 minutes of play (30 seconds to the hour): night until 05:00, dawn to 07:00, day to 19:00, dusk to 21:00. The golem wakes at 22:30. The clock runs whenever the world does (it stops behind the pack, menus and the debug menu) and is saved with the game. The hour shows bottom right, with a sun, a moon or the sun on the horizon, whenever the golem is under the open sky, and everywhere once it has first been up (before that it has no way to know).

What follows the hour:

- **The sky.** Under the open sky the light goes from the old night look through a rose dawn to full daylight and back through an amber dusk. Lamps count for less against daylight: the golem's own glow is a pool of light at night and barely there at noon. The rooms behind the town's doors get the day through their windows and door, more dimly, and the doorway shows daylight instead of the night. The halls underground do not change at all.
- **Westwake's lights**, each kind in its own way:
  - light runes (street lamps, door sconces) sense the dark: they wake by themselves as the sun fails and sleep as it returns, a ripple down the street within minutes;
  - fire (torch posts, lanterns, wall torches, the watch braziers) is lit by hand some time after dusk and doused some time after dawn, one by one over an hour or so;
  - windows light when the house comes home, go dark at bedtime (some early, some past one in the morning), and a few are up again before dawn;
  - the charter stone's rune in the market square never goes out, as its inscription says.

  Chimneys smoke thickest at breakfast and supper, and the town bell sounds at dawn and at dusk.
- **The halls' broken roof.** The shaft of light in the throne room is moonlight by night and a sunbeam by day.
- **The wild.** Fireflies and crickets by night; pollen, butterflies and birdsong by day.
- **The golem** remarks on its first dusk.

Only the town is tended. Torches in the halls keep no hours, and whatever the golem builds itself stays lit until it is taken down.

Testing: the debug menu's WORLD tab has TIME OF DAY (`E` steps the clock to the next mark: midnight, dawn, 06:00, sunrise, noon, dusk, 20:00, nightfall) and CLOCK SPEED (x1 / x20 / x60, for watching the town light up and go dark). `node scripts/dayPreview.mjs` renders the town, the surface, the roof crack and a room at four hours, plus the crossing cutscene, to `.preview/day/*.png` through the real game without a browser. The maths is `src/game/content/daycycle.ts`, the clock `src/game/sim/daytime.ts`, the tests `tests/daycycle.test.ts`.

## The crossing (the first rune jump)

Stepping onto the charged translocation circle for the first time plays a cutscene in three acts after the lift-off (`Esc` skips it at any point):

1. **Transit.** A cross-section of the earth. The golem rises in the rune's column of light out of the translocation room, through the keep's masonry, the rock with the upper halls fallen into it, clay, roots and topsoil, and stalls just under the grass. The rune it is bound for has lain under the forest for an age: DESTINATION ANCHOR: DEGRADED. It rewrites the anchor from the pattern it left by.
2. **Arrival.** That same rewrite seen from the surface: the overgrown rune redraws itself, summons the golem, and it lands.
3. **First light.** It looks about (ON RECORD: THE UPPER HALLS. OBSERVED: FOREST.), and the night ends while it stands there. This is the real clock: the first crossing always comes up at 04:00, the cutscene runs it on to about 06:40, and that dawn is the morning you then play in. A chapter card (title, time, relics) closes it: any key to walk on, `R` to wake again; left alone it hands over by itself.

Skipped or watched, the world is left the same: the far rune restored, the clock at the first morning, the golem's lines on record.

## Foundation fixture

Open with `?debug` and call `window.dustwake.foundations()` in the browser console. A lesser golem gathers six wood in a separate yard, travels through the rune network and deposits it into a 32-slot storage chest. Save/load works while it walks or works. `window.dustwake.order(actorId, order)` uses the walk-up order command; job shapes are in `src/game/sim/jobs.ts`.

This opts into the chest, inverse recipes and Ruby core recipe fixtures. They are not added to the normal game's catalogs or dungeon spawns. The normal building progression is unchanged; the fixture chest proves analysis gating. The worker management and storage screens work on it (`E` on the golem or the chest); recruitment and a job board are deferred. See `docs/ARCHITECTURE.md` for the v10 schema and migration decisions.

## Westwake (the market town)

The Treasury Guardian remembers "a village west of here". Follow the overgrown track that leaves the surface through the thicket on its west side (a leaning waymark stands at its mouth) and it ends at the east gate of **Westwake**: the same village, a long time later, grown into a provincial market town of the Aligarch Empire. To jump straight there while testing: `Ctrl+0`, TELEPORT, any `WESTWAKE` row.

For now the town is appearance only: there are no townsfolk, shopkeepers or golems, and nothing can be bought, stored or crafted there. It is laid out for them, though (see `docs/ARCHITECTURE.md`, "The market town").

- **How it reads.** Oldest first: the *old quarter* in the north-west (thatch and daub round the village well, a keep statue set up as a keepsake); the *market square* and the *High Street* (the charter years: the Charter Stone, dressed stone, slate, the Guild's chapter house); *Low Street* and the lanes behind it (where the work is: smithy, tavern, stable, the stone yard). The town wall and gate towers are built from the sunken keep's own stone.
- **Light is the map.** Steady blue-white *light runes* stand along the paved streets and hang in the shops that can pay for them; everyone else burns fire, or sits in the dark. The line runs along the south side of the square. High-end (rune-lit): the Adventurers' Guild, the Gilded Buckler (armoury), the Bright Facet (jeweller), the Silver Needle (tailor). Ordinary (fire-lit): the Black Anvil (blacksmith) and the Sunken Crown (tavern).
- **Six doors open.** Blacksmith, armoury, jeweller, tailor, tavern and the Adventurers' Guild each have a full interior. Other houses are just houses.
- **Labour golems, by their absence.** Only plain hauling golems exist here, and none are in view: look for the numbered stands in the stone yard, yokes cut too wide for a man, hauler doors on the stable and the market store, broad flat tracks along the haul road, the bellows crank in the smithy, the tavern's cellar hatch.
- **Walled all round.** The town wall is a closed ring with a gate at each end of the High Street: the east gate (the way in from the ruins) and the West Bar, whose toll bar is down for the night and spans the passage between its towers, so there is no way round it. Outside the wall the land simply runs to the edge of the map and stops: there is no hedge or thicket border, the camera stops at the last tile and so does the golem.
- Most signs and landmarks can be read with `E`.

Developer preview: `node scripts/townPreview.mjs` renders the town at night, every interior, the surface's west road and a sheet of every town sprite to `.preview/town/*.png` without a browser (real bake, real sprites, real light tracing).

Layout audit: `node scripts/townAudit.mjs` checks the town and its six interiors for the mistakes that are easy to make by hand: a prop whose collision box sits in a wall or off the map, two solid props in each other, something hung on a wall that is not there, a light buried in masonry, a standing place that is blocked or cannot be walked to, ground sealed off from everywhere, something on a doorstep or drawn across a door, a ground decal painted over a roof. It prints what it finds (and exits 1); `node scripts/townAudit.mjs map` prints an ASCII plan of the tiles, and `node scripts/townAudit.mjs shot name=town:x,y,w,h,scale,flat,grid` renders a gridded close-up (tile coordinates) to `.preview/audit/name.png`. The same audit runs in the test suite (`tests/townWall.test.ts`), so the town stays clean.

## Inner monologue

The golem sometimes thinks a short line. These show as a small diagnostic log in the top-left corner: no box, and nothing pauses. Lines and their triggers are data in `src/game/content/monologue.ts`. A row needs `text` and, optionally, an event trigger (`on`), a requirement (`when`) and named conditions (`if`, defined in `src/game/sim/monologue.ts`). Lines fire once unless the row sets `once: false` (with an optional `cooldown`). Scripts fire lines with `think(...)`, and interaction rules with the `{ op: "think", line }` effect. What has been thought is saved (save v11). The opening's beats, including its thoughts, are data in `src/game/content/cutscenes.ts`. See `docs/ARCHITECTURE.md`, "Inner monologue and the opening".

## Running locally

```bash
npm install
npm run dev
```

Open the printed local URL in your browser.

## Building

```bash
npm run build
```

The build uses [`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile), so the output is a single self-contained `dist/index.html` that can be opened directly in a browser.

## Tests

```bash
npm test
```

Headless simulation tests (no browser): compiled with the project's TypeScript and run with Node's built-in test runner.

## Project layout

```
src/
  App.tsx            canvas mount, game loop, input wiring
  game/
    core/            seeded RNG, hashing (pure)
    content/         items, props, tiles, glyphs, flags, tasks, interaction rules,
                     inventory tiers, gear slots, rune network, harvest yields, build + craft recipes,
                     NPC definitions, dialogue scripts + beats, inner-monologue lines,
                     cutscene scripts (data)
    map.ts           tutorial dungeon area builder
    surface.ts       surface area builder (ruins above the buried dungeon; the old road west)
    town.ts          Westwake area builder (streets, buildings, street light, yards, standing places)
    townInteriors.ts the six shop interiors (one small area each)
    world/           Area, World, area registry, save/load (simulated + saved state)
    sim/             tasks/effects, interactions, inventory, gear (slots, locks, rune effects), crafting,
                     runes, building, collision, ritual puzzle, dialogue engine, inner monologue,
                     stepping, UI commands (incl. storage moves and worker orders), jobs, the order screen's option lists (orders.ts), debug kits (no DOM)
    view/            area view: baked background + light registry; zoom model
    ui/              screen stack, shared overlay kit + UiHost (frames, text field),
                     text wrapping, dialogue box geometry/layout, monologue log,
                     cutscene timeline (no DOM)
    game.ts          host: input, screen stack, camera, particles, audio, event reactions,
                     monologue log + cutscene letterbox,
                     world rendering, render loop
    art/             procedural pixel art, by what it draws:
      palette.ts       shared colour ramps
      common.ts        sprite cache, registry types, shared stone blob
      tiles.ts         background bake (floors, walls, ground) + tile sprites (rubble, pillars, door, bars)
      decals.ts        decals painted into the bake
      tilesTown.ts     the town's pavings, floors and wall materials (per pixel)
      town.ts          the town's buildings (roof + street front, painted once and cached) and ground decals
      propsTown.ts     town prop sprites: light runes, signs, market, yards, shop fittings
      props.ts         PROP_ART registry + propSprite (draw functions in propsSurface.ts / propsDungeon.ts)
      items.ts         ITEM_ART registry, itemIcon, glyph patterns
      slots.ts         faint silhouettes for empty gear slots
    golem.ts         golem drawing
    npcArt.ts        NPC drawing (NPC_ART, keyed by NpcDef art id)
    schematic.ts     schematic plan drawing (the overlay is screens/schematic.ts)
    light.ts         lighting and glow
    audio.ts         synthesized sound effects
    font.ts          bitmap font
    circle.ts        rune circle art
    util.ts          canvas helpers
    screens/         screens split out of game.ts, behind ui/kit.ts UiHost: build menu + tools,
                     crafting, pack, storage, worker management, book, schematic, dialogue; the opening cutscene (intro.ts,
                     behind CutsceneHost); title, transit and chapter cards (cards.ts)
tests/               headless sim tests (tests/support/uiSnapshot.ts renders the build,
                     crafting, storage, worker and dialogue screens to PNG at 320x180 without a browser;
                     tests/support/golemSnapshot.ts renders the golem's poses to PNG)
docs/ARCHITECTURE.md structure, boundaries, deferred work
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Status

An early prototype — a short vertical slice rather than a finished game.
