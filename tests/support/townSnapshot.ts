// Developer tool (not a test): renders the market town, its six interiors and
// the surface's west road to PNG without a browser, lit the way the game lights
// them (the real bake, the real prop sprites and emissive layer, the real light
// tracing and compose), plus a contact sheet of every town sprite. Used to look
// at layout, palette and the rune-light / firelight split while building.
//
//   node scripts/townPreview.mjs        -> .preview/town/*.png
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { AREAS } from "../../src/game/world/areas";
import { Area } from "../../src/game/world/area";
import { bakeRegion } from "../../src/game/art/tiles";
import { propSprite, PROP_ART } from "../../src/game/art/props";
import { TOWN_PROP_ART } from "../../src/game/art/propsTown";
import { propDef } from "../../src/game/content/props";
import { computeVis, makeLight, Lighting, type Light } from "../../src/game/light";
import { TS } from "../../src/game/content/tiles";
import { ESTABLISHMENTS, interiorId } from "../../src/game/content/town";
import { WEST_ROAD } from "../../src/game/content/geography";

/** The UI snapshot canvas, plus the two pixel calls the background bake and the lighting need. */
class TCanvas extends RCanvas {
  getContext() {
    const ctx: any = super.getContext();
    if (!ctx.__px) {
      ctx.__px = true;
      ctx.putImageData = (img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => {
        for (let j = 0; j < img.height; j++) {
          const ty = y + j; if (ty < 0 || ty >= this.height) continue;
          for (let i = 0; i < img.width; i++) { const tx = x + i; if (tx < 0 || tx >= this.width) continue; const s = (j * img.width + i) * 4, d = (ty * this.width + tx) * 4; this.data[d] = img.data[s]; this.data[d + 1] = img.data[s + 1]; this.data[d + 2] = img.data[s + 2]; this.data[d + 3] = 255; }
        }
      };
      ctx.getImageData = (x: number, y: number, w: number, h: number) => {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const s = ((y + j) * this.width + x + i) * 4, d = (j * w + i) * 4; out[d] = this.data[s]; out[d + 1] = this.data[s + 1]; out[d + 2] = this.data[s + 2]; out[d + 3] = this.data[s + 3]; }
        return { data: out, width: w, height: h };
      };
    }
    return ctx;
  }
}
const canvas = (w: number, h: number) => { const c = new TCanvas(w, h); c.getContext(); return c; };
/** Stand in for the browser's document, so sprites and bakes can be made in Node. */
export function installDom() { (globalThis as any).document = { createElement: () => new TCanvas() }; }

/** One area, as the game would draw it with nobody in it: [lit, unlit albedo]. */
export function renderArea(id: string): { lit: RCanvas; flat: RCanvas; area: Area } {
  const area = new Area(AREAS[id]());
  const W = area.w * TS, H = area.h * TS;
  const scene = canvas(W, H), emit = canvas(W, H);
  bakeRegion(scene.getContext() as any, area, 0, 0, area.w - 1, area.h - 1);
  const ec: any = emit.getContext(), sc: any = scene.getContext();
  ec.fillStyle = "#000"; ec.fillRect(0, 0, W, H);
  const list: { y: number; f: () => void }[] = [];
  for (const p of area.props) {
    const def = propDef(p.kind), alt = def.alt === "lit" ? !!p.lit : def.alt === "taken" ? p.taken : p.open;
    const s = propSprite(p.kind, p.v, alt);
    if (!s) continue;
    list.push({ y: def.wallMounted ? p.y - 0.5 : def.flat ? p.y - 16 : p.y, f: () => { sc.drawImage(s.a, Math.round(p.x - s.ax), Math.round(p.y - s.ay)); ec.drawImage(s.e, Math.round(p.x - s.ax), Math.round(p.y - s.ay)); } });
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.f();
  const flat = canvas(W, H); (flat.getContext() as any).drawImage(scene, 0, 0);
  const lights: Light[] = [];
  for (const l of area.lights) {
    if (l.owner) { const p = area.prop(l.owner); if (!p || (propDef(p.kind).light?.when === "lit" && !p.lit)) continue; }
    const L = makeLight(l.x, l.y, l.rad, l.col, l.int, l.flick, l.id);
    if (l.id === "runeglow") L.cur = 0;
    computeVis(L, area); lights.push(L);
  }
  const lighting = new Lighting(W, H);
  lighting.accumulate(lights, 0, 0);
  const out = canvas(W, H);
  lighting.compose(scene.data, emit.data, out.data, area.base.ambient ?? [0.05, 0.045, 0.065]);
  return { lit: out, flat, area };
}

export function crop(src: RCanvas, x: number, y: number, w: number, h: number): RCanvas {
  const c = canvas(w, h);
  (c.getContext() as any).drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Every town sprite (4 variants), on a mid-grey ground, with its glow added. */
export function spriteSheet(): RCanvas {
  const kinds = Object.keys(TOWN_PROP_ART), cols = 8, cw = 84, chh = 66;
  const rows = Math.ceil((kinds.length * 4) / cols), c = canvas(cols * cw, rows * chh), ctx: any = c.getContext();
  ctx.fillStyle = "#4a4a50"; ctx.fillRect(0, 0, c.width, c.height);
  let n = 0;
  for (const k of kinds) for (let v = 0; v < 4; v++, n++) {
    const s = propSprite(k, v, false)!;
    const x = (n % cols) * cw + ((cw - s.w) >> 1), y = Math.floor(n / cols) * chh + chh - 2 - s.h;
    ctx.drawImage(s.a, x, y);
    ctx.globalCompositeOperation = "lighter"; // the snapshot canvas ignores this; glow pixels were drawn into the albedo too
  }
  return c;
}

export function run(dir = ".preview/town") {
  installDom();
  mkdirSync(dir, { recursive: true });
  const save = (name: string, c: RCanvas, scale = 1) => writeFileSync(`${dir}/${name}.png`, png(c, scale));
  if (!Object.keys(PROP_ART).length) throw new Error("no art");
  save("sprites", spriteSheet(), 2);
  const t = renderArea("town");
  save("town_night", t.lit); save("town_flat", t.flat);
  const views: [string, number, number, number, number][] = [
    ["square", 32, 16, 30, 24], ["high", 58, 14, 34, 22], ["oldquarter", 4, 4, 36, 24], ["low", 30, 34, 36, 16],
    ["yard", 58, 44, 32, 20], ["back", 4, 44, 44, 20], ["westroad", 4, 20, 34, 28], ["north_east", 52, 3, 38, 18],
    ["westbar", 0, 22, 24, 18], ["eastgate", 74, 22, 22, 18], ["wall_nw", 0, 0, 30, 14], ["wall_se", 66, 54, 30, 14],
  ];
  for (const [name, x, y, w, h] of views) { save(`town_${name}`, crop(t.lit, x * TS, y * TS, w * TS, h * TS), 2); }
  save("town_square_flat", crop(t.flat, 32 * TS, 16 * TS, 30 * TS, 24 * TS), 2);
  for (const e of ESTABLISHMENTS) {
    const r = renderArea(interiorId(e)), rm = r.area.rooms[0];
    const x = (rm.x - 2) * TS, y = (rm.y - 3) * TS, w = (rm.w + 4) * TS, h = (rm.h + 6) * TS;
    save(`in_${e}`, crop(r.lit, x, y, w, h), 3); save(`in_${e}_flat`, crop(r.flat, x, y, w, h), 2);
  }
  const s = renderArea("surface"), ry = WEST_ROAD.surface.y0;
  save("surface_road", crop(s.lit, 0, (ry - 6) * TS, 26 * TS, 15 * TS), 2); save("surface_road_flat", crop(s.flat, 0, (ry - 6) * TS, 26 * TS, 15 * TS), 2);
}
