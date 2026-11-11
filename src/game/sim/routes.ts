// Getting from one area to another, for any body that walks under an order. Two kinds of way lead out of an area:
// a rune (channelled: sim/runes.ts, only a lit rune whose far end answers) and a portal (walked: sim/portals.ts, a
// road, a door, the dug-out stair, shut while its flag is unset). A route is derived afresh from both every time it
// is asked for, so an order only ever saves where it is going. Pure sim.
import { capable } from "../content/actors";
import type { AreaData, Portal } from "../map";
import { AREAS } from "../world/areas";
import type { World } from "../world/world";
import { portalOpen, portalsOf } from "./portals";
import { runeWays } from "./runes";

/** One leg of a route: through rune `from` to rune `to`, or on foot through `portal` of the area it starts in. `area` is where it comes out. */
export type Hop =
  | { via: "rune"; from: string; to: string; area: string }
  | { via: "portal"; portal: string; area: string };

/** How a body may travel: runes take the `travel` capability, portals only `move` (they are just walking). */
export interface Means { runes: boolean; portals: boolean }
export const meansOf = (a: { definition: string }): Means => ({ runes: capable(a, "travel"), portals: capable(a, "move") });

interface Base { build: () => AreaData; portals: readonly Portal[]; start: { x: number; y: number } }
const bases = new Map<string, Base>();
/**
 * What routing needs of an area nobody has visited yet (its portals, its start), read once from its pure,
 * deterministic builder and kept per builder, as the debug menu reads a start. Nothing is instantiated.
 */
export function areaBase(id: string): Base | null {
  const build = AREAS[id];
  if (!build) return null;
  let b = bases.get(id);
  if (!b || b.build !== build) { const d = build(); bases.set(id, (b = { build, portals: d.portals ?? [], start: d.start })); }
  return b;
}
/** An area's portals: the live area's once it has been visited, else its builder's. */
export function areaPortals(w: World, id: string): readonly Portal[] {
  const live = w.areas.get(id);
  return live ? portalsOf(live) : areaBase(id)?.portals ?? [];
}

const hopKey = (h: Hop) => (h.via === "rune" ? `r:${h.from}>${h.to}` : `p:${h.portal}`);

/** The ways out of an area for a body with these means, in a stable order: runes (by id), then open portals (by id). */
function waysOut(w: World, means: Means, area: string, awake: string): { hop: Hop; awake: string }[] {
  const out: { hop: Hop; awake: string }[] = [];
  if (means.runes) for (const r of runeWays(w, area, awake)) out.push({ hop: { via: "rune", from: r.from.id, to: r.to.id, area: r.to.area }, awake: r.woke });
  if (means.portals) for (const p of [...areaPortals(w, area)].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (p.to.area !== area && AREAS[p.to.area] && portalOpen(w, p)) out.push({ hop: { via: "portal", portal: p.id, area: p.to.area }, awake: "" });
  }
  return out;
}

/**
 * Every way to set out from `from` toward `to` along a route of the fewest hops, in a stable order (runes before
 * portals). Empty: already there, or there is no way. Several come back where the route forks at once: the halls
 * and the surface are joined by the rune and by the stair, and whoever walks it picks between them (sim/jobs.ts).
 * A breadth-first search over areas; a rune woken on the way counts as lit for the hop out of it, as for runeRoute.
 */
export function firstHops(w: World, means: Means, from: string, to: string): Hop[] {
  if (from === to || !AREAS[to]) return [];
  type Stop = { area: string; awake: string; firsts: Hop[] };
  const found: Hop[] = [];
  const add = (list: Hop[], hops: readonly Hop[]) => { for (const h of hops) if (!list.some((x) => hopKey(x) === hopKey(h))) list.push(h); };
  let level = new Map<string, Stop>([[`${from}:`, { area: from, awake: "", firsts: [] }]]);
  const seen = new Set(level.keys());
  while (level.size && !found.length) {
    const next = new Map<string, Stop>();
    for (const s of level.values()) for (const e of waysOut(w, means, s.area, s.awake)) {
      const firsts = s.firsts.length ? s.firsts : [e.hop];
      if (e.hop.area === to) { add(found, firsts); continue; }
      const key = `${e.hop.area}:${e.awake}`;
      if (seen.has(key)) continue;
      const n = next.get(key);
      if (n) add(n.firsts, firsts); else next.set(key, { area: e.hop.area, awake: e.awake, firsts: [...firsts] });
    }
    for (const key of next.keys()) seen.add(key);
    level = next;
  }
  return found;
}

/** Is there any way from `from` to `to` for a body with these means? */
export const routeExists = (w: World, means: Means, from: string, to: string) => from === to || firstHops(w, means, from, to).length > 0;
