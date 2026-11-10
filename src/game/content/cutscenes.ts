// Cutscene scripts (data). A cutscene is a fade-in plus an ordered list of
// beats. Each beat starts `wait` seconds after the one before it, so inserting
// or retiming a beat shifts everything after it and nothing before. A beat can
// fire presentation cues (sound/particles, interpreted by the cutscene's
// screen), make the golem think a line (content/monologue.ts, through the
// sim's `think` command), and change the golem's body tracks, which hold until
// a later beat changes them. The last beat carries `control`: that is the
// exact moment the player is handed control. ui/cutscene.ts is the runner;
// screens/intro.ts plays the opening; screens/crossing.ts plays the first
// crossing to the surface (CROSSING, below). Both can be skipped with Esc.

/** The golem's chest core: dark, booting (a flicker that steadies over `over`), lit, or running diagnostics. */
export type CoreMode = "off" | "boot" | "on" | "diagnose";
/** The golem's eye: dark, flickering, lit. */
export type EyeMode = "off" | "flicker" | "on";
/** The golem's body: slumped dormant, rising (over `over`), standing. */
export type BodyMode = "slumped" | "rise" | "up";

export interface CutsceneTracks { core: CoreMode; eye: EyeMode; body: BodyMode }

export interface CutsceneBeat {
  /** Seconds after the previous beat (the first beat: after the cutscene starts). */
  wait: number;
  /** Short name, for reading the script and the tests. */
  label: string;
  /** Presentation cues fired as the beat starts (the screen's cue table). */
  cues?: string[];
  /** Inner-monologue line the golem thinks as the beat starts. */
  think?: string;
  core?: CoreMode;
  eye?: EyeMode;
  body?: BodyMode;
  /** Seconds a ramping mode set by this beat ("boot", "rise") takes. */
  over?: number;
  /** The cutscene ends and the player has control. Only on the last beat. */
  control?: true;
}

/** An ordered beat list: all the timeline maths (ui/cutscene.ts) needs. */
export interface BeatScript { beats: CutsceneBeat[] }

export interface Cutscene extends BeatScript {
  /** Fade from black over this many seconds (from t = 0). */
  fadeIn: number;
  /** Track values before the first beat changes them. */
  start: CutsceneTracks;
}

/**
 * The opening. The first part is the original awakening, unchanged in timing
 * (sparks at 0.8, the core boots 1.2 -> 2.6, the eye flickers on 2.9 -> 3.5, the
 * golem rises 3.6 -> 5.0, the thud at 4.2). Then it runs diagnostics with its
 * core flickering, reports, and is handed control at 11.9 s (`controlAt(INTRO)`).
 */
export const INTRO: Cutscene = {
  fadeIn: 1.5,
  start: { core: "off", eye: "off", body: "slumped" },
  beats: [
    { wait: 0.8, label: "spark", cues: ["sparks"] },
    { wait: 0.4, label: "boot", cues: ["boot"], core: "boot", over: 1.4 },
    { wait: 0.4, label: "spark again", cues: ["sparksSmall"] },
    { wait: 1.0, label: "core lit", core: "on" },
    { wait: 0.3, label: "eye flickers", eye: "flicker" },
    { wait: 0.6, label: "eye lit", eye: "on" },
    { wait: 0.1, label: "rise", body: "rise", over: 1.4 },
    { wait: 0.6, label: "foot down", cues: ["thud"] },
    // awake (the rise ends at 5.0): diagnostics
    { wait: 0.8, label: "assessing", think: "intro.assessing", core: "diagnose" },
    { wait: 2.4, label: "diagnostics done", cues: ["diagDone"], core: "on" },
    { wait: 0.35, label: "damage", think: "intro.damage" },
    { wait: 1.1, label: "arm", think: "intro.arm", cues: ["armSparks"] },
    { wait: 1.25, label: "directive", think: "intro.directive", cues: ["hollow"] },
    // the directive line finishes typing at about 11.3; one held beat of nothing, then control
    { wait: 1.8, label: "control", control: true },
  ],
};

/**
 * The arrival on the surface, in seconds since the world scene takes over. The
 * overgrown rune wakes: its surviving carvings glow, the glow sweeps round the
 * circle redrawing what eroded while the plants over it wither away, the
 * circle pulses to full power, and then the golem is summoned onto it and
 * falls the last of the way.
 */
export const ARRIVE = {
  /** Fade in from black. */
  FADE: 1.0,
  /** The surviving carvings begin to glow; a low hum starts. */
  GLOW: 1.3,
  /** The redraw sweep runs SWEEP -> SWEEP_END; the hum rises. */
  SWEEP: 2.9,
  SWEEP_END: 6.3,
  /** Full activation pulse ends. */
  PULSE_END: 7.1,
  /** Summon: converging motes and a light column build until FLASH, which reveals the golem. */
  FLASH: 8.3,
  /** The golem falls from the flash to the dais over this long. */
  FALL: 1.2,
  /** The rune settles to its steady glow. */
  END: 9.8,
} as const;

export interface CrossingScript extends BeatScript {
  /** The white of the jump clears over this many seconds as the transit begins. */
  whiteOut: number;
  /** First light: the calendar clock runs on to morning over this many seconds. */
  lapse: number;
  /** The chapter card takes a key (any: go on, R: wake again) this long after it appears. */
  promptAfter: number;
}

/**
 * The crossing: the first jump through the rune network (screens/crossing.ts).
 * It follows the rune's own lift-off, and it is the story of why that jump is
 * not a hop: the rune it is bound for has lain under the forest for an age.
 *
 *   transit      up from the translocation room through the buried keep, rock
 *                and soil. Under the grass the climb stalls: the far anchor is
 *                degraded. The golem rewrites it from the pattern it left by.
 *   arrival      the same thing seen from the surface: the overgrown rune
 *                redraws itself (ARRIVE) and summons the golem. It lands.
 *   first light  it looks about; what it has on record is not what is there.
 *                The night ends while it stands there. A chapter card (the
 *                run so far) closes it, and waits a while for a key.
 *
 * The labels "stall", "rewrite", "surface", "landed", "first light" and
 * "chapter" are the screen's act marks; the rest are free to retime.
 */
export const CROSSING: CrossingScript = {
  whiteOut: 0.8,
  lapse: 6,
  promptAfter: 1.6,
  beats: [
    // ---- transit (a card)
    { wait: 0.6, label: "transit", think: "cross.transit", cues: ["ascend"] },
    // the climb takes its time: half a second in the room it left, then the keep, the rock, the clay and the roots each pass
    { wait: 2.9, label: "stall", think: "cross.anchor", cues: ["stall"] },
    { wait: 1.7, label: "rewrite", think: "cross.rewrite", cues: ["rewrite"] },
    // ---- arrival (the world; ARRIVE's clock starts here). The rewrite line's dots cycle all through the sweep.
    { wait: 1.9, label: "surface" },
    { wait: ARRIVE.FLASH + ARRIVE.FALL, label: "landed", cues: ["land"] },
    { wait: 0.8, label: "arrived", think: "cross.arrived" },
    { wait: 1.5, label: "look left", cues: ["faceLeft"] },
    { wait: 0.7, label: "look right", cues: ["faceRight"] },
    { wait: 0.8, label: "observed", think: "cross.observed", cues: ["faceDown"] },
    // ---- first light
    { wait: 2.4, label: "first light", cues: ["dawn"] },
    { wait: 1.8, label: "light", think: "cross.light", cues: ["faceRight"] },
    { wait: 3.4, label: "chapter", cues: ["chapter"] },
    // the card holds for a key; left alone, the golem is handed over anyway
    { wait: 10, label: "control", control: true },
  ],
};
