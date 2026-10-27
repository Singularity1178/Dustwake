// Deterministic, opt-in test/debug builders. No production map or spawn changes.
import type { AreaData } from "../map";
import { FS, T, TS } from "../content/tiles";

export function buildFoundationArea(id: "debug_yard" | "debug_workshop"): AreaData {
  const w = 16, h = 10, grid = new Uint8Array(w * h).fill(T.FLOOR);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!x || !y || x === w - 1 || y === h - 1) grid[y * w + x] = T.WALL;
  const yard = id === "debug_yard";
  return {
    id, w, h, grid, plan: grid.slice(), style: new Uint8Array(w * h).fill(yard ? FS.GRASS : FS.FLAG), tvar: new Uint8Array(w * h),
    rooms: [], lights: [], decals: [], loose: [], drips: [], exits: [], outdoor: yard, ambient: [0.48, 0.45, 0.5],
    start: { x: 7 * TS + 8, y: 7 * TS + 11 },
    props: [
      { id: `rune.${id}`, kind: "runesite", x: 3 * TS + 8, y: 5 * TS + 11, v: 0 },
      ...(yard ? [
        { id: "tree.fixture", kind: "tree", x: 9 * TS + 8, y: 5 * TS + 14, v: 0 },
        { id: "rock.fixture", kind: "rock", x: 11 * TS + 8, y: 7 * TS + 14, v: 0 },
      ] : [
        { id: "bench.fixture", kind: "workbench", x: 10 * TS + 8, y: 4 * TS + 14, v: 0 },
        { id: "chest.fixture", kind: "storage_chest", x: 11 * TS + 8, y: 5 * TS + 14, v: 0, recipe: "storage_chest" },
      ]),
    ],
  };
}