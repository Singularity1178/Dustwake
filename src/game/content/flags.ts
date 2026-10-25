// Progression flags. Progression is a set of namespaced string flags on the
// World, not boolean fields on a game object. Naming convention:
//   golem.*     — upgrades / body state of the golem (world-wide for now;
//                 move to the actor when a second golem exists)
//   know.*      — knowledge the golem has acquired
//   tutorial.*  — one-shot tutorial beats
//   rune.*      — teleportation rune sites (rune.<site>.active)
export const FLAGS = {
  golemArm: "golem.arm",
  golemBasket: "golem.basket",
  knowSchematic: "know.schematic",
  knowBuild: "know.build",
  knowRepair: "know.repair",
  tutorialInsight: "tutorial.insight",
  /** Set when the golem first travels through the rune network (end of tutorial). */
  tutorialDone: "tutorial.done",
} as const;

export type Flag = string;
