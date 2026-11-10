// Crafting recipes (data) for work stations such as the crafting bench.
//
// A recipe turns `inputs` from the pack plus nearby storage into `output`.
// The crafting screen lists these rows and its CRAFT
// button calls sim/crafting.ts: orderCraft, which starts a `craft` task whose
// `craft` effect re-validates when it fires, consumes the inputs and gives the
// output (overflow lands on the ground, as for any pickup; nothing is deleted).
// `tools` are items that must be carried but are never used up (the rune
// chisel). Ratios and durations live only in these rows, so tuning is editing a
// number here.
//
// Knowledge: a station can be used by anyone, but its plans can only be read by
// someone who knows the craft (STATION_REQUIRES). Without it the screen still
// opens, greyed out and empty, so the bench is never a dead prop. Every recipe
// below, rune carving included, is unlocked by the existing building knowledge
// (`know.build`, the Builder's Primer): no separate crafting flag or book, and
// no analysis: nothing at a bench is ever gated by golem vision, so the ruby
// chain (crown -> High-Grade Ruby -> Ruby Golem Core) needs only the Primer.
//
// Inverse rows (`mode: "deconstruct"`, ids `unmake_*`) take a crafted thing
// back apart for less than it cost. They never value their output (rawValue).
import type { ItemId } from "./items";
import type { Requirement } from "./interactions";
import type { Cost } from "./build";
import { FLAGS } from "./flags";
import {
  TOOL_TYPES, TOOL_TYPE_IDS, TOOL_RUNES, FORGE_COST, REPAIR_COST, TEMPER_COST, HAFT_WOOD,
  headId, rustedHeadId, fineHeadId, runedHeadId, fullToolId, fineToolId, runeItemId,
} from "./tools";

/** The station UIs (PropKindDef.station): the crafting bench, the smelter, the anvil. */
export type StationId = "crafting" | "smelting" | "smithing";

/** A tab of a station's screen: the rows whose `tab` is its id. */
export interface StationTab { id: string; name: string; /** The action button's word. */ verb: string; /** Shown when the tab has nothing to list (up to 3 lines of 22). */ empty: string[] }

/**
 * What a station is to the screen and the rules (data): its title, the prop
 * kind whose sprite heads the screen, the action's word, what a crafter must
 * know before it shows any plans, what it says while that is unknown, its
 * accent colour, and its tabs if it has more than one list.
 */
export interface StationDef {
  name: string; prop: string; verb: string; requires: Requirement;
  lockedText: string; lockedHint: string; accent: string; tabs?: readonly StationTab[];
}

export const STATIONS: Record<StationId, StationDef> = {
  crafting: {
    name: "CRAFTING BENCH", prop: "workbench", verb: "CRAFT", requires: { flags: [FLAGS.knowBuild] },
    lockedText: "YOU DON'T KNOW HOW TO CRAFT YET", lockedHint: "FIND OUT HOW TO BUILD.", accent: "#e8d8a8",
  },
  // Smelting is read off a smelter with golem vision (content/build.ts: the SMELTER row `teaches` it), not out of a book.
  smelting: {
    name: "SMELTER", prop: "forge", verb: "SMELT", requires: { flags: [FLAGS.knowSmelt] },
    lockedText: "YOU DON'T KNOW HOW TO SMELT YET", lockedHint: "STUDY A SMELTER: Z, THEN E.", accent: "#ffa860",
  },
  smithing: {
    name: "ANVIL", prop: "anvil", verb: "FORGE", requires: { flags: [FLAGS.knowBuild] },
    lockedText: "YOU DON'T KNOW HOW TO SMITH YET", lockedHint: "FIND OUT HOW TO BUILD.", accent: "#a8d0f0",
    tabs: [
      { id: "forge", name: "FORGE", verb: "FORGE", empty: ["NOTHING TO FORGE."] },
      { id: "repair", name: "REPAIR", verb: "REPAIR", empty: ["NOTHING TO REPAIR.", "CARRY A RUSTED HEAD."] },
      { id: "modify", name: "MODIFY", verb: "TEMPER", empty: ["NOTHING TO MODIFY.", "CARRY A TOOL OR A HEAD.", "TAKE IT OFF YOUR ARM."] },
      { id: "runes", name: "RUNES", verb: "SET", empty: ["NO HEAD TO SET A RUNE", "IN. IT MUST BE FINE", "(TEMPERED) IRON."] },
    ],
  },
};
export const STATION_IDS = Object.keys(STATIONS) as StationId[];
export const isStation = (s: string): s is StationId => s in STATIONS;

export interface CraftRecipe {
  id: string;
  /** Inverse rows never define the raw-material value of their output. */
  mode?: "craft" | "deconstruct";
  /** Explicit canonical valuation row when there are alternative forward recipes. */
  valuation?: boolean;
  /** Bitmap font only (uppercase, FONT_GLYPHS). */
  name: string;
  /** Station UI that offers it (PropKindDef.station). */
  station: StationId;
  /** The station tab that lists it (StationDef.tabs). */
  tab?: string;
  /** The action button's word for this row, if not its tab's or its station's. */
  verb?: string;
  /**
   * The piece this row works on (one of its inputs). A row with `work` is only
   * listed while that piece is at hand, so the repair, modify and rune lists
   * show what can be done to the tools the crafter brought, not every variant.
   */
  work?: ItemId;
  /** Given as well as `output` (a rune pried back out of a head). */
  also?: Cost[];
  /** Up to 3 lines, at most 30 characters each. */
  desc: string[];
  /** Consumed from the crafter's pack. */
  inputs: Cost[];
  /** Carried but not consumed (e.g. the rune chisel). */
  tools?: ItemId[];
  output: { item: ItemId; n: number };
  /** Extra requirement beyond the station's own knowledge (none today: building knowledge covers all of them). */
  requires?: Requirement;
  /** Seconds of work. Default 1.2. */
  dur?: number;
}

/** What a crafter must know before a station shows any plans (from STATIONS). The bench and the anvil: building. The smelter: smelting. */
export const STATION_REQUIRES: Record<string, Requirement> = Object.fromEntries(STATION_IDS.map((id) => [id, STATIONS[id].requires]));

export const CRAFT_DUR = 1.2;

export const CRAFT_RECIPES: CraftRecipe[] = [
  {
    id: "planks", name: "PLANKS", station: "crafting", dur: 1.0,
    desc: ["SAW ROUGH WOOD INTO PLANKS", "FOR TABLES, CHAIRS, BANNERS", "AND OTHER FINER BUILDS."],
    inputs: [{ item: "wood", n: 2 }], output: { item: "planks", n: 3 },
  },
  {
    id: "cut_stone", name: "CUT STONE", station: "crafting", dur: 1.4,
    desc: ["SQUARE ROUGH STONE INTO", "BLOCKS. SOME IS LOST IN THE", "CUTTING."],
    inputs: [{ item: "stone", n: 3 }], output: { item: "cut_stone", n: 2 },
  },
  {
    id: "rune_swift", name: "RUNE OF SWIFT", station: "crafting", dur: 2.4,
    desc: ["CARVE THE SIGN OF SWIFTNESS", "INTO CUT STONE. NEEDS THE", "RUNE CHISEL IN YOUR PACK."],
    inputs: [{ item: "cut_stone", n: 2 }], tools: ["chisel"], output: { item: "rune_swift", n: 1 },
  },
  {
    id: "rune_glow", name: "RUNE OF GLOW", station: "crafting", dur: 2.4,
    desc: ["CARVE THE SIGN OF LIGHT", "INTO CUT STONE. NEEDS THE", "RUNE CHISEL IN YOUR PACK."],
    inputs: [{ item: "cut_stone", n: 3 }], tools: ["chisel"], output: { item: "rune_glow", n: 1 },
  },
  {
    // The crown holds the game's one High-Grade Ruby, so exactly one core can ever be carved.
    id: "ruby_core", name: "RUBY GOLEM CORE", station: "crafting", dur: 2.4,
    desc: ["CARVE THE HIGH-GRADE RUBY", "INTO A GOLEM CORE. NEEDS THE", "RUNE CHISEL IN YOUR PACK."],
    inputs: [{ item: "large_ruby", n: 1 }], tools: ["chisel"], output: { item: "ruby_core", n: 1 },
  },
  // ---- inverse rows: names stay distinct (and within the list's 20 characters) so each reads on its own.
  {
    id: "unmake_crown", mode: "deconstruct", name: "UNMAKE BROKEN CROWN", station: "crafting", dur: 1.6,
    desc: ["PRY THE HIGH-GRADE RUBY OUT", "OF THE BROKEN CROWN. ITS", "SOFT GOLD IS OF NO USE."],
    inputs: [{ item: "crown", n: 1 }], output: { item: "large_ruby", n: 1 },
  },
  ...([["rune_swift", "SWIFT"], ["rune_glow", "GLOW"]] as const).map(([item, sign]): CraftRecipe => ({
    id: `unmake_${item}`, mode: "deconstruct", name: `UNMAKE RUNE OF ${sign}`, station: "crafting",
    desc: ["GRIND THE SIGN OFF A RUNE OF", `${sign}. ONE ROUGH STONE IS`, "ALL THAT IS LEFT."],
    inputs: [{ item, n: 1 }], output: { item: "stone", n: 1 },
  })),
  // ---- the crafting bench: a head on a wooden haft is a full tool, for hands (content/tools.ts)
  ...TOOL_TYPE_IDS.flatMap((t): CraftRecipe[] => [
    {
      id: fullToolId(t), name: TOOL_TYPES[t].full, station: "crafting", dur: 1.2,
      desc: [`FIT A ${TOOL_TYPES[t].name} HEAD TO A WOODEN`, "HAFT: A TOOL FOR HANDS. GIVE", "IT TO A WORKER."],
      inputs: [{ item: headId(t), n: 1 }, { item: "wood", n: HAFT_WOOD }], output: { item: fullToolId(t), n: 1 },
    },
    {
      id: fineToolId(t), name: `FINE ${TOOL_TYPES[t].full}`, station: "crafting", dur: 1.2, work: fineHeadId(t),
      desc: [`HAFT A FINE ${TOOL_TYPES[t].name} HEAD: A`, "TEMPERED TOOL FOR HANDS."],
      inputs: [{ item: fineHeadId(t), n: 1 }, { item: "wood", n: HAFT_WOOD }], output: { item: fineToolId(t), n: 1 },
    },
  ]),
  // ---- the smelter: ore and a wood fire in, ingots out
  {
    id: "iron_ingot", name: "IRON INGOT", station: "smelting", dur: 2.6,
    desc: ["MELT IRON ORE OVER A WOOD", "FIRE AND POUR IT INTO BARS."],
    inputs: [{ item: "iron_ore", n: 2 }, { item: "wood", n: 1 }], output: { item: "iron_ingot", n: 2 },
  },
  {
    id: "iron_ingot_charge", name: "INGOTS, FULL CHARGE", station: "smelting", dur: 5, valuation: false,
    desc: ["FILL THE CRUCIBLE. A FULL", "CHARGE WASTES LESS FUEL."],
    inputs: [{ item: "iron_ore", n: 6 }, { item: "wood", n: 2 }], output: { item: "iron_ingot", n: 6 },
  },
  // ---- the anvil. FORGE: ingots into tool heads.
  ...TOOL_TYPE_IDS.map((t): CraftRecipe => ({
    id: headId(t), name: `${TOOL_TYPES[t].name} HEAD`, station: "smithing", tab: "forge", dur: 2.4,
    desc: [`HAMMER ${FORGE_COST[t]} IRON INGOTS INTO A`, `${TOOL_TYPES[t].name} HEAD. FIT IT TO AN ARM`, "OR HAFT IT AT A BENCH."],
    inputs: [{ item: "iron_ingot", n: FORGE_COST[t] }], output: { item: headId(t), n: 1 },
  })),
  // REPAIR: what time ruined, made sound for less iron than a new one. Never the head's valuation row.
  ...TOOL_TYPE_IDS.map((t): CraftRecipe => ({
    id: `repair_${headId(t)}`, name: `REPAIR ${TOOL_TYPES[t].name} HEAD`, station: "smithing", tab: "repair", dur: 1.6, valuation: false, work: rustedHeadId(t),
    desc: ["BURN OFF THE RUST AND WELD", "NEW IRON INTO THE OLD HEAD."],
    inputs: [{ item: rustedHeadId(t), n: 1 }, { item: "iron_ingot", n: REPAIR_COST }], output: { item: headId(t), n: 1 },
  })),
  // MODIFY: temper a head, or a tool on its haft.
  ...TOOL_TYPE_IDS.flatMap((t): CraftRecipe[] => [
    {
      id: `temper_${headId(t)}`, name: `TEMPER ${TOOL_TYPES[t].name} HEAD`, station: "smithing", tab: "modify", dur: 2.6, work: headId(t),
      desc: ["FOLD IN MORE IRON AND QUENCH", "IT. BITES DEEPER, AND WILL", "HOLD A RUNE."],
      inputs: [{ item: headId(t), n: 1 }, { item: "iron_ingot", n: TEMPER_COST }], output: { item: fineHeadId(t), n: 1 },
    },
    {
      id: `temper_${fullToolId(t)}`, name: `TEMPER ${TOOL_TYPES[t].full}`, station: "smithing", tab: "modify", dur: 2.6, valuation: false, work: fullToolId(t),
      desc: ["REWORK THE HEAD ON ITS HAFT", "WITH MORE IRON. IT BITES", "DEEPER."],
      inputs: [{ item: fullToolId(t), n: 1 }, { item: "iron_ingot", n: TEMPER_COST }], output: { item: fineToolId(t), n: 1 },
    },
  ]),
  // RUNES: set a rune into a tempered head (its worn effect then rides on the arm), or pry it back out.
  ...TOOL_TYPE_IDS.flatMap((t) => TOOL_RUNES.flatMap((r): CraftRecipe[] => [
    {
      id: `inset_${r}_${t}`, name: `${r.toUpperCase()} IN ${TOOL_TYPES[t].name} HEAD`, station: "smithing", tab: "runes", dur: 2, work: fineHeadId(t),
      desc: [`SET A RUNE OF ${r.toUpperCase()} INTO THE`, "TEMPERED HEAD. IT WORKS WHILE", "THE HEAD IS ON YOUR ARM."],
      inputs: [{ item: fineHeadId(t), n: 1 }, { item: runeItemId(r), n: 1 }], output: { item: runedHeadId(t, r), n: 1 },
    },
    {
      id: `unset_${r}_${t}`, mode: "deconstruct", name: `UNSET ${r.toUpperCase()}, ${TOOL_TYPES[t].name}`, station: "smithing", tab: "runes", verb: "UNSET", dur: 1.4, work: runedHeadId(t, r),
      desc: ["PRY THE RUNE BACK OUT. BOTH", "THE HEAD AND THE RUNE ARE", "KEPT."],
      inputs: [{ item: runedHeadId(t, r), n: 1 }], output: { item: fineHeadId(t), n: 1 }, also: [{ item: runeItemId(r), n: 1 }],
    },
  ])),
];

export const craftRecipesFor = (station: string, list: readonly CraftRecipe[] = CRAFT_RECIPES) => list.filter((r) => r.station === station);

/**
 * What one unit of an item is worth in raw materials (wood, stone and anything
 * not crafted count 1), derived from the recipe that makes it. The build menu
 * sorts by this, so a crafted material weighs what it cost to make.
 */
export function rawValue(item: ItemId, list: readonly CraftRecipe[] = CRAFT_RECIPES, _depth = 0): number {
  const value = (id: ItemId, seen: Set<ItemId>): number => {
    if (seen.has(id)) return 1;
    const rows = list.filter((r) => r.output.item === id && r.mode !== "deconstruct" && r.valuation !== false)
      .sort((a, b) => Number(!!b.valuation) - Number(!!a.valuation) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const r = rows[0];
    if (!r || r.output.n <= 0) return 1;
    const next = new Set(seen).add(id);
    return r.inputs.reduce((n, c) => n + c.n * value(c.item, next), 0) / r.output.n;
  };
  return value(item, new Set());
}
