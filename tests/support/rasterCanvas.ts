// A canvas that really holds pixels, for Node: the small part of the 2D context the background bake and the view's
// copy use (putImageData, fillRect with a clip rect and a whole-pixel translate, unscaled drawImage). The recording
// fake (fakeCanvas.ts) can say two runs issued the same calls; this can say two different sequences of calls left the
// same picture, which is what "the chunked background is pixel-identical to the single canvas" has to mean.
//
// It also keeps a log of every canvas made, so a test can hold that nothing ever asked for one larger than a chunk.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Clip = [number, number, number, number] | null;
interface State { tx: number; ty: number; clip: Clip; fillStyle: string; globalAlpha: number }

export const canvasLog = { made: 0, maxW: 0, maxH: 0 };
export function resetCanvasLog() { canvasLog.made = 0; canvasLog.maxW = 0; canvasLog.maxH = 0; }

function colour(c: string): [number, number, number, number] {
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^#([0-9a-f]{3})$/i))) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
  if ((m = c.match(/^#([0-9a-f]{6})$/i))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  if ((m = c.match(/^#([0-9a-f]{8})$/i))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), parseInt(m[1].slice(6, 8), 16) / 255];
  if ((m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i))) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`rasterCanvas: colour "${c}" not understood`);
}

class RasterCtx {
  fillStyle = "#000";
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  imageSmoothingEnabled = false;
  private tx = 0; private ty = 0;
  private clipR: Clip = null;
  private path: Clip = null;
  private stack: State[] = [];
  constructor(public canvas: RasterCanvas) {}

  save() { this.stack.push({ tx: this.tx, ty: this.ty, clip: this.clipR, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha }); }
  restore() { const s = this.stack.pop(); if (s) { this.tx = s.tx; this.ty = s.ty; this.clipR = s.clip; this.fillStyle = s.fillStyle; this.globalAlpha = s.globalAlpha; } }
  translate(x: number, y: number) { if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error("rasterCanvas: whole-pixel translate only"); this.tx += x; this.ty += y; }
  beginPath() { this.path = null; }
  rect(x: number, y: number, w: number, h: number) { this.path = [x + this.tx, y + this.ty, x + this.tx + w, y + this.ty + h]; }
  clip() {
    const p = this.path;
    if (!p) return;
    const c = this.clipR;
    this.clipR = c ? [Math.max(c[0], p[0]), Math.max(c[1], p[1]), Math.min(c[2], p[2]), Math.min(c[3], p[3])] : [p[0], p[1], p[2], p[3]];
  }
  /** The part of [x0, y0, x1, y1) inside the canvas and the clip. */
  private bound(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const c = this.clipR, cv = this.canvas;
    return [Math.max(0, x0, c ? c[0] : 0), Math.max(0, y0, c ? c[1] : 0), Math.min(cv.width, x1, c ? c[2] : Infinity), Math.min(cv.height, y1, c ? c[3] : Infinity)];
  }
  createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x: number, y: number, w: number, h: number) {
    const out = this.createImageData(w, h), cv = this.canvas, d = cv.pixels();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= cv.width || sy >= cv.height) continue;
      const s = (sy * cv.width + sx) * 4, t = (j * w + i) * 4;
      out.data[t] = d[s]; out.data[t + 1] = d[s + 1]; out.data[t + 2] = d[s + 2]; out.data[t + 3] = d[s + 3];
    }
    return out;
  }
  /** Replaces pixels; takes neither the transform nor the clip, as the real one does not. */
  putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
    const cv = this.canvas, d = cv.pixels();
    for (let j = 0; j < img.height; j++) {
      const dy = y + j;
      if (dy < 0 || dy >= cv.height) continue;
      for (let i = 0; i < img.width; i++) {
        const dx = x + i;
        if (dx < 0 || dx >= cv.width) continue;
        const s = (j * img.width + i) * 4, t = (dy * cv.width + dx) * 4;
        d[t] = img.data[s]; d[t + 1] = img.data[s + 1]; d[t + 2] = img.data[s + 2]; d[t + 3] = img.data[s + 3];
      }
    }
  }
  private blend(t: number, r: number, g: number, b: number, a: number) {
    const d = this.canvas.pixels();
    if (a >= 1) { d[t] = r; d[t + 1] = g; d[t + 2] = b; d[t + 3] = 255; return; }
    if (a <= 0) return;
    const da = d[t + 3] / 255, oa = a + da * (1 - a);
    d[t] = Math.round((r * a + d[t] * da * (1 - a)) / oa); d[t + 1] = Math.round((g * a + d[t + 1] * da * (1 - a)) / oa); d[t + 2] = Math.round((b * a + d[t + 2] * da * (1 - a)) / oa);
    d[t + 3] = Math.round(oa * 255);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const [r, g, b, a0] = colour(this.fillStyle), a = a0 * this.globalAlpha;
    const [x0, y0, x1, y1] = this.bound(Math.round(x + this.tx), Math.round(y + this.ty), Math.round(x + this.tx + w), Math.round(y + this.ty + h));
    const W = this.canvas.width;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.blend((j * W + i) * 4, r, g, b, a);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    const [x0, y0, x1, y1] = this.bound(x + this.tx, y + this.ty, x + this.tx + w, y + this.ty + h), d = this.canvas.pixels(), W = this.canvas.width;
    for (let j = y0; j < y1; j++) d.fill(0, (j * W + x0) * 4, (j * W + Math.max(x0, x1)) * 4);
  }
  /** Unscaled copies only: (src, dx, dy) or (src, sx, sy, sw, sh, dx, dy, dw, dh) with dw = sw, dh = sh. A source rect that leaves the source is cut to it, as a browser does. */
  drawImage(src: RasterCanvas, ...a: number[]) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx = a[0], dy = a[1];
    if (a.length === 8) { [sx, sy, sw, sh, dx, dy] = a; if (a[6] !== sw || a[7] !== sh) throw new Error("rasterCanvas: unscaled drawImage only"); }
    else if (a.length !== 2) throw new Error("rasterCanvas: drawImage form not supported");
    if (sx < 0) { dx -= sx; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy; sh += sy; sy = 0; }
    sw = Math.min(sw, src.width - sx); sh = Math.min(sh, src.height - sy);
    if (sw <= 0 || sh <= 0) return;
    dx += this.tx; dy += this.ty;
    const [x0, y0, x1, y1] = this.bound(dx, dy, dx + sw, dy + sh), s = src.pixels(), W = this.canvas.width;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      const k = ((j - dy + sy) * src.width + (i - dx + sx)) * 4;
      this.blend((j * W + i) * 4, s[k], s[k + 1], s[k + 2], (s[k + 3] / 255) * this.globalAlpha);
    }
  }
}

export class RasterCanvas {
  private w = 0; private h = 0;
  private data: Uint8ClampedArray | null = null;
  private ctx?: RasterCtx;
  get width() { return this.w; }
  set width(v: number) { this.w = v; this.data = null; canvasLog.maxW = Math.max(canvasLog.maxW, v); }
  get height() { return this.h; }
  set height(v: number) { this.h = v; this.data = null; canvasLog.maxH = Math.max(canvasLog.maxH, v); }
  /** Allocated on first use, so a canvas that is only sized costs nothing (and one too large to hold fails here, as it would in a browser). */
  pixels(): Uint8ClampedArray { return (this.data ??= new Uint8ClampedArray(this.w * this.h * 4)); }
  getContext() { return (this.ctx ??= new RasterCtx(this)); }
}

/** Install `document.createElement("canvas")` for Node, making canvases that hold pixels. */
export function installRasterCanvas() {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("raster document only makes canvases");
      canvasLog.made++;
      return new RasterCanvas();
    },
  };
}
