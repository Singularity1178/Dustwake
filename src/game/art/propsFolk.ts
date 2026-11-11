// The hunters' camp (content/props.ts: FOLK_PROPS): a ring-stone fire, a hide lean-to, bedrolls, a drying rack
// hung with pelts, a log to sit on. Procedural like every prop; albedo plus glow (p.g) for embers.
import type { Pen, Rng } from "../util";
import { WD } from "./palette";
import type { PropArt } from "./common";

const OUT = "#141016";
const STONE = { d: "#4a4640", m: "#6e685e", l: "#8e877b" };
const HIDE = { d: "#5a3a22", m: "#7e5634", l: "#9e7448", h: "#b88c5c" };
const EMBER = { low: "#8a2a10", mid: "#d8521a", hot: "#ffb050" };
const sh = (p: Pen, x: number, y: number, w: number, h = 3) => p.r(x, y, w, h, "rgba(0,0,0,0.32)");

export const FOLK_PROP_ART: Record<string, PropArt> = {
  // ring of stones round a bed of embers and crossed logs; the flame itself is the host's (drawFlame, fire.dy)
  campfire: (_v, lit, M) => M(20, 12, (p: Pen, r: Rng) => {
    sh(p, 1, 8, 18, 4);
    p.r(4, 5, 12, 5, "#2a1e16");
    if (lit) { p.g(5, 6, 10, 3, EMBER.low); p.g(7, 6, 6, 2, EMBER.mid); p.g(9, 6, 2, 1, EMBER.hot); }
    else { p.r(5, 6, 10, 3, "#3a3430"); p.r(7, 7, 2, 1, "#5a524a"); }
    // crossed logs, charred at the middle
    p.r(4, 4, 6, 2, WD.m); p.r(4, 4, 6, 1, WD.l); p.r(10, 6, 6, 2, WD.m); p.r(10, 6, 6, 1, WD.l);
    p.r(8, 5, 4, 2, "#241a14");
    // stones
    const ring: [number, number][] = [[1, 6], [3, 3], [7, 2], [11, 2], [15, 3], [17, 6], [15, 9], [10, 10], [5, 9]];
    for (const [x, y] of ring) { const k = r(); p.r(x - 1, y - 1, 4, 3, OUT); p.r(x, y - 1, 2, 2, k < 0.5 ? STONE.m : STONE.l); p.r(x, y, 2, 1, STONE.d); }
  }, 10),
  // a hide stretched over a ridge pole, staked at the back; open to the south
  leanto: (_v, _alt, M) => M(32, 24, (p: Pen) => {
    sh(p, 2, 20, 28, 4);
    p.r(3, 3, 1, 19, WD.d); p.r(28, 3, 1, 19, WD.d); p.r(2, 2, 28, 2, WD.m); p.r(2, 2, 28, 1, WD.l);
    for (let y = 4; y < 20; y++) {
      const inset = Math.round((y - 4) * 0.15);
      p.r(3 + inset, y, 26 - inset * 2, 1, y < 8 ? HIDE.l : y < 14 ? HIDE.m : HIDE.d);
    }
    for (let x = 6; x < 27; x += 5) p.r(x, 5, 1, 13, HIDE.d);
    p.r(5, 4, 22, 1, HIDE.h);
    // lacing along the ridge, a dark mouth underneath
    for (let x = 4; x < 28; x += 3) p.p(x, 3, "#2a1a0e");
    p.r(6, 18, 20, 3, "#1e1610"); p.r(4, 21, 24, 1, HIDE.d);
  }),
  // a rolled-out blanket on a fur, pillowed at the north end
  bedroll: (v, _alt, M) => M(14, 22, (p: Pen) => {
    const wool = ["#6a4a3a", "#4a5a3e", "#5a4a6a", "#7a5a32"][v % 4];
    p.r(0, 1, 14, 21, "rgba(0,0,0,0.25)");
    p.r(1, 1, 12, 20, HIDE.d); p.r(2, 2, 10, 18, HIDE.m);
    p.r(2, 2, 10, 4, "#c8b89a"); p.r(3, 3, 8, 2, "#e0d4b8");
    p.r(2, 7, 10, 12, wool); p.r(2, 7, 10, 1, "#00000033"); p.r(2, 10, 10, 1, "rgba(255,255,255,0.12)"); p.r(2, 15, 10, 1, "rgba(255,255,255,0.12)");
  }, 21),
  // two forked uprights and a cross pole hung with stretched pelts
  peltrack: (_v, _alt, M) => M(24, 22, (p: Pen) => {
    sh(p, 2, 19, 20, 3);
    p.r(2, 2, 2, 19, WD.d); p.r(20, 2, 2, 19, WD.d); p.r(1, 1, 22, 2, WD.m); p.r(1, 1, 22, 1, WD.l);
    p.r(1, 0, 1, 2, WD.d); p.r(4, 0, 1, 2, WD.d); p.r(19, 0, 1, 2, WD.d); p.r(22, 0, 1, 2, WD.d);
    const pelt = (x: number, w: number, h: number, c: string) => {
      p.r(x - 1, 3, w + 2, h + 1, OUT); p.r(x, 3, w, h, c); p.r(x + 1, 4, w - 2, 1, "rgba(255,255,255,0.15)");
      p.r(x - 1, 3 + h, 2, 2, c); p.r(x + w - 1, 3 + h, 2, 2, c);
    };
    pelt(5, 6, 9, "#8a6a4a"); pelt(13, 5, 11, "#6a5444");
  }),
  // a log on its side, worn smooth on top
  seatlog: (_v, _alt, M) => M(22, 9, (p: Pen) => {
    sh(p, 1, 6, 20, 3);
    p.r(1, 1, 20, 6, OUT); p.r(2, 2, 18, 4, WD.m); p.r(2, 2, 18, 1, WD.h); p.r(2, 5, 18, 1, WD.d);
    p.r(1, 2, 3, 4, "#a88458"); p.p(2, 3, "#7a5634"); p.r(18, 2, 3, 4, "#a88458"); p.p(19, 4, "#7a5634");
  }),
};
