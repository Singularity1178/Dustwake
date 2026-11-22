# Off-screen simulation, large areas, save size

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Off-screen simulation
**Policy: tick everything that is loaded.** Every area the world has instantiated is simulated every `stepWorld`: non-player actors' tasks, the ritual charge, and the global schedule. Areas are tiny state records, so this is cheap, needs no catch-up maths, and keeps determinism trivial. Two guards make work that spans a trip safe:
- `Scheduled` entries carry the `area` they were scheduled in and always apply there (a regrowing tree regrows on the surface while the golem is underground).
- Tasks record the `area` they were started in. `enterArea` drops queued work aimed at the area being left, and `tickTask` discards a task that would fire in another area.
If areas ever become expensive (many NPCs), switch unvisited areas to catch-up on entry using `world.time - area.lastTicked`. The guards above already make that switch local.

## Large areas
`AreaView` bakes the background in 8x8-tile chunks: those under the camera on demand, the rest one chunk per frame. Light visibility is traced the first time a light reaches the view window. Dirty-rect re-bakes and re-traces are unchanged. Measured in Node with the recording canvas (`npm test` prints it), for the 96x72 surface: a full bake took 420–600 ms. Chunked, the first frame takes about 40 ms (8 chunks, behind the arrival fade), then about 4 ms per frame in the background. Only lights near the view are traced (4 of 8 at the rune).

## Save size
A tile edit costs about 9 bytes in the diff (3000 surface edits: about 27 KB). That is fine for now. If terraforming ever touches tens of thousands of tiles, store a run-length or base64 grid per area once the diff exceeds a threshold.
