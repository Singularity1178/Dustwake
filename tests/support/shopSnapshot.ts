// Developer tool (not a test): renders the shops in use to PNG without a browser, through the real host (a Game on a
// pixel canvas, stepped and drawn as the browser would; see folkSnapshot.ts).
//
//   node scripts/shopPreview.mjs [dir] [only,these]     -> .preview/shops/*.png
//
// Names: poses (the new poses in every garb and facing, beside the placeholder keeper for scale), interiors (each
// shop at its busiest hour of the day, people at the shelves and the counter), deal (a customer's exchange with the
// keeper, frame by frame: the bubbles come in turn), board (the guild's board being read), street (the square: talk
// in bubbles, the notice board), door (the smithy's door from outside through a morning), closed (out of hours: no
// keeper, the card on the counter), scan (scan mode in a shop).
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { scene, shot, sheet, canvas, tick, installDom } from "./folkSnapshot";
import { createWorld, getArea, player, actorById, type World } from "../../src/game/world/world";
import { teleportTo } from "../../src/game/sim/debug";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { stepWorld } from "../../src/game/sim/step";
import { hourOf } from "../../src/game/content/daycycle";
import { drawTextS } from "../../src/game/font";
import { ARCHETYPES } from "../../src/game/content/folk";
import { BOARD, SHOPS } from "../../src/game/content/shops";
import { ESTABLISHMENTS, interiorId, type Establishment } from "../../src/game/content/town";
import { isFolk, makePerson, planAt, type FolkPose } from "../../src/game/sim/folk";
import { folkSprite } from "../../src/game/folkArt";
import { KEEPER_BOX, keeperPainter } from "../../src/game/keeperArt";
import { Pen } from "../../src/game/util";
import { TS } from "../../src/game/content/tiles";
import type { Facing } from "../../src/game/golem";

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
/** A tile near the middle of a shop's floor where the golem fits (so the whole room is in view). */
function standTile(e: Establishment): [number, number] {
  const w = createWorld(1), area = getArea(w, interiorId(e)), r = area.base.rooms![0], pl = player(w);
  for (const [dx, dy] of [[0, 1], [0, 2], [1, 1], [-1, 1], [2, 2], [-2, 2], [0, 0], [3, 1], [-3, 1], [0, 3]]) {
    const tx = Math.round(r.x + r.w / 2 + dx), ty = Math.round(r.y + r.h / 2 + dy);
    if (teleportTo(w, pl, area.id, tx * TS + 8, ty * TS + 8)) return [tx, ty];
  }
  return [-1, -1];
}
/** Sim only: how many customers are in a shop just after arriving at an hour. */
function customersAt(e: Establishment, hour: number, seed: number, board = false): number {
  const w = createWorld(seed); getArea(w, "town");
  const A = getArea(w, interiorId(e));
  teleportTo(w, player(w), A.id, A.start.x, A.start.y); advanceDayTo(w, hour);
  for (let i = 0; i < 40; i++) { stepWorld(w, 0.05); w.events = []; }
  return w.actors.filter((a) => isFolk(a) && a.area === A.id && (!board || a.life!.spot?.startsWith(BOARD.spots))).length;
}
function busiest(e: Establishment, seed: number, board = false): number {
  let best = SHOPS[e].hours.open + 1, n = -1;
  for (let h = SHOPS[e].hours.open + 0.4; h < Math.min(20, SHOPS[e].hours.close - 0.5); h += 0.35) { const k = customersAt(e, h, seed, board); if (k > n) { n = k; best = h; } }
  return best;
}
/** The first shop trip of kind `visit` in a seed's day: who, where, and when its time at the counter comes. */
function findTrip(visit: string, seeds: number[]): { seed: number; id: string; shop: Establishment; start: number; end: number } | null {
  for (const seed of seeds) {
    const w: World = createWorld(seed); getArea(w, "town");
    for (const a of w.actors.filter(isFolk)) for (let d = w.day + 0.01; d < w.day + 1; d += 0.004) {
      const p = planAt(w, a, d);
      if (p.trip?.visit === visit && p.endDay - p.startDay > 2.1 / 24) return { seed, id: a.id, shop: p.trip.shop, start: p.startDay, end: p.endDay };
    }
  }
  return null;
}

const POSES: FolkPose[] = ["browse", "point", "pay", "read", "note", "nod", "shake"];
function poseSheet(): RCanvas {
  const w0 = createWorld(1), cw = 22, ch = 40, facings: Facing[] = ["down", "left", "right", "up"];
  const archs = Object.values(ARCHETYPES).filter((a) => a.habitat === "town");
  const cols = POSES.length * facings.length * 2 + 2, out = canvas(cols * cw + 44, archs.length * ch + 12), ctx: any = out.getContext();
  ctx.fillStyle = "#2a2a30"; ctx.fillRect(0, 0, out.width, out.height);
  POSES.forEach((p, i) => drawTextS(ctx, p.toUpperCase(), 44 + i * facings.length * 2 * cw + 2, 2, "#ffffff", 1, "left", "#000"));
  archs.forEach((arch, j) => {
    const y0 = 12 + j * ch, look = makePerson(w0, { id: `sheet.${arch.id}.0`, area: "town", archetype: arch.id, home: "door.watch" }).look;
    ctx.fillStyle = j % 2 ? "#5a5650" : "#6a6862"; ctx.fillRect(0, y0, out.width, ch);
    drawTextS(ctx, arch.title.slice(0, 10), 2, y0 + 2, "#ffffff", 1, "left", "#000");
    let i = 0;
    for (const pose of POSES) for (const facing of facings) for (const frame of [0, 1]) {
      const head = pose === "shake" ? (({ up: ["left", "right"], down: ["right", "left"], left: ["down", "up"], right: ["up", "down"] } as Record<Facing, Facing[]>)[facing][frame]) : null;
      const s = folkSprite(arch.garb, arch.age, look, { facing, head, pose, frame, carry: false, lantern: false, pole: false, blink: false });
      const x = 44 + i++ * cw + 11, y = y0 + ch - 4;
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x - 5, y - 1, 11, 2);
      ctx.drawImage(s.a, x - s.ax, y - s.ay);
    }
    // the placeholder keeper beside them, for scale
    const kx = 44 + i * cw + 16, ky = y0 + ch - 4;
    keeperPainter("default")(new Pen(ctx, false), kx, ky, { facing: "down", state: "tend", moving: false, phase: 0, t: 0 });
  });
  void KEEPER_BOX;
  return out;
}

/** Play on as the browser does: every tick is also a frame for the speech bubbles (the host ages them while drawing). */
function play(g: any, seconds: number) { for (let i = 0; i < Math.round(seconds * 60); i++) { g.update(1 / 60); g.renderFolkBubbles(1 / 60); } }
/** The middle of a shot (offset by dx, dy), so a sheet of frames stays small enough to read. */
function cut(img: RCanvas, w: number, h: number, dx = 0, dy = 0): RCanvas {
  const c = canvas(w, h);
  (c.getContext() as any).drawImage(img, Math.round((img.width - w) / 2 + dx), Math.round((img.height - h) / 2 + dy), w, h, 0, 0, w, h);
  return c;
}

export function run(dir = ".preview/shops", only = "") {
  installDom();
  mkdirSync(dir, { recursive: true });
  const want = (n: string) => !only || only.split(",").includes(n);
  const save = (name: string, c: RCanvas, scale = 1) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  const live = (area: string, tx: number, ty: number, hour: number, secs: number, seed = 7) => { const s = scene(area, tx, ty, hour, 0.2, seed); play(s.g, secs); return s; };
  const frames = (g: any, label: string, n: number, gap: number, box?: [number, number, number, number]) => {
    const out: { label: string; img: RCanvas }[] = [];
    for (let i = 0; i < n; i++) { if (i) play(g, gap); const img = shot(g); out.push({ label: `${label} +${(i * gap).toFixed(0)}S`, img: box ? cut(img, ...box) : img }); }
    return out;
  };
  if (want("poses")) save("poses", poseSheet(), 2);
  if (want("interiors")) {
    const now: { label: string; img: RCanvas }[] = [], later: { label: string; img: RCanvas }[] = [];
    for (const e of ESTABLISHMENTS) {
      const [tx, ty] = standTile(e), h = busiest(e, 7), s = live(interiorId(e), tx, ty, h, 9);
      now.push({ label: `${e.toUpperCase()} ${hhmm(h)}`, img: cut(shot(s.g), 352, 230) });
      play(s.g, 8);
      later.push({ label: `${e.toUpperCase()} +8S`, img: cut(shot(s.g), 352, 230) });
    }
    save("interiors", sheet(3, now), 1.5); save("interiors_later", sheet(3, later), 1.5);
  }
  if (want("deal")) {
    const t = findTrip("buy", [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    if (t) {
      const [tx, ty] = standTile(t.shop), at = t.start + (t.end - t.start) * 0.5;
      const s = live(interiorId(t.shop), tx, ty, hourOf(at), 0.5, t.seed), who = actorById(s.w, t.id)!;
      // run on until they are being served, then a frame every two seconds
      for (let i = 0; i < 900 && who.life!.chat?.with !== `keeper.${t.shop}`; i++) play(s.g, 0.05);
      play(s.g, 0.9);
      save("deal", sheet(3, frames(s.g, `${t.shop.toUpperCase()} DEAL`, 6, 2.3, [250, 170, -20, -20])), 2);
    } else console.log("no buy trip found");
  }
  if (want("board")) {
    const [tx, ty] = standTile("guild"), h = busiest("guild", 7, true), s = live("town_guild", tx, ty, h, 6);
    save("board", sheet(3, frames(s.g, `BOARD ${hhmm(h)}`, 6, 3, [250, 170, -70, -50])), 2);
  }
  if (want("street")) {
    const a = live("town", 47, 33, 10.2, 8), b = live("town", 52, 35, 13.4, 8), c = live("town", 25, 14, 16.4, 8);
    save("street", sheet(3, [...frames(a.g, "SQUARE 10:12", 3, 6, [250, 170, 0, 0]), ...frames(b.g, "NOTICES 13:24", 3, 6, [250, 170, 0, 0]), ...frames(c.g, "WELL 16:24", 3, 6, [250, 170, 0, 0])]), 2);
  }
  if (want("door")) {
    const s = live("town", 54, 47, 8.4, 2);
    save("door", sheet(3, frames(s.g, "SMITHY DOOR 08:24", 6, 9, [250, 170, 0, -10])), 2);
  }
  if (want("closed")) {
    const [tx, ty] = standTile("smithy"), [jx, jy] = standTile("jeweler");
    const night = live("town_smithy", tx, ty, 3, 2), lunch = live("town_jeweler", jx, jy, 13.3, 2), open = live("town_jeweler", jx, jy, 15, 6);
    save("closed", sheet(3, [{ label: "SMITHY 03:00", img: cut(shot(night.g), 300, 200) }, { label: "JEWELLER 13:18 LUNCH", img: cut(shot(lunch.g), 300, 200) }, { label: "JEWELLER 15:00", img: cut(shot(open.g), 300, 200) }]), 1.5);
  }
  if (want("scan")) {
    const [tx, ty] = standTile("guild"), s = live("town_guild", tx, ty, busiest("guild", 7), 5);
    s.g.keyDown("z"); tick(s.g, 2); s.g.keyUp("z"); tick(s.g, 90);
    save("scan", cut(shot(s.g), 352, 230), 2);
  }
}
