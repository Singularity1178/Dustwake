// A tiny pixel-accurate software canvas for Node (preview renders only; the
// test suite uses the recording fakeCanvas). Supports what the procedural art
// and the bake use: fillStyle (hex / rgb / rgba), globalAlpha, source-over and
// lighter compositing, fillRect, clearRect, image data, unscaled drawImage,
// save/restore and rectangular clips.
import { deflateSync } from "node:zlib";

type RGBA = [number, number, number, number];
const colCache = new Map<string, RGBA>();
function parse(c: string): RGBA {
  let v = colCache.get(c);
  if (v) return v;
  if (c[0] === "#") {
    const h = c.length === 4 ? c.slice(1).split("").map((x) => x + x).join("") : c.slice(1);
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/);
    const p = m ? m[1].split(",").map((s) => parseFloat(s)) : [0, 0, 0, 1];
    v = [p[0], p[1], p[2], p[3] ?? 1];
  }
  colCache.set(c, v);
  return v;
}

interface State { fs: string; ga: number; gco: string; clip: [number, number, number, number] }

export class PixCtx {
  fillStyle = "#000"; globalAlpha = 1; globalCompositeOperation = "source-over"; imageSmoothingEnabled = false;
  private cr: [number, number, number, number];
  private stack: State[] = [];
  private path: [number, number, number, number][] = [];
  constructor(public canvas: PixCanvas) { this.cr = [0, 0, canvas.width, canvas.height]; }
  private blend(i: number, r: number, g: number, b: number, a: number) {
    const d = this.canvas.data;
    if (a <= 0) return;
    if (this.globalCompositeOperation === "lighter") {
      d[i] = Math.min(255, d[i] + r * a); d[i + 1] = Math.min(255, d[i + 1] + g * a); d[i + 2] = Math.min(255, d[i + 2] + b * a); d[i + 3] = Math.min(255, d[i + 3] + 255 * a);
      return;
    }
    const da = d[i + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[i] = (r * a + d[i] * da * (1 - a)) / oa; d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa; d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa; d[i + 3] = oa * 255;
  }
  private box(x: number, y: number, w: number, h: number) {
    const [cx0, cy0, cx1, cy1] = this.cr;
    return [Math.max(cx0, Math.round(x)), Math.max(cy0, Math.round(y)), Math.min(cx1, Math.round(x + w)), Math.min(cy1, Math.round(y + h))];
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const [r, g, b, a] = parse(this.fillStyle), A = a * this.globalAlpha, W = this.canvas.width;
    const [x0, y0, x1, y1] = this.box(x, y, w, h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend((yy * W + xx) * 4, r, g, b, A);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    const W = this.canvas.width, [x0, y0, x1, y1] = this.box(x, y, w, h);
    for (let yy = y0; yy < y1; yy++) this.canvas.data.fill(0, (yy * W + x0) * 4, (yy * W + x1) * 4);
  }
  createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x: number, y: number, w: number, h: number) {
    const img = this.createImageData(w, h), W = this.canvas.width;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const sx = x + xx, sy = y + yy;
      if (sx < 0 || sy < 0 || sx >= W || sy >= this.canvas.height) continue;
      const s = (sy * W + sx) * 4, o = (yy * w + xx) * 4;
      for (let k = 0; k < 4; k++) img.data[o + k] = this.canvas.data[s + k];
    }
    return img;
  }
  putImageData(img: { data: Uint8ClampedArray; width: number; height?: number }, x: number, y: number) {
    const w = img.width, h = img.height ?? img.data.length / 4 / w, W = this.canvas.width;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const dx = x + xx, dy = y + yy;
      if (dx < 0 || dy < 0 || dx >= W || dy >= this.canvas.height) continue;
      const s = (yy * w + xx) * 4, o = (dy * W + dx) * 4;
      for (let k = 0; k < 4; k++) this.canvas.data[o + k] = img.data[s + k];
    }
  }
  drawImage(src: PixCanvas, ...a: number[]) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx: number, dy: number;
    if (a.length >= 8) [sx, sy, sw, sh, dx, dy] = a; else [dx, dy] = a;
    dx = Math.round(dx); dy = Math.round(dy);
    const W = this.canvas.width, [cx0, cy0, cx1, cy1] = this.cr;
    for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
      const tx = dx + xx, ty = dy + yy, ux = sx + xx, uy = sy + yy;
      if (tx < cx0 || ty < cy0 || tx >= cx1 || ty >= cy1 || ux < 0 || uy < 0 || ux >= src.width || uy >= src.height) continue;
      const s = (uy * src.width + ux) * 4, A = (src.data[s + 3] / 255) * this.globalAlpha;
      this.blend((ty * W + tx) * 4, src.data[s], src.data[s + 1], src.data[s + 2], A);
    }
  }
  save() { this.stack.push({ fs: this.fillStyle, ga: this.globalAlpha, gco: this.globalCompositeOperation, clip: [...this.cr] as State["clip"] }); }
  restore() { const s = this.stack.pop(); if (s) { this.fillStyle = s.fs; this.globalAlpha = s.ga; this.globalCompositeOperation = s.gco; this.cr = s.clip; } }
  beginPath() { this.path = []; }
  rect(x: number, y: number, w: number, h: number) { this.path.push([x, y, x + w, y + h]); }
  clip() {
    for (const [x0, y0, x1, y1] of this.path) this.cr = [Math.max(this.cr[0], x0), Math.max(this.cr[1], y0), Math.min(this.cr[2], x1), Math.min(this.cr[3], y1)];
  }
}

export class PixCanvas {
  private _w = 0; private _h = 0;
  data = new Uint8ClampedArray(0);
  private ctx?: PixCtx;
  get width() { return this._w; } set width(v: number) { this._w = v; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  get height() { return this._h; } set height(v: number) { this._h = v; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  getContext() { return (this.ctx ??= new PixCtx(this)); }
}

export function installPixelCanvas() {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => { if (tag !== "canvas") throw new Error("canvas only"); return new PixCanvas(); },
  };
}

// ---- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Encode RGBA pixels as PNG, upscaled by an integer factor. */
export function encodePNG(w: number, h: number, rgba: Uint8ClampedArray, scale = 1): Buffer {
  const W = w * scale, H = h * scale, raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const s = ((Math.floor(y / scale) * w + Math.floor(x / scale)) * 4), o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[s]; raw[o + 1] = rgba[s + 1]; raw[o + 2] = rgba[s + 2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
