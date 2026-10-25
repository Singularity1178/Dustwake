// Interaction rules (data). For each interactable kind, the first rule whose
// requirement is met decides which task the golem performs. Kinds with
// bespoke branching (sockets, which can open the glyph picker) are handled in
// sim/interact.ts; everything else is described here.
import type { ItemId } from "./items";
import type { TaskSpec } from "./tasks";
import { FLAGS } from "./flags";

export interface Requirement { items?: ItemId[]; flags?: string[] }
export interface Rule { when?: Requirement; task: TaskSpec }

export const RULES: Record<string, Rule[]> = {
  item: [{ task: { kind: "reach", dur: 0.45, effect: { op: "takeLoose" } } }],
  propItem: [{ task: { kind: "reach", dur: 0.45, effect: { op: "takePropItem" } } }],
  container: [{ task: { kind: "reach", dur: 0.6, effect: { op: "openContainer" } } }],
  door: [
    { when: { items: ["key"] }, task: { kind: "reach", dur: 0.9, effect: { op: "unlockTile", consume: "key" } } },
    { task: { kind: "reach", dur: 0.5, effect: { op: "cue", cue: "clank" } } },
  ],
  cracked: [
    { when: { flags: [FLAGS.golemArm] }, task: { kind: "smash", dur: 1.2, effect: { op: "breakTile" } } },
    { task: { kind: "push", dur: 0.7, effect: { op: "cue", cue: "push" } } },
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
};
