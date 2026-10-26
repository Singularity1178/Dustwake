# Dustwake

> A golem wakes in the ruins.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Move |
| `E` / `Enter` | Interact / use |
| `Space` | Attack: a heavy two-arm ground slam. Works anywhere, facing anything, with or without the iron arm, even right next to something you could interact with (that stays on `E`) |
| `I` / `Tab` | Open pack (inventory) |
| Movement keys (pack open) | Move the slot cursor |
| `E` (pack open) | Use / read the selected item, or put on gear (the basket goes on the golem's back: 48 slots) |
| `A` / left from the first slot (pack open) | The back slot, beside the golem figure (`D` / right goes back to the pack). `E` takes the basket off, if everything still fits without it |
| `Q` (pack open) | Drop one of the selected item in front of the golem |
| `M` | Read schematic (once found) |
| `B` | Build menu (once you know how). Opens on the last thing you built |
| Movement keys (build menu) | Move the catalog cursor |
| `Q` / `R` or `1`-`7` (build menu) | Previous / next category tab, or jump to a tab (ALL, FAV, LIGHT, CRAFT, DEFENSE, FURNITURE, DECOR) |
| `/` or `T` (build menu) | Search: type letters, digits and spaces. Arrows still browse, `Backspace` deletes, `Enter` keeps the filter, `Esc` clears it |
| `O` / `G` / `F` (build menu) | Cycle sort (type / name / cost) / toggle "can build only" / toggle favorite |
| `E` (build menu) | Pick the entry and go to placement |
| `V` | Quick re-place: straight to the ghost with the last used entry |
| Movement keys / `E` (placement) | Move the ghost / place |
| `T` (placement or remove) | Toggle repeat (on by default: the tool comes back after each build or removal) |
| `X` (build menu or placement) | Deconstruct tool: take apart highlighted props for a full refund (`E` confirm, `X` back to building) |
| `B` / `Q` (placement or remove) | Back to the build menu |
| `Esc` (build tools) | Close |
| `E` on a workbench (the dungeon's, or a crafting bench you built) | Open the crafting screen (`W`/`S` choose, `D` or `E` to the CRAFT button, `Esc` close). It opens greyed out, with no plans shown, until you know how to build |
| `E` on a teleport rune | Travel to its linked rune |
| `E` on a tree or rock | Harvest wood / stone with your fists |
| `Space` facing a cracked wall | Slam it down once the iron arm is attached. Without the arm it takes the hit and holds. `E` only pushes it (with a hint) |
| `E` on someone | Talk (dialogue: `E` / `Space` / `Enter` finish the line, then next; `Esc` leave) |
| Mouse wheel | Zoom 1x / 1.5x / 2x (once your eye has been mended) |
| `Esc` / `I` / `Tab` | Close menu |
| `K` | Save the game (one slot, kept in the browser's localStorage) |
| `L` | Load the saved game (also on the title screen, to continue) |
| `R` | Wake again (restart) |

Click or press any key on the title screen to begin.

Debug keys (testing only): `Ctrl+1` toggle iron arm, `Ctrl+2` runes + core + tools, `Ctrl+3` super speed, `Ctrl+4` build + masonry knowledge, the basket worn on the golem's back (the one in the pack if it has one), 40 wood and 40 stone (enough to try every buildable), `Ctrl+5` toggle the mended eye (`golem.eye`) and its zoom.

## Running locally

```bash
npm install
npm run dev
```

Open the printed local URL in your browser.

## Building

```bash
npm run build
```

The build uses [`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile), so the output is a single self-contained `dist/index.html` that can be opened directly in a browser.

## Tests

```bash
npm test
```

Headless simulation tests (no browser): compiled with the project's TypeScript and run with Node's built-in test runner.

## Project layout

```
src/
  App.tsx            canvas mount, game loop, input wiring
  game/
    core/            seeded RNG, hashing (pure)
    content/         items, props, tiles, glyphs, flags, tasks, interaction rules,
                     inventory tiers, rune network, harvest yields, build recipes,
                     NPC definitions, dialogue scripts + beats (data)
    map.ts           tutorial dungeon area builder
    surface.ts       surface area builder (ruins above the buried dungeon)
    world/           Area, World, area registry, save/load (simulated + saved state)
    sim/             tasks/effects, interactions, inventory, gear (the back slot), runes, building,
                     collision, ritual puzzle, dialogue engine, stepping, UI commands (no DOM)
    view/            area view: baked background + light registry; zoom model
    ui/              screen stack, shared overlay kit + UiHost (frames, text field),
                     text wrapping, dialogue box geometry/layout (no DOM)
    game.ts          host: input, screen stack, camera, particles, audio, event reactions,
                     world rendering, render loop
    art/             procedural pixel art, by what it draws:
      palette.ts       shared colour ramps
      common.ts        sprite cache, registry types, shared stone blob
      tiles.ts         background bake (floors, walls, ground) + tile sprites (rubble, pillars, door, bars)
      decals.ts        decals painted into the bake
      props.ts         PROP_ART registry + propSprite (draw functions in propsSurface.ts / propsDungeon.ts)
      items.ts         ITEM_ART registry, itemIcon, glyph patterns
    golem.ts         golem drawing
    npcArt.ts        NPC drawing (NPC_ART, keyed by NpcDef art id)
    schematic.ts     schematic plan drawing (the overlay is screens/schematic.ts)
    light.ts         lighting and glow
    audio.ts         synthesized sound effects
    font.ts          bitmap font
    circle.ts        rune circle art
    util.ts          canvas helpers
    screens/         screens split out of game.ts, behind ui/kit.ts UiHost: build menu + tools,
                     crafting, pack, book, schematic, dialogue; title/end cards (cards.ts)
tests/               headless sim tests (tests/support/uiSnapshot.ts renders the build,
                     crafting and dialogue screens to PNG at 320x180 without a browser;
                     tests/support/golemSnapshot.ts renders the golem's poses to PNG)
docs/ARCHITECTURE.md structure, boundaries, deferred work
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Status

An early prototype — a short vertical slice rather than a finished game.
