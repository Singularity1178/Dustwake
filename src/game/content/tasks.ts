// Work vocabulary. A Task is a timed piece of work an actor performs; when it
// reaches its fire point it applies one Effect to the world. Tasks and effects
// are plain data (no closures) so in-progress work can be saved, queued and
// performed by any actor — today only the golem, later NPCs and animals.
import type { ItemId } from "./items";

export type TaskKind = "reach" | "push" | "attach" | "smash" | "carve";

/** When a task's effect fires, as a function of its duration. */
export const TASK_KINDS: Record<TaskKind, { fire: (dur: number) => number }> = {
  reach: { fire: (d) => d * 0.55 },
  push: { fire: (d) => d * 0.55 },
  attach: { fire: () => 0.9 },
  smash: { fire: () => 0.62 },
  carve: { fire: (d) => d - 0.2 },
};

/** Presentation-only cues an effect can request (sound/particles). */
export type Cue = "clank" | "scrape" | "scrapeDust" | "push";

export type Effect =
  | { op: "cue"; cue: Cue }
  | { op: "takeLoose" }
  | { op: "takePropItem" }
  | { op: "openContainer" }
  | { op: "grantItem"; item: ItemId }
  | { op: "equip"; item: ItemId }
  | { op: "unlockTile"; consume?: ItemId }
  | { op: "breakTile" }
  | { op: "placeCore"; consume: ItemId }
  | { op: "carveGap" }
  | { op: "takeGlyph" }
  | { op: "checkRune" };

/** What a task is aimed at. Plain data so it serialises. */
export interface Target {
  kind: string;
  x: number;
  y: number;
  propId?: string;
  looseId?: string;
  tx?: number;
  ty?: number;
  socket?: number;
}

export interface TaskSpec { kind: TaskKind; dur: number; effect?: Effect }

export interface Task extends TaskSpec {
  t: number;
  fired: boolean;
  target?: Target;
}
