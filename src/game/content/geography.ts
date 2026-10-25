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
 * The old SURFACE GATE, in dungeon tiles: the south corridor out of the
 * Vestibule (now choked with rock) and the exit tile marked on the schematic.
 */
export const GATE_CORRIDOR = { x: 34, y: 50, w: 4, h: 5 } as const;
export const GATE_EXIT = { x: 36, y: 55 } as const;

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
