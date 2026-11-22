// Deterministic replay (pure, no DOM). The play screen's input, as data: one
// TickInput per fixed tick (core/clock.ts). `simTick` is exactly what the host
// runs per tick (Game.simulate), so a save plus an input stream reproduces a run
// tick for tick, whatever the frame rate or the game speed it was played at
// (tests/timestep.test.ts plays one stream at 1x and at 8x and compares worlds).
import { TICK, SimClock } from "../core/clock";
import { stepPlayer, stepWorld, addPlayTime, type PlayerInput, type PlayerStepResult } from "./step";
import type { World } from "../world/world";

export type TickInput = Pick<PlayerInput, "ix" | "iy" | "use" | "attack" | "core" | "toggleScan">;
export const IDLE: TickInput = { ix: 0, iy: 0, use: false };

/** One simulation tick as the play screen runs it: the player, play time, then the world. */
export function simTick(w: World, input: TickInput = IDLE): PlayerStepResult {
  const r = stepPlayer(w, TICK, input);
  addPlayTime(w, TICK);
  stepWorld(w, TICK);
  return r;
}

const same = (a: TickInput, b: TickInput) =>
  a.ix === b.ix && a.iy === b.iy && !!a.use === !!b.use && !!a.attack === !!b.attack && !!a.core === !!b.core && !!a.toggleScan === !!b.toggleScan;

/** An input stream by tick index, stored as runs (a held key is one entry, not one per tick). Serializable. */
export class InputLog {
  runs: { from: number; input: TickInput }[] = [];

  record(tick: number, input: TickInput) {
    const last = this.runs[this.runs.length - 1];
    if (last && last.from > tick) throw new Error("input log: ticks must be recorded in order");
    if (!last || !same(last.input, input)) this.runs.push({ from: tick, input: { ...input } });
  }

  at(tick: number): TickInput {
    let lo = 0, hi = this.runs.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.runs[mid].from <= tick) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best < 0 ? IDLE : this.runs[best].input;
  }

  toJSON() { return { runs: this.runs }; }
  static fromJSON(o: { runs: { from: number; input: TickInput }[] }): InputLog { const l = new InputLog(); l.runs = o.runs.map((r) => ({ from: r.from, input: { ...r.input } })); return l; }
}

/**
 * Play `ticks` ticks of an input stream into `w`, driven through a SimClock at `speed` that is fed the real frame
 * times in `frames` (cycled). Events are drained each tick, as the host does. Returns the ticks run.
 */
export function playStream(w: World, input: (tick: number) => TickInput, ticks: number, speed: number, frames: readonly number[], onTick?: (w: World, tick: number) => void): number {
  const clock = new SimClock(TICK, 1e6);
  let t = 0, f = 0;
  while (t < ticks) {
    const n = clock.advance(frames[f++ % frames.length], speed);
    for (let i = 0; i < n && t < ticks; i++, t++) {
      simTick(w, input(t));
      w.events = [];
      onTick?.(w, t);
    }
  }
  return t;
}
