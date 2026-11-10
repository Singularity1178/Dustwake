// The crossing: the first jump through the rune network, from the buried halls
// to the surface. It replaces the old end card (a painted hilltop that matched
// nothing in the world) with what actually happens, in three acts on one
// timeline (content/cutscenes.ts: CROSSING):
//
//   transit      a card (screens/cards.ts: renderTransit). The golem climbs out
//                of the translocation room through masonry, rock and soil, and
//                stalls under the grass: the rune it is bound for is eroded.
//                It rewrites it from the pattern it left by.
//   arrival      the world. That rewrite, seen from above: the overgrown rune
//                redraws itself and summons the golem onto it (the host's
//                arriveStep, on ARRIVE's timings). It lands.
//   first light  the golem looks about, the clock runs on to morning (the real
//                calendar clock: the dawn it sees is the day the player then
//                plays in), and a chapter card shows the run so far.
//
// The lift-off before all this is the ordinary rune effect (the host's `tele`
// screen), which hands over to start() once the sim has travelled.
//
// Esc skips at any point, and the world ends up the same either way: the same
// hour, the same lines thought. The player is never stepped, so input does
// nothing until control. R at the chapter card wakes the golem again.
import type { Screen } from "../ui/screens";
import type { Facing } from "../golem";
import { ARRIVE, CROSSING, type CrossingScript } from "../content/cutscenes";
import { FIRST_MORNING_HOUR } from "../content/daycycle";
import { FLAGS } from "../content/flags";
import { beatsCrossed, timeline } from "../ui/cutscene";
import { playerThinks } from "../sim/monologue";
import { advanceDayUpTo, worldHour } from "../sim/daytime";
import { hasFlag } from "../world/world";
import { renderChapter, renderTransit } from "./cards";
import type { CutsceneHost } from "./intro";

/** What the crossing drives in the host beyond the opening's needs. */
export interface CrossingHost extends CutsceneHost {
  /** Which way the golem is drawn facing during a cutscene (null: as the sim says). Presentation only. */
  gaze: Facing | null;
  /** The arrival act at `t` seconds: the far rune's awakening, the summons, the fall. */
  arriveStep(t: number, dt: number): void;
  /** The arrival is over (played or skipped): the rune follows its flag, the golem stands on it. */
  arriveEnd(): void;
  /** Over the arrival's world scene: the cut in from black and the flash. */
  arriveOverlay(t: number): void;
  /** The golem comes down on the dais. */
  landFx(): void;
  /** First light from the east, 0..1 (0 puts it out). */
  sunrise(level: number): void;
  /** Letterbox and thoughts alone, over a picture the cutscene drew itself. */
  renderCinema(): void;
  clearParticles(): void;
  anyKey(): boolean;
  /** A fresh world and the opening again. */
  wakeAgain(): void;
}

const smooth = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

/** Cue table: what each `cues` name in the script does. */
export const CROSSING_CUES: Record<string, (g: CrossingHost) => void> = {
  /** The rush upward out of the halls. */
  ascend: (g) => { g.sfx.tone(64, 2.9, "sine", 0.07, 230); g.sfx.noise(2.7, 0.05, "bandpass", 300, 1.5, 0, 1400); },
  /** The far anchor does not answer: the climb stalls under the grass. */
  stall: (g) => g.sfx.stall(),
  /** The golem begins to write the missing carvings back. */
  rewrite: (g) => { g.sfx.tone(110, 1.8, "sine", 0.05, 196); g.sfx.chirp(); },
  land: (g) => g.landFx(),
  faceLeft: (g) => { g.gaze = "left"; },
  faceRight: (g) => { g.gaze = "right"; },
  faceDown: (g) => { g.gaze = "down"; },
  faceUp: (g) => { g.gaze = "up"; },
  dawn: (g) => g.sfx.dawn(),
  chapter: (g) => g.sfx.insight(),
};

export class CrossingCutscene {
  readonly screen: Screen;
  /** Beat start times by label. */
  readonly at: Record<string, number>;
  /** The hour the time-lapse set out from (-1: not begun). */
  private lapseFrom = -1;

  constructor(private g: CrossingHost, readonly script: CrossingScript = CROSSING) {
    this.screen = { id: "crossing", opaque: true, t: 0, update: (dt) => this.update(dt), render: () => this.render() };
    this.at = Object.fromEntries(timeline(script).map((b) => [b.label, b.at]));
    for (const need of ["stall", "rewrite", "surface", "landed", "first light", "chapter"]) if (!(need in this.at)) throw new Error(`crossing script: no "${need}" beat`);
  }

  /** Which act is playing at screen time `t`. */
  actAt(t: number): "transit" | "arrival" | "firstLight" {
    return t < this.at.surface ? "transit" : t < this.at["first light"] ? "arrival" : "firstLight";
  }

  /** Begin (the host's rune effect has finished and the sim has travelled: the golem is on the surface, unseen). */
  start() {
    const g = this.g;
    g.screens.set(this.screen);
    g.monologue.pinned = true; // the golem's account stays up until control
    g.letterbox(true);
    g.gaze = null;
    this.lapseFrom = -1;
    // the world waits in its before state under the card: the rune still dormant, nobody on it
    g.arriveStep(0, 0);
  }

  private update(dt: number) {
    const g = this.g, c = this.script, A = this.at, t = this.screen.t, t0 = t - dt;
    if (t > 0.2 && g.hit("escape")) { this.finish(true); return; }
    if (t >= A.chapter + c.promptAfter) {
      if (g.hit("r")) { g.wakeAgain(); return; }
      if (g.anyKey()) { this.finish(false); return; }
    }
    for (const b of beatsCrossed(c, t0, t)) {
      for (const cue of b.cues ?? []) CROSSING_CUES[cue]?.(g);
      if (b.think) playerThinks(g.world, b.think);
      if (b.label === "surface") g.clearParticles();
      if (b.control) { this.finish(false); return; }
    }
    if (t < A.surface) {
      // transit: a card. The world holds still behind it; only the golem's thoughts run.
      g.drainEvents();
      g.animate(dt);
      return;
    }
    const lt = t - A.surface;
    if (lt <= ARRIVE.END) g.arriveStep(lt, dt);
    else if (lt - dt <= ARRIVE.END) g.arriveEnd();
    if (t >= A["first light"]) {
      // the calendar clock runs on to morning while the golem watches (never back: sim/daytime.ts)
      if (this.lapseFrom < 0) this.lapseFrom = worldHour(g.world);
      const k = smooth((t - A["first light"]) / c.lapse);
      advanceDayUpTo(g.world, this.lapseFrom + (FIRST_MORNING_HOUR - this.lapseFrom) * k);
      g.sunrise(Math.sin(Math.PI * Math.min(1, (t - A["first light"]) / (c.lapse + 3))));
    }
    g.worldFrame(dt);
  }

  /** Esc: end the crossing now, as if it had played. */
  skip() { this.finish(true); }

  /**
   * Hand over control. Played out or skipped, the world is left the same: the
   * rune restored with the golem standing on it, the clock at the first
   * morning, every line of the crossing thought (a skipped line is recorded
   * as said, only never shown).
   */
  private finish(skipped: boolean) {
    const g = this.g, t = this.screen.t;
    if (skipped) {
      for (const b of timeline(this.script)) if (b.at > t && b.think) playerThinks(g.world, b.think);
      g.drainEvents();
      g.monologue.reset();
      g.clearParticles();
    }
    g.arriveEnd();
    g.sunrise(0);
    g.gaze = null;
    advanceDayUpTo(g.world, FIRST_MORNING_HOUR);
    g.worldFrame(0);
    g.letterbox(false);
    g.monologue.release();
    g.sfx.online();
    g.startPlay();
    g.say("THE SURFACE. THE WILD HAS SWALLOWED ALL TRACE OF THE HALLS.");
  }

  private render() {
    const g = this.g, c = this.script, A = this.at, t = this.screen.t;
    if (t < A.surface) {
      renderTransit(g.ctx, g.t, {
        et: t, stallAt: A.stall, rewriteAt: A.rewrite, endAt: A.surface, whiteOut: c.whiteOut,
        hasArm: hasFlag(g.world, FLAGS.golemArm), eyeFixed: hasFlag(g.world, FLAGS.golemEye),
      });
      g.renderCinema();
    } else {
      g.renderScene();
      g.arriveOverlay(t - A.surface);
      if (t >= A.chapter) renderChapter(g.ctx, g.t, t - A.chapter, c.promptAfter, g.world, g.pl);
    }
    if (t < A.chapter) g.renderSkipHint(t);
  }
}
