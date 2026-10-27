// Gear slot silhouettes: the faint outline an EMPTY slot shows in the pack's
// paper-doll, so a bare slot still says what it takes. One per gear kind
// (content/gear.ts); the back slot shows the basket's own icon instead.
// Presentation only. 16x16, a single neutral tone (the pack dims it).
import type { GearKind } from "../content/gear";
import { makeSprite, Sprite, Pen } from "../util";
import { cached } from "./common";

const T = "#9a94a4";
const D = "#5a5462";

export type SlotArt = (p: Pen) => void;

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
    p.r(4, 2, 8, 1, D); p.r(3, 3, 1, 4, D); p.r(12, 3, 1, 4, D);
    p.o(2, 6, 12, 9, T, D);
    for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) if ((x + y * 2) % 4 === 0) p.p(x, y, D);
  },
};

export function slotIcon(kind: GearKind): Sprite {
  return cached("slot" + kind, () => makeSprite(16, 16, 8, 15, 5, (p) => SLOT_ART[kind](p)));
}
