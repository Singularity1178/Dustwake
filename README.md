# Dustwake

> A golem wakes in the ruins.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Move |
| `E` / `Space` / `Enter` | Interact / use |
| `I` / `Tab` | Open pack (inventory) |
| `M` | Read schematic (once found) |
| `Esc` / `I` / `Tab` | Close menu |
| `R` | Wake again (restart) |

Click or press any key on the title screen to begin.

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
    content/         items, props, tiles, glyphs, flags, tasks, interaction rules (data)
    map.ts           tutorial dungeon area builder
    world/           Area, World, area registry, save/load (simulated + saved state)
    sim/             tasks/effects, interactions, ritual puzzle, stepping (no DOM)
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
    util.ts          canvas helpers
tests/               headless sim tests
docs/ARCHITECTURE.md structure, boundaries, deferred work
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Status

An early prototype — a short vertical slice rather than a finished game.
