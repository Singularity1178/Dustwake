import type { ItemTag } from "./items";

export type Highlight = "important" | "interactable" | "npc" | "buildable";
export const VISION_CATEGORIES: Record<Highlight, { color: string }> = {
  important: { color: "#ffd27a" }, interactable: { color: "#74dce2" },
  npc: { color: "#c5a0ff" }, buildable: { color: "#97d38a" },
};
/** First matching row wins. A new category rule is data, not a host branch. */
export const HIGHLIGHT_RULES: { category: Highlight; tags?: ItemTag[]; trait?: "rune" | "actor" | "buildable" | "interactable" }[] = [
  { category: "important", tags: ["rune", "glyph", "part", "document", "relic", "power"] },
  { category: "important", trait: "rune" },
  { category: "npc", trait: "actor" },
  { category: "buildable", trait: "buildable" },
  { category: "interactable", trait: "interactable" },
];
export const SCAN_DURATION = 0.9;
export const analysisFlag = (key: string) => `analysis.${key}`;