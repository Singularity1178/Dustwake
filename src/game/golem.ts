import { Pen } from "./util";
import { IR, WD } from "./art/palette";
import { SLAM_HIT } from "./content/tasks";

export type Facing = "down" | "up" | "left" | "right";
export interface GolemPose {
  facing: Facing;
  phase: number;
  moving: boolean;
  hasArm: boolean;
  dormant: number; // 0 standing .. 1 slumped
  eye: number; // 0..1
  core: number; // 0..1
  raise: number; // arm raise: 1 overhead, 0 rest, -1 thrust
  reach: number; // 0..1 near-arm reach
  t: number;
  /** The eye has been mended (golem.eye): it no longer gutters. */
  eyeFixed?: boolean;
  /** Gear worn on the back, by item id (Actor.gear.back): "basket" is drawn strapped on, from every facing. */
  back?: string;
  /**
   * The two-arm ground slam (the attack), -1..1 for both arms at once: 1 both
   * overhead, 0 at rest, -1 both fists driven into the ground in front. Absent:
   * the arms follow raise / reach as before. Without the iron arm the broken
   * stub swings through the same arc.
   */
  slam?: number;
  /** Body offset during the slam, px: -1 straining up at the top, 2 sinking with the blow. */
  dip?: number;
}

const C = { o: "#1c1a18", d: "#3a3733", m: "#5a5650", l: "#7a756c", h: "#958f84", moss: "#4a5a32", moss2: "#5e7040" };

// ---- gear on the back (GolemPose.back). The woven basket, strapped on. Facing
// down it sits behind the body: its rim rises over the shoulders round the
// head and the straps cross the pauldrons. Facing up it covers the back below
// the head's crown. Sideways it hangs off the back behind the torso. Every
// part is offset by the body bob `by`, so it rides the limp and the slump.
const BK = { o: WD.o, rim: "#c8a466", hi: "#e0c286", body: "#a8844a", shade: "#86663a", weave: "#7a5a30", strap: "#3d2817", buckle: "#9aa4ae" };

/** Wicker texture: a diagonal over-under weave in the basket's own frame, so it moves with the basket. */
function weave(p: Pen, x: number, y: number, w: number, h: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (((i + j * 2) & 3) === 0) p.p(x + i, y + j, BK.weave);
}
/** Facing down: behind the whole body (drawn first); only the rim and upper weave show round the head. */
function basketFront(p: Pen, by: number) {
  p.o(-6, -22 + by, 12, 11, BK.body, BK.o);
  weave(p, -5, -21 + by, 10, 9);
  p.o(-7, -24 + by, 14, 3, BK.rim, BK.o);
  p.r(-6, -23 + by, 4, 1, BK.hi);
}
/** Facing down: the straps over the pauldrons and down the chest, with buckles. */
function strapsFront(p: Pen, by: number) {
  p.r(-6, -17 + by, 1, 8, BK.strap); p.r(5, -17 + by, 1, 8, BK.strap);
  p.p(-6, -12 + by, BK.buckle); p.p(5, -12 + by, BK.buckle);
}
/** Facing up: over the back and the inner pauldrons, below the head's crown (drawn after the head, before the near arm). */
function basketBack(p: Pen, by: number) {
  p.o(-6, -17 + by, 12, 11, BK.body, BK.o);
  weave(p, -5, -16 + by, 10, 9);
  p.r(3, -16 + by, 2, 9, BK.shade);
  p.o(-7, -19 + by, 14, 3, BK.rim, BK.o);
  p.r(-6, -18 + by, 4, 1, BK.hi);
  p.r(-5, -20 + by, 2, 1, BK.strap); p.r(3, -20 + by, 2, 1, BK.strap);
}
/** Sideways: hangs off the back (left of the unflipped, right-facing sprite), drawn before the torso so the torso overlaps it. */
function basketSide(p: Pen, by: number) {
  p.o(-10, -19 + by, 6, 12, BK.body, BK.o);
  weave(p, -9, -18 + by, 4, 10);
  p.r(-9, -18 + by, 1, 10, BK.shade);
  p.o(-11, -21 + by, 7, 3, BK.rim, BK.o);
  p.r(-10, -20 + by, 3, 1, BK.hi);
}
/** Sideways: the strap over the shoulder and down the front of the chest. */
function strapSide(p: Pen, by: number) {
  p.r(-4, -17 + by, 1, 2, BK.strap);
  p.r(3, -15 + by, 1, 7, BK.strap); p.p(3, -11 + by, BK.buckle);
}

// ---- the two-arm ground slam (GolemPose.slam). Both arms rise overhead
// together, then both fists drive into the ground in front. Arms are drawn as
// outlined 4 px segments from shoulder to fist, so they can point anywhere.

/**
 * The slam's pose at k = t/dur of its task: both arms rise (wind-up), gather
 * at the top, drop fast and land exactly at SLAM_HIT (where the effect fires,
 * so the impact frame, the shake and the dust coincide), hold in the ground
 * while the body sinks with the blow, then recover. lift -> GolemPose.slam.
 */
export function slamPose(k: number): { lift: number; dip: number } {
  const H = SLAM_HIT, up = H * 0.76, top = H * 0.88, hold = H + 0.16;
  const ease = (v: number) => v * v * (3 - 2 * v);
  if (k <= 0) return { lift: 0, dip: 0 };
  if (k < up) return { lift: ease(k / up), dip: 0 };
  if (k < top) return { lift: 1, dip: -1 };
  if (k < H) { const s = (k - top) / (H - top); return { lift: 1 - 2 * s * s, dip: 0 }; }
  if (k < hold) return { lift: -1, dip: 2 };
  const r = Math.min(1, (k - hold) / (1 - hold));
  return { lift: -1 + ease(r), dip: Math.round(2 * (1 - r)) };
}

type Pt = { x: number; y: number };
const lerpPt = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
/** The fist along the slam arc: rest (0) to overhead (1), rest to the ground in front (-1). */
const slamFist = (rest: Pt, up: Pt, down: Pt, lift: number) => (lift >= 0 ? lerpPt(rest, up, lift) : lerpPt(rest, down, -lift));

/** An outlined 4 px limb from `a` to `b`, ending in a fist, or (fist null) in a broken stub's trailing wires. */
function limb(p: Pen, a: Pt, b: Pt, fill: string, line: string, fist: string | null, hi: string | null) {
  const x0 = Math.round(a.x), y0 = Math.round(a.y), x1 = Math.round(b.x), y1 = Math.round(b.y);
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const at = (i: number) => [Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)];
  for (let i = 0; i <= n; i++) { const [x, y] = at(i); p.r(x - 2, y - 2, 4, 4, line); }
  for (let i = 0; i <= n; i++) { const [x, y] = at(i); p.r(x - 1, y - 1, 2, 2, fill); if (hi) p.p(x - 1, y - 1, hi); }
  if (fist) p.o(x1 - 2, y1 - 2, 5, 4, fist, line);
  else { p.r(x1 - 1, y1 + 1, 1, 3, "#8a4a20"); p.r(x1, y1 + 1, 1, 2, "#5a6a7a"); p.p(x1 - 1, y1 + 3, "#c06a30"); }
}
/** One slamming limb: the intact arm, the iron arm, or (without it) the broken stub, a third as long on the same arc. */
function slamLimb(p: Pen, g: GolemPose, intact: boolean, near: boolean, sh: Pt, f: Pt) {
  if (intact) limb(p, sh, f, near ? C.m : C.d, C.o, near ? C.l : C.m, near ? C.l : null);
  else if (g.hasArm) limb(p, sh, f, near ? IR.m : IR.d, "#14161a", near ? IR.l : IR.m, near ? IR.h : null);
  else limb(p, sh, lerpPt(sh, f, 0.32), C.d, C.o, null, null);
}
/**
 * Facing down / up: both arms through the arc together. Facing down the fists
 * land in front of the feet. Facing up they land in front of the golem, behind
 * its body from here, so the arms come down along its sides and stay readable.
 */
function slamArmsFB(p: Pen, g: GolemPose, by: number, back: boolean) {
  for (const intact of [true, false]) {
    const side = (intact ? -1 : 1) * (back ? -1 : 1);
    const down = back ? { x: side * 7, y: -2 } : { x: side * 4, y: 1 };
    slamLimb(p, g, intact, true, { x: side * 8, y: -14 + by }, slamFist({ x: side * 8, y: -3 + by }, { x: side * 6, y: -27 + by }, down, g.slam ?? 0));
  }
}
/** Sideways: one arm (far: behind the torso, darker; near: in front), swinging overhead and down to the ground ahead. */
function slamArmSide(p: Pen, g: GolemPose, by: number, intact: boolean, near: boolean) {
  const sx = near ? 0 : 2;
  slamLimb(p, g, intact, near, { x: sx, y: -14 + by }, slamFist({ x: sx, y: -3 + by }, { x: sx - 1, y: -27 + by }, { x: sx + 7, y: 0 }, g.slam ?? 0));
}

function eyeCol(v: number) {
  if (v <= 0.05) return null;
  const r = Math.round(30 + 97 * v), g = Math.round(60 + 172 * v), b = Math.round(70 + 185 * v);
  return `rgb(${r},${g},${b})`;
}
function coreCol(v: number, hot = false) {
  if (v <= 0.05) return null;
  return hot ? `rgb(${255 * v | 0},${224 * v | 0},${160 * v | 0})` : `rgb(${255 * v | 0},${150 * v | 0},${60 * v | 0})`;
}

export function drawGolem(p: Pen, x: number, y: number, g: GolemPose) {
  p.ox = Math.round(x);
  p.oy = Math.round(y);
  p.flip = false;
  const s = Math.sin(g.phase);
  const liftA = g.moving ? Math.round(Math.max(0, s) * 2) : 0;
  const liftB = g.moving ? Math.round(Math.max(0, -s) * 2) : 0;
  // limp: dips harder when the damaged leg bears weight
  let by = g.moving ? (s < -0.3 ? 1 : s > 0.6 ? -1 : 0) : 0;
  by += Math.round(g.dormant * 4);
  if (g.dip) by += g.dip;
  const hd = Math.round(g.dormant * 3);
  const swing = g.moving ? Math.round(s * 1.5) : 0;
  const eye = eyeCol(g.eye);
  const core = coreCol(g.core);
  const coreHot = coreCol(g.core, true);

  if (g.facing === "down" || g.facing === "up") {
    const back = g.facing === "up";
    const basket = g.back === "basket";
    if (basket && !back) basketFront(p, by);
    // legs
    p.o(-6, -5 - liftA + Math.min(by, 2), 5, 5 + liftA - Math.min(by, 2) + 0, C.m, C.o);
    p.r(-5, -4 - liftA + Math.min(by, 2), 3, 1, C.l);
    p.o(1, -5 - liftB + Math.min(by, 2), 5, 5 + liftB - Math.min(by, 2), C.d, C.o);
    p.r(2, -4 - liftB + Math.min(by, 2), 3, 1, C.m);
    // arms: intact side is screen-left when facing down, screen-right when up
    const intactX = back ? 6 : -10;
    const damX = back ? -10 : 6;
    const reachY = Math.round(g.reach * (back ? -3 : 3));
    const drawIntact = () => {
      p.o(intactX, -13 + by + swing + reachY, 4, 10, C.m, C.o);
      p.r(intactX + 1, -12 + by + swing + reachY, 1, 8, C.l);
      p.o(intactX - (back ? 0 : 1), -5 + by + swing + reachY, 5, 4, C.l, C.o);
    };
    const drawDamaged = () => {
      if (g.hasArm) {
        const ry = g.raise > 0 ? -Math.round(g.raise * 14) : Math.round(-g.raise * 4);
        p.o(damX, -13 + by - swing + ry, 4, 10, IR.m, "#14161a");
        p.r(damX + 1, -12 + by - swing + ry, 1, 8, IR.l);
        p.p(damX + 2, -11 + by - swing + ry, IR.h); p.p(damX + 2, -7 + by - swing + ry, IR.h);
        p.o(damX, -5 + by - swing + ry, 5, 4, IR.l, "#14161a");
        p.p(damX + 1, -4 + by - swing + ry, IR.h);
      } else {
        p.o(damX, -14 + by, 4, 4, C.d, C.o);
        p.r(damX + 1, -10 + by, 1, 3, "#8a4a20");
        p.r(damX + 2, -10 + by, 1, 2, "#5a6a7a");
        p.p(damX + 1, -7 + by, "#c06a30");
      }
    };
    const slam = g.slam;
    if (slam === undefined) { if (back) drawDamaged(); else drawIntact(); }
    else if (back && slam < 0) slamArmsFB(p, g, by, back);
    // torso
    p.o(-7, -16 + by, 14, 12, C.m, C.o);
    p.r(-6, -15 + by, 12, 2, C.l);
    p.r(3, -13 + by, 3, 8, C.d);
    p.r(-6, -6 + by, 12, 1, C.d);
    if (!back) {
      // chest crack + exposed core
      p.r(-2, -12 + by, 4, 4, "#120e0c");
      if (core) { p.g(-2, -12 + by, 4, 4, core); p.g(-1, -11 + by, 2, 2, coreHot!); }
      p.p(-3, -13 + by, C.o); p.p(-4, -14 + by, C.o); p.p(2, -8 + by, C.o); p.p(3, -7 + by, C.o); p.p(2, -9 + by, C.o);
      p.p(-5, -10 + by, C.moss); p.p(-6, -9 + by, C.moss2);
    } else {
      p.line(-3, -15 + by, 1, -10 + by, C.o); p.line(1, -10 + by, -1, -6 + by, C.o);
      p.r(-6, -14 + by, 3, 2, C.moss); p.p(-5, -15 + by, C.moss2); p.r(2, -11 + by, 2, 1, C.moss);
      p.r(-1, -9 + by, 2, 2, "#2a2420");
    }
    // pauldrons
    p.o(-9, -17 + by, 6, 5, C.l, C.o); p.r(-8, -16 + by, 4, 1, C.h);
    p.o(3, -17 + by, 6, 4, C.m, C.o);
    p.p(back ? -9 : 8, -17 + by, "rgba(0,0,0,0)");
    if (basket && !back) strapsFront(p, by);
    // head
    p.o(-4, -22 + by + hd, 8, 7, C.m, C.o);
    p.r(-3, -21 + by + hd, 6, 2, C.l);
    p.r(2, -20 + by + hd, 1, 4, C.d);
    if (!back) {
      p.r(-2, -18 + by + hd, 4, 1, "#0c0a0a");
      if (eye) {
        p.g(-2, -18 + by + hd, 2, 1, eye);
        const flick = g.eyeFixed || Math.sin(g.t * 23) + Math.sin(g.t * 7.3) > -0.6;
        if (flick) p.g(0, -18 + by + hd, 2, 1, eye);
      }
      p.p(3, -22 + by + hd, C.o); p.p(2, -22 + by + hd, C.d);
    } else {
      p.r(-3, -17 + by + hd, 2, 1, C.moss);
    }
    if (basket && back) basketBack(p, by);
    if (slam === undefined) { if (back) drawIntact(); else drawDamaged(); }
    else if (!back || slam >= 0) slamArmsFB(p, g, by, back);
    if (!back && g.raise > 0.3 && g.hasArm) {
      // dust on raised fist
    }
    return;
  }

  // ---- side view ----
  const right = g.facing === "right";
  p.flip = !right;
  // facing right: near arm = intact (right hand). facing left: near arm = damaged.
  const nearIntact = right;
  const legOff = g.moving ? Math.round(s * 2) : 0;
  p.o(-3 - legOff, -5 + Math.min(by, 2), 5, 5 - Math.min(by, 2), C.d, C.o);
  p.o(-2 + legOff, -5 - (liftA || liftB ? 1 : 0) + Math.min(by, 2), 5, 5 + (liftA || liftB ? 1 : 0) - Math.min(by, 2), C.m, C.o);
  p.r(-1 + legOff, -4 + Math.min(by, 2), 3, 1, C.l);
  const arm = (intact: boolean, near: boolean) => {
    const ax = near ? -2 : 0;
    const sw = near ? swing : -swing;
    const rx = near ? Math.round(g.reach * 5) : 0;
    if (intact) {
      p.o(ax + rx, -13 + by + sw, 4, 10, near ? C.m : C.d, C.o);
      if (near) p.r(ax + 1 + rx, -12 + by + sw, 1, 8, C.l);
      p.o(ax + rx, -5 + by + sw, 5, 4, near ? C.l : C.m, C.o);
    } else if (g.hasArm) {
      const ry = g.raise > 0 ? -Math.round(g.raise * 14) : 0;
      const tx = g.raise < 0 ? Math.round(-g.raise * 6) : 0;
      p.o(ax + tx, -13 + by + sw + ry, 4, 10, near ? IR.m : IR.d, "#14161a");
      if (near) { p.r(ax + 1 + tx, -12 + by + sw + ry, 1, 8, IR.l); p.p(ax + 2 + tx, -9 + by + sw + ry, IR.h); }
      p.o(ax + tx, -5 + by + sw + ry, 5, 4, near ? IR.l : IR.m, "#14161a");
    } else {
      p.o(ax, -14 + by, 4, 4, C.d, C.o);
      if (near) { p.r(ax + 1, -10 + by, 1, 3, "#8a4a20"); p.r(ax + 2, -10 + by, 1, 2, "#5a6a7a"); }
    }
  };
  if (g.slam === undefined) arm(!nearIntact, false); else slamArmSide(p, g, by, !nearIntact, false);
  if (g.back === "basket") basketSide(p, by);
  p.o(-5, -16 + by, 10, 12, C.m, C.o);
  p.r(-4, -15 + by, 8, 2, C.l);
  p.r(-4, -13 + by, 2, 8, C.d);
  p.r(-4, -6 + by, 8, 1, C.d);
  // core seen from side
  p.r(4, -12 + by, 1, 3, "#120e0c");
  if (core) p.g(4, -12 + by, 1, 3, core);
  p.p(-3, -11 + by, C.moss); p.p(-4, -10 + by, C.moss2);
  if (g.back === "basket") strapSide(p, by);
  // head
  p.o(-3, -22 + by + hd, 7, 7, C.m, C.o);
  p.r(-2, -21 + by + hd, 5, 2, C.l);
  p.r(-2, -19 + by + hd, 1, 3, C.d);
  p.r(2, -18 + by + hd, 2, 1, "#0c0a0a");
  if (eye) p.g(2, -18 + by + hd, 2, 1, eye);
  if (g.slam === undefined) arm(nearIntact, true); else slamArmSide(p, g, by, nearIntact, true);
  // pauldron
  p.o(-4, -17 + by, 7, 4, C.l, C.o); p.r(-3, -16 + by, 5, 1, C.h);
}
