// The opening cutscene, extracted from the host. The script (beats, timings,
// lines) is data in content/cutscenes.ts; ui/cutscene.ts turns the screen's
// clock into beats and track values. This screen interprets them: cue sounds
// and sparks, the golem's core/eye/body look, and the golem's thoughts, which
// go through the sim's `think` command like any other monologue line. The
// world steps underneath (as before), but the player is never stepped: input
// does nothing until the `control` beat, where the letterbox opens, a soft
// tone plays and the play screen takes over.
import type { Screen } from "../ui/screens";
import type { UiHost } from "../ui/kit";
import type { MonologueLog } from "../ui/monologue";
import { INTRO, type Cutscene, type CutsceneTracks } from "../content/cutscenes";
import { beatsCrossed, trackAt } from "../ui/cutscene";
import { playerThinks } from "../sim/monologue";
import { BASE_W as W, BASE_H as H } from "../view/zoom";

/** What the cutscene needs from the host beyond UiHost (presentation state it drives). */
export interface CutsceneHost extends UiHost {
  /** The golem's presentation-only body state. */
  readonly look: { eye: number; core: number; dormant: number };
  readonly monologue: MonologueLog;
  sparkBurst(n: number): void;
  shake(t: number, mag: number): void;
  /** One frame of world simulation plus its presentation (events drained). */
  worldFrame(dt: number): void;
  /** Letterbox bars in (cutscene) or out (control). The host eases and draws them. */
  letterbox(on: boolean): void;
  /** Hand control to the player (the play screen). */
  startPlay(): void;
  /** Draw the lit world scene and HUD (the monologue, the letterbox) on both layers. */
  renderScene(): void;
}

/** Cue table: what each `cues` name in a script does. Adding a cue is a row here. */
export const CUTSCENE_CUES: Record<string, (g: CutsceneHost) => void> = {
  sparks: (g) => { g.sparkBurst(8); g.sfx.spark(); },
  sparksSmall: (g) => { g.sparkBurst(6); g.sfx.spark(); },
  boot: (g) => g.sfx.boot(),
  thud: (g) => g.sfx.thud(),
  diagDone: (g) => g.sfx.diagDone(),
  /** The torn shoulder spits as the golem notices the arm is gone. */
  armSparks: (g) => { g.sparkBurst(5); g.sfx.spark(); },
  hollow: (g) => g.sfx.hollow(),
};

/** Step-wise hash for the diagnostics flicker (presentation only). */
const stepNoise = (n: number) => { const s = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };

/** The golem's look for each track mode at time t. */
function lookFor(c: Cutscene, t: number) {
  const core = trackAt(c, "core", t), eye = trackAt(c, "eye", t), body = trackAt(c, "body", t);
  const coreV: Record<CutsceneTracks["core"], () => number> = {
    off: () => 0,
    // the original boot flicker: lit more and more often, brighter, until steady
    boot: () => (Math.random() < core.k ? core.k : 0.1),
    on: () => 1,
    // running diagnostics: stepped, irregular pulses, like a drive light
    diagnose: () => { const r = stepNoise(Math.floor(core.since / 0.06)); return r < 0.3 ? 0.2 : r < 0.75 ? 0.95 : 0.55; },
  };
  const eyeV: Record<CutsceneTracks["eye"], () => number> = {
    off: () => 0, flicker: () => (Math.sin(t * 40) > 0 ? 1 : 0.2), on: () => 1,
  };
  const dormant: Record<CutsceneTracks["body"], number> = { slumped: 1, rise: 1 - body.k, up: 0 };
  return { core: coreV[core.mode](), eye: eyeV[eye.mode](), dormant: dormant[body.mode], diagnosing: core.mode === "diagnose" ? core.since : -1 };
}

export class IntroCutscene {
  readonly screen: Screen;
  constructor(private g: CutsceneHost, readonly script: Cutscene = INTRO) {
    this.screen = { id: "intro", opaque: true, t: 0, update: (dt) => this.update(dt), render: () => this.render() };
  }

  /** Begin (title -> intro, or R after the end card on a fresh world). */
  start() {
    const g = this.g;
    g.screens.set(this.screen);
    g.monologue.pinned = true; // the list stays up until control
    g.letterbox(true);
  }

  private update(dt: number) {
    const g = this.g, c = this.script, t = this.screen.t, t0 = t - dt;
    for (const b of beatsCrossed(c, t0, t)) {
      for (const cue of b.cues ?? []) CUTSCENE_CUES[cue]?.(g);
      if (b.think) playerThinks(g.world, b.think);
      if (b.control) {
        // control: the letterbox opens, the list starts to fade, the play screen takes input from the next frame
        g.worldFrame(dt);
        g.letterbox(false);
        g.monologue.release();
        g.sfx.online();
        g.startPlay();
        return;
      }
    }
    const lk = lookFor(c, t);
    g.look.core = lk.core; g.look.eye = lk.eye; g.look.dormant = lk.dormant;
    // diagnostics: quiet data chirps on some of the flicker's steps
    if (lk.diagnosing >= 0 && Math.floor(lk.diagnosing / 0.06) !== Math.floor((lk.diagnosing - dt) / 0.06) && stepNoise(Math.floor(lk.diagnosing / 0.06)) > 0.72) g.sfx.chirp();
    g.worldFrame(dt);
  }

  /** Drawn after the host's world scene and HUD: the fade from black. */
  renderFade() {
    const t = this.screen.t, f = this.script.fadeIn;
    if (t < f) { this.g.ctx.fillStyle = `rgba(0,0,0,${1 - t / f})`; this.g.ctx.fillRect(0, 0, W, H); }
  }

  private render() { this.g.renderScene(); this.renderFade(); }
}
