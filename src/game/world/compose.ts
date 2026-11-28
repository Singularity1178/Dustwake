// The area compositor: one large, continuous area put together from sites.
// Pure and deterministic (no DOM).
//
// A site is an ordinary area builder (town.ts, surface.ts, oldRoad.ts): it lays
// out its own ground in its own coordinates, as if it were alone in the world.
// `composeArea` sets each one down at its place in a bigger grid and translates
// everything it made: tiles, props, lights, decals, loose items, portals,
// spots, rooms. Each site becomes a zone (world/zones.ts) that remembers the
// site's origin, so anything authored against a site (a census row's "door.watch",
// the lamplighter's "east of x = 720") is still said in the site's own terms.
//
// Why compose instead of authoring one huge map: sites stay small enough to
// author, test and bake on their own; a hard-coded position can only ever be
// local to its site; and the overworld grows by adding rows to a table, not by
// renumbering everything that already stands.
//
// Ids. Prop, loose-item, light and portal ids must be unique in an area, and
// two sites will both have a `bush@10,12`. Each site therefore has an id prefix
// (`westwake/`); spot ids are left as the builder wrote them and carry their
// zone instead, because the people's code reads them by prefix and by kind.
import { TS, T, FS } from "../content/tiles";
import { propDef } from "../content/props";
import { hash2 } from "../core/rng";
import type { AreaData, DecalDef, LightDef, LooseItem, NpcSpawn, Portal, PropDef, Room, Spot, Zone } from "../map";

export interface SiteDef {
  /** The zone this site becomes. */
  zone: string;
  /** What the game calls the place ("WESTWAKE"). */
  name: string;
  kind: Zone["kind"];
  /** Where the site's (0, 0) goes, in tiles of the composed area. */
  at: { x: number; y: number };
  build: () => AreaData;
  /** Prefix for the ids of everything the builder made ("" keeps them bare). */
  ids: string;
  /** Simulation: wake as a whole when the player nears any part of it, or only what is near (default by kind). */
  wake?: Zone["wake"];
  /** Shown when the player walks in. */
  label?: string;
  /** Where "go to <zone>" arrives, in the site's own px. Default: the builder's `start`. */
  anchor?: { x: number; y: number };
  /** Portals of the builder that led to what is now a neighbouring site: the ground is continuous, so they go. */
  dropPortals?: readonly string[];
}

/** Tiles forced open after the sites are down (where two sites' roads meet through what was a map edge). */
export interface Seam { x: number; y: number; w: number; h: number; style: number }

export interface ComposeDef {
  id: string;
  w: number; h: number;
  sites: readonly SiteDef[];
  seams?: readonly Seam[];
  /** The zone whose `start` is the area's. */
  start: string;
  ambient?: [number, number, number];
}

export function composeArea(def: ComposeDef): AreaData {
  const W = def.w, H = def.h, n = W * H;
  const grid = new Uint8Array(n).fill(T.FLOOR), plan = new Uint8Array(n).fill(T.FLOOR), style = new Uint8Array(n), tvar = new Uint8Array(n);
  const covered = new Uint8Array(n);
  // ground no site covers: plain meadow, so the land between and beyond sites is simply there to walk on
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const h = hash2(x >> 2, y >> 2, 911);
    style[y * W + x] = h > 0.86 ? FS.DIRT : h < 0.12 ? FS.MOSS : FS.GRASS;
  }
  const props: PropDef[] = [], lights: LightDef[] = [], decals: DecalDef[] = [], loose: LooseItem[] = [];
  const portals: Portal[] = [], spots: Spot[] = [], rooms: Room[] = [], npcs: NpcSpawn[] = [], drips: { x: number; y: number }[] = [];
  const zones: Zone[] = [], ids = new Set<string>();
  let start: { x: number; y: number } | null = null;

  for (const s of def.sites) {
    const d = s.build(), ox = s.at.x, oy = s.at.y, px = ox * TS, py = oy * TS;
    if (ox < 0 || oy < 0 || ox + d.w > W || oy + d.h > H) throw new Error(`site "${s.zone}" does not fit in "${def.id}"`);
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      const i = y * d.w + x, j = (y + oy) * W + x + ox;
      if (covered[j]) throw new Error(`site "${s.zone}" overlaps another at ${x + ox},${y + oy}`);
      covered[j] = 1;
      grid[j] = d.grid[i]; plan[j] = d.plan[i]; style[j] = d.style[i]; tvar[j] = d.tvar[i];
    }
    const pid = (id: string) => s.ids + id;
    for (const p of d.props) {
      const id = pid(p.id);
      if (ids.has(id)) throw new Error(`duplicate prop id "${id}" in "${def.id}"`);
      ids.add(id);
      props.push({ ...p, id, x: p.x + px, y: p.y + py });
    }
    for (const l of d.lights) {
      const out: LightDef = { ...l, x: l.x + px, y: l.y + py };
      if (l.owner !== undefined) out.owner = pid(l.owner);
      if (l.id !== undefined) out.id = pid(l.id);
      lights.push(out);
    }
    for (const c of d.decals) decals.push({ ...c, x: c.x + px, y: c.y + py });
    for (const l of d.loose) loose.push({ ...l, id: pid(l.id), x: l.x + px, y: l.y + py });
    for (const p of d.portals ?? []) {
      if (s.dropPortals?.includes(p.id)) continue;
      const out: Portal = { ...p, id: pid(p.id), x: p.x + px, y: p.y + py };
      if (p.arrive) out.arrive = { x: p.arrive.x + px, y: p.arrive.y + py };
      portals.push(out);
    }
    for (const sp of d.spots ?? []) spots.push({ ...sp, x: sp.x + px, y: sp.y + py, zone: s.zone });
    for (const r of d.rooms) rooms.push({ ...r, x: r.x + ox, y: r.y + oy });
    for (const c of d.npcs ?? []) npcs.push({ ...c, x: c.x + px, y: c.y + py });
    for (const c of d.drips) drips.push({ x: c.x + px, y: c.y + py });
    const anchor = s.anchor ?? d.start;
    zones.push({
      id: s.zone, name: s.name, kind: s.kind, wake: s.wake ?? (s.kind === "settlement" ? "whole" : "bubble"),
      x: ox, y: oy, w: d.w, h: d.h, ox: px, oy: py, anchor: { x: anchor.x + px, y: anchor.y + py },
      ...(d.tended ? { tended: true } : {}), ...(s.label ? { label: s.label } : {}), ids: s.ids,
    });
    if (s.zone === def.start) start = { x: d.start.x + px, y: d.start.y + py };
  }
  if (!start) throw new Error(`"${def.id}" has no site "${def.start}" to start in`);

  // seams: open ground where one site's road runs into the next through what used to be the edge of a map
  for (const m of def.seams ?? []) {
    for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      grid[j] = T.FLOOR; plan[j] = T.FLOOR; style[j] = m.style;
    }
    const x0 = m.x * TS, y0 = m.y * TS, x1 = (m.x + m.w) * TS, y1 = (m.y + m.h) * TS;
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i], b = propDef(p.kind).box;
      if (b && p.x + b[0] / 2 > x0 && p.x - b[0] / 2 < x1 && p.y > y0 && p.y - b[1] < y1) props.splice(i, 1);
    }
  }

  return {
    id: def.id, w: W, h: H, grid, plan, style, tvar, rooms, props, decals, lights, loose,
    start, exits: [], drips, outdoor: true, ambient: def.ambient, portals, spots, zones,
    ...(npcs.length ? { npcs } : {}),
  };
}
