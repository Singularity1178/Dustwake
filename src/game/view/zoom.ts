// Zoom model (presentation only; never enters the sim or the save). A zoom
// level z shows z times more world: the world canvas is (W*z) x (H*z) with
// 1 world pixel = 1 canvas pixel, and the page scales it into the same display
// rect as the base-size UI layer, so it stays pixel-crisp. Sizes snap to
// multiples of 16x9 so the view is always integer-sized and exactly 16:9.
// Pure: tested headless.

/** Base logical size. HUD and overlay screens are laid out for it. */
export const BASE_W = 320, BASE_H = 180;
/** Wheel steps once the eye is mended (1x = the original view). */
export const ZOOM_STEPS = [1, 1.5, 2] as const;
/** Default once the golem's eye is mended (golem.eye). Before that the view is fixed at 1x. */
export const ZOOM_DEFAULT = 1.5;

export const viewSize = (z: number) => { const k = Math.round((BASE_W / 16) * z); return { w: 16 * k, h: 9 * k }; };

/** The wheel's next step from the current (or target) zoom; dir > 0 zooms out. */
export function nextZoomStep(cur: number, dir: number): number {
  let i = 0;
  ZOOM_STEPS.forEach((z, j) => { if (Math.abs(z - cur) < Math.abs(ZOOM_STEPS[i] - cur)) i = j; });
  const n = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + (dir > 0 ? 1 : -1)));
  return ZOOM_STEPS[n];
}
