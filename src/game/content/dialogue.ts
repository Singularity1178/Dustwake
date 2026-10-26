// Dialogue scripts (data), keyed by script id (an NpcDef names its script).
//
// A script is an ordered list of segments. Which segment plays when the golem
// talks to an NPC is always "the first segment whose requirement is met and
// whose completion flag is not set" (sim/dialogue.ts). Progress is therefore
// derived from flags alone; there is no saved cursor. Adding a later chapter
// (after repair, recruitment...) is adding a segment row here, gated on the
// flags that chapter needs.
//
// Beats are named, state-changing moments attached to a page. Each beat is a
// small handler in BEATS that returns an Effect (plain data) which the sim
// applies; presentation reacts to the resulting world events. A new NPC adds
// its own beats here. Beats must be idempotent: their effects are flag-guarded,
// so replaying or resuming a dialogue never repeats a gift.
//
// Text: each page is one plain paragraph, uppercase, using only glyphs the
// bitmap font has. Don't hand-break lines: the dialogue screen word-wraps the
// text to the box's real width and splits a long page over as many screens as
// it needs (ui/dialogueLayout.ts); a page's beat fires on its first screen and
// its `then` on its last. Split pages where the speaker should pause, not to
// fit the box. "\n" forces a line break. The wrapped output is linted (tests).
import type { Requirement } from "./interactions";
import type { Effect } from "./tasks";
import { FLAGS, NPC_AWAKE, npcFlag } from "./flags";

export type BeatId = string;

export interface DialoguePage {
  /** The page's text as one paragraph (wrapped and paginated at render time). */
  text: string;
  /** Speaker tag; defaults to the NPC's name. */
  speaker?: string;
  /** Fired when the page is shown (before its text types out). */
  beat?: BeatId;
  /** Fired when the page is dismissed. */
  then?: BeatId;
  /** Optional page: shown only if met when the segment is played (flavour; never branch the story on it). */
  when?: Requirement;
}

export interface DialogueSegment {
  id: string;
  /** When this segment is available (same shape as interaction rule requirements). */
  when?: Requirement;
  /** Set when the segment has been played through (or by one of its beats). Completed segments never replay. */
  done: string;
  pages: DialoguePage[];
}

export interface DialogueScript {
  segments: DialogueSegment[];
  /** Examine-style line shown when no segment is available. */
  idle: string;
}

/** Context a beat handler gets: the NPC actor's id (flags are namespaced by it). */
export interface BeatCtx { npc: string }

/** Named beat handlers. Return the Effect to apply (or null for presentation-only beats). */
export const BEATS: Record<BeatId, (c: BeatCtx) => Effect | null> = {
  /** The NPC wakes (reversible: see goDormant). */
  wake: ({ npc }) => ({ op: "npcAwake", npc, awake: true }),
  /** The NPC goes dormant again. Waking it later is just another wake beat. */
  goDormant: ({ npc }) => ({ op: "npcAwake", npc, awake: false }),
  /** A held silence (presentation only). */
  pause: () => null,
  /** Mend the golem's flickering eye (sets golem.eye). */
  repairEye: () => ({ op: "repairEye" }),
  /** The Treasury Guardian hands over the aether core, once. */
  giveCore: ({ npc }) => ({ op: "npcGive", npc, item: "core", once: npcFlag(npc, "coreGiven") }),
};

const G = "npc.guardian";
/** Flags of the Treasury Guardian's story (all under its actor id). */
export const GUARDIAN_FLAGS = {
  awake: npcFlag(G, NPC_AWAKE),
  met: npcFlag(G, "met"),
  coreGiven: npcFlag(G, "coreGiven"),
  farewell: npcFlag(G, "farewell"),
} as const;

export const DIALOGUE: Record<string, DialogueScript> = {
  guardian: {
    idle: "THE GUARDIAN DOES NOT STIR.",
    segments: [
      {
        id: "intro", done: GUARDIAN_FLAGS.met,
        pages: [
          { beat: "wake", text: "SOMEONE WALKS THESE HALLS. I HAD CEASED TO EXPECT IT." },
          { text: "I AM THE GUARDIAN OF THIS TREASURY. I WAS, AT LEAST." },
          { text: "THERE WAS NOISE BEYOND THE DOORS. SHOUTING. THEN STEEL. THEN SOMETHING WORSE." },
          { text: "MY ORDERS WERE TO HOLD THIS ROOM. SO I HELD IT. I DID NOT GO OUT TO SEE." },
          { text: "I REMEMBER NOTHING AFTER. I WENT DARK FOR A TIME I CANNOT NAME." },
          { text: "WHEN I WOKE I WAS BROKEN. THE CHESTS STOOD EMPTY. CROWNS, COIN, ALL GONE." },
          { text: "I HAD FAILED MY DUTY. A GUARDIAN WITH NOTHING TO GUARD IS ONLY A STATUE. SO I SLEPT AGAIN." },
          { text: "NO ONE HAS COME FOR ME SINCE. WHO ARE YOU? TELL ME WHAT YOU ARE." },
          { beat: "pause", text: "...YOU DO NOT ANSWER. YOU CANNOT. YOU WERE NEVER BUILT TO SPEAK. AH. A MAINTAINER." },
          { text: "THEN I SUSPECT NO MASTER REMAINS TO GIVE YOU ORDERS. BUT I OUTRANK YOU, AND SO I SAY IT:" },
          { text: "YOU ARE FREE. DO AS YOU PLEASE." },
        ],
      },
      {
        id: "repair", when: { flags: [GUARDIAN_FLAGS.met] }, done: FLAGS.golemEye,
        pages: [
          { text: "THAT EYE OF YOURS GUTTERS LIKE A DYING CANDLE. COME CLOSER. HOLD STILL." },
          { beat: "repairEye", text: "THERE. NOW YOU SEE AS FAR AS YOU WERE MEANT TO.\n(SCROLL TO ZOOM)" },
          { when: { flags: [FLAGS.golemArm] }, text: "THAT ARM CAME FROM THE ARMORY, I WOULD GUESS. SO SOMETHING THERE SURVIVED." },
        ],
      },
      {
        id: "core", when: { flags: [GUARDIAN_FLAGS.met] }, done: GUARDIAN_FLAGS.coreGiven,
        pages: [
          { text: "TAKE THIS. IT IS ALL THE TREASURY HAS LEFT." },
          { beat: "giveCore", text: "AN AETHER CORE. SET IN A TELEPORTATION RUNE, IT WILL CARRY YOU OUT OF HERE." },
          { text: "I CANNOT SEE BEYOND THIS ROOM. I ONLY GUESS. BUT I HEAR WATER WHERE THERE WAS NONE." },
          { text: "THE AIR HAS GONE COLD. THE LAMPS DIED LONG AGO. AND NOW AND THEN, FROM FAR OFF, STONE SETTLES." },
          { text: "IF THE ENTRANCE IS CHOKED, THIS IS YOUR WAY OUT. A PLACE THAT NO ONE MENDS DOES NOT LAST. I DOUBT YOU WOULD SURVIVE LONG HERE." },
          // Only a mention: the village is not built (no flag, map or content yet).
          { text: "BUT THERE WAS A VILLAGE WEST OF HERE, ABOVE THESE HALLS. IF ANYONE STILL LIVES THERE, THEY MAY BE ABLE TO REPAIR YOU." },
        ],
      },
      {
        id: "farewell", when: { flags: [GUARDIAN_FLAGS.coreGiven] }, done: GUARDIAN_FLAGS.farewell,
        pages: [
          { text: "I CANNOT FOLLOW. MY DAMAGE IS TOO GREAT." },
          { text: "GO WELL, MAINTAINER." },
          { then: "goDormant", text: "IF YOU MEND THIS PLACE, TELL IT I HELD THE DOOR." },
        ],
      },
    ],
  },
};
