// How the areas sit on top of each other (data). The surface is laid over the
// buried dungeon with a fixed tile offset: dungeon tile (x, y) lies under
// surface tile (x + dx, y + dy). Both builders read this one constant, so the
// surface's buried entrance and the dungeon's choked SURFACE GATE corridor
// always agree. Pure; no DOM.

/** Dungeon tile -> surface tile offset. */
export const DUNGEON_TO_SURFACE = { dx: 12, dy: 6 } as const;

export const dungeonToSurface = (x: number, y: number) => ({ x: x + DUNGEON_TO_SURFACE.dx, y: y + DUNGEON_TO_SURFACE.dy });
export const surfaceToDungeon = (x: number, y: number) => ({ x: x - DUNGEON_TO_SURFACE.dx, y: y - DUNGEON_TO_SURFACE.dy });

/**
 * The way up to the surface, in dungeon tiles: the south corridor out of the
 * Vestibule (choked with rock until it is dug out from above) and the exit tile
 * marked on the schematic. It was first called the surface gate, and the names
 * keep that; it is a stair (GATE_STAIR below).
 */
export const GATE_CORRIDOR = { x: 34, y: 50, w: 4, h: 5 } as const;
export const GATE_EXIT = { x: 36, y: 55 } as const;

/**
 * The stair itself, in dungeon tiles: the corridor plus the exit row. The halls
 * are the first cellar floor; this flight climbs south to the surface. It is
 * choked with earth and fallen vault until it is dug out from above.
 */
export const GATE_STAIR = { x: GATE_CORRIDOR.x, y: GATE_CORRIDOR.y, w: GATE_CORRIDOR.w, h: GATE_CORRIDOR.h + 1 } as const;

/**
 * Entrances: a way between two areas that has to be opened first (dug out). One
 * world flag says it is open; both portals read it, and opening clears the
 * lower end (sim/digging.ts: openEntrance). `above` is the dig site's prop,
 * `below` what the fall filled.
 */
export interface EntranceDef {
  flag: string;
  above: { area: string; portal: string };
  below: { area: string; portal: string; /** Tiles (rect) that become open floor. */ clear: { x: number; y: number; w: number; h: number }; /** Prop kinds standing in that rect that go with the fall. */ removes: readonly string[]; /** A prop lit once the way is open (daylight down the stair). */ lights?: string };
}
export const ENTRANCES: Record<string, EntranceDef> = {
  surface_stair: {
    flag: "entrance.surface_stair.open",
    above: { area: "surface", portal: "stair_down" },
    below: { area: "dungeon", portal: "stair_up", clear: GATE_STAIR, removes: ["rockpile", "stairfall"], lights: "stairlight" },
  },
};

/** The same entrance in surface tiles (where the arch lies buried). */
export const SURFACE_GATE = dungeonToSurface(GATE_EXIT.x, GATE_EXIT.y);
/** Surface footprint of the buried corridor (tiles), including its walls (x-1 .. x+w). */
export const SURFACE_GATE_CORRIDOR = { ...dungeonToSurface(GATE_CORRIDOR.x, GATE_CORRIDOR.y), w: GATE_CORRIDOR.w, h: GATE_CORRIDOR.h };
/**
 * The entrance zone on the surface: the corridor plus its two buried side walls
 * and the arch at its mouth. Everything in it must stay walkable (tested).
 */
export const SURFACE_GATE_ZONE = {
  x0: SURFACE_GATE_CORRIDOR.x - 1, x1: SURFACE_GATE_CORRIDOR.x + SURFACE_GATE_CORRIDOR.w,
  y0: SURFACE_GATE_CORRIDOR.y - 1, y1: SURFACE_GATE.y + 1,
} as const;

/** What the order screens call an area (bitmap font text). Areas without a row read as their id, uppercased. */
export const AREA_NAMES: Record<string, string> = {
  dungeon: "DUNGEON", surface: "SURFACE",
  // The market town west of the surface and the rooms behind its doors (content/town.ts).
  town: "WESTWAKE", town_smithy: "BLACK ANVIL", town_armory: "GILDED BUCKLER", town_jeweler: "BRIGHT FACET",
  town_tailor: "SILVER NEEDLE", town_tavern: "SUNKEN CROWN", town_guild: "GUILD HALL",
};

/**
 * The old road west. On the surface it leaves through the thicket at these rows
 * (tiles); in the town it comes in under the east gate. Both builders read this,
 * so the two ends of the road always agree.
 */
export const WEST_ROAD = { surface: { y0: 33, y1: 35 }, portal: "west_road" } as const;
