// Presentation of one Area: baked background + light registry. Subscribes to
// the area's dirty-rect notifications and catches up once per frame (flush),
// so a burst of world changes costs one local re-bake, not one per change.
//
// The background is a CACHE OF CHUNK CANVASES, not one canvas for the area. An
// area may be many thousands of tiles a side (the overworld is meant to grow);
// a canvas that size cannot be allocated, and would be wasted if it could. So:
//
//   - the ground is baked in CH x CH tile chunks, each into its own small canvas
//     (bakeRegion is tile-local and decals are clipped per region, so a chunk is
//     pixel for pixel the same ground a whole-area bake would hold);
//   - `prepare` makes sure every chunk the camera can see exists, before the
//     frame is drawn, so nothing is ever seen unbaked (no pop-in);
//   - `idle` bakes one chunk a frame in a margin AHEAD chunks deep around the
//     view, the side the camera is moving toward first, so that walking never
//     has to bake in `prepare` (no hitch at a chunk's edge). It stops when the
//     margin is ready: nothing bakes the rest of the area, ever;
//   - chunks far from the camera are dropped, least recently seen first, once the
//     cache holds more than a few views' worth, and their canvases are reused
//     (no allocation while walking). Memory is a function of the view's size,
//     not the area's;
//   - a change to the world re-bakes only the part of each cached chunk it
//     touches; where no chunk is cached it costs nothing (the chunk is baked from
//     the world as it then is, when the camera comes). Changes are never unioned
//     into one rect: two workers a thousand tiles apart do not re-bake the land
//     between them.
//
// Lights are indexed by a coarse grid as well: what is traced, flickered and
// accumulated each frame is what reaches the view (`lightsNear`), in registry
// order, not a walk of every light the area holds.
import { TS } from "../content/tiles";
import { hexToCol } from "../content/glyphs";
import { ITEMS } from "../content/items";
import { propDef } from "../content/props";
import { socketPositions } from "../content/ritual";
import { GLYPHS } from "../content/glyphs";
import { bakeRegion } from "../art/tiles";
import { makeCanvas } from "../util";
import { computeVis, makeLight, type Light } from "../light";
import type { Area, TileRect } from "../world/area";
import type { LightHabit } from "../content/daycycle";
import { tendedAt } from "../world/zones";

interface LightWant { key: string; make: () => Light }
/** Tiles per side of a background chunk. */
export const CH = 8;
/** A chunk's side in px. */
const CPX = CH * TS;
/** Chunks kept baked beyond the view on every side (`idle`). Two is 256 px: seconds of walking, at one chunk a frame. */
export const AHEAD = 2;
/** The cache may hold this many times what the view and its margin need before anything is dropped. */
const SLACK = 2;
/** More pending changes than this in one frame are not re-baked piece by piece: the chunks they touch are dropped (and re-baked as any missing chunk is). */
const MAX_PENDING = 64;
/** Side of a light index cell (px), and how far past its radius a light is entered (its traced window reaches a tile or two further). */
const LCELL = 256, LPAD = 2 * TS + 32;

type Canvas = { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
interface Chunk extends Canvas { cx: number; cy: number; /** The `prepare` it was last wanted by. */ used: number }

export class AreaView {
  /** Insertion-ordered: lights are appended as they come into existence, as before. */
  readonly lights = new Map<string, Light>();
  /** Instrumentation for perf checks. `canvases`: chunk canvases ever allocated (the rest were reused). */
  readonly stats = { chunksBaked: 0, visTraced: 0, chunksEvicted: 0, canvases: 0 };
  private pending: TileRect[] = [];
  private syncedRev = -1;
  private dynamic = new Set<string>();
  private unsub: () => void;
  /** Chunks across and down. */
  private cw: number; private chh: number;
  private chunks = new Map<number, Chunk>();
  private spare: Canvas[] = [];
  private clock = 0;
  /** The chunk range of the last prepared view, and which way the camera was going (-1, 0, 1 each axis). */
  private seen: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastCam: { x: number; y: number } | null = null;
  private heading = { x: 0, y: 0 };
  // light index: static lights by cell, the moving ones apart, each light's place in the registry's order
  private cells = new Map<number, Light[]>();
  private moving: Light[] = [];
  private ord = new Map<Light, number>();
  private ordSeq = 0;
  private ids = new Map<string, Light>();
  private indexed = false;

  constructor(public area: Area) {
    this.cw = Math.ceil(area.w / CH); this.chh = Math.ceil(area.h / CH);
    this.unsub = area.onChange((r) => { this.pending.push(r); });
    this.syncLights();
  }

  dispose() { this.unsub(); this.chunks.clear(); this.spare.length = 0; }

  /** Chunks held right now, and the most the cache will hold for the last prepared view before it starts dropping. */
  get chunkCount() { return this.chunks.size; }
  get capacity() { const v = this.seen; return v ? SLACK * (v.x1 - v.x0 + 1 + 2 * AHEAD) * (v.y1 - v.y0 + 1 + 2 * AHEAD) : 0; }
  /** Is the chunk holding tile (tx, ty) baked and held? */
  hasChunkAt(tx: number, ty: number) { return this.chunks.has(Math.floor(ty / CH) * this.cw + Math.floor(tx / CH)); }

  private chunkRange(x: number, y: number, w: number, h: number) {
    return {
      x0: Math.max(0, Math.floor(x / CPX)), x1: Math.min(this.cw - 1, Math.floor((x + w) / CPX)),
      y0: Math.max(0, Math.floor(y / CPX)), y1: Math.min(this.chh - 1, Math.floor((y + h) / CPX)),
    };
  }

  /** The chunk at (cx, cy), baked now if it is not held. */
  private chunk(cx: number, cy: number): Chunk {
    const k = cy * this.cw + cx;
    let ch = this.chunks.get(k);
    if (ch) return ch;
    let cv = this.spare.pop();
    if (cv) cv.ctx.clearRect(0, 0, CPX, CPX); else { cv = makeCanvas(CPX, CPX); this.stats.canvases++; }
    ch = { c: cv.c, ctx: cv.ctx, cx, cy, used: this.clock };
    bakeRegion(ch.ctx, this.area, cx * CH, cy * CH, Math.min(this.area.w, (cx + 1) * CH) - 1, Math.min(this.area.h, (cy + 1) * CH) - 1, cx * CPX, cy * CPX);
    this.chunks.set(k, ch);
    this.stats.chunksBaked++;
    return ch;
  }

  private drop(k: number, ch: Chunk) {
    this.chunks.delete(k);
    this.spare.push({ c: ch.c, ctx: ch.ctx });
    this.stats.chunksEvicted++;
  }

  /** Make everything the camera (px rect) can see ready: background chunks and light visibility. */
  prepare(camX: number, camY: number, w: number, h: number) {
    this.clock++;
    const v = this.chunkRange(camX, camY, w, h);
    for (let cy = v.y0; cy <= v.y1; cy++) for (let cx = v.x0; cx <= v.x1; cx++) this.chunk(cx, cy).used = this.clock;
    // which way the camera is going (kept while it rests, so the margin ahead stays the first to fill)
    const lc = this.lastCam;
    if (lc) { const dx = Math.sign(Math.round(camX - lc.x)), dy = Math.sign(Math.round(camY - lc.y)); if (dx || dy) this.heading = { x: dx, y: dy }; }
    this.lastCam = { x: camX, y: camY };
    this.seen = v;
    this.evict();
    for (const L of this.lightsNear(camX - 32, camY - 32, camX + w + 32, camY + h + 32)) {
      if (L.n > 0) continue;
      if (L.x + L.rad < camX - 32 || L.x - L.rad > camX + w + 32 || L.y + L.rad < camY - 32 || L.y - L.rad > camY + h + 32) continue;
      computeVis(L, this.area); this.stats.visTraced++;
    }
  }

  /**
   * Drop chunks once the cache is over its capacity: those least recently in view, never one in the view or its
   * margin. Capacity is a multiple of what the view needs, so a walk there and back finds its chunks still held.
   */
  private evict() {
    const v = this.seen, cap = this.capacity;
    if (!v || this.chunks.size <= cap) return;
    const far: [number, Chunk][] = [];
    for (const e of this.chunks) {
      const ch = e[1];
      if (ch.cx < v.x0 - AHEAD || ch.cx > v.x1 + AHEAD || ch.cy < v.y0 - AHEAD || ch.cy > v.y1 + AHEAD) far.push(e);
    }
    far.sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < far.length && this.chunks.size > cap; i++) this.drop(far[i][0], far[i][1]);
  }

  /**
   * Background work: bake one more chunk of the margin around the last prepared view, nearest the view first and the
   * side the camera is heading toward before the others. Returns false when the margin is ready (or nothing has
   * been prepared yet). It never bakes beyond the margin: how long this takes does not depend on the area's size.
   */
  idle(): boolean {
    const v = this.seen;
    if (!v) return false;
    let best = -1, bx = 0, by = 0, score = Infinity;
    const y0 = Math.max(0, v.y0 - AHEAD), y1 = Math.min(this.chh - 1, v.y1 + AHEAD), x0 = Math.max(0, v.x0 - AHEAD), x1 = Math.min(this.cw - 1, v.x1 + AHEAD);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = cy * this.cw + cx;
      if (this.chunks.has(k)) continue;
      const ox = cx < v.x0 ? cx - v.x0 : cx > v.x1 ? cx - v.x1 : 0, oy = cy < v.y0 ? cy - v.y0 : cy > v.y1 ? cy - v.y1 : 0;
      const lead = (ox !== 0 && Math.sign(ox) === this.heading.x ? 1 : 0) + (oy !== 0 && Math.sign(oy) === this.heading.y ? 1 : 0);
      const s = Math.max(Math.abs(ox), Math.abs(oy)) * 2 - lead * 3;
      if (s < score) { score = s; best = k; bx = cx; by = cy; }
    }
    if (best < 0) return false;
    this.chunk(bx, by);
    return true;
  }

  /**
   * Draw the background under the camera: the px rect (camX, camY, w, h) of the area onto `ctx` at (0, 0), one copy
   * per chunk it crosses. Whole-pixel, unscaled copies of adjoining canvases: the result is what one copy out of
   * one canvas of the whole area would be. Ground outside the area is left as it was. Call `prepare` first.
   */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number) {
    const v = this.chunkRange(camX, camY, w, h);
    for (let cy = v.y0; cy <= v.y1; cy++) for (let cx = v.x0; cx <= v.x1; cx++) {
      const ch = this.chunks.get(cy * this.cw + cx);
      if (!ch) continue;
      const px = cx * CPX, py = cy * CPX;
      const sx0 = Math.max(camX, px), sy0 = Math.max(camY, py), sx1 = Math.min(camX + w, px + CPX), sy1 = Math.min(camY + h, py + CPX);
      if (sx1 <= sx0 || sy1 <= sy0) continue;
      ctx.drawImage(ch.c, sx0 - px, sy0 - py, sx1 - sx0, sy1 - sy0, sx0 - camX, sy0 - camY, sx1 - sx0, sy1 - sy0);
    }
  }

  /** Apply pending world changes. Returns true if tiles changed (callers refresh moving lights). */
  flush(): boolean {
    if (this.area.interactionRevision !== this.syncedRev) this.syncLights();
    const rects = this.pending;
    if (!rects.length) return false;
    this.pending = [];
    const flood = rects.length > MAX_PENDING, retrace = new Set<Light>();
    for (const r of flood ? [rects.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))] : rects) {
      // the cached chunks the change touches (those not cached read the world when they are baked)
      const cx0 = Math.max(0, Math.floor(r.x0 / CH)), cx1 = Math.min(this.cw - 1, Math.floor(r.x1 / CH)), cy0 = Math.max(0, Math.floor(r.y0 / CH)), cy1 = Math.min(this.chh - 1, Math.floor(r.y1 / CH));
      const each = (k: number, ch: Chunk) => {
        if (ch.cx < cx0 || ch.cx > cx1 || ch.cy < cy0 || ch.cy > cy1) return;
        // (a flood of changes: drop what it covers; the view's chunks come back in the next prepare, the margin's in idle)
        if (flood) { this.drop(k, ch); return; }
        const tx0 = Math.max(r.x0, ch.cx * CH), ty0 = Math.max(r.y0, ch.cy * CH), tx1 = Math.min(r.x1, (ch.cx + 1) * CH - 1, this.area.w - 1), ty1 = Math.min(r.y1, (ch.cy + 1) * CH - 1, this.area.h - 1);
        if (tx1 >= tx0 && ty1 >= ty0) bakeRegion(ch.ctx, this.area, tx0, ty0, tx1, ty1, ch.cx * CPX, ch.cy * CPX);
      };
      // a small change looks its chunks up; a wide one walks the cache (which is small) rather than the land it spans
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= this.chunks.size) {
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const k = cy * this.cw + cx, ch = this.chunks.get(k); if (ch) each(k, ch); }
      } else for (const [k, ch] of [...this.chunks]) each(k, ch);
      for (const L of this.lightsNear(r.x0 * TS, r.y0 * TS, (r.x1 + 1) * TS, (r.y1 + 1) * TS)) {
        if (L.n === 0) continue; // not traced yet; it will be when it comes into view
        if (L.ox + L.n - 1 < r.x0 || L.ox > r.x1 || L.oy + L.n - 1 < r.y0 || L.oy > r.y1) continue;
        retrace.add(L);
      }
    }
    for (const L of retrace) { computeVis(L, this.area); this.stats.visTraced++; }
    return true;
  }

  byId(id: string) {
    this.reindex();
    return this.ids.get(id);
  }

  /**
   * The lights that can reach the px rect [x0, y0, x1, y1], in the registry's order (the order they are accumulated
   * in, so the lit frame is the same sum it would be over every light). Static lights come from the grid; the few
   * that move (an NPC's eye, the sunrise) are always among them.
   */
  lightsNear(x0: number, y0: number, x1: number, y1: number): Light[] {
    this.reindex();
    const out: Light[] = [], seen = new Set<Light>();
    for (let cy = Math.floor(y0 / LCELL); cy <= Math.floor(y1 / LCELL); cy++) for (let cx = Math.floor(x0 / LCELL); cx <= Math.floor(x1 / LCELL); cx++) {
      const cell = this.cells.get(lightKey(cx, cy));
      if (!cell) continue;
      for (const L of cell) {
        if (seen.has(L) || L.x + L.rad + LPAD < x0 || L.x - L.rad - LPAD > x1 || L.y + L.rad + LPAD < y0 || L.y - L.rad - LPAD > y1) continue;
        seen.add(L); out.push(L);
      }
    }
    for (const L of this.moving) out.push(L);
    const o = this.ord;
    return out.sort((a, b) => o.get(a)! - o.get(b)!);
  }

  /** A registry light's reach was changed by the host (the circle's glow widening as it charges): index it again where it now reaches. */
  resized() { this.indexed = false; }

  /** Bring the light index up to the registry (after lights came or went). */
  private reindex() {
    if (this.indexed) return;
    this.indexed = true;
    this.cells.clear(); this.moving.length = 0; this.ids.clear();
    for (const [key, L] of this.lights) {
      if (!this.ord.has(L)) this.ord.set(L, this.ordSeq++);
      if (L.id && !this.ids.has(L.id)) this.ids.set(L.id, L);
      if (this.dynamic.has(key)) { this.moving.push(L); continue; }
      const r = L.rad + LPAD;
      for (let cy = Math.floor((L.y - r) / LCELL); cy <= Math.floor((L.y + r) / LCELL); cy++) for (let cx = Math.floor((L.x - r) / LCELL); cx <= Math.floor((L.x + r) / LCELL); cx++) {
        const k = lightKey(cx, cy), cell = this.cells.get(k);
        if (cell) cell.push(L); else this.cells.set(k, [L]);
      }
    }
    if (this.ord.size > this.lights.size) { const live = new Set(this.lights.values()); for (const L of [...this.ord.keys()]) if (!live.has(L)) this.ord.delete(L); }
  }

  /** Reconcile lights with what the world state says should exist. */
  /**
   * A light owned by presentation rather than area state (e.g. an NPC's eye:
   * actors live on the World, not the Area). Created on first request, kept in
   * the same registry (so it is traced, culled and accumulated like any other
   * light); the caller drives its `int` each frame.
   */
  dynamicLight(key: string, make: () => Light): Light {
    let L = this.lights.get(key);
    if (!L || !this.dynamic.has(key)) this.indexed = false;
    this.dynamic.add(key);
    if (!L) { L = make(); this.lights.set(key, L); }
    return L;
  }

  private syncLights() {
    this.syncedRev = this.area.interactionRevision;
    const want = this.wantedLights();
    const keys = new Set([...want.map((w) => w.key), ...this.dynamic]);
    for (const k of [...this.lights.keys()]) if (!keys.has(k)) { this.lights.delete(k); this.indexed = false; }
    for (const w of want) if (!this.lights.has(w.key)) { this.lights.set(w.key, w.make()); this.indexed = false; }
  }

  private wantedLights(): LightWant[] {
    const a = this.area, out: LightWant[] = [];
    a.lights.forEach((l, i) => {
      // Where people keep the lights (`tended`), a prop's light carries its kind's habit: the host dims it by the hour.
      let habit: LightHabit | undefined;
      if (l.owner) {
        const p = a.prop(l.owner);
        if (!p || (propDef(p.kind).light?.when === "lit" && !p.lit)) return;
        if (tendedAt(a, p.x, p.y)) habit = propDef(p.kind).habit;
      }
      out.push({
        key: "area" + i,
        make: () => {
          const L = makeLight(l.x, l.y, l.rad, l.col, l.int, l.flick, l.id);
          if (habit) { L.owner = l.owner; L.habit = habit; }
          if (l.sky) L.sky = [l.col[0], l.col[1], l.col[2]];
          return L;
        },
      });
    });
    for (const p of a.props) {
      const g = p.item && !p.container && !p.taken ? ITEMS[p.item].glow : undefined;
      if (g) out.push({ key: "item:" + p.id, make: () => makeLight(p.x, p.y - 8, g.rad, hexToCol(g.color), g.int, g.flick) });
    }
    const r = a.ritual;
    if (r) {
      const c = a.ritualPos;
      if (r.core) out.push({ key: "core", make: () => makeLight(c.x, c.y - 6, 54, [0.4, 0.85, 1], 0.8, 0.08) });
      const sp = socketPositions(c);
      r.sockets.forEach((g, i) => {
        if (g >= 0) out.push({ key: `socket${i}:${g}`, make: () => makeLight(sp[i].x, sp[i].y - 4, 30, hexToCol(GLYPHS[g].color), 0.5, 0.05) });
      });
    }
    // Props built during play emit their kind's light (torches), reconciled like everything else.
    for (const p of a.props) {
      if (!p.dyn) continue;
      const L = propDef(p.kind).light;
      if (L && (L.when === "always" || p.lit)) out.push({ key: "prop:" + p.id, make: () => makeLight(p.x + L.dx, p.y + L.dy, L.rad, L.col, L.int, L.flick) });
    }
    return out;
  }
}

const lightKey = (cx: number, cy: number) => (cy + 0x8000) * 0x10000 + (cx + 0x8000);
