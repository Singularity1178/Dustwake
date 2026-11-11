// Westwake, the market town west of the surface (data). Pure; no DOM.
//
// What the Treasury Guardian remembers as "a village west of here, above these
// halls" has had a long time to grow. The keep sank and was forgotten; its
// service village was not. It took the keep's dressed stone for its own walls,
// a road found it, and the Aligarch Throne granted it a market. It is an
// ordinary provincial town, days from anywhere that matters: mostly human,
// built by hand and by hired labour golems (the plain kind that haul and lift
// and are stood in a yard at night; nothing here thinks that is not a person).
//
// The town reads in layers, oldest first:
//   - the OLD QUARTER (north-west): the original village. Thatch and daub
//     around the old well, a keep statue hauled home as a keepsake.
//   - the MARKET SQUARE and the HIGH STREET: the charter years. Stone and
//     slate, the Guild's chapter house, the shops that sell what nobody needs.
//     Paved in dressed setts and lit by light runes nobody has to tend:
//     they wake at dusk and sleep at sunrise by themselves (the charter stone's alone never sleeps).
//   - LOW STREET and the lanes behind it (south): where the work is. The
//     smithy, the tavern, the stable, the stone yard and the golem stands.
//     Cobbles giving way to mud; torches, where there is any light at all.
//
// The lighting is the town's map of itself: steady blue-white rune light means
// money (the square, the High Street, the Guild, armoury, jeweller, tailor and
// the houses of the people who own them); flickering orange means everyone
// else. The line between the two runs along the square's south side.
//
// This file is the one place the builder (town.ts), the painter (art/town.ts)
// and the interiors (townInteriors.ts) agree on what stands where.

export const TOWN_ID = "town";
export const TOWN_W = 96, TOWN_H = 68;
export const TOWN_NAME = "WESTWAKE";

/** Height (px) of a building's street front: the two bottom rows of its footprint. */
export const FRONT_H = 32;
/** Ground-floor windows: frame size and its top edge below the top of the front (px). */
export const WIN = { w: 10, h: 9, top: 14 } as const;
/** Upper-floor windows, tucked under the eave. */
export const UPWIN = { w: 6, h: 7, top: 3 } as const;
/** Door leaf sizes by kind (px). A hauler door is cut for something much wider than a man. */
export const DOOR = { plain: { w: 12, h: 19 }, double: { w: 20, h: 21 }, hauler: { w: 28, h: 24 } } as const;

export type WallKind = "timber" | "stone" | "brick" | "plank" | "daub" | "frame" | "tower" | "bays";
export type RoofKind = "slate" | "tile" | "thatch" | "shingle" | "flat";
export type DoorKind = keyof typeof DOOR;
/** How a house is lit after dark: light runes (money), fire (everyone else), or not at all. */
export type LightTier = "rune" | "torch" | "none";

export interface Building {
  id: string;
  /** Tile rect of the footprint. The bottom two rows are the front; the rest is roof. */
  x: number; y: number; w: number; h: number;
  wall: WallKind; roof: RoofKind;
  /** "ew": the long slope faces the street (default). "ns": a gable is turned to it. */
  ridge?: "ew" | "ns";
  /** Palette variant: plaster, paint on doors and shutters, the roof's weathering. */
  tint: number;
  /** Door column (tiles from x). A hauler door spans this column and the next. */
  door?: { col: number; kind?: DoorKind };
  /** Ground-floor window columns, and which of them show a light at night. */
  win?: number[];
  lit?: number[];
  light: LightTier;
  /** Dormer columns on the long slope (the big civic roofs); each has a window, lit like the rest of the house. */
  dormers?: number[];
  /** Chimney column (smokes). */
  chimney?: number;
  /** Prop kind of the hanging sign beside the door. */
  sign?: string;
  /** Area behind the door, for the six that can be entered. */
  interior?: string;
  /** Name shown on arriving inside. */
  name?: string;
}

const B = (id: string, x: number, y: number, w: number, h: number, wall: WallKind, roof: RoofKind, tint: number, light: LightTier, o: Partial<Building> = {}): Building =>
  ({ id, x, y, w, h, wall, roof, tint, light, ...o });

/** Streets, as the builder lays them (tile rows / columns, inclusive). */
export const STREETS = {
  /** East gate -> market square -> west bar. */
  high: { y0: 30, y1: 32 },
  square: { x0: 37, y0: 27, x1: 57, y1: 37 },
  oldLane: { y0: 15, y1: 16 },
  low: { y0: 45, y1: 47 },
  back: { y0: 58, y1: 60 },
  /**
   * The town wall: a closed ring of the sunken keep's stone, two tiles thick
   * (the north and south runs carry a third row, the south face of the wall).
   * `x0..x1` is the east run and `westX0..westX1` the west; the High Street
   * passes through both on rows `gateY0..gateY1`, between a pair of towers
   * each (the east gate and the West Bar). Inside the ring is the town; outside
   * it the ground simply runs to the edge of the map and stops.
   */
  wall: { x0: 88, x1: 89, westX0: 4, westX1: 5, northY0: 2, northY1: 4, southY0: 63, southY1: 65, gateY0: 30, gateY1: 32 },
} as const;

export const BUILDINGS: Building[] = [
  // ---- the old quarter and the north row (fronts on Old Lane)
  B("cot_well_w", 8, 9, 6, 6, "daub", "thatch", 0, "torch", { door: { col: 2 }, win: [0, 4], lit: [4], chimney: 4 }),
  B("cot_well_e", 15, 9, 6, 6, "daub", "thatch", 1, "none", { door: { col: 3 }, win: [1, 5], chimney: 1 }),
  B("cot_old", 31, 9, 6, 6, "timber", "thatch", 2, "torch", { door: { col: 2 }, win: [0, 4], lit: [0] }),
  B("bakery", 39, 9, 7, 6, "timber", "tile", 3, "torch", { door: { col: 3 }, win: [1, 5], lit: [1, 5], chimney: 5, sign: "sign_bakery" }),
  B("house_n", 48, 9, 6, 6, "timber", "tile", 0, "torch", { door: { col: 2 }, win: [0, 4], lit: [4], chimney: 1 }),
  B("townhouse_w", 56, 8, 7, 7, "stone", "slate", 1, "rune", { ridge: "ns", door: { col: 3 }, win: [1, 5], lit: [1, 5] }),
  B("townhouse_e", 65, 8, 7, 7, "timber", "slate", 4, "rune", { door: { col: 3 }, win: [1, 5], lit: [5], chimney: 1 }),
  B("reeve", 74, 7, 11, 8, "stone", "slate", 2, "rune", { door: { col: 5, kind: "double" }, win: [1, 3, 7, 9], lit: [3, 7], chimney: 9, dormers: [2, 5, 8], sign: "sign_reeve" }),
  // ---- the bright side: north of the square and the High Street
  B("tailor", 35, 20, 6, 7, "timber", "slate", 5, "rune", { ridge: "ns", door: { col: 2 }, win: [0, 4], lit: [0, 4], sign: "sign_tailor", interior: "town_tailor", name: "THE SILVER NEEDLE" }),
  B("guild", 42, 18, 11, 9, "stone", "slate", 0, "rune", { door: { col: 5, kind: "double" }, win: [1, 3, 7, 9], lit: [1, 3, 7, 9], chimney: 9, dormers: [2, 5, 8], sign: "sign_guild", interior: "town_guild", name: "ADVENTURERS' GUILD" }),
  B("jeweler", 54, 20, 6, 7, "stone", "slate", 3, "rune", { ridge: "ns", door: { col: 3 }, win: [1, 5], lit: [1, 5], sign: "sign_jeweler", interior: "town_jeweler", name: "THE BRIGHT FACET" }),
  B("house_w1", 10, 24, 6, 6, "timber", "shingle", 1, "torch", { door: { col: 3 }, win: [1, 5], lit: [1], chimney: 0 }),
  B("house_w2", 17, 24, 6, 6, "timber", "tile", 4, "none", { door: { col: 2 }, win: [0, 4] }),
  B("apothecary", 25, 23, 7, 7, "timber", "tile", 2, "torch", { ridge: "ns", door: { col: 3 }, win: [1, 5], lit: [1, 5], chimney: 6, sign: "sign_apothecary" }),
  B("armory", 63, 22, 7, 8, "stone", "slate", 4, "rune", { door: { col: 3 }, win: [1, 5], lit: [1, 5], dormers: [1, 5], sign: "sign_armory", interior: "town_armory", name: "THE GILDED BUCKLER" }),
  B("townhouse_h", 72, 24, 6, 6, "timber", "slate", 0, "rune", { door: { col: 2 }, win: [0, 4], lit: [0, 4] }),
  B("watch", 80, 24, 6, 6, "stone", "slate", 1, "rune", { door: { col: 3 }, win: [1, 5], lit: [1], sign: "sign_watch" }),
  // ---- the low side: fronts on Low Street
  B("stable", 9, 38, 10, 7, "plank", "shingle", 0, "none", { door: { col: 4, kind: "hauler" }, win: [1, 8], sign: "sign_stable" }),
  B("house_l1", 24, 39, 6, 6, "timber", "shingle", 3, "torch", { door: { col: 2 }, win: [0, 4], lit: [4], chimney: 5 }),
  B("house_l2", 31, 39, 4, 6, "daub", "thatch", 2, "none", { door: { col: 1 }, win: [3] }),
  B("tavern", 36, 38, 10, 7, "timber", "tile", 1, "torch", { door: { col: 4, kind: "double" }, win: [1, 2, 7, 8], lit: [1, 2, 7, 8], chimney: 8, dormers: [2, 6], sign: "sign_tavern", interior: "town_tavern", name: "THE SUNKEN CROWN" }),
  B("smithy", 50, 38, 8, 7, "brick", "shingle", 0, "torch", { door: { col: 3 }, win: [1, 6], lit: [1, 6], chimney: 6, sign: "sign_smithy", interior: "town_smithy", name: "THE BLACK ANVIL" }),
  B("house_l3", 64, 39, 6, 6, "timber", "tile", 4, "torch", { door: { col: 3 }, win: [1, 5], lit: [1] }),
  B("house_l4", 71, 39, 6, 6, "timber", "shingle", 0, "none", { ridge: "ns", door: { col: 2 }, win: [0, 4], chimney: 4 }),
  B("cooper", 78, 39, 5, 6, "plank", "shingle", 1, "torch", { door: { col: 2, kind: "double" }, win: [0, 4], lit: [0], sign: "sign_cooper" }),
  // ---- the back lane: cottages, a house going up, the warehouse, the golem stands
  B("cot_s1", 9, 52, 6, 6, "daub", "thatch", 1, "torch", { door: { col: 2 }, win: [4], lit: [4] }),
  B("cot_s2", 16, 52, 5, 6, "daub", "thatch", 0, "none", { door: { col: 2 }, win: [0], chimney: 4 }),
  B("cot_s3", 24, 52, 6, 6, "daub", "shingle", 2, "torch", { door: { col: 3 }, win: [1], lit: [1] }),
  B("cot_s4", 31, 52, 5, 6, "timber", "thatch", 3, "none", { door: { col: 2 }, win: [4] }),
  B("site", 38, 51, 6, 7, "frame", "flat", 0, "none"),
  B("warehouse", 50, 50, 10, 8, "plank", "shingle", 2, "none", { door: { col: 4, kind: "hauler" }, win: [1, 8], sign: "sign_warehouse" }),
  B("stands", 72, 49, 10, 5, "bays", "shingle", 0, "none"),
  // ---- the east gate's two towers (the wall between and beyond them is tiles)
  B("gate_n", 87, 25, 4, 5, "tower", "flat", 0, "rune"),
  B("gate_s", 87, 33, 4, 5, "tower", "flat", 1, "rune"),
  // ---- and the West Bar's: the same gate at the other end of the High Street
  B("bar_n", 3, 25, 4, 5, "tower", "flat", 1, "rune"),
  B("bar_s", 3, 33, 4, 5, "tower", "flat", 0, "rune"),
];

export const building = (id: string): Building => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`no building "${id}"`);
  return b;
};

/** Roof geometry shared by the painter and the builder (px, measured from the top of the footprint). */
export const roofH = (b: Building) => b.h * 16 - FRONT_H;
export const ridgeY = (b: Building) => Math.max(5, Math.round(roofH(b) * 0.28));
/** Top-centre of a building's chimney stack (px, absolute), if it has one. */
export function chimneyPx(b: Building): { x: number; y: number } | null {
  if (b.chimney === undefined) return null;
  const y = b.ridge === "ns" ? Math.round(roofH(b) * 0.3) : Math.max(1, ridgeY(b) - 8);
  return { x: (b.x + b.chimney) * 16 + 8, y: b.y * 16 + y };
}

/** A dormer's window: centre x and the y of its sill (px, absolute). The painter and the builder both use this. */
export const dormerPx = (b: Building, col: number) => ({ x: (b.x + col) * 16 + 8, y: b.y * 16 + roofH(b) - 9 });

/** Centre x (px) of a building's door, and the y (px) of the ground line at its foot. */
export function doorPx(b: Building): { x: number; y: number; kind: DoorKind } {
  const kind = b.door?.kind ?? "plain", col = b.door?.col ?? 0;
  return { x: (b.x + col) * 16 + (kind === "hauler" ? 16 : 8), y: (b.y + b.h) * 16, kind };
}

/** The six establishments that can be entered, in the order the brief lists them. */
export const ESTABLISHMENTS = ["smithy", "armory", "jeweler", "tailor", "tavern", "guild"] as const;
export type Establishment = (typeof ESTABLISHMENTS)[number];
export const interiorId = (e: Establishment) => `town_${e}`;

/**
 * Which of them count as high-end. These are lit by light runes inside and
 * out; the other two burn fire like the rest of the town.
 */
export const HIGH_END: Record<Establishment, boolean> = { smithy: false, armory: true, jeweler: true, tailor: true, tavern: false, guild: true };

/** Hanging signs: what the golem reads when it looks up at one (prop kind -> text). The art variant is the index. */
export const SIGNS: [kind: string, text: string][] = [
  ["sign_smithy", "A BLACK ANVIL ON A HANGING BOARD. THE BLACK ANVIL: HARROW AND SONS, SMITHS."],
  ["sign_armory", "A GILT SHIELD, FRESHLY PAINTED. THE GILDED BUCKLER: ARMS AND HARNESS, FITTED TO ORDER."],
  ["sign_jeweler", "A CUT GEM IN A BRASS RING. THE BRIGHT FACET: STONES SET, WEIGHED AND VALUED."],
  ["sign_tailor", "A NEEDLE AND A LOOP OF SILVER THREAD. THE SILVER NEEDLE: CLOTHIERS."],
  ["sign_tavern", "A CROWN, HALF UNDER A WAVY LINE. THE SUNKEN CROWN. ALE, STEW, BEDS."],
  ["sign_guild", "A SWORD LAID OVER A COMPASS ROSE. ADVENTURERS' GUILD, WESTWAKE CHAPTER. CHARTERED BY THE ALIGARCH THRONE."],
  ["sign_bakery", "A ROUND LOAF. THE OVEN BEHIND THIS WALL IS STILL WARM."],
  ["sign_apothecary", "A MORTAR AND PESTLE. DRIED HERBS HANG IN THE WINDOW."],
  ["sign_reeve", "THE REEVE'S HALL. TOLLS, TITHES AND GRIEVANCES, IN THAT ORDER."],
  ["sign_watch", "THE GATE WATCH. A SLATE BY THE DOOR LISTS WHO CAME IN TODAY, AND WHAT THEY HAULED."],
  ["sign_stable", "A HORSESHOE. STABLING BY THE NIGHT. THE BIG DOOR IS CUT FOR MORE THAN HORSES."],
  ["sign_cooper", "A BARREL HOOP AND A WHEEL. COOPER AND WHEELWRIGHT."],
  ["sign_warehouse", "MARKET STORE. THE DOORS ARE TWICE A MAN'S WIDTH, AND THE SILL IS WORN DOWN IN TWO FLAT TRACKS."],
];

// ---------------------------------------------------------------- the townsfolk's places
/**
 * Where the people of Westwake go (content/folk.ts reads them by kind and id prefix). Appended to the builder's spots
 * after the ground cover is scattered, so no prop or pixel moved for them; the layout audit checks each is free and
 * can be walked to. Chore and work ids carry their motion (`chore.chop.*` splits wood, `work.haul.*` carries).
 */
type FolkSpot = { id: string; kind: "gather" | "bench" | "wander" | "chore" | "patrol" | "work"; x: number; y: number; facing: "down" | "up" | "left" | "right" };
const FS_ = (id: string, kind: FolkSpot["kind"], x: number, y: number, facing: FolkSpot["facing"] = "down"): FolkSpot => ({ id, kind, x, y, facing });
export const TOWN_FOLK_SPOTS: FolkSpot[] = [
  // the tavern door at dusk: a loose knot of people on Low Street, never in the doorway itself
  FS_("gather.1", "gather", 614, 750, "right"), FS_("gather.2", "gather", 632, 760, "up"), FS_("gather.3", "gather", 654, 763, "up"),
  FS_("gather.4", "gather", 676, 757, "left"), FS_("gather.5", "gather", 690, 745, "left"), FS_("gather.6", "gather", 600, 740, "right"),
  // benches (sitting on them: the spot is the seat, the sitter faces the street)
  FS_("bench.well", "bench", 414, 240, "down"), FS_("bench.garden", "bench", 1216, 344, "down"), FS_("bench.tavern", "bench", 702, 733, "down"),
  // a stroll: corners of the square, the lanes, the gardens
  FS_("wander.sq.1", "wander", 616, 474), FS_("wander.sq.2", "wander", 904, 474), FS_("wander.sq.3", "wander", 896, 586, "up"), FS_("wander.sq.4", "wander", 616, 600, "up"),
  FS_("wander.high.1", "wander", 1000, 516), FS_("wander.high.2", "wander", 1240, 512), FS_("wander.high.3", "wander", 470, 514), FS_("wander.high.4", "wander", 260, 516),
  FS_("wander.old.1", "wander", 300, 262), FS_("wander.old.2", "wander", 700, 262), FS_("wander.old.3", "wander", 860, 258),
  FS_("wander.low.1", "wander", 480, 752), FS_("wander.low.2", "wander", 820, 754), FS_("wander.low.3", "wander", 1140, 750),
  FS_("wander.back.1", "wander", 360, 950), FS_("wander.back.2", "wander", 760, 958), FS_("wander.ne.1", "wander", 1140, 300), FS_("wander.ne.2", "wander", 1300, 300),
  // household chores, each beside the thing it needs
  FS_("chore.chop.1", "chore", 240, 262), FS_("chore.chop.2", "chore", 1238, 612, "left"), FS_("chore.chop.3", "chore", 326, 824, "left"), FS_("chore.chop.4", "chore", 958, 676),
  FS_("chore.hang.1", "chore", 178, 138, "down"), FS_("chore.hang.2", "chore", 1093, 618, "down"), FS_("chore.hang.3", "chore", 514, 618, "down"), FS_("chore.hang.4", "chore", 226, 826, "down"),
  FS_("chore.feed.1", "chore", 610, 252, "up"), FS_("chore.feed.2", "chore", 1294, 616, "up"), FS_("chore.feed.3", "chore", 500, 826, "left"),
  FS_("chore.draw.1", "chore", 400, 216, "right"), FS_("chore.sweep.1", "chore", 680, 266), FS_("chore.sweep.2", "chore", 1176, 746), FS_("chore.sweep.3", "chore", 440, 954),
  FS_("chore.hoe.1", "chore", 430, 588), FS_("chore.hoe.2", "chore", 1040, 588), FS_("chore.hoe.3", "chore", 186, 806), FS_("chore.hoe.4", "chore", 420, 806),
  // the stone yard and the building site: carrying and digging
  FS_("work.haul.1", "work", 1040, 852, "up"), FS_("work.haul.2", "work", 1180, 774), FS_("work.haul.3", "work", 1056, 946, "up"), FS_("work.haul.4", "work", 740, 890, "up"),
  FS_("work.dig.1", "work", 660, 948), FS_("work.dig.2", "work", 1150, 870, "left"),
  // the smithy's yard: the apprentices' anvil work
  FS_("work.hammer.1", "work", 968, 709, "up"), FS_("work.hammer.3", "work", 1300, 746, "up"),
  // the watch's rounds
  FS_("patrol.watchhouse", "patrol", 1336, 512), FS_("patrol.gate", "patrol", 1384, 508, "right"), FS_("patrol.high.e", "patrol", 1150, 514),
  FS_("patrol.square.ne", "patrol", 940, 470), FS_("patrol.square.nw", "patrol", 582, 470), FS_("patrol.high.w", "patrol", 400, 514), FS_("patrol.bar", "patrol", 150, 510, "left"),
  FS_("patrol.yard.n", "patrol", 1130, 680), FS_("patrol.low.e", "patrol", 1250, 752), FS_("patrol.low.mid", "patrol", 900, 756), FS_("patrol.tavern", "patrol", 700, 760),
  FS_("patrol.low.w", "patrol", 400, 754), FS_("patrol.lane.w", "patrol", 352, 620), FS_("patrol.lane.n", "patrol", 544, 360), FS_("patrol.old.w", "patrol", 200, 260), FS_("patrol.old.e", "patrol", 820, 262),
];
