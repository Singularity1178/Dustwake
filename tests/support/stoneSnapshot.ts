// Developer preview for the stone retexture (run by scripts/stonePreview.mjs, no browser): the rocks, the iron
// veins and both ends of the stair, through the real host on the pixel canvas.
//   sprites.png      every rock and vein variant (standing and broken up) beside the stone it shares the wild
//                    with (boulders, the outcrop, the cairn) and the fall on the stair (rock piles, the fall's foot)
//   field.png        the stretch of the surface with the most rocks and veins in it, as the game lights it at noon
//   stairhead.png    the stair head at every dig stage (buried, earth, earth, stone, stone, open)
//   stair-below.png  the stair's foot in the halls: choked (read under a raised ambient), then open, by day
//   stair-ends.png   the two ends of the open stair side by side, full-bright: they are one flight and must look it
// Nothing is asserted here; tests/stoneArt.test.ts holds what the art has to keep.
import { mkdirSync, writeFileSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { Game } from "../../src/game/game";
import { createWorld, enterArea, getArea, player, setFlag, type World } from "../../src/game/world/world";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { openEntrance } from "../../src/game/sim/digging";
import { DIG_SITES, digTotal } from "../../src/game/content/digging";
import { FLAGS } from "../../src/game/content/flags";
import { GATE_STAIR } from "../../src/game/content/geography";
import { TS } from "../../src/game/content/tiles";
import { propSprite } from "../../src/game/art/props";
import { drawText } from "../../src/game/font";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mode = "lit" | "dim" | "flat";
const DT = 1 / 60, GATE = "buriedgate@48,61";
const mk = (w: number, h: number): RCanvas => { const c = (globalThis as any).document.createElement("canvas") as RCanvas; c.width = w; c.height = h; c.getContext(); return c; };
const cx = (c: RCanvas) => c.getContext() as any;

function newGame(hour: number): { g: Game; w: World } {
  const g = new Game(mk(320, 180) as unknown as HTMLCanvasElement, mk(320, 180) as unknown as HTMLCanvasElement), w = createWorld(7);
  setFlag(w, FLAGS.golemArm); setFlag(w, FLAGS.tutorialDone);
  g.resume(w);
  advanceDayTo(w, hour);
  return { g, w };
}
const tick = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.update(DT); };
/** Swap the frame's lighting for an audit view (as tests/support/dungeonSnapshot.ts does). */
function relight(g: Game, mode: Mode) {
  const L = (g as any).lighting;
  L.orig ??= L.compose.bind(L);
  L.compose = mode === "lit" ? L.orig : (s: Uint8ClampedArray, e: Uint8ClampedArray, o: Uint8ClampedArray, amb: [number, number, number], steps: number, gain: number) =>
    mode === "flat" ? L.orig(s, e, o, [1, 1, 1], steps, 0) : L.orig(s, e, o, [Math.max(amb[0], 0.5), Math.max(amb[1], 0.5), Math.max(amb[2], 0.55)], steps, gain);
}
function frame(g: Game): RCanvas { (g.canvas as unknown as RCanvas).getContext(); g.render(); return g.canvas as unknown as RCanvas; }
/** A world-space rect of the current frame. */
function grab(g: Game, x: number, y: number, w: number, h: number): RCanvas {
  const f = frame(g), cam = (g as any).cam, c = mk(w, h);
  cx(c).drawImage(f, Math.round(x - cam.x), Math.round(y - cam.y), w, h, 0, 0, w, h);
  return c;
}
/** Frames in a row, each captioned, with a gap between. */
function strip(cells: { label: string; img: RCanvas }[], cols = cells.length): RCanvas {
  const w = Math.max(...cells.map((c) => c.img.width)), h = Math.max(...cells.map((c) => c.img.height)) + 8, rows = Math.ceil(cells.length / cols);
  const out = mk(cols * (w + 2) - 2, rows * (h + 2) - 2), o = cx(out);
  o.fillStyle = "#101014"; o.fillRect(0, 0, out.width, out.height);
  cells.forEach((c, i) => { const x = (i % cols) * (w + 2), y = Math.floor(i / cols) * (h + 2); drawText(o, c.label, x + 2, y + 1, "#c8c8d0", 1, "left"); o.drawImage(c.img, x, y + 8); });
  return out;
}

/** Every stone sprite on the ground it stands on. */
function sprites(): RCanvas {
  const rows: { bg: string; items: [string, number, boolean][] }[] = [
    { bg: "#3f5a30", items: [["rock", 0, false], ["rock", 1, false], ["rock", 2, false], ["rock", 3, false], ["rock", 0, true], ["rock", 1, true], ["rock", 2, true], ["rock", 3, true]] },
    { bg: "#55503c", items: [["ironore", 0, false], ["ironore", 1, false], ["ironore", 2, false], ["ironore", 3, false], ["ironore", 0, true], ["ironore", 1, true], ["ironore", 2, true], ["ironore", 3, true]] },
    { bg: "#3f5a30", items: [["boulder", 0, false], ["boulder", 1, false], ["boulder", 2, false], ["cairn", 0, false], ["cairn", 1, false], ["outcrop", 0, false], ["outcrop", 1, false]] },
    { bg: "#2c2830", items: [["rockpile", 0, false], ["rockpile", 1, false], ["rockpile", 2, false], ["stairfall", 0, false], ["stairfoot", 0, false]] },
  ];
  const out = mk(246, 174), o = cx(out);
  let y = 0;
  for (const row of rows) {
    const h = Math.max(...row.items.map(([k, v, a]) => propSprite(k, v, a)!.h)) + 6;
    o.fillStyle = row.bg; o.fillRect(0, y, out.width, h);
    let x = 3;
    for (const [k, v, a] of row.items) { const s = propSprite(k, v, a)!; o.drawImage(s.a, x, y + h - 3 - s.h); x += s.w + 5; }
    y += h + 2;
  }
  return out;
}

export function run(dir = ".preview/stone"): number {
  installDom();
  mkdirSync(dir, { recursive: true });
  const save = (name: string, c: RCanvas, scale: number) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };

  save("sprites", sprites(), 5);

  // ---- the field: the window of the surface with the most rocks and veins, in the game's own noon light
  {
    const { g, w } = newGame(12), pl = player(w), s = getArea(w, "surface");
    enterArea(w, pl, "surface", s.start.x, s.start.y);
    const W = 15, H = 9;
    let best = { n: -1, x: 0, y: 0 };
    for (let ty = 1; ty + H < s.h - 1; ty++) for (let tx = 1; tx + W < s.w - 1; tx++) {
      let n = 0;
      for (const p of s.props) if (p.x >= tx * TS && p.x < (tx + W) * TS && p.y >= ty * TS && p.y < (ty + H) * TS) n += p.kind === "ironore" || p.kind === "rock" ? 1 : 0;
      if (n > best.n) best = { n, x: tx, y: ty };
    }
    (g as any).hideGolem = true;
    g.setZoom(Math.ceil(Math.max((s.w * TS) / 320, (s.h * TS) / 180)));
    tick(g, 30);
    (g as any).cam.x = 0; (g as any).cam.y = 0;
    save("field", grab(g, best.x * TS, best.y * TS, W * TS, H * TS), 5);
    console.log(`  field: tiles ${best.x},${best.y} ${W}x${H}`);
  }

  // ---- the stair head, stage by stage, then both ends of the open stair
  {
    const { g, w } = newGame(12), pl = player(w);
    const surface = getArea(w, "surface"), gate = surface.prop(GATE)!, total = digTotal(DIG_SITES.buriedgate);
    enterArea(w, pl, "surface", gate.x - 60, gate.y + 14);
    tick(g, 60);
    const head = () => grab(g, gate.x - 50, gate.y - 66, 100, 76);
    const cells: { label: string; img: RCanvas }[] = [];
    for (const [dmg, label] of [[0, "0 BURIED"], [2, "1 EARTH"], [6, "2 EARTH"], [8, "3 STONE"], [13, "4 STONE"]] as [number, string][]) { surface.setPropState(GATE, { dmg }); tick(g, 30); cells.push({ label, img: head() }); }

    // the halls' end while the stair is still choked
    const sx = (GATE_STAIR.x + GATE_STAIR.w / 2) * TS, sy = GATE_STAIR.y * TS;
    enterArea(w, pl, "dungeon", sx, sy - 40); pl.facing = "down";
    tick(g, 90);
    const foot = (m: Mode, h = 100) => { relight(g, m); const c = grab(g, sx - 60, sy - 52, 120, h); relight(g, "lit"); return c; };
    const below = [{ label: "CHOKED (RAISED AMBIENT)", img: foot("dim") }, { label: "CHOKED (AS LIT)", img: foot("lit") }];

    // open it
    enterArea(w, pl, "surface", gate.x - 60, gate.y + 14);
    surface.setPropState(GATE, { dmg: total, open: true, lit: true }); surface.touch("layout");
    openEntrance(w, pl, "surface_stair");
    tick(g, 60);
    cells.push({ label: "5 OPEN", img: head() });
    save("stairhead", strip(cells, 3), 4);
    relight(g, "flat"); const headFlat = grab(g, gate.x - 50, gate.y - 66, 100, 76); relight(g, "lit");

    enterArea(w, pl, "dungeon", sx, sy - 40); pl.facing = "down";
    tick(g, 90);
    below.push({ label: "OPEN, NOON (AS LIT)", img: foot("lit") }, { label: "OPEN (RAISED AMBIENT)", img: foot("dim") });
    save("stair-below", strip(below), 3);
    (g as any).hideGolem = true;
    pl.x = sx; pl.y = sy + 34; tick(g, 60);
    relight(g, "flat"); const belowFlat = grab(g, sx - 50, sy - 20, 100, 116); relight(g, "lit");
    save("stair-ends", strip([{ label: "ABOVE: THE STAIR HEAD", img: headFlat }, { label: "BELOW: THE FLIGHT", img: belowFlat }]), 5);
  }
  return 0;
}
