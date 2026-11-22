# Simulation level of detail (Phase 0.2)

> Index: [docs/index.md](../index.md). Code: `sim/lod.ts`, `stepWorld` (`sim/step.ts`), `tickFolk` (`sim/folk.ts`). Tests: `tests/timestep.test.ts`, `tests/soak.test.ts`.

## Tiers
| Tier | Who | How it is stepped |
| --- | --- | --- |
| active | within the in-view box round the player (the widest zoom's 640x360 view plus 96 px) | every tick |
| near | the player's area, off camera | on a 0.1 s beat, the step that long, cut into pieces of at most `maxStep` (0.1 s) |
| far | any other area | routine actors (townsfolk) not at all: they are set down where the hour says on entry; actors with work (a task, a queue, an order) on a 0.5 s beat |

The beat is `floor((time + hash(id) * period) / period)` changing: a pure function of world time and the actor's id. There is no per-actor LOD state, so LOD is deterministic, survives a save and load exactly, and gives the same world at 1x and 8x.

## Areas and catch-up
With LOD on, areas other than the player's do not tick their own features (the ritual's charge). `Area.lastTicked` records when one last did (saved in v20 as `lastTicked` when it differs from the save's time). When the player comes into an area, `focusTick` runs the `CATCH_UP` hooks (`sim/step.ts`) with `world.time - area.lastTicked`: the ritual advances by the time away, and `folkCatchUp` settles the area's people (the townsfolk's `settle`, generalised into a hook). Add a hook for any new area feature that runs on time.

## Policy
`World.lod` is a host policy, never saved: `null` steps everything every tick, as before (the default for headless behaviour tests, which specify exact timings). The game enables it from settings ("Simulation LOD", on by default); the soak harness always does.

## Budget
`tests/soak.test.ts` runs a 300-actor town (60 s of game time, the player walking) and fails if the mean simulation time per tick exceeds 4 ms (a quarter of a 60 Hz frame) or p95 exceeds 12 ms. On the reference machine, a 45 s midday soak with the player walking among the townsfolk (about 80 actors active, 170 near, 55 far): 2.7 ms mean and 5.4 ms p95 per tick with LOD; with LOD off the same run takes 5.8 ms mean and 9.1 ms p95 and fails the budget (`node scripts/soak.mjs --residents 300 --seconds 45 --walk --no-lod`). LOD is what makes the 300-actor exit criterion hold. The first second (settling 300 people in where the hour says) costs about 0.5 s in total and is reported apart.
