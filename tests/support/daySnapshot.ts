// Developer tool (not a test): renders the day/night cycle and the crossing
// cutscene to PNG contact sheets without a browser. Unlike townSnapshot.ts
// (which draws an area by itself), this drives the real host: a Game on a
// pixel canvas, stepped with update() and drawn with render(), so what is on
// the sheet is what the game shows (the hour's ambient, tended lamps lit or
// out, the HUD clock, the letterbox, the golem's thoughts).
//
//   node scripts/dayPreview.mjs        -> .preview/day/*.png
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { Game } from "../../src/game/game";
import { createWorld, currentArea, emit, getArea, player, setFlag, type World } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { beginTask } from "../../src/game/sim/tasks";
import { RULES } from "../../src/game/content/interactions";
import { RUNE_NODES } from "../../src/game/content/runes";
import { FLAGS } from "../../src/game/content/flags";
import { TS } from "../../src/game/content/tiles";
import { drawTextS } from "../../src/game/font";

/** The snapshot canvas with real pixels both ways and additive blending, which the world's lighting and glow need. */
class DCanvas extends RCanvas {
  getContext() {
    const ctx: any = super.getContext();
    if (!ctx.__day) {
      ctx.__day = true;
      ctx.putImageData = (img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => {
        for (let j = 0; j < img.height; j++) {
          const ty = y + j; if (ty < 0 || ty >= this.height) continue;
          for (let i = 0; i < img.width; i++) {
            const tx = x + i; if (tx < 0 || tx >= this.width) continue;
            const s = (j * img.width + i) * 4, d = (ty * this.width + tx) * 4;
            for (let k = 0; k < 4; k++) this.data[d + k] = img.data[s + k];
          }
        }
      };
      ctx.getImageData = (x: number, y: number, w: number, h: number) => {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const s = ((y + j) * this.width + x + i) * 4, d = (j * w + i) * 4;
          for (let k = 0; k < 4; k++) out[d + k] = this.data[s + k];
        }
        return { data: out, width: w, height: h };
      };
      const over = ctx.blend.bind(ctx);
      ctx.blend = (i: number, c: number[], a: number) => {
        if (ctx.globalCompositeOperation !== "lighter") return over(i, c, a);
        const d = this.data, k = c[3] * a;
        d[i] = Math.min(255, d[i] + c[0] * k); d[i + 1] = Math.min(255, d[i + 1] + c[1] * k); d[i + 2] = Math.min(255, d[i + 2] + c[2] * k);
        d[i + 3] = 255;
      };
    }
    return ctx;
  }
}
const canvas = (w: number, h: number) => { const c = new DCanvas(w, h); c.getContext(); return c; };
export function installDom() {
  const g = globalThis as any;
  g.document = { createElement: () => new DCanvas() };
  g.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const DT = 1 / 60;
const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
const newGame = () => new Game(canvas(320, 180) as unknown as HTMLCanvasElement, canvas(320, 180) as unknown as HTMLCanvasElement);

/** The frame as the player sees it: the world layer with the UI layer over it (at the world layer's size). */
function shot(g: Game): RCanvas {
  (g.canvas as unknown as RCanvas).getContext(); // the snapshot canvas only takes a new size here (the zoomed view resizes it)
  g.render();
  const wc = g.canvas as unknown as RCanvas, uc = g.uiCanvas as unknown as RCanvas;
  const out = canvas(wc.width, wc.height), ctx: any = out.getContext();
  ctx.drawImage(wc, 0, 0); ctx.drawImage(uc, 0, 0, wc.width, wc.height);
  return out;
}

/** A grid of frames, each captioned. */
function sheet(cols: number, frames: { label: string; img: RCanvas }[]): RCanvas {
  const w = frames[0].img.width, h = frames[0].img.height, rows = Math.ceil(frames.length / cols);
  const out = canvas(cols * w, rows * h), ctx: any = out.getContext();
  frames.forEach((f, i) => {
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    ctx.drawImage(f.img, x, y);
    drawTextS(ctx, f.label, x + 4, y + 4, "#ffffff", 1, "left", "#000000");
  });
  return out;
}

/** A world with the golem standing at a place, its eye mended (the wider view) if `wide`. */
function at(area: string, tx: number, ty: number, wide: boolean): { g: Game; w: World } {
  const g = newGame(), w = createWorld(7);
  if (wide) setFlag(w, FLAGS.golemEye);
  setFlag(w, FLAGS.golemArm);
  if (area !== "dungeon") setFlag(w, FLAGS.tutorialDone);
  // tx < 0: stand where the area is entered (a room: just inside its door)
  const s = tx < 0 ? getArea(w, area).start : { x: tx * TS + 8, y: ty * TS + 8 };
  if (!teleportTo(w, player(w), area, s.x, s.y)) throw new Error(`no room at ${area} ${tx},${ty}`);
  g.resume(w);
  return { g, w };
}

/** The same place at several hours. */
function hours(area: string, tx: number, ty: number, wide: boolean, list: [number, string][]) {
  const { g, w } = at(area, tx, ty, wide);
  return list.map(([h, name]) => {
    advanceDayTo(w, h);
    tick(g, 90);
    return { label: `${area.toUpperCase()} ${name}`, img: shot(g) };
  });
}

/** The first jump, begun as the sim begins it (sim/step.ts) without solving the ritual. */
function beginFirstJump(w: World) {
  const pl = player(w), c = currentArea(w).ritualPos;
  setFlag(w, RUNE_NODES.dungeon.flag);
  pl.x = c.x; pl.y = c.y + 4; pl.facing = "down";
  beginTask(pl, RULES.rune[RULES.rune.length - 1].task, { kind: "rune", x: c.x, y: c.y, propId: "rune.dungeon" });
  emit(w, { t: "teleport", actor: pl.id, first: true, x: c.x, y: c.y });
}

export function run(dir = ".preview/day") {
  installDom();
  mkdirSync(dir, { recursive: true });
  const save = (name: string, c: RCanvas, scale = 1) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  const day: [number, string][] = [[1, "01:00 NIGHT"], [6.2, "06:10 DAWN"], [12, "12:00 DAY"], [20.1, "20:05 DUSK"]];

  // the town: the market square and the poorer Low Street, round the clock
  save("town_square", sheet(2, hours("town", 47, 33, true, day)));
  save("town_lowstreet", sheet(2, hours("town", 44, 46, true, day)));
  // the wild, the halls' broken roof, and a room
  save("surface", sheet(2, hours("surface", 48, 37, true, day)));
  save("halls_and_rooms", sheet(2, [
    ...hours("dungeon", 31, 11, false, [[1, "ROOF CRACK 01:00"], [12, "ROOF CRACK 12:00"]]),
    ...hours("town_tavern", -1, -1, false, [[1, "DOOR 01:00"], [12, "DOOR 12:00"]]),
  ]), 2);

  // the opening, with its skip hint
  const intro = newGame();
  intro.keyDown("x"); tick(intro); intro.keyUp("x");
  tick(intro, 60 * 7);
  // the crossing, from a real first jump
  const g = newGame(), w = createWorld(7);
  setFlag(w, FLAGS.golemArm);
  g.resume(w);
  beginFirstJump(w);
  const frames: { label: string; img: RCanvas }[] = [];
  tick(g, 60 * 3);
  frames.push({ label: "LIFT-OFF", img: shot(g) });
  while (!g.screens.is("crossing")) tick(g);
  const ui = g.crossingUi, A = ui.at;
  const grab = (t: number, label: string) => { while (ui.screen.t < t) tick(g); frames.push({ label, img: shot(g) }); };
  grab(0.55, "TRANSIT: THE ROOM IT LEFT");
  grab(1.25, "TRANSIT: THE FALLEN HALLS");
  grab(2.5, "TRANSIT: CLAY AND ROOTS");
  grab(A.stall + 0.9, "TRANSIT: STALLED");
  grab(A.rewrite + 1.3, "TRANSIT: REWRITING");
  grab(A.surface + 4.6, "ARRIVAL: THE RUNE REDRAWS");
  grab(A.surface + 8.0, "ARRIVAL: THE SUMMONS");
  grab(A["look left"] + 0.3, "LANDED, LOOKING ABOUT");
  grab(A["first light"] + 3.2, "FIRST LIGHT");
  grab(A.chapter + 2.6, "CHAPTER CARD");
  g.keyDown("e"); tick(g); g.keyUp("e"); tick(g, 30);
  frames.push({ label: "CONTROL", img: shot(g) });
  frames.push({ label: "THE OPENING (ESC SKIPS IT TOO)", img: shot(intro) });
  save("crossing", sheet(3, frames.slice(0, 6)), 2);
  save("crossing_arrival", sheet(3, frames.slice(6)), 2);
}
