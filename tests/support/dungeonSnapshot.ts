// Developer tool (not a test): renders the tutorial dungeon to PNG without a
// browser, for auditing its layout and art. Like daySnapshot.ts it drives the
// real host (a Game on a pixel canvas, stepped with update() and drawn with
// render()), so everything the player would see is there: the baked tiles and
// decals, every prop, the tile sprites (rubble, the cracked wall, pillars, the
// door, bars), the NPCs, flames, the roof crack's shaft and the real lighting.
//
// The whole map is drawn in one frame by zooming the view out past the area's
// size, in three modes:
//   lit   what the game shows (nothing but the dungeon's own lights)
//   dim   the same lights over a raised ambient, so dark corners can be read
//   flat  full-bright albedo plus glow, no lighting at all (art and layout)
// and cut into overlapping regions with tile coordinates along the top and
// left edges. In-game close-ups (the golem standing somewhere, at 1x) show a
// place exactly as it is met in play. The layout audit the town uses
// (townAudit.ts: props in walls, things standing in each other, things hung
// on walls that are not there) is run over the dungeon too.
//
//   node scripts/dungeonPreview.mjs                 -> .preview/dungeon/*.png, and the audit's findings
//   node scripts/dungeonPreview.mjs name=x,y,w,h[,scale[,lit|dim|flat[,hour]]] ...
//                                                   -> only those regions (tiles) of the whole-map render
//   node scripts/dungeonPreview.mjs name=@x,y[,scale[,lit|dim|flat[,hour]]] ...
//                                                   -> only those in-game close-ups (the golem at tile x,y)
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { auditArea } from "./townAudit";
import { Game } from "../../src/game/game";
import { createWorld, getArea, player, setFlag, type World } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { FLAGS } from "../../src/game/content/flags";
import { TS } from "../../src/game/content/tiles";
import { drawText } from "../../src/game/font";

export type Mode = "lit" | "dim" | "flat";
const DT = 1 / 60;
const AREA = "dungeon";
/* eslint-disable @typescript-eslint/no-explicit-any */
const mk = (w: number, h: number): RCanvas => {
  const c = (globalThis as any).document.createElement("canvas") as RCanvas;
  c.width = w; c.height = h; c.getContext();
  return c;
};

/** A game in play with the golem standing at a tile, at an hour of the day, settled for a moment. */
function host(tx: number, ty: number, hour: number): { g: Game; w: World } {
  const g = new Game(mk(320, 180) as unknown as HTMLCanvasElement, mk(320, 180) as unknown as HTMLCanvasElement), w = createWorld(7);
  setFlag(w, FLAGS.golemArm);
  if (!teleportTo(w, player(w), AREA, tx * TS + 8, ty * TS + 8)) throw new Error(`no room for the golem at ${tx},${ty}`);
  g.resume(w);
  advanceDayTo(w, hour);
  for (let i = 0; i < 90; i++) g.update(DT);
  return { g, w };
}

/** Swap the frame's lighting for an audit view (the game's own is left alone for `lit`). */
function relight(g: Game, mode: Mode) {
  if (mode === "lit") return;
  const L = (g as any).lighting, orig = L.compose.bind(L);
  L.compose = (s: Uint8ClampedArray, e: Uint8ClampedArray, o: Uint8ClampedArray, amb: [number, number, number], steps: number, gain: number) =>
    mode === "flat" ? orig(s, e, o, [1, 1, 1], steps, 0) : orig(s, e, o, [Math.max(amb[0], 0.5), Math.max(amb[1], 0.5), Math.max(amb[2], 0.55)], steps, gain);
}

function frame(g: Game): RCanvas {
  (g.canvas as unknown as RCanvas).getContext(); // the snapshot canvas only takes a new size here
  g.render();
  return g.canvas as unknown as RCanvas;
}

function crop(src: RCanvas, x: number, y: number, w: number, h: number): RCanvas {
  const c = mk(w, h);
  (c.getContext() as any).drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** The whole dungeon in one frame, with nobody in it. */
export function mapShot(mode: Mode, hour = 1): RCanvas {
  const { g, w } = host(9, 38, hour), a = getArea(w, AREA);
  const W = a.w * TS, H = a.h * TS;
  (g as any).hideGolem = true;
  g.setZoom(Math.ceil(Math.max(W / 320, H / 180)));
  (g as any).cam.x = 0; (g as any).cam.y = 0;
  relight(g, mode);
  return crop(frame(g), 0, 0, W, H);
}

/** The view with the golem standing at a tile: what the player sees there. */
export function viewShot(tx: number, ty: number, mode: Mode, hour = 1): RCanvas {
  const { g } = host(tx, ty, hour);
  relight(g, mode);
  const f = frame(g);
  return crop(f, 0, 0, f.width, f.height);
}

/** A region of a map render (tiles), with tile coordinates along the top and left. */
export function region(map: RCanvas, x: number, y: number, w: number, h: number): RCanvas {
  const mx = 10, my = 7, out = mk(w * TS + mx, h * TS + my), ctx: any = out.getContext();
  ctx.fillStyle = "#101014"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(map, x * TS, y * TS, w * TS, h * TS, mx, my, w * TS, h * TS);
  for (let i = 0; i < w; i++) drawText(ctx, String(x + i), mx + i * TS + 8, 1, (x + i) % 5 ? "#8a8a94" : "#ffffff", 1, "center");
  for (let j = 0; j < h; j++) drawText(ctx, String(y + j), mx - 1, my + j * TS + 6, (y + j) % 5 ? "#8a8a94" : "#ffffff", 1, "right");
  return out;
}

/** The default sheet: the map in nine overlapping regions. */
const REGIONS: [string, number, number, number, number][] = [
  ["nw", 0, 0, 26, 20], ["n", 23, 0, 26, 20], ["ne", 46, 0, 26, 20],
  ["w", 0, 18, 26, 20], ["c", 23, 18, 26, 20], ["e", 46, 18, 26, 20],
  ["sw", 0, 36, 26, 20], ["s", 23, 36, 26, 20], ["se", 46, 36, 26, 20],
];
/** In-game close-ups: the places most worth seeing as the player meets them. */
const VIEWS: [string, number, number, number][] = [
  ["throne_night", 34, 9, 1], ["throne_day", 34, 9, 12], ["crack_east", 49, 10, 1], ["crack_west", 45, 10, 1],
  ["greathall_n", 35, 25, 1], ["greathall_s", 35, 37, 1], ["barracks", 59, 17, 1], ["gaol", 57, 34, 1],
  ["start", 9, 38, 1], ["library", 10, 28, 1], ["circle", 11, 12, 1], ["chapel", 23, 49, 1], ["vestibule", 35, 48, 1], ["kitchen", 60, 46, 1],
];

export function run(dir = ".preview/dungeon", args: string[] = []): number {
  installDom();
  mkdirSync(dir, { recursive: true });
  const save = (name: string, c: RCanvas, scale = 1) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  const maps = new Map<string, RCanvas>();
  const map = (mode: Mode, hour: number) => { const k = `${mode}@${hour}`; if (!maps.has(k)) maps.set(k, mapShot(mode, hour)); return maps.get(k)!; };

  if (args.length) {
    for (const arg of args) {
      const [name, spec] = arg.split("=");
      if (!spec) throw new Error(`expected name=x,y,w,h[,scale[,mode[,hour]]] or name=@x,y[,scale[,mode[,hour]]], got "${arg}"`);
      const close = spec.startsWith("@"), p = (close ? spec.slice(1) : spec).split(","), n = close ? 2 : 4;
      const scale = Number(p[n] ?? 3), mode = (p[n + 1] ?? "dim") as Mode, hour = Number(p[n + 2] ?? 1);
      if (close) save(name, viewShot(Number(p[0]), Number(p[1]), mode, hour), scale);
      else save(name, region(map(mode, hour), Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3])), scale);
    }
    return 0;
  }

  save("map_lit", map("lit", 1)); save("map_dim", map("dim", 1)); save("map_flat", map("flat", 1)); save("map_lit_noon", map("lit", 12));
  for (const [name, x, y, w, h] of REGIONS) { save(`dim_${name}`, region(map("dim", 1), x, y, w, h), 3); save(`flat_${name}`, region(map("flat", 1), x, y, w, h), 3); }
  for (const [name, tx, ty, hour] of VIEWS) save(`view_${name}`, viewShot(tx, ty, "lit", hour), 3);

  // What the audit reports that is there on purpose (tests/dungeonAudit.test.ts names the same things): the
  // boulders heaped on the collapsed SURFACE GATE's rubble and the seam of night air buried in it, and the
  // places nobody can walk to yet (behind the cracked wall, the locked door, the gaol's bars).
  const byDesign = (f: { check: string; msg: string }) => (f.check === "in-wall" && f.msg.startsWith("rockpile@")) || f.check === "light" || f.check === "sealed";
  const found = auditArea(AREA), wrong = found.filter((f) => !byDesign(f));
  for (const f of found) console.log(`${byDesign(f) ? "(by design) " : ""}[${f.check}] ${f.msg}`);
  console.log(wrong.length ? `${wrong.length} finding(s) in the dungeon's layout` : `dungeon layout: clean (${found.length} by design)`);
  return wrong.length ? 1 : 0;
}
