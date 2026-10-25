// Tile vocabulary. Pure data + predicates; no DOM.

export const TS = 16;

export const T = {
  WALL: 0, FLOOR: 1, RUBBLE: 2, CRACKED: 3, LOCKED: 4, PILLAR: 5, BARS: 6,
  /** Surface: impassable undergrowth at the edge of the world. */
  THICKET: 7,
  /** Surface: a sinkhole down into the buried dungeon (solid, but light passes). */
  PIT: 8,
} as const;
export type TileId = (typeof T)[keyof typeof T];

/** Floor styles (background art). */
export const FS = {
  FLAG: 0, MARBLE: 1, BRICK: 2, WOOD: 3, COBBLE: 4,
  /** Surface styles. RUIN on a WALL tile bakes as weathered, sunlit masonry. */
  GRASS: 5, DIRT: 6, RUIN: 7,
} as const;

export const isSolidT = (t: number) => t !== T.FLOOR;
export const isOpaqueT = (t: number) =>
  t === T.WALL || t === T.RUBBLE || t === T.CRACKED || t === T.LOCKED || t === T.PILLAR || t === T.THICKET;
/** Tiles that read as wall mass when baking the background (rims, faces, AO). */
export const isWallMassT = (t: number) => t === T.WALL || t === T.LOCKED;

/**
 * Tiles the golem can interact with. Interaction anchors are offsets from the
 * tile's top-left pixel. The sim derives interactables from the grid using this
 * table, so placing a LOCKED or CRACKED tile anywhere makes it interactive.
 */
export interface TileInteractDef {
  kind: "door" | "cracked";
  dx: number;
  dy: number;
  r: number;
  /** Multi-tile features anchor once, on the top tile of a vertical run. */
  anchorTopOfRun?: boolean;
  /** Decal left behind when the tile is opened/cleared. */
  openDecal?: { kind: string; dx: number; dy: number };
  /** Debris decals scattered when broken (relative to the anchor tile, in tiles / px). */
  breakDebris?: { count: number; dxTiles: number; dyTiles: number; w: number; h: number };
}

export const TILE_INTERACT: Partial<Record<number, TileInteractDef>> = {
  [T.LOCKED]: { kind: "door", dx: -2, dy: 10, r: 18, openDecal: { kind: "door_open", dx: 11, dy: -12 } },
  [T.CRACKED]: {
    kind: "cracked", dx: 8, dy: 16, r: 22, anchorTopOfRun: true,
    breakDebris: { count: 26, dxTiles: -2, dyTiles: -0.4, w: 64, h: 40 },
  },
};
