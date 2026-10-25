// Things the golem can build (data). Building requires knowledge flags (books)
// and consumes materials from the builder's pack. Torches are the first
// recipe; walls, repairs and so on are more rows here.
import type { ItemId } from "./items";
import type { Requirement } from "./interactions";
import { FLAGS } from "./flags";

export interface Recipe {
  name: string;
  /** Prop kind created. */
  prop: string;
  cost: { item: ItemId; n: number }[];
  requires: Requirement;
  /** Initial prop state. */
  lit?: boolean;
}

export const RECIPES: Record<string, Recipe> = {
  torch: { name: "TORCH", prop: "torch_post", cost: [{ item: "wood", n: 2 }, { item: "stone", n: 1 }], requires: { flags: [FLAGS.knowBuild] }, lit: true },
};

/** How far (in tiles, Chebyshev) from the builder a placement may be. */
export const BUILD_REACH = 2;
