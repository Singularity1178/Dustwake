// Developer preview for the rock and stair retexture (run by scripts/rockPreview.mjs, no browser). Everything
// is drawn by the real art, and the in-game frames by the real host on the pixel canvas:
//   sprites.png            every rock sprite and each dig stage of the stair head, labelled, on the ground it stands on
//   surface-N.png          the surface at noon where ore veins stand among rocks and boulders
//   stairhead-stages.png   the stair head at each dig stage (buried, earth, earth, rock, rock broken through, open)
//   stair-above.png        the open stair head with the golem beside it
//   stair-below-*.png      the hall and the flight in the halls: choked and open, lit as in play and full-bright,
//                          and close up (clear, and with the golem against a cheek wall)
//   pick-KIND.png          only when asked for: candidate shapes for a kind, each under its seed number
//                          (how art/rocks.ts ROCK_SEEDS was chosen)
// Nothing is asserted here; tests/rockArt.test.ts holds what the art has to keep.
//
//   node scripts/rockPreview.mjs [name ...]     only the named sheets (sprites, surface, stages, above, below, pick)
import { mkdirSync, writeFileSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { Game } from "../../src/game/game";
import { createWorld, enterArea, getArea, player, setFlag, type World } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { stepPlayer } from "../../src/game/sim/step";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { openEntrance } from "../../src/game/sim/digging";
import { DIG_SITES, digTotal } from "../../src/game/content/digging";
import { FLAGS } from "../../src/game/content/flags";
import { GATE_PASSAGE } from "../../src/game/content/geography";
import { TS } from "../../src/game/content/tiles";
import { propSprite } from "../../src/game/art/props";
import { spriteCache } from "../../src/game/art/common";
import { ROCK_SEEDS, ROCK_SIZE } from "../../src/game/art/rocks";
import { drawText } from "../../src/game/font";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DT = 1 / 60, GATE = "buriedgate@48,61";
type Mode = "lit" | "flat";

const mk = (w: number, h: number): RCanvas => { const c = (globalThis as any).document.createElement("canvas") as RCanvas; c.width = w; c.height = h; c.getContext(); return c; };
const cx = (c: RCanvas) => c.getContext() as any;

/** A game in play at an hour of the day. */
function host(hour: number): { g: Game; w: World } {
  const g = new Game(mk(320, 180) as unknown as HTMLCanvasElement, mk(320, 180) as unknown as HTMLCanvasElement), w = createWorld(7);
  setFlag(w, FLAGS.golemArm);
  g.resume(w);
  advanceDayTo(w, hour);
  return { g, w };
}
const steps = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.update(DT); };
/** Full-bright albedo instead of the frame's lighting (art and layout), as the dungeon preview's `flat`. */
function relight(g: Game, mode: Mode) {
  const L = (g as any).lighting;
  L.__orig ??= L.compose.bind(L);
  L.compose = mode === "lit" ? L.__orig : (s: Uint8ClampedArray, e: Uint8ClampedArray, o: Uint8ClampedArray, _amb: [number, number, number], st: number) => L.__orig(s, e, o, [1, 1, 1], st, 0);
}
function frame(g: Game, mode: Mode = "lit"): RCanvas {
  relight(g, mode);
  (g.canvas as unknown as RCanvas).getContext();
  g.render();
  const f = g.canvas as unknown as RCanvas, c = mk(f.width, f.height);
  cx(c).drawImage(f, 0, 0);
  return c;
}
/** Canvases side by side, a gap between them. */
function row(list: RCanvas[], gap = 2): RCanvas {
  const out = mk(list.reduce((n, c) => n + c.width + gap, -gap), Math.max(...list.map((c) => c.height))), oc = cx(out);
  let x = 0;
  for (const c of list) { oc.drawImage(c, x, 0); x += c.width + gap; }
  return out;
}

// ---- the sprite sheet
type Cell = [kind: string, v: number, alt: boolean, label: string];
const GRASS = "#3a5a2c", FLOOR = "#3a3640";
const ROWS: [string, string, Cell[]][] = [
  ["ROCK (HARVESTED FOR STONE)", GRASS, [["rock", 0, false, "V0"], ["rock", 1, false, "V1"], ["rock", 2, false, "V2"], ["rock", 3, false, "V3"], ["rock", 0, true, "BROKEN"], ["rock", 1, true, "BROKEN"]]],
  ["IRON VEIN (HARVESTED FOR ORE)", GRASS, [["ironore", 0, false, "V0"], ["ironore", 1, false, "V1"], ["ironore", 2, false, "V2"], ["ironore", 0, true, "BROKEN"], ["ironore", 1, true, "BROKEN"]]],
  ["BOULDER, OUTCROP, CAIRN (SCENERY)", GRASS, [["boulder", 0, false, "V0"], ["boulder", 1, false, "V1"], ["boulder", 2, false, "V2"], ["outcrop", 0, false, "V0"], ["outcrop", 1, false, "V1"], ["cairn", 0, false, "CAIRN"], ["cairn", 1, false, "CAIRN"]]],
  ["THE FALL ON THE STAIR BELOW", FLOOR, [["rockpile", 0, false, "V0"], ["rockpile", 1, false, "V1"], ["rockpile", 2, false, "V2"], ["stairfall", 0, false, "FALL"], ["stairpost", 0, false, "POST"], ["stairpost", 1, false, "BROKEN"]]],
  ["STAIR HEAD BY DIG STAGE", GRASS, [0, 1, 2, 3, 4, 5].map((v) => ["buriedgate", v, false, `STAGE ${v}`] as Cell)],
];
function spriteSheet(): RCanvas {
  const pad = 6, size = (c: Cell) => { const s = propSprite(c[0], c[1], c[2])!.a as unknown as RCanvas; return [s.width, s.height]; };
  const rowH = ROWS.map(([, , cells]) => Math.max(...cells.map((c) => size(c)[1])) + 22);
  const W = Math.max(...ROWS.map(([, , cells]) => cells.reduce((n, c) => n + size(c)[0] + pad * 2, pad)));
  const out = mk(W, rowH.reduce((a, b) => a + b, 0)), oc = cx(out);
  let y = 0;
  ROWS.forEach(([title, bg, cells], i) => {
    oc.fillStyle = bg; oc.fillRect(0, y, W, rowH[i]);
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

/** Candidate shapes for one kind: the sprite for each seed in turn, numbered. How ROCK_SEEDS was picked. */
function pickSheet(kind: string, from: number, n: number, per: number, v = 0): RCanvas {
  const [sw, sh] = ROCK_SIZE[kind], cw = sw + 6, ch = sh + 11, out = mk(per * cw, Math.ceil(n / per) * ch), oc = cx(out), keep = ROCK_SEEDS[kind][v];
  oc.fillStyle = GRASS; oc.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < n; i++) {
    ROCK_SEEDS[kind][v] = from + i; spriteCache.clear();
    const x = (i % per) * cw + 3, y = Math.floor(i / per) * ch + 1;
    oc.drawImage(propSprite(kind, v, false)!.a, x, y);
    drawText(oc, String(from + i), x + (sw >> 1), y + sh + 2, "#e8e8e8", 1, "center");
  }
  ROCK_SEEDS[kind][v] = keep; spriteCache.clear();
  return out;
}

export function run(dir = ".preview/rocks", only: string[] = []): number {
  installDom();
  mkdirSync(dir, { recursive: true });
  const want = (n: string) => !only.length || only.includes(n);
  const save = (name: string, c: RCanvas, scale: number) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };

  if (want("sprites")) save("sprites", spriteSheet(), 5);
  // `pick` is only made when asked for: contact sheets of candidate shapes (seed numbers under each)
  if (only.includes("pick")) {
    save("pick-rock", pickSheet("rock", 1, 60, 12), 4); save("pick-ironore", pickSheet("ironore", 1, 60, 12), 4);
    save("pick-boulder", pickSheet("boulder", 1, 40, 10), 4); save("pick-outcrop", pickSheet("outcrop", 1, 24, 6), 4);
  }

  // ---- the surface where veins stand among rocks: the three veins with the most stone about them, well apart
  if (want("surface")) {
    const { g, w } = host(12), pl = player(w), a = getArea(w, "surface");
    const stone = a.props.filter((p) => ["rock", "boulder", "outcrop", "ironore"].includes(p.kind));
    const near = (p: { x: number; y: number }) => stone.filter((q) => Math.abs(q.x - p.x) < 150 && Math.abs(q.y - p.y) < 80).length;
    const picks: { x: number; y: number }[] = [];
    for (const v of a.props.filter((p) => p.kind === "ironore").sort((p, q) => near(q) - near(p) || (p.id < q.id ? -1 : 1))) {
      if (picks.length < 3 && picks.every((q) => Math.hypot(q.x - v.x, q.y - v.y) > 260)) picks.push(v);
    }
    picks.forEach((v, i) => {
      if (!teleportTo(w, pl, "surface", v.x - 30, v.y + 26)) throw new Error("no room by the vein");
      pl.facing = "right";
      steps(g, 60);
      save(`surface-${i + 1}`, frame(g), 4);
    });
  }

  const dug = (w: World, pl: ReturnType<typeof player>) => {
    const surface = getArea(w, "surface");
    surface.setPropState(GATE, { dmg: digTotal(DIG_SITES.buriedgate), open: true, lit: true }); surface.touch("layout");
    openEntrance(w, pl, "surface_stair");
  };

  // ---- the stair head, stage by stage (noon)
  if (want("stages") || want("above")) {
    const { g, w } = host(12), pl = player(w), surface = getArea(w, "surface"), gate = surface.prop(GATE)!;
    enterArea(w, pl, "surface", gate.x - 52, gate.y + 12);
    steps(g, 60);
    const sheet = mk(3 * 130 - 2, 2 * 100 - 2), sc = cx(sheet);
    const cell = (i: number) => { const f = frame(g), cam = (g as any).cam; sc.drawImage(f, Math.round(gate.x - 64 - cam.x), Math.round(gate.y - 78 - cam.y), 128, 98, (i % 3) * 130, Math.floor(i / 3) * 100, 128, 98); };
    [0, 2, 6, 8, 13].forEach((dmg, i) => { surface.setPropState(GATE, { dmg }); steps(g, 40); cell(i); });
    dug(w, pl);
    pl.x = gate.x - 46; pl.y = gate.y - 8; pl.facing = "right";
    steps(g, 40); cell(5);
    if (want("stages")) save("stairhead-stages", sheet, 4);
    if (want("above")) {
      const f = frame(g), cam = (g as any).cam, c = mk(160, 110);
      cx(c).drawImage(f, Math.round(gate.x - 80 - cam.x), Math.round(gate.y - 84 - cam.y), 160, 110, 0, 0, 160, 110);
      pl.x = gate.x; pl.y = gate.y + 7; pl.facing = "up";
      steps(g, 40);
      const f2 = frame(g), cam2 = (g as any).cam, c2 = mk(160, 110);
      cx(c2).drawImage(f2, Math.round(gate.x - 80 - cam2.x), Math.round(gate.y - 84 - cam2.y), 160, 110, 0, 0, 160, 110);
      save("stair-above", row([c, c2]), 5);
    }
  }

  // ---- the flight in the halls: choked (seen from the Vestibule) and open (the golem on it), lit and full-bright
  if (want("below")) {
    const { g, w } = host(12), pl = player(w);
    const sx = (GATE_PASSAGE.x + GATE_PASSAGE.w / 2) * TS, sy = GATE_PASSAGE.y * TS;
    const shot = (mode: Mode) => { const f = frame(g, mode), cam = (g as any).cam, c = mk(150, 150); cx(c).drawImage(f, Math.round(sx - 75 - cam.x), Math.round(sy - 46 - cam.y), 150, 150, 0, 0, 150, 150); return c; };
    if (!teleportTo(w, pl, "dungeon", sx - 30, sy - 22)) throw new Error("no room in the Vestibule");
    pl.facing = "down";
    steps(g, 90);
    save("stair-below-choked", row([shot("lit"), shot("flat")]), 4);
    dug(w, pl);
    pl.x = sx - 14; pl.y = sy + 3 * TS; pl.facing = "down";
    steps(g, 90);
    save("stair-below-open", row([shot("lit"), shot("flat")]), 4);
    // close up, full-bright: the golem in the hall and the flight clear, then the golem walked as far west
    // as the cheek wall lets it, half-way up
    const close = () => { const f = frame(g, "flat"), cam = (g as any).cam, c = mk(84, 116); cx(c).drawImage(f, Math.round(sx - 42 - cam.x), Math.round(sy - 14 - cam.y), 84, 116, 0, 0, 84, 116); return c; };
    pl.x = sx + 18; pl.y = sy + 20; pl.facing = "down";
    steps(g, 30);
    const clear = close();
    pl.x = sx - 10; pl.y = sy + 4 * TS; pl.facing = "left";
    for (let i = 0; i < 60; i++) { stepPlayer(w, DT, { ix: -1, iy: 0, use: false } as any); g.update(DT); }
    save("stair-below-close", row([clear, close()]), 8);
  }
  return 0;
}
