// Key auto-repeat for the menus. The game reads keys as presses (Game.pressed: a key going down this frame), so a
// held arrow used to move a cursor once and then sit still. KeyRepeat turns a held key into a stream of repeats the
// way a text field does: a pause after the press, then steady steps, quickening after a while for long lists.
//
// It runs on the game's own clock (the frame dt the screens already get), not the browser's keydown repeat, so it is
// the same on every OS and setting, and it covers the gamepad too (the stick and D-pad arrive as the same keys).
//
// Like the OS, only the most recently pressed key repeats (modifiers never take it): hold Down, tap E, and the
// scrolling stops rather than carrying on under the new screen or tool. A screen change also stops it.
//
// The screens choose what may repeat: cursor moves ask `Game.navHit` (a press or a repeat), actions (use, craft,
// drop, travel, toggle) keep asking `Game.hit`, so holding E never crafts twice.

/** Seconds a key is held before it starts repeating. */
export const REPEAT_DELAY = 0.35;
/** Seconds between repeats at first, and once the key has repeated REPEAT_QUICK_AFTER times. */
export const REPEAT_EVERY = 0.07;
export const REPEAT_QUICK = 0.035;
export const REPEAT_QUICK_AFTER = 8;

/** Keys that modify other keys: holding one never takes the repeat from the key being held. */
const MODIFIERS: ReadonlySet<string> = new Set(["shift", "control", "alt", "meta", "capslock"]);

export class KeyRepeat {
  /** The key that repeats: the last one pressed, while it is still held. */
  key: string | null = null;
  /** The key that repeated on this tick, if any. */
  fired: string | null = null;
  private wait = 0;
  private count = 0;

  /** A key went down (not a browser repeat of one already down). */
  press(k: string) {
    if (MODIFIERS.has(k)) return;
    this.key = k;
    this.wait = REPEAT_DELAY;
    this.count = 0;
  }

  release(k: string) { if (this.key === k) this.key = null; }

  /** Nothing repeats until the next press (a screen change, a remap). */
  stop() { this.key = null; this.fired = null; }

  /** Advance by `dt` seconds with `held` the keys down now. At most one repeat per tick. */
  tick(dt: number, held: ReadonlySet<string>) {
    this.fired = null;
    if (this.key === null) return;
    if (!held.has(this.key)) { this.key = null; return; }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.fired = this.key;
    this.count++;
    // keep the cadence (the overshoot comes off the next wait), but after a long hitch never burst: at least half a gap
    const gap = this.count > REPEAT_QUICK_AFTER ? REPEAT_QUICK : REPEAT_EVERY;
    this.wait = Math.max(gap / 2, this.wait + gap);
  }
}
