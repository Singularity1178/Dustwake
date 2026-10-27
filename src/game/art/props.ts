// Prop sprites: the PROP_ART registry (kind -> draw function) and the cached
// lookup the renderer and the build menu use. The draw functions live with the
// rest of their family: art/propsSurface.ts (the wilds above) and
// art/propsDungeon.ts (the halls below). Presentation only.
import { makeSprite, Sprite, Pen, Rng } from "../util";
import { spriteCache, type PropArt } from "./common";
import { SURFACE_PROP_ART } from "./propsSurface";
import { DUNGEON_PROP_ART } from "./propsDungeon";
import { propDef } from "../content/props";
export type { PropArt } from "./common";

export function propSprite(kind: string, v: number, alt: boolean): Sprite | null {
  kind = propDef(kind).art ?? kind;
  const key = `${kind}|${v}|${alt}`;
  const c = spriteCache.get(key);
  if (c) return c;
  const s = makeProp(kind, v, alt);
  if (s) spriteCache.set(key, s);
  return s;
}

/** Prop sprite registry: kind -> draw function. Adding a prop kind = adding an entry (surface kinds first, then dungeon). */
export const PROP_ART: Record<string, PropArt> = { ...SURFACE_PROP_ART, ...DUNGEON_PROP_ART };

function makeProp(kind: string, v: number, alt: boolean): Sprite | null {
  const seed = kind.length * 101 + v * 13 + (alt ? 7 : 0);
  const M = (w: number, h: number, fn: (p: Pen, r: Rng) => void, ay = h) => makeSprite(w, h, Math.floor(w / 2), ay, seed, fn);
  const art = PROP_ART[kind];
  return art ? art(v, alt, M) : null;
}
