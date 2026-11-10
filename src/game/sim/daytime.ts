// The world's calendar clock (sim). `world.day` is days since the world began;
// its fraction is the time of day (content/daycycle.ts has the maths and what
// each hour means). stepWorld advances it with world time, so it stops when
// the world does (overlays, the title) and is saved with it.
//
// The clock only ever runs forward. When it crosses into another part of the
// day a `dayPhase` event is emitted, once, for presentation and the monologue.
import { DAY_SECONDS, hourOf, phaseAt, wrapHour, type DayPhase, type Exposure } from "../content/daycycle";
import { emit, type World } from "../world/world";
import type { Area } from "../world/area";

export const worldHour = (w: World) => hourOf(w.day);
export const worldPhase = (w: World): DayPhase => phaseAt(worldHour(w));

/** How much of the sky an area sees (content/daycycle.ts: Exposure). */
export const exposureOf = (a: Area): Exposure => (a.base.outdoor ? "outdoor" : a.base.interior ? "interior" : "buried");

function setDay(w: World, day: number) {
  if (!(day > w.day)) return;
  const before = phaseAt(hourOf(w.day));
  w.day = day;
  const after = phaseAt(hourOf(day));
  if (after !== before) emit(w, { t: "dayPhase", phase: after, day: Math.floor(day) });
}

/** Advance the clock by `dt` world seconds (stepWorld). */
export function stepDay(w: World, dt: number) { setDay(w, w.day + dt / DAY_SECONDS); }

/** Advance the clock by a number of hours. */
export function advanceDay(w: World, hours: number) { if (hours > 0) setDay(w, w.day + hours / 24); }

/** Advance to the next time the clock reads `hour`: later today, or tomorrow if that hour has passed. */
export function advanceDayTo(w: World, hour: number) {
  const ahead = wrapHour(hour - worldHour(w));
  if (ahead > 1e-6 && ahead < 24 - 1e-6) advanceDay(w, ahead);
}

/**
 * Advance to `hour` only if it is still ahead today (less than `within` hours
 * off). Never back and never round the clock: safe to call every frame with a
 * rising target (a time-lapse), or once to make sure a moment has been reached.
 */
export function advanceDayUpTo(w: World, hour: number, within = 12) {
  const ahead = wrapHour(hour - worldHour(w));
  if (ahead > 1e-6 && ahead < within) advanceDay(w, ahead);
}
