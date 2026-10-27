// Interaction rules (data). For each interactable kind, the first rule whose
// requirement is met decides which task the golem performs. Kinds with
// bespoke branching (sockets, which can open the glyph picker; runes, whose
// rule set depends on that rune's own flag) pick a rule list in
// sim/interact.ts; everything else is described here.
import type { ItemId } from "./items";
import type { Effect, TaskSpec } from "./tasks";
import { FLAGS } from "./flags";

export interface Requirement {
  items?: ItemId[];
  flags?: string[];
  /** Body upgrades of the actor being checked, never another actor's flags. */
  actorFlags?: string[];
  /** Items the actor must be wearing (Actor.gear, any slot), e.g. the basket on its back. */
  worn?: ItemId[];
}
export interface Rule { when?: Requirement; task: TaskSpec }

export const RULES: Record<string, Rule[]> = {
  item: [{ task: { kind: "reach", dur: 0.45, effect: { op: "takeLoose" } } }],
  propItem: [{ task: { kind: "reach", dur: 0.45, effect: { op: "takePropItem" } } }],
  container: [{ task: { kind: "reach", dur: 0.6, effect: { op: "openContainer" } } }],
  door: [
    { when: { items: ["key"] }, task: { kind: "reach", dur: 0.9, effect: { op: "unlockTile", consume: "key" } } },
    { task: { kind: "reach", dur: 0.5, effect: { op: "cue", cue: "clank" } } },
  ],
  // Cracked walls only break under the attack (SLAM_RULES below). E pushes (the old shudder) and says so.
  cracked: [
    { when: { actorFlags: [FLAGS.golemArm] }, task: { kind: "push", dur: 0.7, effect: { op: "message", text: "IT WON'T PUSH. A HEAVY BLOW WILL BREAK IT (SPACE)", cue: "push" } } },
    { task: { kind: "push", dur: 0.7, effect: { op: "message", text: "IT SHIFTS, BUT HOLDS. IT NEEDS A HEAVY BLOW (SPACE)", cue: "push" } } },
  ],
  center: [
    { when: { items: ["core"] }, task: { kind: "reach", dur: 0.6, effect: { op: "placeCore", consume: "core" } } },
    { task: { kind: "reach", dur: 0.4, effect: { op: "cue", cue: "scrape" } } },
  ],
  gap: [
    { when: { items: ["chisel"], flags: [FLAGS.knowSchematic] }, task: { kind: "carve", dur: 3.2, effect: { op: "carveGap" } } },
    { task: { kind: "reach", dur: 0.5, effect: { op: "cue", cue: "scrapeDust" } } },
  ],
  socketFilled: [{ task: { kind: "reach", dur: 0.45, effect: { op: "takeGlyph" } } }],
  socketEmpty: [{ task: { kind: "reach", dur: 0.4, effect: { op: "cue", cue: "scrape" } } }],
  // ---- rune network
  /** An active rune: channel, then travel. The first jump (end of tutorial) is the long cinematic one. */
  rune: [
    { when: { flags: [FLAGS.tutorialDone] }, task: { kind: "channel", dur: 2.2, effect: { op: "travel" } } },
    { task: { kind: "channel", dur: 4.6, effect: { op: "travel" } } },
  ],
  runeDormant: [{ task: { kind: "reach", dur: 0.5, effect: { op: "message", text: "THE RUNE IS DARK AND SILENT", cue: "dud" } } }],
  // ---- surface
  harvest: [{ task: { kind: "punch", dur: 0.75, effect: { op: "harvest" } } }],
  examine: [{ task: { kind: "reach", dur: 0.4, effect: { op: "examine" } } }],
  // ---- work stations (props with a `station`, e.g. the crafting bench)
  station: [{ task: { kind: "reach", dur: 0.35, effect: { op: "useStation" } } }],
  storage: [{ task: { kind: "reach", dur: 0.35, effect: { op: "useStorage" } } }],
  worker: [{ task: { kind: "reach", dur: 0.3, effect: { op: "manageActor" } } }],
  // ---- NPCs: any actor of kind "npc". The target carries its actor id and NpcDef id;
  // what is said comes from that NPC's dialogue script (content/dialogue.ts).
  npc: [{ task: { kind: "talk", dur: 0.3, effect: { op: "talk" } } }],
};

/** The attack (Space): a two-arm ground slam. Always the same task; what it does is decided by SLAM_RULES. */
export const SLAM_TASK: TaskSpec = { kind: "slam", dur: 1.1 };

/**
 * What the attack does to a slammable thing, by kind. When the blow lands
 * (sim/tasks.ts, op "slam"), everything of these kinds within SLAM_RADIUS of
 * the fists is hit, and for each the first rule whose requirement is met gives
 * the effect applied to it. Kinds without rules, and empty ground, just take
 * the blow: the slam plays in full and nothing changes. Interacting (E) is
 * separate: RULES above.
 */
export const SLAM_RULES: Record<string, { when?: Requirement; then: Effect }[]> = {
  cracked: [
    { when: { actorFlags: [FLAGS.golemArm] }, then: { op: "breakTile" } },
    // The broken stub puts no weight behind the blow: the debris takes the hit and holds.
    { then: { op: "withstand", text: "IT HOLDS. ONE GOOD ARM IS NOT ENOUGH" } },
  ],
};
