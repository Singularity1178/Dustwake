// The stair between the surface and the halls. It is one flight, drawn in two
// places: its head on the surface (propsSurface: the open `buriedgate`, looked
// down into) and the flight in the halls (tiles: FS.STAIR, climbed). Both take
// their steps from here, so a step is the same thing wherever it is met.
// Presentation only.
//
// The flight climbs south and is seen from the south and above, so no riser
// ever shows: only treads, each lower than the one in front of it. What makes
// that read as a stair and not as boards:
//   - a step is shaded as a solid, not ruled off with a line: a lit lip at its
//     north edge (the nosing), then the tread falling steadily into the shadow
//     of the step above until it is lost under that step's lip;
//   - it has depth, and the same depth at both ends. A step that is higher is
//     nearer the eye: deeper, wider and lighter. So on the surface the flight
//     shrinks and darkens as it goes down under the lintel, and in the halls
//     it grows and lightens as it climbs out of the hall toward the daylight;
//   - it runs between two walls, and they are seen: a coping along the top of
//     each that does not step, and under it the wall's face, tall beside the
//     lowest step and gone by the highest, the east one catching the light and
//     the west one in its own shade. Where each step meets the wall is a wedge
//     of shadow, so the flight's two edges are toothed;
//   - the treads are stone, and one stone each (a course of short stones is a
//     wall): chipped at the lip, pitted, the odd one cracked through, and worn
//     pale and round-edged down the middle of the flight.
import { hash2 } from "../util";

/** Rows in a full step: the length of the shading ramp below. In the halls a step is this deep about half-way up. */
export const STEP = 8;
/** Width of the coping (the kerb) along the top of each side wall. */
export const KERB = 3;
/** The level of the stair's top step, counted in steps from the halls' floor: where the head starts counting down. */
export const TOP_LEVEL = 14;

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

/** One step of the flight in the halls: where it starts (rows from the flight's north end), how deep it is, how far each wall's face comes in beside it, and its level. */
export interface FlightStep { y0: number; pitch: number; inset: number; level: number }
/** What the east wall's face keeps of its step's tone (it catches the light), and the west (in its own shade). */
export const WALL_LIT = 0.74, WALL_SHADE = 0.44;

const layouts = new Map<number, readonly FlightStep[]>();
/**
 * The steps of a flight `H` rows long, north (its foot) to south (its top). There is a step to about seven
 * rows; the lowest is five deep and each one up is deeper, as the head's are shallower each one down. The wall
 * faces come in a pixel more beside each step down, from nothing beside the top one (the flight is the passage's
 * whole width there, less the coping). Levels run from 1, one step above the floor, to TOP_LEVEL, the step the
 * head on the surface starts from: however long the run, it is the whole stair.
 */
export function flightSteps(H: number): readonly FlightStep[] {
  let L = layouts.get(H);
  if (!L) {
    const n = Math.max(1, Math.round(H / 7)), edge = (k: number) => Math.round((H * (5 * k + 0.3 * k * k)) / (5 * n + 0.3 * n * n));
    const steps: FlightStep[] = [];
    for (let i = 0; i < n; i++) steps.push({ y0: edge(i), pitch: edge(i + 1) - edge(i), inset: KERB + (n - 1 - i), level: n === 1 ? TOP_LEVEL : 1 + (i * (TOP_LEVEL - 1)) / (n - 1) });
    layouts.set(H, (L = steps));
  }
  return L;
}
/** The step that row `fy` of a flight `H` long falls on. */
export function flightStepAt(fy: number, H: number): FlightStep {
  const L = flightSteps(H);
  let i = 0;
  while (i < L.length - 1 && fy >= L[i + 1].y0) i++;
  return L[i];
}

/**
 * One pixel of the flight in the halls, `W` wide and `H` long: `fx` across it, `fy` rows down from its north
 * (lower) end. From each side inward: the coping, the wall's face, the wedge of shadow in the step's corner,
 * the tread. `seed` tells one flight's chips and joints from another's.
 */
export function flightPix(fx: number, fy: number, W: number, H: number, seed = 0): [number, number, number] {
  const st = flightStepAt(fy, H), s = fy - st.y0, base = treadTone(st.level);
  const n = (hash2(fx, fy, 61 + seed) - 0.5) * 7;
  const k = Math.min(fx, W - 1 - fx), east = fx >= W / 2;
  if (k < KERB) {
    // the coping: a course of blocks lying up the slope, lit along its inner edge, jointed out of step with the
    // treads. It does not step, so its tone climbs with the row, not with the step.
    let v = treadTone(1 + ((TOP_LEVEL - 1) * fy) / Math.max(1, H - 1)) - 8 + (k === KERB - 1 ? 16 : k === 1 ? 0 : -18);
    if ((fy + 4) % STEP === 0) v -= 26;
    return stairRGB(v + n * 0.5);
  }
  if (k < st.inset) {
    // the wall's face, from the coping down to the tread: a course of blocks to each step, the bed joint along
    // the step's last row, a head joint in every other course, and (east) its foot catching the light
    let v = base * (east ? WALL_LIT : WALL_SHADE);
    if (s === st.pitch - 1) v -= east ? 30 : 14;
    else if (k === KERB) v -= east ? 12 : 6;                                           // the coping's shadow down the top of the face
    else if (east && k === st.inset - 1) v += 22;
    else if (s > 0 && k === KERB + ((st.inset - KERB) >> 1) && (Math.round(st.level) & 1) === 1 && st.inset - KERB > 3) v -= east ? 22 : 10;
    return stairRGB(Math.max(6, v) + n * 0.4);
  }
  // the corner against the wall: a wedge of shadow, widening to the foot of the step above; the west wall also
  // throws its own shade along the tread ends
  const d = k - st.inset, wedge = cornerShade(s, st.pitch);
  if (d < wedge + (east || !wedge ? 0 : 2)) return stairRGB(base - 60 + n * 0.4);
  let t = stepShade(s, st.pitch);
  if (d < 2 && !east) t -= 34;
  else if (d === 0) t -= 16;
  // worn down the middle of the flight: paler, and the lip rounded off (its light spread over two rows)
  if (Math.abs(fx - (W - 1) / 2) < W * 0.17) t += s === 0 ? -9 : s === 1 && st.pitch >= 6 ? 11 : s < st.pitch - 3 ? 5 : 0;
  // one stone to a step; a few have cracked through, each somewhere of its own
  const step = Math.round(st.level * 8), run = W - st.inset * 2 - 14;
  if (s > 0 && s < st.pitch - 1 && run > 0 && hash2(step, seed, 62) < 0.4 && fx === st.inset + 7 + Math.floor(hash2(step, seed, 65) * run) + (s > st.pitch >> 1 ? 1 : 0)) t -= 15;
  // a chip out of the lip, a pit in the tread
  if (s === 0 && hash2(fx >> 1, step, 64 + seed) < 0.07) t -= 24;
  else if (s > 1 && s < st.pitch - 3 && hash2(fx >> 1, fy, 63 + seed) < 0.035) t -= 10;
  return stairRGB(base + t + n);
}
