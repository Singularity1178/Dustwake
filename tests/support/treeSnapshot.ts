// Developer preview for the tree and stump retexture (run by scripts/treePreview.mjs, no browser). Everything is
// drawn by the real art, and the in-game frames by the real host on the pixel canvas:
//   sprites.png        every tree variant, the stump a felled tree leaves, the two standing stumps, and the
//                      neighbours they stand among (rock, boulder, log, sapling, bush), labelled, on the ground
//   trunks.png         the one trunk: each tree variant beside its felled stump and the standing stumps, on a
//                      shared ground line with a ruler over the trunk's width, so any drift in thickness shows
//   surface-N.png      the surface at noon where trees, stumps and rocks stand together; some trees felled
//   night-N.png        the same, in the dark, lit by the golem's own light
//   pick-SHAPE.png     only when asked for: candidate crowns for a shape, each under its seed number
//                      (how art/trees.ts TREE_SEEDS was chosen)
// Nothing is asserted here; tests/treeArt.test.ts holds what the art has to keep.
//
//   node scripts/treePreview.mjs [name ...]     only the named sheets (sprites, trunks, surface, night, pick)
import { mkdirSync, writeFileSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { Game } from "../../src/game/game";
import { createWorld, getArea, player, setFlag, type World } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { FLAGS } from "../../src/game/content/flags";
import { propSprite } from "../../src/game/art/props";
import { spriteCache } from "../../src/game/art/common";
import { TREE_SEEDS, TREE_SIZE } from "../../src/game/art/trees";
import { drawText } from "../../src/game/font";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DT = 1 / 60;
const mk = (w: number, h: number): RCanvas => { const c = (globalThis as any).document.createElement("canvas") as RCanvas; c.width = w; c.height = h; c.getContext(); return c; };
const cx = (c: RCanvas) => c.getContext() as any;

function host(hour: number): { g: Game; w: World } {
  const g = new Game(mk(320, 180) as unknown as HTMLCanvasElement, mk(320, 180) as unknown as HTMLCanvasElement), w = createWorld(7);
  setFlag(w, FLAGS.golemArm);
  g.resume(w);
  advanceDayTo(w, hour);
  return { g, w };
}
const steps = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.update(DT); };
function frame(g: Game): RCanvas {
  (g.canvas as unknown as RCanvas).getContext();
  g.render();
  const f = g.canvas as unknown as RCanvas, c = mk(f.width, f.height);
  cx(c).drawImage(f, 0, 0);
  return c;
}

// ---- the sprite sheet
type Cell = [kind: string, v: number, alt: boolean, label: string];
const GRASS = "#3a5a2c";
const ROWS: [string, Cell[]][] = [
  ["TREE (HARVESTED FOR WOOD)", [[ "tree", 0, false, "V0"], ["tree", 1, false, "V1"], ["tree", 2, false, "V2"]]],
  ["STUMPS: FELLED TREE (TAKEN), STANDING STUMP", [["tree", 0, true, "TAKEN 0"], ["tree", 1, true, "TAKEN 1"], ["tree", 2, true, "TAKEN 2"], ["stump", 0, false, "STUMP 0"], ["stump", 1, false, "STUMP 1"]]],
  ["NEIGHBOURS", [["rock", 2, false, "ROCK"], ["boulder", 0, false, "BOULDER"], ["log", 0, false, "LOG"], ["sapling", 0, false, "SAPLING"], ["bush", 0, false, "BUSH"], ["bush", 2, false, "BUSH"]]],
];
function spriteSheet(): RCanvas {
  const pad = 6, size = (c: Cell) => { const s = propSprite(c[0], c[1], c[2])!.a as unknown as RCanvas; return [s.width, s.height]; };
  const rowH = ROWS.map(([, cells]) => Math.max(...cells.map((c) => size(c)[1])) + 22);
  const W = Math.max(...ROWS.map(([, cells]) => cells.reduce((n, c) => n + size(c)[0] + pad * 2, pad)));
  const out = mk(W, rowH.reduce((a, b) => a + b, 0)), oc = cx(out);
  let y = 0;
  ROWS.forEach(([title, cells], i) => {
    oc.fillStyle = GRASS; oc.fillRect(0, y, W, rowH[i]);
    oc.fillStyle = "rgba(0,0,0,0.35)"; oc.fillRect(0, y, W, 8);
    drawText(oc, title, 3, y + 1, "#ffffff", 1, "left");
    let x = pad;
    for (const c of cells) {
      const s = propSprite(c[0], c[1], c[2])!, [sw, sh] = size(c);
      oc.drawImage(s.a, x, y + rowH[i] - 9 - sh);
      drawText(oc, c[3], x + (sw >> 1), y + rowH[i] - 7, "#d8d8d8", 1, "center");
      x += sw + pad * 2;
    }
    y += rowH[i];
  });
  return out;
}

/** The trunk, in one picture: tree, felled stump and standing stumps share a ground line, a ruler over each trunk's width. */
function trunkSheet(): RCanvas {
  const GROUND = 46, W = 3 * 112, out = mk(W, 56), oc = cx(out);
  oc.fillStyle = GRASS; oc.fillRect(0, 0, W, 56);
  for (let v = 0; v < 3; v++) {
    const bx = v * 112;
    const draw = (kind: string, vv: number, alt: boolean, x: number) => { const s = propSprite(kind, vv, alt)!; oc.drawImage(s.a, bx + x - s.ax, GROUND + 1 - s.h); };
    draw("tree", v, false, 24);
    draw("tree", v, true, 56);
    draw("stump", v & 1, false, 88);
    // a ruler: the tree's trunk width at its foot and where the crown ends, carried across to both stumps
    oc.fillStyle = "rgba(255,60,60,0.9)";
    for (const x of [24 - 4, 24 + 4, 56 - 4, 56 + 4, 88 - 4, 88 + 4]) oc.fillRect(bx + x, GROUND + 3, 1, 3);
    oc.fillRect(bx + 20, GROUND + 5, 8, 1); oc.fillRect(bx + 52, GROUND + 5, 8, 1); oc.fillRect(bx + 84, GROUND + 5, 8, 1);
  }
  return out;
}

/** Sprites side by side on the ground, cropped to the bottom `rows` rows (all of them when omitted), for a close look. */
function closeSheet(cells: [string, number, boolean][], rows?: number): RCanvas {
  const sprites = cells.map(([k, v, a]) => propSprite(k, v, a)!), H = Math.max(...sprites.map((s) => Math.min(s.h, rows ?? s.h)));
  const out = mk(sprites.reduce((n, s) => n + s.w + 4, 4), H + 4), oc = cx(out);
  oc.fillStyle = GRASS; oc.fillRect(0, 0, out.width, out.height);
  let x = 4;
  for (const s of sprites) { const h = Math.min(s.h, rows ?? s.h); oc.drawImage(s.a, 0, s.h - h, s.w, h, x, 2 + H - h, s.w, h); x += s.w + 4; }
  return out;
}

/** Candidate crowns for one shape: the sprite for each seed in turn, numbered. How TREE_SEEDS was picked. */
function pickSheet(v: number, from: number, n: number, per: number): RCanvas {
  const cw = TREE_SIZE.w + 4, ch = TREE_SIZE.h + 10, out = mk(per * cw, Math.ceil(n / per) * ch), oc = cx(out), keep = TREE_SEEDS[v];
  oc.fillStyle = GRASS; oc.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < n; i++) {
    TREE_SEEDS[v] = from + i; spriteCache.clear();
    const x = (i % per) * cw + 2, y = Math.floor(i / per) * ch + 1;
    oc.drawImage(propSprite("tree", v, false)!.a, x, y);
    drawText(oc, String(from + i), x + (TREE_SIZE.w >> 1), y + TREE_SIZE.h + 1, "#e8e8e8", 1, "center");
  }
  TREE_SEEDS[v] = keep; spriteCache.clear();
  return out;
}

export function run(dir = ".preview/trees", only: string[] = []): number {
  installDom();
  mkdirSync(dir, { recursive: true });
  const want = (n: string) => !only.length || only.includes(n);
  const save = (name: string, c: RCanvas, scale: number) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };

  if (want("sprites")) save("sprites", spriteSheet(), 6);
  if (want("trunks")) save("trunks", trunkSheet(), 5);
  if (want("close")) {
    save("close-trees", closeSheet([["tree", 0, false], ["tree", 1, false], ["tree", 2, false]]), 14);
    save("close-stumps", closeSheet([["tree", 0, true], ["tree", 1, true], ["tree", 2, true], ["stump", 0, false], ["stump", 1, false]]), 16);
    save("close-feet", closeSheet([["tree", 0, false], ["tree", 0, true], ["stump", 0, false], ["tree", 1, false], ["tree", 1, true], ["stump", 1, false]], 19), 12);
  }
  if (only.includes("pick")) for (let v = 0; v < 3; v++) save(`pick-${v}`, pickSheet(v, 1, 40, 10), 4);

  // ---- the surface: a clump of trees with stumps and stone, a few trees felled; once at noon, once at night
  const scenes = (name: string, hour: number, count: number) => {
    const { g, w } = host(hour), pl = player(w), a = getArea(w, "surface");
    const trees = a.props.filter((p) => p.kind === "tree"), stumps = a.props.filter((p) => p.kind === "stump");
    const near = (p: { x: number; y: number }, kinds: string[]) => a.props.filter((q) => kinds.includes(q.kind) && Math.abs(q.x - p.x) < 140 && Math.abs(q.y - p.y) < 80).length;
    // anchor on stumps where trees and stone stand about them, well apart
    const picks: { x: number; y: number }[] = [];
    for (const s of stumps.sort((p, q) => near(q, ["tree", "rock", "boulder", "log"]) - near(p, ["tree", "rock", "boulder", "log"]) || (p.id < q.id ? -1 : 1))) {
      if (picks.length < count && picks.every((q) => Math.hypot(q.x - s.x, q.y - s.y) > 240)) picks.push(s);
    }
    // fell two trees by each pick so the felled stump shows among standing ones
    picks.forEach((s, i) => {
      trees.filter((t) => Math.hypot(t.x - s.x, t.y - s.y) < 90).sort((p, q) => Math.hypot(p.x - s.x, p.y - s.y) - Math.hypot(q.x - s.x, q.y - s.y)).slice(0, 2).forEach((t) => a.damageProp(t.id, 4));
      if (!teleportTo(w, pl, "surface", s.x - 34, s.y + 30)) throw new Error("no room by the stump");
      pl.facing = "right";
      steps(g, 70);
      save(`${name}-${i + 1}`, frame(g), 4);
    });
  };
  if (want("surface")) scenes("surface", 12, 3);
  if (want("night")) scenes("night", 23, 2);
  return 0;
}
