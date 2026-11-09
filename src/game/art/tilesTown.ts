// Per-pixel tile styles of the market town: its pavings and floors (FS.SETT and
// up) and what its walls are built of (WS.*). art/tiles.ts calls in here for
// styles it does not know, so the dungeon's and the wild's pixels never move.
// Presentation only.
import { TS, FS, WS } from "../content/tiles";
import { hash2 } from "../util";

type C3 = [number, number, number];

/** Town pavings and floors. Null for a style that is not one of them. `n` is the bake's per-pixel grain. */
export function townFloorPix(style: number, tx: number, ty: number, lx: number, ly: number, n: number): C3 | null {
  const wx = tx * TS + lx, wy = ty * TS + ly;
  switch (style) {
    case FS.SETT: {
      // dressed setts in running bond; the odd one sunk, the odd one polished pale by feet
      const row = Math.floor(wy / 5), off = row & 1 ? 4 : 0;
      const u = (wx + off) % 8, v = wy % 5;
      if (u === 7 || v === 4) return [40 + n * 0.3, 37, 36];
      const b = Math.floor((wx + off) / 8);
      const t = (hash2(b, row, 61) - 0.5) * 20;
      const k = (u === 0 || v === 0 ? 9 : 0) + (hash2(b, row, 62) < 0.07 ? -14 : 0) + (hash2(b, row, 63) > 0.93 ? 10 : 0);
      return [98 + t + n + k, 92 + t + n + k, 84 + t * 0.9 + n + k];
    }
    case FS.WEAVE: {
      // basket-weave brick: pairs of bricks, turned a quarter each block
      const bx = wx >> 3, by = wy >> 3, hz = (bx + by) & 1, u = wx & 7, v = wy & 7;
      if (hz ? v === 3 || v === 7 || u === 7 : u === 3 || u === 7 || v === 7) return [44, 34, 30];
      const id = hz ? v >> 2 : u >> 2;
      const t = (hash2(bx * 2 + id, by * 2 + hz, 64) - 0.5) * 26;
      const k = (hash2(bx * 2 + id, by, 65) < 0.1 ? -16 : 0) + ((hz ? v === 0 || v === 4 : u === 0 || u === 4) ? 8 : 0);
      return [118 + t + n + k, 78 + t * 0.7 + n + k, 60 + t * 0.5 + n + k];
    }
    case FS.BOARD: {
      // broad waxed boards laid east-west; butt joints staggered board to board, a nail either side
      const row = Math.floor(wy / 6);
      if (wy % 6 === 5) return [44, 29, 18];
      const q = (wx + Math.floor(hash2(row, 1, 66) * 40)) % 40;
      const seg = Math.floor((wx + Math.floor(hash2(row, 1, 66) * 40)) / 40);
      if (q === 0) return [48, 32, 20];
      const g = Math.sin(wx * 0.45 + hash2(seg, row, 67) * 30 + Math.sin(wy * 0.9) * 0.6) * 5;
      const t = (hash2(seg, row, 68) - 0.5) * 20;
      const k = ((q === 2 || q === 38) && wy % 6 === 2 ? -30 : 0) + (wy % 6 === 0 ? 7 : 0);
      return [116 + g + t + n * 0.6 + k, 82 + g * 0.7 + t * 0.75 + n * 0.5 + k, 50 + g * 0.5 + t * 0.5 + n * 0.4 + k * 0.6];
    }
    case FS.TILE: {
      // pale glazed tiles laid square, a small dark inset where four corners meet
      const u = wx & 7, v = wy & 7;
      if ((u === 7 || u === 0) && (v === 7 || v === 0)) return [50, 40, 62];
      if (u === 7 || v === 7) return [104, 98, 92];
      const t = (hash2(wx >> 3, wy >> 3, 69) - 0.5) * 12;
      const k = (Math.abs(((wx + wy) % 23) - 11) < 1 ? 6 : 0) + (u === 0 || v === 0 ? 6 : 0);
      return [150 + t + n * 0.5 + k, 144 + t + n * 0.5 + k, 132 + t + n * 0.5 + k];
    }
  }
  return null;
}

/** The south face of a town wall tile (16 px, top to bottom), by wall style. */
export function townWallFacePix(st: number, tx: number, ty: number, lx: number, ly: number): C3 {
  const wx = tx * TS + lx;
  const n = (hash2(wx, ty * 16 + ly, 8) - 0.5) * 8;
  switch (st) {
    case WS.PLASTER: {
      // oak top plate, limewash between studs, a boarded wainscot below the rail
      if (ly < 2) return ly === 0 ? [88, 62, 38] : [50, 34, 20];
      if (lx === 0 || lx === 15) return ly < 10 ? [60, 42, 26] : [46, 32, 20];
      if (ly < 9) {
        const stain = hash2(wx >> 2, ty * 4 + (ly >> 2), 81) < 0.12 ? -14 : 0;
        return [190 + n + stain - ly * 1.5, 178 + n + stain - ly * 1.5, 146 + n * 0.8 + stain - ly];
      }
      if (ly === 9) return [104, 74, 46];
      if (ly === 15) return [28, 20, 14];
      const seam = wx % 4 === 3 ? -22 : 0;
      return [82 + n + seam, 58 + n * 0.8 + seam, 36 + n * 0.6 + seam * 0.6];
    }
    case WS.PANEL: {
      // dark oak panelling: a cornice, framed panels, a dado rail
      if (ly === 0) return [112, 80, 50];
      if (ly === 1) return [40, 28, 18];
      if (ly === 9) return [98, 70, 44];
      if (ly === 15) return [22, 16, 12];
      const u = wx % 8;
      if (u === 0) return [36, 25, 17];
      if (u === 1 || ly === 2 || ly === 10) return [92, 66, 42];
      if (u === 7 || ly === 8 || ly === 14) return [44, 31, 20];
      const g = Math.sin(ly * 1.3 + hash2(wx >> 3, ty, 82) * 9) * 4;
      return [68 + g + n * 0.6, 48 + g * 0.7 + n * 0.5, 30 + g * 0.5 + n * 0.4];
    }
    case WS.BRICK: {
      // brick in stretcher bond, blackened toward the ceiling
      if (ly === 0) return [96, 84, 76];
      if (ly === 1) return [34, 26, 24];
      const r = Math.floor((ly - 2) / 3), off = r & 1 ? 3 : 0;
      if ((wx + off) % 6 === 5 || (ly - 2) % 3 === 2) return [38, 28, 26];
      const b = Math.floor((wx + off) / 6);
      const t = (hash2(b, ty * 7 + r, 83) - 0.5) * 26;
      const soot = Math.max(0, 7 - ly) * 5 + (hash2(wx >> 2, ty, 84) < 0.3 ? 8 : 0);
      return [118 + t + n - soot, 68 + t * 0.6 + n - soot * 0.7, 52 + t * 0.4 + n - soot * 0.6];
    }
    case WS.RAMPART: {
      // big weathered ashlar, moss creeping up from the foot
      if (ly < 2) return ly === 0 ? [132, 126, 116] : [96, 90, 84];
      const r = Math.floor((ly - 2) / 7), off = r & 1 ? 8 : 0;
      if ((wx + off) % 16 === 15 || (ly - 2) % 7 === 6) return [36, 33, 32];
      const b = Math.floor((wx + off) / 16);
      const t = (hash2(b, ty * 3 + r, 85) - 0.5) * 22;
      if (ly > 9 && hash2(wx, ty * 16 + ly, 86) < (ly - 9) * 0.1) return [54 + n, 78 + n, 44 + n];
      return [106 + t + n, 100 + t + n, 92 + t + n];
    }
  }
  // WS.STONE: warm dressed ashlar with a moulded cap
  if (ly === 0) return [150, 140, 124];
  if (ly === 1) return [108, 100, 88];
  if (ly === 2) return [40, 36, 32];
  if (ly === 15) return [34, 30, 28];
  const r = Math.floor((ly - 3) / 4), off = r & 1 ? 5 : 0;
  if ((wx + off) % 10 === 9 || (ly - 3) % 4 === 3) return [46, 41, 37];
  const b = Math.floor((wx + off) / 10);
  const t = (hash2(b, ty * 5 + r, 87) - 0.5) * 20 + ((ly - 3) % 4 === 0 ? 8 : 0);
  return [122 + t + n, 112 + t + n, 98 + t * 0.9 + n];
}

/** The top of the town wall: a paved wall-walk between two parapets. `open*`: that side is not wall. */
export function rampartTopPix(tx: number, ty: number, lx: number, ly: number, openL: boolean, openR: boolean, openU: boolean): C3 {
  const wx = tx * TS + lx, wy = ty * TS + ly;
  const edge = (openL && lx < 4) || (openR && lx > 11) || (openU && ly < 4);
  if (edge) {
    // parapet: merlons and gaps, 4 px each along the run of the wall
    const along = (openL && lx < 4) || (openR && lx > 11) ? wy : wx;
    const outer = (openL && lx === 0) || (openR && lx === 15) || (openU && ly === 0);
    const inner = (openL && lx === 3) || (openR && lx === 12) || (openU && ly === 3);
    if (outer) return [30, 28, 28];
    if ((along >> 2) & 1) return inner ? [70, 66, 62] : [128, 122, 112];
    return inner ? [48, 45, 44] : [84, 80, 74];
  }
  if (wx % 8 === 7 || wy % 8 === 7) return [52, 49, 47];
  const t = (hash2(wx >> 3, wy >> 3, 88) - 0.5) * 16;
  return [90 + t, 86 + t, 80 + t];
}
