# Fixed-timestep simulation, game speeds, interpolation (Phase 0.1)

> Index: [docs/index.md](../index.md). Code: `core/clock.ts`, `view/interp.ts`, `sim/replay.ts`, `Game.simulate` in `game.ts`.

## The rule
The sim only ever sees `TICK` (1/60 s, `SIM_HZ = 60`). The host feeds real frame time into a `SimClock`; the clock answers how many whole ticks to run now and keeps the remainder. Game speed multiplies the real time fed in, so 8x is simply eight times the ticks per second. Nothing in `world/` or `sim/` can tell how fast it is being run, which is what makes a run deterministic at any speed.

60 Hz (not 30) is deliberate: it is the dt the sim and its content were tuned on, so cutscene timings are unchanged and every host test that drives `update(1/60)` still sees exactly one tick per frame.

## Speeds
`GAME_SPEEDS = [0, 1, 2, 4, 8]`. Keys (remappable, settings: Controls): `P` pause / resume, `1`-`5` set the speed directly (pause, 1x, 2x, 4x, 8x; fixed, not remappable); the speed bar (bottom left of the hi-res layer) is mouse only (its buttons are `noFocus`, so W / S / E / Enter / Space never move onto or press it), gamepad LT / RT step it (they send `padslower` / `padfaster`). Speed applies to the play screen only: cutscenes and the rune jump always run at 1x (`worldFrame(dt)` defaults to speed 1), overlays pause the world as before.

## One frame
`Game.simulate(dt, speed, input?, play?)`:
1. `clock.advance(dt, speed)` gives `n` ticks.
2. Per tick: capture positions for interpolation, `stepPlayer(TICK, input)` (play screen and rune jump), `addPlayTime` (play only), `stepWorld(TICK)`, drain events.
3. Stop early if another screen came up over the simulating one (owed time is dropped), or when the frame has spent `SIM_BUDGET_MS` (12 ms) simulating: the game then runs slow instead of freezing (`perf.dropped` counts it). The clock also caps a single frame at `maxTicks`.
4. `presentFrame(dt)`: camera, lights, particles, NPC looks, once per frame on real time, however many ticks ran (none at a high refresh rate or while paused).

Edge-triggered actions (E, Space, C, Z, a click on what E would use) wait in `Game.latch` until a tick takes them, so a press on a frame that runs no tick is never lost. While paused they are dropped.

## Interpolation
`view/interp.ts`: before each tick the positions of the shown area's actors are captured; `render()` swaps in `prev + (cur - prev) * alpha` (alpha = the clock's remainder / TICK) and puts the sim's positions back in a `finally`. A move bigger than 12 px in one tick is a jump (portal, set-down) and is drawn where it lands. Settings: "Smooth motion" turns it off.

## Deterministic replay
`sim/replay.ts`: `simTick(w, input)` is exactly the host's tick; `InputLog` stores a per-tick input stream as runs; `playStream` drives a world through a `SimClock` at any speed and frame-rate pattern. `tests/timestep.test.ts` plays one save and one stream at 1x (60 Hz), at 8x (ragged frames) and at 2x (144 Hz) with LOD on, and requires byte-identical saves.
