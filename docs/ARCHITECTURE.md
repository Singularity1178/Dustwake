# Dustwake architecture

This file used to hold everything (about 180 KB). It is now split into one page per system; this is the short index (the same as [docs/index.md](index.md)).

**The main boundary is that the World does not know presentation exists.** `world/` and `sim/` never touch canvas, audio or `Math.random`, and the tests import them straight into Node. Presentation reads the World, calls sim entry points, and drains `world.events` to play sound and spawn particles. `view/audience.ts` classifies each event as the player's, nearby (same area as the player), or elsewhere: only the player's events drive notes, toasts, screens and shakes; nearby actors get local sound and particles; remote actors are silent. This boundary matters most for this genre. NPCs, animals and jobs will run every tick, including off-screen and in tests, and they have to be saveable. None of that is possible while sim code fires `sfx.*` and `setTimeout` inline.

### Overview

- [Layers and boundaries](overview/layers.md)

### Engine

- [Off-screen simulation, large areas, save size](engine/scaling.md)
- [Time and determinism](engine/time.md)
- [Fixed-timestep simulation, game speeds, interpolation, deterministic replay (0.1)](engine/timestep.md)

### World

- [Areas](world/areas.md)
- [The dungeon audit](world/dungeon-audit.md)
- [AreaSpec: areas made at runtime, links, compressed grids (0.3)](world/dynamic-areas.md)
- [The entrance (v14)](world/entrance.md)
- [Save system v2: IndexedDB slots, autosave backups, export / import, recovery, budgets (0.4)](world/save-system-v2.md)
- [Save format and migrations](world/saves.md)
- [Westwake, day and night, the crossing](world/town.md)

### Simulation

- [Actors, bodies and power](sim/actors.md)
- [Harvesting and building](sim/building.md)
- [NPCs and dialogue](sim/dialogue.md)
- [Townsfolk (v18)](sim/folk.md)
- [Inventory and gear](sim/inventory.md)
- [Simulation level of detail: active / near / far, catch-up on entry (0.2)](sim/lod.md)
- [Orders and navigation](sim/orders.md)
- [Progression](sim/progression.md)
- [Routes over runes and portals (v17)](sim/routes.md)
- [The rune network](sim/runes.md)
- [Shops, keepers, talk and the board (v19)](sim/shops.md)
- [Storage and shared crafting](sim/storage.md)
- [Tasks, effects and the attack](sim/tasks.md)
- [Vision and analysis](sim/vision.md)

### Presentation

- [UI framework v2: mouse, the hi-res layer, the v2 font, widgets, notifications (0.5)](ui/framework.md)
- [Screens](ui/screens.md)
- [Settings and accessibility (0.7)](ui/settings.md)
- [The host split: renderer, camera, particles, event reactions (0.6)](view/host-split.md)
- [Render layers and zoom](view/rendering.md)

### Content and art

- [Rocks and the stair, redrawn](art/rocks-and-stair.md)
- [Trees and stumps, redrawn](art/trees-and-stumps.md)
- [The stair below (v15, v16)](art/stair-depth.md)
- [Content as data](content/data.md)
- [Inner monologue and the opening](content/monologue.md)

### Testing

- [Testing](testing/index.md)
- [Soak tests and the content linter (0.8)](testing/soak.md)

### How to add...

- [How to add a notification](howto/add-a-notification.md)
- [How to add a recipe](howto/add-a-recipe.md)
- [How to add a room or an area kind](howto/add-a-room.md)
- [How to add a setting](howto/add-a-setting.md)
- [How to add a species (an actor kind)](howto/add-a-species.md)

### History and plans

- [Production rollout (v12)](history/v12-production-rollout.md)
- [Deferred work and next steps](roadmap.md)
