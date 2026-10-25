// Geometry of the translocation circle (the future surface<->dungeon link).

export const SOCKET_R = 50;
export const SOCKET_COUNT = 4;

export function socketPositions(c: { x: number; y: number }) {
  return [
    { x: c.x, y: c.y - SOCKET_R },
    { x: c.x + SOCKET_R, y: c.y },
    { x: c.x, y: c.y + SOCKET_R },
    { x: c.x - SOCKET_R, y: c.y },
  ];
}

export const RITUAL_SPOTS = {
  socket: { dy: 6, r: 18 },
  center: { r: 13 },
  gap: { dx: 38, dy: 38, r: 20 },
  /** Standing within sqrt(81)px of (c.x, c.y + 2) after activation teleports. */
  teleport: { dy: 2, r2: 81, delay: 3 },
};
