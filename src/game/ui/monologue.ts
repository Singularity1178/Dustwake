// Inner monologue, presentation. The sim decides that the golem thinks a line
// (a `thought` event); this decides how it looks: a small diagnostic log in the
// top-left corner, in the HUD's bitmap font. One line types at a time behind
// a block cursor, with a flicker of unresolved glyphs at its edge; finished
// lines hold, then fade and the rest slide up. A line ending in "..." is a
// running process: its dots cycle while it is the newest line, and it dims
// once something follows it. No DOM: drawing goes through the context passed in.
import { THOUGHTS, type ThoughtTone } from "../content/monologue";
import { drawTextS } from "../font";

/** Layout and pacing (tune here). */
export const MONO = {
  x: 6, y: 7, pitch: 9,
  /** More lines than this push the oldest out early. */
  maxLines: 5,
  /** Characters per second at pace 1. */
  cps: 30,
  /** Before a line types, only its prompt and cursor show for this long. */
  lead: 0.16,
  /** Pause between one line finishing and the next queued line starting. */
  gap: 0.1,
  /** A finished line stays for holdBase + holdPerChar * length seconds, then fades over `fade`. */
  holdBase: 2.6, holdPerChar: 0.05, fade: 0.9,
  /** How long the cursor keeps blinking after the newest line finishes (longer for "void" lines). */
  linger: 0.7, lingerVoid: 2.2,
} as const;

const TONES: Record<ThoughtTone, { text: string; prompt: string }> = {
  status: { text: "#a6e6ee", prompt: "#3c7a86" },
  warn: { text: "#f2b25c", prompt: "#8a5a2a" },
  void: { text: "#c9cbd6", prompt: "#56586a" },
};
const DIM = "#4f747c";
const SCRAMBLE = "#*+=/<>^";

export interface LogLine {
  id: string; text: string; tone: ThoughtTone; pace: number;
  /** Characters revealed (fractional while typing). */
  chars: number;
  /** Lead time left before typing starts. */
  lead: number;
  done: boolean;
  /** Seconds since it finished typing (always runs) and its ageing toward the fade (paused while pinned). */
  doneT: number; age: number;
  alpha: number;
  /** Eased row (slides up when lines above leave). */
  row: number;
}

export interface LogStep { started: LogLine | null; typed: number; tone: ThoughtTone | null }

export class MonologueLog {
  lines: LogLine[] = [];
  private queue: string[] = [];
  private gapT = 0;
  /** While pinned, finished lines don't age (a cutscene keeps its list up until control is handed over). */
  pinned = false;

  reset() { this.lines = []; this.queue = []; this.gapT = 0; this.pinned = false; }

  /** Queue a thought (from a `thought` event). Unknown ids are ignored. */
  push(id: string) { if (THOUGHTS[id]) this.queue.push(id); }

  /** Let pinned lines age from now, the oldest first, `stagger` seconds apart. */
  release(stagger = 0.4) {
    this.pinned = false;
    this.lines.forEach((l, i) => { if (l.done) l.age = Math.min(l.age, -i * stagger); });
  }

  get typing(): LogLine | undefined { return this.lines.find((l) => !l.done); }
  /** Anything still to type? */
  get busy() { return this.queue.length > 0 || !!this.typing; }

  static holdOf(l: LogLine) { return MONO.holdBase + MONO.holdPerChar * l.text.length; }

  update(dt: number): LogStep {
    const out: LogStep = { started: null, typed: 0, tone: null };
    const cur = this.typing;
    if (cur) {
      if (cur.lead > 0) cur.lead -= dt;
      else {
        const before = Math.floor(cur.chars);
        cur.chars = Math.min(cur.text.length, cur.chars + dt * MONO.cps * cur.pace);
        out.typed = Math.floor(cur.chars) - before;
        out.tone = cur.tone;
        if (cur.chars >= cur.text.length) { cur.done = true; this.gapT = MONO.gap; }
      }
    } else if (this.queue.length) {
      this.gapT -= dt;
      if (this.gapT <= 0) {
        const id = this.queue.shift()!, def = THOUGHTS[id];
        const l: LogLine = {
          id, text: def.text, tone: def.tone ?? "status", pace: def.pace ?? 1,
          chars: 0, lead: MONO.lead, done: false, doneT: 0, age: 0, alpha: 1, row: this.lines.length,
        };
        this.lines.push(l);
        out.started = l;
      }
    }
    const extra = this.lines.length - MONO.maxLines;
    this.lines.forEach((l, i) => {
      if (!l.done) return;
      l.doneT += dt;
      if (i < extra) l.age = Math.max(l.age, MonologueLog.holdOf(l));
      if (!this.pinned || i < extra) l.age += dt;
      if (l.age > MonologueLog.holdOf(l)) l.alpha -= dt / MONO.fade;
    });
    this.lines = this.lines.filter((l) => l.alpha > 0);
    this.lines.forEach((l, i) => { l.row += (i - l.row) * Math.min(1, dt * 12); });
    return out;
  }
}

/** Draw the log on the UI layer. `t`: presentation clock (cursor blink, dots, flicker); `top`: y of the first row. */
export function drawMonologue(ctx: CanvasRenderingContext2D, log: MonologueLog, t: number, top: number = MONO.y) {
  const n = log.lines.length;
  log.lines.forEach((l, i) => {
    const newest = i === n - 1;
    const process = l.text.endsWith("...");
    const col = TONES[l.tone];
    const y = Math.round(top + l.row * MONO.pitch);
    // "void" lines are not quite stable
    const x = MONO.x + (l.tone === "void" && Math.random() < 0.03 ? 1 : 0);
    let text = l.text.slice(0, Math.floor(l.chars));
    if (l.done && process && newest) text = l.text.slice(0, -3) + ".".repeat(Math.floor(t * 2.5) % 4);
    const textCol = l.done && process && !newest ? DIM : col.text;
    ctx.globalAlpha = Math.max(0, Math.min(1, l.alpha)) * (l.tone === "void" ? 0.9 + 0.1 * Math.sin(t * 9) : 1);
    drawTextS(ctx, ">", x, y, l.done && !newest ? DIM : col.prompt);
    drawTextS(ctx, text, x + 6, y, textCol);
    const cx = x + 6 + text.length * 4;
    if (!l.done && l.lead <= 0) {
      // the next glyph, not yet resolved
      drawTextS(ctx, SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0], cx, y, col.prompt);
    }
    const linger = l.tone === "void" ? MONO.lingerVoid : MONO.linger;
    const showCursor = !l.done || (newest && !process && l.doneT < linger);
    if (showCursor && Math.floor(t * (l.done ? 3 : 6)) % 2 === 0) {
      const bx = l.done ? cx : cx + (l.lead > 0 ? 0 : 4);
      ctx.fillStyle = "#000"; ctx.fillRect(bx + 1, y + 1, 3, 5);
      ctx.fillStyle = col.text; ctx.fillRect(bx, y, 3, 5);
    }
  });
  ctx.globalAlpha = 1;
}
