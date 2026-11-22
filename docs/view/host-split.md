# The host split (Phase 0.6)

> Index: [docs/index.md](../index.md).

`game.ts` was about 2,000 lines doing everything. It is now the host only (input, the screen stack, the timestep, settings, saves, the hi-res UI layer) at about 1,500 lines, with the presentation layers beside it in `view/`:

| Module | What it is |
| --- | --- |
| `view/worldRenderer.ts` | `WorldRenderer`: the lit scene of the player's area (background, circle, props, tiles, actors, the golem, particles, the moon shaft, lighting pass, vision overlay). The overview renderer of Phase 2 sits beside it. |
| `view/reactions.ts` | `EventReactions`: the World's events drained each tick into sound, particles, notes, toasts, shakes and screens, by audience; every event also reaches the notification feed. |
| `view/camera.ts` | `Camera`: position, eased follow, shake (honouring the accessibility settings), world <-> layer conversions. |
| `view/particles.ts` | `ParticleSystem`: spawn, step, the cap, the drip callback. |
| `view/interp.ts` | Render interpolation for the fixed tick. |
| `view/hudHi.ts` | The hi-res HUD: speed bar, feed, mouse in the world, selection, inspector, performance readout. |

The extraction was mechanical: the moved methods keep their code, with `this.` rewritten to `this.g.` for host members. The host keeps thin delegates (`drainEvents`, `renderWorld`, `coreSparks`, ...) and compatibility accessors (`particles`, `shakeT`, `shakeMag`), so screens, tests and the `UiHost` interface did not change.
