// Bodies and abilities, not player/NPC classes. A worker is an optional
// capability; dialogue identity and presentation state live elsewhere.
import { CAPACITY_TIERS, type CapacityTier } from "./inventory";
import { GEAR_SLOTS, GEAR_SLOT_DEFS, type GearSlot } from "./gear";
import type { Requirement } from "./interactions";

export interface ActorDef {
  name: string;
  body: { box: [number, number]; height: number; reach: number };
  art: { key: string; scale?: number };
  speed: number;
  speedTiers?: { requires: Requirement; speed: number }[];
  harvestPower: number;
  inventory: { slots: number; tiers?: CapacityTier[] };
  gearSlots: readonly GearSlot[];
  /** Locks belong to a body definition, not to the slot vocabulary. */
  gearUnlocks?: Partial<Record<GearSlot, Requirement>>;
  power?: { family: string; tier: number };
  capabilities: readonly string[];
  eyeLight?: { dx: number; dy: number; rad: number; col: [number, number, number] };
}

export const ACTORS: Record<string, ActorDef> = {
  golem: {
    name: "MAINTAINER", body: { box: [10, 5], height: 24, reach: 20 }, art: { key: "golem" },
    speed: 24, speedTiers: [{ requires: { actorFlags: ["golem.arm"] }, speed: 30 }], harvestPower: 1,
    inventory: { slots: 8, tiers: CAPACITY_TIERS }, gearSlots: GEAR_SLOTS,
    gearUnlocks: Object.fromEntries(GEAR_SLOT_DEFS.flatMap((d) => d.unlock ? [[d.id, d.unlock]] : [])),
    capabilities: ["move", "harvest", "craft", "build", "travel", "scan", "attack"],
  },
  guardian: {
    name: "TREASURY GUARDIAN", body: { box: [24, 10], height: 44, reach: 24 }, art: { key: "guardian" },
    speed: 0, harvestPower: 2, inventory: { slots: 0 }, gearSlots: ["core"],
    power: { family: "golem", tier: 3 }, capabilities: ["talk"],
    eyeLight: { dx: 0, dy: -24, rad: 46, col: [0.5, 0.85, 1] },
  },
  // Foundation fixtures only: neither worker is placed by a production builder.
  worker_golem: {
    name: "LESSER GOLEM", body: { box: [8, 4], height: 20, reach: 18 }, art: { key: "golem", scale: 0.85 },
    speed: 16, harvestPower: 0.5, inventory: { slots: 8 }, gearSlots: ["rune0"],
    power: { family: "golem", tier: 1 }, capabilities: ["move", "harvest", "craft", "travel", "worker"],
  },
  npc_worker: {
    name: "WORKER", body: { box: [8, 6], height: 22, reach: 18 }, art: { key: "human" },
    speed: 20, harvestPower: 0.75, inventory: { slots: 8 }, gearSlots: ["head", "back", "armR", "armL"],
    capabilities: ["move", "harvest", "craft", "travel", "worker"],
  },
};

export function actorDef(a: { definition: string }): ActorDef {
  const d = ACTORS[a.definition];
  if (!d) throw new Error(`unknown actor definition "${a.definition}"`);
  return d;
}
export const capable = (a: { definition: string }, capability: string) => actorDef(a).capabilities.includes(capability);