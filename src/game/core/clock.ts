// Fixed-timestep simulation clock (pure, no DOM). The host feeds it real frame
// time; it answers how many whole simulation ticks to run now and how far the
// picture sits between the last two ticks (`alpha`, for render interpolation:
// view/interp.ts). Game speed is a multiplier on the real time fed in, so 8x
// simply runs eight times as many ticks per second. The sim itself never sees
// anything but TICK, which is what makes a run deterministic at any speed: the
// same save and the same per-tick input stream give the same world at 1x and at
// 8x (tests/timestep.test.ts).

/**
 * Simulation rate. 60 Hz is the frame dt the sim and its content were tuned on, so a host test that drives
 * `update(1/60)` still sees exactly one tick per frame, and cutscene timings are unchanged.
 */
export const SIM_HZ = 60;
export const TICK = 1 / SIM_HZ;

/** The speeds the player can pick (0 = paused). */
export const GAME_SPEEDS = [0, 1, 2, 4, 8] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

/** Float slack: 1/60 fed sixty times is sixty ticks, not fifty-nine. */
const EPS = 1e-9;

export class SimClock {
  /** Scaled seconds owed to the sim that do not yet make a whole tick. */
  acc = 0;
  /** Ticks handed out since the clock was made. */
  ticks = 0;
  /** Ticks thrown away because one frame owed more than `maxTicks` (the game ran slow instead of freezing). */
  dropped = 0;

  constructor(public readonly tick = TICK, public maxTicks = 600) {}

  /** Feed `dt` real seconds at `speed`. Returns the number of whole ticks to run now. */
  advance(dt: number, speed = 1): number {
    if (!(dt > 0) || !(speed > 0)) return 0;
    this.acc += dt * speed;
    let n = Math.floor((this.acc + EPS) / this.tick);
    if (n > this.maxTicks) {
      this.dropped += n - this.maxTicks;
      n = this.maxTicks;
      this.acc = 0;
    } else this.acc = Math.max(0, this.acc - n * this.tick);
    this.ticks += n;
    return n;
  }

  /** How far between the previous tick and the latest one the picture sits (0..1). */
  get alpha(): number { return Math.min(1, Math.max(0, this.acc / this.tick)); }

  /** Forget owed time (a screen came up over the simulating one; a world was loaded). */
  reset() { this.acc = 0; }
}

/** The next speed up (`dir` 1) or down (-1) the ladder. Pause is the bottom rung. */
export function stepSpeed(cur: number, dir: 1 | -1): GameSpeed {
  const i = GAME_SPEEDS.indexOf(cur as GameSpeed);
  const j = Math.max(0, Math.min(GAME_SPEEDS.length - 1, (i < 0 ? 1 : i) + dir));
  return GAME_SPEEDS[j];
}

/** "Paused", "1x", "8x" ... */
export const speedLabel = (s: number) => (s === 0 ? "Paused" : `${s}x`);
