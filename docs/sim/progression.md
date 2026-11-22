# Progression

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Progression
`world.flags` holds shared progression: `know.schematic`, `know.build`, `tutorial.insight`, `golem.eye` (the guardian's eye repair), rune activation, analysis and relic discovery. Body upgrades (`golem.arm`, `golem.slot.*`) moved to actors in v10; even a legacy `Requirement.flags` body name is checked against the actor being tested, not the player. NPC story state is namespaced by actor id: `npc.guardian.awake`, `met`, `coreGiven`, `farewell`. The ritual's `core`, `carved` and `sockets` describe a world structure and live on its Area.
