// Tile vocabulary. Pure data + predicates; no DOM.

export const TS = 16;

export const T = {
  WALL: 0, FLOOR: 1, RUBBLE: 2, CRACKED: 3, LOCKED: 4, PILLAR: 5, BARS: 6,
  /** Surface: impassable undergrowth at the edge of the world. */
  THICKET: 7,
  // 8 was PIT (surface sinkholes into the dungeon); retired, the dungeon is hidden now.
  /**
   * Town: the street-level storey of a building front. Solid like a wall, but it
   * does not block light, so a lamp in the street lights the whole of a
   * two-storey front (the wall mass behind it still stops the light).
   */
  FRONT: 9,
} as const;
export type TileId = (typeof T)[keyof typeof T];

/** Floor styles (background art). */
export const FS = {
  FLAG: 0, MARBLE: 1, BRICK: 2, WOOD: 3, COBBLE: 4,
  /** Surface ground styles (7 was RUIN, the keep's masonry; retired). */
  GRASS: 5, DIRT: 6,
  /** Soft cushion moss (damp ground, buried stone). */
  MOSS: 8,
  /** Fallen leaves under the trees. */
  LEAF: 9,
  /** Wet mud in damp hollows. */
  MUD: 10,
  /** Bare, packed earth (heaped soil over the buried halls; spilled earth below ground). */
  EARTH: 11,
  // ---- the market town (pixels in art/tilesTown.ts)
  /** Dressed stone setts: the lit, well-kept streets and the market square's border. */
  SETT: 12,
  /** Basket-weave brick paving: the market square. */
  WEAVE: 13,
  /** Broad, waxed floorboards (the tavern, the tailor). */
  BOARD: 14,
  /** Pale glazed tiles with dark insets (the high-end shops). */
  TILE: 15,
} as const;

/**
 * Wall styles: the `style` of a WALL tile picks what its face (and, for the
 * rampart, its top) is built of. Anything below 20 is the dungeon's masonry.
 */
export const WS = {
  /** Limewashed plaster over a timber wainscot. */
  PLASTER: 20,
  /** Warm dressed ashlar. */
  STONE: 21,
  /** Dark oak panelling. */
  PANEL: 22,
  /** Soot-stained brick. */
  BRICK: 23,
  /** The town wall, outdoors: a mossy ashlar face and a paved wall-walk on top. */
  RAMPART: 24,
} as const;

/** Natural ground styles: they bake with organic, noise-warped borders between each other. */
export const isGroundFS = (s: number) => s === FS.GRASS || s === FS.DIRT || s === FS.MOSS || s === FS.LEAF || s === FS.MUD || s === FS.EARTH;

export const isSolidT = (t: number) => t !== T.FLOOR;
export const isOpaqueT = (t: number) =>
  t === T.WALL || t === T.RUBBLE || t === T.CRACKED || t === T.LOCKED || t === T.PILLAR || t === T.THICKET;
/**
 * Tiles that read as wall mass when baking the background (rims, faces, AO).
 * A cracked wall is still wall until it is broken: it is as thick as the wall
 * it stands in, the wall above it shows no face, and the floor beside it is
 * shaded as beside any wall.
 */
export const isWallMassT = (t: number) => t === T.WALL || t === T.LOCKED || t === T.FRONT || t === T.CRACKED;

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
