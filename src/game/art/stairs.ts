// The stair between the surface and the halls. It is one flight, drawn in three
// places: its head on the surface (propsSurface: the open `buriedgate`), the
// flight in the halls (tiles: FS.STAIR) and its foot standing clear in the
// Vestibule (propsDungeon: `stairfoot`). All three take their steps from here,
// so a step is the same thing wherever it is met. Presentation only.
//
// The flight climbs south and is seen from the south and above, so no riser
// ever shows: only treads, each lower than the one in front of it. What makes
// that read as a stair and not as boards:
//   - a step is shaded as a solid, not ruled off with a line: a lit lip at its
//     north edge (the nosing), then the tread falling steadily into the shadow
//     of the step above until it is lost under that step's lip;
//   - each step is a little lighter than the one below it, the whole way up, and
//     on the surface the flight goes down into the dark as it goes under the lintel;
//   - it runs between kerbs that do not step, and the corner where each step
//     meets the kerb is a wedge of shadow, so the flight's two edges are toothed;
//   - the treads are stone, and one stone each (a course of short stones is a
//     wall): chipped at the lip, pitted, the odd one cracked through, and worn
//     pale and round-edged down the middle of the flight.
import { hash2 } from "../util";

/** Rows to a step in the halls: two steps to a tile. */
export const STEP = 8;
/** The steps of the foot, standing clear of the stairwell; the flight's first step is this many above the floor. */
export const FOOT_STEPS = 3;
/** Width of the kerb along each side of the flight. */
export const KERB = 3;

/** A step's rows, north to south, against its tread: the lit nosing, the tread, the shadow of the step above. */
const SHADE = [34, 14, 5, 0, -6, -16, -34, -60];
/**
 * Brightness of row `s` of a step `pitch` rows deep (0 is its north edge). Shallower steps (the head's, as they
 * recede) keep the lip and the deepest shadow and take the rows between from the same ramp.
 */
export function stepShade(s: number, pitch: number): number {
  if (s <= 0) return SHADE[0];
  if (s >= pitch - 1) return SHADE[STEP - 1];
  return SHADE[Math.round((s * (STEP - 1)) / (pitch - 1))];
}
/**
 * How far the wedge of shadow in a step's corner (against the kerb or the well's wall) reaches along row `s`:
 * nothing at the lip, widening a pixel a row over the step's last rows (four of them on a full step).
 */
export const cornerShade = (s: number, pitch: number) => Math.max(0, s - Math.max(0, pitch - 5));

/** The grey of the tread `level` steps above the Vestibule's floor: a shade lighter with every step up. */
export const treadTone = (level: number) => 80 + level * 3;
/** A grey as the stair's stone (the halls' faint violet). */
export const stairRGB = (v: number): [number, number, number] => [v, v * 0.96, v * 1.06];

/**
 * One pixel of a flight `W` wide: `fx` across it, `fy` rows down from its north (lower) end, whose first step is
 * `first` steps above the floor. `seed` tells one flight's chips and joints from another's.
 */
export function flightPix(fx: number, fy: number, W: number, first: number, seed = 0): [number, number, number] {
  const step = Math.floor(fy / STEP), s = fy - step * STEP, base = treadTone(first + step);
  const n = (hash2(fx, fy, 61 + seed) - 0.5) * 7;
  if (fx < KERB || fx >= W - KERB) {
    // the kerb: a course of blocks lying up the slope, lit along its inner edge, jointed out of step with the treads
    const k = fx < KERB ? fx : W - 1 - fx;
    let v = base - 8 + (k === KERB - 1 ? 16 : k === 1 ? 0 : -18);
    if ((fy + 4) % STEP === 0) v -= 26;
    return stairRGB(v + n * 0.5);
  }
  // the corner against the kerb: a wedge of shadow, widening to the foot of the step above
  const d = Math.min(fx - KERB, W - KERB - 1 - fx);
  if (d < cornerShade(s, STEP)) return stairRGB(base - 60 + n * 0.4);
  let k = stepShade(s, STEP);
  if (d === 0) k -= 16;
  // worn down the middle of the flight: paler, and the lip rounded off (its light spread over two rows)
  if (Math.abs(fx - (W - 1) / 2) < W * 0.17) k += s === 0 ? -9 : s === 1 ? 11 : s < 5 ? 5 : 0;
  // one stone to a step; a few have cracked through, each somewhere of its own
  if (s > 0 && s < 7 && hash2(step, seed, 62) < 0.4 && fx === KERB + 7 + Math.floor(hash2(step, seed, 65) * (W - KERB * 2 - 14)) + (s > 3 ? 1 : 0)) k -= 15;
  // a chip out of the lip, a pit in the tread
  if (s === 0 && hash2(fx >> 1, step, 64 + seed) < 0.07) k -= 24;
  else if (s > 1 && s < 5 && hash2(fx >> 1, fy, 63 + seed) < 0.035) k -= 10;
  return stairRGB(base + k + n);
}
