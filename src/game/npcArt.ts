// NPC drawing (procedural, golem.ts style): NPC_ART is keyed by the `art` id an
// NpcDef names, so a new special NPC is a new entry here plus a data row, and
// the renderer has one generic NPC path. Like drawGolem, each function is run
// twice per frame: once with an albedo Pen and once with an emissive Pen
// (non-glowing pixels write black there so they occlude glow behind them).
import { Pen } from "./util";
import { GD } from "./art/palette";
import type { Facing } from "./golem";

export interface NpcPose {
  facing: Facing;
  /** 0 dormant (slumped, eye dark) .. 1 awake (sitting up). Eased by presentation. */
  awake: number;
  /** Eye brightness 0..1 (>1: flare). */
  eye: number;
  /** 0..1: a hand held out (e.g. mending the golem's eye). */
  reach: number;
  /** Presentation clock (idle motion). */
  t: number;
}

export type NpcArt = (p: Pen, x: number, y: number, pose: NpcPose) => void;

/** Heavier, darker plate than the golem's weathered stone; rank trim in gold. */
const K = { o: "#0c0b10", d: "#23252f", m: "#373a47", l: "#525667", h: "#717789" };
const WIRE = ["#8a4a20", "#5a6a7a", "#c06a30"];

function eyeCol(v: number) {
  if (v <= 0.05) return null;
  const k = Math.min(1, v), x = Math.max(0, v - 1);
  return `rgb(${Math.round(40 + 120 * k + 90 * x)},${Math.round(70 + 170 * k + 15 * x)},${Math.round(80 + 175 * k)})`;
}

/**
 * The Treasury Guardian: a higher-ranked golem, about half again the player's
 * size. It sits against a wall with its legs out. Heavy plating, a gold crest
 * and pauldron trim, a cracked chestplate, the right arm torn off at the
 * shoulder (wires showing) and the left hanging to the floor. Dormant: slumped
 * sideways, chin down, eye dark. Awake: sits up, head raised, eye lit, with a
 * slow breathing bob; `reach` lifts the left hand out towards whoever is in front.
 */
export function drawGuardian(p: Pen, x: number, y: number, g: NpcPose) {
  p.ox = Math.round(x);
  p.oy = Math.round(y);
  p.flip = false;
  const k = Math.max(0, Math.min(1, g.awake));
  const breathe = k > 0.9 && g.reach <= 0 && Math.sin(g.t * 1.4) > 0.55 ? -1 : 0;
  const by = Math.round((1 - k) * 3) + breathe; // torso drop
  const lean = Math.round((1 - k) * 2); // slumps towards screen-right
  const hd = Math.round((1 - k) * 4); // chin on chest
  const hx = lean + Math.round((1 - k) * 2);
  const eye = eyeCol(g.eye);

  // ---- legs, stretched out in front
  p.o(-11, -10, 9, 6, K.l, K.o); p.r(-10, -9, 7, 1, K.h);
  p.o(2, -10, 9, 6, K.m, K.o); p.r(3, -9, 7, 1, K.l);
  p.o(-12, -6, 10, 6, K.m, K.o); p.r(-11, -5, 8, 1, K.l); p.r(-11, -2, 8, 1, K.d);
  p.o(2, -6, 10, 6, K.d, K.o); p.r(3, -5, 8, 1, K.m);
  p.r(-12, -6, 10, 1, GD.d); p.r(2, -6, 10, 1, GD.d); // greave trim
  p.p(-9, -1, "#4a5a32"); p.p(8, -2, "#4a5a32"); p.p(-4, -3, "#5e7040");
  // belt
  p.o(-10 + lean, -13 + by, 20, 4, K.d, K.o);
  p.r(-2 + lean, -12 + by, 4, 2, GD.m); p.p(-1 + lean, -12 + by, GD.l);

  // ---- torso and cracked chestplate
  const tx = -10 + lean, ty = -29 + by;
  p.o(tx, ty, 20, 17, K.m, K.o);
  p.r(tx + 1, ty + 1, 18, 2, K.l);
  p.r(tx + 15, ty + 3, 4, 13, K.d);
  p.r(tx + 1, ty + 15, 18, 1, GD.d);
  // rank chevrons on the left breast
  p.p(tx + 3, ty + 5, GD.l); p.p(tx + 4, ty + 6, GD.m); p.p(tx + 5, ty + 5, GD.l);
  p.p(tx + 3, ty + 7, GD.m); p.p(tx + 4, ty + 8, GD.d); p.p(tx + 5, ty + 7, GD.m);
  // the crack: a jagged split across the plate with a cold, dark cavity
  p.line(tx + 7, ty + 2, tx + 10, ty + 7, K.o);
  p.line(tx + 10, ty + 7, tx + 9, ty + 10, K.o);
  p.line(tx + 9, ty + 10, tx + 13, ty + 14, K.o);
  p.r(tx + 9, ty + 7, 3, 3, "#0a0808");
  if (k > 0.05) p.g(tx + 10, ty + 8, 1, 1, `rgb(${Math.round(140 * k)},${Math.round(70 * k)},${Math.round(30 * k)})`);
  p.p(tx + 12, ty + 4, K.h); p.p(tx + 6, ty + 11, K.l);

  // ---- right arm (screen-left): torn off at the shoulder
  p.o(tx - 4, ty + 5, 5, 5, K.d, K.o);
  p.r(tx - 3, ty + 10, 1, 3, WIRE[0]); p.r(tx - 1, ty + 10, 1, 2, WIRE[1]); p.p(tx - 2, ty + 12, WIRE[2]);

  // ---- left arm (screen-right): hangs to the floor; held out when reaching
  const r = Math.max(0, Math.min(1, g.reach));
  const ax = tx + 19, ay = ty + 5;
  p.o(ax, ay, 5, 9, K.m, K.o); p.r(ax + 1, ay + 1, 1, 7, K.l);
  const hxp = ax + 1 - Math.round(r * 6), hyp = ay + 9 + Math.round((1 - r) * 5) - Math.round(r * 1);
  p.o(Math.min(ax, hxp), ay + 8, Math.abs(hxp - ax) + 5, Math.max(3, hyp - ay - 6), K.l, K.o); // forearm
  p.o(hxp, hyp, 6, 5, K.l, K.o); p.r(hxp + 1, hyp + 1, 4, 1, K.h); // gauntlet
  p.r(hxp, hyp + 4, 6, 1, GD.d);
  if (r > 0.5) { p.g(hxp + 1, hyp + 5, 1, 1, "#bff4ff"); p.g(hxp + 3, hyp + 5, 1, 1, "#7fe8ff"); }

  // ---- pauldrons (heavy, gold-trimmed)
  p.o(tx - 6, ty - 2, 10, 8, K.l, K.o); p.r(tx - 5, ty - 1, 8, 1, K.h); p.r(tx - 5, ty + 5, 8, 1, GD.m);
  p.p(tx - 3, ty + 2, K.o); p.p(tx - 2, ty + 3, K.o); // dent
  p.o(tx + 16, ty - 2, 10, 8, K.m, K.o); p.r(tx + 17, ty - 1, 8, 1, K.l); p.r(tx + 17, ty + 5, 8, 1, GD.d);

  // ---- head, crest and visor
  const hy = ty - 10 + hd, hxx = -6 + hx;
  p.o(hxx + 4, hy - 5, 4, 6, GD.m, GD.d); p.r(hxx + 5, hy - 5, 1, 4, GD.l); // crest fin
  p.o(hxx, hy, 12, 11, K.m, K.o);
  p.r(hxx + 1, hy + 1, 10, 2, K.l);
  p.r(hxx + 9, hy + 3, 2, 6, K.d);
  p.r(hxx + 1, hy + 9, 10, 1, GD.d);
  p.p(hxx + 10, hy + 1, K.o); p.p(hxx + 11, hy + 2, K.o); // chipped corner
  // visor slit; the eye burns in it while awake
  p.r(hxx + 2, hy + 5, 8, 2, "#08080c");
  if (eye) {
    p.g(hxx + 3, hy + 5, 6, 1, eye);
    if (g.eye > 0.6) p.g(hxx + 4, hy + 6, 4, 1, eye);
  }
}

export const NPC_ART: Record<string, NpcArt> = {
  guardian: drawGuardian,
};
