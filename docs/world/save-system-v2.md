# Save system v2 (Phase 0.4)

> Index: [docs/index.md](../index.md). Code: `world/saveStore.ts` (pure), `view/persistence.ts` (browser backends), `view/files.ts`. Tests: `tests/saveStore.test.ts`. Format and migrations: [saves.md](saves.md).

## Store
`SaveStore` runs over an async key-value backend: IndexedDB in the browser (`IdbBackend`), localStorage if IndexedDB will not open, memory otherwise (and in tests). Records are read into a cache at start (`init()`), so loads are synchronous; writes update the cache at once and reach the backend asynchronously (`flush()`).

A record is `{ format: "dustwake-save", v: 2, meta, data }`: `data` is the JSON save, `meta` carries the slot, label, time saved, version, area, in-game day and hour, play time, size and an FNV-1a checksum of `data`.

## Slots, autosave, backups
- Manual slots: `quick` (K saves, L loads the newest save of any slot: Continue), `slot1`..`slot3`. Overwriting keeps the replaced copy as `<slot>.bak`.
- Autosave: every N minutes of play (settings: off / 2 / 5 / 10) and two seconds after entering another area, never mid-cutscene. The newest copy is `auto`; the older ones roll down `auto.1`..`auto.3`.
- The SAVES tab of the system menu lists every slot as a sortable table (area, in-game time, play time, when, size; damaged ones in red) with Save here / Load / Export file / Import file / Delete, each confirmed.

## Recovery
Loading walks the slot's chain (`chain()`: the slot, then its backups). A record that fails its checksum, does not parse or does not load is skipped; if a backup was used, the result says so (`recovered`) and the game posts a warning note. When nothing loads, `lastError` keeps every reason.

## Export / import
Export downloads the v2 record as a `.json` file. Import accepts a v2 record or a bare save (the legacy slot, an old export), checks it by loading it first, and refuses anything that fails with the reason. The legacy single localStorage slot (`dustwake.save`) is imported into the quick slot once.

## Budgets (tests)
Fresh world < 24 KB; a visited town < 160 KB; a 300-resident town < 1.5 MB, saved in < 1.5 s and loaded in < 2 s. Tile grids switch to run-length coding past 384 edits (see [dynamic-areas.md](dynamic-areas.md)).
