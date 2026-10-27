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
import { makeNpc, type Actor, type MonologueState, type Scheduled, type Slot, type World } from "./world";
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
 * v7: the CRAFTING BENCH recipe builds the dungeon's own `workbench` prop (one
 *     kind, one sprite, one station) instead of a separate `craftbench` kind.
 *     Built `craftbench` props become `workbench` (ids and recipe id stay).
 * v8: actors gain `gear` (items worn by slot). The basket is no longer
 *     installed on pickup (world flag `golem.basket`): it is gear worn in the
 *     actor's back slot. A save with the basket installed (or still being
 *     attached) migrates to the golem wearing it, with the same capacity.
 * v9: crafted materials (planks, cut stone) and a rebalanced build catalog that
 *     uses them, plus the full set of gear slots (a gear map only gains keys, so
 *     gear itself needs no change). Built props record what they `refund`; props
 *     built before that are stamped with the cost they were built for, so the
 *     rebalance can't be farmed by building cheap and taking apart for more.
 *     Build work still pending for a recipe whose cost changed is dropped: a
 *     build only takes its materials when it fires, so nothing was consumed.
  * v10: actor definitions/upgrades, body power, scan mode, durable jobs;
  *      prop inventories, analysis grandfathering and relic discovery credit.
  * v11: the inner monologue (`monologue`: one-shot lines already thought and
  *      recurring lines' cooldowns). Older saves start with nothing thought.
  */
export const SAVE_VERSION = 11;

type PropState = { open?: boolean; taken?: boolean; lit?: boolean; item?: ItemId | null; dmg?: number; inventory?: Slot[] };

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
  version: 11;
  seed: number;
  rng: number;
  time: number;
  playTime: number;
  flags: string[];
  playerId: string;
  actors: Actor[];
  scheduled: Scheduled[];
  monologue: MonologueState;
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
  6: (s) => {
    // The built crafting bench is now the `workbench` prop. Only the kind changes:
    // prop ids (`craftbench#b0`), the recorded recipe id (`craftbench`), position
    // and state are kept, so queued work that targets a bench still finds it.
    // Collision boxes aren't saved (they come from the kind), so the bench simply
    // takes the workbench's box (2 px wider each side) on load.
    return {
      ...s, version: 7,
      areas: Object.fromEntries(Object.entries(s.areas ?? {}).map(([id, d]: [string, any]) => [id, {
        ...d, propsAdded: (d.propsAdded ?? []).map((p: any) => (p.kind === "craftbench" ? { ...p, kind: "workbench" } : p)),
      }])),
    };
  },
  7: (s) => {
    // The basket was installed on pickup: the world flag `golem.basket`. It is
    // now gear in the actor's own back slot, so the golem that had it installed
    // wears it (same 48-slot tier). An attach still in progress ends worn too:
    // the basket had already left the ground. Everyone else gets empty gear.
    const flags: string[] = s.flags ?? [];
    const installed = flags.includes("golem.basket");
    const attaching = (t: any) => t?.effect?.op === "equip" && t.effect.item === "basket";
    return {
      ...s, version: 8,
      flags: flags.filter((f) => f !== "golem.basket"),
      actors: (s.actors ?? []).map((a: any) => {
        const queue = a.queue ?? [];
        const wearIt = attaching(a.task) || queue.some(attaching) || (installed && a.id === s.playerId);
        return {
          ...a, gear: { ...(a.gear ?? {}), ...(wearIt ? { back: "basket" } : {}) },
          task: attaching(a.task) ? null : a.task, queue: queue.filter((t: any) => !attaching(t)),
        };
      }),
    };
  },
  8: (s) => {
    // Props built under the old costs refund what they cost then (never more).
    const stamp = (p: any) => {
      if (p.refund) return p;
      const id = p.recipe && V8_COSTS[p.recipe] ? p.recipe : p.recipe ? undefined : V8_RECIPE_OF_KIND[p.kind];
      return id && V8_COSTS[id] ? { ...p, refund: V8_COSTS[id].map((c) => ({ ...c })) } : p;
    };
    // Pending build work for a recipe that now costs crafted materials: nothing
    // had been consumed yet (building takes its cost when the effect fires), so
    // dropping it loses nothing. The golem just doesn't start it; order it again.
    const stale = (t: any) => t?.effect?.op === "build" && t.effect.recipe in V8_COSTS;
    return {
      ...s, version: 9,
      actors: (s.actors ?? []).map((a: any) => ({ ...a, task: stale(a.task) ? null : a.task, queue: (a.queue ?? []).filter((t: any) => !stale(t)) })),
      areas: Object.fromEntries(Object.entries(s.areas ?? {}).map(([id, d]: [string, any]) => [id, { ...d, propsAdded: (d.propsAdded ?? []).map(stamp) }])),
    };
  },
  9: (s) => {
    // Frozen v9 names, not a blanket bypass: future recipes still need analysis.
    const flags: string[] = [...(s.flags ?? [])];
    const body = (f: string) => f === "golem.arm" || f.startsWith("golem.slot.");
    if (flags.includes("know.build")) for (const id of ["wall_torch", "brazier", "craftbench", "table", "chair", "wall_banner"]) {
      if (!flags.includes(`analysis.${id}`)) flags.push(`analysis.${id}`);
    }
    const pl = s.actors.find((a: any) => a.id === s.playerId);
    const taken = s.areas?.dungeon?.looseTaken ?? [];
    for (const id of ["crown", "coin", "goblet"]) {
      const found = pl?.inventory?.some((x: any) => x?.item === id) || taken.includes(id)
        || (id === "goblet" && s.areas?.dungeon?.props?.["longtable@59.5,47"]?.taken);
      if (found && !flags.includes(`relic.found.${id}`)) flags.push(`relic.found.${id}`);
    }
    return {
      ...s, version: 10, flags: flags.filter((f) => !body(f)),
      actors: s.actors.map((a: any) => ({
        ...a, definition: a.definition ?? (a.npc === "guardian" ? "guardian" : a.npc ? "npc_worker" : "golem"),
        upgrades: [...new Set([...(a.upgrades ?? []), ...(a.id === s.playerId ? flags.filter(body) : [])])],
        powerCore: a.powerCore ?? null, mode: a.mode ?? "normal", job: a.job ?? null, jobSeq: a.jobSeq ?? 0,
      })),
    };
  },
  // Nothing has been thought yet. The opening's lines are not marked: a loaded
  // save never replays the opening, and only it fires them.
  10: (s) => ({ ...s, version: 11, monologue: s.monologue ?? { said: [], ready: {} } }),
};

/**
 * The recipes whose cost changed in v9, as they cost in v8 (frozen here on
 * purpose: a migration must not read content that keeps changing), and the
 * recipe each prop kind was built from (saves before v6 didn't record it).
 */
const V8_COSTS: Record<string, { item: string; n: number }[]> = {
  wall_torch: [{ item: "stone", n: 2 }, { item: "wood", n: 1 }],
  brazier: [{ item: "stone", n: 4 }, { item: "wood", n: 2 }],
  table: [{ item: "wood", n: 4 }],
  chair: [{ item: "wood", n: 2 }],
  wall_banner: [{ item: "wood", n: 1 }, { item: "stone", n: 1 }],
};
const V8_RECIPE_OF_KIND: Record<string, string> = { torch: "wall_torch", brazier: "brazier", table: "table", chair: "chair", banner: "wall_banner" };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function serialize(w: World): SaveData {
  const areas: Record<string, AreaSave> = {};
  for (const [id, a] of w.areas) areas[id] = diffArea(a);
  return clone({
    version: SAVE_VERSION, seed: w.seed, rng: w.rng.state, time: w.time, playTime: w.playTime,
    flags: [...w.flags], playerId: w.playerId, actors: w.actors, scheduled: w.scheduled, monologue: w.monologue, areas,
  } as SaveData);
}

export function deserialize(raw: unknown, migrations = MIGRATIONS, version = SAVE_VERSION): World {
  const s = migrate(raw, migrations, version) as SaveData;
  const rng = new SeededRng(0);
  rng.state = s.rng >>> 0;
  const w: World = {
    seed: s.seed, rng, time: s.time, playTime: s.playTime, flags: new Set(s.flags),
    areas: new Map(), actors: clone(s.actors), playerId: s.playerId, scheduled: clone(s.scheduled),
    monologue: { said: [...(s.monologue?.said ?? [])], ready: { ...(s.monologue?.ready ?? {}) } }, events: [],
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

const propState = (p: { open: boolean; taken: boolean; lit?: boolean; item?: ItemId; dmg: number; inventory?: Slot[] }, b?: { lit?: boolean; item?: ItemId; open?: boolean; inventory?: Slot[] }) => {
  const d: PropState = {};
  if (p.open !== !!b?.open) d.open = p.open;
  if (p.taken) d.taken = true;
  if (!!p.lit !== !!b?.lit) d.lit = !!p.lit;
  if (p.item !== b?.item) d.item = p.item ?? null;
  if (p.dmg) d.dmg = p.dmg;
  if (p.inventory?.some((s, i) => s?.item !== b?.inventory?.[i]?.item || s?.n !== b?.inventory?.[i]?.n)) {
    d.inventory = p.inventory.some(Boolean) ? p.inventory : [];
  }
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
      const { box: _b, dyn: _d, open: _o, taken: _t, dmg: _m, inventory: _i, ...def } = p;
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
  for (const [i, t] of d.tiles) a.setTile(i % a.w, Math.floor(i / a.w), t);
  for (const [pid, st] of Object.entries(d.props)) {
    a.setPropState(pid, st);
    if (st.inventory) a.setInventory(pid, st.inventory);
  }
  for (const pid of d.propsRemoved ?? []) a.removeProp(pid);
  for (const p of d.propsAdded) {
    const { id: pid, kind, x, y, open, taken, dmg, lit, item, inventory, ...rest } = p;
    a.addProp(kind, x, y, { ...rest, lit, item: item ?? undefined }, pid);
    a.setPropState(pid, { open, taken, dmg });
    if (inventory) a.setInventory(pid, inventory);
  }
  for (const lid of d.looseTaken) a.takeLoose(lid);
  for (const l of d.looseAdded) a.addLoose(l.item, l.n ?? 1, l.x, l.y, l.id);
  a.restoreCounters(d.looseSeq, d.propSeq);
  for (const decal of d.decalsAdded) a.addDecal(decal);
  a.setRitual(d.ritual);
  return a;
}

// Storage is injected; the browser default lives in view/persistence.ts.
const KEY = "dustwake.save";
export interface SaveStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function saveToStorage(w: World, storage: SaveStorage) { storage.setItem(KEY, JSON.stringify(serialize(w))); }
export function loadFromStorage(storage: SaveStorage): World | null {
  const raw = storage.getItem(KEY);
  return raw ? deserialize(JSON.parse(raw)) : null;
}
