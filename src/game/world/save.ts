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
import { populateFolk } from "../sim/folk";
import { SeededRng } from "../core/rng";
import { TS, isSolidT } from "../content/tiles";
import { propDef } from "../content/props";
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
  * v12: the production rollout. Build plans are analysis-gated: a save that
  *      knew building is granted exactly the plans it could already build (a
  *      frozen list, never the live catalog: the storage chest stays locked).
  *      The dungeon gains its dormant worker golem (actor
  *      `npc.worker.artificery`), once, even for v4 saves that MIGRATIONS[4]
  *      already gave it, and never on top of a player standing there.
  * v13: the calendar clock (`day`: days since the world began, the fraction
  *      the time of day). Older worlds were always night: one that has reached
  *      the surface resumes at its first morning, one still in the halls in
  *      the night it woke in.
  * v14: the entrance. No field changed shape: a dig site's progress is its
  *      prop's `dmg` and `open`, an opened entrance is a world flag, the cleared
  *      stair is ordinary tile and removed-prop diffs. But the artificery and the
  *      armory were refurnished and iron veins stand on the surface, and a body
  *      saved where one of those now stands could never move again: any such
  *      actor is set down beside it (a frozen list of the new footprints).
  * v15: the stair below, redrawn with depth. No field changed shape here either,
  *      and tile diffs hold no floor style, so a stair dug out before v15 loads
  *      as the hall and the flight the builder now lays. But the flight now
  *      stands between two cheek walls that end in newel posts, and they are
  *      solid: a body saved on the edge of the open stair is set down beside
  *      them, inside the passage (a frozen list again, as v14).
  * v16: the stair's newel posts raised off the flight. No field changed shape.
  *      The posts stood 7 px too far south, their bases clipping into the lowest
  *      step; they now stand in the hall with their feet on the flight's north
  *      edge, and the cheek walls' footprints begin there. That moves solid
  *      footprints into the hall's last rows, so a body saved there is set down
  *      beside them, inside the passage (a frozen list again, as v15).
  * v17: routes over runes and portals, and the rune network's ends agreeing. No
  *      field changed shape (a gather order's `storage` may now be null: the
  *      worker keeps what it gathers). But before v17 a trip down from the
  *      surface rune "woke" the halls' circle even with a glyph out of it, so a
  *      save could hold the circle's rune flag set over a ritual that was not
  *      active; the flag follows the ritual again. And an order stopped for
  *      want of a route carries the reason's new name (routes are no longer
  *      runes alone).
  * v18: townsfolk (sim/folk.ts). Generic NPCs are actors of kind "folk" with
  *      `person` (who they are, generated once from the world seed) and `life`
  *      (what they are doing, and the place they hold); a `census.<area>` flag
  *      records that an area's people were made. No older field changed, so
  *      MIGRATIONS[17] only bumps the version: `deserialize` makes the people of
  *      every area a save has visited and has no census flag for (populateFolk:
  *      from the save's own seed, never its rng), so the town and the camp of a
  *      save from before v18 are lived in on load, and a v18 save is untouched.
  */
export const SAVE_VERSION = 18;

type PropState = { open?: boolean; taken?: boolean; lit?: boolean; item?: ItemId | null; dmg?: number; inventory?: Slot[]; name?: string };

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
  version: 18;
  seed: number;
  rng: number;
  time: number;
  playTime: number;
  /** The calendar clock (World.day). */
  day: number;
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
  11: (s) => {
    // (1) Plans gated in v12 that v10/v11 let anyone who knew building build:
    // grant those, frozen here, to a save with know.build. Nothing for a save
    // without it; analysis flags it already has are kept. Never derived from
    // RECIPES, so the storage chest and any later plan still need analysis.
    const flags: string[] = [...(s.flags ?? [])];
    if (flags.includes("know.build")) for (const id of V11_BUILDABLE) if (!flags.includes(`analysis.${id}`)) flags.push(`analysis.${id}`);
    // (2) Actors live on the World, so a dungeon visited before v12 never re-runs
    // its spawns: add the dormant worker (the v4 guardian precedent). A v4 save
    // already got it from MIGRATIONS[4], which loops the live builder's spawns:
    // match by id, never a second one. If the player stands where it goes, it
    // takes its second spot, so no body ever starts inside another.
    const actors: any[] = [...(s.actors ?? [])];
    if (s.areas?.dungeon) {
      let worker = actors.find((a) => a.id === V12_WORKER.id);
      if (!worker) actors.push((worker = makeNpc({ ...V12_WORKER, facing: "down" }, "dungeon")));
      const pl = actors.find((a) => a.id === s.playerId);
      const hit = (x: number, y: number) => pl?.area === "dungeon" && Math.abs(pl.x - x) < 5 + 4 + 2 && pl.y > y - 4 - 2 && pl.y - 5 < y + 2;
      if (hit(worker.x, worker.y)) { worker.x = V12_WORKER_ALT.x; worker.y = V12_WORKER_ALT.y; }
    }
    return { ...s, version: 12, flags, actors };
  },
  // The calendar clock. The hours are frozen here on purpose (content/daycycle.ts may be retuned later).
  12: (s) => ({ ...s, version: 13, day: typeof s.day === "number" ? s.day : (s.flags ?? []).includes("tutorial.done") ? 6.6 / 24 : 22.5 / 24 }),
  // Nobody is left standing inside what v14 added. A body whose feet box (10x5, the widest that walks) overlaps one
  // of the new footprints steps to the nearest place clear of all of them, in a fixed order, 8 px at a time. Bodies
  // elsewhere, the areas' diffs and everything a save holds are untouched: the new props, the loose rusted heads
  // and the stair's steps come from the builders, as any authored change does.
  13: (s) => ({ ...s, version: 14, actors: (s.actors ?? []).map((a: any) => setDown(a, V14_SOLID, V14_ROOMS)) }),
  // Nobody is left standing inside the stair's cheek walls or newel posts (v15), by the same rule: only a body on
  // the open stair's very edge can be, and it steps clear of them without leaving the passage.
  14: (s) => ({ ...s, version: 15, actors: (s.actors ?? []).map((a: any) => setDown(a, V15_SOLID, V15_ROOMS)) }),
  // The newel posts moved up into the hall (v16), so the footprints did too: a body saved in the hall's last rows beside
  // the passage wall is now inside a post. Same rule again, with the footprints as they were placed then.
  15: (s) => ({ ...s, version: 16, actors: (s.actors ?? []).map((a: any) => setDown(a, V16_SOLID, V16_ROOMS)) }),
  // The rune network's two ends agree again (v17). The halls' circle is lit by its ritual and by nothing else: a save
  // in which the surface rune had "woken" it with a glyph out (its flag set, its ritual not active) has the flag
  // cleared, so the circle is dark and the surface rune severed, as they now would be. A circle that is lit keeps
  // its flag. And an order stopped with no route to follow is renamed to the reason v17 gives. Names are frozen here.
  16: (s) => {
    const ritual = s.areas?.dungeon?.ritual;
    return {
      ...s, version: 17,
      flags: (s.flags ?? []).filter((f: string) => f !== "rune.dungeon.active" || !ritual || ritual.active),
      actors: (s.actors ?? []).map((a: any) => (a.job?.reason === "noRuneRoute" ? { ...a, job: { ...a.job, reason: "noRoute" } } : a)),
    };
  },
  // v18: townsfolk. Actors may carry `person` and `life` (sim/folk.ts) and the world the `census.<area>` flags. Nothing
  // older needs rewriting: deserialize makes the people of every area the save has already visited (populateFolk,
  // keyed by the census flag, from the save's own seed), so a town visited before v18 is lived in on load.
  17: (s) => ({ ...s, version: 18 }),
};

type Rect = [number, number, number, number];
/**
 * A body whose feet box overlaps one of `solid`'s footprints for its area steps to the nearest place clear of all of
 * them, in a fixed order, 8 px at a time. It stays in the room (of `rooms`) it was in: a step out of the furniture
 * must not be a step into the wall behind it. Any other body is returned as it is.
 */
function setDown(a: any, solid: Record<string, Rect[]>, rooms: Record<string, Rect[]>): any {
  const boxes = solid[a.area];
  const hit = (x: number, y: number) => !!boxes && boxes.some((b) => x + 5 > b[0] && x - 5 < b[2] && y > b[1] && y - 5 < b[3]);
  if (typeof a.x !== "number" || typeof a.y !== "number" || !hit(a.x, a.y)) return a;
  const within = (r: number[], x: number, y: number) => x - 5 >= r[0] && x + 5 <= r[2] && y - 5 >= r[1] && y <= r[3];
  const room = (rooms[a.area] ?? []).find((r) => within(r, a.x, a.y));
  for (let r = 1; r <= 8; r++) for (const [dx, dy] of [[0, -r], [0, r], [r, 0], [-r, 0], [r, -r], [-r, -r], [r, r], [-r, r]]) {
    const x = a.x + dx * 8, y = a.y + dy * 8;
    if (!hit(x, y) && (!room || within(room, x, y))) return { ...a, x, y, vx: 0, vy: 0 };
  }
  return a;
}

/**
 * The footprints v15 added, frozen as they were placed then: the two newel posts at the foot of the surface stair
 * and the cheek wall running up the flight from each. And the passage they stand in (hall and flight).
 */
const V15_SOLID: Record<string, Rect[]> = { dungeon: [[544, 833, 556, 839], [596, 833, 608, 839], [544, 839, 552, 896], [600, 839, 608, 896]] };
const V15_ROOMS: Record<string, Rect[]> = { dungeon: [[544, 800, 608, 896]] };

/**
 * The same four footprints as v16 placed them, frozen: the newel posts now stand in the hall with their feet on the
 * flight's north edge (y 832), and each cheek wall runs from there to the top of the flight. And the passage they
 * stand in, as before.
 */
const V16_SOLID: Record<string, Rect[]> = { dungeon: [[544, 826, 556, 832], [596, 826, 608, 832], [544, 832, 552, 896], [600, 832, 608, 896]] };
const V16_ROOMS: Record<string, Rect[]> = { dungeon: [[544, 800, 608, 896]] };

/**
 * The collision footprints [x0, y0, x1, y1] (px) of the solid props v14 added, frozen as they were placed then (a
 * migration must not read builders that keep changing): the artificery's coal bin, quench trough, rune table, slip
 * vat and unfinished body; the armory's second rack, staff rack, bare stand and armour heap; the surface's iron veins.
 */
/** The floors of the two refurnished rooms (px), frozen likewise: the artificery and the armory. */
const V14_ROOMS: Record<string, Rect[]> = { dungeon: [[64, 576, 272, 736], [992, 48, 1104, 176]] };
const V14_SOLID: Record<string, Rect[]> = {
  dungeon: [
    [65, 601, 79, 608], [72, 649, 88, 656], [114, 726, 142, 736], [69, 729, 83, 736], [75, 683, 85, 688],
    [1072, 78, 1096, 84], [1002, 98, 1022, 104], [1003, 163, 1013, 168], [1069, 138, 1083, 144],
  ],
  surface: [
    [1408, 1031, 1424, 1039], [1375, 263, 1391, 271], [1422, 344, 1438, 352], [737, 199, 753, 207], [447, 1048, 463, 1056], [510, 824, 526, 832],
    [591, 743, 607, 751], [928, 279, 944, 287], [1215, 856, 1231, 864], [1295, 183, 1311, 191], [881, 119, 897, 127], [1155, 903, 1171, 911],
  ],
};

/** v12's analysis-gated plans that v10/v11 had open to anyone with know.build (frozen: not the live catalog). */
const V11_BUILDABLE = ["wall_torch", "brazier", "craftbench", "table", "chair", "wall_banner"];
/** The v12 dormant worker's spawn (as map.ts places it), and its second spot (the artificery's south-west corner). */
const V12_WORKER = { id: "npc.worker.artificery", npc: "worker_golem", x: 7 * 16 + 13, y: 37 * 16 + 14 };
const V12_WORKER_ALT = { x: 5 * 16 + 8, y: 43 * 16 + 12 };

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
    version: SAVE_VERSION, seed: w.seed, rng: w.rng.state, time: w.time, playTime: w.playTime, day: w.day,
    flags: [...w.flags], playerId: w.playerId, actors: w.actors, scheduled: w.scheduled, monologue: w.monologue, areas,
  } as SaveData);
}

export function deserialize(raw: unknown, migrations = MIGRATIONS, version = SAVE_VERSION): World {
  const s = migrate(raw, migrations, version) as SaveData;
  const rng = new SeededRng(0);
  rng.state = s.rng >>> 0;
  const w: World = {
    seed: s.seed, rng, time: s.time, playTime: s.playTime, day: s.day, flags: new Set(s.flags),
    areas: new Map(), actors: clone(s.actors), playerId: s.playerId, scheduled: clone(s.scheduled),
    monologue: { said: [...(s.monologue?.said ?? [])], ready: { ...(s.monologue?.ready ?? {}) } }, events: [],
  };
  for (const [id, d] of Object.entries(s.areas)) w.areas.set(id, restoreArea(id, d));
  // townsfolk for areas visited before there were any (a no-op for a save that has them: the census flag is set)
  for (const id of w.areas.keys()) populateFolk(w, id);
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

const propState = (p: { open: boolean; taken: boolean; lit?: boolean; item?: ItemId; dmg: number; inventory?: Slot[]; name?: string }, b?: { lit?: boolean; item?: ItemId; open?: boolean; inventory?: Slot[]; name?: string }) => {
  const d: PropState = {};
  if (p.open !== !!b?.open) d.open = p.open;
  if (p.taken) d.taken = true;
  if (!!p.lit !== !!b?.lit) d.lit = !!p.lit;
  if (p.item !== b?.item) d.item = p.item ?? null;
  if (p.dmg) d.dmg = p.dmg;
  if (p.name !== b?.name && p.name) d.name = p.name;
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
    const { id: pid, kind, x, y, open, taken, dmg, lit, item, inventory, ...rest } = p; // rest carries `name`
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
  return raw ? settle(deserialize(JSON.parse(raw))) : null;
}

/**
 * Authored areas change between builds (Westwake grew a wall where there was meadow, the artificery was
 * refurnished). Nobody loads a stored game standing inside masonry or inside a solid prop: the player is set
 * down on the nearest free ground, or failing that at the area's start. Nothing the game saves stands in either,
 * so a save from this build is never moved. `deserialize` itself stays the exact inverse of `serialize`; this
 * runs on the way in from storage.
 */
export function settle(w: World): World {
  const pl = w.actors.find((a) => a.id === w.playerId), at = pl && w.areas.get(pl.area);
  if (pl && at && !standable(at, pl.x, pl.y)) {
    let spot: { x: number; y: number } | null = null;
    for (let r = 1; r <= 16 && !spot; r++) for (let i = -r; i <= r && !spot; i++)
      for (const [dx, dy] of [[i, r], [i, -r], [r, i], [-r, i]]) if (!spot && standable(at, pl.x + dx * 8, pl.y + dy * 8)) spot = { x: pl.x + dx * 8, y: pl.y + dy * 8 };
    spot ??= at.base.start;
    pl.x = spot.x; pl.y = spot.y;
  }
  return w;
}

/** Does a golem-sized box (10x5 px, feet at x, y) reach into a solid tile, or off the map? */
function inMasonry(a: Area, x: number, y: number): boolean {
  const x0 = x - 5, x1 = x + 5, y0 = y - 5, y1 = y;
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++)
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++)
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h || isSolidT(a.grid[ty * a.w + tx])) return true;
  return false;
}
/** Is that box clear of solid tiles and of prop boxes? The rule of sim/collision.ts boxFree, kept local: world does not import sim. */
function standable(a: Area, x: number, y: number): boolean {
  const x0 = x - 5, x1 = x + 5, y0 = y - 5, y1 = y;
  return !inMasonry(a, x, y) && !a.props.some((p) => p.box && !p.taken && !(propDef(p.kind).openBox && !p.open) && x1 > p.box[0] && x0 < p.box[2] && y1 > p.box[1] && y0 < p.box[3]);
}
