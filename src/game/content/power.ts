// Fuel for an actor's body. This is NOT the gear slot called "core", nor the
// aether core consumed by the tutorial circle.
import type { ItemId } from "./items";

export interface PowerCoreDef {
  family: string;
  tier: number;
  effects?: { speed?: number; harvest?: number };
}

export const POWER_CORES: Partial<Record<ItemId, PowerCoreDef>> = {
  ruby_core: { family: "golem", tier: 1 },
};