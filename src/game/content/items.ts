// Item definitions (data). Adding an item = adding an entry here plus its icon
// in art.ts (ITEM_ART). Interaction, inventory and UI code read behaviour from
// these fields instead of switching on item ids.
import { GLYPHS } from "./glyphs";
import { FLAGS } from "./flags";

export type ItemId =
  | "chisel" | "arm" | "key" | "core"
  | "glyph0" | "glyph1" | "glyph2" | "glyph3"
  | "schematic" | "crown" | "goblet" | "coin"
  | "wood" | "stone" | "basket"
  | "book_build" | "book_repair";

export type ItemTag = "tool" | "part" | "key" | "relic" | "glyph" | "document" | "power" | "material";

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
  /** Picking it up installs it on the golem instead of storing it. */
  equip?: { flag: string; task: { kind: "attach"; dur: number } };
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
  glow: { color: GLYPHS[i].color, rad: 30, int: 0.55, flick: 0.05 },
});

export const ITEMS: Record<ItemId, ItemDef> = {
  chisel: { name: "RUNE CHISEL", tags: ["tool"], droppable: false },
  arm: { name: "IRON ARM", tags: ["part"], droppable: false, equip: { flag: FLAGS.golemArm, task: { kind: "attach", dur: 1.8 } } },
  key: { name: "RUSTED KEY", tags: ["key"], droppable: false },
  core: { name: "AETHER CORE", tags: ["power"], droppable: false },
  glyph0: glyph(0), glyph1: glyph(1), glyph2: glyph(2), glyph3: glyph(3),
  schematic: { name: "SCHEMATIC", tags: ["document"], droppable: false, showOnProp: false, opens: "schematic", opensOnPickup: true },
  crown: { name: "BROKEN CROWN", tags: ["relic"] },
  goblet: { name: "SILVER GOBLET", tags: ["relic"] },
  coin: { name: "OLD COIN", tags: ["relic"] },
  wood: { name: "WOOD", tags: ["material"], stack: 20 },
  stone: { name: "STONE", tags: ["material"], stack: 20 },
  // Installed like the iron arm: it becomes part of the golem (flag), never a slot.
  basket: { name: "WOVEN BASKET", tags: ["part"], droppable: false, equip: { flag: FLAGS.golemBasket, task: { kind: "attach", dur: 1.2 } } },
  book_build: {
    name: "BUILDER'S PRIMER", tags: ["document"], opens: "book", opensOnPickup: true,
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
    name: "MENDER'S MANUAL", tags: ["document"], opens: "book", opensOnPickup: true,
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
