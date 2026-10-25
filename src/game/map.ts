// The tutorial dungeon, as an area definition. Pure data builder (no DOM): the
// same seed always yields the same layout. Runtime state lives in world/area.ts.
import { mulberry } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import type { ItemId } from "./content/items";
import { propDef } from "./content/props";
import { socketPositions } from "./content/ritual";

export { TS, T, FS, isSolidT, isOpaqueT } from "./content/tiles";
export type { ItemId } from "./content/items";

/** Dungeon dimensions. Only this builder uses them; everything else reads area.w / area.h. */
export const MW = 72;
export const MH = 56;
export const DUNGEON_SEED = 1337;

export interface PropDef {
  /** Stable identity, used by saves and lights. Defaults to kind@tx,ty. */
  id: string;
  kind: string;
  x: number;
  y: number;
  v: number;
  lit?: boolean;
  item?: ItemId;
  itemZ?: number;
  container?: boolean;
}
export interface DecalDef { kind: string; x: number; y: number; v: number; w?: number; h?: number }
export interface LightDef {
  x: number; y: number; rad: number; col: [number, number, number]; int: number; flick: number; id?: string;
  /** Prop that emits this light; the light follows that prop's state. */
  owner?: string;
}
export interface Room { num: number; name: string; x: number; y: number; w: number; h: number }
export interface LooseItem { id: string; item: ItemId; x: number; y: number }
export interface Exit { x: number; y: number; label: string; dir: "n" | "s" | "e" | "w" }

/** Static definition of an area. Builders must be deterministic. */
export interface AreaData {
  id: string;
  w: number;
  h: number;
  grid: Uint8Array;
  plan: Uint8Array;
  style: Uint8Array;
  tvar: Uint8Array;
  rooms: Room[];
  props: PropDef[];
  decals: DecalDef[];
  lights: LightDef[];
  loose: LooseItem[];
  /** Translocation circle centre, if the area has one. */
  ritual: { x: number; y: number };
  start: { x: number; y: number };
  exits: Exit[];
  drips: { x: number; y: number }[];
}
/** @deprecated alias kept for art/schematic signatures */
export type MapData = AreaData;

export function buildDungeon(): AreaData {
  return buildMap(DUNGEON_SEED);
}

export function buildMap(seed: number): MapData {
  const rng = mulberry(seed);
  const grid = new Uint8Array(MW * MH);
  const style = new Uint8Array(MW * MH);
  const tvar = new Uint8Array(MW * MH);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH;
  const set = (x: number, y: number, t: number, s?: number) => {
    if (!inb(x, y)) return;
    grid[y * MW + x] = t;
    if (s !== undefined) style[y * MW + x] = s;
  };
  const rect = (x: number, y: number, w: number, h: number, t: number, s?: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t, s);
  };
  const rooms: Room[] = [];
  const room = (num: number, name: string, x: number, y: number, w: number, h: number, s: number) => {
    rect(x, y, w, h, T.FLOOR, s);
    rooms.push({ num, name, x, y, w, h });
  };

  // ---- Rooms ----
  room(1, "THRONE HALL", 26, 2, 20, 14, FS.MARBLE);
  room(2, "GREAT HALL", 29, 20, 14, 21, FS.MARBLE);
  room(3, "TRANSLOC. RM", 3, 3, 17, 13, FS.FLAG);
  room(4, "LIBRARY", 3, 20, 15, 11, FS.WOOD);
  room(5, "ARTIFICERY", 4, 36, 13, 10, FS.FLAG);
  room(6, "CHAPEL", 19, 47, 10, 7, FS.FLAG);
  room(7, "VESTIBULE", 31, 44, 10, 6, FS.MARBLE);
  room(8, "TREASURY", 52, 3, 8, 6, FS.MARBLE);
  room(9, "ARMORY", 62, 3, 7, 8, FS.FLAG);
  room(10, "BARRACKS", 53, 13, 16, 11, FS.WOOD);
  room(11, "GAOL", 53, 28, 16, 12, FS.COBBLE);
  room(12, "KITCHEN", 53, 43, 16, 8, FS.FLAG);

  // ---- Corridors ----
  const B = FS.BRICK;
  rect(21, 1, 2, 46, T.FLOOR, B);
  rect(20, 9, 1, 2, T.FLOOR, B);
  rect(18, 25, 3, 1, T.FLOOR, B);
  rect(17, 40, 4, 1, T.FLOOR, B);
  rect(23, 24, 6, 2, T.FLOOR, B);
  rect(23, 36, 6, 2, T.FLOOR, B);
  rect(49, 1, 2, 48, T.FLOOR, B);
  rect(43, 24, 6, 2, T.FLOOR, B);
  rect(43, 36, 6, 2, T.FLOOR, B);
  rect(46, 10, 3, 2, T.FLOOR, B);
  rect(51, 17, 2, 2, T.FLOOR, B);
  rect(65, 11, 2, 2, T.FLOOR, FS.FLAG);
  rect(51, 33, 2, 2, T.FLOOR, B);
  rect(51, 46, 2, 2, T.FLOOR, B);
  rect(35, 41, 2, 3, T.FLOOR, FS.MARBLE);
  rect(34, 50, 4, 5, T.FLOOR, FS.MARBLE);
  rect(29, 48, 2, 1, T.FLOOR, FS.FLAG);
  rect(34, 16, 4, 4, T.FLOOR, FS.MARBLE);
  rect(69, 46, 2, 2, T.FLOOR, FS.FLAG);
  set(51, 5, T.LOCKED, FS.MARBLE);

  // ---- Pillars ----
  for (const y of [22, 26, 30, 34, 38]) for (const x of [31, 40]) set(x, y, T.PILLAR);
  for (const y of [5, 8, 11, 14]) for (const x of [29, 42]) set(x, y, T.PILLAR);
  for (const [x, y] of [[40, 30], [31, 34], [42, 8], [29, 14]]) tvar[y * MW + x] = 1;

  // ---- Gaol cells ----
  for (let y = 28; y <= 39; y++) set(62, y, T.WALL);
  for (let x = 63; x <= 68; x++) { set(x, 31, T.WALL); set(x, 35, T.WALL); }
  set(62, 29, T.BARS);
  set(62, 37, T.BARS);
  set(62, 33, T.FLOOR, FS.COBBLE);

  const plan = grid.slice();

  // ---- Damage: collapses ----
  const R = T.RUBBLE;
  rect(21, 1, 2, 5, R);
  rect(49, 1, 2, 3, R);
  rect(34, 16, 4, 4, R);
  rect(44, 36, 3, 2, R);
  rect(34, 50, 4, 5, R);
  rect(69, 46, 2, 2, R);
  for (const [x, y] of [
    [43, 2], [44, 2], [45, 2], [44, 3], [45, 3], [45, 4], [43, 3],
    [26, 13], [26, 14], [27, 14], [26, 15], [27, 15], [28, 15],
    [3, 20], [4, 20], [3, 21],
    [68, 9], [68, 10], [67, 10],
    [68, 22], [68, 23], [67, 23],
    [34, 20], [37, 20],
    [49, 30], [22, 30],
    [33, 49], [38, 49],
    [27, 53], [28, 53],
  ]) set(x, y, R);
  set(47, 10, T.CRACKED);
  set(47, 11, T.CRACKED);

  // ---- Props ----
  const props: PropDef[] = [];
  const lights: LightDef[] = [];
  const decals: DecalDef[] = [];
  const loose: LooseItem[] = [];
  const drips: { x: number; y: number }[] = [];
  const px = (tx: number) => tx * TS + 8;
  const py = (ty: number) => ty * TS + 16;
  const ids = new Set<string>();
  const P = (kind: string, tx: number, ty: number, o: Partial<PropDef> = {}) => {
    let id = o.id ?? `${kind}@${tx},${ty}`;
    for (let n = 2; ids.has(id); n++) id = `${kind}@${tx},${ty}#${n}`;
    ids.add(id);
    const p: PropDef = { kind, x: px(tx), y: py(ty), v: 0, ...o, id };
    props.push(p);
    const L = propDef(kind).light;
    if (L && (L.when === "always" || p.lit)) lights.push({ x: p.x + L.dx, y: p.y + L.dy, rad: L.rad, col: L.col, int: L.int, flick: L.flick, owner: id });
    return p;
  };
  const D = (kind: string, x: number, y: number, v = 0, w?: number, h?: number) => decals.push({ kind, x, y, v, w, h });

  // Throne hall
  D("dais", 33 * TS, 2 * TS, 0, 6 * TS, 3 * TS);
  D("carpet", 35 * TS, 5 * TS, 0, 2 * TS, 11 * TS);
  D("carpet", 35 * TS, 20 * TS, 1, 2 * TS, 21 * TS);
  P("throne", 35.5, 3);
  P("maptable", 39.5, 5, { item: "schematic", itemZ: 12 });
  P("statue", 32, 3);
  P("statue", 39, 3, { v: 1 });
  P("statue_fallen", 27.5, 8);
  for (const x of [27, 31, 40]) P("banner", x, 1, { v: x % 3 });
  P("brazier", 33, 12);
  P("brazier", 38, 12, { v: 1 });
  loose.push({ id: "crown", item: "crown", x: 33 * TS + 2, y: 6 * TS + 4 });
  lights.push({ x: 31 * TS, y: 10 * TS, rad: 84, col: [0.55, 0.68, 1], int: 1.0, flick: 0.02, id: "moon" });
  lights.push({ x: 46 * TS + 8, y: 10 * TS + 16, rad: 30, col: [0.55, 0.68, 1], int: 0.35, flick: 0.02 });
  for (let i = 0; i < 14; i++) D("debris", 31 * TS + (rng() - 0.5) * 48, 10 * TS + (rng() - 0.5) * 40, (rng() * 4) | 0);
  D("bones", 41 * TS, 12 * TS, 0);

  // Great hall
  P("statue", 29, 28);
  P("statue", 29, 32, { v: 1 });
  P("statue", 42, 28);
  P("statue", 42, 32);
  P("brazier", 33, 23, { lit: true });
  P("brazier", 38, 23);
  P("brazier", 33, 39);
  P("brazier", 38, 39, { lit: true });
  P("banner", 30, 19, { v: 1 });
  P("banner", 41, 19, { v: 2 });
  P("statue_fallen", 36, 31);
  for (let i = 0; i < 10; i++) D("debris", 35.5 * TS + (rng() - 0.5) * 64, 21 * TS + rng() * 20, (rng() * 4) | 0);

  // Vestibule
  P("fountain", 35.5, 46);
  P("statue", 32, 45);
  P("statue_fallen", 38.5, 45, { v: 1 });
  P("torch", 33, 43, { lit: true });
  P("torch", 38, 43);
  for (let i = 0; i < 12; i++) D("debris", 35.5 * TS + (rng() - 0.5) * 90, 49 * TS + rng() * 14, (rng() * 4) | 0);

  // Chapel
  P("altar", 26, 48, { item: "glyph3", itemZ: 13 });
  lights.push({ x: 26 * TS + 8, y: 48 * TS + 8, rad: 58, col: [1, 0.7, 0.4], int: 0.6, flick: 0.15 });
  P("pew", 24.5, 50);
  P("pew", 24.5, 52);
  P("statue", 19.5, 52, { v: 1 });
  P("banner", 23, 46, { v: 0 });
  P("candles", 20, 49);

  // Artificery (start)
  P("cradle", 9, 37);
  P("forge", 5.5, 37);
  lights.push({ x: 5.5 * TS + 8, y: 37 * TS + 8, rad: 46, col: [1, 0.42, 0.18], int: 0.6, flick: 0.3 });
  P("workbench", 13.5, 37, { item: "chisel", itemZ: 12 });
  P("anvil", 6, 40);
  P("slab", 12.5, 43);
  P("parts", 15, 41);
  P("barrel", 15, 45);
  P("crate", 16, 44);
  P("crate", 16, 45, { v: 1 });
  P("bookshelf", 16, 36, { v: 1 });
  for (let i = 0; i < 6; i++) D("paper", 11 * TS + rng() * 64, 38 * TS + rng() * 40, (rng() * 3) | 0);
  D("scorch", 5.5 * TS, 38 * TS + 4, 0);

  // Library
  for (const x of [5, 6, 7, 9, 10, 11, 13, 14, 15, 16, 17]) P("bookshelf", x, 20, { v: x % 2 ? 0 : 2 });
  for (const x of [5, 6, 7, 8, 11, 12, 13, 14]) P("shelfrow", x, 23, { v: x % 3 });
  for (const x of [5, 6, 11, 12, 14]) P("shelfrow", x, 26, { v: (x + 1) % 3 });
  P("shelf_fallen", 8, 27);
  P("table", 11, 29, { v: 1 });
  P("chair_fallen", 12.5, 29.2);
  P("lectern", 5, 29, { item: "glyph1", itemZ: 12 });
  P("mushrooms", 3, 30);
  D("puddle", 4 * TS, 27 * TS + 6, 0, 40, 18);
  D("puddle", 6 * TS + 6, 29 * TS + 4, 1, 30, 12);
  drips.push({ x: 5 * TS, y: 28 * TS }, { x: 7 * TS, y: 29 * TS + 8 });
  for (let i = 0; i < 18; i++) D("books", 4 * TS + rng() * 13 * TS, 21 * TS + rng() * 9 * TS, (rng() * 4) | 0);

  // Translocation room
  const ritual = { x: 11 * TS + 8, y: 9 * TS + 8 };
  P("torch", 7, 2, { lit: true });
  P("torch", 15, 2);
  P("candles", 6, 6);
  P("candles", 16, 13, { v: 1 });
  P("candles", 6, 13);
  P("ladder", 17, 6);
  P("bucket", 16, 4);
  P("skeleton", 18, 14, { v: 1 });
  lights.push({ x: ritual.x, y: ritual.y, rad: 70, col: [0.6, 0.38, 1], int: 0.28, flick: 0.06, id: "circle" });
  for (let i = 0; i < 10; i++) D("chalk", 5 * TS + rng() * 12 * TS, 4 * TS + rng() * 10 * TS, (rng() * 3) | 0);

  // Treasury
  P("chest", 57, 4, { container: true, item: "core" });
  P("chest", 54, 4, { v: 2 });
  P("pot", 59, 8);
  P("pot", 52, 8, { v: 1 });
  loose.push({ id: "coin", item: "coin", x: 55 * TS + 8, y: 7 * TS + 8 });
  for (let i = 0; i < 12; i++) D("coins", 52 * TS + rng() * 8 * TS, 3 * TS + rng() * 6 * TS, (rng() * 3) | 0);

  // Armory
  P("limbrack", 65.5, 3, { item: "arm", itemZ: 10 });
  P("weaponrack", 63, 3);
  P("armorstand", 63, 7);
  P("armorstand", 67.5, 6, { v: 1 });
  lights.push({ x: 63 * TS, y: 9 * TS, rad: 40, col: [0.55, 0.65, 0.95], int: 0.4, flick: 0.02 });
  for (let i = 0; i < 6; i++) D("weapon", 62 * TS + rng() * 7 * TS, 4 * TS + rng() * 6 * TS, (rng() * 3) | 0);

  // Barracks
  for (const x of [54, 57, 60, 63, 68]) P("bed", x, 14, { v: x % 2 });
  for (const x of [54, 57, 60, 63]) P("bed", x, 23, { v: (x + 1) % 2 });
  P("footlocker", 54, 15, { container: true });
  P("footlocker", 60, 15, { container: true });
  P("footlocker", 57, 21, { container: true });
  P("footlocker", 63, 21, { container: true, item: "glyph2" });
  P("table", 60.5, 18);
  P("chair", 58.6, 18);
  P("chair_fallen", 62.5, 19);
  P("torch", 57, 12, { lit: true });

  // Gaol
  P("skeleton", 65, 28, { v: 2 });
  P("skeleton", 66, 32, { container: true, item: "key" });
  P("skeleton", 64, 36, { v: 2 });
  P("mushrooms", 67, 39);
  P("table", 56, 30);
  P("chair", 57.6, 30.6);
  P("chains", 55, 27);
  P("chains", 59, 27);
  P("torch", 57, 27, { lit: true });
  P("barrel", 53, 39);
  P("bucket", 60, 38);
  P("brazier", 58, 35);
  D("bars_broken", 62 * TS, 33 * TS, 0);
  D("puddle", 55 * TS, 36 * TS, 0, 34, 14);
  drips.push({ x: 56 * TS, y: 36 * TS + 6 });
  for (let i = 0; i < 6; i++) D("bones", 53 * TS + rng() * 15 * TS, 28 * TS + rng() * 11 * TS, (rng() * 3) | 0);

  // Kitchen
  P("hearth", 60.5, 43, { container: true, item: "glyph0" });
  lights.push({ x: 60.5 * TS + 8, y: 43 * TS + 10, rad: 52, col: [1, 0.48, 0.22], int: 0.5, flick: 0.25 });
  P("longtable", 59.5, 47, { item: "goblet", itemZ: 9 });
  P("bench", 59.5, 45);
  P("bench", 59.5, 48);
  P("barrel", 53, 43);
  P("barrel", 54, 43, { v: 1 });
  P("crate", 67, 49);
  P("crate", 68, 50, { v: 1 });
  P("sack", 66, 50);
  P("sack", 53, 50);
  P("pot", 56, 43);
  P("bookshelf", 65, 43, { v: 3 });

  // Corridors
  for (const [x, y] of [[21, 15], [22, 33], [50, 9], [49, 27], [50, 42], [22, 44]]) P("mushrooms", x, y);
  P("torch", 26, 23, { lit: true });
  P("torch", 46, 23);
  P("torch", 25, 35);
  D("puddle", 21 * TS, 20 * TS, 1, 28, 12);
  drips.push({ x: 21 * TS + 10, y: 20 * TS + 6 });
  D("puddle", 49 * TS + 4, 38 * TS, 0, 26, 16);
  drips.push({ x: 49 * TS + 16, y: 38 * TS + 8 });

  // ---- Procedural decals ----
  const G = (x: number, y: number) => (inb(x, y) ? grid[y * MW + x] : T.WALL);
  for (let y = 1; y < MH - 1; y++)
    for (let x = 1; x < MW - 1; x++) {
      const t = G(x, y);
      if (t !== T.FLOOR) continue;
      const bx = x * TS, by = y * TS;
      const r = rng();
      const nearRubble = [G(x - 1, y), G(x + 1, y), G(x, y - 1), G(x, y + 1)].some((n) => n === T.RUBBLE || n === T.CRACKED);
      if (nearRubble) for (let k = 0; k < 3; k++) D("debris", bx + rng() * 16, by + rng() * 16, (rng() * 4) | 0);
      if (r < 0.07) D("crack", bx + rng() * 8, by + rng() * 8, (rng() * 4) | 0);
      else if (r < 0.12) D("debris", bx + rng() * 14, by + rng() * 14, (rng() * 4) | 0);
      else if (r < 0.13) D("bones", bx + 4, by + 6, (rng() * 3) | 0);
      if (G(x, y - 1) === T.WALL && G(x - 1, y) === T.WALL && rng() < 0.6) D("cobweb", bx, by, 0);
      if (G(x, y - 1) === T.WALL && G(x + 1, y) === T.WALL && rng() < 0.6) D("cobweb", bx, by, 1);
      const wallN = G(x - 1, y) === T.WALL || G(x + 1, y) === T.WALL || G(x, y - 1) === T.WALL;
      if (wallN && rng() < 0.12) D("moss", bx + rng() * 8, by + rng() * 8, (rng() * 3) | 0);
    }

  // ---- Ritual pedestals (one per socket; appended last so draw order is unchanged) ----
  socketPositions(ritual).forEach((s, i) => {
    const id = "ped" + i;
    ids.add(id);
    props.push({ id, kind: "pedestal", x: s.x, y: s.y + 4, v: 0 });
  });

  return {
    id: "dungeon", w: MW, h: MH,
    grid, plan, style, tvar, rooms, props, decals, lights, loose, ritual, drips,
    start: { x: 9 * TS + 8, y: 38 * TS + 14 },
    exits: [
      { x: 22, y: 1, label: "UPPER WARD", dir: "n" },
      { x: 50, y: 1, label: "TOWER", dir: "n" },
      { x: 36, y: 55, label: "SURFACE GATE", dir: "s" },
      { x: 71, y: 47, label: "CELLARS", dir: "e" },
    ],
  };
}
