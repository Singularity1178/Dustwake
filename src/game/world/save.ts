// Save / load. A save is plain JSON:
//   - world scalars (seed, rng state, clock, flags, schedule),
//   - actors verbatim (tasks are data, so in-progress work survives),
//   - per area, a *diff* against the area's deterministic builder (changed
//     tiles, prop state, taken loose items, decals appended during play, and
//     feature state such as the ritual).
// Diffs keep saves small and let authored areas evolve between versions as
// long as stable ids are kept. Each schema change bumps SAVE_VERSION and adds a
// migration from the previous version.
import { SeededRng } from "../core/rng";
import type { DecalDef } from "../map";
import type { ItemId } from "../content/items";
import { Area, type RitualState } from "./area";
import { AREAS } from "./areas";
import type { Actor, Scheduled, World } from "./world";

export const SAVE_VERSION = 1;

export interface AreaSaveV1 {
  tiles: [number, number][];
  props: Record<string, { open?: boolean; taken?: boolean; lit?: boolean; item?: ItemId | null }>;
  looseTaken: string[];
  decalsAdded: DecalDef[];
  ritual: RitualState | null;
}

export interface SaveV1 {
  version: 1;
  seed: number;
  rng: number;
  time: number;
  playTime: number;
  flags: string[];
  playerId: string;
  actors: Actor[];
  scheduled: Scheduled[];
  areas: Record<string, AreaSaveV1>;
}

export type SaveData = SaveV1;
type Migration = (s: any) => any;

/** MIGRATIONS[n] upgrades a version-n save to version n+1. */
export const MIGRATIONS: Record<number, Migration> = {};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function serialize(w: World): SaveData {
  const areas: Record<string, AreaSaveV1> = {};
  for (const [id, a] of w.areas) areas[id] = diffArea(a);
  return clone({
    version: SAVE_VERSION, seed: w.seed, rng: w.rng.state, time: w.time, playTime: w.playTime,
    flags: [...w.flags], playerId: w.playerId, actors: w.actors, scheduled: w.scheduled, areas,
  });
}

export function deserialize(raw: unknown, migrations = MIGRATIONS, version = SAVE_VERSION): World {
  const s = migrate(raw, migrations, version) as SaveData;
  const rng = new SeededRng(0);
  rng.state = s.rng >>> 0;
  const w: World = {
    seed: s.seed, rng, time: s.time, playTime: s.playTime, flags: new Set(s.flags),
    areas: new Map(), actors: clone(s.actors), playerId: s.playerId, scheduled: clone(s.scheduled), events: [],
  };
  for (const [id, d] of Object.entries(s.areas)) w.areas.set(id, restoreArea(id, d));
  return w;
}

/** Run migrations until the save reaches `target`. Rejects saves from the future. */
export function migrate(raw: unknown, migrations = MIGRATIONS, target = SAVE_VERSION): unknown {
  let s = clone(raw) as { version?: number };
  if (!s || typeof s.version !== "number") throw new Error("not a Dustwake save");
  if (s.version > target) throw new Error(`save version ${s.version} is newer than supported ${target}`);
  while (s.version! < target) {
    const m = migrations[s.version!];
    if (!m) throw new Error(`no migration from save version ${s.version}`);
    s = m(s);
  }
  return s;
}

function diffArea(a: Area): AreaSaveV1 {
  const base = a.base;
  const tiles: [number, number][] = [];
  for (let i = 0; i < a.grid.length; i++) if (a.grid[i] !== base.grid[i]) tiles.push([i, a.grid[i]]);
  const props: AreaSaveV1["props"] = {};
  const baseProps = new Map(base.props.map((p) => [p.id, p]));
  for (const p of a.props) {
    const b = baseProps.get(p.id)!;
    const d: AreaSaveV1["props"][string] = {};
    if (p.open) d.open = true;
    if (p.taken) d.taken = true;
    if (!!p.lit !== !!b.lit) d.lit = !!p.lit;
    if (p.item !== b.item) d.item = p.item ?? null;
    if (Object.keys(d).length) props[p.id] = d;
  }
  return {
    tiles, props,
    looseTaken: a.loose.filter((l) => l.taken).map((l) => l.id),
    decalsAdded: a.decals.slice(base.decals.length),
    ritual: a.ritual,
  };
}

function restoreArea(id: string, d: AreaSaveV1): Area {
  const build = AREAS[id];
  if (!build) throw new Error(`save references unknown area "${id}"`);
  const a = new Area(build());
  for (const [i, t] of d.tiles) a.grid[i] = t;
  for (const [pid, st] of Object.entries(d.props)) a.setPropState(pid, st);
  for (const lid of d.looseTaken) a.takeLoose(lid);
  a.decals.push(...d.decalsAdded);
  a.ritual = d.ritual ? clone(d.ritual) : null;
  return a;
}

// ---- browser persistence (thin; the format above is what matters)
const KEY = "dustwake.save";
export function saveToStorage(w: World, storage: Storage = localStorage) { storage.setItem(KEY, JSON.stringify(serialize(w))); }
export function loadFromStorage(storage: Storage = localStorage): World | null {
  const raw = storage.getItem(KEY);
  return raw ? deserialize(JSON.parse(raw)) : null;
}
