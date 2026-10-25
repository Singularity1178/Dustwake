// Rune glyph definitions (data). Art reads `pat`; sim/lights read `color`.

export interface GlyphDef { name: string; color: string; dark: string; pat: string[] }

export const GLYPHS: GlyphDef[] = [
  { name: "SUN GLYPH", color: "#ffc94a", dark: "#8a5a10", pat: ["..###..", ".#...#.", "#..#..#", "#.###.#", "#..#..#", ".#...#.", "..###.."] },
  { name: "TIDE GLYPH", color: "#5ab0ff", dark: "#1a4a8a", pat: [".......", "..#...#", ".#.#.#.", "#...#..", "..#...#", ".#.#.#.", "#...#.."] },
  { name: "GALE GLYPH", color: "#c8f0ff", dark: "#4a7088", pat: ["#######", "......#", ".####.#", ".#..#.#", ".#.##.#", ".#....#", ".######"] },
  { name: "ROOT GLYPH", color: "#7fd65a", dark: "#2a6a1a", pat: ["...#...", "...#...", ".#.#.#.", "..###..", "...#...", "..#.#..", ".#...#."] },
];

export function hexToCol(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
