// The teleportation rune network (data). Each node is a rune site: a prop with
// a stable id in some area, plus the flag that says whether it is lit. Links
// are declared once and are bidirectional unless `oneWay`. Arrival positions
// are derived from the destination rune's prop (plus an offset), never
// hard-coded coordinates, so moving a rune in its builder just works.
import type { Facing } from "../golem";

export interface RuneNode {
  id: string;
  area: string;
  /** Prop id of the rune site in that area. */
  prop: string;
  /** Flag set while this rune is active (rune.<id>.active). */
  flag: string;
  /** Where an arriving traveller is placed, relative to the rune prop, and which way they face. */
  arrive: { dx: number; dy: number; facing: Facing };
  name: string;
}

export interface RuneLink {
  a: string;
  b: string;
  /** Travel only a -> b. */
  oneWay?: boolean;
  /** Arriving through this link wakes a dormant destination (the surface rune mends itself). */
  awakens?: boolean;
}

export const RUNE_NODES: Record<string, RuneNode> = {
  // The tutorial's translocation circle. Arrivals land just south of the
  // circle, well outside the stand-on radius, so arriving can't re-trigger it.
  dungeon: { id: "dungeon", area: "dungeon", prop: "rune.dungeon", flag: "rune.dungeon.active", arrive: { dx: 0, dy: 30, facing: "down" }, name: "TRANSLOCATION ROOM" },
  surface: { id: "surface", area: "surface", prop: "rune.surface", flag: "rune.surface.active", arrive: { dx: 0, dy: 4, facing: "down" }, name: "THE SURFACE" },
};

export const RUNE_LINKS: RuneLink[] = [{ a: "dungeon", b: "surface", awakens: true }];

/** The rune node whose prop is `propId` in `area`, if any. */
export function runeAt(area: string, propId: string): RuneNode | undefined {
  for (const n of Object.values(RUNE_NODES)) if (n.area === area && n.prop === propId) return n;
  return undefined;
}

/** Where travelling from `id` leads, and through which link. */
export function runeDestinations(id: string): { node: RuneNode; link: RuneLink }[] {
  const out: { node: RuneNode; link: RuneLink }[] = [];
  for (const link of RUNE_LINKS) {
    if (link.a === id && RUNE_NODES[link.b]) out.push({ node: RUNE_NODES[link.b], link });
    if (link.b === id && !link.oneWay && RUNE_NODES[link.a]) out.push({ node: RUNE_NODES[link.a], link });
  }
  return out;
}
export const runeDestination = (id: string, to?: string) => runeDestinations(id).find((d) => !to || d.node.id === to) ?? null;
