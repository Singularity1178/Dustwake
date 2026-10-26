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

const glyphIcon = (gi: number): ItemArt => (p) => {
  const g = GLYPHS[gi];
  p.o(2, 3, 12, 12, "#4a4552", S.o); p.r(3, 4, 10, 2, "#6a6372"); p.r(3, 12, 10, 2, "#2e2a33");
  glyphPattern(p, gi, 4, 5, g.color, true);
};

/** Item icon registry: item id -> draw function. Adding an item = adding an entry. */
export const ITEM_ART: Record<ItemId, ItemArt> = {
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
  crown: (p) => {
    p.r(2, 11, 12, 3, GD.m); p.r(2, 13, 12, 1, GD.d); p.r(2, 11, 12, 1, GD.l);
    for (const x of [2, 7, 12]) { p.r(x, 6, 2, 5, GD.m); p.p(x, 6, GD.l); }
    p.r(4, 9, 3, 2, GD.d); p.p(7, 12, "#c02030"); p.p(4, 12, "#2040c0");
    p.r(10, 7, 2, 3, "rgba(0,0,0,0)"); p.line(9, 11, 11, 13, "#3a2a08");
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
