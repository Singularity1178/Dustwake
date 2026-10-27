// Cutscene scripts (data). A cutscene is a fade-in plus an ordered list of
// beats. Each beat starts `wait` seconds after the one before it, so inserting
// or retiming a beat shifts everything after it and nothing before. A beat can
// fire presentation cues (sound/particles, interpreted by the cutscene's
// screen), make the golem think a line (content/monologue.ts, through the
// sim's `think` command), and change the golem's body tracks, which hold until
// a later beat changes them. The last beat carries `control`: that is the
// exact moment the player is handed control. ui/cutscene.ts is the runner;
// screens/intro.ts plays the opening.

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

export interface Cutscene {
  /** Fade from black over this many seconds (from t = 0). */
  fadeIn: number;
  /** Track values before the first beat changes them. */
  start: CutsceneTracks;
  beats: CutsceneBeat[];
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
