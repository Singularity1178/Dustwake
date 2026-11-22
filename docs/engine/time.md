# Time and determinism

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Time
`world.time` advances only in `stepWorld`, i.e. only while the world simulates (overlays pause it, as before). Scheduled effects and the ritual charge run on this clock. `Game.t` is a separate real clock for animation, so flames still flicker while the pack is open, exactly as before. The host still passes the browser's variable `dt` (clamped to 0.05s, unchanged); see "Deferred".

## Determinism
The World owns a `SeededRng` whose state is saved. The puzzle solution and the debris scattered when the wall breaks come from it; both used `Math.random` before. Each new session draws a fresh seed, so players still get a different solution each time, with the same distribution. Presentation randomness (particles, flicker, shake, rumble timing, the golem's sputter) stays on `Math.random` on purpose. A test checks that the same seed plus the same inputs produce identical worlds, including after a save/load.
