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

export class ScreenStack {
  private stack: Screen[] = [];

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
    for (; i < this.stack.length; i++) this.stack[i].render();
  }
}
