// Screen stack. The top screen receives update (and therefore input); rendering
// starts at the highest opaque screen and draws upward, so overlays (pack,
// schematic, later management screens) sit on top of whatever is beneath.
// Screens that simulate (play, cutscenes) step the world themselves; overlays
// pause the world simply by being on top.

export interface Screen {
  readonly id: string;
  /** Draws the full frame; nothing beneath needs rendering. */
  readonly opaque: boolean;
  /** Seconds since this screen was shown. */
  t: number;
  update(dt: number): void;
  render(): void;
}

/**
 * The overlay screens that are laid out as a 320x180 box and centred on the scaled UI canvas (ui/text.ts `inFrame`).
 * The build screen frames its menu itself: its two world tools hang from the screen's edges.
 */
export const FRAMED_SCREENS: ReadonlySet<string> = new Set(["inv", "storage", "transfer", "crafting", "manage", "debug", "book"]);

export class ScreenStack {
  private stack: Screen[] = [];
  /** The host's say in how a screen is drawn (Game: the overlay screens are centred on the scaled UI canvas). */
  drawWith: ((s: Screen, draw: () => void) => void) | null = null;

  get top(): Screen | undefined { return this.stack[this.stack.length - 1]; }
  get size() { return this.stack.length; }
  is(id: string) { return this.top?.id === id; }
  has(id: string) { return this.stack.some((s) => s.id === id); }

  /** Replace the whole stack (scene change). */
  set(s: Screen) { this.stack = [s]; s.t = 0; }
  push(s: Screen) { this.stack.push(s); s.t = 0; }
  pop() { if (this.stack.length > 1) this.stack.pop(); }
  /** Drop every overlay above the base scene. */
  popToBase() { this.stack.length = Math.min(this.stack.length, 1); }

  update(dt: number) {
    const top = this.top;
    if (!top) return;
    top.t += dt;
    top.update(dt);
  }

  render() {
    let i = this.stack.length - 1;
    while (i > 0 && !this.stack[i].opaque) i--;
    for (; i < this.stack.length; i++) {
      const s = this.stack[i];
      if (this.drawWith) this.drawWith(s, () => s.render()); else s.render();
    }
  }
}
