// The camera (presentation only): where the view's top-left sits in world px,
// how it follows its target, and the screen shake. Split out of game.ts. The
// shake honours the accessibility settings (off, or scaled down).
import { clamp } from "../util";

export class Camera {
  x = 0;
  y = 0;
  /** Seconds of shake left, and how hard (px). */
  shakeT = 0;
  shakeMag = 0;
  /** Settings: screen shake on/off, and its strength (0..1). */
  shakeOn = true;
  shakeScale = 1;

  /** Shake for `t` seconds at `m` px (the larger of this and any shake already running). */
  shake(t: number, m: number) {
    if (!this.shakeOn || this.shakeScale <= 0) return;
    this.shakeT = Math.max(this.shakeT, t);
    this.shakeMag = Math.max(this.shakeMag, m * this.shakeScale);
  }

  /** Ease toward a target top-left (frame-rate independent enough for the eased follow the game has always had). */
  follow(tx: number, ty: number, dt: number, rate = 3.5) {
    const k = Math.min(1, dt * rate);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  /** Let the shake run down. */
  decay(dt: number) {
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT <= 0) this.shakeMag = 0;
  }

  /** The rounded, shaken top-left this frame is drawn from. */
  view(): { x: number; y: number } {
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      sx = (Math.random() - 0.5) * this.shakeMag * 2;
      sy = (Math.random() - 0.5) * this.shakeMag * 2;
    }
    return { x: Math.round(this.x + sx), y: Math.round(this.y + sy) };
  }

  /** Snap so that (px, py) sits mid-view (`lift` px above the middle), kept inside an `aw` x `ah` px area. */
  centre(px: number, py: number, aw: number, ah: number, vw: number, vh: number, lift = 12) {
    this.x = clamp(px - vw / 2, 0, Math.max(0, aw - vw));
    this.y = clamp(py - lift - vh / 2, 0, Math.max(0, ah - vh));
  }

  /** A point on the base-size layers (bw x bh, e.g. the 320x180 UI) to world px, for a vw x vh view. */
  toWorld(bx: number, by: number, vw: number, vh: number, bw: number, bh: number): { x: number; y: number } {
    return { x: this.x + (bx * vw) / bw, y: this.y + (by * vh) / bh };
  }

  /** World px to a point on a layer of lw x lh logical px showing a vw x vh view. */
  toLayer(wx: number, wy: number, vw: number, vh: number, lw: number, lh: number): { x: number; y: number } {
    return { x: ((wx - this.x) * lw) / vw, y: ((wy - this.y) * lh) / vh };
  }
}
