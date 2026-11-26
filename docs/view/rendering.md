# Render layers and zoom

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Two render layers and zoom
The page stacks two canvases with the same display rect. The **UI layer** stays at the base 320x180: HUD, notes, toasts, every overlay, the title and chapter cards draw there exactly as before (`Game.ctx`). The **world layer** (`Game.wctx`) holds the lit scene and anything in world space (the interaction marker, the build ghost). Its size is the current view: `view/zoom.ts` maps a zoom level z to `(320z) x (180z)`, snapped to multiples of 16x9 so it is always integer and 16:9. One world pixel is one canvas pixel at every zoom, and the browser scales both layers with nearest-neighbour (`image-rendering: pixelated`), so there is no resampling blur. `Game.setZoom` reallocates the scene, emissive and lighting buffers only when the snapped size changes. Camera clamps, culling windows, the chunk-bake `prepare()` window, light tracing, particle spawn areas and the surface arrival use `vw/vh`, not the constants. Zoom is a presentation preference: it is not in the sim or the save. Before `golem.eye` it is fixed at 1x. The eye repair eases it out to 1.5x over about a second. After that the wheel steps 1x/1.5x/2x on the play screen only (non-passive listener, so the page never scrolls). A world loaded with `golem.eye` starts at 1.5x. At 2x on the 96x72 surface the first frame bakes 24 chunks (about 110 ms with a cold JIT, behind the arrival fade) and lighting costs about 5 ms per frame (`npm test` prints it).

## Time speed effects
`view/timeFx.ts` gives each game speed a look, so a pause (otherwise invisible) and a fast-forward can be told at a glance. Presentation only: the sim, the save and the clock never see it. Setting: Display, "Time speed effects", on by default (`timeFx`).

| Speed | Look |
| --- | --- |
| 1x | nothing: no overlay drawn, no filter set |
| Paused | quiet: colour drained a little, a soft neutral vignette that breathes (about 7 s a breath), and a "Paused" label (with a "Press P to resume" line) in the middle of the screen, drawn by `Game.renderPauseLabel` and faded with `pauseA` |
| 2x | quiet: a light vignette, a few faint streaks drifting along the top and bottom edges |
| 4x | plain: richer grade, deeper vignette, more and faster streaks, a soft band sweeping down the screen |
| 8x | strong: more saturated grade, heavy vignette, dense long fast streaks, a brighter sweep |

Pause and 2x are lived in, so they stay well under 4x (`tests/timeFx.test.ts` keeps the ordering). Nothing strobes: movement is slow drift and a vignette breathing under 1 Hz and a few percent deep, so it needs no separate accessibility switch. The look is a table of numbers per speed (`TIME_LOOKS`); `TimeFx.update` eases the current look toward the target (about a third of a second), so a speed change blends instead of snapping. It is shown only while the play screen is on top and the setting is on; a menu, dialogue or cutscene over the world eases it away (the world is paused by being covered, whatever the speed says).

Two layers carry it. The colour grade (saturate / brightness / contrast) is a CSS `filter` on the world canvas (`TimeFx.applyFilter`, only written when the quantised string changes), so the HUD canvases are never tinted. The vignettes, sweep and streaks are drawn on the fixed 320x180 layer (`TimeFx.render`, called from `Game.render` before the screens draw), which sits above the world and below the UI; its textures are baked once from image data. Streaks hug the top and bottom edges so the middle of the screen stays clear. `node scripts/timeFxPreview.mjs` renders the town at 1x, paused, 2x, 4x and 8x to `.preview/timefx/*.png` through the real host (the CSS grade is emulated per pixel from the game's own filter string).
