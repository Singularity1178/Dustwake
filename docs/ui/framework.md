# UI framework v2 (Phase 0.5)

> Index: [docs/index.md](../index.md). Code: `ui/gui.ts`, `ui/font2.ts`, `ui/notify.ts`, `view/hudHi.ts`, `screens/system.ts`, `view/gamepad.ts`, `App.tsx`. Tests: `tests/uiFramework.test.ts`, `tests/hostPhase0.test.ts`.

## Three layers
The world canvas stays pixel-perfect at the base resolution times the zoom; the base UI canvas (320x180) keeps the HUD and every original overlay; a third, high-resolution UI canvas on top (2x the base, 3x for the "Compact" UI scale; "Large" draws the same canvas at 2x per logical pixel) carries the v2 interface: the speed bar, the notification feed, tooltips, the selection and inspector panels, context menus and the system menu. It takes the mouse.

## Mouse
`App.tsx` reports pointer move / down / up / leave in base-layer pixels, right-click and the wheel. In the world (play screen, `view/hudHi.ts`): hover shows a tooltip (name, what it is doing, what a click does); a click on the thing E would use uses it (on the next tick); a click selects an actor; dragging selects every actor in the box; right-click opens a context menu (Inspect, Use, Add to / remove from selection, Clear selection, Pause, Menu); the inspector shows an actor's or a prop's details. The wheel zooms, unless a list or slider under the pointer takes it (`gui.wantsWheel`).

## The v2 font
`ui/font2.ts`: mixed case and proportional (a 9-row cell: 7-row caps, descenders), with typographic marks mapped onto its glyphs. Drawing goes through a per-colour glyph atlas (one `drawImage` per character); measuring, wrapping and clipping are pure.

## Widgets
`Gui` is an immediate-mode kit: `panel`, `button`, `toggle`, `slider`, `choice` (segmented), `tabs`, `list` (scrolling, wheel, draggable scrollbar, double-click), `table` (sortable by clicking a header), `graph` (with a budget line), `modalBox` (blocks everything outside it; Esc answers its last button) and tooltips. A click is a press and release on the same widget.

Keyboard and gamepad parity: every interactive widget joins a focus order. Up / Down move focus, Left / Right change a focused slider, choice, toggle or tab bar, Enter / E / Space activate, Q / R switch the main tabs, Esc is "back". A focused list keeps Up / Down for its rows until its first or last row. `view/gamepad.ts` polls the standard mapping once a frame and sends the same keys (stick / D-pad move, A use, B back, X slam, Y pack, LB / RB tabs, LT / RT speed, Start menu), so old and new screens work with a pad unchanged.

## Notifications
`ui/notify.ts`: sim events pass `Game.noteEvent` before their sound and particles; `noteForEvent` (pure) turns the ones a manager needs into info / warn / alert notes (a worker blocked or out of power, an order done, the day turning, something learned). Repeats merge with a count. The feed sits at the right of the hi-res layer (click to dismiss); the LOG tab keeps the history. With "Pause on alert" on (settings, off by default), an alert pauses the game.

## The system menu
Esc on the play screen (after closing any context menu, inspector or selection): GAME, SAVES, SETTINGS, CONTROLS, LOG. It is an ordinary overlay `Screen` (the world waits behind it, the scene keeps animating), drawn with the widget kit.
