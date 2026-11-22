// Render interpolation for the fixed-timestep sim (core/clock.ts). Before each
// tick the host captures where every actor of the shown area stands; when it
// draws, each one is drawn between there and where the tick left it, by the
// clock's alpha, and the sim's own positions are put back straight afterwards
// (presentation only: the World is never left changed). A body that jumped (a
// portal, a set-down, a teleport) is drawn where it is, never swept across the
// room.
import type { Actor, World } from "../world/world";

/** A move larger than this in one tick is a jump, not a walk (px). */
const SNAP = 12;
const NOOP = () => {};

export class Interpolator {
  /** Where between the previous tick (0) and the latest (1) to draw. */
  alpha = 1;
  /** Off: draw exactly where the sim says (settings: "Smooth motion"). */
  enabled = true;
  private prev = new Map<string, { area: string; x: number; y: number }>();

  /** Remember where the actors of `area` stand before a tick runs. */
  capture(w: World, area: string) {
    for (const a of w.actors) {
      if (a.area !== area) continue;
      const p = this.prev.get(a.id);
      if (p) { p.area = a.area; p.x = a.x; p.y = a.y; }
      else this.prev.set(a.id, { area: a.area, x: a.x, y: a.y });
    }
  }

  clear() { this.prev.clear(); this.alpha = 1; }

  /** The position `a` is drawn at this frame (no swapping). */
  drawn(a: Actor): { x: number; y: number } {
    const p = this.prev.get(a.id);
    if (!this.enabled || !p || p.area !== a.area) return { x: a.x, y: a.y };
    const dx = a.x - p.x, dy = a.y - p.y;
    if (Math.abs(dx) > SNAP || Math.abs(dy) > SNAP) return { x: a.x, y: a.y };
    return { x: p.x + dx * this.alpha, y: p.y + dy * this.alpha };
  }

  /** Swap drawn positions in for the actors of `area`; call the returned function to put the sim's back. */
  apply(w: World, area: string): () => void {
    if (!this.enabled || this.alpha >= 1) return NOOP;
    const saved: [Actor, number, number][] = [];
    for (const a of w.actors) {
      if (a.area !== area) continue;
      const p = this.prev.get(a.id);
      if (!p || p.area !== a.area) continue;
      const dx = a.x - p.x, dy = a.y - p.y;
      if ((dx === 0 && dy === 0) || Math.abs(dx) > SNAP || Math.abs(dy) > SNAP) continue;
      saved.push([a, a.x, a.y]);
      a.x = p.x + dx * this.alpha;
      a.y = p.y + dy * this.alpha;
    }
    if (!saved.length) return NOOP;
    return () => { for (const [a, x, y] of saved) { a.x = x; a.y = y; } };
  }
}
