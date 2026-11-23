// Shared presentation helpers for overlay screens (build menu, crafting):
// the pack's bevelled frame, a keyboard text field, and fitted sprite previews.
// Presentation only (canvas); the sim never imports this.
//
// Frames, slots and sprites are drawn on the scaled UI canvas, laid out on the 320x180 grid (centred in it).
// Text is not: screens write through ui/text.ts (`label`, `hints`, `flow`),
// which puts it on the hi-res layer in the mixed-case v2 face.
import { FONT_GLYPHS } from "../font";
import { label, labelW, clipLabel, clipLabelLeft, flow, hints, occlude, cellH, fontUnit, type Hint } from "./text";
import type { Sprite } from "../util";
import type { Sfx } from "../audio";
import type { ScreenStack } from "./screens";
import type { World, Actor } from "../world/world";
import type { Area } from "../world/area";
import type { ItemId } from "../content/items";

/**
 * What a screen module needs from the host (Game). Keeps screens out of game.ts.
 * The host owns input, the screen stack, camera, particles, audio and the
 * render loop; screens only read state and call back through these members.
 */
export interface UiHost {
  /** The scaled UI canvas: the HUD and the overlay screens draw their frames and sprites here (ui/scale.ts). */
  readonly ctx: CanvasRenderingContext2D;
  /** The fixed 320x180 canvas, which never scales: cutscene cards, the dialogue box, the letterbox. */
  readonly fctx: CanvasRenderingContext2D;
  /** A height on the fixed layer as a height on the scaled UI canvas (a notice placed above the dialogue box). */
  fromFixedY(y: number): number;
  readonly wctx: CanvasRenderingContext2D;
  readonly world: World;
  readonly pl: Actor;
  readonly area: Area;
  readonly t: number;
  readonly cam: { x: number; y: number };
  readonly vw: number;
  readonly vh: number;
  readonly sfx: Sfx;
  readonly screens: ScreenStack;
  /** Printable characters typed this frame (raw case), plus "\b" for Backspace. */
  readonly typed: readonly string[];
  hit(...k: string[]): boolean;
  say(text: string): void;
  renderNote(y?: number): void;
  drainEvents(): void;
  /** The item-received toast, drawn at a given height (overlays that cover the HUD place it themselves). */
  renderToast(y: number): void;
  /** Open an item's reading screen (book or schematic), as using it from the pack does. */
  read(id: ItemId): void;
  /** Flash the golem's eye (presentation only), e.g. on a moment of insight. */
  boostEye(level: number): void;
  /** Advance world presentation one frame (camera, lights, particles, NPC poses) without simulating. */
  animate(dt: number): void;
}

export const UI = {
  text: "#d8d0b8", title: "#e8d8b0", dim: "#6a6372", mid: "#8a8392", ok: "#7ae08a", bad: "#e08a7a",
  gold: "#c9a040", amber: "#f0b050", lock: "#5a5462",
} as const;

/** The pack's bevelled frame. */
export function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, edge = "#3a3540", hi = "#4e4856") {
  ctx.fillStyle = "#08070a"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = edge; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = hi; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = fill; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}

/** A panel with the pack's corner rivets. It covers what is beneath it on both canvases (the HUD's text is on the hi-res one). */
export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  occlude(ctx, x - 1, y - 1, w + 2, h + 2);
  frame(ctx, x, y, w, h, "#141117");
  for (const [cx, cy] of [[x + 3, y + 3], [x + w - 5, y + 3], [x + 3, y + h - 5], [x + w - 5, y + h - 5]]) { ctx.fillStyle = "#6a6372"; ctx.fillRect(cx, cy, 2, 2); }
}

/** A selection frame colour that pulses like the pack cursor. */
export const selEdge = (t: number) => (Math.sin(t * 6) > 0 ? "#c8b88a" : "#9a8c66");

/**
 * Draw a sprite centred in a box: 1x if it fits, else halved (integer steps
 * keep the pixel art crisp). `alpha` dims locked entries; `dark` draws a silhouette.
 */
export function drawFitted(ctx: CanvasRenderingContext2D, s: Sprite, cx: number, cy: number, box: number, alpha = 1) {
  const w = s.a.width, h = s.a.height;
  const k = Math.max(w, h) <= box ? 1 : Math.max(w, h) <= box * 2 ? 0.5 : 0.25;
  const dw = Math.round(w * k), dh = Math.round(h * k);
  ctx.globalAlpha = alpha;
  ctx.drawImage(s.a, Math.round(cx - dw / 2), Math.round(cy - dh / 2), dw, dh);
  ctx.globalAlpha = 1;
}

/** What the pack, storage and transfer screens say about the thing under the cursor. */
export interface Blurb {
  /** Its name (shown as a title, bold) and a quiet note beside it (its tags, "Empty", "Locked"). */
  name: string; sub?: string; subCol?: string;
  /** Running text, as content writes it (hand-wrapped lines of capitals): flowed again to the width there is. */
  lines?: readonly string[]; linesCol?: string;
  /** Lines of their own under the text (what the item does while worn). */
  facts?: readonly string[];
  /** Up to three key hints at the right ("E TAKE OFF"), and the row they start on. */
  keys?: readonly (string | readonly Hint[])[]; keysY?: number;
}

/** The description block: `x` is where its text starts, `y` the top of its box, `right` the edge the keys sit against. */
export function describe(ctx: CanvasRenderingContext2D, x: number, y: number, right: number, b: Blurb) {
  const keys = (b.keys ?? []).slice(0, 3), room = right - x - (keys.length ? 100 : 0);
  const name = clipLabel(b.name, Math.min(130, room), { case: "title", bold: true });
  label(ctx, name, x, y + 5, UI.title, "left", { case: "raw", bold: true });
  const nw = labelW(name, { case: "raw", bold: true });
  if (b.sub) label(ctx, clipLabel(b.sub, Math.max(20, right - x - nw - 8)), x + nw + 6, y + 5, b.subCol ?? UI.dim, "left", { case: "raw" });
  const facts = (b.facts ?? []).slice(0, 2);
  const text = flow(b.lines ?? [], room, Math.max(1, 3 - facts.length));
  text.forEach((l, i) => label(ctx, l, x, y + 13 + i * 6, b.linesCol ?? "#b8ac90", "left", { case: "raw" }));
  facts.forEach((l, i) => label(ctx, clipLabel(l, room), x, y + 13 + (text.length + i) * 6, UI.gold, "left", { case: "raw" }));
  keys.forEach((k, i) => hints(ctx, k, right, y + (b.keysY ?? (keys.length > 2 ? 6 : 13)) + i * 8, i === 0 ? UI.text : UI.dim, "right", 98));
}

/** Text as the interface shows it (ui/text.ts), clipped to a width in base px. Measured, not counted. */
export function clipText(s: string, maxW: number) {
  return clipLabel(s, maxW);
}

/**
 * A one-line text field fed from the host's typed characters. What is typed is
 * kept as the sim keeps names: capitals, and only glyphs the capital font can
 * draw (a name may be spoken in a dialogue box). It is shown as a name is shown
 * everywhere else in the interface, in mixed case. While a field is active the
 * screen routes letters to it instead of treating them as commands, so typing
 * "WASD" or "E" never moves the cursor or confirms anything.
 */
export class TextField {
  value = "";
  active = false;
  constructor(public max = 18) {}
  /** Apply this frame's typing; returns true if the value changed. */
  feed(typed: readonly string[]): boolean {
    let changed = false;
    for (const ch of typed) {
      if (ch === "\b") { if (this.value) { this.value = this.value.slice(0, -1); changed = true; } continue; }
      const c = ch.toUpperCase();
      if (c.length !== 1 || !FONT_GLYPHS.has(c) || this.value.length >= this.max) continue;
      if (c === " " && (!this.value || this.value.endsWith(" "))) continue;
      this.value += c; changed = true;
    }
    return changed;
  }
  clear() { this.value = ""; }
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, t: number, placeholder: string) {
    frame(ctx, x, y, w, 11, this.active ? "#1c1820" : "#100e12", this.active ? selEdge(t) : "#2a2630", this.active ? "#e8d8a8" : "#3a3540");
    if (!this.value && !this.active) { hints(ctx, placeholder, x + 4, y + 3, UI.dim); return; }
    const shown = clipLabelLeft(this.value, w - 12, { case: "title" });
    label(ctx, shown, x + 4, y + 3, UI.text, "left", { case: "raw" });
    if (this.active && Math.sin(t * 8) > -0.2) {
      // the caret: as tall as the face it follows
      const u = fontUnit(), h = u ? cellH() : 7, cy = u ? y + 3 + (5 - 7 * u) / 2 - u : y + 2;
      // a trailing space is typed but not yet followed by a letter: keep the caret after it
      const tail = this.value.endsWith(" ") ? labelW("a a") - labelW("aa") : 0;
      ctx.fillStyle = UI.title; ctx.fillRect(Math.round(x + 4 + labelW(shown, { case: "raw" }) + tail + 1), Math.round(cy), 1, Math.max(5, Math.round(h)));
    }
  }
}
