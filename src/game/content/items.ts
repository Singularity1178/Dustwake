// Item definitions (data). Adding an item = adding an entry here plus its icon
// in art.ts. Interaction and UI code reads behaviour from these fields instead
// of switching on item ids.
import { GLYPHS } from "./glyphs";
import { FLAGS } from "./flags";

export type ItemId =
  | "chisel" | "arm" | "key" | "core"
  | "glyph0" | "glyph1" | "glyph2" | "glyph3"
  | "schematic" | "crown" | "goblet" | "coin";

export type ItemTag = "tool" | "part" | "key" | "relic" | "glyph" | "document" | "power";

export interface ItemDef {
  name: string;
  tags: readonly ItemTag[];
  /** Rune glyph index, for glyph items. */
  glyph?: number;
  /** Picking it up installs it on the golem instead of storing it. */
  equip?: { flag: string; task: { kind: "attach"; dur: number } };
  /** Item glows (gets a small light) while displayed on a prop. */
  glow?: { color: string; rad: number; int: number; flick: number };
  /** Drawn as a separate icon when resting on a prop (false: part of the prop sprite). */
  showOnProp?: boolean;
  /** Inventory "use" opens a reading screen. */
  opens?: "schematic";
  /** Reading screen opens automatically shortly after pickup. */
  opensOnPickup?: boolean;
}

const glyph = (i: number): ItemDef => ({
  name: GLYPHS[i].name, tags: ["glyph"], glyph: i,
  glow: { color: GLYPHS[i].color, rad: 30, int: 0.55, flick: 0.05 },
});

export const ITEMS: Record<ItemId, ItemDef> = {
  chisel: { name: "RUNE CHISEL", tags: ["tool"] },
  arm: { name: "IRON ARM", tags: ["part"], equip: { flag: FLAGS.golemArm, task: { kind: "attach", dur: 1.8 } } },
  key: { name: "RUSTED KEY", tags: ["key"] },
  core: { name: "AETHER CORE", tags: ["power"] },
  glyph0: glyph(0), glyph1: glyph(1), glyph2: glyph(2), glyph3: glyph(3),
  schematic: { name: "SCHEMATIC", tags: ["document"], showOnProp: false, opens: "schematic", opensOnPickup: true },
  crown: { name: "BROKEN CROWN", tags: ["relic"] },
  goblet: { name: "SILVER GOBLET", tags: ["relic"] },
  coin: { name: "OLD COIN", tags: ["relic"] },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const ITEM_NAMES = Object.fromEntries(ITEM_IDS.map((id) => [id, ITEMS[id].name])) as Record<ItemId, string>;
export const RELICS: ItemId[] = ITEM_IDS.filter((id) => ITEMS[id].tags.includes("relic"));
export const isGlyph = (id: ItemId) => ITEMS[id].glyph !== undefined;
export const glyphItem = (gi: number) => ("glyph" + gi) as ItemId;
