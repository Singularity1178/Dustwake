// UI scale geometry (pure): one place says how big the interface is at each setting.
//
// LARGE is the reference: the interface as it was designed, on the 320x180 grid, with the v2 font at 2/3 of a base
// pixel per font pixel. Normal and Compact are that same interface shrunk, all of it (frames, slots, sprites, text),
// to 3/4 and 1/2 of the size. So a screen is always laid out in "UI px" with the font a constant 2/3 of a UI px; the
// scale only decides how many UI px the screen has across (320, 427 or 640).
//
// Layers (App.tsx stacks them in one display rect, bottom to top):
//   world   the pixel-perfect world, W x H times the zoom
//   fixed   320 x 180: what is not interface and never scales (cutscene cards, the dialogue box, the letterbox)
//   ui      uw x uh for the scale: the HUD and the pack, storage, crafting, build, orders and debug screens
//   hi      HI_W x HI_H, always: the v2 text of fixed and ui, and the widget kit (speed bar, feed, system menu)
import { BASE_W, BASE_H } from "../view/zoom";

export type UiScaleId = "compact" | "normal" | "large";
export const UI_SCALE_IDS: readonly UiScaleId[] = ["compact", "normal", "large"];
export const DEFAULT_UI_SCALE: UiScaleId = "large";

/** The hi-res layer's canvas: 6 canvas px per base px, so a font pixel is a whole number of canvas px at every scale. */
export const HI_W = BASE_W * 6, HI_H = BASE_H * 6;

/** Hi-layer canvas px per font px at each scale (Large 4 = 2/3 of a base px; Normal 3; Compact 2). */
const FONT_PX: Record<UiScaleId, number> = { compact: 2, normal: 3, large: 4 };
/** A font px is this much of a UI px at every scale. */
export const FONT_IN_UI = 2 / 3;

export interface UiMetrics {
  id: UiScaleId;
  /** The scaled UI canvas's size in UI px (drawn 1:1, then stretched to the display rect). */
  uw: number;
  uh: number;
  /** Hi-layer canvas px per UI px. */
  s: number;
  /** Hi-layer canvas px per font px (the kit's logical px). */
  k: number;
  /** The size against Large: 1, 0.75, 0.5. */
  factor: number;
}

export function uiScaleId(v: unknown): UiScaleId {
  return v === "compact" || v === "normal" || v === "large" ? v : DEFAULT_UI_SCALE;
}

export function uiMetrics(id: UiScaleId | string): UiMetrics {
  const sid = uiScaleId(id), k = FONT_PX[sid], s = k * 1.5;
  return { id: sid, uw: Math.round(HI_W / s), uh: Math.round(HI_H / s), s, k, factor: k / FONT_PX.large };
}

/** Where fixed-layer text lands: always at the Large size, whatever the setting. */
export const FIXED_METRICS = { s: HI_W / BASE_W, k: FONT_PX.large } as const;
