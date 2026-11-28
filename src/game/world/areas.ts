// Area registry: area id -> deterministic builder. Saves store only per-area
// diffs against these builders, so builders must be deterministic.
import { buildDungeon, type AreaData } from "../map";
import { buildOverworld } from "../overworld";
import { OVERWORLD_ID } from "../content/places";
import { INTERIOR_BUILDERS } from "../townInteriors";

export const AREAS: Record<string, () => AreaData> = {
  dungeon: buildDungeon,
  // The overworld: one continuous surface made of sites (overworld.ts): Westwake, the old road, the ruins.
  // Westwake is a zone of it (world/zones.ts), not an area of its own.
  [OVERWORLD_ID]: buildOverworld,
  // The six rooms behind Westwake's shop doors: under a roof, so areas of their own.
  ...INTERIOR_BUILDERS,
};
