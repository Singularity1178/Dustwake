# UI framework v2 (Phase 0.5)

> Index: [docs/index.md](../index.md). Code: `ui/gui.ts`, `ui/font2.ts`, `ui/notify.ts`, `view/hudHi.ts`, `screens/system.ts`, `view/gamepad.ts`, `App.tsx`. Tests: `tests/uiFramework.test.ts`, `tests/hostPhase0.test.ts`.

## UI scale and the layers
**Large is the interface as designed and the default; Normal and Compact are that same interface, all of it (frames, slots, sprites and text), at 3/4 and 1/2 of the size.** `ui/scale.ts` holds the numbers.

Layers, bottom to top, all stretched to one display rect (`App.tsx`):

| Layer | Size | Carries |
| --- | --- | --- |
| world | W x H times the zoom | the pixel-perfect world |
| fixed (`Game.fctx`) | 320 x 180, always | what is not interface and never scales: cutscene cards, the dialogue box, the letterbox, the title, the monologue |
| UI (`Game.ctx`) | 320x180 (Large), 427x240 (Normal), 640x360 (Compact) UI px, drawn 1:1 | the HUD (notice, item toast, clock, scan readout) and the pack, storage, transfer, orders, crafting, build and debug screens, with their frames and sprites |
| hi-res (`Game.hctx`) | 1920 x 1080, always (6 px per base px) | the v2 text of the fixed and UI layers, and the widget kit (speed bar, feed, tooltips, selection and inspector, context menus, the system menu). It takes the mouse |

A **UI px** is the unit screens are laid out in. A font pixel is a constant 2/3 of a UI px at every scale, so a layout that fits at Large fits at all three: the scale only changes how many UI px the screen has across. On the hi layer a font pixel (the kit's logical px) is 4 (Large), 3 (Normal) or 2 (Compact) canvas px, so the kit's layout is 480, 640 or 960 logical px across. Text on the fixed layer is always drawn at the Large size.

Placing things:
- The overlay screens are laid out as a 320x180 box. `Game.render` draws the ones in `FRAMED_SCREENS` through `inFrame` (ui/text.ts), which centres the box on the UI canvas; `shade` still covers the whole canvas. The build screen frames its menu itself.
- Anything anchored to the screen's own edges (the HUD, the build and remove tools' top bar) asks `edge()` for `l, t, r, b, cx, cy` in the coordinates it is drawing in: the whole canvas on the HUD, the box inside a frame. Never use 320 or 180 for these.
- A notice shown above the dialogue box (a fixed-layer position) goes through `Game.fromFixedY`.
- Screens that are not interface (cutscenes, dialogue) draw on `g.fctx`, never on `g.ctx`.

## Mouse
`App.tsx` reports pointer move / down / up / leave in base-layer pixels, right-click and the wheel. In the world (play screen, `view/hudHi.ts`): hover shows a tooltip (name, what it is doing, what a click does); a click on the thing E would use uses it (on the next tick); a click selects an actor; dragging selects every actor in the box; right-click opens a context menu (Inspect, Use, Add to / remove from selection, Clear selection, Pause, Menu); the inspector shows an actor's or a prop's details. The wheel zooms, unless a list or slider under the pointer takes it (`gui.wantsWheel`).

## The v2 font
`ui/font2.ts`: mixed case and proportional (a 9-row cell: 7-row caps, descenders), with typographic marks mapped onto its glyphs. Drawing goes through a per-colour glyph atlas (one `drawImage` per character); measuring, wrapping and clipping are pure. There is a bold weight for headings (`drawText2B`, `textWidth2B`): each glyph struck twice, never closing a one-pixel counter, with M, W, m and w drawn by hand.

## Two faces, one rule
**What the world says stays in the carved capitals (`font.ts`); what the interface tells the keeper is written in the v2 face.**

| Capitals (`font.ts`), on the base or world canvas | v2 face, on the hi-res layer |
| --- | --- |
| Dialogue lines and the speaker's tag | The HUD: notices (`say`), the item toast, the clock, the scan readout |
| The golem's monologue | Pack, storage, transfer, worker orders, crafting, the build menu and its tool bars |
| Speech bubbles, sleepers' Zs, the CLOSED card | The debug menu, book pages, the title and chapter cards' prompts |
| The schematic (drafted lettering), the DUSTWAKE title | Every key hint, including the ones under a dialogue box |

Speech is a voice, and the fixed-width capitals are that voice (the typewriter, the monologue's scramble and the bubbles on the world's pixel grid all rely on it). Anything a player reads to decide something is interface, and gets the face that is quicker to read.

## Text on the base grid (`ui/text.ts`)
The screens above are laid out by hand on the 320x180 grid. They keep drawing frames, slots and sprites on the base canvas and ask for text in the same coordinates:

- `label(ctx, s, x, y, colour, align?, { case?, bold? })` where the capital font's `drawText` was; `labelS` adds an outline for text over the world. Given the base UI canvas it draws on the hi-res layer, on whole canvas pixels, centred on the line the 5 px capitals sat on, with the base canvas's current alpha. On any other canvas, or with no layer bound (a headless tool), it falls back to the capitals.
- One font pixel is 2/3 of a UI px at every scale. A string is exactly as wide, at most, as its capitals were (6 font px = 4 UI px a character) and a line is 7.3 px, so **a layout that held the capitals holds the v2 face at every scale** (`tests/uiText.test.ts` checks every item, recipe and slot text).
- Never count characters: `labelW`, `clipLabel` (`kit.clipText` is this), `wrapLabel`, `lineH`. `flow(lines, w, max)` takes lines hand-wrapped for the capitals as one paragraph and wraps them again to the width there is.
- Content stays as written, in capitals (the sim, saves, tests and the spoken lines use it). Casing is presentation: `sentence` ("It stands and waits. No order.") and `titled` ("Chest of the Old Stair", for names) convert an all-capital string and leave mixed case alone. Lone key letters, "I", counts ("x3") and known names keep their form; `Game.learnNames` teaches it the names in play, so a worker called BOB is "Bob" mid-sentence.
- `hints(ctx, "W/S CHOOSE   E CONFIRM", x, y, colour, align?, maxW?)` draws a hint line as key caps and words. It takes the old hint strings (two or more spaces between hints) or `[key, text]` pairs.
- The two canvases: `panel` (kit) and `occlude` wipe the hi layer under something opaque drawn on the base canvas; `shade` dims the screen for an overlay on both (the layer's text is thinned, not painted over); `thin` does that for a rect.
- `textTap` reports every string drawn (in base px): `tests/support/screenHost.ts` lints each screen with it (glyphs, inside the panel, no overlap) at all three scales.

Adding text to a base-grid screen: use `label` / `hints`, measure with `labelW`, pass names through `{ case: "title" }`, and add the screen to `tests/uiText.test.ts`.

## Widgets
`Gui` is an immediate-mode kit: `panel`, `button`, `toggle`, `slider`, `choice` (segmented), `tabs`, `list` (scrolling, wheel, draggable scrollbar, double-click), `table` (sortable by clicking a header), `graph` (with a budget line), `modalBox` (blocks everything outside it; Esc answers its last button) and tooltips. A click is a press and release on the same widget.

Keyboard and gamepad parity: every interactive widget joins a focus order. Up / Down move focus, Left / Right change a focused slider, choice, toggle or tab bar, Enter / E / Space activate, Q / R switch the main tabs, Esc is "back". A focused list keeps Up / Down for its rows until its first or last row. `view/gamepad.ts` polls the standard mapping once a frame and sends the same keys (stick / D-pad move, A use, B back, X slam, Y pack, LB / RB tabs, LT / RT speed, Start menu), so old and new screens work with a pad unchanged.

## Notifications
`ui/notify.ts`: sim events pass `Game.noteEvent` before their sound and particles; `noteForEvent` (pure) turns the ones a manager needs into info / warn / alert notes (a worker blocked or out of power, an order done, the day turning, something learned). Repeats merge with a count. The feed sits at the right of the hi-res layer (click to dismiss); the LOG tab keeps the history. With "Pause on alert" on (settings, off by default), an alert pauses the game.

## The system menu
Esc on the play screen (after closing any context menu, inspector or selection): GAME, SAVES, SETTINGS, CONTROLS, LOG. It is an ordinary overlay `Screen` (the world waits behind it, the scene keeps animating), drawn with the widget kit.
