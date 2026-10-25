// A recording stand-in for the browser canvas, so procedural art can run in
// Node. Every drawing operation (in order, per context) is folded into one
// running FNV-1a hash. Two runs that issue the same operations with the same
// arguments produce the same pixels, so equal hashes == identical output.
let H = 0x811c9dc5;
let ids = 0;
const mix = (s: string) => {
  for (let i = 0; i < s.length; i++) { H ^= s.charCodeAt(i); H = Math.imul(H, 16777619) >>> 0; }
};

export function resetTrace() { H = 0x811c9dc5; ids = 0; }
export function traceHash() { return (H >>> 0).toString(16); }

class FakeCtx {
  id: number;
  private _fs = "#000"; private _ga = 1; private _gco = "source-over";
  imageSmoothingEnabled = false;
  constructor(public canvas: FakeCanvas) { this.id = canvas.id; }
  get fillStyle() { return this._fs; }
  set fillStyle(v: string) { this._fs = v; mix(`${this.id}fs${v}`); }
  get globalAlpha() { return this._ga; }
  set globalAlpha(v: number) { this._ga = v; mix(`${this.id}ga${v}`); }
  get globalCompositeOperation() { return this._gco; }
  set globalCompositeOperation(v: string) { this._gco = v; mix(`${this.id}gco${v}`); }
  fillRect(x: number, y: number, w: number, h: number) { mix(`${this.id}fr${x},${y},${w},${h}`); }
  clearRect(x: number, y: number, w: number, h: number) { mix(`${this.id}cr${x},${y},${w},${h}`); }
  createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(_x: number, _y: number, w: number, h: number) { return this.createImageData(w, h); }
  putImageData(img: { data: Uint8ClampedArray; width: number }, x: number, y: number) {
    let h = 0x811c9dc5;
    const d = img.data;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
    mix(`${this.id}pid${h},${img.width},${x},${y}`);
  }
  drawImage(src: FakeCanvas, ...a: number[]) { mix(`${this.id}di${src.id}:${a.join(",")}`); }
  save() { mix(`${this.id}sv`); }
  restore() { mix(`${this.id}rs`); }
  beginPath() { mix(`${this.id}bp`); }
  rect(x: number, y: number, w: number, h: number) { mix(`${this.id}rc${x},${y},${w},${h}`); }
  clip() { mix(`${this.id}cl`); }
}

class FakeCanvas {
  id = ++ids;
  width = 0; height = 0;
  private ctx?: FakeCtx;
  getContext() { return (this.ctx ??= new FakeCtx(this)); }
}

/** Install `document.createElement("canvas")` for Node. */
export function installFakeCanvas() {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("fake document only makes canvases");
      return new FakeCanvas();
    },
  };
}
