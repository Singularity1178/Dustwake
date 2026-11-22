# How to add a species (an actor kind)

> Index: [docs/index.md](../index.md). Background: [sim/actors.md](../sim/actors.md), [sim/folk.md](../sim/folk.md), [sim/lod.md](../sim/lod.md).

1. **Body**: add an `ActorDef` to `ACTORS` in `content/actors.ts`: name (bitmap font), collision box, height, reach, speed, inventory, gear slots, capabilities (`move`, `work`, `wield`, ...), optional power family and eye light.
2. **Art**: a draw function keyed by `art.key`: in `BODY_ART` (`workerArt.ts`) for bodies with work and power, `NPC_ART` (`npcArt.ts`) for story NPCs. Townsfolk-like people reuse `folkArt.ts` with a new archetype instead.
3. **Behaviour**: either orders (`sim/jobs.ts`: the worker path) or a routine (`content/folk.ts`: an archetype with routines and a census row). Anything that runs on time must be LOD-aware: step through `lodDue` / `stepIn` (see `tickFolk`), and give its area features a `CATCH_UP` hook if they advance while nobody watches.
4. **Saves**: actors are saved verbatim. A new optional field needs nothing; a changed shape needs a migration (bump `SAVE_VERSION`, add `MIGRATIONS[n]`, update the version assertions in the tests).
5. **Check it**: `npm test`; `node scripts/soak.mjs --residents 300` if they come in numbers (budget, stuck, places, items, round trip).
