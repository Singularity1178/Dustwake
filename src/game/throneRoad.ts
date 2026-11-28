// The Throne Road where it passes Westwake: a north-south strip of the overworld, a site of its own between the
// town and the old road. Pure, deterministic builder (no DOM): fixed seed, stable prop ids (kind@tx,ty).
//
// Westwake belongs to an empire that makes golems and sends them everywhere, and the empire's road runs past its
// east wall: four lanes of cobbles with earth verges, a rune lamp every few dozen paces, off the top of the map to
// the north and off the bottom to the south. The East Gate's own street meets it from the west in a short spur.
// It is nowhere near the ruins. The carts have rolled past the wood over the sunken keep for as long as the wall has
// stood, and none of them has ever gone in, which is why the rune is still only a rumour.
//
// The hunters' track is the other thing that happens here: it leaves the road's east verge as nothing more than
// trodden earth, a few tiles of it, and is the old road's own from the strip's last column (oldRoad.ts).
import { TS, T, FS } from "./content/tiles";
import { CROSS_LANE, CROSS_W, WEST_ROAD } from "./content/geography";
import { hash2 } from "./core/rng";
import { dress, verge } from "./roadKit";
import { areaKit } from "./town";
import { vnoise } from "./surface";
import type { AreaData } from "./map";

export const CROSS_H = 72;
const SEED = 9311;

export function buildThroneRoad(): AreaData {
  const W = CROSS_W, H = CROSS_H, k = areaKit(W, H);
  const { grid, style, Pt, D } = k;
  const { y0, y1 } = WEST_ROAD.surface, mid = (y0 + y1) >> 1;
  const { x0: lx0, x1: lx1 } = CROSS_LANE;
  const I = (x: number, y: number) => y * W + x;

  // the lanes: the whole way down the strip, and the gate's spur coming in from the west on the High Street's rows
  const isLane = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && ((x >= lx0 && x <= lx1) || (x < lx0 && y >= y0 && y <= y1));
  grid.fill(T.FLOOR);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const pn = vnoise(x, y, 4, SEED);
    style[I(x, y)] = isLane(x, y) ? FS.ROAD : pn > 0.8 ? FS.DIRT : pn < 0.14 ? FS.MOSS : FS.GRASS;
  }
  verge(style, grid, W, H, isLane, SEED + 20);
  // the hunters' track leaves the east verge: trodden earth on the old road's rows (it is bare ground, not a road: no kerb, no verge)
  for (let y = y0; y <= y1; y++) for (let x = lx1 + 1; x < W; x++) style[I(x, y)] = y === mid || hash2(x, y, SEED + 30) < 0.4 ? FS.EARTH : FS.DIRT;

  // ---- furniture. Rune lamps stand on the verges, alternating sides, so the road is lit from the gate out into the dark;
  // a new milestone stands at the crossing, on the north-east corner, where the track leaves. The old wooden waymark
  // stands on the north-west corner, where the gate's spur meets the paving, to tell travellers which way is which.
  const lamps: [number, number][] = [[1, 12], [6, 21], [1, 30], [6, 38], [1, 47], [6, 56], [1, 65]];
  for (const [x, y] of lamps) Pt("rune_lamp", x, y);
  Pt("kingsmilestone", 6.4, y0 - 1.4);
  const mx = (lx0 - 1) * TS + 8, my = y0 * TS - 3;
  k.P("waymark", mx, my);
  D("mosspatch", mx - 1, my, 1, 12);

  // ---- the meadow either side: grass, flowers, the odd bush or sapling on the outer columns, never near the lanes
  const wild = (x: number, y: number) => x !== lx0 - 1 && x !== lx1 + 1 && !isLane(x, y);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!wild(x, y) || style[I(x, y)] === FS.EARTH || (y >= y0 - 2 && y <= y1 + 2) || y < 1) continue;
    const r = hash2(x, y, SEED + 40), bx = x * TS, by = y * TS;
    const outer = x === 0 || x === W - 1;
    if (outer && y >= 3 && y < H - 2 && r < 0.06) Pt("bush", x + (hash2(x, y, SEED + 41) - 0.5) * 0.3, y, { v: (r * 100 | 0) % 4 });
    else if (outer && y >= 3 && r < 0.09) Pt("sapling", x, y, { v: (r * 100 | 0) % 2 });
    else if (r < 0.3) Pt("tallgrass", x + (hash2(x, y, SEED + 42) - 0.5) * 0.5, y - hash2(x, y, SEED + 43) * 0.3, { v: (r * 100 | 0) % 3 });
    else if (style[I(x, y)] === FS.GRASS || style[I(x, y)] === FS.MOSS) { if (r < 0.62) D("tuft", bx + 3 + hash2(x, y, SEED + 44) * 10, by + 6 + hash2(x, y, SEED + 45) * 9); else if (r < 0.67) D("flowers", bx + 8, by + 8, (r * 1000 | 0) % 4); }
  }
  dress(k, W, H, isLane, SEED + 50);

  return {
    id: "throneroad", w: W, h: H, grid, plan: grid.slice(), style, tvar: k.tvar, rooms: [], props: k.props, decals: k.decals, lights: k.lights, loose: [],
    start: { x: lx0 * TS + 8, y: mid * TS + 12 }, exits: [], drips: [], outdoor: true, tended: true, ambient: [0.32, 0.31, 0.42], portals: [], spots: [],
  };
}
