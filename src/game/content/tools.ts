// Tools (data). A tool is one of three types, and comes in two forms:
//
//   - a HEAD: forged from iron ingots at an anvil. A golem fits it straight onto
//     an arm (gear kind "arm": the right arm slot, and the left once the iron arm
//     is on). While fitted it multiplies the work of every blow against the
//     resources of its type (content/harvest.ts: HarvestDef.tool) and, for the
//     shovel and the pickaxe, lets the golem dig (content/digging.ts).
//   - a FULL tool: a head on a wooden haft, made at a crafting bench. It is for
//     hands: a body with the `wield` capability (the workers) works with it
//     from its pack. The maintainer's arms take the head itself, so a hafted
//     tool does nothing for it.
//
// Grades and insets are separate item rows generated from this table
// (content/items.ts), so the pack, gear, storage, drops and saves handle them
// like any other item: no per-item state exists anywhere.
//   plain   forged                      bonus 1
//   fine    tempered at the anvil       bonus 2, and its iron holds a rune
//   swift / glow   a fine head with that rune set in it: the rune's own worn
//           effect applies for as long as the head is fitted
//   rusted  found in the ruins: no use until an anvil repairs it
// Tools do not wear out in use. "Repair" is for what time ruined.
import type { ItemId } from "./items";

export type ToolType = "shovel" | "pickaxe" | "axe";
export const TOOL_TYPE_IDS: readonly ToolType[] = ["shovel", "pickaxe", "axe"];
export type ToolForm = "head" | "full";
/** The runes an anvil can set into a fine head (the rune item is `rune_<id>`). */
export type ToolRune = "swift" | "glow";
export const TOOL_RUNES: readonly ToolRune[] = ["swift", "glow"];

/** What an item row declares to be a working tool (ItemDef.tool). */
export interface ToolDef { type: ToolType; form: ToolForm; /** Added to the work multiplier: 1 = twice the work per blow. Digging does `bonus` units a stroke. */ bonus: number }

export const TOOL_TYPES: Record<ToolType, { /** Short name, used in "<NAME> HEAD". */ name: string; /** The hafted tool's name. */ full: string; /** What it works, for the pack's effect line. */ works: string }> = {
  shovel: { name: "SHOVEL", full: "SHOVEL", works: "DIGS EARTH" },
  pickaxe: { name: "PICK", full: "PICKAXE", works: "ROCK AND ORE" },
  axe: { name: "AXE", full: "AXE", works: "WOOD" },
};

// ---------------------------------------------------------------- tunables
export const TOOL_BONUS = { plain: 1, fine: 2 } as const;
/** Iron ingots to forge a head. */
export const FORGE_COST: Record<ToolType, number> = { shovel: 2, pickaxe: 3, axe: 3 };
/** Iron ingots to make a rusted head sound again (cheaper than forging one). */
export const REPAIR_COST = 1;
/** Iron ingots to temper a head or a hafted tool. */
export const TEMPER_COST = 2;
/** Wood for the haft of a full tool. */
export const HAFT_WOOD = 2;

// ---------------------------------------------------------------- item ids
export type HeadId = `head_${ToolType}`;
export type ToolItemId =
  | HeadId | `head_${ToolType}_rusted` | `head_${ToolType}_fine` | `head_${ToolType}_${ToolRune}`
  | ToolType | `${ToolType}_fine`;

export const headId = (t: ToolType) => `head_${t}` as const;
export const rustedHeadId = (t: ToolType) => `head_${t}_rusted` as const;
export const fineHeadId = (t: ToolType) => `head_${t}_fine` as const;
export const runedHeadId = (t: ToolType, r: ToolRune) => `head_${t}_${r}` as const;
export const fullToolId = (t: ToolType) => t;
export const fineToolId = (t: ToolType) => `${t}_fine` as const;
export const runeItemId = (r: ToolRune) => `rune_${r}` as const satisfies ItemId;
