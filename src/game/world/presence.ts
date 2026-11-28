// Who is where, as lists built once per tick (pure; no DOM).
//
// `World.actors` is one flat array. With a few dozen actors every system could
// afford to walk all of it for every question ("whose bodies block this step",
// "who else is in this street"); with hundreds of residents across many
// settlements that is quadratic. These lists are derived once per tick (and
// again whenever someone changes area, or an actor is added) and shared:
//
//   solidActors(w)   the bodies that block movement (golems, workers, NPCs);
//                    townsfolk and keepers are soft and never in it.
//   actorsIn(w, id)  everyone in an area, in `World.actors` order.
//
// The lists are caches, never state: nothing is saved, and the order within
// each is the order of `World.actors`, so results are the same as walking the
// whole array.
import type { Actor, World } from "./world";

interface Cache { actors: Actor[]; time: number; n: number; epoch: number; solid: Actor[]; byArea: Map<string, Actor[]> }
const caches = new WeakMap<World, Cache>();
const EMPTY: readonly Actor[] = [];
let epoch = 0;

/** Someone changed area by a way the lists cannot see for themselves (call after setting `actor.area`). */
export const presenceChanged = () => { epoch++; };

function cacheOf(w: World): Cache {
  let c = caches.get(w);
  if (c && c.actors === w.actors && c.time === w.time && c.n === w.actors.length && c.epoch === epoch) return c;
  const solid: Actor[] = [], byArea = new Map<string, Actor[]>();
  for (const a of w.actors) {
    if (a.kind !== "folk" && a.kind !== "keeper") solid.push(a);
    const list = byArea.get(a.area);
    if (list) list.push(a); else byArea.set(a.area, [a]);
  }
  c = { actors: w.actors, time: w.time, n: w.actors.length, epoch, solid, byArea };
  caches.set(w, c);
  return c;
}

/** Actors with a body that blocks (sim/collision.ts: actorBox), in every area. Callers filter by area. */
export const solidActors = (w: World): readonly Actor[] => cacheOf(w).solid;
/** The actors in an area. Always re-check `actor.area` when it matters: someone may have left since the list was made. */
export const actorsIn = (w: World, area: string): readonly Actor[] => cacheOf(w).byArea.get(area) ?? EMPTY;
