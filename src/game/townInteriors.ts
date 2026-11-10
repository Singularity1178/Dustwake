// The rooms behind Westwake's six shop doors, as area definitions: one small
// area per establishment (so "which shop am I in" is just the area id). Pure,
// deterministic builders (no DOM, no rng): every piece is placed by hand.
//
// Each room sits in the middle of an area of solid wall big enough for the
// widest zoom, so the camera never runs off the edge. One row of wall face
// shows above the floor, in that house's own material; the way out is a gap in
// the south wall, paired with the building's door in the town.
//
// How the rooms are lit says who shops there (content/town.ts: HIGH_END): the
// armoury, the jeweller, the tailor and the Guild hang light runes, steady and
// blue-white; the smithy and the tavern burn fire, and the corners stay dark.
//
// Laid out for the people who will work here (nobody does yet): every counter
// runs east-west with a way round one end, a `keeper` spot behind it and a
// `customer` spot in front; every stool has a `seat` spot; the middle of each
// floor and the line from the door to the counter are kept clear.
import { TS, T, FS, WS } from "./content/tiles";
import { ESTABLISHMENTS, HIGH_END, TOWN_ID, building, interiorId, type Establishment } from "./content/town";
import { areaKit } from "./town";
import type { AreaData, PropDef, Spot } from "./map";

/** Every interior area is this size (tiles): at least the 2x zoom's view (40 x 22.5). */
export const INTERIOR_W = 44, INTERIOR_H = 26;

interface RoomSpec {
  /** Floor size (tiles). */
  w: number; h: number;
  floor: number; wall: number;
  /** The way out: first column of the gap in the south wall, and how many tiles wide it is. */
  door: number; doorW: number;
  dress: (r: Room) => void;
}
/** What a room's `dress` function gets: placement in room coordinates (tile 0,0 is the floor's north-west corner). */
interface Room {
  /** A prop standing on tile (cx, cy): centred on it, its foot on the tile's bottom edge. Row -1 is the north wall (wall-mounted things). */
  Q: (kind: string, cx: number, cy: number, o?: Partial<PropDef>) => PropDef;
  /** A decal at room pixel coordinates (tile * 16). */
  D: (kind: string, cx: number, cy: number, v?: number, w?: number, h?: number) => void;
  /** A standing place for whoever works or drinks here later (centre of tile cx, cy). */
  spot: (id: string, kind: Spot["kind"], cx: number, cy: number, facing: Spot["facing"]) => void;
  /** A stool with the place to sit at it. */
  seat: (id: string, cx: number, cy: number) => void;
  /** A shop counter, with the keeper's place behind it and the customer's in front. */
  counter: (cx: number, cy: number, v: number) => void;
  w: number; h: number;
}

function buildRoom(e: Establishment, s: RoomSpec): AreaData {
  const k = areaKit(INTERIOR_W, INTERIOR_H);
  const rx = (INTERIOR_W - s.w) >> 1, ry = (INTERIOR_H - s.h) >> 1, b = building(e), rich = HIGH_END[e];
  k.rect(rx, ry, s.w, s.h, T.FLOOR, s.floor);
  k.rect(rx - 1, ry - 1, s.w + 2, 1, T.WALL, s.wall);
  // the way out
  const dx = rx + s.door, dy = ry + s.h, mid = (dx + s.doorW / 2) * TS;
  for (let i = 0; i < s.doorW; i++) k.set(dx + i, dy, T.FLOOR, s.floor);
  k.D("threshold", dx * TS, dy * TS, 0, s.doorW * TS);
  k.portals.push({
    id: "door", x: dx * TS + 1, y: dy * TS + 6, w: s.doorW * TS - 2, h: 11, dir: "down", door: true,
    to: { area: TOWN_ID, portal: `door.${e}` }, arrive: { x: mid, y: dy * TS - 3 }, label: b.name,
  });
  // the night outside leaks a little way in over the sill
  k.lights.push({ x: mid, y: dy * TS + 10, rad: 44, col: [0.5, 0.6, 0.95], int: 0.3, flick: 0 });
  const room: Room = {
    w: s.w, h: s.h,
    Q: (kind, cx, cy, o = {}) => k.Pt(kind, rx + cx, ry + cy, o),
    D: (kind, cx, cy, v = 0, w, h) => k.D(kind, (rx + cx) * TS, (ry + cy) * TS, v, w, h),
    spot: (id, kind, cx, cy, facing) => k.spot(id, kind, (rx + cx) * TS + 8, (ry + cy) * TS + 12, facing),
    seat: (id, cx, cy) => { k.Pt("stool", rx + cx, ry + cy); k.spot(`seat.${id}`, "seat", (rx + cx) * TS + 8, (ry + cy) * TS + 24, "up"); },
    counter: (cx, cy, v) => {
      k.Pt("counter", rx + cx, ry + cy, { v });
      k.spot("keeper", "keeper", (rx + cx) * TS + 8, (ry + cy) * TS, "down");
      k.spot("customer", "customer", (rx + cx) * TS + 8, (ry + cy) * TS + 28, "up");
    },
  };
  room.spot("door", "door", s.door + s.doorW / 2 - 0.5, s.h - 0.9, "up");
  s.dress(room);
  return {
    id: interiorId(e), w: INTERIOR_W, h: INTERIOR_H, grid: k.grid, plan: k.grid.slice(), style: k.style, tvar: k.tvar,
    rooms: [{ num: 1, name: b.name ?? e.toUpperCase(), x: rx, y: ry, w: s.w, h: s.h }],
    props: k.props, decals: k.decals, lights: k.lights, loose: k.loose, drips: [], exits: [],
    start: { x: mid, y: dy * TS - 3 }, interior: true, ambient: rich ? [0.3, 0.33, 0.4] : [0.3, 0.25, 0.22],
    portals: k.portals, spots: k.spots,
  };
}

const ROOMS: Record<Establishment, RoomSpec> = {
  // The Black Anvil. A working forge with a shop squeezed into its east end: brick, soot, one fire
  // and two torches. The west half is the smith's; the counter keeps customers out of it.
  smithy: {
    w: 15, h: 9, floor: FS.FLAG, wall: WS.BRICK, door: 7, doorW: 1,
    dress: ({ Q, D, spot, counter }) => {
      Q("smithforge", 2.2, 0.9); Q("bellows", 5.4, 1); Q("coalbin", 0.2, 2.5); Q("anvil", 3, 3.1); Q("quench", 5.2, 3.5); Q("bucket", 1.2, 3.6);
      Q("torch", 7.2, -1, { lit: true }); Q("toolrack", 9.2, -1); Q("goodshelf", 12, -1, { v: 2 }); Q("torch", 14.2, -1, { lit: true });
      Q("weaponrack", 11.8, 0.4); Q("barrel", 14.1, 0.7, { v: 1 });
      counter(11.6, 4, 0);
      Q("ingots", 0.3, 6.4); Q("ingots", 0.5, 7.2); Q("grindstone", 2, 7.8); Q("crate", 13.6, 7.8, { v: 1 }); Q("crate", 14, 6.9); Q("sack", 12.4, 7.9); Q("armorstand", 9.4, 7.9, { v: 0 });
      D("scorch", 2, 2.2); D("stain", 3, 3.6, 0, 70, 44); D("stain", 0.8, 3, 0, 24, 18); D("golemtrack", 5, 2.4, 0, 30);
      for (let i = 0; i < 5; i++) D("debris", 1 + i * 0.9, 4.2 + (i % 2) * 0.5, i % 4);
      Q("candlestand", 8.6, 7.8); Q("candlestand", 14.1, 4.4); Q("lantern", 10.6, -1);
      spot("work.anvil", "work", 3, 4, "up"); spot("work.bellows", "work", 6.3, 2.2, "left"); spot("idle.browse", "idle", 10, 6.6, "right");
    },
  },
  // The Gilded Buckler. Finished arms for people with coin: dressed stone, a runner to the counter,
  // harness on stands down both walls, everything under clean rune light.
  armory: {
    w: 15, h: 9, floor: FS.FLAG, wall: WS.STONE, door: 7, doorW: 1,
    dress: ({ Q, D, spot, counter }) => {
      // everything mirrors about the door's column (7): door, runner, counter and shelf share one axis
      Q("rune_sconce", 2.6, -1); Q("shieldwall", 4.6, -1); Q("goodshelf", 7, -1, { v: 3 }); Q("shieldwall", 9.4, -1); Q("rune_sconce", 11.4, -1);
      Q("weaponrack", 1, 0.4); Q("weaponrack", 13, 0.4);
      counter(7, 2.4, 3);
      for (const [x, y, v] of [[0.3, 3.4, 0], [0.3, 5.2, 1], [0.3, 7, 3], [13.7, 3.4, 2], [13.7, 5.2, 0], [13.7, 7, 1], [4.6, 7.9, 2], [9.4, 7.9, 3]]) Q("armordisplay", x, y, { v });
      Q("runestand", 3.4, 4.6); Q("runestand", 10.6, 4.6); Q("dummy", 2.6, 7.6); Q("chest", 11.6, 7.8, { v: 2 }); Q("crate", 12.7, 7.9, { v: 1 });
      D("rug", 6.5, 3.6, 0, 32, 84);
      spot("idle.stands.w", "idle", 1.6, 5.6, "left"); spot("idle.stands.e", "idle", 12.4, 5.6, "right");
    },
  },
  // The Bright Facet. The smallest room in town and the most expensive: oak panelling, glazed tile,
  // glass cases, a strongbox behind the counter, and more light runes than it needs.
  jeweler: {
    w: 12, h: 8, floor: FS.TILE, wall: WS.PANEL, door: 6, doorW: 1,
    dress: ({ Q, D, spot, counter }) => {
      Q("rune_sconce", 0.6, -1); Q("goodshelf", 3, -1, { v: 4 }); Q("mirror", 5.5, -1); Q("goodshelf", 8, -1, { v: 4 }); Q("rune_sconce", 10.4, -1);
      Q("gembench", 1.4, 0.6); Q("chest", 10.6, 0.5, { v: 1 });
      counter(5.5, 2.4, 1);
      Q("displaycase", 0.4, 4.4, { v: 0 }); Q("displaycase", 0.4, 6.4, { v: 1 }); Q("displaycase", 10.6, 4.4, { v: 2 }); Q("displaycase", 10.6, 6.4, { v: 0 });
      Q("displaycase", 2.8, 6.8, { v: 2 }); Q("displaycase", 8.2, 6.8, { v: 1 }); Q("runestand", 2.2, 3.6); Q("runestand", 8.8, 3.6); Q("pot", 10.8, 2.4, { v: 1 });
      D("rug", 3.5, 3.7, 1, 80, 40);
      spot("work.bench", "work", 1.6, 1.3, "up"); spot("idle.cases.w", "idle", 1.6, 5.4, "left"); spot("idle.cases.e", "idle", 9.4, 5.4, "right");
    },
  },
  // The Silver Needle. Clothiers: waxed boards, limewash, bolts of cloth to the ceiling, forms
  // dressed in the season's work, a screen and a glass in the fitting corner.
  tailor: {
    w: 13, h: 8, floor: FS.BOARD, wall: WS.PLASTER, door: 6, doorW: 1,
    dress: ({ Q, D, spot, counter }) => {
      Q("rune_sconce", 0.5, -1); Q("goodshelf", 2.5, -1, { v: 1 }); Q("goodshelf", 4.8, -1, { v: 1 }); Q("rune_sconce", 7, -1); Q("mirror", 9, -1); Q("rune_sconce", 11.5, -1);
      counter(3.4, 2.4, 2);
      Q("screen", 10.9, 1.5); Q("mannequin", 8.9, 1.2, { v: 3 });
      Q("mannequin", 6.2, 4.5, { v: 0 }); Q("mannequin", 7.8, 4.9, { v: 2 }); Q("mannequin", 0.4, 4.4, { v: 1 });
      Q("table", 3, 5.6, { v: 1 }); Q("loom", 11.2, 5.4); Q("clothrack", 0.9, 6.9); Q("clothrack", 11.1, 6.9); Q("runestand", 4.6, 6.9);
      D("rug", 5.1, 3.4, 3, 64, 44); D("paper", 2.6, 4.9, 1); D("paper", 3.5, 5, 0);
      spot("work.loom", "work", 9.4, 5.6, "right"); spot("work.fitting", "work", 9.9, 2.6, "up"); spot("idle.forms", "idle", 7, 6.2, "up");
    },
  },
  // The Sunken Crown. The town's front room: a long bar, a big fire, a tin crown on the wall, too many
  // stools. Firelight and candles; the far tables are half in the dark. Stairs go up to the beds.
  tavern: {
    w: 20, h: 11, floor: FS.BOARD, wall: WS.PLASTER, door: 9, doorW: 2,
    dress: ({ Q, D, spot, seat }) => {
      Q("goodshelf", 2.2, -1, { v: 0 }); Q("goodshelf", 4.6, -1, { v: 0 }); Q("torch", 7.2, -1, { lit: true }); Q("torch", 9.6, -1, { lit: true });
      Q("crownplaque", 11.3, -1); Q("fireplace", 13.6, 0.55); Q("torch", 16.6, -1, { lit: true }); Q("stairs_up", 18.7, 0.75);
      // the bar: kegs racked behind it, a way round its west end
      Q("kegrack", 1.5, 0.7); Q("bar", 3.6, 2.6); Q("barrel", 6.8, 0.7); Q("barrel", 7.6, 0.8, { v: 1 });
      spot("keeper", "keeper", 3.6, 1.7, "down"); spot("customer", "customer", 6.8, 3.4, "left");
      seat("bar.1", 2, 3.4); seat("bar.2", 3.6, 3.4); seat("bar.3", 5.2, 3.4);
      // the hearth: a bench and two chairs pulled up to it
      Q("chair", 11.4, 2.5); Q("chair", 15.8, 2.5); Q("bench", 13.6, 3.3); D("rug", 11.6, 1.5, 0, 64, 22);
      spot("idle.hearth", "idle", 13.6, 4.2, "up");
      // tables: two with a candle, two without
      Q("roundtable_lit", 3, 6.5, { v: 1 }); seat("t1.w", 1.6, 6.3); seat("t1.e", 4.4, 6.3);
      Q("roundtable", 7.2, 5.4, { v: 0 }); seat("t2.w", 5.9, 5.2); seat("t2.e", 8.5, 5.2);
      Q("roundtable_lit", 12.6, 6.6, { v: 1 }); seat("t3.w", 11.2, 6.4); seat("t3.e", 14, 6.4);
      Q("roundtable", 17, 5.6, { v: 2 }); seat("t4.w", 15.7, 5.4); seat("t4.e", 18.3, 5.4);
      Q("longtable", 4.2, 9.2); Q("bench", 4.2, 8.4); Q("bench", 4.2, 10);
      // the cellar: kegs come up through a hatch cut for something broader than a potboy
      Q("cellarhatch", 16.4, 9.7); Q("barrel", 19.1, 9.2); Q("barrel", 18.4, 10); Q("crate", 19, 8.2, { v: 1 }); D("golemtrack", 14.2, 9.5, 0, 40);
      D("straw", 6, 7.6, 0, 70); D("straw", 14, 8, 0, 60); D("stain", 8.6, 6.6, 1, 14, 8); D("stain", 4.6, 4.3, 1, 12, 6);
      Q("lantern", 0.5, -1); Q("candlestand", 0.3, 4.8); Q("candlestand", 0.3, 9.9); Q("candlestand", 19.2, 7); Q("candlestand", 10.2, 4.2); Q("candlestand", 12.6, 9.8);
      spot("idle.stairs", "idle", 18.6, 2.4, "up");
    },
  },
  // The Adventurers' Guild, Westwake chapter. The Throne's charter made it the grandest room in town:
  // dressed stone, banners, a desk under the records, the contract board, a fire for those between jobs.
  guild: {
    w: 20, h: 12, floor: FS.FLAG, wall: WS.STONE, door: 9, doorW: 2,
    dress: ({ Q, D, spot, seat, counter }) => {
      Q("rune_sconce", 0.5, -1); Q("questboard", 3, -1); Q("rune_sconce", 5.5, -1); Q("banner", 6.9, -1, { v: 0 });
      Q("bookshelf", 8.5, 0, { v: 0 }); Q("bookshelf", 9.5, 0, { v: 2 }); Q("bookshelf", 10.5, 0, { v: 1 }); Q("banner", 12.1, -1, { v: 2 });
      Q("trophy", 17.6, -1, { v: 1 }); Q("fireplace", 15.7, 0.55); Q("stairs_up", 18.8, 0.75);
      counter(9.5, 2.7, 4);
      D("rug", 9, 4, 0, 32, 122);
      // west: the board, and the table where jobs are planned
      spot("idle.board.1", "idle", 2.2, 1.2, "up"); spot("idle.board.2", "idle", 3.8, 1.4, "up");
      Q("maptable", 3, 5.4); Q("chair", 1.4, 5.2); Q("chair", 4.7, 5.2); D("paper", 2.2, 5.8, 0); D("paper", 4, 6.1, 2);
      Q("armordisplay", 0.3, 3, { v: 1 }); Q("footlocker", 0.3, 8.2); Q("footlocker", 0.3, 9.2); Q("footlocker", 0.3, 10.2); Q("weaponrack", 3.4, 10.9);
      Q("runestand", 6, 8.4); Q("runestand", 13, 8.4); Q("runestand", 8, 10.9); Q("runestand", 11, 10.9); Q("runestand", 1.6, 7.6); Q("rune_sconce", 13.5, -1);
      spot("work.maps", "work", 3, 6.4, "up");
      // east: the fire, the tables, a corner to hit things in
      Q("bench", 15.7, 3.3); D("rug", 13.9, 1.5, 2, 60, 24);
      Q("roundtable", 14.6, 5.6, { v: 2 }); seat("t1.w", 13.3, 5.4); seat("t1.e", 15.9, 5.4);
      Q("roundtable_lit", 17.8, 7.4, { v: 1 }); seat("t2.w", 16.5, 7.2); seat("t2.e", 19.1, 7.2);
      Q("dummy", 18.6, 10.6); Q("dummy", 16.4, 10.8); Q("barrel", 19.1, 9); D("straw", 17.5, 10.4, 0, 50);
      spot("idle.fire", "idle", 15.7, 4.2, "up"); spot("idle.stairs", "idle", 18.7, 2.4, "up");
    },
  },
};

export const buildInterior = (e: Establishment): AreaData => buildRoom(e, ROOMS[e]);

/** Area registry rows (world/areas.ts): interior area id -> builder. */
export const INTERIOR_BUILDERS: Record<string, () => AreaData> = Object.fromEntries(ESTABLISHMENTS.map((e) => [interiorId(e), () => buildInterior(e)]));
