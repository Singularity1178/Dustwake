// The World: everything that is simulated and saved. No DOM, no audio, no
// canvas. Presentation reads it and drains `events`.
import { SeededRng } from "../core/rng";
import type { Facing } from "../golem";
import type { GearSlot, ItemId } from "../content/items";
import type { Effect, Task, Cue } from "../content/tasks";
import { Area } from "./area";
import type { NpcSpawn } from "../map";
import { AREAS } from "./areas";
import { ACTORS } from "../content/actors";
import { NPCS } from "../content/npcs";
import type { Job } from "./jobs";
import type { Slot } from "../content/inventory";
export type { Slot } from "../content/inventory";

/** Gear worn on the body, by slot (Actor.gear). */
export type Gear = Partial<Record<GearSlot, ItemId>>;

/** Anything that exists in the world and can perform work: the golem today; NPCs and animals later. */
export interface Actor {
  id: string;
  kind: string;
  definition: string;
  upgrades: string[];
  powerCore: ItemId | null;
  mode: "normal" | "scan";
  job: Job | null;
  jobSeq: number;
  area: string;
  x: number; y: number; vx: number; vy: number;
  facing: Facing;
  /** Locomotion: gait phase drives the limp, `steps` counts footfalls. */
  phase: number; moving: boolean; steps: number;
  task: Task | null;
  /** Work waiting to be performed after the current task. */
  queue: Task[];
  /** Ordered slots. Length tracks derived capacity (sim/inventory.ts). Actor-owned so any actor can carry things. */
  inventory: Slot[];
  /** Gear worn on the body, by slot (the basket on the back; sim/gear.ts). Actor-owned like the pack; worn items are not in it. */
  gear: Gear;
  /** Optional dialogue identity. The body and art always come from definition. */
  npc?: string;
}

/** A delayed effect. `area` is where it was scheduled: it always applies there, even if the actor has travelled. */
export interface Scheduled { at: number; actor: string; area: string; effect: Effect }

/** Things that happened in the sim this frame, for presentation (audio, particles, UI). */
export type SimEvent =
  | { t: "itemGained"; actor: string; item: ItemId; stored: boolean; n?: number }
  | { t: "itemDropped"; actor: string; item: ItemId; n: number; x: number; y: number; reason: "drop" | "full" | "overflow" }
  | { t: "packFull"; actor: string; item: ItemId }
  | { t: "message"; text: string; actor?: string }
  | { t: "step"; actor: string; heavy: boolean }
  | { t: "taskTick"; actor: string; task: Task; dt: number }
  | { t: "cue"; cue: Cue; x: number; y: number; actor?: string }
  | { t: "equipped"; actor: string; item: ItemId }
  /** `actor` put gear on (the basket onto its back) / took it off into its pack. */
  | { t: "gearOn"; actor: string; item: ItemId; slot: GearSlot }
  | { t: "gearOff"; actor: string; item: ItemId; slot: GearSlot }
  /** `actor`'s slam landed at (x, y). `hit`: on something slammable (its own event follows: wallBroken / withstood). */
  | { t: "slam"; actor: string; x: number; y: number; hit: boolean }
  /** A blow landed on something that held (cracked debris without the iron arm). The world is unchanged. */
  | { t: "withstood"; actor: string; x: number; y: number; tx?: number; ty?: number }
  | { t: "containerOpened"; x: number; y: number }
  | { t: "doorUnlocked"; x: number; y: number }
  | { t: "wallBroken"; x: number; y: number }
  | { t: "corePlaced" }
  | { t: "carved" }
  | { t: "glyphPlaced"; socket: number }
  | { t: "runeActivated" }
  | { t: "runeFizzled" }
  | { t: "runeDeactivated" }
  | { t: "teleport"; actor: string; first: boolean; x: number; y: number }
  | { t: "runeAwakened"; rune: string; actor: string }
  | { t: "travelled"; actor: string; from: string; to: string; rune: string }
  | { t: "harvestHit"; actor: string; prop: string; kind: string; x: number; y: number; depleted: boolean }
  | { t: "built"; actor: string; prop: string; x: number; y: number }
  /** A prop was taken apart (its refund went through giveItem). */
  | { t: "deconstructed"; actor: string; prop: string; kind: string; x: number; y: number }
  /** `actor` finished crafting `n` of `item` at a bench (recipe id from content/crafting.ts). */
  | { t: "crafted"; actor: string; recipe: string; item: ItemId; n: number }
  /** `actor` used a work station; presentation opens the station's UI (player only). */
  | { t: "openStation"; actor: string; prop: string; station: string }
  | { t: "learned"; flag: string }
  | { t: "areaEntered"; actor: string; area: string }
  /** `actor` addressed NPC actor `npc`; presentation opens `segment` of `script`. */
  | { t: "dialogue"; actor: string; npc: string; script: string; segment: string }
  /** An NPC woke or went dormant (reversible state). */
  | { t: "npcState"; npc: string; awake: boolean }
  /** The golem's eye was mended (by NPC `by`). */
  | { t: "eyeRepaired"; actor: string; by?: string }
  | { t: "powerChanged"; actor: string; powered: boolean }
  /** `actor` slotted `item` into `target`'s body (inserted) or took it out; `powered`: target's state after. The player's event (powerChanged is the target's). */
  | { t: "coreSlotted"; actor: string; target: string; item: ItemId; inserted: boolean; powered: boolean }
  /** `actor` talked to NPC actor `npc`: every time, whether a segment plays (then `dialogue` follows) or only the idle line. */
  | { t: "talkedTo"; actor: string; npc: string }
  | { t: "jobChanged"; actor: string; status: string; reason?: string }
  | { t: "manageActor"; actor: string; target: string }
  | { t: "openStorage"; actor: string; prop: string }
  | { t: "analyzed"; actor: string; prop: string; flag: string }
  /** `actor` thought line `line` (content/monologue.ts). Presentation shows it; nothing else reacts. */
  | { t: "thought"; actor: string; line: string };

/**
 * Inner-monologue state (saved, sim/monologue.ts). `said`: one-shot lines already
 * thought, in order. `ready`: sim time at which a recurring line may fire again.
 */
export interface MonologueState { said: string[]; ready: Record<string, number> }

export interface World {
  seed: number;
  rng: SeededRng;
  /** Simulation clock (seconds). Advances only while the world simulates. */
  time: number;
  /** Seconds spent in active play (shown on the end screen). */
  playTime: number;
  flags: Set<string>;
  areas: Map<string, Area>;
  actors: Actor[];
  playerId: string;
  scheduled: Scheduled[];
  /** The player golem's inner monologue (saved). */
  monologue: MonologueState;
  events: SimEvent[];
}

export function createWorld(seed: number): World {
  const w: World = {
    seed, rng: new SeededRng(seed), time: 0, playTime: 0, flags: new Set(),
    areas: new Map(), actors: [], playerId: "golem", scheduled: [], monologue: { said: [], ready: {} }, events: [],
  };
  const dungeon = getArea(w, "dungeon");
  // The player first; the dungeon's NPCs were spawned by getArea.
  w.actors.unshift(makeActor("golem", "golem", dungeon.id, dungeon.start.x, dungeon.start.y));
  return w;
}

export function makeActor(id: string, kind: string, area: string, x: number, y: number): Actor {
  return {
    id, kind, definition: ACTORS[kind] ? kind : "golem", area, x, y, vx: 0, vy: 0,
    facing: "down", phase: 0, moving: false, steps: 0, task: null, queue: [], inventory: [], gear: {},
    upgrades: [], powerCore: null, mode: "normal", job: null, jobSeq: 0,
  };
}

/** An NPC actor from an area's spawn row. Its inventory starts empty (it is still per actor). */
export function makeNpc(s: NpcSpawn, area: string): Actor {
  const a = makeActor(s.id, NPCS[s.npc]?.actor ?? s.npc, area, s.x, s.y);
  a.kind = "npc";
  a.npc = s.npc;
  if (s.facing) a.facing = s.facing;
  return a;
}

/** Instantiate an area from its definition on first visit (and spawn its NPCs). */
export function getArea(w: World, id: string): Area {
  let a = w.areas.get(id);
  if (!a) {
    const build = AREAS[id];
    if (!build) throw new Error(`unknown area "${id}"`);
    a = new Area(build());
    if (a.base.ritual) a.initRitual(shuffle(w.rng, [0, 1, 2, 3]));
    w.areas.set(id, a);
    for (const s of a.base.npcs ?? []) if (!actorById(w, s.id)) w.actors.push(makeNpc(s, id));
  }
  return a;
}

export const player = (w: World) => w.actors.find((a) => a.id === w.playerId)!;
export const actorById = (w: World, id: string) => w.actors.find((a) => a.id === id);
export const areaOf = (w: World, a: Actor) => getArea(w, a.area);
/** The area the player is in — what gets rendered. */
export const currentArea = (w: World) => areaOf(w, player(w));

/**
 * Move an actor to another area (travel). The current task ends; queued work
 * aimed at the area being left is dropped (it could only misfire elsewhere).
 * Inventory travels with the actor untouched.
 */
export function enterArea(w: World, a: Actor, areaId: string, x: number, y: number) {
  getArea(w, areaId);
  a.area = areaId;
  a.x = x; a.y = y; a.vx = 0; a.vy = 0;
  a.task = null;
  a.queue = a.queue.filter((t) => !t.area || t.area === areaId);
  if (a.job) a.job.nav = null;
  emit(w, { t: "areaEntered", actor: a.id, area: areaId });
}

export const emit = (w: World, e: SimEvent) => { w.events.push(e); };
export const isBodyFlag = (f: string) => f === "golem.arm" || f.startsWith("golem.slot.");
export const actorHasFlag = (a: Actor, f: string) => a.upgrades.includes(f);
export function setActorFlag(a: Actor, f: string, on = true) {
  if (on && !a.upgrades.includes(f)) a.upgrades.push(f);
  if (!on) a.upgrades = a.upgrades.filter((x) => x !== f);
}
// Compatibility for the tutorial and debug keys. Body state is stored only on
// the player actor; sim rules for other actors use actorFlags requirements.
export const hasFlag = (w: World, f: string) => isBodyFlag(f) ? !!player(w)?.upgrades.includes(f) : w.flags.has(f);
export const setFlag = (w: World, f: string) => { if (isBodyFlag(f)) setActorFlag(player(w), f); else w.flags.add(f); };
export const clearFlag = (w: World, f: string) => { if (isBodyFlag(f)) setActorFlag(player(w), f, false); else w.flags.delete(f); };

function shuffle(rng: SeededRng, perm: number[]) {
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}
