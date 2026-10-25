// Work vocabulary. A Task is a timed piece of work an actor performs; when it
// reaches its fire point it applies one Effect to the world. Tasks and effects
// are plain data (no closures) so in-progress work can be saved, queued and
// performed by any actor — today only the golem, later NPCs and animals.
import type { ItemId } from "./items";

export type TaskKind = "reach" | "push" | "attach" | "smash" | "carve" | "punch" | "channel" | "talk";

/** When a task's effect fires, as a function of its duration. */
export const TASK_KINDS: Record<TaskKind, { fire: (dur: number) => number }> = {
  reach: { fire: (d) => d * 0.55 },
  push: { fire: (d) => d * 0.55 },
  attach: { fire: () => 0.9 },
  smash: { fire: () => 0.62 },
  carve: { fire: (d) => d - 0.2 },
  /** Harvesting with fists: the blow lands just past half way. */
  punch: { fire: (d) => d * 0.5 },
  /** Rune travel: the jump happens at the very end of the channel. */
  channel: { fire: (d) => d },
  /** Addressing an NPC: the dialogue opens once the golem has turned to it. */
  talk: { fire: (d) => d },
};

/** Presentation-only cues an effect can request (sound/particles). */
export type Cue = "clank" | "scrape" | "scrapeDust" | "push" | "dud";

export type Effect =
  | { op: "cue"; cue: Cue }
  | { op: "message"; text: string; cue?: Cue }
  | { op: "examine" }
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
  | { op: "checkRune" }
  /** Drop n units from an inventory slot onto the ground in front of the actor. */
  | { op: "drop"; slot: number; n: number }
  /** Travel through the rune at target.propId to its linked rune. */
  | { op: "travel" }
  /** One blow against a harvestable prop (target.propId). */
  | { op: "harvest" }
  /** Regrowth hook for harvestables with a `regrow` time (none in v1). */
  | { op: "regrow"; prop: string }
  /** Build a recipe at a tile, consuming its cost from the actor's pack. */
  | { op: "build"; recipe: string; tx: number; ty: number }
  /** Gain a knowledge flag (reading a book). */
  | { op: "learn"; flag: string }
  // ---- NPCs and dialogue (sim/dialogue.ts). The NPC is named by its actor id.
  /** Talk to the NPC actor at target.actorId: opens its first available dialogue segment, else its idle line. */
  | { op: "talk" }
  /** Set an NPC's reversible awake/dormant state (flag npc.<id>.awake). */
  | { op: "npcAwake"; npc: string; awake: boolean }
  /** Mend the golem's eye (golem.eye). Idempotent. */
  | { op: "repairEye" }
  /** An NPC gives the actor an item, at most once (guarded by the `once` flag). Overflow lands on the ground. */
  | { op: "npcGive"; npc: string; item: ItemId; once: string }
  /** A dialogue segment has been played through: set its completion flag. */
  | { op: "segmentDone"; npc: string; segment: string; flag: string };

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
  /** Target actor (NPCs). */
  actorId?: string;
  /** NpcDef id of the target actor (content/npcs.ts). */
  npc?: string;
}

export interface TaskSpec { kind: TaskKind; dur: number; effect?: Effect }

export interface Task extends TaskSpec {
  t: number;
  fired: boolean;
  target?: Target;
  /** Area the task was started in. A task never fires in a different area (see enterArea / tickTask). */
  area?: string;
}
