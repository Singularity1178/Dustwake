# Layers and boundaries

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Layers
```
src/game/
  core/        pure helpers (seeded RNG, hashing)                    no DOM
  content/     data: tiles, items, props, glyphs, flags, tasks,       no DOM
               interaction rules, actors, power, jobs, vision, ritual geometry, NPCs, dialogue,
               monologue lines, cutscene scripts, the day/night cycle (daycycle.ts),
               tools (tools.ts), dig sites (digging.ts), stations (crafting.ts), entrances (geography.ts), townsfolk (folk.ts),
               shops, visits and shopping habits (shops.ts), what townsfolk say to each other (talk.ts)
  map.ts       tutorial dungeon builder -> AreaData (deterministic)  no DOM
  world/       runtime state that is simulated and saved              no DOM
    area.ts      Area: one area's mutable state + change notifications
    world.ts     World: areas, actors, flags, clock, rng, schedule, events
    areas.ts     area registry (id -> builder)
    save.ts      versioned save/load, per-area diffs, migrations
    jobs.ts      saved order, target and navigation records
  sim/         rules that change the World                            no DOM
    tasks.ts     performing work: Task -> Effect, queue, scheduler
    interact.ts  derived interactables, rule-driven interaction, starting the slam (attack)
    ritual.ts    translocation-circle puzzle
    dialogue.ts  dialogue engine: segment choice, beats, NPC effects
    monologue.ts inner monologue: when the golem thinks a line (event triggers, conditions, once/cooldown)
    gear.ts      worn gear by slot (helm, back, arms, core mount, runes): usable/locked slots, wear / take off with a fit check, rune effects (speed, glow)
    crafting.ts  crafting at a station: craft task + effect, tools carried, re-validation
    jobs.ts      durable orders, registry handlers, receipts and retries
    navigation.ts body-specific cached grids, swept walking and yielding
    storage.ts   actor/prop inventory transactions and nearby craft sources
    power.ts     walk-up insertion/removal, tier and family checks, the core slot seam
    analysis.ts  sim scan mode, highlighting projection and recipe gates
    debug.ts     debug kits (Ctrl+6) and the Ctrl+0 debug menu's actions (summon, flags, places, teleport) as pure sim functions, so tests run them
    daytime.ts   the calendar clock (world.day): advancing it, dayPhase events
    tools.ts     which tools are working for an actor (heads on arms, hafted tools carried by a wielder)
    digging.ts   the dig stroke, dig sites, opening an entrance
    routes.ts    routes between areas over runes and portals (every first hop of the shortest route)
    folk.ts      townsfolk: people from the census, plans off the clock, places held one at a time, heads, chat, settling,
                 shop visits step by step, exchanges said in turn, reading the board
    shops.ts     shops: opening hours, each person's shop trips off the clock, the keepers behind the counters
    step.ts      stepPlayer / stepWorld, locomotion
  view/        Area presentation, actor drawing, event audience, vision overlay, browser persistence, zoom, the rune's glow by state (runeFx.ts)
  ui/          screen stack, overlay kit + UiHost, text wrap, dialogue layout,
               monologue log, cutscene timeline (no DOM)
  screens/     overlay screens and cards, talking to the host only through UiHost
  game.ts      host: input, screen stack, camera, particles, audio, event reactions,
               world rendering, render loop
  art/         procedural sprites by family: palette, common (cache), tiles (bake +
               tile sprites), decals, props (+ propsSurface / propsDungeon), items,
               rocks (standing rock), stairs (the one stair's steps)
  light.ts golem.ts npcArt.ts folkArt.ts keeperArt.ts workerArt.ts circle.ts schematic.ts font.ts audio.ts   procedural art/audio (light.ts also applies the golem's glow;
               workerArt.ts is BODY_ART: bodies with power and work, the worker golem; workerAnim.ts is its animation sequencer)
tests/         headless sim tests (npm test)
```

**The main boundary is that the World does not know presentation exists.** `world/` and `sim/` never touch canvas, audio or `Math.random`, and the tests import them straight into Node. Presentation reads the World, calls sim entry points, and drains `world.events` to play sound and spawn particles. `view/audience.ts` classifies each event as the player's, nearby (same area as the player), or elsewhere: only the player's events drive notes, toasts, screens and shakes; nearby actors get local sound and particles; remote actors are silent. This boundary matters most for this genre. NPCs, animals and jobs will run every tick, including off-screen and in tests, and they have to be saveable. None of that is possible while sim code fires `sfx.*` and `setTimeout` inline.
