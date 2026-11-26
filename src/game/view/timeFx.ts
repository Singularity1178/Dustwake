// Time-speed effects (presentation only: the sim, the save and the clock never see them). The world looks the same
// paused as it does at 1x, which makes a pause hard to notice, and nothing tells the eye that time is racing at 8x.
// So each game speed gets a look, and the look eases from one to the next:
//
//   paused  a hush: the world a little drained of colour, a soft neutral vignette that breathes slowly, and a PAUSED
//           label in the middle of the screen
//   1x      nothing at all (the baseline: no overlay is drawn, no filter is set)
//   2x      barely there: a few faint streaks drifting along the top and bottom edges
//   4x      plain to see: a richer grade, a deeper vignette, more and faster streaks and a soft band sweeping down the screen
//   8x      strong: a more saturated grade, heavy vignette, dense long streaks, a brighter sweep
//
// No speed colours the picture: there is no blue, amber or red wash, hue shift or coloured fringe. Only neutral
// darkening, saturation and white streaks.
//
// Pause and 2x are meant to be lived in, so they stay quiet; 4x and 8x are meant to be noticed. Nothing here strobes:
// the only movement is slow drift and a breathing vignette well under 1 Hz.
//
// Two layers carry it. The colour grade is a CSS filter on the world canvas (the HUD is separate canvases, so the
// interface is never tinted). The vignette, streaks and sweep are drawn on the fixed 320x180 layer,
// which sits above the world and below the UI. Textures are baked once, as image data, on first use.
import { makeCanvas } from "../util";
import { mulberry, type Rng } from "../core/rng";
import { GAME_SPEEDS, type GameSpeed } from "../core/clock";

export const TFX_W = 320;
export const TFX_H = 180;

/** Everything a speed's look is made of. All numbers, so one look can be eased into another. */
export interface TimeLook {
  /** CSS grade on the world canvas; 1 = untouched (hue in degrees, 0 = untouched). */
  sat: number; bright: number; contrast: number; hue: number;
  /** Edge vignette, for pause and for sped-up (both neutral dark), as opacity of the baked texture. */
  vigCool: number; vigWarm: number;
  /** How far the vignette breathes (opacity either way) and how fast (Hz). */
  pulseAmp: number; pulseHz: number;
  /** Streaks along the edges: how many (0..1 of the pool), how bright, how fast (px/s), how long (x). */
  streakN: number; streakA: number; streakSpeed: number; streakLen: number;
  /** A soft band sweeping down the screen: opacity and speed (px/s). */
  sweepA: number; sweepSpeed: number;
  /** Opacity of the PAUSED label in the middle of the screen. */
  pauseA: number;
}

export const NEUTRAL: Readonly<TimeLook> = {
  sat: 1, bright: 1, contrast: 1, hue: 0,
  vigCool: 0, vigWarm: 0, pulseAmp: 0, pulseHz: 0.2,
  streakN: 0, streakA: 0, streakSpeed: 200, streakLen: 1,
  sweepA: 0, sweepSpeed: 60, pauseA: 0,
};

const look = (o: Partial<TimeLook>): Readonly<TimeLook> => ({ ...NEUTRAL, ...o });

/** The look of each game speed (0 = paused). 1x is the baseline: nothing. */
export const TIME_LOOKS: Readonly<Record<GameSpeed, Readonly<TimeLook>>> = {
  0: look({ sat: 0.86, bright: 0.98, vigCool: 0.22, pulseAmp: 0.035, pulseHz: 0.15, pauseA: 1 }),
  1: look({}),
  2: look({ sat: 1.03, vigWarm: 0.13, streakN: 0.22, streakA: 0.15, streakSpeed: 220 }),
  4: look({ sat: 1.1, contrast: 1.03, vigWarm: 0.33, pulseAmp: 0.03, pulseHz: 0.35, streakN: 0.55, streakA: 0.24, streakSpeed: 430, streakLen: 1.35, sweepA: 0.06, sweepSpeed: 70 }),
  8: look({ sat: 1.22, bright: 1.02, contrast: 1.07, vigWarm: 0.4, pulseAmp: 0.05, pulseHz: 0.7, streakN: 1, streakA: 0.32, streakSpeed: 780, streakLen: 1.9, sweepA: 0.07, sweepSpeed: 135 }),
};

/** The look for a speed (an unknown speed is 1x: nothing). */
export function lookFor(speed: number): Readonly<TimeLook> {
  return TIME_LOOKS[(GAME_SPEEDS as readonly number[]).includes(speed) ? (speed as GameSpeed) : 1];
}

const KEYS = Object.keys(NEUTRAL) as (keyof TimeLook)[];
const STREAKS = 28;
/** Eased per second: about a third of a second to settle, quicker when the effect is being put away. */
const RATE_IN = 5, RATE_OUT = 9;

interface Streak { x: number; y: number; len: number; k: number; a: number }
interface Textures { vig: HTMLCanvasElement; sweep: HTMLCanvasElement }

export class TimeFx {
  /** The look as drawn now: eased toward the target look. */
  cur: TimeLook = { ...NEUTRAL };
  /** The look being eased toward. */
  target: Readonly<TimeLook> = NEUTRAL;
  /** Breathing phase (radians). */
  phase = 0;
  /** Sweep band position (px, top edge). */
  sweepY = -40;
  private rng: Rng;
  private streaks: Streak[] = [];
  private tex: Textures | null = null;
  private lastFilter = "";

  constructor(seed = 0x7157) {
    this.rng = mulberry(seed);
    for (let i = 0; i < STREAKS; i++) this.streaks.push(this.fresh(true));
  }

  /**
   * Ease toward the look for `speed` by `dt` real seconds. `on` is false when the effect should be put away: the
   * setting is off, or the play screen is not the one on top (menus and cutscenes pause the world by covering it).
   */
  update(dt: number, speed: number, on: boolean) {
    const t = (this.target = on ? lookFor(speed) : NEUTRAL);
    const k = 1 - Math.exp(-Math.max(0, dt) * (on ? RATE_IN : RATE_OUT));
    const c = this.cur;
    for (const key of KEYS) c[key] += (t[key] - c[key]) * k;
    this.phase = (this.phase + dt * c.pulseHz * Math.PI * 2) % (Math.PI * 2);
    if (this.streakCount() > 0) this.moveStreaks(dt);
    if (c.sweepA > 0.002) { this.sweepY += dt * c.sweepSpeed; if (this.sweepY > TFX_H) this.sweepY = -40; }
    // snap the last of an easing-out look to nothing, so an idle game draws and filters nothing
    if (!on && this.settled()) this.cur = { ...NEUTRAL };
  }

  private settled(): boolean {
    const c = this.cur;
    return Math.abs(c.sat - 1) < 0.004 && Math.abs(c.bright - 1) < 0.002 && Math.abs(c.contrast - 1) < 0.002 && Math.abs(c.hue) < 0.2
      && c.pauseA < 0.003 && c.vigCool < 0.003 && c.vigWarm < 0.003 && c.streakN * c.streakA < 0.002 && c.sweepA < 0.002;
  }

  /** Anything to draw or filter right now. */
  get visible(): boolean { return !this.settled(); }

  private streakCount() { return this.cur.streakA > 0.003 ? Math.round(this.cur.streakN * STREAKS) : 0; }

  /** A new streak, hugging the top or bottom edge (the middle of the screen is left clear to play in). */
  private fresh(anywhere: boolean): Streak {
    const r = this.rng, top = r() < 0.5, d = Math.pow(r(), 4) * TFX_H * 0.42;
    const len = 10 + r() * 36;
    return { x: anywhere ? r() * TFX_W : -len, y: Math.round(top ? d : TFX_H - 1 - d), len, k: 0.7 + r() * 0.7, a: 0.35 + r() * 0.65 };
  }

  private moveStreaks(dt: number) {
    const sp = this.cur.streakSpeed, n = this.streakCount();
    for (let i = 0; i < n; i++) {
      const s = this.streaks[i];
      s.x += sp * s.k * dt;
      if (s.x > TFX_W + 4) this.streaks[i] = this.fresh(false);
    }
  }

  /** The CSS `filter` for the world canvas: "" when the grade is untouched. Quantised, so it only changes when it shows. */
  filter(): string {
    const c = this.cur, parts: string[] = [];
    const q = (v: number, step: number) => Math.round(v / step) * step;
    const sat = q(c.sat, 0.01), br = q(c.bright, 0.01), co = q(c.contrast, 0.01), hue = q(c.hue, 0.5);
    if (sat !== 1) parts.push(`saturate(${sat.toFixed(2)})`);
    if (br !== 1) parts.push(`brightness(${br.toFixed(2)})`);
    if (co !== 1) parts.push(`contrast(${co.toFixed(2)})`);
    if (hue !== 0) parts.push(`hue-rotate(${hue.toFixed(1)}deg)`);
    return parts.join(" ");
  }

  /** Put the grade on the world canvas (a canvas with no style, as in the headless host, is left alone). */
  applyFilter(canvas: { style?: { filter: string } }) {
    if (!canvas.style) return;
    const f = this.filter();
    if (f !== this.lastFilter) { canvas.style.filter = f; this.lastFilter = f; }
  }

  /** Draw the overlay on the fixed 320x180 layer. Nothing is drawn when the look is neutral. */
  render(ctx: CanvasRenderingContext2D) {
    if (!this.visible) return;
    const c = this.cur, tx = (this.tex ??= bakeTextures());
    const pulse = Math.sin(this.phase) * c.pulseAmp;
    // vignettes: the breathing rides on whichever one is the stronger
    if (c.vigCool > 0.003) { ctx.globalAlpha = clamp01(c.vigCool + (c.vigCool >= c.vigWarm ? pulse : 0)); ctx.drawImage(tx.vig, 0, 0); }
    if (c.vigWarm > 0.003) { ctx.globalAlpha = clamp01(c.vigWarm + (c.vigWarm > c.vigCool ? pulse : 0)); ctx.drawImage(tx.vig, 0, 0); }
    ctx.globalAlpha = 1;
    // sweeping band
    if (c.sweepA > 0.002) { ctx.globalAlpha = c.sweepA; ctx.drawImage(tx.sweep, 0, Math.round(this.sweepY)); ctx.globalAlpha = 1; }
    // streaks
    const n = this.streakCount();
    for (let i = 0; i < n; i++) {
      const s = this.streaks[i], a = c.streakA * s.a;
      if (a < 0.01) continue;
      const len = Math.max(2, Math.round(s.len * c.streakLen)), x = Math.round(s.x - len), head = Math.max(1, len >> 2);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillRect(x, s.y, len, 1);
      // a brighter head, so the line reads as moving rather than as a scratch
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 1.6).toFixed(3)})`;
      ctx.fillRect(x + len - head, s.y, head, 1);
    }
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Build a w x h texture from a per-pixel RGBA function (alpha 0..1). */
function bake(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): HTMLCanvasElement {
  const { c, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = px(x, y), i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(clamp01(a) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** How far a pixel is toward the screen's edge: 0 in the middle, 1 at the corners (an ellipse, so it follows the 16:9 frame). */
const edgeness = (x: number, y: number) => {
  const nx = (x + 0.5) / TFX_W * 2 - 1, ny = (y + 0.5) / TFX_H * 2 - 1;
  return Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
};

function bakeTextures(): Textures {
  return {
    // neutral dark edges, the middle of the screen stays clear
    vig: bake(TFX_W, TFX_H, (x, y) => [0, 0, 0, smooth(0.5, 1, edgeness(x, y))]),
    // a soft horizontal band: bright at its middle, nothing at its edges
    sweep: bake(TFX_W, 40, (_x, y) => [255, 255, 255, Math.sin(Math.PI * (y + 0.5) / 40) ** 2]),
  };
}
