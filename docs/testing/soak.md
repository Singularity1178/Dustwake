# Soak tests and the content linter (Phase 0.8)

> Index: [docs/index.md](../index.md). Code: `sim/soak.ts`, `sim/contentLint.ts`, `scripts/soak.mjs`, `scripts/lint-content.mjs`. Tests: `tests/soak.test.ts`.

## The soak
`runSoak({ residents, days | seconds, walk, lod, stuckSeconds, budgetMs, roundTripEvery, hour })` builds a town of M residents (the census's people plus clones of its rows: homes and routines reused, people new), puts the player in it (optionally walking a square, so the in-view window moves and LOD tiers change) and runs at the fixed tick, checking:

- **stuck**: no one being simulated stays walking without getting anywhere for longer than X seconds (far actors are abstract and excluded);
- **items**: the census of every pack, worn slot, core, prop and loose stack is the same at the end (areas loaded mid-run join with their builder's items);
- **place**: no exclusive place (`EXCLUSIVE_KINDS`, `EXCLUSIVE_IDS`, lamps on the round) is held by two people; a household's door is not exclusive;
- **roundTrip**: save, load, save gives the live world's save (every N ticks and at the end);
- **budget**: the mean simulation time per tick (after the first second, when everyone is settled in) is within the budget.

`npm test` runs a 300-actor, 60-second soak (`tests/soak.test.ts`). Longer runs: `node scripts/soak.mjs --residents 300 --days 1 --walk` (prints the report, exits non-zero on any violation).

## The content linter
`lintContent()` runs every rule in `RULES` over every content row:
- `font1`: display text (names, descriptions, lines, notes: any string under a display key, talk templates' `{slots}` and `@table` references stripped) fits the bitmap font it is drawn in;
- `font2`: settings and action labels fit the v2 font;
- `items`, `props`, `stations`: every reference resolves;
- `census`: archetypes, routines and areas exist;
- `ids`: no duplicate ids; `areas`: no authored area in the generated `gen.` namespace.

It generalises the older data-resolution tests (every shop step resolves, every line fits the font). `npm test` requires zero issues; `node scripts/lint-content.mjs` prints them. Add a rule by pushing `{ id, run }` to `RULES`.
