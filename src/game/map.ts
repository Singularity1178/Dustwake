// The tutorial dungeon, as an area definition. Pure data builder (no DOM): the
// same seed always yields the same layout. Runtime state lives in world/area.ts.
import { mulberry } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import type { ItemId } from "./content/items";
import type { Slot } from "./content/inventory";
import { propDef } from "./content/props";
import { socketPositions } from "./content/ritual";
import { GATE_CORRIDOR, GATE_EXIT, GATE_HALL, GATE_PASSAGE, GATE_STAIR, STAIR_CHEEK, STAIR_CHEEK_TOP, ENTRANCES } from "./content/geography";

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
  /** Starts open (e.g. a chest looted long ago). Uses the prop's alternate "open" sprite. */
  open?: boolean;
  /** A name the player gave it (storage chests). Absent: it goes by its default label, e.g. "DUNGEON CHEST 2" (sim/orders.ts: propName). */
  name?: string;
  /** Built props: the recipe that built it. */
  recipe?: string;
  /**
   * Built props: what it cost when it was built, which is what taking it apart
   * gives back, so a later rebalance of the recipe never changes the refund of a
   * prop that already stands (saves migrated from before this field get it too).
   */
  refund?: { item: ItemId; n: number }[];
  /** Optional authored storage contents. Runtime copies these into its own slots. */
  inventory?: Slot[];
}
export interface DecalDef { kind: string; x: number; y: number; v: number; w?: number; h?: number }
export interface LightDef {
  x: number; y: number; rad: number; col: [number, number, number]; int: number; flick: number; id?: string;
  /** Prop that emits this light; the light follows that prop's state. */
  owner?: string;
  /** Sky light reaching in (a roof crack, a doorway): moonlight by night, a sunbeam by day (content/daycycle.ts: skyLight). */
  sky?: boolean;
}
export interface Room { num: number; name: string; x: number; y: number; w: number; h: number }
export interface LooseItem { id: string; item: ItemId; x: number; y: number; /** Stack size (default 1). */ n?: number }
/** An NPC placed by an area builder. Becomes an Actor (kind "npc") the first time the area is instantiated. */
export interface NpcSpawn { id: string; npc: string; x: number; y: number; facing?: "down" | "up" | "left" | "right" }
export interface Exit { x: number; y: number; label: string; dir: "n" | "s" | "e" | "w" }
/**
 * A walk-through connection to another area: a road running off the map, a
 * shop door, the way back out (sim/portals.ts). An actor whose feet are inside
 * the box (px) and who pushes `dir` comes out of portal `to.portal` in area
 * `to.area`. Pairs are declared on both sides.
 */
export interface Portal {
  id: string;
  x: number; y: number; w: number; h: number;
  dir: "up" | "down" | "left" | "right";
  to: { area: string; portal: string };
  /** Where someone coming out of this portal stands (px). Default: the middle of the box. They face away from `dir`. */
  arrive?: { x: number; y: number };
  /** A door (latch sound) rather than open road. */
  door?: boolean;
  /** A world flag that must be set before anyone can pass (an entrance that has to be opened first: content/geography.ts). */
  flag?: string;
  /** Shown as a note when someone arrives through this portal: the name of the place they are now in. */
  label?: string;
}
/**
 * A named standing place, laid out with the area and checked by the tests
 * (free, reachable), for the systems that come later: where a shopkeeper
 * stands behind the counter, where a customer faces them, a tavern seat, a
 * market pitch, a street corner people idle on. Nothing reads these yet.
 */
export interface Spot {
  id: string;
  kind: "keeper" | "customer" | "seat" | "stall" | "idle" | "work" | "door";
  x: number; y: number;
  facing: "down" | "up" | "left" | "right";
}

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
  ritual?: { x: number; y: number };
  /** Open sky: no cave rumble/drips; `ambient` light instead of the dungeon's darkness. */
  outdoor?: boolean;
  /** A lived-in room under a roof: neither the dungeon's rumble and falling grit nor the open sky's leaves and fireflies. */
  interior?: boolean;
  /** People live here and keep the lights: props with a `habit` (content/props.ts) are lit and put out with the day. */
  tended?: boolean;
  /** The area's light with no sun in it: its night under the open sky (content/daycycle.ts adds the day), or simply its light underground. */
  ambient?: [number, number, number];
  /** Roads and doorways into other areas (sim/portals.ts). */
  portals?: Portal[];
  /** Standing places for future shopkeepers and townsfolk (data only). */
  spots?: Spot[];
  /** NPCs that live here (spawned as actors on first visit; saved as actors afterwards). */
  npcs?: NpcSpawn[];
  start: { x: number; y: number };
  exits: Exit[];
  drips: { x: number; y: number }[];
}
/** @deprecated alias kept for art/schematic signatures */
export type MapData = AreaData;

/** The dormant worker golem's spawn row (stable id; a save migration places the same one). */
export const ARTIFICERY_WORKER = { id: "npc.worker.artificery", npc: "worker_golem", x: 7 * TS + 13, y: 37 * TS + 14 } as const;

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
  // The way up to the surface (content/geography.ts): the halls are the first cellar floor. A short flagged hall
  // leaves the Vestibule to the south, and from its end the stair climbs south to the buried stair head above.
  // As built it is open: hall, then steps all the way.
  rect(GATE_HALL.x, GATE_HALL.y, GATE_HALL.w, GATE_HALL.h, T.FLOOR, FS.FLAG);
  rect(GATE_STAIR.x, GATE_STAIR.y, GATE_STAIR.w, GATE_STAIR.h, T.FLOOR, FS.STAIR);
  rect(29, 48, 2, 1, T.FLOOR, FS.FLAG);
  rect(34, 16, 4, 4, T.FLOOR, FS.MARBLE);
  rect(69, 46, 2, 2, T.FLOOR, FS.FLAG);
  set(51, 5, T.LOCKED, FS.MARBLE);

  // ---- Pillars ----
  for (const y of [22, 26, 30, 34, 38]) for (const x of [31, 40]) set(x, y, T.PILLAR);
  // The throne hall's colonnade stands a pillar every fourth row, like the great hall's. A pillar is drawn
  // three tiles tall, so any closer (they used to stand every third) and each base sits on the capital of
  // the pillar in front of it: one unbroken stack instead of a row of columns.
  for (const y of [5, 9, 13]) for (const x of [29, 42]) set(x, y, T.PILLAR);
  for (const [x, y] of [[40, 30], [31, 34], [42, 9], [29, 13]]) tvar[y * MW + x] = 1;

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
  // the way up to the surface: the vault came down into it, and hall and stair are choked with rock and earth
  // from the Vestibule's wall to the top (the flags and the steps are still there under the fall: digging it out
  // from above clears them)
  rect(GATE_PASSAGE.x, GATE_PASSAGE.y, GATE_PASSAGE.w, GATE_PASSAGE.h, R);
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
  // the sky through the broken roof: moonlight as authored, a sunbeam by day (`sky`)
  lights.push({ x: 31 * TS, y: 10 * TS, rad: 84, col: [0.55, 0.68, 1], int: 1.0, flick: 0.02, id: "moon", sky: true });
  lights.push({ x: 46 * TS + 8, y: 10 * TS + 16, rad: 30, col: [0.55, 0.68, 1], int: 0.35, flick: 0.02, sky: true });
  for (let i = 0; i < 14; i++) D("debris", 31 * TS + (rng() - 0.5) * 48, 10 * TS + (rng() - 0.5) * 40, (rng() * 4) | 0);
  D("bones", 41 * TS, 12 * TS, 0);

  // Great hall
  // (the four statues stand two pixels clear of the side walls: at the tile's centre their plinths were in the
  // masonry. Their ids are the ones they have always had.)
  P("statue", 29.125, 28, { id: "statue@29,28" });
  P("statue", 29.125, 32, { id: "statue@29,32", v: 1 });
  P("statue", 41.875, 28, { id: "statue@42,28" });
  P("statue", 41.875, 32, { id: "statue@42,32" });
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
  // One axis: the banner on the wall, the altar under it, the pews facing them. (The altar used to stand a
  // tile and a half to the east of its pews, against the side door, and the banner a tile and a half to the
  // west. Both keep the ids they had, which saves and the tests know them by.)
  P("altar", 24.5, 48, { id: "altar@26,48", item: "glyph3", itemZ: 13 });
  lights.push({ x: 24.5 * TS + 8, y: 48 * TS + 8, rad: 58, col: [1, 0.7, 0.4], int: 0.6, flick: 0.15 });
  P("pew", 24.5, 50);
  P("pew", 24.5, 52);
  P("statue", 19.5, 52, { v: 1 });
  P("banner", 24.5, 46, { id: "banner@23,46", v: 0 });
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
  P("table", 11, 29, { v: 1, item: "book_build", itemZ: 11 });
  P("chair_fallen", 12.5, 29.2);
  P("lectern", 5, 29, { item: "glyph1", itemZ: 12 });
  loose.push({ id: "book_repair", item: "book_repair", x: 9 * TS + 4, y: 28 * TS + 12 });
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

  // Treasury: looted long ago. The aether core, the last thing it held, is
  // with its guardian (an NPC actor, spawned from `npcs` below).
  P("chest", 57, 4, { open: true });
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
  // the south row lies head to the south wall (bed v bit 1), so its footlockers stand at the foot like the north row's
  for (const x of [54, 57, 60, 63]) P("bed", x, 23, { v: 2 + ((x + 1) % 2) });
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
  // The scatter draws from one rng in reading order, so a tile that starts or stops being floor would re-roll
  // every crack, bone and cobweb after it. The throne hall's pillars were re-spaced after the scatter was
  // settled: the pass still walks those ten tiles as they lay before (the rows the pillars left get nothing,
  // the rows they moved to keep what they had, under the pillar), and the rest of the dungeon stays as it was.
  const key = (x: number, y: number) => y * MW + x;
  const wasPillar = new Set([5, 8, 11, 14].flatMap((y) => [key(29, y), key(42, y)]));
  const nowPillar = new Set([5, 9, 13].flatMap((y) => [key(29, y), key(42, y)]));
  for (let y = 1; y < MH - 1; y++)
    for (let x = 1; x < MW - 1; x++) {
      const t = G(x, y);
      const k = key(x, y);
      if (wasPillar.has(k) || (t !== T.FLOOR && !(nowPillar.has(k) && !wasPillar.has(k)))) continue;
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
  // The circle as a node of the rune network (content/runes.ts). No sprite, no collision.
  props.push({ id: "rune.dungeon", kind: "runesite", x: ritual.x, y: ritual.y, v: 0 });

  // ---- The choked SURFACE STAIR (added after the procedural pass, with its
  // own rng, so nothing else in the dungeon changes). Hall and flight are
  // heaped with boulders and fallen vault; rubble and spilled earth reach a
  // few tiles into the Vestibule; roots force their way through the broken
  // roof. No step shows from the Vestibule: where the hall opens into it there
  // is only the earth that poured in, and the toe of the fall lying on it
  // (`stairfall`, which says what lies behind). The earth stays when the
  // stair is dug out, trodden along the hall to the foot of the flight, so
  // the Vestibule's floor, the dirt and the first step are met in that order.
  // The flight stands between two cheek walls that end in a newel post each
  // (`stairpost`, `staircheek`: content/geography.ts STAIR_CHEEK). No night
  // air comes through: the daylight down the stair (`stairlight`) only burns
  // once it is dug out.
  {
    const gr = mulberry(seed ^ 0x6a7e);
    const C = GATE_CORRIDOR;
    for (const x of [C.x, C.x + C.w - 1]) set(x, C.y - 1, R, FS.EARTH);
    const cx = (C.x + C.w / 2) * TS, top = C.y * TS;
    D("earthspill", cx, top - 10, 0, 76, 44);
    D("earthspill", cx - 20, top - 30, 1, 34, 20);
    D("earthspill", cx + 18, top - 26, 2, 30, 18);
    for (let i = 0; i < 16; i++) D("stones", cx + (gr() - 0.5) * 120, top - 6 - gr() * 52, (gr() * 4) | 0);
    for (let i = 0; i < 10; i++) D("debris", cx + (gr() - 0.5) * 100, top - 4 - gr() * 44, (gr() * 4) | 0);
    // (roots trail up to 22 px down from where they are placed: every one starts high enough to stay on the
    // Vestibule's floor or the gate's rubble, and none runs out across the top of the south wall)
    for (const [x, y, v] of [[C.x - 1.6, C.y - 1.5, 0], [C.x - 0.4, C.y - 1.45, 1], [C.x + C.w + 0.3, C.y - 1.5, 1], [C.x + C.w - 0.8, C.y - 1.2, 0], [C.x + 1.4, C.y - 2.2, 1]] as const)
      D("rootfall", x * TS, y * TS, v);
    for (let i = 0; i < 5; i++) D("roots", cx + (gr() - 0.5) * 70, top - 18 - gr() * 20, 0);
    const piles: [number, number, number][] = [
      [C.x + 0.3, C.y, 0], [C.x + 2.6, C.y + 0.2, 1], [C.x + 1.5, C.y + 1, 2], [C.x + 0.2, C.y + 2, 1], [C.x + 3, C.y + 2.4, 0],
      [C.x + 1.6, C.y + 3.2, 2], [C.x + 0.5, C.y + 4, 0], [C.x + 2.8, C.y + 4.2, 1], [C.x - 0.5, C.y - 1.9, 1], [C.x + C.w - 0.1, C.y - 1.8, 2],
    ];
    for (const [x, y, v] of piles) P("rockpile", x, y, { v });
    for (const [id, kind, y] of [["stairfall", "stairfall", top + 2], ["stairlight", "stairlight", top + 3 * TS]] as const) {
      ids.add(id);
      props.push({ id, kind, x: cx, y, v: 0 });
    }
    // earth where the hall opens (the stair's foot used to be drawn out here; it is dirt now) and along the hall,
    // thinning toward the flight, with the last crumbs of it on the first step
    D("earthspill", cx - 4, top - 13, 3, 50, 30);
    D("earthspill", cx + 2, top + 7, 4, 58, 24);
    D("earthspill", cx - 11, top + 22, 5, 24, 12);
    D("earthspill", cx + 14, top + GATE_HALL.h * TS - 2, 6, 14, 8);
    for (const [x, y, v] of [[cx - 17, top + 9, 1], [cx + 15, top + 21, 2], [cx + 4, top + 5, 0], [cx - 12, top + GATE_HALL.h * TS - 9, 3]] as const) D("stones", x, y, v);
    // the stair's stonework: a newel post at the foot of each cheek wall (the east one broken off short), standing
    // in the hall with its feet on the flight's north edge, not down on the first step, and the cheek walls'
    // footprints up both sides of the flight from there
    const S = GATE_STAIR, K = STAIR_CHEEK, sy = S.y * TS;
    for (const [side, x0, dir, v] of [["w", S.x * TS, 1, 0], ["e", (S.x + S.w) * TS, -1, 1]] as const) {
      ids.add("stairpost." + side); ids.add("staircheek." + side);
      props.push({ id: "stairpost." + side, kind: "stairpost", x: x0 + (dir * K.post.w) / 2, y: sy + STAIR_CHEEK_TOP, v });
      props.push({ id: "staircheek." + side, kind: "staircheek", x: x0 + (dir * K.wall.w) / 2, y: (S.y + S.h) * TS, v });
    }
    // the sky down the open stair (moonlight, or the sun by day): owned by `stairlight`, so dark until that is lit
    lights.push({ x: cx, y: top + 4 * TS, rad: 120, col: [0.55, 0.68, 1], int: 0.9, flick: 0.02, id: "gateleak", owner: "stairlight", sky: true });
  }

  // ---- The artificery and the armory, redone (fixed places, no rng, appended: no id, light or scatter above moves).
  // Artificery: the workshop where tools, runes and golems were made. Round the smelter its coal bin (and the coal
  // shovel's head, rusted through, on the floor beside it) and by the anvil a quench trough; a tool board on the
  // north wall with little left on it; in the south a rune-cutter's table whose last stone still glows, the slip
  // vat the worker bodies were cast from, and by it one unfinished body still on its casting stand.
  P("coalbin", 4, 37);
  P("quench", 4.5, 40);
  P("toolboard", 11.5, 35);
  P("runetable", 7.5, 45);
  P("clayvat", 4.25, 45);
  P("husk", 4.5, 42);
  loose.push({ id: "rusted_shovel", item: "head_shovel_rusted", x: 4 * TS + 14, y: 38 * TS + 12 });
  D("chalk", 6 * TS + 4, 44 * TS + 2, 1);
  D("chalk", 9 * TS + 6, 44 * TS + 8, 2);
  D("scorch", 6 * TS - 2, 41 * TS, 0);
  D("paper", 8 * TS + 4, 44 * TS + 6, 1);
  // Armory: it held racks of blades, rows of harness and the wardens' staves. Time took most of it: a second
  // rack stands all but empty, the pegs on the wall hold one sword, the staff rack one dead staff, a bare stand
  // waits in the corner, and what fell has rusted into a heap. One old axe head is still worth mending.
  P("wallhooks", 67.75, 2, { v: 1 });
  P("weaponrack", 67.25, 4.25, { v: 1 });
  P("staffrack", 62.75, 5.5);
  P("armorstand", 62.5, 9.5, { v: 2 });
  P("armorpile", 66.75, 8);
  loose.push({ id: "rusted_axe", item: "head_axe_rusted", x: 64 * TS + 10, y: 6 * TS + 8 });
  D("weapon", 65 * TS + 2, 8 * TS + 6, 1);
  D("weapon", 63 * TS + 9, 9 * TS + 2, 2);

  // ---- NPCs (no rng, no props: nothing above changes). The Treasury Guardian
  // slumps against the treasury's north wall between the two looted chests,
  // facing the door; its body box (content/npcs.ts) keeps rows 5-8 and the
  // doorway at 51,5 clear. A dormant worker golem (no NPCS row, so no dialogue:
  // its `npc` names its actor definition) is parked in the artificery's alcove
  // between the forge and the cradle, against the north wall, facing the room.
  // Its 8x4 box leaves row 38 (start, cradle, forge, workbench) and the exit
  // corridor at 17,40 open (tests/rollout.test.ts checks the routes).
  const npcs: NpcSpawn[] = [
    { id: "npc.guardian", npc: "guardian", x: 55.5 * TS + 8, y: 4 * TS + 10, facing: "down" },
    { id: ARTIFICERY_WORKER.id, npc: ARTIFICERY_WORKER.npc, x: ARTIFICERY_WORKER.x, y: ARTIFICERY_WORKER.y, facing: "down" },
  ];

  return {
    id: "dungeon", w: MW, h: MH,
    grid, plan, style, tvar, rooms, props, decals, lights, loose, ritual, drips, npcs,
    // The stair's upper end: walk south off the top of the flight and you come out of the stair head on the surface
    // (and back). Shut until the stair is dug out. The spot (in the Vestibule, where the hall to the stair opens)
    // is for whoever finds the way in later.
    portals: [{
      id: ENTRANCES.surface_stair.below.portal, x: GATE_STAIR.x * TS + 2, y: (GATE_STAIR.y + GATE_STAIR.h) * TS - 10, w: GATE_STAIR.w * TS - 4, h: 10, dir: "down",
      to: { area: ENTRANCES.surface_stair.above.area, portal: ENTRANCES.surface_stair.above.portal },
      arrive: { x: (GATE_STAIR.x + GATE_STAIR.w / 2) * TS, y: (GATE_STAIR.y + GATE_STAIR.h) * TS - 14 },
      flag: ENTRANCES.surface_stair.flag, label: "THE HALLS: FIRST CELLAR",
    }],
    spots: [{ id: "stairfoot", kind: "door", x: (GATE_PASSAGE.x + GATE_PASSAGE.w / 2) * TS, y: GATE_PASSAGE.y * TS - 4, facing: "up" }],
    start: { x: 9 * TS + 8, y: 38 * TS + 14 },
    exits: [
      { x: 22, y: 1, label: "UPPER WARD", dir: "n" },
      { x: 50, y: 1, label: "TOWER", dir: "n" },
      { x: GATE_EXIT.x, y: GATE_EXIT.y, label: "SURFACE STAIR", dir: "s" },
      { x: 71, y: 47, label: "CELLARS", dir: "e" },
    ],
  };
}
