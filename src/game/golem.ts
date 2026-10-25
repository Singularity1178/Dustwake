import { Pen } from "./util";
import { IR } from "./art";

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
}

const C = { o: "#1c1a18", d: "#3a3733", m: "#5a5650", l: "#7a756c", h: "#958f84", moss: "#4a5a32", moss2: "#5e7040" };

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
  const hd = Math.round(g.dormant * 3);
  const swing = g.moving ? Math.round(s * 1.5) : 0;
  const eye = eyeCol(g.eye);
  const core = coreCol(g.core);
  const coreHot = coreCol(g.core, true);

  if (g.facing === "down" || g.facing === "up") {
    const back = g.facing === "up";
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
    if (back) drawDamaged(); else drawIntact();
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
    if (back) drawIntact(); else drawDamaged();
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
  arm(!nearIntact, false);
  p.o(-5, -16 + by, 10, 12, C.m, C.o);
  p.r(-4, -15 + by, 8, 2, C.l);
  p.r(-4, -13 + by, 2, 8, C.d);
  p.r(-4, -6 + by, 8, 1, C.d);
  // core seen from side
  p.r(4, -12 + by, 1, 3, "#120e0c");
  if (core) p.g(4, -12 + by, 1, 3, core);
  p.p(-3, -11 + by, C.moss); p.p(-4, -10 + by, C.moss2);
  // head
  p.o(-3, -22 + by + hd, 7, 7, C.m, C.o);
  p.r(-2, -21 + by + hd, 5, 2, C.l);
  p.r(-2, -19 + by + hd, 1, 3, C.d);
  p.r(2, -18 + by + hd, 2, 1, "#0c0a0a");
  if (eye) p.g(2, -18 + by + hd, 2, 1, eye);
  arm(nearIntact, true);
  // pauldron
  p.o(-4, -17 + by, 7, 4, C.l, C.o); p.r(-3, -16 + by, 5, 1, C.h);
}
