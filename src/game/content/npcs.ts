// Dialogue identities (data), keyed by NPC id. Bodies and art are ACTORS rows.
// An NPC in the world is an ordinary
// Actor of kind "npc" whose `npc` field names its row here; everything that
// makes it *this* NPC (name, dialogue, sprite, body) comes from the row, so the
// sim, the interaction path and the renderer never branch on a particular NPC.
//
// Two kinds are planned:
//   "special" — hand-authored identity: own name, dialogue script, sprite and
//               story arc (the Treasury Guardian is the first).
//   "generic" — archers, warriors, mages... with randomized looks, stats and
//               personality. NOT implemented yet: when it is, it adds its own
//               fields (archetype, stats, ...) to the union; nothing here
//               should be stretched to fit it.

/** Only "special" exists today; "generic" joins the union with the generic-NPC work. */
export type NpcType = "special";

export interface NpcDef {
  /** Display name (dialogue speaker tag). Uppercase: the bitmap font is uppercase only. */
  name: string;
  type: NpcType;
  /** Dialogue script id (content/dialogue.ts). */
  dialogue: string;
  /** Unified actor definition (content/actors.ts). */
  actor: string;
}

export const NPCS: Record<string, NpcDef> = {
  guardian: {
    name: "TREASURY GUARDIAN", type: "special", dialogue: "guardian", actor: "guardian",
  },
};

export const npcDef = (id: string | undefined): NpcDef | undefined => (id ? NPCS[id] : undefined);
