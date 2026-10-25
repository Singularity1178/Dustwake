// The World: everything that is simulated and saved. No DOM, no audio, no
// canvas. Presentation reads it and drains `events`.
import { SeededRng } from "../core/rng";
import type { Facing } from "../golem";
import type { ItemId } from "../content/items";
import type { Effect, Task, Cue } from "../content/tasks";
import { Area } from "./area";
import { AREAS } from "./areas";

/** One inventory slot: a stack of one item kind, or empty. */
export type Slot = { item: ItemId; n: number } | null;

/** Anything that exists in the world and can perform work: the golem today; NPCs and animals later. */
export interface Actor {
  id: string;
  kind: string;
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
}

/** A delayed effect. `area` is where it was scheduled: it always applies there, even if the actor has travelled. */
export interface Scheduled { at: number; actor: string; area: string; effect: Effect }

/** Things that happened in the sim this frame, for presentation (audio, particles, UI). */
export type SimEvent =
  | { t: "itemGained"; actor: string; item: ItemId; stored: boolean; n?: number }
  | { t: "itemDropped"; actor: string; item: ItemId; n: number; x: number; y: number; reason: "drop" | "full" | "overflow" }
  | { t: "packFull"; actor: string; item: ItemId }
  | { t: "message"; text: string }
  | { t: "step"; actor: string; heavy: boolean }
  | { t: "taskTick"; actor: string; task: Task; dt: number }
  | { t: "cue"; cue: Cue; x: number; y: number }
  | { t: "equipped"; actor: string; item: ItemId }
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
  | { t: "runeAwakened"; rune: string }
  | { t: "travelled"; actor: string; from: string; to: string; rune: string }
  | { t: "harvestHit"; actor: string; prop: string; kind: string; x: number; y: number; depleted: boolean }
  | { t: "built"; actor: string; prop: string; x: number; y: number }
  | { t: "learned"; flag: string }
  | { t: "areaEntered"; actor: string; area: string };

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
  events: SimEvent[];
}

export function createWorld(seed: number): World {
  const w: World = {
    seed, rng: new SeededRng(seed), time: 0, playTime: 0, flags: new Set(),
    areas: new Map(), actors: [], playerId: "golem", scheduled: [], events: [],
  };
  const dungeon = getArea(w, "dungeon");
  w.actors.push(makeActor("golem", "golem", dungeon.id, dungeon.start.x, dungeon.start.y));
  return w;
}

export function makeActor(id: string, kind: string, area: string, x: number, y: number): Actor {
  return { id, kind, area, x, y, vx: 0, vy: 0, facing: "down", phase: 0, moving: false, steps: 0, task: null, queue: [], inventory: [] };
}

/** Instantiate an area from its definition on first visit. */
export function getArea(w: World, id: string): Area {
  let a = w.areas.get(id);
  if (!a) {
    const build = AREAS[id];
    if (!build) throw new Error(`unknown area "${id}"`);
    a = new Area(build());
    if (a.base.ritual) a.initRitual(shuffle(w.rng, [0, 1, 2, 3]));
    w.areas.set(id, a);
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
  emit(w, { t: "areaEntered", actor: a.id, area: areaId });
}

export const emit = (w: World, e: SimEvent) => { w.events.push(e); };
export const hasFlag = (w: World, f: string) => w.flags.has(f);
export const setFlag = (w: World, f: string) => { w.flags.add(f); };
export const clearFlag = (w: World, f: string) => { w.flags.delete(f); };

function shuffle(rng: SeededRng, perm: number[]) {
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}
