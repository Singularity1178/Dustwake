// Developer tool (not a test): renders the townsfolk to PNG without a browser. A contact sheet of every archetype
// (several generated looks, every facing, every pose), and the real host (a Game on a pixel canvas, stepped and
// drawn as the browser would) in Westwake, the tavern and the hunters' camp at several hours, plus scan mode.
//
//   node scripts/folkPreview.mjs        -> .preview/folk/*.png
//
// Also a sheet of heads (every facing with the head straight, turned to each side, and asked to turn round to the
// back, which must draw exactly as straight ahead: sim/folk.ts naturalHead), and close-ups of the places that must
// hold one person at a time (the smithy's two anvils, a bench, the camp asleep on its bedrolls).
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { Game } from "../../src/game/game";
import { createWorld, getArea, player, setFlag, type World } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { FLAGS } from "../../src/game/content/flags";
import { TS } from "../../src/game/content/tiles";
import { drawTextS } from "../../src/game/font";
import { ARCHETYPES, CENSUS } from "../../src/game/content/folk";
import { makePerson, type FolkPose } from "../../src/game/sim/folk";
import { folkSprite } from "../../src/game/folkArt";
import type { Facing } from "../../src/game/golem";

class DCanvas extends RCanvas {
  getContext() {
    const ctx: any = super.getContext();
    if (!ctx.__day) {
      ctx.__day = true;
      ctx.putImageData = (img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => {
        for (let j = 0; j < img.height; j++) { const ty = y + j; if (ty < 0 || ty >= this.height) continue; for (let i = 0; i < img.width; i++) { const tx = x + i; if (tx < 0 || tx >= this.width) continue; const s = (j * img.width + i) * 4, d = (ty * this.width + tx) * 4; for (let k = 0; k < 4; k++) this.data[d + k] = img.data[s + k]; } }
      };
      ctx.getImageData = (x: number, y: number, w: number, h: number) => {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const s = ((y + j) * this.width + x + i) * 4, d = (j * w + i) * 4; for (let k = 0; k < 4; k++) out[d + k] = this.data[s + k]; }
        return { data: out, width: w, height: h };
      };
      const over = ctx.blend.bind(ctx);
      ctx.blend = (i: number, c: number[], a: number) => {
        if (ctx.globalCompositeOperation === "saturation") return saturate(this.data, i, c, a);
        if (ctx.globalCompositeOperation !== "lighter") return over(i, c, a);
        const d = this.data, k = c[3] * a;
        d[i] = Math.min(255, d[i] + c[0] * k); d[i + 1] = Math.min(255, d[i + 1] + c[1] * k); d[i + 2] = Math.min(255, d[i + 2] + c[2] * k); d[i + 3] = 255;
      };
    }
    return ctx;
  }
}
/** The "saturation" blend (vision mode greys the world with it): the backdrop's hue and luminosity with the source's saturation. */
function saturate(d: Uint8ClampedArray, i: number, c: number[], a: number) {
  const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
  const b = [d[i], d[i + 1], d[i + 2]], sat = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  const order = [0, 1, 2].sort((x, y) => b[x] - b[y]), out = [0, 0, 0], lo = b[order[0]], hi = b[order[2]];
  if (hi > lo) { out[order[1]] = ((b[order[1]] - lo) * sat) / (hi - lo); out[order[2]] = sat; }
  const dl = lum(b[0], b[1], b[2]) - lum(out[0], out[1], out[2]);
  let m = out.map((v) => v + dl);
  const L = lum(m[0], m[1], m[2]), n = Math.min(...m), x = Math.max(...m);
  if (n < 0) m = m.map((v) => L + ((v - L) * L) / (L - n));
  if (x > 255) m = m.map((v) => L + ((v - L) * (255 - L)) / (x - L));
  const k = (c[3] ?? 1) * a;
  for (let j = 0; j < 3; j++) d[i + j] = d[i + j] * (1 - k) + m[j] * k;
}
const canvas = (w: number, h: number) => { const c = new DCanvas(w, h); c.getContext(); return c; };
function installDom() {
  const g = globalThis as any;
  g.document = { createElement: () => new DCanvas() };
  g.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}
const DT = 1 / 60;
const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
const newGame = () => new Game(canvas(320, 180) as unknown as HTMLCanvasElement, canvas(320, 180) as unknown as HTMLCanvasElement);
function shot(g: Game): RCanvas {
  (g.canvas as unknown as RCanvas).getContext();
  g.render();
  const wc = g.canvas as unknown as RCanvas, uc = g.uiCanvas as unknown as RCanvas;
  const out = canvas(wc.width, wc.height), ctx: any = out.getContext();
  ctx.drawImage(wc, 0, 0); ctx.drawImage(uc, 0, 0, wc.width, wc.height);
  return out;
}
function sheet(cols: number, frames: { label: string; img: RCanvas }[]): RCanvas {
  const w = frames[0].img.width, h = frames[0].img.height, rows = Math.ceil(frames.length / cols);
  const out = canvas(cols * w, rows * h), ctx: any = out.getContext();
  frames.forEach((f, i) => { const x = (i % cols) * w, y = Math.floor(i / cols) * h; ctx.drawImage(f.img, x, y); drawTextS(ctx, f.label, x + 4, y + 4, "#ffffff", 1, "left", "#000000"); });
  return out;
}

/** The golem standing at a tile of an area, at an hour, after `settle` seconds of play. */
export function scene(area: string, tx: number, ty: number, hour: number, settle = 4, seed = 7): { g: Game; w: World } {
  const g = newGame(), w = createWorld(seed);
  setFlag(w, FLAGS.golemEye); setFlag(w, FLAGS.golemArm); setFlag(w, FLAGS.tutorialDone);
  getArea(w, area);
  const s = tx < 0 ? getArea(w, area).start : { x: tx * TS + 8, y: ty * TS + 8 };
  if (!teleportTo(w, player(w), area, s.x, s.y)) throw new Error(`no room at ${area} ${tx},${ty}`);
  advanceDayTo(w, hour);
  g.resume(w);
  tick(g, Math.round(settle / DT));
  return { g, w };
}

const POSES: FolkPose[] = ["stand", "walk", "chat", "wave", "sit", "crouch", "drink", "hammer", "chop", "hoe", "dig", "sweep", "hang", "feed", "draw", "aim", "raise", "lean", "warm", "browse", "lie"];
type Cell = { garb: any; age: any; look: any; facing: Facing; pose: FolkPose; frame: number; lantern?: boolean; pole?: boolean; head?: Facing | null };
/** Every archetype: four generated people each, in every facing; one of them walking, glancing, and in every pose. */
export function spriteSheet(): RCanvas {
  const w0 = createWorld(1), cw = 22, ch = 40;
  const rows: { label: string; cells: Cell[] }[] = [];
  for (const arch of Object.values(ARCHETYPES)) {
    const person = (k: number) => makePerson(w0, { id: `sheet.${arch.id}.${k}`, area: "town", archetype: arch.id, home: "door.watch" }).look;
    const base = { garb: arch.garb, age: arch.age };
    const cells: Cell[] = [];
    for (let k = 0; k < 4; k++) { const look = person(k); for (const f of ["down", "left", "right", "up"] as Facing[]) cells.push({ ...base, look, facing: f, pose: "stand", frame: 0 }); }
    const look = person(0);
    for (const f of ["down", "left", "up"] as Facing[]) for (let fr = 0; fr < 4; fr++) cells.push({ ...base, look, facing: f, pose: "walk", frame: fr });
    cells.push({ ...base, look, facing: "down", pose: "stand", frame: 0, head: "left" }, { ...base, look, facing: "down", pose: "stand", frame: 0, head: "right" });
    if (arch.garb === "watch") cells.push({ ...base, look, facing: "down", pose: "walk", frame: 1, lantern: true }, { ...base, look, facing: "left", pose: "raise", frame: 0, pole: true });
    rows.push({ label: arch.title, cells });
    // every pose in every facing (two rows: down and left, then right and up); a bow is only ever drawn side-on
    for (const fs of [["down", "left"], ["right", "up"]] as Facing[][]) {
      const poses: Cell[] = [];
      for (const p of POSES) for (const f of fs) for (const fr of [0, 1]) if ((fr === 0 || ["hammer", "chop", "hoe", "dig", "sweep", "wave", "chat", "drink"].includes(p)) && (p !== "aim" || f === "left" || f === "right")) poses.push({ ...base, look, facing: f, pose: p, frame: fr });
      rows.push({ label: "", cells: poses });
    }
  }
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const out = canvas(cols * cw + 4, rows.length * ch), ctx: any = out.getContext();
  rows.forEach((r, j) => {
    ctx.fillStyle = j % 2 ? "#4f6e3c" : "#6a6862"; ctx.fillRect(0, j * ch, out.width, ch);
    r.cells.forEach((c, i) => {
      const s = folkSprite(c.garb, c.age, c.look, { facing: c.facing, head: c.head ?? null, pose: c.pose, frame: c.frame, carry: false, lantern: !!c.lantern, pole: !!c.pole, blink: false });
      const x = i * cw + 12, y = j * ch + ch - 4;
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x - 5, y - 1, 11, 2);
      ctx.drawImage(s.a, x - s.ax, y - s.ay);
    });
    if (r.label) drawTextS(ctx, r.label, 2, j * ch + 2, "#ffffff", 1, "left", "#000");
  });
  return out;
}

const ROT: Facing[] = ["up", "right", "down", "left"];
const turnF = (f: Facing, k: number): Facing => ROT[(ROT.indexOf(f) + k + 4) % 4];
/**
 * Heads: per facing, four cells: straight, a quarter turn each way, and asked to turn round to the back (underlined
 * red), which must look exactly like the straight one. Every archetype standing, then a resident and an apprentice in
 * the poses a head is easiest to get wrong in: seated, working, chatting, drinking, warming at a fire, lying down.
 */
export function headSheet(): RCanvas {
  const w0 = createWorld(1), cw = 22, ch = 40, lw = 70, top = 12;
  const look = (id: string) => makePerson(w0, { id: `sheet.${id}.0`, area: "town", archetype: id, home: "door.watch" }).look;
  const rows: { label: string; arch: string; pose: FolkPose }[] = Object.values(ARCHETYPES).map((a) => ({ label: a.title, arch: a.id, pose: "stand" as FolkPose }));
  for (const arch of ["resident", "apprentice"]) for (const pose of ["sit", "hammer", "chat", "drink", "warm", "crouch", "lean", "aim", "lie"] as FolkPose[]) rows.push({ label: `${arch === "resident" ? "RES" : "APP"} ${pose.toUpperCase()}`, arch, pose });
  const facings: Facing[] = ["down", "left", "right", "up"];
  const out = canvas(lw + 16 * cw, top + rows.length * ch), ctx: any = out.getContext();
  ctx.fillStyle = "#2a2a30"; ctx.fillRect(0, 0, out.width, out.height);
  facings.forEach((f, k) => drawTextS(ctx, f.toUpperCase(), lw + k * 4 * cw + 2, 2, "#ffffff", 1, "left", "#000"));
  rows.forEach((r, j) => {
    const arch = ARCHETYPES[r.arch], l = look(r.arch), y0 = top + j * ch;
    ctx.fillStyle = j % 2 ? "#4f6e3c" : "#6a6862"; ctx.fillRect(0, y0, out.width, ch);
    drawTextS(ctx, r.label, 2, y0 + 2, "#ffffff", 1, "left", "#000");
    facings.forEach((f, k) => [null, turnF(f, -1), turnF(f, 1), turnF(f, 2)].forEach((head, h) => {
      if (r.pose === "aim" && (f === "up" || f === "down")) return;
      const s = folkSprite(arch.garb, arch.age, l, { facing: f, head, pose: r.pose, frame: 0, carry: false, lantern: false, pole: false, blink: false });
      const x = lw + (k * 4 + h) * cw + 11, y = y0 + ch - 4;
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x - 5, y - 1, 11, 2);
      ctx.drawImage(s.a, x - s.ax, y - s.ay);
      if (h === 3) { ctx.fillStyle = "#c83a2a"; ctx.fillRect(x - 8, y + 2, 17, 1); }
    }));
  });
  return out;
}

export function run(dir = ".preview/folk", only = "") {
  installDom();
  mkdirSync(dir, { recursive: true });
  const want = (n: string) => !only || only.split(",").includes(n);
  const save = (name: string, c: RCanvas, scale = 1) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  if (want("sprites")) save("sprites", spriteSheet(), 3);
  if (want("heads")) save("heads", headSheet(), 2);
  const hours: [number, string][] = [[6.6, "06:35"], [9.5, "09:30"], [13, "13:00"], [17.2, "17:10"], [19.9, "19:55"], [23, "23:00"]];
  const at = (name: string, area: string, tx: number, ty: number) => { if (want(name)) save(name, sheet(2, hours.map(([h, l]) => ({ label: `${name.toUpperCase()} ${l}`, img: shot(scene(area, tx, ty, h).g) })))); };
  at("square", "town", 47, 33);
  at("lowstreet", "town", 41, 46);
  at("yard", "town", 66, 52);
  at("oldquarter", "town", 24, 15);
  at("camp", "surface", 22, 13);
  if (want("tavern")) save("tavern", sheet(2, ([[20.8, "20:50"], [22, "22:00"]] as [number, string][]).map(([h, l]) => ({ label: `TAVERN ${l}`, img: shot(scene("town_tavern", -1, -1, h).g) }))), 2);
  if (want("scan")) {
    const s = scene("town", 47, 33, 10);
    s.g.keyDown("z"); tick(s.g, 2); s.g.keyUp("z"); tick(s.g, 90);
    save("scan", shot(s.g), 2);
  }
  const close: [string, string, number, number, number][] = [["close_square", "town", 47, 34, 10], ["close_tavern_door", "town", 41, 47, 19.2], ["close_lamps", "town", 46, 18, 19.8], ["close_camp", "surface", 22, 12, 21],
    ["close_smithy", "town", 70, 47, 9], ["close_bench", "town", 25, 17, 10.5], ["close_camp_night", "surface", 22, 13, 2]];
  for (const [n, area, tx, ty, h] of close) if (want(n) || want("close")) save(n, shot(scene(area, tx, ty, h).g), 2);
  console.log(CENSUS.length, "people in the census");
}
export { shot, sheet, canvas, tick, installDom, newGame, DCanvas };
