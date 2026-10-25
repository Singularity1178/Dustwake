// Save / load. A save is plain JSON:
//   - world scalars (seed, rng state, clock, flags, schedule),
//   - actors verbatim (tasks are data, so in-progress work survives; inventory
//     is an array of slots and travels with its actor),
//   - per area, a *diff* against the area's deterministic builder (changed
//     tiles, prop state incl. harvest damage, props built during play, loose
//     items taken / dropped, decals appended during play, ritual state).
// Diffs keep saves small and let authored areas evolve between versions as
// long as stable ids are kept. Each schema change bumps SAVE_VERSION and adds a
// migration from the previous version.
import { SeededRng } from "../core/rng";
import { TS } from "../content/tiles";
import { RECIPES } from "../content/build";
import { RUNE_T } from "../surface";
import type { DecalDef, LooseItem, PropDef } from "../map";
import type { ItemId } from "../content/items";
import { Area, type RitualState } from "./area";
import { AREAS } from "./areas";
import { makeNpc, type Actor, type Scheduled, type World } from "./world";
import { GUARDIAN_FLAGS } from "../content/dialogue";

/**
 * v1: inventory was ItemId[] on the actor; scheduled effects had no area.
 * v2: inventory is Slot[] ({item, n} | null); areas gain looseAdded/looseSeq.
 * v3: scheduled effects carry their area; areas gain propsAdded/propSeq and per-prop harvest damage.
 * v4: the surface builder was rewritten (wild, overgrown land over the buried
 *     dungeon), so v3 surface diffs no longer describe anything; they are discarded.
 * v5: NPCs are actors. The Treasury Guardian (actor `npc.guardian`, kind "npc",
 *     with an `npc` field) holds the aether core; chest@57,4 is built open and
 *     empty. Old saves gain the guardian; if the v4 chest had already been
 *     opened (the core taken, placed, or still arriving) the guardian's
 *     `npc.guardian.coreGiven` flag is set so no second core can appear.
 *     Prop `open` is now diffed against the builder (props can start open).
 * v6: building overhaul. Props can be deconstructed: areas gain `propsRemoved`
 *     (ids of builder-placed props that were taken apart; restore removes them
 *     again so they never come back). Built props record their `recipe`. The
 *     recipe "torch" was renamed "torch_post" (pending build work is rewritten).
 */
export const SAVE_VERSION = 6;

type PropState = { open?: boolean; taken?: boolean; lit?: boolean; item?: ItemId | null; dmg?: number };

export interface AreaSave {
  tiles: [number, number][];
  props: Record<string, PropState>;
  /** Builder-placed loose items that have been picked up. */
  looseTaken: string[];
  /** Loose stacks created during play (dropped, overflow) that are still on the ground. */
  looseAdded: LooseItem[];
  looseSeq: number;
  /** Props created during play (built torches), with their state. */
  propsAdded: (Omit<PropDef, "item"> & PropState)[];
  propSeq: number;
  /** Builder-placed props that were removed during play (deconstructed). */
  propsRemoved: string[];
  decalsAdded: DecalDef[];
  ritual: RitualState | null;
}

export interface SaveData {
  version: 6;
  seed: number;
  rng: number;
  time: number;
  playTime: number;
  flags: string[];
  playerId: string;
  actors: Actor[];
  scheduled: Scheduled[];
  areas: Record<string, AreaSave>;
}

type Migration = (s: any) => any;

/** MIGRATIONS[n] upgrades a version-n save to version n+1. */
export const MIGRATIONS: Record<number, Migration> = {
  1: (s) => ({
    ...s,
    version: 2,
    actors: s.actors.map((a: any) => {
      // Stack where the new item table allows it, keep order, pad to the tier
      // the flags imply. Extra slots beyond capacity are handled at runtime
      // (reconcileCapacity drops them next to the actor; nothing is lost).
      const slots: ({ item: string; n: number } | null)[] = [];
      for (const id of a.inventory as string[]) {
        const s0 = slots.find((x) => x && x.item === id && (id === "wood" || id === "stone"));
        if (s0) s0.n++;
        else slots.push({ item: id, n: 1 });
      }
      const cap = (s.flags as string[]).includes("golem.arm") ? 16 : 8;
      while (slots.length < cap) slots.push(null);
      return { ...a, inventory: slots };
    }),
    areas: Object.fromEntries(Object.entries(s.areas).map(([id, d]: [string, any]) => [id, { ...d, looseAdded: [], looseSeq: 0 }])),
  }),
  2: (s) => {
    const actorArea = new Map<string, string>(s.actors.map((a: any) => [a.id, a.area]));
    return {
      ...s,
      version: 3,
      scheduled: s.scheduled.map((e: any) => ({ ...e, area: e.area ?? actorArea.get(e.actor) ?? "dungeon" })),
      areas: Object.fromEntries(Object.entries(s.areas).map(([id, d]: [string, any]) => [id, { ...d, propsAdded: [], propSeq: 0 }])),
    };
  },
  3: (s) => {
    // The v3 surface diff indexes tiles and prop ids (tree@x,y, ...) of the old
    // keep-ruin layout, which no longer exist: drop tile edits, prop states,
    // decals and pending surface work. Nothing the player owns is lost: the
    // basket pickup keeps its id, dropped stacks and the materials of built
    // torches are laid down just south of the rune, and anyone standing on the
    // surface is moved to the rune.
    const sf = s.areas?.surface;
    if (!sf) return { ...s, version: 4 };
    const rx = RUNE_T.x * TS + 8, ry = RUNE_T.y * TS + 8;
    let seq = sf.looseSeq ?? 0;
    const looseAdded: LooseItem[] = [];
    const lay = (item: string, n: number, id?: string) => {
      const k = looseAdded.length;
      looseAdded.push({ id: id ?? `drop${seq++}`, item: item as ItemId, n, x: rx - 24 + (k % 5) * 12, y: ry + 74 + Math.floor(k / 5) * 10 });
    };
    for (const l of sf.looseAdded ?? []) lay(l.item, l.n ?? 1, l.id);
    for (const p of sf.propsAdded ?? []) {
      const r = Object.values(RECIPES).find((rc) => rc.prop === p.kind);
      if (r && !p.taken) for (const c of r.cost) lay(c.item, c.n);
    }
    const surface: Omit<AreaSave, "propsRemoved"> = {
      tiles: [], props: {}, decalsAdded: [], ritual: null, propsAdded: [], propSeq: sf.propSeq ?? 0,
      looseTaken: (sf.looseTaken ?? []).filter((id: string) => id === "basket"), looseAdded, looseSeq: seq,
    };
    return {
      ...s, version: 4,
      areas: { ...s.areas, surface },
      scheduled: s.scheduled.filter((e: any) => e.area !== "surface"),
      actors: s.actors.map((a: any) => a.area !== "surface" ? a : { ...a, x: rx, y: ry + 4, vx: 0, vy: 0, task: null, queue: [] }),
    };
  },
  4: (s) => {
    // Add the dungeon's NPCs (the Treasury Guardian) as actors. In v4 the core
    // came from chest@57,4: if that chest was opened, the core is already in
    // play (in a pack, on the circle, on the floor, or a pending grant), so the
    // guardian must not hand over another. The chest itself is open and empty
    // in the v5 builder, so its old diff entry is simply redundant.
    const dungeon = s.areas?.dungeon;
    const flags: string[] = [...s.flags];
    const actors: any[] = [...s.actors];
    const coreOut = !!dungeon?.props?.["chest@57,4"]?.open
      || actors.some((a) => (a.inventory ?? []).some((x: any) => x?.item === "core"))
      || !!dungeon?.ritual?.core
      || Object.values(s.areas ?? {}).some((d: any) => (d.looseAdded ?? []).some((l: any) => l.item === "core"));
    if (coreOut && !flags.includes(GUARDIAN_FLAGS.coreGiven)) flags.push(GUARDIAN_FLAGS.coreGiven);
    if (dungeon) for (const sp of AREAS.dungeon().npcs ?? []) if (!actors.some((a) => a.id === sp.id)) actors.push(makeNpc(sp, "dungeon"));
    return { ...s, version: 5, flags, actors };
  },
  5: (s) => {
    // Nothing had been removed before v6. The old "torch" recipe id is now
    // "torch_post": rewrite build work still in an actor's hands or queue.
    const fix = (t: any) => (t?.effect?.op === "build" && t.effect.recipe === "torch" ? { ...t, effect: { ...t.effect, recipe: "torch_post" } } : t);
    return {
      ...s, version: 6,
      actors: s.actors.map((a: any) => ({ ...a, task: fix(a.task), queue: (a.queue ?? []).map(fix) })),
      areas: Object.fromEntries(Object.entries(s.areas ?? {}).map(([id, d]: [string, any]) => [id, { ...d, propsRemoved: [] }])),
    };
  },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function serialize(w: World): SaveData {
  const areas: Record<string, AreaSave> = {};
  for (const [id, a] of w.areas) areas[id] = diffArea(a);
  return clone({
    version: SAVE_VERSION, seed: w.seed, rng: w.rng.state, time: w.time, playTime: w.playTime,
    flags: [...w.flags], playerId: w.playerId, actors: w.actors, scheduled: w.scheduled, areas,
  } as SaveData);
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

const propState = (p: { open: boolean; taken: boolean; lit?: boolean; item?: ItemId; dmg: number }, b?: { lit?: boolean; item?: ItemId; open?: boolean }) => {
  const d: PropState = {};
  if (p.open !== !!b?.open) d.open = p.open;
  if (p.taken) d.taken = true;
  if (!!p.lit !== !!b?.lit) d.lit = !!p.lit;
  if (p.item !== b?.item) d.item = p.item ?? null;
  if (p.dmg) d.dmg = p.dmg;
  return d;
};

function diffArea(a: Area): AreaSave {
  const base = a.base;
  const tiles: [number, number][] = [];
  for (let i = 0; i < a.grid.length; i++) if (a.grid[i] !== base.grid[i]) tiles.push([i, a.grid[i]]);
  const props: AreaSave["props"] = {};
  const propsAdded: AreaSave["propsAdded"] = [];
  const baseProps = new Map(base.props.map((p) => [p.id, p]));
  for (const p of a.props) {
    if (p.dyn) {
      const { box: _b, dyn: _d, open: _o, taken: _t, dmg: _m, ...def } = p;
      propsAdded.push({ ...def, ...propState(p) } as AreaSave["propsAdded"][number]);
      continue;
    }
    const d = propState(p, baseProps.get(p.id));
    if (Object.keys(d).length) props[p.id] = d;
  }
  return {
    tiles, props,
    looseTaken: a.loose.filter((l) => l.taken && !l.dyn).map((l) => l.id),
    looseAdded: a.loose.filter((l) => l.dyn && !l.taken).map(({ taken: _t, dyn: _d, ...l }) => l),
    looseSeq: a.looseSeq,
    propsAdded, propSeq: a.propSeq,
    propsRemoved: base.props.filter((p) => !a.prop(p.id)).map((p) => p.id),
    decalsAdded: a.decals.slice(base.decals.length),
    ritual: a.ritual,
  };
}

function restoreArea(id: string, d: AreaSave): Area {
  const build = AREAS[id];
  if (!build) throw new Error(`save references unknown area "${id}"`);
  const a = new Area(build());
  for (const [i, t] of d.tiles) a.grid[i] = t;
  for (const [pid, st] of Object.entries(d.props)) a.setPropState(pid, st);
  for (const pid of d.propsRemoved ?? []) a.removeProp(pid);
  for (const p of d.propsAdded) {
    const { id: pid, kind, x, y, open, taken, dmg, lit, item, ...rest } = p;
    a.addProp(kind, x, y, { ...rest, lit, item: item ?? undefined }, pid);
    a.setPropState(pid, { open, taken, dmg });
  }
  a.propSeq = d.propSeq;
  for (const lid of d.looseTaken) a.takeLoose(lid);
  for (const l of d.looseAdded) a.addLoose(l.item, l.n ?? 1, l.x, l.y, l.id);
  a.looseSeq = d.looseSeq;
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
