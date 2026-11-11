// Prop kind definitions (data). Sprites stay procedural in art.ts (keyed by
// kind); behaviour that used to be scattered `kind === "..."` checks in the game
// class lives here.

import { SIGNS } from "./town";
import type { LightHabit } from "./daycycle";
import type { StationId } from "./crafting";
import { GATE_STAIR, STAIR_CHEEK } from "./geography";

export interface PropLightDef {
  dx: number; dy: number; rad: number; col: [number, number, number]; int: number; flick: number;
  /** "lit": only emitted while the prop is lit. "always": emitted unconditionally. */
  when: "lit" | "always";
}

export interface PropKindDef {
  /** Generic inventory, separate from a one-shot story container. */
  storage?: { slots: number };
  /** Reuse existing art without reusing its gameplay kind. */
  art?: string;
  /** Collision footprint [w, h], centred on x, ending at y. */
  box?: [number, number];
  /** A footprint that only blocks while the prop is open: a stairwell is flat ground until it is dug out, then a hole. */
  openBox?: [number, number];
  /** Sorted just in front of the wall it hangs on. */
  wallMounted?: boolean;
  /** Which state selects the alternate sprite. Default "open". */
  alt?: "lit" | "taken" | "open";
  light?: PropLightDef;
  /**
   * How this light is kept where people live (content/daycycle.ts: LightHabit): lit and put out with the day. Only
   * areas marked `tended` follow it. The same torch burns on untended in the halls, and whatever the golem builds is
   * the golem's to keep lit.
   */
  habit?: LightHabit;
  /** Fire visuals while lit. */
  fire?: { big: boolean; embers: number; emberDy: number };
  /** Horizontal offset of an item icon resting on the prop. */
  itemDx?: number;
  /** A teleportation rune site (see content/runes.ts). Drawn as a floor circle, not a sprite. */
  rune?: boolean;
  /** Interacting shows this text (ruins, landmarks). */
  examine?: string;
  /** Lies flat on the ground: always drawn beneath actors. */
  flat?: boolean;
  /** Foliage that sways in the wind (presentation only): the sprite's upper part shifts by up to 1px. */
  sway?: boolean;
  /**
   * A work station: interacting runs the `station` rule, whose `useStation`
   * effect asks presentation to open this UI (see content/crafting.ts).
   */
  station?: StationId;
  /** Trails smoke (presentation only): a chimney pot. `z` is the height it leaves at, `rate` puffs per second. */
  smoke?: { dx: number; z: number; rate: number };
}

/** Light-rune light: blue-white and perfectly steady (it is not a flame). Fire is orange and never still. */
const RUNE_COL: [number, number, number] = [0.62, 0.8, 1];
const FIRE_COL: [number, number, number] = [1, 0.64, 0.33];

/**
 * The market town (Westwake) and the rooms behind its doors. Art: art/propsTown.ts.
 * Nothing here has gameplay: no shop sells, no bench crafts, nothing stores. The
 * town reuses the dungeon's furniture where it fits (tables, chairs, racks,
 * barrels, the wall torch) and the surface's torch post and foliage.
 */
const TOWN_PROPS: Record<string, PropKindDef> = {
  // ---- light runes: the streets and shops that can pay for them
  rune_lamp: { box: [6, 4], habit: "rune", light: { dx: 0, dy: -14, rad: 118, col: RUNE_COL, int: 0.95, flick: 0, when: "always" } },
  rune_sconce: { wallMounted: true, habit: "rune", light: { dx: 0, dy: 8, rad: 124, col: RUNE_COL, int: 0.9, flick: 0, when: "always" } },
  runestand: { box: [8, 4], light: { dx: 0, dy: -6, rad: 116, col: RUNE_COL, int: 0.85, flick: 0, when: "always" } },
  // ---- fire: everyone else (plus the dungeon's wall torch and the surface's torch post, as they are)
  lantern: { wallMounted: true, habit: "fire", light: { dx: 0, dy: 8, rad: 96, col: FIRE_COL, int: 0.85, flick: 0.16, when: "always" } },
  /** An iron stand of tallow candles: what a room burns when it cannot hang a light rune. */
  candlestand: { box: [6, 4], light: { dx: 0, dy: -6, rad: 104, col: FIRE_COL, int: 0.85, flick: 0.14, when: "always" } },
  // ---- a window with a light behind it, laid over the painted window (variants: fire / rune, ground floor / upper)
  winglow: { wallMounted: true, habit: "window", light: { dx: 0, dy: 12, rad: 46, col: [1, 0.68, 0.36], int: 0.5, flick: 0.07, when: "always" } },
  winglow_rune: { wallMounted: true, art: "winglow", habit: "window", light: { dx: 0, dy: 12, rad: 52, col: RUNE_COL, int: 0.5, flick: 0, when: "always" } },
  winglow_up: { wallMounted: true, art: "winglow", habit: "window" },
  // ---- hanging signs: one art, a kind per house so each reads its own line (content/town.ts: SIGNS)
  shopsign: { wallMounted: true },
  ...Object.fromEntries(SIGNS.map(([kind, text]) => [kind, { wallMounted: true, art: "shopsign", examine: text } satisfies PropKindDef])),
  // ---- landmarks: the town's history, in the order it happened
  well: { box: [20, 10], examine: "THE OLD VILLAGE WELL. THE RIM IS WORN SMOOTH BY MORE HANDS THAN YOU CAN COUNT. THE TOWN GREW OUTWARD FROM HERE." },
  keepstatue: { box: [18, 10], art: "statue", examine: "A STATUE FROM THE KEEP, HAULED HERE LONG AGO AND SET UPRIGHT. NOBODY REMEMBERS WHO IT WAS. SOMEONE STILL LEAVES FLOWERS." },
  keepstone: { wallMounted: true, examine: "DRESSED STONE, OLDER THAN THE WALL AROUND IT. THE SAME CUT AS THE HALLS YOU WOKE IN. THE TOWN WAS BUILT FROM WHAT THE KEEP LEFT BEHIND." },
  marketcross: {
    box: [26, 12], light: { dx: 0, dy: -22, rad: 132, col: RUNE_COL, int: 1, flick: 0, when: "always" },
    examine: "THE CHARTER STONE. BY GRANT OF THE ALIGARCH THRONE, WESTWAKE HOLDS MARKET EVERY SEVENTH DAY. THE LIGHT RUNE AT ITS HEAD HAS NEVER GONE OUT.",
  },
  noticeboard: { box: [20, 4], examine: "NOTICES. MARKET ON THE SEVENTH DAY. HAULERS FOR HIRE AT THE STONE YARD. LOST: ONE GOAT. THE GUILD PAYS FOR NEWS OF THE OLD RUIN EAST OF TOWN." },
  tollbar: { box: [6, 48], examine: "THE WEST BAR, DOWN AND CHAINED. BEYOND IT THE ROAD RUNS FOUR DAYS TO ANYWHERE LARGER. THE CAPITAL IS ONLY A NAME HERE." },
  waymark: { box: [8, 4], examine: "A WAYMARK, LEANING. ITS ARM POINTS WEST ALONG AN OLD ROAD: WESTWAKE. THE CUT LETTERS ARE NEWER THAN THE POST." },
  milestone: { box: [8, 5], examine: "A MILESTONE. WEST: WESTWAKE. EAST: NOTHING IS CARVED. SOMEONE HAS SCRATCHED BELOW IT: RUINS. KEEP OUT." },
  // ---- labour: what the golems that haul and lift leave behind (there are none here to see)
  golempad: { flat: true, examine: "A GOLEM STAND: A SLAB WORN INTO TWO FLAT HOLLOWS, AN IRON RING FOR THE TETHER. LABOUR GOLEMS ARE STOOD HERE WHEN THERE IS NOTHING TO HAUL. IT IS EMPTY." },
  yokerack: { box: [24, 5], examine: "CARRYING YOKES AND A STONE HOD, CUT FAR TOO WIDE FOR HUMAN SHOULDERS. THE GRIPS ARE WORN TO THE SHAPE OF BROAD, FINGERLESS HANDS." },
  tallyboard: { box: [12, 4], examine: "A TALLY SLATE. STAND 1: STONE, 40 LOADS. STAND 2: TIMBER. STAND 3: OUT ON HIRE. NO NAMES, ONLY NUMBERS." },
  stonestack: { box: [24, 9], examine: "CUT STONE, STACKED TWO HIGH. EACH BLOCK HAS AN IRON LIFTING RING, POLISHED BRIGHT. NO MAN LIFTS THESE." },
  scaffold: { box: [36, 5], examine: "A HOUSE GOING UP. THE BEAMS WAITING BELOW ARE TOO HEAVY FOR A WORK GANG. THE TOWN IS STILL GROWING." },
  crane: { box: [22, 9], examine: "A HOIST. ITS CAPSTAN BARS ARE SET CHEST-HIGH TO SOMETHING TALLER THAN A MAN, AND WORN SMOOTH WHERE IT PUSHES." },
  timberstack: { box: [32, 8] },
  // ---- streets, market, yards
  stall: { box: [34, 9] }, wagon: { box: [34, 10] }, haybale: { box: [14, 7] }, trough: { box: [20, 6] }, hitchpost: { box: [18, 3] },
  woodpile: { box: [20, 7] }, fence: { box: [16, 4] }, fence_v: { box: [4, 16] }, planter: { box: [14, 5] }, coop: { box: [18, 7] },
  laundry: { sway: true }, chimney: { smoke: { dx: 0, z: 5, rate: 2.2 } },
  /** The Throne's colours on a pole: outside the Guild, the Reeve's Hall and the gate, so nobody forgets whose town this is. */
  bannerpole: { box: [4, 3], sway: true },
  /** A town tree: the surface's tree to look at, but nobody's timber (not harvestable). */
  towntree: { box: [10, 6], art: "tree", sway: true },
  // ---- what the town shares with the halls only by sight. The halls' anvil is a working station and their racks
  // and stands are what an age left of them; the town's are whole, and nobody's to use yet (the town is appearance only).
  townanvil: { box: [14, 6], art: "anvil" }, shoprack: { box: [24, 6] }, shopstand: { box: [10, 5] },
  // ---- shop fittings (interiors)
  counter: { box: [46, 9] }, bar: { box: [78, 10] }, goodshelf: { wallMounted: true }, displaycase: { box: [14, 7] },
  mannequin: { box: [10, 5] }, clothrack: { box: [28, 6] }, loom: { box: [28, 9] }, mirror: { wallMounted: true }, screen: { box: [24, 5] },
  kegrack: { box: [32, 9] }, roundtable: { box: [18, 9] }, stool: { box: [6, 4] }, stairs_up: { box: [20, 12] }, dummy: { box: [8, 4] },
  roundtable_lit: { box: [18, 9], art: "roundtable", light: { dx: 0, dy: -8, rad: 70, col: FIRE_COL, int: 0.6, flick: 0.12, when: "always" } },
  fireplace: { box: [38, 8], light: { dx: 0, dy: 4, rad: 168, col: [1, 0.56, 0.26], int: 0.95, flick: 0.24, when: "always" } },
  smithforge: { box: [34, 12], light: { dx: 0, dy: 2, rad: 160, col: [1, 0.48, 0.2], int: 0.95, flick: 0.28, when: "always" } },
  quench: { box: [16, 7] }, toolrack: { wallMounted: true }, coalbin: { box: [14, 7] }, ingots: { box: [12, 5] }, grindstone: { box: [12, 6] },
  shieldwall: { wallMounted: true }, armordisplay: { box: [10, 5] }, gembench: { box: [28, 9] }, trophy: { wallMounted: true },
  bellows: { box: [18, 8], examine: "THE GREAT BELLOWS. ITS CRANK IS SET HIGH AND STIFF, AND THE FLAGSTONE UNDER IT IS WORN INTO TWO FLAT HOLLOWS. NO APPRENTICE TURNS THIS." },
  cellarhatch: { flat: true, examine: "THE CELLAR HATCH, CUT WIDE. THE RAMP BELOW IS SCORED BY SOMETHING HEAVY AND FLAT-FOOTED THAT CARRIES THE KEGS UP." },
  crownplaque: { wallMounted: true, examine: "A CROWN OF BEATEN TIN, NAILED OVER THE HEARTH. THE REAL ONE, THEY SAY, WENT DOWN WITH THE KEEP." },
  questboard: { wallMounted: true, examine: "CONTRACTS, PINNED THREE DEEP. ESCORTS. WOLF BOUNTIES. A CELLAR OF RATS. ONE SHEET HAS YELLOWED UNCLAIMED: SURVEY THE SUNKEN KEEP." },
};

export const PROPS: Record<string, PropKindDef> = {
  bookshelf: { box: [16, 8] }, shelfrow: { box: [16, 10] }, shelf_fallen: { box: [28, 10] }, table: { box: [28, 10] },
  lectern: { box: [10, 6] }, chair: { box: [8, 5] }, bed: { box: [14, 26] }, footlocker: { box: [12, 6] },
  weaponrack: { box: [24, 6] }, limbrack: { box: [22, 6], alt: "taken" }, armorstand: { box: [10, 5] },
  barrel: { box: [12, 7] }, crate: { box: [14, 8] }, statue: { box: [18, 10] }, statue_fallen: { box: [30, 10] },
  throne: { box: [30, 14] }, maptable: { box: [28, 10], alt: "taken" }, altar: { box: [30, 10] }, pew: { box: [36, 6] },
  // The workbench is the crafting station: the dungeon's authored one and the buildable CRAFTING BENCH are the same prop.
  // While something rests on it (the dungeon's chisel) taking that comes first; see deriveInteractables.
  workbench: { box: [32, 10], itemDx: -6, station: "crafting" }, cradle: { box: [28, 5] },
  // The smelter (kind `forge`, the id it has always had) and the anvil: stations with their own screens. Both can be
  // read with golem vision and built (content/build.ts); reading the smelter also teaches smelting.
  forge: { box: [32, 12], station: "smelting" }, anvil: { box: [14, 6], station: "smithing" },
  // ---- the artificery: where tools, runes and golems were made
  toolboard: { wallMounted: true, examine: "A TOOL BOARD. PAINTED OUTLINES SHOW WHAT HUNG HERE: TONGS, HAMMERS, A SHOVEL, A PICK. ONLY THE OUTLINES AND A FEW RUSTED SCRAPS ARE LEFT." },
  runetable: {
    box: [28, 10], light: { dx: 2, dy: -12, rad: 34, col: [0.6, 0.45, 1], int: 0.4, flick: 0.05, when: "always" },
    examine: "A RUNE-CUTTER'S TABLE. A HALF-CUT RUNE STONE STILL GLOWS FAINTLY IN ITS CLAMP. WHOEVER WORKED HERE MEANT TO COME BACK.",
  },
  clayvat: { box: [14, 7], examine: "A VAT OF SLIP CLAY, DRIED TO A CRACKED CAKE. WORKER BODIES WERE CAST FROM THIS." },
  husk: { box: [10, 5], examine: "AN UNFINISHED WORKER BODY ON ITS STAND. NO CORE WAS EVER SET IN IT, AND THE CLAY HAS SPLIT." },
  // ---- the armory: what time left of it
  staffrack: { box: [20, 6], examine: "A RACK FOR STAVES. MOST OF ITS SOCKETS ARE EMPTY. ONE STAFF IS LEFT, ITS STONE DEAD AND GREY." },
  wallhooks: { wallMounted: true, examine: "IRON PEGS, AND PALE SHAPES ON THE STONE WHERE BLADES AND SHIELDS HUNG FOR AN AGE." },
  armorpile: { box: [14, 6], examine: "PLATE AND MAIL, RUSTED INTO ONE LUMP. IT CRUMBLES WHERE YOU TOUCH IT." },
  // ---- the way up to the surface (content/geography.ts: GATE_HALL, GATE_STAIR). The fall that chokes it goes when
  // the stair is dug out from above, and daylight comes down it from then on. The flight stands between two cheek
  // walls: `staircheek` is one's footprint (its picture is baked with the steps, art/stairs.ts), `stairpost` the
  // newel post it ends in at the foot of the flight.
  stairfall: { flat: true, examine: "A HALL RUNS SOUTH FROM HERE TO THE SURFACE STAIR. EARTH AND FALLEN VAULT CHOKE IT TO THE ROOF. IT CAN ONLY BE CLEARED FROM ABOVE." },
  stairpost: { box: [STAIR_CHEEK.post.w, STAIR_CHEEK.post.d - 1] },
  staircheek: { flat: true, box: [STAIR_CHEEK.wall.w, GATE_STAIR.h * 16 - STAIR_CHEEK.post.d] },
  stairlight: { flat: true, alt: "lit", light: { dx: 0, dy: 0, rad: 120, col: [0.55, 0.68, 1], int: 0.9, flick: 0.02, when: "lit" } },
  slab: { box: [36, 10] }, hearth: { box: [36, 10] }, longtable: { box: [50, 10] }, bench: { box: [44, 4] },
  chest: { box: [16, 8] }, pot: { box: [10, 6] }, fountain: { box: [32, 14] }, pedestal: { box: [10, 5] },
  storage_chest: { box: [14, 8], storage: { slots: 32 }, art: "chest" },
  sack: { box: [10, 5] }, parts: { box: [16, 5] },
  brazier: {
    box: [12, 6], alt: "lit", habit: "fire",
    light: { dx: 0, dy: -4, rad: 96, col: [1, 0.58, 0.3], int: 0.9, flick: 0.2, when: "lit" },
    fire: { big: true, embers: 4, emberDy: 0 },
  },
  torch: {
    wallMounted: true, alt: "lit", habit: "fire",
    light: { dx: 0, dy: 6, rad: 84, col: [1, 0.62, 0.32], int: 0.85, flick: 0.22, when: "lit" },
    fire: { big: false, embers: 1.5, emberDy: 1 },
  },
  mushrooms: { light: { dx: 0, dy: -3, rad: 44, col: [0.35, 0.95, 0.8], int: 0.55, flick: 0.04, when: "always" } },
  banner: { wallMounted: true },
  // ---- surface
  tree: { box: [10, 6], alt: "taken", sway: true },
  rock: { box: [16, 8], alt: "taken" },
  /** A rock veined with iron (content/harvest.ts). */
  ironore: { box: [16, 8], alt: "taken" },
  torch_post: {
    box: [6, 4], alt: "lit", habit: "fire",
    light: { dx: 0, dy: -14, rad: 96, col: [1, 0.62, 0.32], int: 0.9, flick: 0.22, when: "lit" },
    fire: { big: false, embers: 1.5, emberDy: -2 },
  },
  cart: { box: [30, 10] },
  // ---- buildables (content/build.ts)
  /** Sharpened stakes: blocks the whole tile width. */
  barricade: { box: [16, 7] },
  // The head of the old stair down into the halls, buried: flat, walkable ground with the stair's kerb showing
  // through the grass and a ward glyph of the lost upper hall cut in its lintel, dark. Nothing here glows, so the
  // halls stay hidden. It is a dig site (content/digging.ts); dug out, it is an open stairwell that blocks
  // (openBox) except at its south lip, and the glyph wakes (`lit`: the surface builder's light follows it).
  buriedgate: { flat: true, openBox: [60, 44], light: { dx: 0, dy: -47, rad: 40, col: [0.62, 0.5, 1], int: 0.45, flick: 0.05, when: "lit" } },
  // ---- surface overgrowth (decorative; small boxes so the woods have texture)
  bush: { box: [12, 5], sway: true },
  fern: { sway: true },
  tallgrass: { sway: true },
  sapling: { box: [4, 3], sway: true },
  stump: { box: [10, 5] },
  log: { box: [30, 7], alt: "taken" },
  boulder: { box: [22, 9] },
  outcrop: { box: [40, 12] },
  // ---- the few remains that still break the surface (moss- and vine-covered)
  wallstub: { box: [30, 9], examine: "OLD MASONRY, HALF SWALLOWED BY THE EARTH." },
  masonry: { box: [18, 8] },
  stoneslab: { flat: true },
  cairn: { box: [14, 6] },
  standingstone: { box: [12, 6] },
  statue_toppled: { box: [30, 10] },
  /** A squared block peeking through the soil along a buried wall line. */
  capstone: { flat: true, examine: "A SQUARED STONE, SUNK DEEP. THE EARTH AROUND IT RINGS HOLLOW." },
  // ---- dungeon: the collapsed surface gate
  rockpile: { box: [16, 8] },
  runesite: { rune: true },
  runecircle: { rune: true },
  chains: { wallMounted: true },
  ...TOWN_PROPS,
};

const NONE: PropKindDef = {};
export const propDef = (kind: string): PropKindDef => PROPS[kind] ?? NONE;

/** Interaction radius used for props (matches the original tuning). */
export const propReach = (kind: string) => Math.min(30, 12 + (propDef(kind).box?.[0] ?? 12) / 2);
