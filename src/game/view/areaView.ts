// Presentation of one Area: baked background + light registry. Subscribes to
// the area's dirty-rect notifications and catches up once per frame (flush),
// so a burst of world changes costs one local re-bake, not one per change.
import { TS } from "../content/tiles";
import { hexToCol } from "../content/glyphs";
import { ITEMS } from "../content/items";
import { propDef } from "../content/props";
import { socketPositions } from "../content/ritual";
import { GLYPHS } from "../content/glyphs";
import { bakeRegion } from "../art";
import { makeCanvas } from "../util";
import { computeVis, makeLight, type Light } from "../light";
import { unionRect, type Area, type TileRect } from "../world/area";

interface LightWant { key: string; make: () => Light }

export class AreaView {
  readonly bg: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  /** Insertion-ordered: lights are appended as they come into existence, as before. */
  readonly lights = new Map<string, Light>();
  private pending: TileRect | null = null;
  private syncedRev = -1;
  private unsub: () => void;

  constructor(public area: Area) {
    this.bg = makeCanvas(area.w * TS, area.h * TS);
    bakeRegion(this.bg.ctx, area, 0, 0, area.w - 1, area.h - 1);
    this.unsub = area.onChange((r) => { this.pending = unionRect(this.pending, r); });
    this.syncLights();
  }

  dispose() { this.unsub(); }

  /** Apply pending world changes. Returns true if tiles changed (callers refresh moving lights). */
  flush(): boolean {
    if (this.area.revision !== this.syncedRev) this.syncLights();
    const r = this.pending;
    if (!r) return false;
    this.pending = null;
    bakeRegion(this.bg.ctx, this.area, r.x0, r.y0, r.x1, r.y1);
    for (const L of this.lights.values()) {
      if (L.ox + L.n - 1 < r.x0 || L.ox > r.x1 || L.oy + L.n - 1 < r.y0 || L.oy > r.y1) continue;
      computeVis(L, this.area);
    }
    return true;
  }

  byId(id: string) {
    for (const L of this.lights.values()) if (L.id === id) return L;
    return undefined;
  }

  /** Reconcile lights with what the world state says should exist. */
  private syncLights() {
    this.syncedRev = this.area.revision;
    const want = this.wantedLights();
    const keys = new Set(want.map((w) => w.key));
    for (const k of [...this.lights.keys()]) if (!keys.has(k)) this.lights.delete(k);
    for (const w of want) {
      if (this.lights.has(w.key)) continue;
      const L = w.make();
      computeVis(L, this.area);
      this.lights.set(w.key, L);
    }
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
    return out;
  }
}
