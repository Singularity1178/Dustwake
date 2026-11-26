// Gear slot silhouettes: the faint outline an EMPTY slot shows in the pack's
// paper-doll, so a bare slot still says what it takes. One per gear kind
// (content/gear.ts). The back slot is the body seen from behind, straps over the
// shoulders and a mounting plate between them: it names the place, not any one
// thing worn there (a basket today; packs, quivers or cloaks later).
// Presentation only. 16x16, a single neutral tone (the pack dims it).
import type { GearKind } from "../content/gear";
import { makeSprite, Sprite, Pen } from "../util";
import { cached } from "./common";

const T = "#9a94a4";
const D = "#5a5462";

export type SlotArt = (p: Pen) => void;

/** The body from behind: a neck, sloped shoulders, a torso. [x0, x1] per row from y = 1. */
const BACK_VIEW: readonly (readonly [number, number])[] = [
  [6, 9], [4, 11], [2, 13], [2, 13], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12],
];
/** Fills the rows in the pale tone and rings them with the dark one. */
function silhouette(p: Pen, rows: readonly (readonly [number, number])[]) {
  const inside = (x: number, y: number) => { const r = rows[y - 1]; return !!r && x >= r[0] && x <= r[1]; };
  for (let y = 0; y <= rows.length + 1; y++) for (let x = 0; x < 16; x++)
    if (!inside(x, y) && (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))) p.p(x, y, D);
  rows.forEach(([a, b], i) => p.r(a, i + 1, b - a + 1, 1, T));
}

export const SLOT_ART: Record<GearKind, SlotArt> = {
  head: (p) => {
    p.o(3, 2, 10, 5, T, D); p.o(2, 6, 12, 8, T, D);
    p.r(4, 9, 8, 2, D); p.r(7, 9, 2, 5, D);
  },
  arm: (p) => {
    p.o(3, 1, 5, 7, T, D); p.o(3, 7, 9, 5, T, D); p.o(10, 6, 5, 7, T, D);
    p.r(11, 8, 3, 1, D);
  },
  core: (p) => {
    p.r(6, 1, 4, 1, D); p.o(4, 2, 8, 3, T, D); p.o(3, 4, 10, 6, T, D); p.o(4, 9, 8, 3, T, D); p.r(6, 12, 4, 2, D);
    p.r(7, 5, 2, 4, D);
  },
  rune: (p) => {
    p.o(3, 1, 10, 14, T, D);
    p.r(5, 4, 1, 8, D); p.r(10, 4, 1, 8, D); p.r(6, 4, 4, 1, D); p.r(6, 11, 4, 1, D); p.r(7, 7, 2, 2, D);
  },
  back: (p) => {
    silhouette(p, BACK_VIEW);
    p.r(5, 3, 1, 11, D); p.r(10, 3, 1, 11, D); // straps
    p.o(6, 7, 4, 5, T, D);                     // mounting plate
  },
};

export function slotIcon(kind: GearKind): Sprite {
  return cached("slot" + kind, () => makeSprite(16, 16, 8, 15, 5, (p) => SLOT_ART[kind](p)));
}
