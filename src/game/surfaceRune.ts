// Rasterises the surface rune (runeReveal.ts) into the engine's two layers:
// albedo (`scene`: dais, carved grooves, plants) and emissive (`emit`: the
// carvings' glow). The dormant (t = 0) and fully restored (t = 1) renders are
// cached; only an in-between progress re-rasterises, straight into ImageData
// (one pass over the precomputed pixels, no per-pixel canvas calls).
import { makeCanvas } from "./util";
import { RUNE_HALF, runeModel, carvingVisible, plantVisible, type RuneModel } from "./runeReveal";

const S = RUNE_HALF * 2;
type RGBA = [number, number, number, number];
const hexA = (c: string): RGBA => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };

const GROOVE = hexA("#120e16"), LIP = hexA("#5c5566");
const GLOW = hexA("#a070ff"), FRONT = hexA("#e4d8ff");
/** Width (in progress units) of the bright leading edge of the sweep. */
const FRONT_W = 0.05;

export interface RuneLayers { scene: HTMLCanvasElement; emit: HTMLCanvasElement }

export class SurfaceRuneArt {
  readonly model: RuneModel;
  private dais = new Uint8ClampedArray(S * S * 4);
  private carved: { pos: number; lip: number; i: number }[] = [];
  private plants: { pos: number; c: RGBA; clump: number; px: number }[] = [];
  private cache = new Map<string, RuneLayers>();
  private dyn: { scene: ReturnType<typeof makeCanvas>; emit: ReturnType<typeof makeCanvas> } | null = null;
  private dynKey = "";

  constructor(carvedPixels: { x: number; y: number }[]) {
    this.model = runeModel(carvedPixels);
    // the worn stone dais (same shading as the dungeon circle's)
    for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
      const d = x * x + y * y;
      if (d > 100) continue;
      const c = hexA(d <= 9 ? "#0e0b10" : d > 72 ? "#3a3542" : x + y < -4 ? "#7a7484" : "#5e5868");
      this.dais.set(c, ((y + RUNE_HALF) * S + x + RUNE_HALF) * 4);
    }
    const has = new Set(this.model.pixels.map((p) => (p.y + RUNE_HALF) * S + p.x + RUNE_HALF));
    this.model.pixels.forEach((p, i) => {
      const pos = (p.y + RUNE_HALF) * S + p.x + RUNE_HALF;
      this.carved.push({ pos, lip: !has.has(pos + S) && p.y + 1 < RUNE_HALF ? pos + S : -1, i });
    });
    this.model.clumps.forEach((c, ci) => c.px.forEach((px, k) => this.plants.push({ pos: (px.y + RUNE_HALF) * S + px.x + RUNE_HALF, c: hexA(px.c), clump: ci, px: k })));
  }

  /** Layers at awakening progress t (0 dormant .. 1 restored). Cached at the ends. */
  layers(t: number): RuneLayers {
    t = t <= 0 ? 0 : t >= 1 ? 1 : t;
    if (t === 0 || t === 1) {
      const k = String(t);
      let l = this.cache.get(k);
      if (!l) { const sc = makeCanvas(S, S), em = makeCanvas(S, S); this.raster(t, sc.ctx, em.ctx); l = { scene: sc.c, emit: em.c }; this.cache.set(k, l); }
      return l;
    }
    this.dyn ??= { scene: makeCanvas(S, S), emit: makeCanvas(S, S) };
    const key = t.toFixed(4);
    if (key !== this.dynKey) { this.raster(t, this.dyn.scene.ctx, this.dyn.emit.ctx); this.dynKey = key; }
    return { scene: this.dyn.scene.c, emit: this.dyn.emit.c };
  }

  private raster(t: number, sc: CanvasRenderingContext2D, ec: CanvasRenderingContext2D) {
    const m = this.model;
    const si = sc.createImageData(S, S), ei = ec.createImageData(S, S);
    const s = si.data, e = ei.data;
    s.set(this.dais);
    for (const c of this.carved) {
      const p = m.pixels[c.i];
      if (!carvingVisible(p, t)) continue;
      s.set(GROOVE, c.pos * 4);
      if (c.lip >= 0) s.set(LIP, c.lip * 4);
      e.set(!p.survives && t < 1 && p.key > t - FRONT_W ? FRONT : GLOW, c.pos * 4);
    }
    for (const pl of this.plants) {
      const cl = m.clumps[pl.clump];
      if (!plantVisible(m, cl, cl.px[pl.px], t)) continue;
      s.set(pl.c, pl.pos * 4);
      e.set([0, 0, 0, 255], pl.pos * 4); // leaves occlude the glow beneath them
    }
    sc.putImageData(si, 0, 0);
    ec.putImageData(ei, 0, 0);
  }
}
