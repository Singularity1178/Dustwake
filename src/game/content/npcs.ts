// NPC definitions (data), keyed by NPC id. An NPC in the world is an ordinary
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
  /** Sprite key (NPC_ART in npcArt.ts). */
  art: string;
  /** Collision footprint [w, h] in px, centred on x, ending at the actor's feet (y). Same convention as prop boxes. */
  box: [number, number];
  /** Talk radius (px) around the actor's anchor. */
  reach: number;
  /** Sprite height above the feet (px): where the interaction marker floats. */
  height: number;
  /** Where the eye light sits relative to the feet while awake (presentation; drawn through the light registry). */
  eyeLight?: { dx: number; dy: number; rad: number; col: [number, number, number] };
}

export const NPCS: Record<string, NpcDef> = {
  guardian: {
    name: "TREASURY GUARDIAN", type: "special", dialogue: "guardian", art: "guardian",
    box: [24, 10], reach: 24, height: 44,
    eyeLight: { dx: 0, dy: -24, rad: 46, col: [0.5, 0.85, 1] },
  },
};

export const npcDef = (id: string | undefined): NpcDef | undefined => (id ? NPCS[id] : undefined);
