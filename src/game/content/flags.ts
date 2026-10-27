// Progression flags. Progression is a set of namespaced string flags on the
// World, not boolean fields on a game object. Naming convention:
//   golem.*     — upgrades / body state of the golem (world-wide for now;
//                 move to the actor when a second golem exists)
//   know.*      — knowledge the golem has acquired
//   tutorial.*  — one-shot tutorial beats
//   rune.*      — teleportation rune sites (rune.<site>.active)
//   npc.<id>.*  — per-NPC runtime state and story progress, namespaced by the
//                 NPC actor's id (npc.guardian.awake, npc.guardian.met, ...).
//                 NPC state never lives under golem.* (that is the player).
export const FLAGS = {
  golemArm: "golem.arm",
  /** The golem's flickering eye has been repaired (by the Treasury Guardian). Unlocks zoom. */
  golemEye: "golem.eye",
  // "golem.basket" (the basket installed on pickup) was retired in save v8: the
  // basket is gear worn in the actor's own back slot (Actor.gear, sim/gear.ts).
  knowSchematic: "know.schematic",
  knowBuild: "know.build",
  knowRepair: "know.repair",
  /** Stonework (the brazier recipe). No book teaches it yet; Ctrl+4 grants it. */
  knowMasonry: "know.masonry",
  /**
   * Gear slot unlocks (content/gear.ts: GEAR_SLOT_DEFS[].unlock). A slot with no
   * unlock requirement is always usable; the ones below are locked until their
   * flag is set. Unlocking a slot later is setting its flag, nothing more.
   */
  slotArmLeft: "golem.slot.armL",
  slotRune1: "golem.slot.rune1",
  slotRune2: "golem.slot.rune2",
  slotRune3: "golem.slot.rune3",
  tutorialInsight: "tutorial.insight",
  /** Set when the golem first travels through the rune network (end of tutorial). */
  tutorialDone: "tutorial.done",
} as const;

export type Flag = string;

/** A flag namespaced by an NPC actor's id: npcFlag("npc.guardian", "met") -> "npc.guardian.met". */
export const npcFlag = (actorId: string, key: string) => `${actorId}.${key}`;
/** Runtime state every NPC has: present = awake, absent = dormant. Reversible by design. */
export const NPC_AWAKE = "awake";
