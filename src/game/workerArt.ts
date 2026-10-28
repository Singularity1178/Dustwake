// Bodies that run on power and do work (procedural, golem.ts style): BODY_ART
// is keyed by an ActorDef art key, like NPC_ART, but its pose carries what the
// guardian-shaped NpcPose can't: power, working, walking (phase, moving) and
// task motion. Each function runs twice per frame, once with an albedo Pen and
// once with an emissive Pen (non-glowing pixels write black there), and golem
// vision retraces it every frame through view/actors.ts: drawActor.
//
// The worker golem is the family every general-purpose worker comes from. The
// maintainer (the player) is carved stone that thinks for itself; a worker is
// cast in a mould, banded with iron and built for plain labour: squat and
// square, plain iron joints where the maintainer wears pauldrons, mitts for
// hands, a single lamp behind a shutter for an eye, a lifting lug on its head,
// a stencilled tally on its chest, and a small ruby core behind an iron hatch.
// It does only what it is tasked, so it has three states (WorkerState):
//   off   no power: stowed (head sunk into the shoulders, forearms folded over
//         the belt, shutter closed), the hatch dark. Upright, not slumped.
//   idle  powered, no task: the same stowed posture, the core seated and
//         glowing faintly. Nothing else changes: the eye stays shuttered.
//   work  powered and tasked: it stands up, arms free, eye lit, core bright;
//         walks with an even, machine gait and swings into its task.
import { Pen } from "./util";
import { IR, BN } from "./art/palette";
import type { Facing } from "./golem";

export interface WorkerPose {
  facing: Facing;
  phase: number;
  moving: boolean;
  /** 0 standing free (working) .. 1 stowed (off and powered-idle). */
  stowed: number;
  /** Core glow 0..1. 0: no glow at all (unpowered). */
  core: number;
  /** A core sits in the hatch (an unlit one is drawn dark red). */
  hasCore: boolean;
  /** Eye lamp 0..1. 0: shutter closed. */
  eye: number;
  /** Task motion: arm raise -1..1 (a punch: 1 overhead) and reach 0..1. */
  raise: number;
  reach: number;
  t: number;
}

export type BodyArt = (p: Pen, x: number, y: number, pose: WorkerPose) => void;

/** Cast stone (sandier and paler than the maintainer's carved grey, nothing like the guardian's dark plate). */
const W = { o: "#1e1812", d: "#4a3e2f", m: "#706149", l: "#928062", h: "#b09c7a" };
const HOLE = "#0d0a08";
const GEM = { d: "#3a0c16", m: "#5e1424" };

function coreCols(v: number) {
  if (v <= 0.05) return null;
  return { c: `rgb(${(255 * v) | 0},${(40 * v) | 0},${(64 * v) | 0})`, hot: `rgb(${(255 * v) | 0},${(150 * v) | 0},${(160 * v) | 0})` };
}
const eyeCol = (v: number) => (v <= 0.05 ? null : `rgb(${(255 * v) | 0},${(168 * v) | 0},${(64 * v) | 0})`);

/** The iron hatch's 2x2 window: the core glowing, a seated core unlit, or an empty socket. */
function coreWindow(p: Pen, x: number, y: number, w: number, h: number, g: WorkerPose) {
  const c = coreCols(g.core);
  if (c) { p.g(x, y, w, h, c.c); p.gp(x, y, c.hot); }
  else if (g.hasCore) { p.r(x, y, w, h, GEM.m); p.p(x + w - 1, y + h - 1, GEM.d); }
  else p.r(x, y, w, h, HOLE);
}

/** The head (front, back or side): a plain block with a lifting lug; the lamp shows only from the front and side. */
function lug(p: Pen, x: number, hy: number) {
  p.r(x, hy - 2, 2, 1, IR.l); p.p(x - 1, hy - 1, IR.m); p.p(x + 2, hy - 1, IR.m);
}

export function drawWorker(p: Pen, x: number, y: number, g: WorkerPose) {
  p.ox = Math.round(x);
  p.oy = Math.round(y);
  p.flip = false;
  const stowed = g.stowed >= 0.5;
  const s = Math.sin(g.phase);
  const walk = g.moving && !stowed;
  const liftA = walk ? Math.round(Math.max(0, s) * 2) : 0;
  const liftB = walk ? Math.round(Math.max(0, -s) * 2) : 0;
  const by = walk && Math.abs(s) > 0.7 ? -1 : 0; // an even gait: it bobs, it doesn't limp
  const hd = stowed ? 2 : 0; // stowed, the head sinks into the shoulders
  const swing = walk ? Math.round(s * 1.5) : 0;
  const eye = eyeCol(g.eye);
  const hy = -19 + by + hd;
  const ry = g.raise > 0 ? -Math.round(g.raise * 9) : Math.round(-g.raise * 3);

  if (g.facing === "down" || g.facing === "up") {
    const back = g.facing === "up";
    // legs: stubby, iron-shod
    p.o(-5, -4 - liftA, 4, 4 + liftA, back ? W.d : W.m, W.o); p.r(-4, -3 - liftA, 2, 1, back ? W.m : W.l);
    p.o(1, -4 - liftB, 4, 4 + liftB, back ? W.m : W.d, W.o); p.r(2, -3 - liftB, 2, 1, back ? W.l : W.m);
    p.r(-4, -1, 2, 1, IR.d); p.r(2, -1, 2, 1, IR.d);
    // free arms hang behind the torso's edge from the back
    const reachY = Math.round(g.reach * (back ? -2 : 2));
    const armL = () => {
      p.o(-8, -12 + by + swing + reachY, 3, 7, back ? W.d : W.m, W.o); p.r(-7, -11 + by + swing + reachY, 1, 4, back ? W.m : W.l);
      p.o(-9, -6 + by + swing + reachY, 4, 3, back ? W.m : W.l, W.o);
    };
    const armR = () => {
      p.o(5, -12 + by - swing + ry, 3, 7, back ? W.m : W.d, W.o); p.r(6, -11 + by - swing + ry, 1, 4, back ? W.l : W.m);
      p.o(5, -6 + by - swing + ry, 4, 3, back ? W.l : W.m, W.o);
    };
    // belt: an iron band, riveted
    p.o(-5, -7 + by, 10, 3, IR.d, W.o); p.p(-3, -6 + by, IR.l); p.p(2, -6 + by, IR.l);
    // torso: a squat cast block
    p.r(-5, -14 + by, 10, 8, W.o); p.r(-6, -13 + by, 12, 6, W.o); // cast in a mould: the corners come out rounded
    p.r(-5, -13 + by, 10, 6, W.m);
    p.r(-5, -13 + by, 10, 1, W.l);
    p.r(back ? -5 : 3, -12 + by, 2, 5, W.d);
    p.r(-5, -8 + by, 10, 1, W.d);
    if (!back) {
      // the stencilled tally, then the core hatch: an iron ring round a 2x2 window
      p.r(-5, -11 + by, 1, 2, BN.d); p.r(-3, -11 + by, 1, 2, BN.d);
      p.r(-1, -12 + by, 4, 4, IR.m); p.p(-1, -12 + by, IR.l); p.p(2, -9 + by, IR.d);
      coreWindow(p, 0, -11 + by, 2, 2, g);
    } else {
      // the back: an iron grille over the core, which shows faintly between its slats when powered
      p.r(-2, -12 + by, 5, 4, IR.d);
      const c = coreCols(g.core * 0.6);
      for (const gx of [-1, 1]) { if (c) p.g(gx, -11 + by, 1, 2, c.c); else p.r(gx, -11 + by, 1, 2, HOLE); }
      p.r(-2, -12 + by, 5, 1, IR.m);
    }
    // shoulders: plain iron joints (no pauldrons: no rank)
    p.o(-8, -14 + by, 3, 3, back ? IR.d : IR.m, W.o); p.o(5, -14 + by, 3, 3, back ? IR.m : IR.d, W.o);
    if (stowed) {
      // upper arms tight to the body; from the front the forearms fold over the belt, mitts meeting in the middle
      p.o(-8, -12 + by, 3, 5, back ? W.d : W.m, W.o); p.o(5, -12 + by, 3, 5, back ? W.m : W.d, W.o);
      if (!back) { p.o(-6, -8 + by, 6, 3, W.l, W.o); p.o(0, -8 + by, 6, 3, W.m, W.o); p.r(-5, -7 + by, 2, 1, W.h); }
    } else { armL(); armR(); }
    // head
    lug(p, -1, hy);
    p.o(-4, hy, 8, 6, W.m, W.o);
    p.r(-3, hy + 1, 6, 1, W.l);
    p.r(back ? -3 : 2, hy + 2, 1, 3, W.d);
    if (!back) {
      p.r(-3, hy + 3, 6, 1, HOLE); // the visor slot
      if (eye) p.g(-1, hy + 3, 2, 1, eye); else p.r(-1, hy + 3, 2, 1, W.d); // lamp lit, or the shutter down
    } else p.r(-2, hy + 4, 4, 1, W.d); // the cast seam
    return;
  }

  // ---- side view (drawn facing right; flipped for left)
  p.flip = g.facing === "left";
  const legOff = walk ? Math.round(s * 2) : 0;
  p.o(-3 - legOff, -4, 4, 4, W.d, W.o);
  p.o(-1 + legOff, -4 - (liftA || liftB ? 1 : 0), 4, 4 + (liftA || liftB ? 1 : 0), W.m, W.o);
  p.r(0 + legOff, -1, 2, 1, IR.d);
  const rx = Math.round(g.reach * 4);
  // far arm, behind the torso
  if (!stowed) p.o(1, -12 + by - swing, 3, 7, W.d, W.o);
  // torso, belt, the hatch's edge on the chest
  p.o(-4, -14 + by, 8, 8, W.m, W.o);
  p.r(-3, -13 + by, 6, 1, W.l);
  p.r(-3, -12 + by, 1, 5, W.d);
  p.o(-4, -7 + by, 8, 3, IR.d, W.o); p.p(-2, -6 + by, IR.l);
  p.r(3, -12 + by, 1, 3, IR.m);
  coreWindow(p, 3, -11 + by, 1, 2, g);
  // head
  lug(p, -1, hy);
  p.o(-3, hy, 7, 6, W.m, W.o);
  p.r(-2, hy + 1, 5, 1, W.l);
  p.r(-2, hy + 2, 1, 3, W.d);
  p.r(1, hy + 3, 3, 1, HOLE);
  if (eye) p.g(2, hy + 3, 2, 1, eye); else p.r(2, hy + 3, 2, 1, W.d);
  // shoulder joint and near arm: folded forward when stowed, hanging (and swinging, reaching, punching) when free
  p.o(-2, -14 + by, 3, 3, IR.m, W.o);
  if (stowed) { p.o(-2, -12 + by, 3, 5, W.m, W.o); p.o(-1, -8 + by, 6, 3, W.l, W.o); }
  else {
    p.o(-2 + rx, -12 + by + swing + ry, 3, 7, W.m, W.o); p.r(-1 + rx, -11 + by + swing + ry, 1, 4, W.l);
    p.o(-2 + rx, -6 + by + swing + ry, 4, 3, W.l, W.o);
  }
}

export const BODY_ART: Record<string, BodyArt> = {
  worker: drawWorker,
};

/** The three things a worker body can be doing (see the header). */
export type WorkerState = "off" | "idle" | "work";
export const workerState = (isPowered: boolean, active: boolean): WorkerState => (!isPowered ? "off" : active ? "work" : "idle");

/** Core glow per state. Idle is deliberately faint: powered, but dormant, not active. */
export const WORKER_CORE: Record<WorkerState, number> = { off: 0, idle: 0.38, work: 1 };

/**
 * The pose for a state plus the actor's motion. `boot` (0..1, presentation)
 * flares the core for a moment when one is slotted, then it settles.
 */
export function workerPose(state: WorkerState, m: { facing: Facing; phase: number; moving: boolean; t: number; hasCore: boolean; raise?: number; reach?: number; boot?: number }): WorkerPose {
  const work = state === "work";
  const core = state === "off" ? 0 : Math.min(1, WORKER_CORE[state] + (m.boot ?? 0) * (1 - WORKER_CORE[state]));
  return {
    facing: m.facing, phase: m.phase, moving: work && m.moving, stowed: work ? 0 : 1, core, hasCore: m.hasCore,
    eye: work ? 1 : 0, raise: work ? m.raise ?? 0 : 0, reach: work ? m.reach ?? 0 : 0, t: m.t,
  };
}
