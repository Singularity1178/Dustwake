// Developer tool (not a test): rasterises the worker golem (and the maintainer, for scale) into PNG
// contact sheets, albedo + emissive composited the way the engine lights them, so poses and animations
// can be inspected without a browser. After `npm test` has compiled:
//   node -e "require('./.test-out/tests/support/workerPreview.js').run('.preview')"
import { mkdirSync, writeFileSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { Pen } from "../../src/game/util";
import { drawWorker, type WorkerPose } from "../../src/game/workerArt";
import { drawGolem, type GolemPose } from "../../src/game/golem";

const ctxOf = (c: RCanvas) => c.getContext() as unknown as CanvasRenderingContext2D;

/** One sprite cell: floor tint behind, albedo, then the emissive pass added on top. */
export function cell(draw: (p: Pen) => void, w = 40, h = 36, fy = 29): RCanvas {
  const a = new RCanvas(w, h), e = new RCanvas(w, h);
  const ac = ctxOf(a);
  ac.fillStyle = "#3a3640"; ac.fillRect(0, 0, w, h);
  ac.fillStyle = "#2c2832"; ac.fillRect(0, fy, w, h - fy);
  ac.fillStyle = "rgba(0,0,0,0.45)"; ac.fillRect(w / 2 - 6, fy - 1, 12, 2); ac.fillRect(w / 2 - 3, fy - 3, 6, 4);
  draw(new Pen(ac, false).constructor === Pen ? Object.assign(new Pen(ac, false), { ox: 0 }) : new Pen(ac, false));
  draw(new Pen(ctxOf(e), true));
  // additive glow
  for (let i = 0; i < a.data.length; i += 4) {
    if (e.data[i + 3] > 0) for (let k = 0; k < 3; k++) a.data[i + k] = Math.min(255, a.data[i + k] + e.data[i + k] * 0.9);
  }
  return a;
}

/** Lay cells out on a sheet: rows of cells. */
export function sheet(rows: RCanvas[][]): RCanvas {
  const cw = rows[0][0].width, ch = rows[0][0].height, cols = Math.max(...rows.map((r) => r.length));
  const out = new RCanvas(cw * cols + (cols + 1), ch * rows.length + (rows.length + 1));
  out.data.fill(255);
  rows.forEach((r, j) => r.forEach((c, i) => {
    const ox = 1 + i * (cw + 1), oy = 1 + j * (ch + 1);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = (y * cw + x) * 4, di = ((oy + y) * out.width + ox + x) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = c.data[si + k];
    }
  }));
  return out;
}

export function save(dir: string, name: string, rows: RCanvas[][], scale = 6) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.png`, png(sheet(rows), scale));
}

export const workerCell = (pose: WorkerPose, w = 40, h = 36) => cell((p) => drawWorker(p, w / 2, h - 7, pose), w, h, h - 7);
export const golemCell = (pose: GolemPose, w = 40, h = 36) => cell((p) => drawGolem(p, w / 2, 29, pose), w, h);

export function run(dir: string) {

  const mod = require("./workerPreviewSheets");
  mod.sheets(dir);
}
