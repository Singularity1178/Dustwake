# How to add a notification

> Index: [docs/index.md](../index.md). Background: [ui/framework.md](../ui/framework.md).

From a sim event (preferred: the sim stays unaware of presentation): emit the event from the sim, then add a case to `noteForEvent` in `ui/notify.ts` returning `{ text, level, key }`. `level` is `info`, `warn` or `alert` (alerts can pause the game: settings, "Pause on alert"); notes with the same `key` merge into one with a count. Text is drawn in the v2 font (mixed case).

From presentation (a save, an import): `game.notes.push(text, level, key)`. Test the mapping straight from `noteForEvent` (see `tests/uiFramework.test.ts`).
