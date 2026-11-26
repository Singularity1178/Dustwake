// Developer tool (not a test): renders the game speed's look (view/timeFx.ts) without a browser. A Game on a pixel
// canvas is driven through the real host: the town at 1x, paused, 2x, 4x and 8x, each settled, drawn as the browser
// stacks the layers: the world canvas with its CSS grade (emulated here pixel by pixel from the very filter string the
// game sets), the fixed overlay layer, then the UI layer.
//
//   node scripts/timeFxPreview.mjs        -> .preview/timefx/*.png
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { Game } from "../../src/game/game";
import { createWorld, player, setFlag } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { FLAGS } from "../../src/game/content/flags";
import { TS } from "../../src/game/content/tiles";
import { drawTextS } from "../../src/game/font";

type Px = Uint8ClampedArray;

/** Apply a CSS `filter` string (saturate / brightness / contrast / hue-rotate, as timeFx writes it) to RGBA pixels. */
export function applyCssFilter(data: Px, filter: string) {
  for (const m of filter.matchAll(/(saturate|brightness|contrast|hue-rotate)\((-?[\d.]+)(?:deg)?\)/g)) {
    const v = Number(m[2]);
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (m[1] === "saturate") {
        const nr = (0.213 + 0.787 * v) * r + (0.715 - 0.715 * v) * g + (0.072 - 0.072 * v) * b;
        const ng = (0.213 - 0.213 * v) * r + (0.715 + 0.285 * v) * g + (0.072 - 0.072 * v) * b;
        const nb = (0.213 - 0.213 * v) * r + (0.715 - 0.715 * v) * g + (0.072 + 0.928 * v) * b;
        r = nr; g = ng; b = nb;
      } else if (m[1] === "brightness") { r *= v; g *= v; b *= v; }
      else if (m[1] === "contrast") { r = (r - 127.5) * v + 127.5; g = (g - 127.5) * v + 127.5; b = (b - 127.5) * v + 127.5; }
      else {
        const a = (v * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const nr = (0.213 + c * 0.787 - s * 0.213) * r + (0.715 - c * 0.715 - s * 0.715) * g + (0.072 - c * 0.072 + s * 0.928) * b;
        const ng = (0.213 - c * 0.213 + s * 0.143) * r + (0.715 + c * 0.285 + s * 0.14) * g + (0.072 - c * 0.072 - s * 0.283) * b;
        const nb = (0.213 - c * 0.213 - s * 0.787) * r + (0.715 - c * 0.715 + s * 0.715) * g + (0.072 + c * 0.928 + s * 0.072) * b;
        r = nr; g = ng; b = nb;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
}

const mk = (w: number, h: number) => { const c = (globalThis as any).document.createElement("canvas") as RCanvas; c.width = w; c.height = h; c.getContext(); return c; };

/** The frame as the browser stacks it: world (graded), fixed layer, UI layer; at the world layer's size. */
function frame(g: Game): RCanvas {
  // the snapshot canvases only take a new size (the zoomed view resizes them) when asked for a context
  for (const c of [g.canvas, g.fixedCanvas, g.uiCanvas, g.hiCanvas]) (c as unknown as RCanvas).getContext();
  g.render();
  for (const c of [g.canvas, g.fixedCanvas, g.uiCanvas, g.hiCanvas]) (c as unknown as RCanvas).getContext();
  const wc = g.canvas as unknown as RCanvas, W = wc.width, H = wc.height;
  const out = new RCanvas(W, H);
  out.data.set(wc.data);
  applyCssFilter(out.data, g.timeFx.filter());
  for (const layer of [g.fixedCanvas as unknown as RCanvas, g.uiCanvas as unknown as RCanvas, g.hiCanvas as unknown as RCanvas]) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, s = (Math.floor((y * layer.height) / H) * layer.width + Math.floor((x * layer.width) / W)) * 4, a = layer.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.min(255, out.data[o + c] * (1 - a) + layer.data[s + c]);
    }
  }
  return out;
}

export function run(dir = ".preview/timefx") {
  installDom();
  mkdirSync(dir, { recursive: true });
  const w = createWorld(7);
  setFlag(w, FLAGS.golemEye); setFlag(w, FLAGS.golemArm); setFlag(w, FLAGS.tutorialDone);
  const g = new Game(mk(320, 180) as unknown as HTMLCanvasElement, mk(320, 180) as unknown as HTMLCanvasElement);
  teleportTo(w, player(w), "town", 47 * TS + 8, 33 * TS + 8);
  g.resume(w);
  advanceDayTo(w, 12);
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  const frames: { label: string; img: RCanvas }[] = [];
  const save = (name: string, c: RCanvas, scale = 1) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  for (const [speed, label] of [[1, "1X: NOTHING"], [0, "PAUSED"], [2, "2X"], [4, "4X"], [8, "8X"]] as const) {
    g.setSpeed(speed);
    for (let i = 0; i < 150; i++) g.update(1 / 60); // 2.5 s: eased in
    const img = frame(g);
    frames.push({ label, img });
    save(`speed_${speed}`, img, 2);
  }
  const W = frames[0].img.width, H = frames[0].img.height;
  const sheet = new RCanvas(W * 2, H * 3), sctx: any = sheet.getContext();
  frames.forEach((f, i) => {
    const x = (i % 2) * W, y = Math.floor(i / 2) * H;
    sctx.drawImage(f.img, x, y);
    drawTextS(sctx, f.label, x + 4, y + 4, "#ffffff", 1, "left", "#000000");
  });
  save("sheet", sheet);
}
