// Shared plumbing for the procedural sprite modules: the one sprite cache every
// sprite family keys into, the registry function types, and the stone blob
// that tile sprites and props both draw. Presentation only.
import { Sprite, Pen, Rng } from "../util";
import { S } from "./palette";

/** One cache for every sprite family (keys are namespaced by family: `kind|v|alt`, `rub..`, `item..`). */
export const spriteCache = new Map<string, Sprite>();
export function cached(key: string, make: () => Sprite) {
  let s = spriteCache.get(key);
  if (!s) { s = make(); spriteCache.set(key, s); }
  return s;
}

/** Draws one prop sprite. `M` makes a sprite with the kind's deterministic seed and anchor. */
export type PropArt = (v: number, alt: boolean, M: SpriteMaker) => Sprite;
export type SpriteMaker = (w: number, h: number, fn: (p: Pen, r: Rng) => void, ay?: number) => Sprite;

/** A shaded, roughly elliptical stone (rubble, broken pillars, boulders, rock piles). */
export function stoneBlob(p: Pen, x: number, y: number, w: number, h: number, r: Rng) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const dx = (i + 0.5 - w / 2) / (w / 2), dy = (j + 0.5 - h / 2) / (h / 2);
      const v = dx * dx + dy * dy;
      if (v > 1.05) continue;
      let c = v > 0.62 ? S.o : dx + dy < -0.5 ? S.h : dx + dy < 0.1 ? S.l : dx + dy < 0.6 ? S.m : S.d;
      if (c !== S.o && r() < 0.06) c = S.d;
      p.p(x + i, y + j, c);
    }
}
