# Dustwake

> A golem wakes in the ruins.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Move |
| `E` / `Space` / `Enter` | Interact / use |
| `I` / `Tab` | Open pack (inventory) |
| Movement keys (pack open) | Move the slot cursor |
| `E` (pack open) | Use / read the selected item |
| `Q` (pack open) | Drop one of the selected item in front of the golem |
| `M` | Read schematic (once found) |
| `B` | Build (once you know how): placement mode |
| Movement keys / `E` / `Esc` (placement) | Move the ghost / place / cancel |
| `E` on a teleport rune | Travel to its linked rune |
| `E` on a tree or rock | Harvest wood / stone with your fists |
| `Esc` / `I` / `Tab` | Close menu |
| `R` | Wake again (restart) |

Click or press any key on the title screen to begin.

Debug keys (testing only): `Ctrl+1` toggle iron arm, `Ctrl+2` runes + core + tools, `Ctrl+3` super speed, `Ctrl+4` build knowledge + basket + materials.

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

`node scripts/preview.mjs` renders PNG previews (surface views, the buried gate, the rune at several awakening stages, the dungeon's collapsed gate) to `.preview/` through a small software canvas, with no browser needed. They approximate the game's renderer without the golem or particles.

## Project layout

```
src/
  App.tsx            canvas mount, game loop, input wiring
  game/
    core/            seeded RNG, hashing (pure)
    content/         geo (dungeon<->surface offset), items, props, tiles, glyphs, flags, tasks, interaction rules,
                     inventory tiers, rune network, harvest yields, build recipes (data)
    map.ts           tutorial dungeon area builder
    surface.ts       surface area builder (overgrown wilds hiding the buried dungeon)
    world/           Area, World, area registry, save/load (simulated + saved state)
    sim/             tasks/effects, interactions, inventory, runes, building,
                     collision, ritual puzzle, stepping, UI commands (no DOM)
    view/            area view: baked background + light registry
    ui/              screen stack
    game.ts          host + presentation: screens, camera, particles, audio, rendering
    art.ts           procedural pixel-art sprites and tiles
    golem.ts         golem drawing
    schematic.ts     schematic UI
    light.ts         lighting and glow
    audio.ts         synthesized sound effects
    font.ts          bitmap font
    circle.ts        rune circle art
    surfaceRune.ts   surface rune: eroded/overgrown layout, awakening sweep, cached layers
    util.ts          canvas helpers
tests/               headless sim tests
docs/ARCHITECTURE.md structure, boundaries, deferred work
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Status

An early prototype — a short vertical slice rather than a finished game.
