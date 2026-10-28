// Item definitions (data). Adding an item = adding an entry here plus its icon
// in art.ts (ITEM_ART). Interaction, inventory and UI code read behaviour from
// these fields instead of switching on item ids.
import { GLYPHS } from "./glyphs";
import { FLAGS } from "./flags";
import { RUNE_SWIFT_SPEED_BONUS, RUNE_GLOW_LIGHT, GOLEM_LIGHT, type GearKind, type GearSlot, type GolemLight } from "./gear";

export type { GearKind, GearSlot } from "./gear";
export { GEAR_SLOTS } from "./gear";

export type ItemId =
  | "chisel" | "arm" | "key" | "core"
  | "glyph0" | "glyph1" | "glyph2" | "glyph3"
  | "schematic" | "crown" | "goblet" | "coin"
  | "wood" | "stone" | "planks" | "cut_stone" | "basket"
  | "rune_swift" | "rune_glow" | "ruby_core" | "large_ruby"
  | "book_build" | "book_repair";

export type ItemTag = "tool" | "part" | "key" | "relic" | "glyph" | "document" | "power" | "material" | "rune";

/**
 * What an item does while it is worn (data, so a new rune is just a new row).
 * Several worn items combine: speed bonuses add up, the widest light wins.
 */
export interface WornEffects {
  /** Added to the speed multiplier: 1.5 = +150%, i.e. 2.5x the base. Read by the sim (sim/step.ts). */
  speed?: number;
  /** The golem's own light while worn. Read by the light system (sim/gear.ts golemGlow -> light.ts applyGlow). */
  light?: GolemLight;
  /** A 3x3 sigil that glows on the golem's body while worn (golem.ts): colour and pattern (# = lit). */
  mark?: { col: string; pat: [string, string, string] };
}

export interface ItemDef {
  name: string;
  tags: readonly ItemTag[];
  /** Max units per inventory slot. Absent = 1 (tools and unique items don't stack). */
  stack?: number;
  /**
   * Can be dropped from the pack with Q. Defaults to true. Tutorial-critical
   * items are false so the puzzle can't be soft-locked by misplacing them.
   */
  droppable?: boolean;
  /** Rune glyph index, for glyph items. */
  glyph?: number;
  /** What the item is, for the pack's description panel: up to 3 lines, at most 34 characters each (bitmap font). */
  desc?: string[];
  /** Picking it up installs it on the golem instead of storing it (the iron arm: a `golem.*` flag, never a slot). */
  equip?: { flag: string; task: { kind: "attach"; dur: number } };
  /**
   * Gear: picked up into the pack like any item, then worn in a gear slot on
   * the body (Actor.gear) from the pack, and taken off again there. While worn
   * it is not in the pack. `kind` is which slots take it (content/gear.ts: it
   * goes in the first empty usable slot of that kind); `slot` restricts it to
   * one slot id. Capacity tiers can require it (content/inventory.ts).
   */
  wear?: { kind: GearKind; slot?: GearSlot };
  /** Effects that apply only while it is worn (runes: speed, light). */
  worn?: WornEffects;
  /** Item glows (gets a small light) while displayed on a prop. */
  glow?: { color: string; rad: number; int: number; flick: number };
  /** Drawn as a separate icon when resting on a prop (false: part of the prop sprite). */
  showOnProp?: boolean;
  /** Inventory "use" opens a reading screen. */
  opens?: "schematic" | "book";
  /** Book contents (opens: "book"). Reading grants `grants` (a know.* flag). */
  book?: { title: string; pages: string[][]; grants?: string };
  /** Reading screen opens automatically shortly after pickup. */
  opensOnPickup?: boolean;
}

const glyph = (i: number): ItemDef => ({
  name: GLYPHS[i].name, tags: ["glyph"], glyph: i, droppable: false,
  desc: ["A CARVED RUNE GLYPH.", "IT BELONGS ON A PEDESTAL."],
  glow: { color: GLYPHS[i].color, rad: 30, int: 0.55, flick: 0.05 },
});

export const ITEMS: Record<ItemId, ItemDef> = {
  chisel: { name: "RUNE CHISEL", tags: ["tool"], droppable: false, desc: ["A CHISEL FOR CARVING RUNES.", "CARRY IT TO CARVE. IT IS", "NEVER USED UP."] },
  arm: { name: "IRON ARM", tags: ["part"], droppable: false, desc: ["AN IRON ARM FOR YOUR BROKEN", "SIDE. IT BOLTS ON AT ONCE."], equip: { flag: FLAGS.golemArm, task: { kind: "attach", dur: 1.8 } } },
  key: { name: "RUSTED KEY", tags: ["key"], droppable: false, desc: ["A RUSTED KEY. IT FITS SOME", "OLD LOCK IN THE RUINS."] },
  core: { name: "AETHER CORE", tags: ["power"], droppable: false, desc: ["AN AETHER CORE. THE CIRCLE", "NEEDS IT TO WAKE. IT STAYS", "IN YOUR PACK, NOT ON YOU."] },
  // The ruby chain: the crown's gem, carved at a bench into the one core that can power a worker golem.
  ruby_core: { name: "RUBY GOLEM CORE", tags: ["power"], desc: ["A FIRST-TIER CORE FOR A WORKER.", "FACE A GOLEM, C TO SLOT IT IN.", "C AGAIN TAKES IT BACK OUT."] },
  large_ruby: { name: "HIGH-GRADE RUBY", tags: ["material"], stack: 10, desc: ["A LARGE RUBY, CUT CLEAN AND", "DEEP RED. FINE ENOUGH TO", "CARVE INTO A GOLEM CORE."] },
  glyph0: glyph(0), glyph1: glyph(1), glyph2: glyph(2), glyph3: glyph(3),
  schematic: { name: "SCHEMATIC", tags: ["document"], droppable: false, showOnProp: false, desc: ["THE PLAN OF THE CIRCLE.", "E TO STUDY IT AGAIN."], opens: "schematic", opensOnPickup: true },
  crown: { name: "BROKEN CROWN", tags: ["relic"], desc: ["A BROKEN CROWN. NO ONE", "RULES HERE ANY MORE."] },
  goblet: { name: "SILVER GOBLET", tags: ["relic"], desc: ["A SILVER GOBLET, DULL WITH", "AGE."] },
  coin: { name: "OLD COIN", tags: ["relic"], desc: ["AN OLD COIN FROM A LOST", "REALM."] },
  wood: { name: "WOOD", tags: ["material"], stack: 20, desc: ["ROUGH TIMBER. SAW IT INTO", "PLANKS AT A CRAFTING BENCH."] },
  stone: { name: "STONE", tags: ["material"], stack: 20, desc: ["ROUGH STONE. CUT IT AT A", "CRAFTING BENCH."] },
  // Processed materials (crafted at a bench: content/crafting.ts).
  planks: { name: "PLANKS", tags: ["material"], stack: 20, desc: ["SAWN PLANKS, FOR FINER", "BUILDS AND FURNITURE."] },
  cut_stone: { name: "CUT STONE", tags: ["material"], stack: 10, desc: ["SQUARED BLOCKS OF STONE, FOR", "MASONRY AND RUNE CARVING."] },
  // Gear for the back slot: an ordinary pack item until it is worn (sim/gear.ts); worn, it grows the pack.
  basket: { name: "WOVEN BASKET", tags: ["part"], wear: { kind: "back" }, desc: ["A WOVEN BASKET. STRAP IT TO", "YOUR BACK TO CARRY MORE."] },
  // Runes: worn in a rune slot, their effects apply only while worn.
  rune_swift: {
    name: "RUNE OF SWIFT", tags: ["rune"], wear: { kind: "rune" }, desc: ["A STONE CARVED WITH THE SIGN", "OF SWIFTNESS."],
    worn: { speed: RUNE_SWIFT_SPEED_BONUS, mark: { col: "#5cf0c8", pat: ["#..", ".#.", "#.."] } },
  },
  rune_glow: {
    name: "RUNE OF GLOW", tags: ["rune"], wear: { kind: "rune" }, desc: ["A STONE CARVED WITH THE SIGN", "OF LIGHT."],
    worn: { light: RUNE_GLOW_LIGHT, mark: { col: "#ffffff", pat: [".#.", "###", ".#."] } },
  },
  book_build: {
    name: "BUILDER'S PRIMER", tags: ["document"], opens: "book", opensOnPickup: true, desc: ["HOW TO RAISE THINGS. READING", "IT TEACHES BUILDING (E)."],
    book: {
      title: "ON RAISING THINGS", grants: FLAGS.knowBuild,
      pages: [
        ["EVERY WORK BEGINS WITH", "GROUND THAT WILL BEAR IT.", "CLEAR THE PLACE. JUDGE", "IT LEVEL AND FIRM."],
        ["GATHER MATERIAL FIRST.", "TIMBER FOR FRAME AND", "FIRE. STONE FOR FOOTING", "AND FOR WEIGHT."],
        ["MEASURE TWICE, SET ONCE.", "A THING BADLY PLACED", "IS WORSE THAN NOTHING.", "(PRESS B TO BUILD)"],
      ],
    },
  },
  book_repair: {
    name: "MENDER'S MANUAL", tags: ["document"], opens: "book", opensOnPickup: true, desc: ["A WATER-DAMAGED BOOK ON", "MENDING (E TO READ)."],
    book: {
      title: "ON MENDING", grants: FLAGS.knowRepair,
      pages: [["WHAT WAS WHOLE REMEMBERS", "ITS SHAPE. THE MENDER", "ONLY REMINDS IT.", "(THE REST IS WATER-DAMAGED)"]],
    },
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const ITEM_NAMES = Object.fromEntries(ITEM_IDS.map((id) => [id, ITEMS[id].name])) as Record<ItemId, string>;
export const RELICS: ItemId[] = ITEM_IDS.filter((id) => ITEMS[id].tags.includes("relic"));
export const isGlyph = (id: ItemId) => ITEMS[id].glyph !== undefined;
export const glyphItem = (gi: number) => ("glyph" + gi) as ItemId;
export const maxStack = (id: ItemId) => ITEMS[id].stack ?? 1;
export const isDroppable = (id: ItemId) => ITEMS[id].droppable !== false;
/**
 * Progress hangs on it: the tutorial's items (the ones that can't be dropped) and
 * any book that teaches something. A prop holding one can't be taken apart until
 * the item is taken (sim/build.ts: deconstructCheck), so it is never put in play
 * loose by a deconstruction.
 */
export const isCritical = (id: ItemId) => ITEMS[id].droppable === false || !!ITEMS[id].book?.grants;

/** The effect lines the pack shows for a worn item (generated from its data, so a new rune describes itself). The font has no percent sign: multipliers. */
export function effectLines(id: ItemId): string[] {
  const w = ITEMS[id].worn, out: string[] = [];
  if (!w) return out;
  if (w.speed) out.push(`WORN: SPEED X${(1 + w.speed).toFixed(1)}`);
  if (w.light) out.push(`WORN: BRIGHT WHITE LIGHT X${(w.light.rad / GOLEM_LIGHT.rad).toFixed(1)}`);
  return out;
}
