// Area registry: area id -> deterministic builder. Saves store only per-area
// diffs against these builders, so builders must be deterministic.
import { buildDungeon, type AreaData } from "../map";
import { buildSurface } from "../surface";
import { buildTown } from "../town";
import { INTERIOR_BUILDERS } from "../townInteriors";

export const AREAS: Record<string, () => AreaData> = {
  dungeon: buildDungeon,
  surface: buildSurface,
  // Westwake, the market town west of the surface, and the six rooms behind its shop doors.
  town: buildTown,
  ...INTERIOR_BUILDERS,
};
