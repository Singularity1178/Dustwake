// Shared presentation helpers for overlay screens (build menu, crafting):
// the pack's bevelled frame, a keyboard text field, and fitted sprite previews.
// Presentation only (canvas); the sim never imports this.
import { FONT_GLYPHS, drawText, textWidth } from "../font";
import type { Sprite } from "../util";
import type { Sfx } from "../audio";
import type { ScreenStack } from "./screens";
import type { World, Actor } from "../world/world";
import type { Area } from "../world/area";

/** What a screen module needs from the host (Game). Keeps screens out of game.ts. */
export interface UiHost {
  readonly ctx: CanvasRenderingContext2D;
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

/** A panel with the pack's corner rivets. */
export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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

/** Text clipped to a pixel width (the font is 4 px per character). */
export function clipText(s: string, maxW: number) {
  const n = Math.max(0, Math.floor((maxW + 1) / 4));
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + ".";
}

/**
 * A one-line text field fed from the host's typed characters. Only glyphs
 * the bitmap font can draw are accepted, uppercased. While a field is active
 * the screen routes letters to it instead of treating them as commands, so
 * typing "WASD" or "E" never moves the cursor or confirms anything.
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
    if (!this.value && !this.active) { drawText(ctx, placeholder, x + 4, y + 3, UI.dim); return; }
    const shown = clipTextLeft(this.value, w - 12);
    drawText(ctx, shown, x + 4, y + 3, UI.text);
    if (this.active && Math.sin(t * 8) > -0.2) { ctx.fillStyle = UI.title; ctx.fillRect(x + 4 + textWidth(shown) + 2, y + 2, 1, 7); }
  }
}
const clipTextLeft = (s: string, maxW: number) => { const n = Math.floor((maxW + 1) / 4); return s.length <= n ? s : s.slice(s.length - n); };
