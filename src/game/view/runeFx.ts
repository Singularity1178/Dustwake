// How a translocation rune looks by whether it will carry anyone (sim/runes.ts: runeState). Presentation maths
// only: no DOM, no sim, and a function of time alone, so the host's animation can be tested without a browser.

/** A lit rune with somewhere to go: the steady pulse. */
export const linkedGlow = (t: number) => 0.62 + 0.28 * Math.sin(t * 3);
/** A lit rune that nothing answers: embers. A low, slow breath far under the linked pulse (and no motes rise from it). */
export const severedGlow = (t: number) => 0.1 + 0.04 * Math.sin(t * 1.1);

/**
 * The refusal (E on a rune that will not carry), as beats, in seconds from the moment it refuses. It surges past
 * its full glow as if to take hold; it gutters: flashes, each weaker than the last and unevenly spaced, the rune
 * dark between them; then one last breath dies back to what it was. The flashes are a table, not noise, so every
 * one of them is long enough to be seen (two frames at 60 Hz or more) and the stutter is the same every time.
 */
export const RUNE_DUD = {
  dur: 1.15,
  /** The surge: a ramp from rest up to `peak` (over 1: the host draws the carvings overdriven), ending here. */
  surge: 0.14, peak: 1.25,
  /** The guttering: [start, length, level]. Between them the rune is at `dark` of its resting glow. */
  flashes: [[0.2, 0.07, 1.0], [0.33, 0.045, 0.85], [0.46, 0.06, 0.7], [0.59, 0.04, 0.55], [0.7, 0.045, 0.42]],
  dark: 0.4,
  /** The guttering ends here, and the last breath starts at `breath` and falls to rest by `dur`. */
  gutter: 0.8, breath: 0.4,
} as const;

/**
 * The refusal's glow `t` seconds in. `rest` is what the rune shows left alone; `strength` scales the flare: a dark
 * rune only spits (0.5), a lit one flares (1). Levels never go under `rest` except in the dark between flashes.
 */
export function runeDudGlow(t: number, rest: number, strength = 1): number {
  const D = RUNE_DUD;
  if (t <= 0 || t >= D.dur) return rest;
  const up = (level: number) => rest + Math.max(0, level * strength - rest);
  if (t < D.surge) return rest + (up(D.peak) - rest) * (t / D.surge);
  if (t < D.gutter) {
    const flash = D.flashes.find(([at, len]) => t >= at && t < at + len);
    return flash ? up(flash[2]) : rest * D.dark;
  }
  const k = (t - D.gutter) / (D.dur - D.gutter);
  return rest + (up(D.breath) - rest) * (1 - k) * (1 - k);
}
