// Cutscene runner: pure timeline maths over a content/cutscenes.ts script. No
// DOM, no state of its own: everything is a function of the script and the
// screen's clock, so a replay (R) starts clean and tests can check timings.
import type { Cutscene, CutsceneBeat, CutsceneTracks } from "../content/cutscenes";

export interface TimedBeat extends CutsceneBeat { at: number; index: number }

const cache = new WeakMap<Cutscene, TimedBeat[]>();

/** The beats with their absolute start times. */
export function timeline(c: Cutscene): TimedBeat[] {
  let tl = cache.get(c);
  if (!tl) {
    let at = 0;
    tl = c.beats.map((b, index) => ({ ...b, at: (at += b.wait), index }));
    cache.set(c, tl);
  }
  return tl;
}

/** When control is handed over (the `control` beat, else the last beat). */
export function controlAt(c: Cutscene): number {
  const tl = timeline(c);
  return (tl.find((b) => b.control) ?? tl[tl.length - 1])?.at ?? 0;
}

/** Beats starting in (t0, t]: what a frame from t0 to t must fire, in order. */
export function beatsCrossed(c: Cutscene, t0: number, t: number): TimedBeat[] {
  return timeline(c).filter((b) => b.at > t0 && b.at <= t);
}

/** A track's mode at time t, how long it has held, and its ramp progress 0..1 (1 for modes without `over`). */
export function trackAt<K extends keyof CutsceneTracks>(c: Cutscene, key: K, t: number): { mode: CutsceneTracks[K]; since: number; k: number } {
  let mode = c.start[key], from = 0, over = 0;
  for (const b of timeline(c)) {
    if (b.at > t) break;
    const m = b[key] as CutsceneTracks[K] | undefined;
    if (m !== undefined) { mode = m; from = b.at; over = b.over ?? 0; }
  }
  const since = t - from;
  return { mode, since, k: over > 0 ? Math.max(0, Math.min(1, since / over)) : 1 };
}
