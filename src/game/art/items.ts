// Item icons: the ITEM_ART registry (item id -> 16x16 draw function), the
// cached icon lookup, and glyph patterns (also drawn on lit pedestals).
// Presentation only.
import type { ItemId } from "../content/items";
import { GLYPHS } from "../content/glyphs";
import { makeSprite, Sprite, Pen } from "../util";
import { S, WD, IR, GD } from "./palette";
import { cached } from "./common";

export function glyphPattern(p: Pen, gi: number, x: number, y: number, color: string, glow: boolean) {
  const pat = GLYPHS[gi].pat;
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (pat[j][i] === "#") glow ? p.g(x + i, y + j, 1, 1, color) : p.p(x + i, y + j, color);
}

/** Draws one 16x16 item icon. */
export type ItemArt = (p: Pen) => void;

/**
 * The ruby ramp, shared by the High-Grade Ruby, the crown's main stone (the same
 * gem, still set) and the Ruby Golem Core carved from it.
 */
const RB = { o: "#2a0610", d: "#5c0d1f", m: "#8e1530", l: "#c0233f", h: "#e5566b", s: "#ffb0ba" };

/** An outlined box with its corners clipped (round-ish at icon size). */
function rbox(p: Pen, x: number, y: number, w: number, h: number, fill: string, line: string) {
  p.r(x + 1, y, w - 2, h, line); p.r(x, y + 1, w, h - 2, line);
  p.r(x + 1, y + 1, w - 2, h - 2, fill);
}

const glyphIcon = (gi: number): ItemArt => (p) => {
  const g = GLYPHS[gi];
  p.o(2, 3, 12, 12, "#4a4552", S.o); p.r(3, 4, 10, 2, "#6a6372"); p.r(3, 12, 10, 2, "#2e2a33");
  glyphPattern(p, gi, 4, 5, g.color, true);
};

/** Item icon registry: item id -> draw function. Adding an item = adding an entry. */
export const ITEM_ART: Record<ItemId, ItemArt> = {
  // A big brilliant-cut stone: a bright table, crown facets lit from the top left, a dark girdle,
  // and a pavilion narrowing to the culet. One glint glows, so it catches the eye on the ground.
  large_ruby: (p) => {
    p.r(5, 3, 6, 1, RB.o);
    p.r(4, 4, 8, 1, RB.o); p.r(5, 4, 6, 1, RB.h); p.r(5, 4, 2, 1, RB.s);
    p.r(3, 5, 10, 1, RB.o); p.r(4, 5, 1, 1, RB.l); p.r(5, 5, 6, 1, RB.h); p.r(11, 5, 1, 1, RB.m); p.p(6, 5, RB.s);
    p.r(2, 6, 12, 1, RB.o); p.r(3, 6, 4, 1, RB.l); p.r(7, 6, 3, 1, RB.m); p.r(10, 6, 3, 1, RB.d);
    p.r(2, 7, 12, 1, RB.o); p.r(3, 7, 10, 1, RB.d);
    for (let j = 0; j < 5; j++) {
      const y = 8 + j, x0 = 3 + j, w = 10 - 2 * j;
      p.r(x0, y, w, 1, RB.o);
      if (w > 2) { p.r(x0 + 1, y, w - 2, 1, RB.m); p.r(x0 + 1, y, Math.max(1, (w - 2) >> 1), 1, RB.l); p.p(x0 + w - 2, y, RB.d); }
    }
    p.p(8, 9, RB.d); p.p(8, 10, RB.d);
    p.gp(6, 4, "#fff0f2");
  },
  // The same stone carved down to a rune-cut dome, set in a plain iron collar with a bayonet lug each side and
  // a socket pin: a mass-made part, one tier notch, a modest glow. (The aether core is a free crystal, all light.)
  ruby_core: (p) => {
    p.o(1, 7, 3, 3, IR.d, "#14161a"); p.o(12, 7, 3, 3, IR.d, "#14161a");
    p.r(7, 13, 2, 2, "#14161a"); p.p(7, 13, IR.m);
    rbox(p, 3, 3, 10, 11, IR.m, "#14161a");
    p.r(4, 4, 8, 1, IR.l); p.r(4, 12, 8, 1, IR.d); p.r(11, 5, 1, 7, IR.d);
    p.p(5, 4, IR.h);
    rbox(p, 5, 5, 6, 7, RB.m, RB.o);
    p.r(6, 6, 2, 1, RB.h); p.p(6, 7, RB.l); p.r(9, 7, 1, 4, RB.d);
    p.p(7, 8, RB.o); p.p(8, 9, RB.o); p.p(7, 10, RB.o); // the carved rune
    p.g(7, 7, 2, 1, "#d8344e"); p.g(8, 8, 1, 1, "#ff8090"); p.g(6, 9, 1, 2, "#b02040");
  },
  chisel: (p) => {
    p.r(3, 11, 6, 3, "#14100c"); p.r(4, 12, 4, 1, WD.l);
    p.line(4, 12, 10, 6, WD.m); p.line(5, 12, 11, 6, WD.l);
    p.line(10, 6, 13, 3, IR.l); p.line(11, 6, 14, 3, IR.h); p.p(14, 2, "#e0e8f0");
    p.r(9, 6, 2, 2, IR.d);
  },
  arm: (p) => {
    p.o(5, 0, 6, 5, IR.m, "#14161a"); p.p(6, 1, IR.h); p.p(9, 1, IR.h);
    p.o(6, 4, 4, 6, IR.l, "#14161a"); p.p(7, 6, IR.h);
    p.o(5, 9, 6, 3, IR.d, "#14161a");
    p.o(4, 11, 8, 5, IR.m, "#14161a"); p.r(5, 12, 2, 2, IR.h); p.r(9, 14, 2, 1, IR.d);
    p.p(8, 2, "#c06020"); p.p(7, 7, "#c06020");
  },
  key: (p) => {
    p.o(2, 3, 6, 6, "#7a5a34", "#2a1a0c"); p.r(4, 5, 2, 2, "#2a1a0c");
    p.r(7, 5, 7, 2, "#8a6a3a"); p.r(7, 5, 7, 1, "#a8844a");
    p.r(11, 7, 1, 3, "#7a5a34"); p.r(13, 7, 1, 2, "#7a5a34"); p.p(9, 6, "#4a3418");
  },
  core: (p) => {
    p.r(5, 13, 6, 2, "#1a1a28");
    p.g(7, 2, 2, 1, "#c0ffff"); p.g(6, 3, 4, 2, "#60e0ff"); p.g(5, 5, 6, 4, "#30a8e8"); p.g(6, 9, 4, 2, "#2080c0"); p.g(7, 11, 2, 2, "#1860a0");
    p.g(7, 4, 1, 4, "#e0ffff"); p.g(9, 6, 1, 2, "#a0f0ff");
  },
  schematic: (p) => {
    p.o(1, 4, 14, 8, "#2a4a7a", "#0e1a2e"); p.r(2, 5, 12, 2, "#3a5a9a");
    p.r(0, 4, 2, 8, "#d0d8e8"); p.r(14, 4, 2, 8, "#d0d8e8"); p.r(0, 4, 1, 8, "#8a98b0");
    p.r(4, 8, 7, 1, "#8aa8d8"); p.r(4, 10, 5, 1, "#8aa8d8"); p.r(7, 7, 1, 4, "#8aa8d8");
    p.r(6, 3, 4, 10, "#6a2020"); p.r(6, 3, 4, 1, "#8a3030");
  },
  // The broken crown: its main stone is the High-Grade Ruby (same ramp, still set), a small sapphire beside it,
  // an empty setting, one point snapped short and a crack through the band.
  crown: (p) => {
    const O = "#3a2a08";
    for (const [x, top] of [[2, 6], [7, 4], [12, 8]] as const) { p.r(x - 1, top - 1, 4, 11 - top + 1, O); p.r(x, top, 2, 11 - top, GD.m); p.p(x, top, GD.l); }
    p.p(13, 7, O); p.p(12, 8, GD.d); // the snapped point
    p.r(1, 9, 14, 6, O); p.r(2, 10, 12, 4, GD.m); p.r(2, 10, 12, 1, GD.l); p.r(2, 13, 12, 1, GD.d);
    p.r(6, 9, 4, 5, RB.o); p.r(7, 10, 2, 3, RB.m); p.p(7, 10, RB.h); p.p(8, 12, RB.d); p.p(7, 11, RB.l);
    p.r(3, 11, 2, 2, "#1a2a70"); p.p(3, 11, "#4a70e0");
    p.r(11, 11, 2, 2, "#2a1e06");
    p.line(10, 10, 12, 13, O);
    p.gp(7, 10, "#ffd8de");
  },
  goblet: (p) => {
    p.o(4, 2, 8, 6, IR.l, "#2a2e34"); p.r(5, 3, 2, 3, IR.h);
    p.r(7, 8, 2, 4, IR.m); p.o(4, 12, 8, 3, IR.l, "#2a2e34");
  },
  coin: (p) => {
    p.o(5, 7, 7, 7, GD.m, "#3a2a08"); p.r(6, 8, 2, 2, GD.l); p.r(8, 10, 2, 2, GD.d);
  },
  glyph0: glyphIcon(0), glyph1: glyphIcon(1), glyph2: glyphIcon(2), glyph3: glyphIcon(3),
  wood: (p) => {
    // two stacked logs
    for (const [x, y] of [[2, 9], [5, 5]] as [number, number][]) {
      p.o(x, y, 10, 5, WD.m, WD.o); p.r(x + 1, y + 1, 8, 1, WD.l);
      p.o(x + 8, y, 4, 5, "#b08a5a", WD.o); p.p(x + 9, y + 2, WD.d);
    }
  },
  stone: (p) => {
    p.o(2, 8, 7, 6, S.m, S.o); p.r(3, 9, 3, 1, S.h); p.r(3, 12, 5, 1, S.d);
    p.o(7, 5, 7, 8, S.l, S.o); p.r(8, 6, 3, 1, S.h); p.r(12, 7, 1, 5, S.d);
  },
  book_build: (p) => {
    p.o(2, 4, 12, 10, "#6a4a24", "#1a1008"); p.r(3, 5, 10, 1, "#8a6a34"); p.r(2, 12, 12, 2, "#d8ccb0"); p.r(3, 12, 10, 1, "#b8ac90");
    p.r(6, 7, 4, 1, GD.m); p.r(7, 8, 2, 3, GD.m); // hammer sigil
  },
  book_repair: (p) => {
    p.o(2, 4, 12, 10, "#2a4a5a", "#08141a"); p.r(3, 5, 10, 1, "#3a6a7a"); p.r(2, 12, 12, 2, "#d8ccb0"); p.r(3, 12, 10, 1, "#b8ac90");
    p.r(7, 6, 2, 5, "#a8c8d0"); p.r(5, 8, 6, 1, "#a8c8d0"); // mending cross
  },
  // Processed materials.
  planks: (p) => {
    // three sawn boards, stacked and offset
    for (const [x, y, w] of [[1, 9, 13], [3, 6, 12], [2, 3, 12]] as [number, number, number][]) {
      p.o(x, y, w, 4, "#b08a5a", WD.o); p.r(x + 1, y + 1, w - 2, 1, "#c8a470");
      p.p(x + 3, y + 2, WD.m); p.p(x + 8, y + 2, WD.m); p.r(x + w - 3, y + 1, 1, 2, "#8a6a40");
    }
  },
  cut_stone: (p) => {
    // two squared blocks with chisel marks
    p.o(1, 8, 8, 6, S.l, S.o); p.r(2, 9, 6, 1, S.h); p.r(2, 12, 6, 1, S.d); p.r(8, 9, 1, 4, S.d);
    p.o(7, 4, 8, 7, S.m, S.o); p.r(8, 5, 6, 1, S.h); p.r(8, 9, 6, 1, S.d); p.p(10, 7, S.d); p.p(12, 7, S.d);
    p.p(3, 10, S.m); p.p(5, 11, S.m);
  },
  // Runes: a squared tablet with a glowing sigil (the same 3x3 sigil the golem wears: ItemDef.worn.mark).
  rune_swift: (p) => {
    p.o(3, 1, 10, 14, "#4a4552", S.o); p.r(4, 2, 8, 2, "#6a6372"); p.r(4, 12, 8, 2, "#2e2a33");
    // two chevrons, ">>"
    for (const x of [5, 9]) { p.g(x, 5, 2, 1, "#5cf0c8"); p.g(x + 1, 6, 2, 1, "#5cf0c8"); p.g(x + 1, 7, 2, 1, "#5cf0c8"); p.g(x, 8, 2, 1, "#5cf0c8"); p.g(x + 1, 9, 1, 1, "#5cf0c8"); }
    p.g(4, 10, 8, 1, "#2a9a80");
  },
  rune_glow: (p) => {
    p.o(3, 1, 10, 14, "#4a4552", S.o); p.r(4, 2, 8, 2, "#6a6372"); p.r(4, 12, 8, 2, "#2e2a33");
    // a sun: a bright core with four rays
    p.g(7, 5, 2, 6, "#ffffff"); p.g(5, 7, 6, 2, "#ffffff"); p.g(6, 6, 4, 4, "#fff8d8");
    p.g(7, 4, 2, 1, "#c8d8ff"); p.g(7, 11, 2, 1, "#c8d8ff"); p.g(4, 7, 1, 2, "#c8d8ff"); p.g(11, 7, 1, 2, "#c8d8ff");
  },
  basket: (p) => {
    p.r(4, 2, 8, 1, WD.d); p.r(3, 3, 1, 4, WD.d); p.r(12, 3, 1, 4, WD.d);
    p.o(2, 6, 12, 9, "#a8844a", WD.o);
    for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) if ((x + y * 2) % 4 === 0) p.p(x, y, "#7a5a30");
    p.r(3, 7, 10, 1, "#c8a466");
  },
};

export function itemIcon(id: ItemId): Sprite {
  return cached("item" + id, () => makeSprite(16, 16, 8, 15, 3, (p) => ITEM_ART[id](p)));
}
