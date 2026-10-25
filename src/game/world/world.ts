// The World: everything that is simulated and saved. No DOM, no audio, no
// canvas. Presentation reads it and drains `events`.
import { SeededRng } from "../core/rng";
import type { Facing } from "../golem";
import type { ItemId } from "../content/items";
import type { Effect, Task, Cue } from "../content/tasks";
import { Area } from "./area";
import { AREAS } from "./areas";

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
  inventory: ItemId[];
}

export interface Scheduled { at: number; actor: string; effect: Effect }

/** Things that happened in the sim this frame, for presentation (audio, particles, UI). */
export type SimEvent =
  | { t: "itemGained"; actor: string; item: ItemId; stored: boolean }
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
  | { t: "teleport"; actor: string }
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

/** Move an actor to another area (travel). */
export function enterArea(w: World, a: Actor, areaId: string, x: number, y: number) {
  getArea(w, areaId);
  a.area = areaId;
  a.x = x; a.y = y; a.vx = 0; a.vy = 0;
  a.task = null;
  emit(w, { t: "areaEntered", actor: a.id, area: areaId });
}

export const emit = (w: World, e: SimEvent) => { w.events.push(e); };
export const hasFlag = (w: World, f: string) => w.flags.has(f);
export const setFlag = (w: World, f: string) => { w.flags.add(f); };

function shuffle(rng: SeededRng, perm: number[]) {
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}
