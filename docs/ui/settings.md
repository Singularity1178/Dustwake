# Settings and accessibility (Phase 0.7)

> Index: [docs/index.md](../index.md). Code: `ui/settings.ts`, `Game.applySettings`, the SETTINGS and CONTROLS tabs of `screens/system.ts`.

One registry: `registerSetting({ id, label, category, kind: "slider" | "toggle" | "choice", def, ... })`. Every registered setting appears on the settings screen under its category, is validated (sliders clamp and snap to their step, choices must be an option) and persists in localStorage (`dustwake.settings`). Later features register their options from their own module; see [how to add a setting](../howto/add-a-setting.md).

| Category | Settings |
| --- | --- |
| Audio | master, effects, ambience volume (the synth now mixes through separate effect and ambience buses) |
| Display | UI scale (compact / normal / large), smooth motion (interpolation), performance readout |
| Accessibility | screen shake on / off and strength, bright flashes (off: white flashes dim to a soft fade), overlay colours: default, deuteranopia, protanopia, tritanopia (Okabe-Ito based) and high contrast; they recolour the vision overlay's categories and the UI's alert, warning, info and selection colours |
| Game | autosave interval, pause on alert, simulation LOD |

## Key remapping
The play screen's actions (move, interact, attack, core, vision, pack, build, quick re-place, schematic, quick save, continue, pause) are read through `Game.act` / `Game.held`, which look up `Settings.keys(action)`. CONTROLS lists them; click a row (or Enter) and press a key. A key bound to one action is taken off every other, so no key does two things in play. Menus keep their own keys, as before.
