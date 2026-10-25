// Preview renders (not a test): bakes areas and composes props, the surface
// rune and lighting through a pixel-accurate software canvas, then writes PNGs
// to .preview/. Run with `node scripts/preview.mjs`. It approximates the game's
// renderWorld (no golem, no particles) so layout and art can be checked
// without a browser.
import { installPixelCanvas, encodePNG, PixCanvas } from "./support/pixelCanvas";
installPixelCanvas();
import { mkdirSync, writeFileSync } from "node:fs";
import { buildSurface } from "../src/game/surface";
import { buildDungeon } from "../src/game/map";
import { Area } from "../src/game/world/area";
import { bakeRegion, propSprite, itemIcon, rubbleSprite, pillarSprite } from "../src/game/art";
import { buildCircle, CR } from "../src/game/circle";
import { SurfaceRuneArt } from "../src/game/surfaceRune";
import { Lighting, makeLight, computeVis } from "../src/game/light";
import { propDef } from "../src/game/content/props";
import { T, TS } from "../src/game/content/tiles";
import { SURFACE_GATE, GATE_CORRIDOR } from "../src/game/content/geo";
import { hash2, makeCanvas, type Sprite } from "../src/game/util";

mkdirSync(".preview", { recursive: true });
const circle = buildCircle();
const rune = new SurfaceRuneArt(circle);

function bakeAll(a: Area) {
  const c = makeCanvas(a.w * TS, a.h * TS);
  bakeRegion(c.ctx, a, 0, 0, a.w - 1, a.h - 1);
  return c;
}

interface RuneState { p: number; surv: number; rev: number }
function view(a: Area, bg: { c: HTMLCanvasElement }, camX: number, camY: number, W: number, H: number, rs: RuneState | null, file: string, scale = 2, lit = true) {
  const sc = makeCanvas(W, H), ec = makeCanvas(W, H);
  sc.ctx.fillStyle = "#000"; sc.ctx.fillRect(0, 0, W, H); ec.ctx.fillStyle = "#000"; ec.ctx.fillRect(0, 0, W, H);
  sc.ctx.drawImage(bg.c, camX, camY, W, H, 0, 0, W, H);
  const spr = (s: Sprite, x: number, y: number) => {
    const dx = Math.round(x - s.ax - camX), dy = Math.round(y - s.ay - camY);
    if (dx > W || dy > H || dx + s.w < 0 || dy + s.h < 0) return;
    sc.ctx.drawImage(s.a, dx, dy); ec.ctx.drawImage(s.e, dx, dy);
  };
  const rp = a.prop("rune.surface");
  if (rp && rs) {
    const x = Math.round(rp.x - CR - camX), y = Math.round(rp.y - CR - camY);
    sc.ctx.drawImage(rune.scene(rs.p), x, y);
    ec.ctx.globalAlpha = rs.surv; ec.ctx.drawImage(rune.emitSurv(), x, y);
    ec.ctx.globalAlpha = rs.rev; ec.ctx.drawImage(rune.emitRev(rs.p), x, y);
    ec.ctx.globalAlpha = 1;
  }
  const list: { y: number; f: () => void }[] = [];
  for (const p of a.props) {
    const def = propDef(p.kind);
    const s = propSprite(p.kind, p.v, def.alt === "lit" ? !!p.lit : def.alt === "taken" ? p.taken : p.open);
    if (s) list.push({ y: def.wallMounted ? p.y - 0.5 : def.flat ? p.y - 16 : p.y, f: () => spr(s, p.x, p.y) });
  }
  for (const l of a.loose) list.push({ y: l.y, f: () => spr(itemIcon(l.item), l.x, l.y + 2) });
  for (let ty = 0; ty < a.h; ty++) for (let tx = 0; tx < a.w; tx++) {
    const t = a.grid[ty * a.w + tx], x = tx * TS + 8, y = ty * TS + 16;
    if (t === T.RUBBLE) { const s = rubbleSprite(Math.floor(hash2(tx, ty, 5) * 3), false); list.push({ y, f: () => spr(s, x, y) }); }
    else if (t === T.PILLAR) { const s = pillarSprite(a.tvar[ty * a.w + tx] === 1); list.push({ y, f: () => spr(s, x, y) }); }
  }
  list.sort((p, q) => p.y - q.y);
  for (const d of list) d.f();
  const sI = sc.ctx.getImageData(0, 0, W, H), eI = ec.ctx.getImageData(0, 0, W, H);
  const out = new Uint8ClampedArray(W * H * 4);
  if (lit) {
    const L = new Lighting(W, H);
    const lights = a.lights.map((d) => { const l = makeLight(d.x, d.y, d.rad, d.col, d.int, d.flick, d.id); computeVis(l, a); return l; });
    for (const l of lights) if (l.id === "runeglow") l.cur = rs ? rs.surv * 0.25 + rs.rev * 0.75 : 0;
    L.accumulate(lights, camX, camY);
    L.compose(sI.data, eI.data, out, a.base.ambient ?? [0.05, 0.045, 0.065]);
  } else out.set(sI.data);
  writeFileSync(`.preview/${file}.png`, encodePNG(W, H, out, scale));
  console.log("wrote", file);
}

const s = new Area(buildSurface());
const sbg = bakeAll(s);
const rp = s.prop("rune.surface")!;
const W = 320, H = 180;
const at = (x: number, y: number) => [Math.max(0, Math.min(s.w * TS - W, x - W / 2)), Math.max(0, Math.min(s.h * TS - H, y - H / 2))];
// whole map, unlit albedo at 1/2 scale -> written at 1x of a downsample
{
  const full = makeCanvas(s.w * TS, s.h * TS);
  full.ctx.drawImage(sbg.c, 0, 0);
  const tmp = new Area(s.base);
  view(tmp, sbg, 0, 0, s.w * TS, s.h * TS, { p: 0, surv: 0, rev: 0 }, "surface_full_albedo", 1, false);
}
const args = process.argv.slice(2);
const only = (n: string) => !args.length || args.includes(n);
if (only("views")) {
  let [x, y] = at(rp.x, rp.y); view(s, sbg, x, y, W, H, { p: 0, surv: 0, rev: 0 }, "rune_dormant");
  view(s, sbg, x, y, W, H, { p: 0, surv: 0.8, rev: 0 }, "rune_glow_start");
  view(s, sbg, x, y, W, H, { p: 0.5, surv: 1, rev: 1 }, "rune_mid");
  view(s, sbg, x, y, W, H, { p: 1, surv: 1, rev: 1 }, "rune_active");
  [x, y] = at(SURFACE_GATE.arch.x * TS + 8, (SURFACE_GATE.y0 + 2) * TS); view(s, sbg, x, y, W, H, null, "gate_surface");
  view(s, sbg, x, y, W, H, null, "gate_surface_albedo", 2, false);
  for (const [n, cx, cy] of [["wide_nw", 22, 18], ["wide_ne", 70, 16], ["wide_e", 76, 40], ["wide_sw", 26, 50], ["wide_s", 60, 56]] as [string, number, number][]) {
    [x, y] = at(cx * TS, cy * TS); view(s, sbg, x, y, W, H, null, n, 2, false);
  }
  const d = new Area(buildDungeon()), dbg = bakeAll(d);
  view(d, dbg, (GATE_CORRIDOR.x0 + 2) * TS - W / 2, (GATE_CORRIDOR.y0 - 2) * TS - H / 2, W, H, null, "dungeon_gate");
  view(d, dbg, (GATE_CORRIDOR.x0 + 2) * TS - W / 2, (GATE_CORRIDOR.y0 - 2) * TS - H / 2, W, H, null, "dungeon_gate_albedo", 2, false);
}
void PixCanvas;
