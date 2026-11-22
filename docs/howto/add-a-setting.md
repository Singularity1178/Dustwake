# How to add a setting

> Index: [docs/index.md](../index.md). Background: [ui/settings.md](../ui/settings.md).

```ts
import { registerSetting } from "../ui/settings";
registerSetting({ id: "minimapSize", label: "Minimap size", category: "display", kind: "slider", def: 100, min: 50, max: 200, step: 10, help: "How big the minimap is." });
```

It appears on the SETTINGS tab under its category, is validated and persists. Read it with `game.settings.num("minimapSize")` (or `bool` / `str`); react to changes in `Game.applySettings` (called on every change) or with `settings.onChange`. Labels and help are drawn in the v2 font: the content linter checks they fit. For a new play-screen key, add an `Action` with its default keys to `ACTIONS` / `DEFAULT_KEYS` and read it with `game.act(...)`; it appears on the CONTROLS tab.
