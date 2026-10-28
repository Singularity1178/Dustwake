// Inner monologue (data). The player golem "thinks" short lines: not dialogue
// (no box, no portrait, the game never pauses) and not a note/toast (those are
// the game talking to the player; a thought is the golem talking to itself).
//
// A line fires in one of three ways, all decided by the sim (sim/monologue.ts):
//   - `on`: an event trigger. When the player's sim event of that type is
//     emitted and its fields equal `match`, the line is considered.
//   - the `think` Effect op ({op: "think", line}): from interaction rules,
//     scheduled effects or dialogue beats, like any other effect.
//   - the `think` command: scripts and cutscenes fire a line by id.
// Whichever way, it then has to pass `once` / `cooldown`, `when` (a Requirement
// on the thinker) and `if` (named conditions, THOUGHT_CONDITIONS in
// sim/monologue.ts). Presentation (ui/monologue.ts) decides how it looks; the
// `tone` and `pace` fields are only hints to it.
//
// Text uses the bitmap font's glyphs (uppercase, no ellipsis character: write
// "..."). A line that ends in "..." is drawn as an ongoing process (its dots
// cycle while it is the newest line). Tests lint every row.
import type { Requirement } from "./interactions";
import type { SimEvent } from "../world/world";

/** How a line is coloured: status (cold, the default), warn (damage, faults), void (an absence; dim and slow). */
export type ThoughtTone = "status" | "warn" | "void";

/** Fire when the thinker's sim event of type `event` is emitted and each `match` field equals the event's. */
export interface ThoughtTrigger {
  event: SimEvent["t"];
  match?: Record<string, string | number | boolean>;
}

export interface ThoughtLine {
  text: string;
  /** Event triggers. Omit for lines that only scripts, cutscenes or `think` effects fire. */
  on?: ThoughtTrigger | ThoughtTrigger[];
  /** Requirement on the thinker (flags, items, actorFlags, worn). */
  when?: Requirement;
  /** Named conditions (sim/monologue.ts: THOUGHT_CONDITIONS), all of which must hold. */
  if?: string[];
  /** Thought at most once per world (saved). Default true; set false for lines that may recur. */
  once?: boolean;
  /** For recurring lines: sim seconds before this line may fire again (saved). */
  cooldown?: number;
  tone?: ThoughtTone;
  /** Typing speed multiplier (presentation hint; 1 = normal, below 1 = slower). */
  pace?: number;
}

export const THOUGHTS: Record<string, ThoughtLine> = {
  // ---- the opening (content/cutscenes.ts fires these by id)
  "intro.assessing": { text: "ASSESSING..." },
  "intro.damage": { text: "MILD DAMAGE DETECTED.", tone: "warn" },
  "intro.arm": { text: "MISSING LEFT ARM.", tone: "warn" },
  "intro.directive": { text: "PRIME DIRECTIVE: NONE.", tone: "void", pace: 0.7 },

  // ---- play
  /** Golem vision (Z): a buildable's pattern was learned. Each analysis emits one `analyzed` per plan, hence the cooldown. */
  "vision.analyzed": { text: "OBJECT ANALYZED.", on: { event: "analyzed" }, once: false, cooldown: 1 },

  // ---- power. Only `manageActor` (E on a worker) diagnoses a body with no core: `subjectNoPower` holds for the
  // unpowered guardian too, and E on it is talk, so a broader trigger would say this about the guardian.
  /** E on the dormant worker golem (or any worker) with no core in it. */
  "golem.dormant": { text: "INTEGRITY INTACT, MISSING POWER SOURCE.", on: { event: "manageActor" }, if: ["subjectNoPower"], once: false, cooldown: 2 },
  /**
   * A body holding a core of its family too weak for it (the guardian given the ruby core): when the core goes in,
   * and on every interaction after. `talkedTo` fires on every talk, segment or idle line, unlike `dialogue`.
   */
  "golem.underpowered": {
    text: "INSUFFICIENT POWER SOURCE.", tone: "warn", once: false, cooldown: 2, if: ["subjectWeakPower"],
    on: [{ event: "manageActor" }, { event: "talkedTo" }, { event: "coreSlotted", match: { inserted: true } }],
  },
};

export const thoughtTriggers = (l: ThoughtLine): ThoughtTrigger[] => (!l.on ? [] : Array.isArray(l.on) ? l.on : [l.on]);
