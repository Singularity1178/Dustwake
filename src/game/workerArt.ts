// Bodies that run on power and do work (procedural, golem.ts style): BODY_ART
// is keyed by an ActorDef art key, like NPC_ART, but its pose carries what the
// guardian-shaped NpcPose can't: power, posture, walking (phase, moving) and
// task motion. Each function runs twice per frame, once with an albedo Pen and
// once with an emissive Pen (non-glowing pixels write black there), and golem
// vision retraces it every frame through view/actors.ts: drawActor.
//
// THE WORKER GOLEM. The maintainer (the player) is carved grey stone that
// thinks for itself. A worker is the cheap rank below it: slip-cast from red
// clay in one mould, fired, then banded with blackened iron. It is small and
// built for hauling and hitting things, nothing finer:
//   - squat barrel body, stump legs with iron-shod flat feet, no knees to speak of
//   - big mitten fists: no fingers, so no building and no craft beyond bench work
//   - one cyclops lens behind a visor slot with an iron lid; it has no face to read,
//     it looks where the order points
//   - a lifting ring on its head (people carry these about, they don't talk to them)
//   - the iron belt is also the buckle of its core hatch: a ruby core behind a
//     2x2 window, and a stencilled tally mark beside it (which job-lot it came from)
//   - an iron vent plate and grille on its back where the core's heat shows through
// Its postures are continuous (see WorkerPose): `rise` crouched .. standing,
// `neck` head sunk .. raised, `arms` tucked .. free, so the animator (workerAnim.ts)
// can boot it up, stand it, settle it dormant and shut it down by keyframe. Walking
// and task motion layer on top. While channelling a rune it draws nothing special:
// it stands, and the host plays the rune's own effect around it.
import { Pen } from "./util";
import type { Facing } from "./golem";

export interface WorkerPose {
  facing: Facing;
  phase: number;
  moving: boolean;
  t: number;
  /** Posture 0 crouched (dormant) .. 1 standing tall. */
  rise: number;
  /** Head 0 sunk between the shoulders .. 1 raised. */
  neck: number;
  /** Head turned, -1 (its left) .. 1 (its right). Front and back views shift it; sideways it dips. */
  yaw: number;
  /** 0 arms tucked over the knees .. 1 hanging free. */
  arms: number;
  /** Jitter 0..1 (a misfiring boot, a shutdown jolt). */
  shake: number;
  /** Body sink in px (+down), for a landing or a heavy blow. */
  dip: number;
  /** Core glow 0..1. 0: no glow at all (unpowered). */
  core: number;
  /** A core sits in the hatch (an unlit one is drawn dark red). */
  hasCore: boolean;
  /** Lens 0..1. 0: lid down. Under about a half the lens shows as a slit. */
  eye: number;
  /** Both arms together: 1 overhead .. 0 free .. -1 fists driven in front (a hammering blow). */
  swing: number;
  /** Arms out in front 0..1 (handing something over, working at a bench). */
  reach: number;
}

export type BodyArt = (p: Pen, x: number, y: number, pose: WorkerPose) => void;

/** Red clay, light from the top left. */
export const CLAY = { o: "#2b150e", d: "#70402b", m: "#a6663f", l: "#c98350", h: "#e5a872", c: "#4e2a1c" };
/** Blackened iron, warm. */
export const FE = { d: "#27211f", m: "#463d39", l: "#6b5e55", h: "#92857a" };
/** The stencil: faded ochre paint. */
const OCH = "#d4a23a", OCH_D = "#9c7424";
const HOLE = "#0c0706";
const GEM = { d: "#3a0c16", m: "#640f26" };

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function coreCols(v: number) {
  if (v <= 0.05) return null;
  return { c: `rgb(${(255 * v) | 0},${(36 * v) | 0},${(66 * v) | 0})`, hot: `rgb(${(255 * v) | 0},${(160 * v) | 0},${(170 * v) | 0})` };
}
const lampCol = (v: number) => (v <= 0.05 ? null : `rgb(${(255 * Math.min(1, v)) | 0},${(176 * Math.min(1, v)) | 0},${(60 * Math.min(1, v)) | 0})`);
const lampHot = (v: number) => `rgb(255,${(214 + 40 * Math.min(1, v)) | 0},${(140 * Math.min(1, v)) | 0})`;

/** The hatch's 2x2 window (or 1x2 edge-on): the core glowing, a seated core unlit, or an empty socket. */
function coreWindow(p: Pen, x: number, y: number, w: number, h: number, g: WorkerPose) {
  const c = coreCols(g.core);
  if (c) { p.g(x, y, w, h, c.c); p.gp(x, y, c.hot); }
  else if (g.hasCore) { p.r(x, y, w, h, GEM.m); p.p(x + w - 1, y + h - 1, GEM.d); }
  else p.r(x, y, w, h, HOLE);
}

/** A fat limb from (x0,y0) to (x1,y1): outlined stamps, so it bends anywhere, with a lit edge. */
function limb(p: Pen, x0: number, y0: number, x1: number, y1: number, th: number, fill: string, hi: string) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const at = (i: number) => [Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n))];
  const h = Math.floor(th / 2);
  for (let i = 0; i <= n; i++) { const [x, y] = at(i); p.r(x - h - 1, y - h - 1, th + 2, th + 2, CLAY.o); }
  for (let i = 0; i <= n; i++) { const [x, y] = at(i); p.r(x - h, y - h, th, th, fill); }
  for (let i = 0; i <= n; i++) { const [x, y] = at(i); p.p(x - h, y - h, hi); }
}

/** The mitten: a fat fist, no fingers, an iron cuff above it and one thumb crease. */
function mitt(p: Pen, x: number, y: number, lit: boolean) {
  const f = lit ? CLAY.l : CLAY.m;
  p.r(x - 1, y - 3, 3, 1, FE.m); p.p(x - 1, y - 3, FE.l);
  p.o(x - 2, y - 2, 5, 4, f, CLAY.o);
  p.r(x - 1, y - 1, 3, 1, lit ? CLAY.h : CLAY.l);
  p.p(x + 1, y, CLAY.d);
}

/** The lifting ring on top of the head. */
function ring(p: Pen, x: number, hy: number, neck: number) {
  const k = neck < 0.4 ? 1 : 0; // laid flat when the head is sunk
  p.r(x - 1, hy - 3 + k, 2, 1, FE.h);
  p.p(x - 2, hy - 2 + k, FE.l); p.p(x + 1, hy - 2 + k, FE.m);
  p.p(x - 2, hy - 1 + k, FE.m); p.p(x + 1, hy - 1 + k, FE.d);
}

export function drawWorker(p: Pen, x: number, y: number, g: WorkerPose) {
  const jx = g.shake > 0.02 ? Math.round(Math.sin(g.t * 71) * g.shake * 1.4) : 0;
  p.ox = Math.round(x) + jx;
  p.oy = Math.round(y);
  p.flip = false;
  const R = g.rise, crouch = R < 0.5;
  const s = Math.sin(g.phase);
  const walk = g.moving && R > 0.9;
  const liftA = walk ? Math.round(Math.max(0, s) * 2) : 0;
  const liftB = walk ? Math.round(Math.max(0, -s) * 2) : 0;
  const bob = walk && Math.abs(s) > 0.72 ? -1 : 0; // an even stomping gait
  const by = bob + Math.round(g.dip);
  const L = Math.round(2 + 2 * R);          // leg length
  const Th = 8;                             // torso height
  const T0 = -L - Th + by;                  // torso top
  const sink = Math.round((1 - g.neck) * 2);
  const hy = T0 - 5 + sink;
  const lampV = g.eye, lamp = lampCol(lampV);
  const swing = g.swing, reach = g.reach;
  const sway = walk ? s : 0;

  if (g.facing === "down" || g.facing === "up") {
    const back = g.facing === "up";
    const hx = Math.round(g.yaw * 1.4);
    // knees, when it is crouched: fat clay blocks the arms rest on
    if (crouch) { p.o(-7, -5, 3, 3, back ? CLAY.d : CLAY.m, CLAY.o); p.o(4, -5, 3, 3, back ? CLAY.m : CLAY.d, CLAY.o); }
    const spread = crouch ? 1 : 0;
    // legs: stump pillars on flat iron-shod feet
    const leg = (lx: number, lift: number, shade: number) => {
      p.o(lx, -L - lift, 4, L, shade ? CLAY.m : CLAY.d, CLAY.o);
      p.r(lx + 1, -L + 1 - lift, 1, Math.max(0, L - 2), shade ? CLAY.l : CLAY.m);
      p.o(lx - 1 + (lx < 0 ? -spread : spread), -3 - lift, 5, 3, FE.m, CLAY.o);
      p.r(lx + (lx < 0 ? -spread : spread), -2 - lift, 3, 1, FE.l);
    };
    leg(-5, liftA, back ? 0 : 1); leg(1, liftB, back ? 1 : 0);
    // torso: a barrel, octagon corners from the mould
    p.r(-4, T0, 8, Th, CLAY.o); p.r(-5, T0 + 1, 10, Th - 2, CLAY.o);
    p.r(-3, T0 + 1, 6, Th - 2, CLAY.m); p.r(-4, T0 + 2, 8, Th - 4, CLAY.m);
    p.r(-3, T0 + 1, 6, 1, CLAY.l); p.r(-4, T0 + 2, 1, Th - 5, CLAY.l);
    p.r(3, T0 + 2, 1, Th - 4, CLAY.d); p.r(2, T0 + Th - 3, 2, 1, CLAY.d);
    p.p(-2, T0 + 2, CLAY.h);
    // the belt: a riveted iron band
    p.r(-4, T0 + Th - 3, 8, 2, FE.m); p.r(-4, T0 + Th - 3, 8, 1, FE.l);
    p.p(-3, T0 + Th - 2, FE.h); p.p(2, T0 + Th - 2, FE.h);
    if (!back) {
      // the hatch is the belt's buckle: an iron frame round the core window; the stencil beside it
      p.o(-2, T0 + 2, 4, 4, FE.m, CLAY.o); p.p(-2, T0 + 2, FE.h); p.p(1, T0 + 5, FE.d);
      coreWindow(p, -1, T0 + 3, 2, 2, g);
      p.r(-4, T0 + 2, 1, 3, OCH); p.p(-4, T0 + 5, OCH_D);
      p.p(3, T0 + 3, OCH_D); p.p(3, T0 + 4, OCH_D);
      p.p(-3, T0 + 4, CLAY.c); // a hairline chip
    } else {
      // the vent plate: slats the core's heat shows through, and a chipped corner
      p.o(-3, T0 + 2, 6, 5, FE.d, CLAY.o);
      const c = coreCols(g.core * 0.6);
      for (const gx of [-2, 0]) { if (c) p.g(gx, T0 + 3, 1, 3, c.c); else p.r(gx, T0 + 3, 1, 3, HOLE); }
      p.p(2, T0 + 3, FE.l); p.p(2, T0 + 5, FE.m); p.p(-3, T0 + 2, FE.l);
      p.p(3, T0 + 2, CLAY.c);
    }
    // the head: a low cyclops block, ears of iron clamp
    ring(p, hx, hy, g.neck);
    p.o(-4 + hx, hy, 8, 6, CLAY.m, CLAY.o);
    p.r(-3 + hx, hy + 1, 6, 1, CLAY.l); p.r(-3 + hx, hy + 1, 1, 4, CLAY.l);
    p.r(3 + hx, hy + 1, 1, 4, CLAY.d); p.r(-2 + hx, hy + 4, 5, 1, CLAY.d);
    p.r(-5 + hx, hy + 2, 1, 3, FE.l); p.r(4 + hx, hy + 2, 1, 3, FE.d); p.p(-5 + hx, hy + 2, FE.h);
    if (!back) {
      p.r(-3 + hx, hy + 2, 6, 2, HOLE);                        // the visor slot
      p.r(-3 + hx, hy + 1, 6, 1, FE.m);                        // its iron brow
      if (lamp) {
        const lx = Math.round(-1 + g.yaw * 1.6) + hx;
        if (lampV > 0.5) { p.g(lx, hy + 2, 2, 2, lamp); p.gp(lx, hy + 2, lampHot(lampV)); }
        else p.g(lx, hy + 3, 2, 1, lamp);
      } else p.r(-3 + hx, hy + 2, 6, 1, FE.d);                 // the lid, down
    } else {
      p.r(-2 + hx, hy + 2, 4, 1, CLAY.d); p.p(-3 + hx, hy + 2, FE.m); p.p(2 + hx, hy + 2, FE.m); // the cast seam, two bolts
    }
    // the arms: pegs of clay into big mitts
    const arm = (left: boolean) => {
      const sg = left ? -1 : 1, sx = left ? -7 : 6, sy = T0 + 2;
      const lit = left !== back;
      const wk = left ? sway : -sway;
      let hx2 = sx, hy2 = sy + 6 + Math.round(wk * 2);
      // tucked over the knees
      hx2 = lerp(sg * 6, hx2, g.arms); hy2 = lerp(-4, hy2, g.arms);
      // working: overhead, a hammering blow, reaching
      if (swing > 0) { hx2 = lerp(hx2, sg * 4, swing); hy2 = lerp(hy2, T0 - 6, swing); }
      else if (swing < 0) { hx2 = lerp(hx2, sg * 4, -swing); hy2 = lerp(hy2, T0 + Th + 1, -swing); }
      if (reach > 0) { hx2 = lerp(hx2, sg * 4, reach); hy2 += reach * (back ? -3 : 3); }
      const hxr = Math.round(hx2), hyr = Math.round(hy2);
      p.o(sx - 1, sy - 2, 3, 3, FE.m, CLAY.o); // the iron peg-joint, no pauldron: no rank
      limb(p, sx, sy, hxr, hyr - 3, 3, lit ? CLAY.m : CLAY.d, lit ? CLAY.l : CLAY.m);
      mitt(p, hxr, hyr, lit);
    };
    arm(true); arm(false);
    return;
  }

  // ---- side view (drawn facing right; flipped for left)
  p.flip = g.facing === "left";
  const lean = crouch ? 1 : 0;
  const legOff = walk ? Math.round(s * 2) : 0;
  const hs = Math.round(g.yaw * 1); // sideways a turned head can only dip
  const armAt = (far: boolean) => {
    const sx = lean + (far ? 1 : 0), sy = T0 + 2;
    const wk = far ? -sway : sway;
    let a = wk * 0.55 + (far ? 0.08 : 0);
    if (reach > 0) a += reach * (far ? 1.15 : 1.35);
    if (swing > 0) a = lerp(a, -Math.PI * 0.92, swing);
    else if (swing < 0) a = lerp(a, 0.62, -swing);
    const len = 6;
    let hx2 = sx + Math.sin(a) * len, hy2 = sy + Math.cos(a) * len;
    hx2 = lerp(lean + 5, hx2, g.arms); hy2 = lerp(-5, hy2, g.arms);
    const hxr = Math.round(hx2), hyr = Math.round(hy2);
    limb(p, sx, sy, hxr, hyr - 2, 3, far ? CLAY.d : CLAY.m, far ? CLAY.m : CLAY.l);
    mitt(p, hxr, hyr, !far);
    if (!far) p.o(sx - 1, sy - 2, 3, 3, FE.m, CLAY.o);
  };
  armAt(true);
  // legs
  if (crouch) {
    // sat back on its haunches: a fat thigh block forward, the flat foot out front
    p.o(-3, -6, 8, 4, CLAY.d, CLAY.o); p.r(-2, -5, 6, 1, CLAY.m);
    p.o(0, -3, 7, 3, FE.m, CLAY.o); p.r(1, -2, 5, 1, FE.l);
    p.o(-4, -3, 4, 3, FE.d, CLAY.o);
  } else {
    p.o(-3 - legOff, -L - liftB, 4, L, CLAY.d, CLAY.o);
    p.o(-4 - legOff, -3 - liftB, 6, 3, FE.d, CLAY.o); p.r(-3 - legOff, -2 - liftB, 4, 1, FE.m);
    p.o(-1 + legOff, -L - liftA, 4, L, CLAY.m, CLAY.o); p.r(0 + legOff, -L + 1 - liftA, 1, Math.max(0, L - 2), CLAY.l);
    p.o(-2 + legOff, -3 - liftA, 6, 3, FE.m, CLAY.o); p.r(-1 + legOff, -2 - liftA, 4, 1, FE.l);
  }
  // the vent plate on its back, and the torso
  p.o(-6 + lean, T0 + 2, 3, 5, FE.d, CLAY.o);
  { const c = coreCols(g.core * 0.55); if (c) p.g(-5 + lean, T0 + 3, 1, 3, c.c); else p.r(-5 + lean, T0 + 3, 1, 3, HOLE); }
  p.r(-3 + lean, T0, 6, Th, CLAY.o); p.r(-4 + lean, T0 + 1, 8, Th - 2, CLAY.o);
  p.r(-2 + lean, T0 + 1, 4, Th - 2, CLAY.m); p.r(-3 + lean, T0 + 2, 6, Th - 4, CLAY.m);
  p.r(-2 + lean, T0 + 1, 4, 1, CLAY.l); p.r(-3 + lean, T0 + 2, 1, Th - 5, CLAY.d);
  p.r(1 + lean, T0 + 2, 2, 1, CLAY.l); p.p(-1 + lean, T0 + 3, CLAY.c);
  p.r(-3 + lean, T0 + Th - 3, 6, 2, FE.m); p.r(-3 + lean, T0 + Th - 3, 6, 1, FE.l); p.p(-1 + lean, T0 + Th - 2, FE.h);
  // the hatch edge on its front
  p.o(3 + lean, T0 + 2, 3, 4, FE.m, CLAY.o);
  coreWindow(p, 4 + lean, T0 + 3, 1, 2, g);
  p.p(2 + lean, T0 + 4, OCH);
  // head
  const hyS = hy + hs;
  ring(p, lean, hyS, g.neck);
  p.o(-3 + lean, hyS, 7, 6, CLAY.m, CLAY.o);
  p.r(-2 + lean, hyS + 1, 5, 1, CLAY.l); p.r(-2 + lean, hyS + 1, 1, 4, CLAY.d);
  p.r(-1 + lean, hyS + 2, 2, 3, FE.m); p.p(0 + lean, hyS + 3, FE.h);
  p.r(1 + lean, hyS + 4, 2, 1, CLAY.d);
  p.r(1 + lean, hyS + 2, 3, 2, HOLE);
  p.r(1 + lean, hyS + 1, 3, 1, FE.m);
  if (lamp) {
    if (lampV > 0.5) { p.g(2 + lean, hyS + 2, 2, 2, lamp); p.gp(3 + lean, hyS + 2, lampHot(lampV)); }
    else p.g(2 + lean, hyS + 3, 2, 1, lamp);
  } else p.r(1 + lean, hyS + 2, 3, 1, FE.d);
  armAt(false);
}

export const BODY_ART: Record<string, BodyArt> = {
  worker: drawWorker,
};

/** The three things a worker body can be doing (see workerAnim.ts for how it moves between them). */
export type WorkerState = "off" | "idle" | "work";
export const workerState = (isPowered: boolean, active: boolean): WorkerState => (!isPowered ? "off" : active ? "work" : "idle");

/** Core glow per state. Idle is deliberately faint: powered, but dormant, not active. */
export const WORKER_CORE: Record<WorkerState, number> = { off: 0, idle: 0.38, work: 1 };

/** The steady pose of a state (no animation in flight). Off and idle are the same crouch, the core aside. */
export function workerPose(state: WorkerState, m: { facing: Facing; phase: number; moving: boolean; t: number; hasCore: boolean; swing?: number; reach?: number; boot?: number }): WorkerPose {
  const work = state === "work";
  const core = state === "off" ? 0 : Math.min(1, WORKER_CORE[state] + (m.boot ?? 0) * (1 - WORKER_CORE[state]));
  return {
    facing: m.facing, phase: m.phase, moving: work && m.moving, t: m.t,
    rise: work ? 1 : 0, neck: work ? 1 : 0, yaw: 0, arms: work ? 1 : 0, shake: 0, dip: 0,
    core, hasCore: m.hasCore, eye: work ? 1 : 0, swing: work ? m.swing ?? 0 : 0, reach: work ? m.reach ?? 0 : 0,
  };
}
