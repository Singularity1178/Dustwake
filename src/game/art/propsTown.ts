// Prop sprites of the market town (Westwake): street light, signs, the market,
// the yards where the labour golems work, and the fittings of the six shops.
// Registered into PROP_ART by art/props.ts, after the surface and the dungeon.
//
// Two lights, kept apart on purpose. Light runes glow a steady blue-white
// (RUNE): they stand in the paved streets and hang in the shops that can pay.
// Everything else that glows is fire (FIRE). Glowing pixels are drawn with
// p.g / p.gp so they land in the emissive layer.
import { shade } from "../util";
import type { Pen, Rng } from "../util";
import { S, WD, IR, GD, BN } from "./palette";
import type { PropArt } from "./common";

const OUT = "#141016";
const RUNE = { halo: "#6ea6e6", mid: "#b4d8ff", core: "#eef8ff" };
const FIRE = { hot: "#ffe0a0", mid: "#ff9a3a", low: "#d8521a" };
const ST = { d: "#4a4640", m: "#6e685e", l: "#8a847a", h: "#a8a296" };
const CLOTH = ["#6a3a8a", "#2e6a8a", "#a83a34", "#c8a040", "#3a7a4a", "#d8ccb0"];
const sh = (p: Pen, x: number, y: number, w: number, h = 3) => p.r(x, y, w, h, "rgba(0,0,0,0.32)");
const tufts = (p: Pen, r: Rng, x: number, y: number, w: number, k: number) => {
  for (let i = 0; i < k; i++) { const bx = x + ((r() * w) | 0), h = 1 + ((r() * 3) | 0); p.r(bx, y - h, 1, h, ["#4e7a3a", "#628e44", "#3a5e2c"][(r() * 3) | 0]); }
};
/** A cart wheel seen side-on, 9x9. */
function wheel(p: Pen, x: number, y: number) {
  p.r(x + 2, y, 5, 9, WD.o); p.r(x, y + 2, 9, 5, WD.o); p.r(x + 1, y + 1, 7, 7, WD.o);
  p.r(x + 2, y + 1, 5, 7, WD.d); p.r(x + 1, y + 2, 7, 5, WD.d);
  p.r(x + 4, y + 1, 1, 7, WD.l); p.r(x + 1, y + 4, 7, 1, WD.l); p.r(x + 3, y + 3, 3, 3, IR.m); p.p(x + 4, y + 4, IR.h);
}
/** The device painted on a hanging sign, in a 12x11 field at (ox, oy). */
function device(p: Pen, v: number, ox: number, oy: number) {
  const P = (x: number, y: number, w: number, h: number, c: string) => p.r(ox + x, oy + y, w, h, c);
  switch (v) {
    case 0: P(1, 3, 9, 2, "#1a1a1e"); P(0, 3, 2, 1, "#1a1a1e"); P(4, 5, 4, 2, "#1a1a1e"); P(3, 7, 6, 2, "#1a1a1e"); P(2, 3, 8, 1, "#5a5a66"); break;
    case 1: P(3, 1, 6, 5, GD.m); P(4, 6, 4, 2, GD.m); P(5, 8, 2, 1, GD.d); P(3, 1, 2, 4, GD.l); P(6, 3, 1, 2, "#fff0c0"); P(8, 2, 1, 4, GD.d); break;
    case 2: P(4, 2, 4, 1, "#d8f6ff"); P(3, 3, 6, 2, "#70d0f0"); P(4, 5, 4, 1, "#40a0d0"); P(5, 6, 2, 2, "#2a78b0"); P(4, 3, 1, 1, "#ffffff"); P(2, 9, 8, 1, GD.m); break;
    case 3: p.line(ox + 2, oy + 8, ox + 9, oy + 1, "#d8dce4"); P(9, 1, 1, 1, "#ffffff"); P(5, 7, 5, 1, "#b8c0d0"); P(10, 4, 1, 3, "#b8c0d0"); P(9, 3, 1, 1, "#b8c0d0"); P(4, 8, 1, 1, "#b8c0d0"); break;
    case 4:
      P(2, 3, 8, 3, GD.m); P(2, 2, 1, 1, GD.l); P(5, 1, 2, 2, GD.l); P(9, 2, 1, 1, GD.l); P(4, 4, 1, 1, "#c83040"); P(7, 4, 1, 1, "#c83040");
      P(0, 7, 12, 4, "#284a78"); for (let i = 0; i < 12; i++) P(i, 6 + (i % 4 < 2 ? 0 : 1), 1, 1, "#6aa0d8"); P(2, 8, 8, 1, "#3a6a98"); break;
    case 5:
      P(0, 0, 12, 11, "#1e2a4a"); P(5, 1, 2, 9, "#c8a84a"); P(1, 4, 10, 2, "#c8a84a"); P(5, 4, 2, 2, "#fff0c0");
      p.line(ox + 1, oy + 9, ox + 10, oy, "#e4e8ee"); P(2, 6, 3, 1, "#8a6a2a"); P(3, 7, 1, 2, "#8a6a2a"); break;
    case 6: P(2, 4, 8, 4, "#c89a58"); P(3, 3, 6, 1, "#d8b070"); P(3, 8, 6, 1, "#8a6030"); P(4, 4, 1, 2, "#8a6030"); P(6, 4, 1, 2, "#8a6030"); P(8, 4, 1, 2, "#8a6030"); break;
    case 7: P(3, 5, 6, 3, "#8a9a8a"); P(4, 8, 4, 1, "#5e6e5e"); P(3, 5, 6, 1, "#b0c0b0"); p.line(ox + 5, oy + 5, ox + 9, oy + 1, "#d8d0c0"); P(1, 2, 2, 1, "#4e8a3a"); P(2, 1, 1, 1, "#6ab050"); break;
    case 8: P(1, 3, 4, 4, GD.m); P(2, 4, 2, 2, "#3a2818"); P(5, 4, 6, 1, GD.m); P(8, 5, 1, 2, GD.d); P(10, 5, 1, 2, GD.d); P(1, 3, 4, 1, GD.l); break;
    case 9: P(4, 3, 4, 7, "#8a8a92"); P(4, 2, 1, 1, "#a8a8b0"); P(6, 2, 1, 1, "#a8a8b0"); P(7, 2, 1, 1, "#a8a8b0"); P(5, 7, 2, 3, "#1a1a1e"); P(5, 4, 1, 2, "#ffc868"); break;
    case 10: P(3, 2, 1, 7, "#b0b4bc"); P(8, 2, 1, 7, "#b0b4bc"); P(4, 1, 4, 1, "#b0b4bc"); P(3, 9, 2, 1, "#8a8e96"); P(7, 9, 2, 1, "#8a8e96"); P(3, 4, 1, 1, "#1a1a1e"); P(8, 4, 1, 1, "#1a1a1e"); break;
    case 11: P(3, 1, 6, 1, "#3a2818"); P(3, 9, 6, 1, "#3a2818"); P(2, 2, 1, 7, "#3a2818"); P(9, 2, 1, 7, "#3a2818"); P(5, 2, 2, 7, "#7a5634"); P(3, 5, 6, 1, "#7a5634"); P(5, 5, 2, 1, IR.l); break;
    default: P(2, 2, 8, 7, "#8a6a44"); P(2, 2, 8, 1, "#b08a5a"); P(2, 5, 8, 1, "#3a2818"); P(5, 2, 1, 7, "#3a2818"); P(2, 8, 8, 1, "#3a2818");
  }
}

export const TOWN_PROP_ART: Record<string, PropArt> = {
  // A full weapon rack and a dressed armour stand, as the halls' own once looked (theirs are ruins now: art/propsDungeon.ts).
  shoprack: (_v, _alt, M) => {
    return M(24, 22, (p) => {
      p.r(1, 2, 2, 20, WD.o); p.r(21, 2, 2, 20, WD.o);
      p.r(0, 4, 24, 2, WD.m); p.r(0, 15, 24, 2, WD.m); p.r(0, 4, 24, 1, WD.l);
      p.r(6, 0, 1, 20, WD.l); p.r(5, 0, 3, 3, IR.l); p.p(6, 0, IR.h);
      p.r(16, 3, 1, 17, WD.l); p.r(15, 2, 3, 2, "#6a4a3a");
      p.line(10, 6, 13, 19, IR.d);
    });
  },
  shopstand: (v, _alt, M) => {
    if (v === 1)
      return M(18, 10, (p) => {
        p.r(1, 6, 14, 2, WD.m); p.r(1, 6, 14, 1, WD.l);
        p.o(11, 1, 7, 6, IR.m, IR.d); p.r(12, 3, 5, 1, "#101010");
      });
    return M(12, 22, (p) => {
      p.r(5, 6, 2, 14, WD.m); p.r(1, 9, 10, 2, WD.m); p.r(2, 20, 8, 2, WD.d);
      p.o(3, 0, 6, 7, IR.m, IR.d); p.r(4, 3, 4, 1, "#101010"); p.p(4, 1, IR.h);
    });
  },
  // ---------- light runes
  rune_lamp: (_v, _alt, M) => M(14, 36, (p) => {
    sh(p, 2, 33, 10);
    p.o(3, 29, 8, 6, ST.l, OUT); p.r(4, 30, 6, 1, ST.h); p.r(4, 33, 6, 1, ST.m);
    p.r(6, 12, 2, 18, IR.d); p.r(6, 12, 1, 18, IR.l); p.r(5, 20, 4, 1, IR.m); p.r(5, 27, 4, 1, IR.m);
    p.r(3, 11, 8, 2, IR.d); p.r(3, 11, 8, 1, IR.l);
    // the rune stone in its cage: cut once, alight for good
    p.r(2, 1, 10, 10, IR.d);
    p.g(3, 2, 8, 8, RUNE.halo); p.g(4, 3, 6, 6, RUNE.mid);
    p.g(6, 3, 2, 6, RUNE.core); p.g(5, 5, 4, 1, RUNE.core); p.gp(5, 8, RUNE.core); p.gp(8, 7, RUNE.core);
    p.r(4, 0, 6, 1, IR.l); p.r(6, -1, 2, 1, IR.h);
  }),
  rune_sconce: (_v, _alt, M) => M(8, 13, (p) => {
    p.r(1, 0, 6, 11, IR.d); p.r(1, 0, 6, 1, IR.l);
    p.g(2, 2, 4, 8, RUNE.halo); p.g(3, 3, 2, 6, RUNE.mid); p.gp(3, 4, RUNE.core); p.gp(4, 6, RUNE.core); p.gp(3, 7, RUNE.core);
    p.r(0, 11, 8, 2, IR.m); p.r(0, 11, 8, 1, IR.l);
  }),
  runestand: (_v, _alt, M) => M(10, 24, (p) => {
    sh(p, 1, 22, 8, 2);
    p.r(2, 20, 6, 3, GD.d); p.r(2, 20, 6, 1, GD.m); p.r(4, 9, 2, 12, GD.d); p.r(4, 9, 1, 12, GD.l); p.r(2, 8, 6, 2, GD.m);
    p.g(2, 1, 6, 7, RUNE.halo); p.g(3, 2, 4, 5, RUNE.mid); p.g(4, 2, 2, 5, RUNE.core);
    p.r(2, 0, 6, 1, GD.d);
  }),
  // ---------- fire
  lantern: (_v, _alt, M) => M(9, 14, (p) => {
    p.r(0, 0, 7, 1, IR.m); p.r(0, 0, 1, 3, IR.d); p.r(5, 1, 1, 3, IR.m);
    p.o(2, 4, 7, 9, "#2a1c10", IR.d); p.g(3, 6, 5, 5, FIRE.mid); p.g(4, 7, 3, 3, FIRE.hot); p.r(2, 4, 7, 1, IR.l); p.r(3, 12, 5, 1, IR.m);
    p.r(5, 5, 1, 7, IR.d);
  }),
  candlestand: (_v, _alt, M) => M(12, 26, (p) => {
    sh(p, 2, 24, 8, 2);
    p.r(3, 22, 6, 2, IR.d); p.r(3, 22, 6, 1, IR.m); p.r(5, 8, 2, 15, IR.d); p.r(5, 8, 1, 15, IR.l);
    p.r(1, 8, 10, 1, IR.m); p.r(1, 6, 1, 2, IR.m); p.r(10, 6, 1, 2, IR.m);
    for (const [x, y] of [[1, 3], [5, 1], [10, 3]]) { p.r(x, y + 2, 1, 3, "#e8e0c8"); p.gp(x, y, FIRE.mid); p.gp(x, y + 1, FIRE.hot); }
    p.r(6, 3, 1, 5, "#e8e0c8"); p.gp(6, 1, FIRE.mid); p.gp(6, 2, FIRE.hot);
  }),
  // the Aligarch colours: crimson, a gold sun-wheel, swallow-tailed
  bannerpole: (v, _alt, M) => M(16, 44, (p) => {
    sh(p, 4, 42, 8, 2);
    p.o(5, 38, 6, 5, ST.m, OUT); p.r(6, 39, 4, 1, ST.h);
    p.r(7, 3, 2, 36, WD.m); p.r(7, 3, 1, 36, WD.l); p.r(6, 1, 4, 2, GD.l); p.r(7, 0, 2, 1, GD.m);
    const c = v & 1 ? "#2e3a6a" : "#8a1c24", l = v & 1 ? "#44528e" : "#b03038", d = v & 1 ? "#1e2648" : "#5e1218";
    p.r(9, 5, 7, 19, d); p.r(9, 5, 6, 18, c); p.r(9, 5, 6, 1, l); p.r(9, 5, 1, 18, l);
    p.r(9, 23, 2, 2, c); p.r(13, 23, 2, 2, c); p.p(15, 24, d); p.p(11, 23, d);
    p.r(11, 10, 2, 6, GD.m); p.r(9, 12, 6, 2, GD.m); p.r(11, 12, 2, 2, GD.l); p.p(10, 10, GD.d); p.p(13, 10, GD.d); p.p(10, 15, GD.d); p.p(13, 15, GD.d);
  }),
  // a lit window: 0 firelight, 1 rune light (ground floor, 8x7 panes); 2 and 3 the same for the small upper windows
  winglow: (v, _alt, M) => {
    const c = v & 1 ? ["#86b8ee", "#c4e2ff", "#f0f8ff"] : ["#e8963a", "#ffc868", "#ffe6a8"];
    if (v < 2) return M(8, 7, (p) => {
      p.g(0, 0, 8, 7, c[0]); p.g(1, 0, 6, 6, c[1]); p.g(1, 4, 2, 2, c[2]);
      if (!(v & 1)) { p.g(0, 0, 1, 7, "#a85a1c"); p.g(7, 0, 1, 7, "#a85a1c"); p.g(6, 5, 1, 2, "#c87428"); }
      p.r(3, 0, 2, 7, "#2a1c12"); p.r(0, 3, 8, 1, "#2a1c12");
    });
    return M(4, 5, (p) => { p.g(0, 0, 4, 5, c[0]); p.g(1, 0, 2, 2, c[1]); p.g(1, 3, 2, 1, c[1]); p.r(0, 2, 4, 1, "#2a1c12"); });
  },
  // a board on an iron arm; the shops on the bright side gild the frame
  shopsign: (v, _alt, M) => M(18, 20, (p) => {
    const rich = v === 1 || v === 2 || v === 3 || v === 5 || v === 8;
    p.r(0, 1, 17, 1, IR.m); p.r(0, 0, 1, 5, IR.d); p.r(1, 2, 1, 1, IR.d); p.r(2, 3, 1, 1, IR.d); p.r(16, 2, 1, 1, IR.l);
    p.r(5, 2, 1, 2, IR.l); p.r(13, 2, 1, 2, IR.l);
    p.r(2, 4, 14, 13, OUT); p.r(3, 5, 12, 11, rich ? GD.m : WD.l); p.r(4, 6, 10, 9, v === 5 ? "#1e2a4a" : rich ? "#2a2018" : "#c8b890");
    device(p, v, 3, 5);
    p.r(3, 5, 12, 1, rich ? GD.l : WD.h); p.r(3, 15, 12, 1, rich ? GD.d : WD.d); p.r(3, 5, 1, 11, rich ? GD.m : WD.l); p.r(14, 5, 1, 11, rich ? GD.d : WD.m);
  }),
  // ---------- landmarks
  well: (_v, _alt, M) => M(28, 34, (p, r) => {
    sh(p, 3, 31, 22);
    p.r(5, 17, 18, 1, OUT); p.r(3, 18, 22, 13, OUT); p.r(5, 31, 18, 1, OUT);
    p.r(4, 18, 20, 5, ST.l); p.r(5, 18, 18, 1, ST.h); p.r(7, 19, 14, 4, "#0a121c"); p.r(10, 20, 5, 1, "#2a4a6a"); p.p(16, 21, "#1c3450");
    p.r(4, 23, 20, 8, ST.m); p.r(4, 23, 20, 1, ST.l);
    for (let x = 8; x < 24; x += 5) { p.r(x, 24, 1, 3, ST.d); p.r(x - 2, 27, 1, 4, ST.d); } p.r(4, 27, 20, 1, ST.d);
    for (let i = 0; i < 14; i++) p.p(4 + ((r() * 20) | 0), 27 + ((r() * 4) | 0), ["#3e5e2a", "#527636", "#2e4a22"][(r() * 3) | 0]);
    p.r(4, 6, 2, 14, WD.m); p.r(4, 6, 1, 14, WD.l); p.r(22, 6, 2, 14, WD.d);
    p.r(6, 11, 16, 2, WD.l); p.r(6, 13, 16, 1, WD.d); p.r(24, 10, 2, 1, IR.m); p.r(25, 10, 1, 4, IR.m);
    p.r(13, 13, 1, 6, "#c8b088"); p.r(11, 11, 5, 2, "#c8b088"); p.p(12, 12, "#8a7248");
    p.r(2, 4, 24, 3, "#52412f"); p.r(4, 1, 20, 3, "#68553c"); p.r(4, 1, 20, 1, "#80694a"); p.r(2, 4, 24, 1, "#68553c"); p.r(2, 7, 24, 1, WD.o);
    for (let x = 5; x < 24; x += 4) { p.p(x, 2, "#3a2e24"); p.p(x + 2, 5, "#3a2e24"); }
    tufts(p, r, 2, 33, 24, 6);
  }),
  // dressed in the keep's own grey-violet stone, so it stands out from the town's warm ashlar
  keepstone: (v, _alt, M) => M(14, 10, (p) => {
    p.o(0, 0, 14, 10, S.m, S.o); p.r(1, 1, 12, 1, S.h); p.r(1, 2, 1, 7, S.l); p.r(12, 2, 1, 7, S.d);
    p.r(4, 3, 6, 1, S.d); p.r(3, 4, 1, 3, S.d); p.r(10, 4, 1, 3, S.d); p.r(4, 7, 6, 1, S.d); p.r(6, 4, 2, 2, v & 1 ? S.h : S.d);
    p.p(9, 2, S.o); p.p(10, 3, S.o); p.p(11, 5, S.o);
  }),
  marketcross: (_v, _alt, M) => M(34, 58, (p, r) => {
    sh(p, 2, 55, 30);
    p.o(1, 46, 32, 10, ST.m, OUT); p.r(2, 47, 30, 2, ST.h); p.r(2, 54, 30, 1, ST.d);
    p.o(5, 40, 24, 8, ST.m, OUT); p.r(6, 41, 22, 2, ST.h);
    p.o(9, 35, 16, 7, ST.l, OUT); p.r(10, 36, 14, 2, ST.h);
    p.o(13, 12, 8, 24, ST.l, OUT); p.r(14, 13, 2, 22, ST.h); p.r(18, 13, 2, 22, ST.m);
    p.r(13, 19, 8, 1, ST.d); p.r(13, 29, 8, 1, ST.d); for (let y = 21; y < 28; y += 2) { p.r(15, y, 4, 1, ST.d); p.p(16 + (y & 2 ? 1 : 0), y, ST.m); }
    p.o(10, 1, 14, 12, ST.m, OUT); p.r(11, 2, 12, 1, ST.h); p.r(15, -1, 4, 2, ST.h);
    p.g(12, 3, 10, 8, RUNE.halo); p.g(13, 4, 8, 6, RUNE.mid); p.g(16, 4, 2, 6, RUNE.core); p.g(14, 6, 6, 1, RUNE.core); p.gp(14, 9, RUNE.core); p.gp(19, 4, RUNE.core);
    p.r(11, 49, 12, 5, GD.d); p.r(12, 50, 10, 1, GD.l); p.r(12, 52, 7, 1, GD.m);
    for (let i = 0; i < 16; i++) p.p(2 + ((r() * 30) | 0), 50 + ((r() * 5) | 0), ["#3e5e2a", "#527636"][(r() * 2) | 0]);
  }),
  noticeboard: (_v, _alt, M) => M(26, 28, (p) => {
    sh(p, 2, 26, 22, 2);
    p.r(3, 6, 2, 22, WD.m); p.r(21, 6, 2, 22, WD.d);
    p.o(1, 6, 24, 15, "#6a5238", WD.o); p.r(2, 7, 22, 1, "#8a6a44");
    p.r(0, 3, 26, 3, "#52412f"); p.r(0, 3, 26, 1, "#80694a"); p.r(0, 6, 26, 1, WD.o);
    p.r(3, 9, 6, 7, "#e0d8c0"); p.r(10, 10, 6, 5, "#d0c8a8"); p.r(17, 9, 6, 8, "#e8e0c8"); p.r(11, 16, 5, 4, "#c8b070");
    for (const [x, y, w] of [[4, 11, 4], [4, 13, 3], [11, 12, 4], [18, 11, 4], [18, 13, 3], [18, 15, 4], [12, 18, 3]]) p.r(x, y, w, 1, "#6a6458");
    p.p(5, 9, "#c83040"); p.p(13, 10, IR.h); p.p(20, 9, "#c83040"); p.p(21, 16, "#a83a34"); p.p(13, 16, IR.h);
  }),
  // a counterweighted pole across the road, seen from above: it runs north-south, post to post
  tollbar: (_v, _alt, M) => M(16, 60, (p) => {
    p.r(7, 8, 6, 50, "rgba(0,0,0,0.25)");
    p.r(6, 6, 3, 50, "#d8d0b8"); p.r(6, 6, 1, 50, "#f0e8d0"); p.r(9, 6, 1, 50, OUT);
    for (let y = 10; y < 50; y += 12) p.r(6, y, 3, 6, "#a83a34");
    p.o(4, 50, 7, 10, WD.m, WD.o); p.r(5, 51, 2, 8, WD.l); p.o(4, 0, 7, 9, WD.m, WD.o); p.r(5, 1, 2, 7, WD.l);
    p.o(2, 2, 5, 6, ST.m, OUT); p.r(3, 3, 3, 1, ST.h); p.r(11, 52, 3, 1, IR.m); p.r(13, 52, 1, 4, IR.m);
  }),
  waymark: (v, _alt, M) => M(18, 26, (p, r) => {
    sh(p, 5, 24, 9, 2);
    for (let y = 6; y < 25; y++) { const x = 9 + Math.round((25 - y) / 12); p.r(x, y, 2, 1, WD.m); p.p(x, y, WD.l); }
    p.r(1, 6, 13, 5, WD.o); p.r(2, 7, 11, 3, WD.l); p.r(2, 7, 11, 1, WD.h); p.p(0, 8, WD.o); p.p(1, 8, WD.l);
    for (const x of [4, 6, 7, 9, 11]) p.p(x, 8, WD.d); p.p(5, 9, WD.d); p.p(10, 9, WD.d);
    if (v & 1) { p.r(10, 13, 7, 4, WD.o); p.r(10, 14, 6, 2, WD.m); p.p(17, 15, WD.o); }
    p.p(10, 5, "#527636"); p.p(11, 5, "#3e5e2a"); p.p(4, 6, "#527636"); p.p(8, 6, "#6e8e34");
    tufts(p, r, 4, 25, 10, 5);
  }),
  milestone: (_v, _alt, M) => M(12, 15, (p, r) => {
    sh(p, 1, 13, 10, 2);
    p.r(3, 1, 6, 1, OUT); p.r(2, 2, 8, 12, OUT); p.r(3, 2, 6, 11, ST.l); p.r(4, 2, 4, 1, ST.h); p.r(3, 3, 1, 9, ST.h); p.r(8, 3, 1, 10, ST.m);
    p.r(4, 5, 4, 1, ST.d); p.r(4, 7, 3, 1, ST.d); p.p(5, 10, ST.d); p.p(6, 11, ST.d); p.p(7, 10, ST.d);
    p.p(3, 12, "#527636"); p.p(8, 11, "#3e5e2a"); tufts(p, r, 1, 14, 10, 4);
  }),
  // ---------- labour: made for bodies that are not here
  golempad: (v, _alt, M) => M(26, 14, (p) => {
    p.o(1, 2, 24, 11, ST.m, "#24201e"); p.r(2, 3, 22, 1, ST.l);
    p.r(5, 5, 6, 5, ST.d); p.r(5, 5, 6, 1, "#3a3632"); p.r(15, 5, 6, 5, ST.d); p.r(15, 5, 6, 1, "#3a3632");
    p.r(21, 3, 3, 3, IR.h); p.p(22, 4, "#24201e");
    for (let k = 0; k <= (v & 3); k++) p.r(3 + k * 2, 10, 1, 2, "#d8d0b8");
  }),
  yokerack: (_v, _alt, M) => M(28, 28, (p) => {
    sh(p, 1, 26, 26, 2);
    p.r(2, 3, 2, 25, WD.m); p.r(2, 3, 1, 25, WD.l); p.r(24, 3, 2, 25, WD.d); p.r(1, 3, 26, 2, WD.l); p.r(1, 5, 26, 1, WD.o);
    // two yokes far too broad for a man, the grips worn pale
    p.r(5, 8, 18, 3, "#93704a"); p.r(5, 8, 18, 1, "#b08a5a"); p.r(5, 11, 2, 4, "#93704a"); p.r(21, 11, 2, 4, "#93704a"); p.r(11, 8, 6, 2, "#d8c8a0");
    p.r(6, 15, 1, 4, IR.m); p.r(21, 15, 1, 4, IR.m); p.p(6, 19, IR.h); p.p(21, 19, IR.h);
    p.r(6, 20, 16, 3, "#7a5634"); p.r(6, 20, 16, 1, "#93704a"); p.r(12, 20, 5, 2, "#c8b088");
    p.o(16, 23, 8, 5, WD.m, WD.o); p.r(17, 24, 6, 1, WD.l); p.r(15, 22, 1, 4, WD.l);
  }),
  tallyboard: (_v, _alt, M) => M(18, 24, (p) => {
    sh(p, 2, 22, 14, 2);
    p.r(3, 10, 2, 14, WD.m); p.r(13, 10, 2, 14, WD.d);
    p.o(1, 1, 16, 13, "#2a2e34", WD.o); p.r(1, 1, 16, 1, WD.l);
    for (let row = 0; row < 3; row++) { for (let k = 0; k < 5 - row; k++) p.r(3 + k * 2, 3 + row * 4, 1, 2, "#d8d8d0"); p.r(2, 4 + row * 4, 9 - row * 2, 1, "#9a9a94"); p.r(13, 3 + row * 4, 2, 1, "#b8b8b0"); }
  }),
  stonestack: (v, _alt, M) => M(30, 22, (p) => {
    sh(p, 1, 19, 28);
    for (const x of [1, 10, 19]) { p.o(x, 11, 10, 9, ST.m, OUT); p.r(x + 1, 12, 8, 2, ST.h); p.r(x + 7, 14, 2, 5, ST.d); }
    for (const x of v & 1 ? [5] : [5, 15]) { p.o(x, 3, 10, 9, ST.l, OUT); p.r(x + 1, 4, 8, 2, ST.h); p.r(x + 4, 1, 3, 3, IR.h); p.p(x + 5, 2, OUT); }
    p.r(14, 9, 1, 3, "#c8b088"); p.r(9, 11, 6, 1, "#c8b088"); p.p(24, 9, IR.h); p.p(25, 10, IR.m); p.p(24, 10, OUT);
  }),
  timberstack: (_v, _alt, M) => M(36, 18, (p) => {
    sh(p, 1, 16, 34, 2);
    for (let j = 0; j < 3; j++) {
      const y = 11 - j * 5, x = 1 + j * 2, w = 32 - j * 3;
      p.o(x, y, w, 5, shade(WD.l, 1 - j * 0.06), WD.o); p.r(x + 1, y + 1, w - 2, 1, WD.h); p.o(x + w - 5, y, 5, 5, "#a08050", WD.o); p.p(x + w - 3, y + 2, "#6a4e30");
    }
    p.r(6, 7, 2, 1, "#e8e8e0"); p.r(9, 7, 1, 1, "#e8e8e0"); p.r(11, 12, 3, 1, "#e8e8e0"); p.r(4, 15, 2, 2, WD.d); p.r(26, 15, 2, 2, WD.d);
  }),
  scaffold: (_v, _alt, M) => M(44, 46, (p) => {
    sh(p, 2, 44, 40, 2);
    for (const x of [3, 21, 39]) { p.r(x, 1, 2, 45, WD.l); p.r(x + 1, 1, 1, 45, WD.d); }
    for (const y of [13, 29]) { p.r(1, y, 42, 1, WD.m); p.r(1, y + 1, 42, 3, "#93704a"); p.r(1, y + 1, 42, 1, "#b08a5a"); p.r(1, y + 4, 42, 1, WD.o); for (let x = 8; x < 42; x += 9) p.p(x, y + 2, WD.d); }
    p.line(5, 28, 20, 18, WD.m); p.line(23, 44, 38, 34, WD.m);
    p.r(9, 30, 1, 15, WD.l); p.r(14, 30, 1, 15, WD.l); for (let y = 33; y < 45; y += 3) p.r(10, y, 4, 1, WD.m);
    // a block left hanging on its sling, the ring polished
    p.r(29, 1, 4, 2, IR.m); p.r(31, 3, 1, 16, "#c8b088"); p.r(30, 19, 3, 2, IR.h); p.p(31, 20, OUT); p.o(27, 21, 9, 7, ST.l, OUT); p.r(28, 22, 7, 2, ST.h);
  }),
  crane: (_v, _alt, M) => M(42, 56, (p) => {
    sh(p, 6, 53, 30);
    p.o(8, 46, 26, 8, WD.m, WD.o); p.r(9, 47, 24, 2, WD.l); p.r(6, 51, 30, 3, WD.d); p.r(6, 51, 30, 1, WD.m);
    p.r(18, 8, 4, 40, WD.m); p.r(18, 8, 1, 40, WD.l); p.r(21, 8, 1, 40, WD.d);
    for (let i = 0; i < 20; i++) { const x = 20 + i, y = Math.round(9 - i * 0.38); p.r(x, y, 1, 3, WD.l); p.p(x, y + 2, WD.d); }
    p.line(39, 2, 24, 46, "#c8b088"); p.r(39, 3, 1, 26, "#c8b088"); p.r(38, 29, 3, 2, IR.m); p.r(39, 31, 1, 3, IR.h); p.r(37, 33, 2, 1, IR.h);
    p.line(18, 44, 10, 48, WD.m); p.line(22, 44, 30, 48, WD.m);
    // capstan bars at a golem's chest height, the ends pale from pushing
    p.r(5, 29, 30, 2, WD.l); p.r(5, 31, 30, 1, WD.o); p.r(5, 29, 5, 2, "#d8c8a0"); p.r(30, 29, 5, 2, "#d8c8a0");
    p.o(15, 34, 10, 9, IR.d, OUT); p.r(17, 36, 6, 5, IR.m); p.p(19, 38, IR.h); p.p(20, 38, IR.h);
  }),
  // ---------- streets, market, yards
  stall: (v, _alt, M) => M(44, 38, (p, r) => {
    const A = [["#a83a34", "#e0d4b8"], ["#2e5a8a", "#e0d4b8"], ["#3a7a4a", "#e0d4b8"], ["#b8862e", "#6a3a22"]][v & 3];
    sh(p, 3, 35, 38);
    p.r(4, 8, 2, 28, WD.m); p.r(38, 8, 2, 28, WD.d);
    p.o(2, 22, 40, 8, WD.m, WD.o); p.r(3, 23, 38, 1, WD.h); p.r(3, 26, 38, 1, WD.d); p.r(5, 30, 2, 6, WD.d); p.r(37, 30, 2, 6, WD.d);
    if ((v & 3) === 0) {
      for (const [x, c1, c2] of [[5, "#c83a34", "#e0584a"], [17, "#4e8a3a", "#7ab050"], [29, "#d8b040", "#e8d070"]] as const) {
        p.o(x, 16, 10, 7, WD.l, WD.o); for (let i = 0; i < 7; i++) p.r(x + 1 + ((r() * 7) | 0), 15 + ((r() * 3) | 0), 2, 2, r() < 0.5 ? c1 : c2);
      }
    } else if ((v & 3) === 1) {
      for (let i = 0; i < 5; i++) { p.r(5 + i * 7, 17 + (i & 1), 6, 5 - (i & 1), CLOTH[i]); p.r(5 + i * 7, 17 + (i & 1), 6, 1, shade(CLOTH[i], 1.35)); p.p(5 + i * 7, 19, OUT); }
      for (let i = 0; i < 4; i++) p.r(9 + i * 8, 12, 1, 5 + (i & 1) * 2, CLOTH[(i + 2) % 5]);
    } else if ((v & 3) === 2) {
      for (let i = 0; i < 5; i++) { const x = 5 + i * 7, h = 5 + ((i * 3) % 4); p.o(x, 23 - h, 6, h, i & 1 ? "#b06a3a" : "#8a9aa8", OUT); p.r(x + 1, 23 - h, 4, 1, i & 1 ? "#d08a52" : "#b0c0cc"); p.r(x + 1, 24 - h, 1, h - 2, "#e0c8a8"); }
    } else {
      p.o(5, 17, 12, 6, "#c89a58", OUT); p.r(6, 18, 10, 1, "#e0b878"); p.r(8, 18, 1, 3, "#8a6030"); p.r(12, 18, 1, 3, "#8a6030");
      p.o(19, 16, 9, 7, "#e0c060", OUT); p.r(20, 17, 7, 1, "#f0d888"); p.r(23, 17, 1, 5, "#b89838"); p.o(30, 18, 9, 5, "#d8b070", OUT); p.r(31, 19, 7, 1, "#ecd098");
    }
    // the awning: stripes down to a scalloped edge
    p.r(0, 1, 44, 12, OUT);
    for (let x = 1; x < 43; x++) { const c = (((x - 1) / 6) | 0) & 1 ? A[1] : A[0]; p.r(x, 2, 1, 9, c); p.p(x, 2, shade(c, 1.25)); p.r(x, 8, 1, 3, shade(c, 0.8)); if ((x - 1) % 6 === 5) p.p(x, 11, OUT); else p.p(x, 11, shade(c, 0.7)); }
    p.r(1, 13, 42, 2, "rgba(0,0,0,0.28)");
  }),
  wagon: (v, _alt, M) => M(44, 28, (p, r) => {
    sh(p, 3, 25, 36);
    p.r(36, 14, 8, 1, WD.l); p.r(36, 17, 8, 1, WD.d);
    p.o(4, 10, 33, 9, WD.m, WD.o); p.r(5, 11, 31, 1, WD.h); for (let x = 10; x < 34; x += 6) p.r(x, 12, 1, 6, WD.d);
    if ((v & 3) === 0) { for (const x of [6, 14, 22]) { p.o(x, 4, 8, 7, "#b8a888", OUT); p.r(x + 1, 5, 6, 1, "#d0c4a8"); p.p(x + 4, 4, "#8a7a5a"); } p.o(29, 3, 7, 8, WD.l, WD.o); p.r(30, 6, 5, 1, WD.d); }
    else if ((v & 3) === 1) { for (const x of [6, 16, 26]) { p.o(x, 2, 9, 9, "#8a6a44", WD.o); p.r(x + 1, 4, 7, 1, IR.m); p.r(x + 1, 8, 7, 1, IR.m); p.r(x + 1, 3, 2, 7, "#a8845a"); } }
    else if ((v & 3) === 2) { for (const x of [6, 17]) { p.o(x, 3, 10, 8, ST.l, OUT); p.r(x + 1, 4, 8, 2, ST.h); p.r(x + 4, 1, 3, 3, IR.h); p.p(x + 5, 2, OUT); } p.o(28, 5, 8, 6, ST.m, OUT); p.r(29, 6, 6, 1, ST.h); }
    else { for (let i = 0; i < 60; i++) p.p(6 + ((r() * 29) | 0), 4 + ((r() * 7) | 0), ["#b8a252", "#9a843e", "#d0bc6a"][(r() * 3) | 0]); p.r(5, 9, 31, 2, "#9a843e"); }
    wheel(p, 6, 16); wheel(p, 27, 16);
  }),
  haybale: (v, _alt, M) => M(18, v & 1 ? 22 : 14, (p, r) => {
    const top = v & 1 ? 8 : 0;
    sh(p, 1, top + 12, 16, 2);
    for (const [x, y] of v & 1 ? [[1, top + 2], [2, 0]] : [[1, 2]]) {
      p.o(x, y, 16, 10, "#b8a252", "#3a2e10"); p.r(x + 1, y + 1, 14, 2, "#d0bc6a");
      for (let i = 0; i < 16; i++) p.r(x + 1 + ((r() * 13) | 0), y + 2 + ((r() * 6) | 0), 2, 1, r() < 0.5 ? "#9a843e" : "#d8c878");
      p.r(x + 4, y + 1, 1, 8, "#6a5628"); p.r(x + 11, y + 1, 1, 8, "#6a5628");
    }
  }),
  trough: (_v, _alt, M) => M(24, 13, (p) => {
    sh(p, 1, 11, 22, 2);
    p.o(1, 3, 22, 8, WD.m, WD.o); p.r(2, 4, 20, 1, WD.h); p.r(3, 5, 18, 3, "#1c3044"); p.r(5, 5, 6, 1, "#3a5a7a"); p.r(14, 6, 4, 1, "#2a4662");
    p.r(2, 8, 20, 1, IR.m); p.r(3, 11, 2, 2, WD.d); p.r(19, 11, 2, 2, WD.d);
  }),
  hitchpost: (_v, _alt, M) => M(22, 15, (p) => {
    sh(p, 1, 13, 20, 2);
    p.o(1, 2, 4, 13, WD.m, WD.o); p.o(17, 2, 4, 13, WD.m, WD.o); p.r(2, 3, 1, 11, WD.l); p.r(18, 3, 1, 11, WD.l);
    p.r(0, 5, 22, 3, WD.o); p.r(1, 5, 20, 2, WD.l); p.r(1, 5, 20, 1, WD.h); p.p(7, 8, IR.h); p.p(7, 9, IR.m); p.p(14, 8, IR.h); p.p(14, 9, IR.m);
  }),
  woodpile: (_v, _alt, M) => M(24, 17, (p, r) => {
    sh(p, 1, 15, 22, 2);
    p.r(1, 3, 2, 13, WD.d); p.r(21, 3, 2, 13, WD.d);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4 + (j & 1); i++) {
      const x = 3 + i * 4 - (j & 1) * 1, y = 11 - j * 4;
      if (x > 18) continue;
      p.r(x, y, 4, 4, WD.o); p.r(x, y + 1, 4, 2, WD.o); p.r(x + 1, y, 2, 4, "#a08050"); p.r(x, y + 1, 4, 2, "#a08050"); p.p(x + 1 + ((r() * 2) | 0), y + 1, "#6a4e30"); p.p(x + 2, y + 2, "#c8a870");
    }
  }),
  // 0 a paling fence, 1 a rough yard rail
  fence: (v, _alt, M) => M(16, 14, (p) => {
    p.r(0, 12, 16, 2, "rgba(0,0,0,0.25)");
    if (v & 1) { p.r(0, 5, 16, 2, WD.l); p.r(0, 5, 16, 1, WD.h); p.r(0, 9, 16, 2, WD.m); p.r(0, 11, 16, 1, WD.o); p.o(6, 1, 4, 13, WD.m, WD.o); p.r(7, 2, 1, 11, WD.l); return; }
    p.r(0, 5, 16, 1, WD.d); p.r(0, 9, 16, 1, WD.d);
    for (let x = 0; x < 16; x += 4) { p.r(x, 2, 3, 11, WD.m); p.r(x, 2, 1, 11, WD.l); p.p(x + 1, 1, WD.l); p.p(x + 2, 2, WD.d); p.p(x + 1, 5, IR.l); p.p(x + 1, 9, IR.l); }
  }),
  fence_v: (v, _alt, M) => M(6, 24, (p) => {
    p.r(2, 5, 4, 19, "rgba(0,0,0,0.2)");
    p.r(2, 4, 2, 18, v & 1 ? WD.l : WD.m); p.r(2, 4, 1, 18, WD.l); p.r(4, 6, 1, 16, WD.d);
    for (const y of [0, 9, 18]) { p.o(0, y, 5, 6, WD.m, WD.o); p.r(1, y + 1, 3, 1, WD.h); }
  }),
  planter: (v, _alt, M) => M(16, 13, (p, r) => {
    sh(p, 1, 11, 14, 2);
    p.o(1, 5, 14, 7, ST.m, OUT); p.r(2, 6, 12, 1, ST.h); p.r(2, 10, 12, 1, ST.d);
    const fl = [["#c84858", "#e07888"], ["#e0c060", "#f0e090"], ["#d8d0e8", "#a890d0"], ["#e08840", "#f0b070"]][v & 3];
    for (let i = 0; i < 22; i++) { const x = 2 + ((r() * 12) | 0), y = 1 + ((r() * 5) | 0); p.p(x, y, r() < 0.55 ? ["#3e6a30", "#4e8a3a", "#6ab050"][(r() * 3) | 0] : fl[(r() * 2) | 0]); }
    p.r(2, 5, 12, 1, "#3e6a30");
  }),
  coop: (_v, _alt, M) => M(22, 19, (p) => {
    sh(p, 1, 17, 20, 2);
    p.o(2, 6, 18, 11, WD.m, WD.o); for (let x = 5; x < 19; x += 3) p.r(x, 7, 1, 9, WD.d);
    p.r(0, 2, 22, 5, WD.o); p.r(1, 3, 20, 3, "#68553c"); p.r(1, 3, 20, 1, "#80694a");
    p.r(8, 10, 6, 7, OUT); p.line(14, 17, 19, 14, WD.l);
    p.r(15, 13, 4, 3, "#e8e0d0"); p.r(18, 12, 2, 2, "#e8e0d0"); p.p(19, 11, "#c83040"); p.p(20, 13, "#e0a030"); p.p(16, 16, "#e0a030");
  }),
  laundry: (_v, _alt, M) => M(46, 24, (p) => {
    p.r(1, 2, 2, 22, WD.m); p.r(1, 2, 1, 22, WD.l); p.r(43, 2, 2, 22, WD.d);
    for (let x = 3; x < 43; x++) p.p(x, 4 + Math.round(Math.sin(((x - 3) / 40) * Math.PI) * 2), "#c8b088");
    p.r(6, 6, 8, 8, "#e0dcd0"); p.r(4, 6, 2, 4, "#e0dcd0"); p.r(14, 6, 2, 4, "#e0dcd0"); p.r(6, 12, 8, 2, "#c0bcb0"); p.r(9, 6, 2, 2, "#b0aca0");
    p.r(18, 7, 6, 11, "#4a6a9a"); p.r(20, 12, 2, 6, "#2e4468"); p.r(18, 7, 6, 1, "#6a8aba");
    p.r(27, 7, 7, 7, "#a83a34"); p.r(27, 7, 7, 1, "#c85a50"); p.r(27, 12, 7, 2, "#7a2824");
    p.r(36, 6, 2, 6, "#d8ccb0"); p.r(39, 6, 2, 5, "#d8ccb0"); p.p(7, 5, WD.d); p.p(12, 5, WD.d); p.p(21, 6, WD.d); p.p(30, 6, WD.d);
  }),
  chimney: (_v, _alt, M) => M(8, 6, (p) => {
    p.o(1, 0, 6, 6, "#a8603a", OUT); p.r(2, 1, 1, 4, "#c87a4a"); p.r(2, 0, 4, 1, "#1a1210"); p.r(5, 1, 1, 4, "#7a4428");
  }),
  dummy: (_v, _alt, M) => M(16, 27, (p, r) => {
    sh(p, 3, 25, 10, 2);
    p.r(7, 16, 2, 10, WD.m); p.r(4, 24, 8, 2, WD.d); p.r(1, 10, 14, 2, WD.l); p.r(1, 12, 14, 1, WD.o);
    p.o(4, 8, 8, 11, "#b8a252", "#3a2e10"); for (let i = 0; i < 10; i++) p.r(5 + ((r() * 5) | 0), 9 + ((r() * 8) | 0), 2, 1, r() < 0.5 ? "#9a843e" : "#d8c878");
    p.r(4, 12, 8, 1, "#6a5628"); p.o(5, 1, 6, 8, "#c8b088", "#3a2e10"); p.r(6, 2, 4, 1, "#e0d0a8"); p.p(7, 4, "#a83a34"); p.p(8, 4, "#a83a34"); p.r(7, 6, 2, 1, "#6a5628");
    p.line(5, 10, 10, 16, "#3a2e10"); p.r(0, 9, 2, 3, "#b8a252"); p.r(14, 9, 2, 3, "#b8a252");
  }),
  // ---------- shop fittings
  // 0 smith, 1 jeweller (glass top), 2 tailor, 3 armourer, 4 the Guild's desk
  counter: (v, _alt, M) => M(48, 23, (p) => {
    sh(p, 1, 21, 46, 2);
    const rich = v === 1 || v === 3 || v === 4;
    p.o(0, 8, 48, 14, WD.m, WD.o); p.r(1, 13, 46, 1, WD.d);
    for (let x = 3; x < 44; x += 11) { p.o(x, 13, 9, 7, WD.m, WD.d); p.r(x + 1, 14, 7, 1, WD.l); if (rich) p.r(x + 3, 16, 3, 1, GD.m); }
    p.o(0, 5, 48, 5, WD.l, WD.o); p.r(1, 6, 46, 1, WD.h);
    switch (v % 5) {
      case 0: p.r(5, 3, 8, 2, WD.l); p.r(11, 2, 4, 4, IR.m); p.r(11, 2, 4, 1, IR.h); p.r(20, 3, 1, 3, IR.l); p.r(24, 3, 1, 3, IR.l); p.r(21, 2, 3, 1, IR.l); p.o(31, 2, 10, 4, "#d8d0b8", WD.o); p.r(33, 3, 6, 1, "#8a8478"); break;
      case 1:
        p.r(2, 6, 44, 3, "#2a1030"); p.r(2, 6, 44, 1, "#b8dce8"); p.r(2, 5, 44, 1, "#e8f8ff");
        for (const [x, c] of [[6, "#ff6080"], [13, "#60e0ff"], [20, "#ffe080"], [27, "#80ff90"], [34, "#ff80e0"], [41, "#ffffff"]] as const) { p.p(x, 7, GD.m); p.gp(x, 8, c); p.p(x + 1, 8, GD.l); }
        for (let x = 12; x < 46; x += 11) p.r(x, 5, 1, 4, GD.d);
        break;
      case 2:
        p.r(4, 1, 13, 5, CLOTH[0]); p.r(4, 1, 13, 1, shade(CLOTH[0], 1.4)); p.p(4, 3, OUT); p.r(19, 2, 11, 4, CLOTH[1]); p.r(19, 2, 11, 1, shade(CLOTH[1], 1.4));
        p.r(33, 4, 10, 1, "#e0c060"); p.p(35, 4, OUT); p.p(38, 4, OUT); p.p(41, 4, OUT); p.line(32, 1, 37, 3, IR.h); p.line(32, 3, 37, 1, IR.h); break;
      case 3: p.o(5, 0, 8, 6, IR.l, OUT); p.r(6, 1, 6, 1, IR.h); p.r(6, 3, 6, 1, OUT); p.r(8, -1, 2, 1, "#a83a34"); p.o(18, 2, 7, 4, IR.m, OUT); p.r(19, 3, 5, 1, IR.h); p.line(29, 4, 42, 2, IR.h); p.r(29, 3, 2, 3, GD.m); break;
      default:
        p.o(17, 1, 14, 5, "#e0d8c0", WD.o); p.r(24, 1, 1, 5, "#8a8478"); for (const y of [2, 4]) { p.r(19, y, 4, 1, "#6a6458"); p.r(26, y, 4, 1, "#6a6458"); }
        p.r(34, 3, 3, 3, "#1a1a2a"); p.line(36, 3, 40, -1, "#e8e0d0"); p.r(7, 2, 4, 3, GD.l); p.r(8, 1, 2, 1, GD.m); p.r(6, 5, 6, 1, GD.d); p.r(41, 4, 4, 2, "#d0c8a8");
    }
  }),
  bar: (_v, _alt, M) => M(80, 25, (p) => {
    sh(p, 1, 23, 78, 2);
    p.o(0, 8, 80, 15, WD.m, WD.o);
    for (let x = 2; x < 78; x += 6) { p.r(x, 10, 5, 11, x % 12 === 2 ? WD.m : "#644428"); p.r(x, 10, 1, 11, WD.l); }
    p.r(1, 12, 78, 1, IR.m); p.r(1, 18, 78, 1, IR.m); p.r(2, 22, 76, 1, GD.m);
    p.o(0, 5, 80, 5, WD.l, WD.o); p.r(1, 6, 78, 1, WD.h); p.r(1, 8, 78, 1, WD.m);
    for (const x of [8, 15, 44, 62]) { p.o(x, 1, 5, 5, "#b89868", OUT); p.r(x + 1, 1, 3, 1, "#f0e8d0"); p.p(x + 5, 3, "#b89868"); }
    for (const x of [26, 32]) { p.r(x, -1, 2, 6, WD.d); p.r(x, -2, 2, 2, GD.l); p.r(x - 1, 4, 4, 1, GD.m); }
    p.r(52, 0, 3, 6, "#2e5a3a"); p.r(53, -2, 1, 2, "#2e5a3a"); p.p(52, 1, "#5a9a6a"); p.r(57, 1, 3, 5, "#6a3a22"); p.r(58, -1, 1, 2, "#6a3a22");
    p.r(69, 4, 7, 2, "#d8ccb0"); p.r(70, 3, 4, 1, "#b8ac90");
  }),
  // wall shelves: 0 bottles and mugs, 1 folded cloth, 2 ironwork, 3 helms, 4 velvet busts and boxes
  goodshelf: (v, _alt, M) => M(32, 16, (p) => {
    for (const y of [6, 14]) { p.r(0, y, 32, 2, WD.l); p.r(0, y, 32, 1, WD.h); p.r(0, y + 2, 32, 1, "rgba(0,0,0,0.3)"); p.r(2, y + 1, 1, 2, WD.d); p.r(29, y + 1, 1, 2, WD.d); }
    for (let row = 0; row < 2; row++) for (let i = 0; i < 5; i++) {
      const x = 2 + i * 6, y = row ? 14 : 6, k = (i + row * 2) % 5;
      switch (v % 5) {
        case 0: if (k & 1) { p.r(x, y - 4, 4, 4, "#b89868"); p.r(x, y - 4, 4, 1, "#f0e8d0"); p.p(x + 4, y - 3, "#b89868"); } else { p.r(x + 1, y - 5, 3, 5, ["#2e5a3a", "#6a3a22", "#2e4a6a"][k % 3]); p.r(x + 2, y - 7, 1, 2, "#8a8478"); p.p(x + 1, y - 4, "#c8e0d0"); } break;
        case 1: p.r(x, y - 4, 5, 2, CLOTH[k]); p.r(x, y - 2, 5, 2, CLOTH[(k + 2) % 6]); p.r(x, y - 4, 5, 1, shade(CLOTH[k], 1.4)); break;
        case 2: if (k % 3 === 0) { p.r(x, y - 5, 1, 5, IR.l); p.r(x + 3, y - 5, 1, 5, IR.l); p.r(x + 1, y - 6, 2, 1, IR.l); } else if (k % 3 === 1) { p.o(x, y - 4, 5, 4, WD.m, WD.o); p.r(x + 1, y - 4, 3, 1, IR.h); } else { p.r(x + 1, y - 2, 4, 2, IR.m); p.r(x, y - 5, 2, 3, IR.h); p.r(x + 1, y - 2, 4, 1, IR.h); } break;
        case 3: p.o(x, y - 5, 5, 5, k & 1 ? IR.m : IR.l, OUT); p.r(x + 1, y - 4, 3, 1, IR.h); p.r(x + 1, y - 2, 3, 1, OUT); if (k === 0) p.r(x + 2, y - 7, 1, 2, "#a83a34"); break;
        default: if (k & 1) { p.o(x, y - 3, 5, 3, "#3a1030", OUT); p.p(x + 2, y - 2, GD.l); } else { p.r(x + 1, y - 6, 3, 6, "#2a1030"); p.r(x + 1, y - 6, 3, 1, "#4a2050"); p.p(x + 1, y - 3, GD.l); p.gp(x + 2, y - 2, ["#ff6080", "#60e0ff", "#80ff90"][k % 3]); p.p(x + 3, y - 3, GD.l); }
      }
    }
  }),
  displaycase: (v, _alt, M) => M(16, 23, (p) => {
    sh(p, 1, 21, 14, 2);
    p.o(1, 12, 14, 10, WD.m, WD.o); p.r(2, 13, 12, 1, WD.l); p.r(2, 16, 12, 1, GD.m); p.r(4, 18, 8, 3, WD.d);
    p.r(1, 1, 14, 12, "#34485a"); p.r(2, 2, 12, 10, "#1c2430"); p.r(2, 9, 12, 3, "#3a1030"); p.r(2, 9, 12, 1, "#5a2050");
    if (v % 3 === 0) { p.r(5, 5, 1, 3, GD.m); p.r(10, 5, 1, 3, GD.m); p.r(6, 8, 4, 1, GD.l); p.gp(7, 9, "#ff5070"); p.gp(8, 9, "#ff90a0"); }
    else if (v % 3 === 1) { for (const x of [4, 7, 10]) { p.r(x, 8, 2, 2, GD.m); p.gp(x, 7, ["#60e0ff", "#ffe080", "#80ff90"][(x - 4) / 3]); } }
    else { p.r(4, 7, 8, 2, GD.m); p.r(4, 6, 1, 1, GD.l); p.r(7, 5, 2, 2, GD.l); p.r(11, 6, 1, 1, GD.l); p.gp(7, 7, "#60e0ff"); p.gp(5, 7, "#ff6080"); p.gp(10, 7, "#ff6080"); }
    p.r(3, 2, 1, 6, "#b8dce8"); p.p(4, 2, "#e8f8ff"); p.p(12, 10, "#7a9ab0"); p.r(1, 1, 14, 1, "#8ab0c4");
  }),
  // 0 a gown, 1 a doublet, 2 a fur-collared cloak, 3 the bare form, pinned
  mannequin: (v, _alt, M) => M(14, 28, (p) => {
    sh(p, 2, 26, 10, 2);
    p.r(4, 25, 6, 2, WD.d); p.r(6, 18, 2, 8, WD.m); p.r(6, 1, 2, 3, WD.l); p.r(5, 0, 4, 2, WD.m);
    const c = ["#6a3a8a", "#2e6a6a", "#8a2a34", "#d8ccb0"][v & 3], l = shade(c, 1.3), d = shade(c, 0.68);
    if ((v & 3) === 0) {
      p.r(3, 4, 8, 2, c); p.r(4, 6, 6, 6, c); p.r(5, 9, 4, 1, GD.m);
      for (let y = 12; y < 25; y++) { const w = 6 + Math.round((y - 12) * 0.5); p.r(7 - (w >> 1), y, w, 1, c); p.p(7 - (w >> 1), y, l); p.p(6 + (w >> 1), y, d); }
      p.r(1, 24, 12, 1, GD.m); p.r(4, 6, 1, 6, l); p.r(8, 14, 1, 9, d);
    } else if ((v & 3) === 1) {
      p.r(2, 4, 10, 3, c); p.r(3, 7, 8, 8, c); p.r(3, 15, 8, 3, d); p.r(3, 4, 1, 11, l); p.r(10, 7, 1, 8, d);
      for (let y = 6; y < 15; y += 2) p.p(7, y, GD.l); p.r(3, 14, 8, 1, "#3a2818"); p.p(7, 14, GD.m);
    } else if ((v & 3) === 2) {
      p.r(2, 3, 10, 3, "#d8d0c0"); p.p(3, 3, "#f0e8d8"); p.p(8, 4, "#a8a090");
      for (let y = 6; y < 23; y++) { const w = 8 + Math.round((y - 6) * 0.25); p.r(7 - (w >> 1), y, w, 1, c); p.p(7 - (w >> 1), y, l); p.p(6 + (w >> 1), y, d); }
      p.r(6, 6, 2, 16, d); p.p(7, 7, GD.l);
    } else {
      p.r(3, 4, 8, 3, c); p.r(4, 7, 6, 10, c); p.r(3, 4, 1, 5, l); p.r(9, 8, 1, 9, d); p.r(4, 17, 6, 1, d);
      p.p(5, 8, IR.h); p.p(8, 11, IR.h); p.p(6, 14, IR.h); p.r(5, 10, 3, 1, "#a8a090"); p.r(6, 12, 3, 1, "#a8a090");
    }
  }),
  clothrack: (_v, _alt, M) => M(32, 27, (p) => {
    sh(p, 1, 25, 30, 2);
    p.r(1, 1, 2, 26, WD.m); p.r(29, 1, 2, 26, WD.d); p.r(1, 1, 30, 2, WD.l);
    for (let j = 0; j < 3; j++) {
      p.r(2, 9 + j * 8, 28, 1, WD.d);
      for (let i = 0; i < 4; i++) { const x = 4 + i * 6 + (j & 1), y = 3 + j * 8, c = CLOTH[(i + j * 2) % 6]; p.o(x, y, 6, 6, c, OUT); p.r(x + 1, y + 1, 4, 1, shade(c, 1.4)); p.p(x + 2, y + 3, shade(c, 0.6)); p.p(x + 3, y + 3, "#e8e0d0"); }
    }
  }),
  loom: (_v, _alt, M) => M(32, 33, (p) => {
    sh(p, 1, 31, 30, 2);
    p.r(2, 2, 3, 30, WD.m); p.r(2, 2, 1, 30, WD.l); p.r(27, 2, 3, 30, WD.d); p.r(1, 1, 30, 3, WD.l); p.r(1, 1, 30, 1, WD.h);
    for (let x = 6; x < 27; x += 2) p.r(x, 4, 1, 16, x % 4 === 0 ? "#e0d8c8" : "#b8b0a0");
    p.r(5, 11, 22, 1, WD.m); p.r(5, 15, 22, 1, WD.d);
    p.r(5, 20, 22, 5, CLOTH[0]); for (let x = 6; x < 26; x += 3) { p.p(x, 21, CLOTH[3]); p.p(x + 1, 23, CLOTH[3]); } p.r(5, 20, 22, 1, shade(CLOTH[0], 1.4));
    p.r(4, 25, 24, 3, WD.l); p.r(4, 27, 24, 1, WD.d); p.r(8, 29, 6, 2, WD.d); p.r(18, 29, 6, 2, WD.d); p.r(14, 12, 6, 2, WD.h);
  }),
  mirror: (_v, _alt, M) => M(10, 20, (p) => {
    p.o(0, 0, 10, 20, GD.m, GD.d); p.r(1, 1, 8, 1, GD.l); p.r(2, 2, 6, 16, "#9ab8c8"); p.r(2, 2, 6, 5, "#b8d4e0");
    p.line(3, 8, 6, 3, "#e8f8ff"); p.line(4, 14, 7, 9, "#d0e8f0"); p.r(2, 17, 6, 1, "#6a8898"); p.r(4, -1, 2, 1, GD.l);
  }),
  screen: (_v, _alt, M) => M(28, 27, (p) => {
    sh(p, 1, 25, 26, 2);
    for (const [x, y, c] of [[0, 2, "#7a2428"], [9, 0, "#8e3036"], [18, 2, "#6a1c20"]] as const) {
      p.o(x, y, 10, 25, c, OUT); p.r(x + 1, y + 1, 8, 1, GD.m); p.r(x + 1, y + 23, 8, 1, GD.d);
      p.line(x + 2, y + 16, x + 5, y + 6, GD.m); p.line(x + 5, y + 6, x + 7, y + 12, GD.m); p.p(x + 5, y + 5, GD.l); p.p(x + 3, y + 10, "#d8d0e8"); p.p(x + 7, y + 9, "#d8d0e8");
    }
  }),
  kegrack: (_v, _alt, M) => M(36, 27, (p) => {
    sh(p, 1, 25, 34, 2);
    p.r(1, 12, 34, 2, WD.d); p.r(1, 23, 34, 2, WD.d); p.r(1, 4, 2, 21, WD.m); p.r(33, 4, 2, 21, WD.d);
    const keg = (x: number, y: number, tap: boolean) => {
      p.r(x + 2, y, 6, 10, OUT); p.r(x, y + 2, 10, 6, OUT); p.r(x + 1, y + 1, 8, 8, OUT);
      p.r(x + 2, y + 1, 6, 8, "#8a6a44"); p.r(x + 1, y + 2, 8, 6, "#8a6a44"); p.r(x + 2, y + 2, 6, 6, "#a08050");
      p.r(x + 3, y + 3, 4, 4, "#8a6a44"); p.r(x + 2, y + 1, 6, 1, IR.m); p.r(x + 2, y + 8, 6, 1, IR.m); p.p(x + 4, y + 4, WD.o);
      if (tap) { p.r(x + 4, y + 7, 2, 2, GD.l); p.p(x + 4, y + 9, GD.d); }
    };
    keg(7, 1, false); keg(19, 1, false); keg(2, 12, true); keg(13, 12, true); keg(24, 12, true);
    p.r(3, 24, 30, 1, IR.d);
  }),
  // 0 mugs and a plate, 1 a candle (lit), 2 cards and coin, 3 bare, ringed with old stains
  roundtable: (v, _alt, M) => M(22, 19, (p) => {
    sh(p, 3, 17, 16, 2);
    p.r(9, 10, 4, 6, WD.d); p.r(6, 15, 10, 2, WD.d); p.r(6, 15, 10, 1, WD.m);
    p.r(4, 2, 14, 10, WD.o); p.r(2, 3, 18, 8, WD.o); p.r(1, 5, 20, 4, WD.o);
    p.r(4, 3, 14, 7, WD.l); p.r(2, 4, 18, 5, WD.l); p.r(4, 10, 14, 1, WD.m); p.r(2, 9, 18, 1, WD.m); p.r(5, 3, 12, 1, WD.h);
    for (let x = 4; x < 18; x += 5) p.r(x, 5, 3, 1, "#8a6238");
    if ((v & 3) === 0) { p.o(5, 2, 4, 4, "#b89868", OUT); p.p(6, 2, "#f0e8d0"); p.o(13, 4, 4, 4, "#b89868", OUT); p.r(9, 6, 4, 2, "#d8d0c0"); p.p(10, 6, "#8a6030"); }
    else if ((v & 3) === 1) { p.r(10, 2, 2, 5, "#e8e0c8"); p.r(9, 6, 4, 1, GD.d); p.gp(10, 0, FIRE.mid); p.gp(10, 1, FIRE.hot); p.gp(11, 1, FIRE.mid); p.o(4, 4, 4, 4, "#b89868", OUT); p.r(14, 6, 3, 1, "#d8d0c0"); }
    else if ((v & 3) === 2) { p.r(6, 4, 3, 2, "#e8e0d0"); p.r(10, 5, 3, 2, "#e8e0d0"); p.p(7, 4, "#a83a34"); p.p(11, 6, OUT); p.r(14, 6, 2, 1, GD.l); p.p(15, 5, GD.l); p.p(5, 7, GD.m); }
    else { p.r(7, 5, 3, 1, "#6a4a2a"); p.r(7, 7, 3, 1, "#6a4a2a"); p.p(6, 6, "#6a4a2a"); p.p(10, 6, "#6a4a2a"); p.p(14, 7, "#6a4a2a"); }
  }),
  stool: (_v, _alt, M) => M(8, 9, (p) => {
    p.r(1, 7, 6, 2, "rgba(0,0,0,0.3)"); p.o(0, 2, 8, 4, WD.l, WD.o); p.r(1, 3, 6, 1, WD.h); p.r(1, 6, 1, 3, WD.d); p.r(6, 6, 1, 3, WD.d);
  }),
  stairs_up: (_v, _alt, M) => M(22, 30, (p) => {
    p.r(0, 1, 22, 29, WD.o); p.r(1, 0, 20, 4, "#0c0a0a");
    for (let i = 0; i < 7; i++) { const y = 26 - i * 4; p.r(1, y, 20, 4, shade(WD.l, 1.05 - i * 0.09)); p.r(1, y, 20, 1, shade(WD.h, 1.05 - i * 0.09)); p.r(1, y + 3, 20, 1, WD.o); }
    p.r(0, 1, 2, 29, WD.m); p.r(0, 1, 1, 29, WD.l); p.r(20, 1, 2, 29, WD.d); p.r(0, 26, 2, 4, WD.h);
  }),
  fireplace: (_v, _alt, M) => M(44, 34, (p, r) => {
    p.o(0, 5, 44, 29, ST.m, OUT);
    for (let y = 9, j = 0; y < 33; y += 5, j++) for (let x = j & 1 ? -4 : 1; x < 43; x += 9) { const xx = Math.max(1, x); p.r(xx, y, Math.min(x + 8, 43) - xx, 4, shade(ST.m, 0.85 + r() * 0.3)); p.r(xx, y, Math.min(x + 8, 43) - xx, 1, ST.l); }
    p.o(5, 0, 34, 6, ST.l, OUT); p.r(6, 1, 32, 1, ST.h);
    p.o(0, 5, 44, 4, WD.l, WD.o); p.r(1, 6, 42, 1, WD.h);
    p.r(8, 14, 28, 18, "#0c0808"); p.r(10, 12, 24, 2, "#0c0808"); p.r(7, 13, 1, 19, OUT); p.r(36, 13, 1, 19, OUT);
    p.r(12, 28, 20, 3, WD.d); p.r(13, 28, 6, 1, WD.m); p.r(22, 29, 8, 1, "#1a110b");
    p.g(13, 23, 18, 6, FIRE.low); p.g(15, 20, 14, 8, FIRE.mid); p.g(18, 19, 8, 8, FIRE.hot);
    p.g(14, 20, 2, 3, FIRE.low); p.g(28, 19, 2, 4, FIRE.low); p.g(21, 15, 2, 4, FIRE.mid); p.g(17, 17, 2, 3, FIRE.mid); p.g(25, 16, 2, 3, FIRE.mid);
    p.gp(12, 27, FIRE.mid); p.gp(31, 28, FIRE.mid); p.gp(20, 30, FIRE.low); p.gp(26, 30, FIRE.low);
    p.r(10, 24, 1, 8, IR.m); p.r(33, 24, 1, 8, IR.m); p.p(10, 23, IR.h); p.p(33, 23, IR.h);
    p.r(3, 32, 38, 2, ST.l); p.r(3, 32, 38, 1, ST.h);
    p.r(4, 2, 3, 3, "#b06a3a"); p.r(37, 1, 2, 4, "#2e5a3a"); p.r(40, 2, 2, 3, GD.m);
  }),
  smithforge: (_v, _alt, M) => M(40, 38, (p, r) => {
    p.o(2, 16, 36, 22, "#6a3a2c", OUT);
    for (let y = 21, j = 0; y < 37; y += 3, j++) for (let x = j & 1 ? 0 : 3; x < 37; x += 6) { const xx = Math.max(3, x); p.r(xx, y, Math.min(x + 5, 37) - xx, 2, shade("#8a4a36", 0.75 + r() * 0.4)); }
    p.r(3, 14, 34, 7, "#1a1210"); p.r(3, 14, 34, 1, ST.m);
    p.g(7, 16, 26, 4, FIRE.low); p.g(10, 16, 20, 3, FIRE.mid); p.g(15, 16, 10, 2, FIRE.hot);
    for (let i = 0; i < 12; i++) p.r(6 + ((r() * 27) | 0), 15 + ((r() * 5) | 0), 2, 1, "#1a1210");
    p.gp(9, 15, FIRE.mid); p.gp(30, 15, FIRE.mid); p.gp(20, 14, FIRE.hot);
    // the hood, riveted iron, drawing up into the wall
    for (let y = 0; y < 13; y++) { const w = 22 + y; p.r(20 - (w >> 1), y, w, 1, y === 12 ? IR.d : "#34343c"); p.p(20 - (w >> 1), y, OUT); p.p(19 + (w >> 1), y, OUT); }
    p.r(10, 0, 20, 1, IR.m); for (let x = 9; x < 32; x += 4) p.p(x, 10, IR.h); p.r(12, 2, 2, 8, "#44444e"); p.r(4, 12, 32, 1, IR.l);
    p.o(15, 27, 10, 8, "#120c0a", IR.m); p.g(17, 32, 6, 2, FIRE.low); p.gp(19, 31, FIRE.mid);
    p.line(31, 15, 37, 6, IR.l); p.line(33, 15, 38, 8, IR.m);
  }),
  bellows: (_v, _alt, M) => M(28, 26, (p) => {
    sh(p, 3, 24, 22, 2);
    p.r(22, 2, 2, 23, WD.m); p.r(22, 2, 1, 23, WD.l); p.r(18, 22, 8, 2, WD.d);
    p.r(0, 17, 7, 2, IR.m); p.r(0, 17, 7, 1, IR.h);
    for (let y = 0; y < 9; y++) { const w = 8 + y; p.r(21 - w, 12 + y, w, 1, y % 3 === 2 ? "#3a241a" : "#6a4630"); }
    p.r(6, 11, 16, 2, WD.l); p.r(6, 11, 16, 1, WD.h); p.r(4, 21, 18, 2, WD.m); p.r(4, 23, 18, 1, WD.o);
    // the lever, set high for something tall; its grip is worn pale
    p.r(3, 3, 22, 2, WD.l); p.r(3, 5, 22, 1, WD.o); p.r(2, 2, 6, 4, "#d8c8a0"); p.r(2, 2, 6, 1, "#f0e4c0");
    p.r(14, 6, 1, 5, IR.m); p.o(20, 0, 7, 6, IR.d, OUT); p.r(22, 2, 3, 2, IR.h);
  }),
  quench: (_v, _alt, M) => M(20, 15, (p) => {
    sh(p, 1, 13, 18, 2);
    p.o(1, 4, 18, 10, WD.m, WD.o); p.r(2, 5, 16, 1, WD.h); p.r(3, 6, 14, 3, "#162634"); p.r(5, 6, 5, 1, "#3a5a7a"); p.r(2, 10, 16, 1, IR.m); p.r(2, 12, 16, 1, IR.d);
    p.line(11, 7, 17, 0, IR.l); p.line(13, 7, 18, 2, IR.m);
  }),
  toolrack: (_v, _alt, M) => M(30, 16, (p) => {
    p.r(0, 1, 30, 2, WD.l); p.r(0, 1, 30, 1, WD.h); p.r(0, 3, 30, 1, "rgba(0,0,0,0.3)");
    p.r(3, 3, 1, 9, WD.l); p.r(1, 11, 5, 3, IR.m); p.r(1, 11, 5, 1, IR.h);
    p.r(9, 3, 1, 10, IR.m); p.r(11, 3, 1, 10, IR.m); p.p(10, 6, IR.l); p.r(9, 13, 3, 1, IR.l);
    p.r(15, 3, 1, 7, WD.l); p.r(14, 9, 3, 3, IR.l); p.r(19, 3, 1, 9, IR.h); p.p(19, 12, WD.m);
    for (const x of [22, 26]) { p.r(x, 4, 1, 5, IR.l); p.r(x + 2, 4, 1, 5, IR.l); p.r(x, 3, 3, 1, IR.l); }
  }),
  coalbin: (_v, _alt, M) => M(18, 14, (p, r) => {
    sh(p, 1, 12, 16, 2);
    p.o(1, 5, 16, 8, WD.d, WD.o); p.r(2, 6, 14, 1, WD.m); p.r(2, 10, 14, 1, IR.d);
    for (let i = 0; i < 26; i++) { const x = 2 + ((r() * 13) | 0), y = 1 + ((r() * 5) | 0); if (Math.abs(x - 9) < 3 + y * 1.4) p.r(x, y, 2, 2, r() < 0.3 ? "#3a3a44" : "#16161a"); }
    p.line(13, 5, 17, 0, WD.l);
  }),
  ingots: (_v, _alt, M) => M(16, 11, (p) => {
    p.r(1, 9, 14, 2, "rgba(0,0,0,0.3)");
    for (const [x, y] of [[1, 5], [8, 5], [4, 1]]) { p.o(x, y, 7, 5, IR.m, OUT); p.r(x + 1, y + 1, 5, 1, IR.h); p.r(x + 1, y + 3, 5, 1, IR.d); }
  }),
  grindstone: (_v, _alt, M) => M(18, 19, (p) => {
    sh(p, 2, 17, 14, 2);
    p.r(3, 9, 2, 9, WD.m); p.r(13, 9, 2, 9, WD.d); p.r(2, 14, 14, 3, WD.d); p.r(3, 15, 12, 1, "#162634");
    p.r(6, 1, 6, 12, OUT); p.r(4, 3, 10, 8, OUT); p.r(5, 2, 8, 10, OUT);
    p.r(6, 2, 6, 10, ST.l); p.r(5, 3, 8, 8, ST.l); p.r(6, 3, 5, 7, ST.h); p.r(8, 6, 2, 2, IR.d); p.r(10, 9, 2, 2, ST.m);
    p.r(15, 6, 3, 1, IR.m); p.r(17, 6, 1, 4, IR.m);
  }),
  shieldwall: (_v, _alt, M) => M(30, 17, (p) => {
    p.line(10, 15, 20, 1, IR.h); p.line(20, 15, 10, 1, IR.h); p.r(9, 13, 3, 1, GD.m); p.r(19, 13, 3, 1, GD.m); p.p(10, 15, WD.m); p.p(20, 15, WD.m);
    p.r(2, 2, 7, 11, OUT); p.r(1, 4, 9, 7, OUT); p.r(2, 3, 7, 9, "#2e4a6a"); p.r(2, 4, 3, 7, "#4a6a9a"); p.r(5, 3, 1, 9, "#d8d0b8"); p.r(2, 7, 7, 1, "#d8d0b8"); p.r(4, 6, 3, 3, IR.h);
    p.r(21, 1, 8, 9, OUT); p.r(22, 10, 6, 3, OUT); p.r(24, 13, 2, 2, OUT);
    p.r(22, 2, 6, 8, "#8a2a34"); p.r(23, 10, 4, 2, "#8a2a34"); p.r(24, 12, 2, 2, "#6a1c24"); p.r(24, 2, 2, 12, GD.m); p.r(22, 2, 2, 6, "#a8424a");
  }),
  // finished harness on a stand, polished for sale: 0 plate, 1 mail under a tabard, 2 gilt parade armour, 3 a brigandine
  armordisplay: (v, _alt, M) => M(14, 28, (p) => {
    sh(p, 2, 26, 10, 2);
    p.r(4, 25, 6, 2, WD.d); p.r(6, 20, 2, 6, WD.m);
    const k = v & 3, m = k === 2 ? GD.m : k === 3 ? "#5a3a2a" : IR.l, l = k === 2 ? GD.l : k === 3 ? "#7a5238" : IR.h, d = k === 2 ? GD.d : k === 3 ? "#3a2418" : IR.m;
    p.o(4, 0, 6, 6, m, OUT); p.r(5, 1, 3, 1, l); p.r(5, 3, 4, 1, OUT); p.p(9, 1, d); if (k !== 1) p.r(6, -1, 2, 1, k === 2 ? "#a83a34" : d);
    p.r(1, 6, 12, 3, OUT); p.r(2, 6, 10, 2, m); p.r(2, 6, 3, 1, l); p.r(9, 6, 3, 1, l);
    p.r(3, 8, 8, 10, OUT); p.r(4, 8, 6, 9, m); p.r(4, 8, 2, 8, l); p.r(8, 9, 2, 8, d);
    p.r(1, 9, 2, 7, m); p.r(1, 9, 1, 6, l); p.r(11, 9, 2, 7, d); p.r(4, 18, 6, 3, d); p.r(4, 18, 6, 1, m);
    if (k === 1) { p.r(4, 9, 6, 10, "#8a2a34"); p.r(4, 9, 1, 10, "#a8424a"); p.r(6, 11, 2, 4, GD.m); for (let y = 8; y < 17; y += 2) { p.p(2, y, IR.d); p.p(12, y, IR.d); } }
    else if (k === 3) { for (let y = 9; y < 17; y += 2) for (let x = 5; x < 10; x += 2) p.p(x, y, GD.l); }
    else { p.r(6, 9, 2, 8, l); p.r(4, 13, 6, 1, d); p.p(7, 11, k === 2 ? "#fff0c0" : "#ffffff"); }
  }),
  gembench: (_v, _alt, M) => M(32, 21, (p) => {
    sh(p, 1, 19, 30, 2);
    p.o(1, 9, 30, 11, WD.m, WD.o); for (const x of [3, 12, 21]) { p.o(x, 11, 8, 4, WD.m, WD.d); p.p(x + 4, 13, GD.l); p.o(x, 15, 8, 4, WD.m, WD.d); p.p(x + 4, 17, GD.l); }
    p.o(0, 6, 32, 5, WD.l, WD.o); p.r(1, 7, 30, 1, WD.h);
    p.r(4, 4, 9, 3, "#2a1030"); p.r(4, 4, 9, 1, "#4a2050"); p.gp(6, 5, "#ff6080"); p.gp(8, 5, "#60e0ff"); p.gp(10, 5, "#80ff90"); p.gp(11, 6, "#ffe080");
    p.r(17, 0, 1, 6, GD.d); p.r(15, -1, 5, 1, GD.m); p.r(14, 0, 1, 3, GD.m); p.r(20, 0, 1, 3, GD.m); p.r(15, 3, 5, 1, GD.m); p.r(15, 0, 5, 3, "#b8dce8"); p.p(16, 0, "#e8f8ff");
    p.r(24, 1, 1, 5, GD.d); p.r(21, 2, 7, 1, GD.m); p.r(21, 3, 1, 2, GD.d); p.r(27, 3, 1, 2, GD.d); p.r(20, 5, 3, 1, GD.l); p.r(26, 5, 3, 1, GD.l);
  }),
  trophy: (v, _alt, M) => M(18, 15, (p) => {
    p.r(6, 6, 6, 8, WD.o); p.r(5, 7, 8, 5, WD.o); p.r(6, 7, 6, 6, WD.m); p.r(6, 7, 6, 1, WD.h);
    if (v & 1) { p.o(6, 3, 6, 7, BN.l, OUT); p.r(7, 4, 4, 1, "#f0e8d8"); p.p(7, 6, OUT); p.p(10, 6, OUT); p.r(8, 8, 2, 1, BN.d); p.line(5, 5, 1, 1, BN.m); p.line(12, 5, 16, 1, BN.m); p.p(1, 0, BN.l); p.p(16, 0, BN.l); }
    else { p.r(8, 5, 2, 4, BN.m); for (const s of [-1, 1]) { p.line(9 + s, 5, 9 + s * 6, 1, BN.l); p.line(9 + s * 4, 2, 9 + s * 4, 0, BN.l); p.line(9 + s * 6, 1, 9 + s * 8, 0, BN.l); p.p(9 + s * 2, 3, BN.d); } }
  }),
  crownplaque: (_v, _alt, M) => M(14, 12, (p) => {
    p.o(1, 1, 12, 10, WD.m, WD.o); p.r(2, 2, 10, 1, WD.h);
    p.r(3, 6, 8, 3, "#a8b0b8"); p.r(3, 6, 8, 1, "#d8e0e8"); p.p(3, 5, "#c8d0d8"); p.r(6, 4, 2, 2, "#c8d0d8"); p.p(10, 5, "#c8d0d8"); p.p(5, 7, "#6a7078"); p.p(8, 7, "#6a7078");
    p.p(2, 3, IR.h); p.p(11, 3, IR.h); p.p(2, 9, IR.h); p.p(11, 9, IR.h);
  }),
  cellarhatch: (_v, _alt, M) => M(30, 18, (p) => {
    p.o(0, 1, 30, 16, WD.d, WD.o);
    for (const x of [2, 16]) { p.r(x, 3, 12, 12, WD.m); p.r(x, 3, 12, 1, WD.l); for (let i = 3; i < 12; i += 3) p.r(x + i, 3, 1, 12, WD.d); p.r(x, 5, 12, 1, IR.m); p.r(x, 12, 12, 1, IR.m); }
    p.r(11, 8, 3, 3, IR.h); p.p(12, 9, WD.o); p.r(16, 8, 3, 3, IR.h); p.p(17, 9, WD.o);
    p.r(5, 3, 4, 12, "rgba(216,200,160,0.3)"); p.r(21, 3, 4, 12, "rgba(216,200,160,0.3)");
  }),
  questboard: (_v, _alt, M) => M(40, 18, (p, r) => {
    p.o(0, 0, 40, 17, "#8a6a44", WD.o); p.r(1, 1, 38, 1, "#b08a5a"); p.r(2, 2, 36, 13, "#a08258"); p.r(0, 17, 40, 1, "rgba(0,0,0,0.3)");
    for (let i = 0; i < 9; i++) {
      const x = 3 + i * 4 + ((r() * 2) | 0), y = 3 + ((r() * 5) | 0), w = 4 + ((r() * 2) | 0), h = 5 + ((r() * 3) | 0);
      p.r(x, y, w, Math.min(h, 14 - y), i === 7 ? "#c8b070" : ["#e8e0c8", "#d8d0b8", "#f0ead8"][i % 3]);
      p.r(x + 1, y + 2, w - 2, 1, "#6a6458"); if (h > 5) p.r(x + 1, y + 4, w - 3, 1, "#6a6458");
      p.p(x + (w >> 1), y, i % 3 === 0 ? "#c83040" : IR.h); if (i % 4 === 1) p.p(x + w - 1, y + Math.min(h, 14 - y) - 1, "#a83a34");
    }
    p.r(15, 1, 10, 2, WD.d); p.r(17, 1, 6, 1, GD.m);
  }),
};

