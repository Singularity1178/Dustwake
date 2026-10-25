// Shared geometry between the buried dungeon and the surface above it (data).
//
// The surface sits on top of the dungeon: dungeon tile (x, y) lies under
// surface tile (x + dx, y + dy). Both builders read this one constant so the
// buried entrance on the surface and the collapsed corridor below agree.

/** Dungeon tile -> surface tile offset. */
export const DUNGEON_TO_SURFACE = { dx: 12, dy: 6 } as const;

export const toSurface = (x: number, y: number) => ({ x: x + DUNGEON_TO_SURFACE.dx, y: y + DUNGEON_TO_SURFACE.dy });

/**
 * The old SURFACE GATE corridor, in dungeon tiles: the collapsed passage
 * (x0..x1, y0..y1, inclusive) and the exit marker on the schematic.
 */
export const GATE_CORRIDOR = { x0: 34, y0: 50, x1: 37, y1: 54, exit: { x: 36, y: 55 } } as const;

/** The same corridor, in surface tiles (where its buried outline lies). */
export const SURFACE_GATE = {
  x0: GATE_CORRIDOR.x0 + DUNGEON_TO_SURFACE.dx,
  y0: GATE_CORRIDOR.y0 + DUNGEON_TO_SURFACE.dy,
  x1: GATE_CORRIDOR.x1 + DUNGEON_TO_SURFACE.dx,
  y1: GATE_CORRIDOR.y1 + DUNGEON_TO_SURFACE.dy,
  /** Where the buried arch lies (the corridor's exit, under the surface). */
  arch: toSurface(GATE_CORRIDOR.exit.x, GATE_CORRIDOR.exit.y),
} as const;
