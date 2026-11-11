// Westwake, the market town west of the surface, as an area definition. Pure,
// deterministic builder (no DOM): fixed seed, stable prop ids (kind@tx,ty).
// What stands where comes from content/town.ts (the building table and the
// street grid); this file lays the ground, stamps the buildings, and dresses
// the place. See content/town.ts for the town's story and how to read it.
//
// Conventions kept from the dungeon and the surface:
//   - every building front faces south (the view looks north and down), so
//     every door opens onto the street along its south side;
//   - a building is solid tiles (WALL, with a FRONT row at street level so
//     lamp light reaches the whole front) under one baked "building" decal;
//   - anything that glows or stands up is a prop; lights belong to props.
//
// The edge of the map is just where the tiles end: no hedge, no thicket. The
// town wall (content/town.ts: STREETS.wall) is a closed ring round the town,
// open only at the two gates the High Street passes through.
//
// Laid out for what comes later (nothing uses it yet): streets are at least
// two tiles wide and never dead-end without a reason, every door has a free
// doorstep, every market stall has a pitch behind it and a place to stand in
// front, and `spots` names those standing places (map.ts: Spot).
import { TOWN_FOLK_SPOTS } from "./content/town";
import { mulberry } from "./core/rng";
import { TS, T, FS, WS } from "./content/tiles";
import { propDef } from "./content/props";
import { BUILDINGS, DOOR, FRONT_H, SIGNS, STREETS, TOWN_H, TOWN_ID, TOWN_NAME, TOWN_W, UPWIN, WIN, chimneyPx, doorPx, dormerPx, type Building } from "./content/town";
import { vnoise } from "./surface";
import type { AreaData, DecalDef, LightDef, LooseItem, Portal, PropDef, Room, Spot } from "./map";

const TOWN_SEED = 4177;
/** The town's night: the same sky as the surface's. The sun takes it from here (content/daycycle.ts). */
export const TOWN_AMBIENT: [number, number, number] = [0.3, 0.3, 0.42];

/** Shared scaffolding for the town's builders (the streets here, the rooms in townInteriors.ts). */
export function areaKit(w: number, h: number) {
  const n = w * h;
  const grid = new Uint8Array(n).fill(T.WALL), style = new Uint8Array(n), tvar = new Uint8Array(n);
  const props: PropDef[] = [], lights: LightDef[] = [], decals: DecalDef[] = [], loose: LooseItem[] = [], portals: Portal[] = [], spots: Spot[] = [];
  const ids = new Set<string>();
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const set = (x: number, y: number, t: number, s?: number) => {
    if (!inb(x, y)) return;
    grid[y * w + x] = t;
    if (s !== undefined) style[y * w + x] = s;
  };
  const rect = (x: number, y: number, rw: number, rh: number, t: number, s?: number) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) set(i, j, t, s);
  };
  /** A prop at a pixel position (x its centre, y its foot). Registers the light its kind gives off. */
  const P = (kind: string, px: number, py: number, o: Partial<PropDef> = {}) => {
    const tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    let id = o.id ?? `${kind}@${tx},${ty}`;
    for (let k = 2; ids.has(id); k++) id = `${kind}@${tx},${ty}#${k}`;
    ids.add(id);
    const p: PropDef = { kind, x: Math.round(px), y: Math.round(py), v: 0, ...o, id };
    props.push(p);
    const L = propDef(kind).light;
    if (L && (L.when === "always" || p.lit)) lights.push({ x: p.x + L.dx, y: p.y + L.dy, rad: L.rad, col: L.col, int: L.int, flick: L.flick, owner: id });
    return p;
  };
  /** The same at a tile (fractions allowed): centred on it, standing on its bottom edge, as the dungeon builder does. */
  const Pt = (kind: string, tx: number, ty: number, o: Partial<PropDef> = {}) => P(kind, tx * TS + 8, ty * TS + 16, o);
  const D = (kind: string, x: number, y: number, v = 0, dw?: number, dh?: number) => { decals.push({ kind, x: Math.round(x), y: Math.round(y), v, w: dw, h: dh }); };
  const spot = (id: string, kind: Spot["kind"], x: number, y: number, facing: Spot["facing"]) => { spots.push({ id, kind, x: Math.round(x), y: Math.round(y), facing }); };
  return { n, grid, style, tvar, props, lights, decals, loose, portals, spots, inb, set, rect, P, Pt, D, spot };
}

/** Which street a door gives onto (the note shown on stepping back out). */
const STREET_OF: Record<string, string> = {
  guild: "MARKET SQUARE", tailor: "MARKET SQUARE", jeweler: "MARKET SQUARE", armory: "HIGH STREET", tavern: "LOW STREET", smithy: "LOW STREET",
};

export function buildTown(): AreaData {
  const W = TOWN_W, H = TOWN_H, k = areaKit(W, H);
  const { grid, style, props, P, Pt, D, spot } = k;
  const rng = mulberry(TOWN_SEED);
  const I = (x: number, y: number) => y * W + x;
  const S = STREETS, hs = S.high, sq = S.square, Wl = S.wall;
  /** Streets, yards and doorsteps: nothing is scattered on these. */
  const keep = new Uint8Array(k.n);
  const pave = (x0: number, y0: number, x1: number, y1: number, s: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { grid[I(x, y)] = T.FLOOR; style[I(x, y)] = s; keep[I(x, y)] = 1; }
  };

  // ---- the land: meadow, inside the wall and out. No hedge and no thicket: beyond the wall the ground
  // simply runs to the edge of the map and stops there (out of bounds is solid: sim/collision.ts).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y), pn = vnoise(x, y, 4, 311);
    grid[i] = T.FLOOR;
    style[i] = pn > 0.8 ? FS.DIRT : pn < 0.14 ? FS.MOSS : FS.GRASS;
  }

  // ---- streets. Setts where the light runes are; cobbles where the town is older; earth where nobody pays.
  pave(Wl.westX0, hs.y0, Wl.x1, hs.y1, FS.SETT);                 // the West Bar -> the square -> the east gate
  pave(Wl.x1 + 1, hs.y0, W - 1, hs.y1, FS.DIRT);                 // ...and out, as the old road, to the edge of the map
  pave(0, hs.y0, Wl.westX0 - 1, hs.y1, FS.DIRT);                 // the west road beyond the bar: four days to anywhere larger
  pave(sq.x0, sq.y0, sq.x1, sq.y1, FS.SETT); pave(sq.x0 + 1, sq.y0 + 1, sq.x1 - 1, sq.y1 - 1, FS.WEAVE);
  pave(33, 27, 36, 29, FS.SETT); pave(58, 27, 61, 29, FS.SETT);  // the corners by the tailor and the jeweller
  pave(60, 17, 61, 29, FS.SETT);                                 // Lamp Street
  pave(7, S.oldLane.y0, 55, S.oldLane.y1, FS.COBBLE); pave(56, S.oldLane.y0, 86, S.oldLane.y1, FS.SETT); // Old Lane, repaved where the money lives
  pave(33, 17, 34, 29, FS.COBBLE);                               // Well Lane
  pave(41, 17, 41, 26, FS.DIRT); pave(53, 17, 53, 26, FS.DIRT);  // the alleys either side of the Guild
  pave(46, 38, 49, 44, FS.COBBLE);                               // Crown Passage: the way down from the square
  pave(8, S.low.y0, 86, S.low.y1, FS.COBBLE); pave(8, S.low.y0, 19, S.low.y1, FS.MUD); pave(20, S.low.y0, 23, S.low.y1, FS.DIRT); pave(81, S.low.y0, 86, S.low.y1, FS.DIRT);
  pave(21, 33, 22, 44, FS.COBBLE); pave(21, 48, 22, 57, FS.DIRT); // the west lane
  pave(46, 48, 48, 57, FS.DIRT);                                 // down to the back lane
  pave(8, S.back.y0, 86, S.back.y1, FS.DIRT);                    // the back lane
  pave(84, 33, 86, 57, FS.DIRT);                                 // the haul road, inside the wall
  pave(58, 39, 62, 44, FS.EARTH);                                // the smith's yard
  pave(62, 48, 83, 57, FS.EARTH);                                // the stone yard and the golem stands
  pave(10, 35, 18, 37, FS.EARTH);                                // the stable's paddock
  pave(23, 10, 28, 13, FS.DIRT);                                 // trodden ground round the old well
  for (const [x0, y0, x1, y1] of [[10, 46, 12, 46], [15, 45, 17, 46], [9, 59, 14, 59], [30, 58, 33, 59], [72, 59, 76, 60]]) pave(x0, y0, x1, y1, FS.MUD);

  // ---- the town wall: a closed ring, open only where the High Street passes through it (the two gates)
  for (let y = Wl.northY0; y <= Wl.southY1; y++) for (let x = Wl.westX0; x <= Wl.x1; x++) {
    const ring = x <= Wl.westX1 || x >= Wl.x0 || y <= Wl.northY1 || y >= Wl.southY0;
    if (ring && (y < Wl.gateY0 || y > Wl.gateY1)) k.set(x, y, T.WALL, WS.RAMPART);
  }

  // ---- buildings: footprint, painting, and everything on the front that glows or hangs
  const signV = (kind: string) => Math.max(0, SIGNS.findIndex(([s]) => s === kind));
  const stamp = (b: Building, i: number) => {
    k.rect(b.x, b.y, b.w, b.h, T.WALL, 0);
    k.rect(b.x, b.y + b.h - 1, b.w, 1, T.FRONT, 0);
    D("building", b.x * TS, b.y * TS, i, b.w * TS, b.h * TS);
    const foot = (b.y + b.h) * TS, top = foot - FRONT_H, rune = b.light === "rune";
    const ch = chimneyPx(b);
    if (ch) P("chimney", ch.x, ch.y + 1);
    for (const c of b.lit ?? []) P(rune ? "winglow_rune" : "winglow", (b.x + c) * TS + 8, top + WIN.top + 8, { v: rune ? 1 : 0 });
    // upstairs: about half the windows of a lit house show a light
    if (b.light !== "none") for (let c = 0; c < b.w; c++) {
      if (!(b.win?.includes(c) || c === b.door?.col) || rng() > 0.5) continue;
      P("winglow_up", (b.x + c) * TS + 8 + (c === b.door?.col && b.door.kind === "hauler" ? 8 : 0), top + UPWIN.top + 6, { v: rune ? 3 : 2 });
    }
    if (b.light !== "none") for (const c of b.dormers ?? []) { const w = dormerPx(b, c); P("winglow_up", w.x, w.y - 1, { v: rune ? 3 : 2 }); }
    if (!b.door) return;
    const d = doorPx(b), half = DOOR[d.kind].w / 2;
    for (let x = Math.floor((d.x - half) / TS); x <= Math.floor((d.x + half - 1) / TS); x++) if (k.inb(x, b.y + b.h)) keep[I(x, b.y + b.h)] = 1;
    if (b.sign) P(b.sign, d.x + half + 10, top + 24, { v: signV(b.sign) });
    // the door lamp: a light rune for those who can, a lantern or a torch for the rest, nothing for the poorest
    if (rune) P("rune_sconce", d.x - half - 7, top + 22);
    else if (b.interior) P("lantern", d.x - half - 8, top + 22);
    else if (b.light === "torch" && rng() < 0.6) P("torch", d.x - half - 7, top + 26, { lit: true });
    spot(`door.${b.id}`, "door", d.x, foot + 10, "up");
    if (b.interior) {
      k.portals.push({
        id: `door.${b.id}`, x: d.x - half + 1, y: foot + 3, w: half * 2 - 2, h: 9, dir: "up", door: true,
        to: { area: b.interior, portal: "door" }, arrive: { x: d.x, y: foot + 9 }, label: STREET_OF[b.id],
      });
      D("doormat", d.x, foot + 5);
    }
  };
  BUILDINGS.forEach(stamp);

  // ---- street light. Light runes along the paved streets and round the square...
  for (const [x, y] of [
    [12, 33], [18, 33], [25, 33], [31, 33], [61, 33], [67, 33], [73, 33], [79, 33],          // the High Street's south verge
    [38, 28], [56, 28], [38, 36], [56, 36], [44, 28], [50, 28],                              // the square
    [62, 19], [62, 26], [58, 17], [64, 17], [70, 17], [76, 17], [82, 17], [86, 29], [83, 34], // Lamp Street, the rich end of Old Lane, the gate
  ]) Pt("rune_lamp", x, y);
  // ...and fire everywhere else, where there is any light at all
  for (const [x, y] of [[14, 17], [30, 17], [46, 17], [27, 14], [12, 47.7], [26, 47.7], [36, 48], [49, 48], [61, 48], [64, 49], [70, 49], [23, 61], [54, 61], [80, 61], [20, 38], [63, 44]])
    Pt("torch_post", x, y, { lit: true });
  Pt("brazier", 91, 29.4, { lit: true });      // the watch fire outside the gate
  Pt("brazier", 70.5, 56.4, { lit: true });    // and the yard's, where the day's hauling is counted

  // ---- the east gate: towers, the keep's stones in their walls, the road out
  const gn = BUILDINGS.find((b) => b.id === "gate_n")!, gateFoot = (gn.y + gn.h) * TS;
  P("rune_sconce", (gn.x + 2) * TS, gateFoot - 10); P("keepstone", gn.x * TS + 11, gateFoot - 5); P("keepstone", (gn.x + 3) * TS + 6, gateFoot - 17, { v: 1 });
  P("banner", (gn.x + 1) * TS, gateFoot - 12, { v: 1 }); P("banner", (gn.x + 3) * TS, gateFoot - 12, { v: 1 });
  Pt("milestone", 91.5, 33.2); Pt("towntree", 92.4, 28.2, { v: 1 }); Pt("bush", 91.2, 33.6, { v: 2 }); Pt("bush", 93, 33.5, { v: 0 });
  k.portals.push({
    // (the box reaches the last column: the road runs to the edge of the map now, and so does the way out)
    id: "east_road", x: (W - 2) * TS - 2, y: hs.y0 * TS, w: 2 * TS + 2, h: (hs.y1 - hs.y0 + 1) * TS, dir: "right",
    to: { area: "surface", portal: "west_road" }, arrive: { x: (W - 4) * TS + 8, y: hs.y0 * TS + 28 }, label: `${TOWN_NAME}, MARKET TOWN`,
  });
  // ...and the West Bar, where the road goes on to places that matter more: the same gate at the other end of
  // the street, shut for the night. The bar lies across the passage between its towers, so there is no way round it.
  const wn = BUILDINGS.find((b) => b.id === "bar_n")!, barFoot = (wn.y + wn.h) * TS;
  P("rune_sconce", (wn.x + 2) * TS, barFoot - 10); P("banner", (wn.x + 1) * TS, barFoot - 12, { v: 1 }); P("banner", (wn.x + 3) * TS, barFoot - 12, { v: 1 });
  P("tollbar", ((Wl.westX0 + Wl.westX1 + 1) / 2) * TS, (hs.y1 + 1) * TS); Pt("rune_lamp", 9, 29);

  // ---- the market square: the charter stone, the pitches, the board
  Pt("marketcross", 47, 32.3);
  const stalls: [number, number, number][] = [[40.2, 35.2, 0], [44, 35.2, 3], [50, 35.2, 1], [53.8, 35.2, 2], [40.2, 31.4, 2], [53.8, 31.4, 0]];
  stalls.forEach(([x, y, v], i) => {
    const s = Pt("stall", x, y, { v });
    spot(`stall.${i}.keeper`, "stall", s.x, s.y - 12, "down"); spot(`stall.${i}.customer`, "customer", s.x, s.y + 9, "up");
    D("straw", s.x + 4, s.y + 6, 0, 26);
  });
  Pt("noticeboard", 52.5, 36.9);
  // the Throne's colours: before the Guild, before the Reeve's Hall, inside the gate
  for (const [x, y, v] of [[42, 27.5, 0], [52, 27.5, 0], [76.9, 15.3, 0], [81.1, 15.3, 0], [85.6, 33.3, 1]]) Pt("bannerpole", x, y, { v });
  for (const [kind, x, y, v] of [
    ["crate", 42.2, 35.6, 0], ["crate", 42.2, 34.9, 1], ["barrel", 51.9, 34.9, 0], ["sack", 46, 35.7, 0], ["barrel", 38.2, 31.6, 1], ["crate", 55.6, 31.7, 0], ["sack", 48.2, 35.7, 0],
    ["planter", 39.5, 27.5, 0], ["planter", 45, 27.5, 1], ["planter", 49, 27.5, 3], ["planter", 54.5, 27.5, 2], ["wagon", 39.8, 36.9, 0],
  ] as [string, number, number, number][]) Pt(kind, x, y, { v });
  for (const [id, x, y, f] of [["cross.n", 47.5, 30.4, "down"], ["cross.e", 50.2, 32.6, "left"], ["cross.w", 44.8, 32.6, "right"], ["cross.s", 47.5, 34.4, "up"], ["board", 53, 36.6, "down"], ["guildsteps", 46.2, 27.8, "down"]] as const)
    spot(`idle.${id}`, "idle", x * TS, y * TS, f);
  D("wear", 47.5 * TS, 32.5 * TS, 0, 120, 70); D("wear", 47.5 * TS, 28 * TS, 0, 60, 26);

  // ---- the old quarter: the well the village grew round, a keep statue set up as a keepsake
  Pt("well", 25.5, 11.5); Pt("keepstatue", 28.6, 9.4, { v: 1 }); Pt("towntree", 22.6, 9.6, { v: 0 }); Pt("bench", 25.4, 13.5);
  for (let i = 0; i < 7; i++) D("wildflowers", 28.4 * TS + rng() * 22, 10 * TS + rng() * 10, i % 4);
  D("wear", 25.5 * TS + 8, 12.4 * TS, 0, 70, 34);
  spot("idle.well", "idle", 24.6 * TS, 12.8 * TS, "right"); spot("idle.statue", "idle", 29 * TS, 11 * TS, "up");
  Pt("woodpile", 14.5, 14.45); Pt("barrel", 21.6, 14.4, { v: 1 }); Pt("coop", 37.6, 13.6); Pt("laundry", 10.6, 7.6);

  // ---- gardens, yards and fences
  const fenceRow = (x0: number, x1: number, y: number, v: number, gaps: number[] = []) => { for (let x = x0; x <= x1; x++) if (!gaps.includes(x)) Pt("fence", x, y, { v }); };
  const fenceCol = (x: number, y0: number, y1: number, v: number) => { for (let y = y0; y <= y1; y++) Pt("fence_v", x, y, { v }); };
  // the walled gardens behind the High Street's north side (the town's better houses)
  fenceRow(63, 85, 18, 0, [67, 78]);
  for (const [kind, x, y, v] of [["towntree", 65, 20.2, 2], ["planter", 68.4, 20.5, 1], ["towntree", 73.6, 21.6, 0], ["planter", 76, 22.6, 2], ["planter", 79.5, 20.4, 0], ["towntree", 83.2, 21.8, 1], ["bush", 70.5, 21, 3], ["bush", 81.6, 22.6, 1], ["bench", 75.5, 20]] as [string, number, number, number?][])
    Pt(kind, x, y, { v: v ?? 0 });
  for (let i = 0; i < 26; i++) D(i % 3 ? "wildflowers" : "flowers", 64 * TS + rng() * 21 * TS, 19 * TS + rng() * 3 * TS, (rng() * 4) | 0);
  // yards behind the High Street's south side: beans, washing, hens
  fenceRow(63, 82, 34, 1, [70, 77]); fenceRow(58, 62, 38, 1); fenceRow(24, 35, 34, 1, [30]);
  D("plot", 64 * TS, 35 * TS + 4, 0, 44, 30); D("plot", 72 * TS, 35 * TS + 2, 1, 40, 26); D("plot", 25 * TS, 35 * TS + 6, 2, 56, 30); D("plot", 59 * TS, 34 * TS + 2, 1, 40, 26);
  Pt("laundry", 67.8, 37.4); Pt("coop", 80.4, 36.4); Pt("woodpile", 75.4, 37.6); Pt("towntree", 79, 36.2, { v: 2 }); Pt("laundry", 31.6, 37.6); Pt("towntree", 34.4, 36.4, { v: 1 }); Pt("barrel", 24.6, 37.9);
  // the stable's paddock and its front
  fenceRow(9, 19, 34, 1, [14]); fenceCol(19, 35, 37, 1); fenceCol(9, 35, 37, 1);
  Pt("haybale", 10.6, 36.4, { v: 1 }); Pt("haybale", 12, 36.9); Pt("trough", 17.2, 35.3); Pt("wagon", 15.4, 36.95, { v: 3 }); D("straw", 13 * TS, 36.2 * TS, 0, 60);
  Pt("hitchpost", 10.6, 45.2); Pt("hitchpost", 17.6, 45.2); D("straw", 14.5 * TS, 45.6 * TS, 0, 40); D("planks", 9 * TS, 46 * TS + 9, 0, 11 * TS, 9);
  // the cottage gardens along the back
  fenceRow(9, 20, 48, 1, [13]); fenceRow(24, 35, 48, 1, [28]);
  D("plot", 9 * TS + 4, 49 * TS + 4, 0, 60, 34); D("plot", 16 * TS, 49 * TS + 8, 2, 52, 30); D("plot", 24 * TS + 6, 49 * TS + 4, 1, 64, 34); D("plot", 31 * TS, 49 * TS + 6, 0, 56, 30);
  Pt("laundry", 13.6, 50.9); Pt("coop", 29.4, 50.9); Pt("woodpile", 18.4, 50.9); Pt("barrel", 36.6, 57.4); Pt("towntree", 36.6, 49.8, { v: 0 });

  // ---- the low side at work
  // the tavern's front, and the smith's yard beside the forge wall
  Pt("barrel", 36.6, 44.42); Pt("barrel", 37.5, 44.44, { v: 1 }); Pt("bench", 43.4, 44.3); Pt("crate", 45.4, 44.5);
  D("shadowband", 58 * TS, 39 * TS, 0, 5 * TS, 22);
  Pt("woodpile", 59.2, 40.4); Pt("coalbin", 61.4, 40.3); Pt("townanvil", 60, 42.6); Pt("quench", 61.6, 43.4); Pt("grindstone", 58.6, 43.6); Pt("ingots", 58.6, 41.6);
  D("stain", 60 * TS, 41.6 * TS, 0, 56, 40); D("scorch", 60 * TS, 42 * TS, 0);
  spot("work.smithyard", "work", 60 * TS + 8, 44.3 * TS, "up");
  Pt("wagon", 75.2, 47.3, { v: 1 }); Pt("barrel", 78.3, 44.42); Pt("barrel", 83.2, 44.44, { v: 1 });
  // the stone yard: cut stone and timber waiting on things that can lift them, a hoist, the stands
  fenceRow(62, 64, 48, 1); fenceRow(70, 83, 48, 1);
  for (const [kind, x, y, v] of [
    ["stonestack", 63.4, 51, 0], ["stonestack", 65.8, 51, 1], ["stonestack", 63.6, 54, 1], ["timberstack", 64, 57], ["timberstack", 67, 56], ["crane", 68.6, 53],
    ["wagon", 66.6, 50, 2], ["golempad", 73.5, 55.2, 0], ["golempad", 76.5, 55.2, 1], ["golempad", 79.5, 55.2, 2], ["yokerack", 82.4, 55.4], ["tallyboard", 71.2, 54.6], ["crate", 82.6, 57, 1],
  ] as [string, number, number, number?][]) Pt(kind, x, y, { v: v ?? 0 });
  spot("work.hoist", "work", 68.6 * TS + 8, 54.6 * TS, "up");
  for (let i = 0; i < 3; i++) spot(`stand.${i + 1}`, "work", (73.5 + i * 3) * TS + 8, 56.3 * TS, "down");
  // a house going up at the end of the lane; the market store with its wide doors
  Pt("scaffold", 40.5, 57.9); Pt("woodpile", 44.6, 56.6); Pt("stonestack", 44.7, 53.4, { v: 1 }); D("straw", 44.5 * TS, 58.6 * TS, 0, 30);
  Pt("crate", 51.2, 57.5); Pt("crate", 52.2, 57.5, { v: 1 }); Pt("barrel", 58.6, 57.44); Pt("sack", 57.6, 57.5); Pt("wagon", 57, 61.4, { v: 0 });
  // tracks: cart ruts on the through road, and the broad flat prints of the things that do the hauling
  D("ruts", 58 * TS, 31 * TS + 8, 0, 36 * TS); D("ruts", 85 * TS + 8, 33 * TS, 1, 25 * TS); D("ruts", 24 * TS, 59 * TS + 8, 0, 60 * TS);
  D("golemtrack", 86 * TS, 31 * TS + 12, 0, 8 * TS); D("golemtrack", 85 * TS + 2, 33 * TS, 1, 25 * TS); D("golemtrack", 56 * TS, 59 * TS + 2, 0, 29 * TS);
  D("golemtrack", 67 * TS + 8, 45 * TS, 1, 9 * TS); D("golemtrack", 55 * TS, 58 * TS, 1, 20); D("golemtrack", 68 * TS, 55 * TS + 6, 0, 12 * TS); D("golemtrack", 41 * TS, 59 * TS + 4, 0, 14 * TS);
  for (const [x, y] of [[59, 31], [70, 31], [80, 31], [36, 31], [24, 31], [47, 39], [47, 46]]) D("wear", x * TS + rng() * 16, y * TS + 8, 0, 50 + rng() * 30, 18);
  for (const [x, y] of [[65, 30], [75, 32], [28, 30], [44, 37]]) D("drain", x * TS + 8, y * TS + 8);
  for (const [x, y, w] of [[11, 46, 30], [17, 45, 24], [32, 59, 34], [73, 60, 30], [84, 52, 22], [47, 55, 20], [11, 59, 40]]) D("puddle", x * TS, y * TS + 4, (rng() * 2) | 0, w, 8 + rng() * 6);
  // the gate watch, and the corners people stand on
  spot("watch.n", "idle", 86.5 * TS, 30.5 * TS, "down"); spot("watch.s", "idle", 86.5 * TS, 32.9 * TS, "up");
  spot("idle.crown", "idle", 47.5 * TS, 45.6 * TS, "up"); spot("idle.lamp", "idle", 60.8 * TS, 28 * TS, "down"); spot("idle.lowwest", "idle", 23 * TS, 46.4 * TS, "right");

  // ---- trees and shade (by hand: each one is somebody's)
  for (const [x, y, v] of [[8, 34.4, 0], [7.4, 27.6, 2], [38.6, 7.4, 1], [54.6, 7.6, 0], [63.6, 6.8, 2], [72.6, 6.6, 1], [6.8, 40, 0], [7, 52, 2], [22.6, 62, 1], [61, 62, 0], [86.4, 62, 2], [87, 12, 1], [87.2, 45, 0], [57.6, 18.6, 2]] as const)
    Pt("towntree", x, y, { v });
  for (const p of props) if (p.kind === "towntree") { D("shade", p.x + 6, p.y - 12, 0, 48); D("roots", p.x - 4, p.y - 4, 0); }

  // ---- ground cover. Tiles under a hand-placed prop are left alone.
  const busy = new Uint8Array(k.n);
  for (const p of props) {
    const b = propDef(p.kind).box ?? [12, 6];
    for (let y = Math.floor((p.y - b[1] - 6) / TS); y <= Math.floor((p.y + 5) / TS); y++) for (let x = Math.floor((p.x - b[0] / 2 - 6) / TS); x <= Math.floor((p.x + b[0] / 2 + 5) / TS); x++) if (k.inb(x, y)) busy[I(x, y)] = 1;
  }
  for (const s of k.spots) busy[I(Math.floor(s.x / TS), Math.floor((s.y - 1) / TS))] = 1;
  const isGround = (s: number) => s === FS.GRASS || s === FS.MOSS || s === FS.DIRT || s === FS.EARTH || s === FS.MUD;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR) continue;
    const s = style[i], bx = x * TS, by = y * TS, r = rng();
    if (s === FS.GRASS || s === FS.MOSS) {
      if (r < 0.36) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9);
      else if (r < 0.42) D("flowers", bx + 8, by + 8, (rng() * 4) | 0);
      if (keep[i] || busy[i]) continue;
      // solid things keep clear of streets, of each other and of walls (their boxes must not reach into one)
      const q = rng(), free = [1, -1, W, -W].every((d) => grid[i + d] !== T.FLOOR || (!keep[i + d] && !busy[i + d])) && grid[i - 1] === T.FLOOR && grid[i + 1] === T.FLOOR;
      // the map just ends: nothing stands on its outermost ring, and nothing tall where its crown would run off the top
      const low = y >= 1 && x >= 1 && x <= W - 2, tall = low && y >= 3;
      const fringe = x < 9 || x > 86 || y < 8 || y > 60;
      // ...and nothing solid in the narrow strips outside the north and south walls, which it would cut into pockets
      if (free && (y < Wl.northY0 || y > Wl.southY1)) { if (low && q < 0.23) Pt(q < 0.2 ? "tallgrass" : "fern", x + (rng() - 0.5) * 0.5, y - rng() * 0.3, { v: (rng() * 3) | 0 }); continue; }
      if (free && tall && q < (fringe ? 0.07 : 0.012)) { Pt("towntree", x + (rng() - 0.5) * 0.4, y - rng() * 0.3, { v: (rng() * 3) | 0 }); busy[i] = 1; }
      else if (free && low && q < (fringe ? 0.16 : 0.05)) { Pt("bush", x + (rng() - 0.5) * 0.4, y - rng() * 0.3, { v: (rng() * 4) | 0 }); busy[i] = 1; }
      else if (low && q < 0.2) Pt("tallgrass", x + (rng() - 0.5) * 0.5, y - rng() * 0.3, { v: (rng() * 3) | 0 });
      else if (low && q < 0.23) Pt("fern", x + (rng() - 0.5) * 0.5, y - rng() * 0.3, { v: (rng() * 3) | 0 });
    } else if (isGround(s)) {
      if (r < 0.08) D("pebbles", bx + 8 + (rng() - 0.5) * 6, by + 8 + (rng() - 0.5) * 6);
      else if (r < 0.16 && s !== FS.MUD) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9);
    } else {
      // paving: grass creeping in wherever it meets bare ground, moss in the joints of the old cobbles
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = I(x + dx, y + dy);
        if (grid[j] !== T.FLOOR || !isGround(style[j]) || rng() > 0.6) continue;
        const ex = bx + 8 + dx * 7 + (dx ? 0 : (rng() - 0.5) * 12), ey = by + 9 + dy * 7 + (dy ? 0 : (rng() - 0.5) * 10);
        D(rng() < 0.2 ? "weeds" : "tuft", ex, ey);
      }
      if (s === FS.COBBLE && r < 0.05) D("mosspatch", bx + 8, by + 8, 1, 8 + rng() * 8);
    }
  }

  const rooms: Room[] = [
    { num: 1, name: "EAST GATE", x: 84, y: 29, w: 4, h: 5 }, { num: 2, name: "MARKET SQUARE", x: sq.x0, y: sq.y0, w: sq.x1 - sq.x0 + 1, h: sq.y1 - sq.y0 + 1 },
    { num: 3, name: "OLD QUARTER", x: 22, y: 9, w: 8, h: 6 }, { num: 4, name: "HIGH STREET", x: 62, y: 30, w: 20, h: 3 },
    { num: 5, name: "LOW STREET", x: 36, y: 45, w: 24, h: 3 }, { num: 6, name: "STONE YARD", x: 64, y: 49, w: 18, h: 9 },
    { num: 7, name: "BACK LANE", x: 24, y: 58, w: 30, h: 3 }, { num: 8, name: "WEST BAR", x: 6, y: 30, w: 4, h: 3 },
  ];
  // Ground decals first, buildings last: a house stands on the shade, moss, straw and wear around it, not under them.
  const decals = [...k.decals.filter((d) => d.kind !== "building"), ...k.decals.filter((d) => d.kind === "building")];
  return {
    id: TOWN_ID, w: W, h: H, grid, plan: grid.slice(), style, tvar: k.tvar, rooms, props, decals, lights: k.lights, loose: k.loose,
    start: { x: 85 * TS + 8, y: hs.y0 * TS + 28 }, exits: [{ x: W - 1, y: hs.y0 + 1, label: "THE OLD ROAD", dir: "e" }], drips: [],
    outdoor: true, tended: true, ambient: TOWN_AMBIENT, portals: k.portals, spots: [...k.spots, ...TOWN_FOLK_SPOTS],
  };
}
