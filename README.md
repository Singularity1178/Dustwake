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

## Project layout

```
src/
  App.tsx            canvas mount, game loop, input wiring
  game/
    game.ts          game states, simulation, rendering
    map.ts           dungeon layout and rooms
    art.ts           procedural pixel-art sprites and tiles
    golem.ts         player character
    schematic.ts     schematic UI
    light.ts         lighting and glow
    audio.ts         synthesized sound effects
    font.ts          bitmap font
    circle.ts        circle primitives
    util.ts          shared helpers
  utils/cn.ts        class name helper
```

## Status

An early prototype — a short vertical slice rather than a finished game.
