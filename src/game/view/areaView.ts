// Presentation of one Area: baked background + light registry. Subscribes to
// the area's dirty-rect notifications and catches up once per frame (flush),
// so a burst of world changes costs one local re-bake, not one per change.
//
// Large areas: the background is baked in CH x CH tile chunks. Chunks under
// the camera are baked on demand (prepare), the rest one per frame in the
// background (idle). Light visibility is traced lazily the first time a light
// reaches the view window. Dirty-rect re-bakes and re-traces work exactly as
// before (bakeRegion is tile-local and decals are clipped per region, so a
// chunked bake is pixel-identical to a full one).
import { TS } from "../content/tiles";
import { hexToCol } from "../content/glyphs";
import { ITEMS } from "../content/items";
import { propDef } from "../content/props";
import { socketPositions } from "../content/ritual";
import { GLYPHS } from "../content/glyphs";
import { bakeRegion } from "../art/tiles";
import { makeCanvas } from "../util";
import { computeVis, makeLight, type Light } from "../light";
import { unionRect, type Area, type TileRect } from "../world/area";

interface LightWant { key: string; make: () => Light }
export const CH = 8;

export class AreaView {
  readonly bg: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  /** Insertion-ordered: lights are appended as they come into existence, as before. */
  readonly lights = new Map<string, Light>();
  /** Instrumentation for perf checks. */
  readonly stats = { chunksBaked: 0, visTraced: 0 };
  private pending: TileRect | null = null;
  private syncedRev = -1;
  private dynamic = new Set<string>();
  private unsub: () => void;
  private cw: number; private chh: number;
  private baked: Uint8Array;
  private nextIdle = 0;

  constructor(public area: Area) {
    this.bg = makeCanvas(area.w * TS, area.h * TS);
    this.cw = Math.ceil(area.w / CH); this.chh = Math.ceil(area.h / CH);
    this.baked = new Uint8Array(this.cw * this.chh);
    this.unsub = area.onChange((r) => { this.pending = unionRect(this.pending, r); });
    this.syncLights();
  }

  dispose() { this.unsub(); }

  get fullyBaked() { return this.baked.every((b) => b === 1); }

  private bakeChunk(i: number) {
    if (this.baked[i]) return;
    this.baked[i] = 1;
    const cx = i % this.cw, cy = Math.floor(i / this.cw);
    bakeRegion(this.bg.ctx, this.area, cx * CH, cy * CH, Math.min(this.area.w, (cx + 1) * CH) - 1, Math.min(this.area.h, (cy + 1) * CH) - 1);
    this.stats.chunksBaked++;
  }

  /** Make everything the camera (px rect) can see ready: background chunks and light visibility. */
  prepare(camX: number, camY: number, w: number, h: number) {
    const x0 = Math.max(0, Math.floor(camX / TS / CH)), x1 = Math.min(this.cw - 1, Math.floor((camX + w) / TS / CH));
    const y0 = Math.max(0, Math.floor(camY / TS / CH)), y1 = Math.min(this.chh - 1, Math.floor((camY + h) / TS / CH));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.bakeChunk(cy * this.cw + cx);
    for (const L of this.lights.values()) {
      if (L.n > 0) continue;
      if (L.x + L.rad < camX - 32 || L.x - L.rad > camX + w + 32 || L.y + L.rad < camY - 32 || L.y - L.rad > camY + h + 32) continue;
      computeVis(L, this.area); this.stats.visTraced++;
    }
  }

  /** Background work: bake one more chunk. Returns false when done. */
  idle(): boolean {
    while (this.nextIdle < this.baked.length && this.baked[this.nextIdle]) this.nextIdle++;
    if (this.nextIdle >= this.baked.length) return false;
    this.bakeChunk(this.nextIdle);
    return true;
  }

  /** Apply pending world changes. Returns true if tiles changed (callers refresh moving lights). */
  flush(): boolean {
    if (this.area.revision !== this.syncedRev) this.syncLights();
    const r = this.pending;
    if (!r) return false;
    this.pending = null;
    bakeRegion(this.bg.ctx, this.area, r.x0, r.y0, r.x1, r.y1);
    for (const L of this.lights.values()) {
      if (L.n === 0) continue; // not traced yet; it will be when it comes into view
      if (L.ox + L.n - 1 < r.x0 || L.ox > r.x1 || L.oy + L.n - 1 < r.y0 || L.oy > r.y1) continue;
      computeVis(L, this.area); this.stats.visTraced++;
    }
    return true;
  }

  byId(id: string) {
    for (const L of this.lights.values()) if (L.id === id) return L;
    return undefined;
  }

  /** Reconcile lights with what the world state says should exist. */
  /**
   * A light owned by presentation rather than area state (e.g. an NPC's eye:
   * actors live on the World, not the Area). Created on first request, kept in
   * the same registry (so it is traced, culled and accumulated like any other
   * light); the caller drives its `int` each frame.
   */
  dynamicLight(key: string, make: () => Light): Light {
    this.dynamic.add(key);
    let L = this.lights.get(key);
    if (!L) { L = make(); this.lights.set(key, L); }
    return L;
  }

  private syncLights() {
    this.syncedRev = this.area.revision;
    const want = this.wantedLights();
    const keys = new Set([...want.map((w) => w.key), ...this.dynamic]);
    for (const k of [...this.lights.keys()]) if (!keys.has(k)) this.lights.delete(k);
    for (const w of want) if (!this.lights.has(w.key)) this.lights.set(w.key, w.make());
  }

  private wantedLights(): LightWant[] {
    const a = this.area, out: LightWant[] = [];
    a.lights.forEach((l, i) => {
      if (l.owner) {
        const p = a.prop(l.owner);
        if (!p || (propDef(p.kind).light?.when === "lit" && !p.lit)) return;
      }
      out.push({ key: "area" + i, make: () => makeLight(l.x, l.y, l.rad, l.col, l.int, l.flick, l.id) });
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
