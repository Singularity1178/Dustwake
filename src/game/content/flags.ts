// Progression flags. Progression is a set of namespaced string flags on the
// World, not boolean fields on a game object. Naming convention:
//   golem.*     — upgrades / body state of the golem
//   know.*      — knowledge the golem has acquired
//   tutorial.*  — one-shot tutorial beats
export const FLAGS = {
  golemArm: "golem.arm",
  knowSchematic: "know.schematic",
  tutorialInsight: "tutorial.insight",
} as const;

export type Flag = string;
