import type { ItemTag } from "./items";

export type Highlight = "important" | "interactable" | "npc" | "buildable";
/**
 * How a category's hologram is drawn over the sprite (view/vision.ts), so the
 * categories differ in treatment as well as hue:
 * - `radiant`   solid glowing fill, scanlines climbing through it, a bright rim (things that matter most)
 * - `wireframe` outline plus the sprite's own internal edges as faint lines (quietest: there are many)
 * - `signal`    interlaced rows and an occasional sideways glitch (something alive looking back)
 * - `blueprint` marching dashed outline over a dot grid (a pattern the golem can read and rebuild)
 */
export type HoloEffect = "radiant" | "wireframe" | "signal" | "blueprint";
export const VISION_CATEGORIES: Record<Highlight, { color: string; effect: HoloEffect }> = {
  important: { color: "#ffd27a", effect: "radiant" }, interactable: { color: "#74dce2", effect: "wireframe" },
  npc: { color: "#c5a0ff", effect: "signal" }, buildable: { color: "#97d38a", effect: "blueprint" },
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
