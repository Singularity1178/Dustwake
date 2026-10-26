// Developer tool (not a test): rasterises the build menu, placement and
// deconstruct tools, the crafting screen and every screen of the guardian's
// dialogue at the base 320x180 into PNGs, with
// a minimal pixel canvas, so layouts can be checked for overflow without a
// browser. Run after `npm test` has compiled:
//   node -e "require('./.test-out/tests/support/uiSnapshot.js').run('snapshots')"
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createWorld, player, currentArea, setFlag, enterArea } from "../../src/game/world/world";
import { addItems } from "../../src/game/sim/inventory";
import { orderBuild } from "../../src/game/sim/commands";
import { BuildUi } from "../../src/game/screens/buildMenu";
import { CraftingUi } from "../../src/game/screens/crafting";
import { DialogueUi } from "../../src/game/screens/dialogue";
import { DIALOGUE } from "../../src/game/content/dialogue";
import type { World } from "../../src/game/world/world";
import { ScreenStack } from "../../src/game/ui/screens";
import { FLAGS } from "../../src/game/content/flags";
import { stepPlayer, stepWorld } from "../../src/game/sim/step";
import { propSprite } from "../../src/game/art/props";
import { propDef } from "../../src/game/content/props";
import { TS, isSolidT } from "../../src/game/content/tiles";

type RGBA = [number, number, number, number];
function parseColor(s: string): RGBA {
  if (s.startsWith("#")) {
    const h = s.length === 4 ? s.slice(1).split("").map((c) => c + c).join("") : s.slice(1, 7);
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(",").map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return [0, 0, 0, 1];
}

class RCtx {
  fillStyle = "#000"; globalAlpha = 1; globalCompositeOperation = "source-over"; imageSmoothingEnabled = false;
  constructor(public canvas: RCanvas) {}
  private blend(i: number, c: RGBA, a: number) {
    const d = this.canvas.data, k = c[3] * a;
    d[i] = d[i] * (1 - k) + c[0] * k; d[i + 1] = d[i + 1] * (1 - k) + c[1] * k; d[i + 2] = d[i + 2] * (1 - k) + c[2] * k;
    d[i + 3] = Math.min(255, d[i + 3] + 255 * k);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const c = parseColor(this.fillStyle), W = this.canvas.width, H = this.canvas.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend((yy * W + xx) * 4, c, this.globalAlpha);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    const W = this.canvas.width;
    for (let yy = Math.max(0, y); yy < Math.min(this.canvas.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) this.canvas.data.fill(0, (yy * W + xx) * 4, (yy * W + xx) * 4 + 4);
  }
  createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(_x: number, _y: number, w: number, h: number) { return this.createImageData(w, h); }
  putImageData() { /* unused by UI */ }
  drawImage(src: RCanvas, ...a: number[]) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx: number, dy: number, dw = src.width, dh = src.height;
    if (a.length === 2) [dx, dy] = a; else if (a.length === 4) [dx, dy, dw, dh] = a; else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    const W = this.canvas.width, H = this.canvas.height;
    for (let j = 0; j < Math.round(dh); j++) for (let i = 0; i < Math.round(dw); i++) {
      const tx = Math.round(dx) + i, ty = Math.round(dy) + j;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const ux = Math.floor(sx + (i * sw) / dw), uy = Math.floor(sy + (j * sh) / dh), si = (uy * src.width + ux) * 4;
      const al = src.data[si + 3] / 255;
      if (al > 0) this.blend((ty * W + tx) * 4, [src.data[si], src.data[si + 1], src.data[si + 2], al], this.globalAlpha);
    }
  }
  save() {} restore() {} beginPath() {} rect() {} clip() {}
}
export class RCanvas {
  width: number; height: number; data: Uint8ClampedArray; private ctx?: RCtx;
  constructor(w = 0, h = 0) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(Math.max(1, w * h * 4)); }
  getContext() {
    if (this.data.length !== this.width * this.height * 4) this.data = new Uint8ClampedArray(this.width * this.height * 4);
    return (this.ctx ??= new RCtx(this));
  }
}

function png(c: RCanvas, scale: number): Buffer {
  const W = c.width * scale, H = c.height * scale;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const si = (Math.floor(y / scale) * c.width + Math.floor(x / scale)) * 4, di = y * (W * 3 + 1) + 1 + x * 3;
      raw[di] = c.data[si]; raw[di + 1] = c.data[si + 1]; raw[di + 2] = c.data[si + 2];
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let k = n; for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; return k >>> 0; });
  const crc = (b: Buffer) => { let r = 0xffffffff; for (const v of b) r = crcT[(r ^ v) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cb]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Render every screen of every segment of an NPC script's dialogue box onto a
 * 320x180 UI canvas, fully typed out, calling `shot` for each. Shared by the
 * PNG dump and the overflow test (tests/dialogueWrap.test.ts).
 */
export function renderDialogueScreens(w: World, npc: string, script: string, shot: (name: string, ui: RCanvas) => void) {
  const ui = new RCanvas(320, 180);
  const host: any = {
    ctx: ui.getContext(), world: w, get pl() { return player(w); }, get area() { return currentArea(w); },
    t: 0, screens: new ScreenStack(), typed: [], sfx: new Proxy({}, { get: () => () => {} }),
    hit: () => false, say: () => {}, renderNote: () => {}, renderToast: () => {}, animate: () => {}, drainEvents: () => { w.events = []; },
  };
  host.screens.set({ id: "play", opaque: true, t: 0, update() {}, render() {} });
  for (const seg of DIALOGUE[script].segments) {
    const d: any = new DialogueUi(host);
    d.open(npc, script, seg.id);
    if (!d.dlg) continue;
    d.dlg.pages.forEach((_: unknown, i: number) => {
      Object.assign(d.dlg, { page: i, chars: 1e9, hold: 0 });
      ui.data.fill(0);
      ui.getContext().fillStyle = "#1a1620"; ui.getContext().fillRect(0, 0, 320, 180);
      d.screen.render();
      shot(`dialogue-${script}-${seg.id}-${i + 1}`, ui);
    });
    host.screens.popToBase();
  }
}

export function run(dir = "snapshots") {
  (globalThis as any).document = { createElement: () => new RCanvas() };
  mkdirSync(dir, { recursive: true });
  const w = createWorld(7);
  stepWorld(w, 1 / 60);
  const pl = player(w);
  setFlag(w, FLAGS.knowBuild); addItems(w, pl, "wood", 5); addItems(w, pl, "stone", 3);
  const ui = new RCanvas(320, 180), world = new RCanvas(320, 180);
  const host: any = {
    ctx: ui.getContext(), wctx: world.getContext(), world: w, get pl() { return player(w); }, get area() { return currentArea(w); },
    t: 0.1, cam: { x: 0, y: 0 }, vw: 320, vh: 180, screens: new ScreenStack(), typed: [],
    sfx: new Proxy({}, { get: () => () => {} }), hit: () => false, say: (s: string) => { host.note = s; }, renderNote: () => {}, drainEvents: () => { w.events = []; },
  };
  host.screens.set({ id: "play", opaque: true, t: 0, update() {}, render() {} });
  const scene = () => {
    // crude world: tiles and props, so the ghost has context
    const a = currentArea(w), c = world.getContext();
    c.globalAlpha = 1;
    for (let ty = 0; ty < 12; ty++) for (let tx = 0; tx < 21; tx++) {
      const gx = Math.floor(host.cam.x / TS) + tx, gy = Math.floor(host.cam.y / TS) + ty;
      c.fillStyle = isSolidT(a.tile(gx, gy)) ? "#2e2a33" : "#4a4238"; c.fillRect(gx * TS - host.cam.x, gy * TS - host.cam.y, TS, TS);
    }
    for (const p of [...a.props].sort((x: any, y: any) => x.y - y.y)) {
      const d = propDef(p.kind), s = propSprite(p.kind, p.v, d.alt === "lit" ? !!p.lit : d.alt === "taken" ? p.taken : p.open);
      if (s) c.drawImage(s.a as unknown as RCanvas, Math.round(p.x - s.ax - host.cam.x), Math.round(p.y - s.ay - host.cam.y));
    }
    c.fillStyle = "#c0c0d0"; c.fillRect(pl.x - 5 - host.cam.x, pl.y - 14 - host.cam.y, 10, 14);
  };
  const shot = (name: string, draw: () => void) => {
    world.data.fill(0); ui.data.fill(0);
    scene(); draw();
    const out = new RCanvas(320, 180); out.getContext().drawImage(world, 0, 0); out.getContext().drawImage(ui, 0, 0);
    writeFileSync(`${dir}/${name}.png`, png(out, 3));
  };
  const b: any = new BuildUi(host);
  // translocation room, below the wall between the two torches
  pl.x = 10 * TS + 8; pl.y = 4 * TS + 12; pl.facing = "up";
  host.cam.x = 0; host.cam.y = 0;
  b.open();
  b.favorites.add("wall_torch");
  shot("build-menu", () => b.screen.render());
  b.cursor = b["list"].findIndex((e: any) => e.id === "brazier");
  shot("build-menu-locked", () => b.screen.render());
  b.search.active = true; b.search.value = "STONE"; b["refresh"]();
  shot("build-menu-search", () => b.screen.render());
  b.search.active = false; b.search.value = ""; b.tab = 2; b["refresh"]();
  b.cursor = b["list"].findIndex((e: any) => e.id === "wall_torch");
  shot("build-menu-light", () => b.screen.render());
  b.tab = 3; b["refresh"](); b.cursor = b["list"].findIndex((e: any) => e.id === "craftbench");
  shot("build-menu-craft", () => b.screen.render());
  b.tab = 2; b["refresh"](); b.cursor = b["list"].findIndex((e: any) => e.id === "wall_torch");
  b.recipe = "wall_torch"; b["toPlace"]();
  shot("place-wall-torch", () => b.screen.render());
  b.cur = { tx: 10, ty: 3 };
  shot("place-wall-torch-invalid", () => b.screen.render());
  b["toRemove"]();
  shot("remove-authored-torch", () => b.screen.render());
  b.cur = { tx: 10, ty: 2 };
  shot("remove-nothing", () => b.screen.render());
  // surface clearing for floor props and the bench
  enterArea(w, pl, "surface", 20 * TS + 8, 50 * TS + 14);
  const sa = currentArea(w);
  for (let ty = 46; ty <= 54; ty++) for (let tx = 16; tx <= 24; tx++) sa.setTile(tx, ty, 1);
  for (const p of [...sa.props]) if (Math.abs(p.x - pl.x) < 96 && Math.abs(p.y - pl.y) < 96) sa.removeProp(p.id);
  addItems(w, pl, "wood", 20); addItems(w, pl, "stone", 10);
  host.cam.x = pl.x - 160; host.cam.y = pl.y - 100;
  // The player's own task advances in stepPlayer (stepWorld only ticks other actors), so step both like the host does.
  orderBuild(w, pl, "craftbench", 20, 52);
  for (let i = 0; i < 200; i++) { stepPlayer(w, 1 / 60, { ix: 0, iy: 0, use: false }); stepWorld(w, 1 / 60); }
  b.recipe = "table"; b["toPlace"](); b.cur = { tx: 22, ty: 49 };
  shot("place-table", () => b.screen.render());
  b["toRemove"](); b.cur = { tx: 20, ty: 52 };
  shot("remove-bench", () => b.screen.render());
  const cu: any = new CraftingUi(host);
  cu.open("crafting", "x");
  shot("crafting", () => cu.screen.render());
  // the same bench for a golem that doesn't know how to build: greyed out, nothing listed
  w.flags.delete(FLAGS.knowBuild);
  host.screens.popToBase();
  cu.open("crafting", "x");
  shot("crafting-locked", () => cu.screen.render());
  // the guardian's whole script (with the iron arm, so the optional page shows too)
  const dw = createWorld(7);
  setFlag(dw, FLAGS.golemArm);
  renderDialogueScreens(dw, "npc.guardian", "guardian", (name, c) => writeFileSync(`${dir}/${name}.png`, png(c, 3)));
}
