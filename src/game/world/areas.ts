// Area registry: area id -> deterministic builder. Adding the surface means
// adding an entry here (plus its builder). Saves store only per-area diffs
// against these builders, so builders must be deterministic.
import { buildDungeon, type AreaData } from "../map";

export const AREAS: Record<string, () => AreaData> = {
  dungeon: buildDungeon,
};
