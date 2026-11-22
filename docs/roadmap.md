# Deferred work and next steps

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](index.md).

## Deliberately deferred
- **Fixed-timestep simulation.** It would make the sim independent of frame rate, but on high-refresh displays it changes motion feel unless rendering interpolates. That's a visible change, so the host keeps variable `dt`. `stepWorld/stepPlayer` already take `dt`, so the switch only touches the host.
- **Entity/component framework.** `Actor` remains a plain record with optional dialogue identity and durable order, selected by a data definition and capabilities. No ECS or inheritance hierarchy is needed for these foundations.
- **Job board / automatic allocation.** Durable explicit orders and pathfinding exist; priorities, assignment UI and autonomous selection of orders wait for content.
- **A job board, recruitment and the final vision renderer.** The worker and storage screens exist (see "Worker management and storage screens"); orders are still one per worker, given by hand. A board of open jobs, automatic allocation and recruitment are later.
- **Stats and dialogue for generic NPCs.** Archetypes, traits and generated looks exist (townsfolk, v18); a townsperson answers with one line, not a dialogue script, and has no stats.
- **Recruiting and following.** Jobs and pathfinding exist; recruitment story conditions and follow behaviour are later handlers/content.
- **Save slots, autosave, a save menu.** Only the single K/L slot exists.

## Next up
- **A fixed timestep** still waits for an interpolating host. Actor-aware pathfinding is present; determinism is for equal dt/input sequences, not different frame rates.
- **Management and storage polish**: taking items out of a worker's own pack from its screen, a rune picker for its worn slot, and walk spots the player picks on the map. Any later analysis gate needs its own frozen grant in a migration, like v12's. Do not reuse the dungeon's `chest` kind for storage. Z is used for scan because V is already quick placement.
- **A source for `know.masonry`** (a book or an NPC): until then the brazier can't be learned in normal play.
- **Guardian repair and recruitment**: the effect for `know.repair` (the flag and its book exist), then guardian segments gated on it, plus speech. These are data rows plus a repair effect.
- ~~**Generic NPCs**~~ **Done** (v18): "Townsfolk (v18)". Next for them: shopkeepers at the `keeper` spots, and contracts and recruitment through `Life.duty`.
- More rune sites are rows in `RUNE_NODES` / `RUNE_LINKS`. More recipes, rows in `RECIPES`. Repair is a new effect gated by `know.repair` (the flag and its book exist; the effect does not).
- ~~Splitting `game.ts` into per-screen modules~~ **Done**: build, crafting, pack, books, schematic and dialogue live in `screens/` behind `UiHost`; the title and chapter cards are in `screens/cards.ts`; `art.ts` is split into `art/`. Next candidates if the host keeps growing: world rendering (`renderWorld` and the `draw*` helpers) into a `view/` renderer, and the arrival cutscene into its own screen. The opening now lives in `screens/intro.ts` behind `CutsceneHost`, with its script in `content/cutscenes.ts`. The arrival can follow the same pattern: add the rune redraw, column and summon as tracks, and add the cues it needs to `CutsceneHost`.
- **Equipment for the helm, core and extra rune slots**, and whatever opens `rune1..3` (the arm slots take tool heads since v14, and the iron arm opens the left one): only the slots, their rules and the two runes exist. Items are `ITEMS` rows with `wear`, unlocks are flags.
