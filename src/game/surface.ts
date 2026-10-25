// The surface above the buried dungeon, as an area definition. Pure,
// deterministic builder (no DOM): fixed seed, hash-based noise, stable prop ids
// (kind@tx,ty).
//
// Layout story: the keep that stood here is gone under the earth. What is left
// is wild land: meadow around an old rune circle, dense woods closing in, a
// rocky rise to the east and damp hollows to the south-west. The buried halls
// still shape the ground: low ridges and earth-covered humps follow their
// walls (offset by noise, never exactly), and only a handful of mossy, ivy-
// wrapped stones poke through. To the south the old SURFACE GATE lies under
// plain turf; only parallel ridges, a faint sunken strip, a few squared stones
// and rank weeds along its buried walls give it away to someone looking.
import { mulberry, hash2 } from "./core/rng";
import { TS, T, FS } from "./content/tiles";
import { propDef } from "./content/props";
import { SURFACE_GATE, DUNGEON_TO_SURFACE } from "./content/geo";
import { buildDungeon, type AreaData, type DecalDef, type LightDef, type LooseItem, type PropDef } from "./map";

export const SW = 96, SH = 72;
const SURFACE_SEED = 7331;
/** Rune circle centre tile. */
export const RUNE_T = { x: 48, y: 26 };
/** Pixel radius around the rune centre that only the rune's own overgrowth may cover. */
export const RUNE_KEEP_R = 74;
/** Cart and basket pickup (the basket lies just east of the cart). */
export const CART_T = { x: 72, y: 37 };
export const BASKET_POS = { x: 75 * TS + 4, y: 38 * TS + 10 };

const enum B { MEADOW, WOOD, ROCKY, HOLLOW }

export function buildSurface(): AreaData {
  const rng = mulberry(SURFACE_SEED);
  const n = SW * SH;
  const grid = new Uint8Array(n).fill(T.FLOOR);
  const style = new Uint8Array(n).fill(FS.GRASS);
  const tvar = new Uint8Array(n);
  const biome = new Uint8Array(n);
  /** 0 free; 1 keep walkable (no solid props / thicket); 2 rune circle (nothing at all). */
  const clear = new Uint8Array(n);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < SW && y < SH;
  const I = (x: number, y: number) => y * SW + x;
  const G = (x: number, y: number) => (inb(x, y) ? grid[I(x, y)] : T.THICKET);
  const smooth = (x: number, y: number, k: number, s: number) => {
    const fx = x / k, fy = y / k, x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  /** Layered value noise in [0, 1]. */
  const fbm = (x: number, y: number, s: number) => smooth(x, y, 13, s) * 0.5 + smooth(x, y, 6, s + 1) * 0.32 + smooth(x, y, 2.7, s + 2) * 0.18;
  const dRune = (x: number, y: number) => Math.hypot(x - RUNE_T.x, y - RUNE_T.y);
  const rc = { x: RUNE_T.x * TS + 8, y: RUNE_T.y * TS + 8 };
  const G0 = SURFACE_GATE;
  const inGateZone = (x: number, y: number) => x >= G0.x0 - 2 && x <= G0.x1 + 2 && y >= G0.y0 - 2 && y <= G0.arch.y + 2;

  // ---- keep-clear: the rune circle, the gate zone, the cart's clearing, and
  // winding (invisible) game trails from the rune to everything worth finding
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const d = dRune(x, y);
    if (d <= 5.2) clear[I(x, y)] = 2; else if (d <= 7.6) clear[I(x, y)] = 1;
    if (inGateZone(x, y)) clear[I(x, y)] = Math.max(clear[I(x, y)], 1);
    if (Math.abs(x - CART_T.x - 1) <= 4 && Math.abs(y - CART_T.y) <= 3) clear[I(x, y)] = Math.max(clear[I(x, y)], 1);
  }
  const trail = (pts: [number, number][], seed: number) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let s = 0; s <= len; s += 0.5) {
        const t = s / len, wob = (smooth(s + k * 17, seed, 5, 210) - 0.5) * 5 * Math.sin(Math.PI * t);
        const cx = ax + (bx - ax) * t + nx * wob, cy = ay + (by - ay) * t + ny * wob;
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          const x = Math.round(cx + i), y = Math.round(cy + j);
          if (inb(x, y) && Math.hypot(x - cx, y - cy) <= 1.6 && !clear[I(x, y)]) clear[I(x, y)] = 1;
        }
      }
    }
  };
  trail([[48, 30], [58, 33], [CART_T.x - 2, CART_T.y + 1]], 1);
  trail([[CART_T.x + 3, CART_T.y + 2], [80, 44], [84, 50]], 2);
  trail([[48, 31], [45, 41], [49, 50], [G0.arch.x, G0.y0 - 1]], 3);
  trail([[44, 26], [34, 23], [22, 20]], 4);
  trail([[52, 23], [60, 17], [70, 12]], 5);
  trail([[45, 30], [36, 42], [26, 52]], 6);
  trail([[49, 21], [46, 13], [40, 7]], 7);

  // ---- biomes from layered noise, nudged so each quarter has its own character
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = I(x, y), d = dRune(x, y);
    const wood = fbm(x, y, 201) + Math.min(0.22, Math.max(0, (d - 11) / 45)) + (x < 36 && y < 30 ? 0.14 : 0) + (x > 62 && y < 24 ? 0.12 : 0) - (d < 12 ? 0.2 : 0);
    const rocky = fbm(x, y, 301) + (x > 64 && y > 24 && y < 58 ? 0.22 : 0) + (x > 30 && x < 44 && y < 14 ? 0.1 : 0);
    const damp = fbm(x, y, 401) + (x < 40 && y > 38 ? 0.2 : 0) + (x > 74 && y < 16 ? 0.08 : 0);
    const b = damp > 0.68 ? B.HOLLOW : rocky > 0.7 ? B.ROCKY : wood > 0.6 ? B.WOOD : B.MEADOW;
    biome[i] = b;
    const p1 = fbm(x, y, 501), p2 = smooth(x, y, 3.5, 502);
    let s: number = FS.GRASS;
    if (b === B.MEADOW) s = p1 > 0.66 ? FS.MOSS : p2 > 0.93 ? FS.EARTH : FS.GRASS;
    else if (b === B.WOOD) s = p1 > 0.6 ? FS.MOSS : p2 < 0.22 ? FS.GRASS : FS.LEAF;
    else if (b === B.ROCKY) s = p2 > 0.8 ? FS.EARTH : p1 > 0.6 ? FS.MOSS : FS.GRASS;
    else s = damp > 0.75 ? FS.MUD : p2 > 0.5 ? FS.MOSS : FS.GRASS;
    style[i] = s;
    // the world's edge closes in; the deepest woods knot into impassable thicket
    const edge = Math.min(x, y, SW - 1 - x, SH - 1 - y);
    if (edge < 2 + Math.floor(smooth(x, y, 5, 61) * 4)) grid[i] = T.THICKET;
    else if (b === B.WOOD && wood > 0.8 && smooth(x, y, 3, 62) > 0.45 && !clear[i]) grid[i] = T.THICKET;
  }
  // the ground under and around the rune circle is plain turf and moss (its own plants come with it)
  for (let y = RUNE_T.y - 7; y <= RUNE_T.y + 7; y++) for (let x = RUNE_T.x - 7; x <= RUNE_T.x + 7; x++) {
    const d = dRune(x, y);
    if (d <= 6.5) style[I(x, y)] = d < 4.8 || hash2(x, y, 63) < 0.6 ? FS.GRASS : FS.MOSS;
  }

  // ---- the buried dungeon's footprint, read through noise (never exactly)
  const dg = buildDungeon();
  const buriedAt = (x: number, y: number) => {
    const jx = Math.round((smooth(x, y, 7, 511) - 0.5) * 2.6), jy = Math.round((smooth(x, y, 7, 512) - 0.5) * 2.6);
    const dx = x - DUNGEON_TO_SURFACE.dx + jx, dy = y - DUNGEON_TO_SURFACE.dy + jy;
    return dx >= 0 && dy >= 0 && dx < dg.w && dy < dg.h && dg.plan[dy * dg.w + dx] !== T.WALL;
  };
  const buried = new Uint8Array(n);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) buried[I(x, y)] = buriedAt(x, y) ? 1 : 0;
  /** A tile over a buried wall line: buried space on one side, solid earth on the other. */
  const wallLine = (x: number, y: number) => {
    if (!inb(x, y)) return false;
    const b0 = buried[I(x, y)];
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => inb(x + i, y + j) && buried[I(x + i, y + j)] !== b0) && b0 === 1;
  };

  // ---- connectivity: any open ground the rune can't reach becomes thicket (no sealed pockets)
  {
    const seen = new Uint8Array(n), st = [I(RUNE_T.x, RUNE_T.y)];
    seen[st[0]] = 1;
    while (st.length) {
      const i = st.pop()!, x = i % SW, y = (i / SW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const j = I(nx, ny);
        if (seen[j] || grid[j] !== T.FLOOR) continue;
        seen[j] = 1; st.push(j);
      }
    }
    for (let i = 0; i < n; i++) if (grid[i] === T.FLOOR && !seen[i]) grid[i] = T.THICKET;
  }

  const plan = grid.slice();
  const props: PropDef[] = [], lights: LightDef[] = [], decals: DecalDef[] = [], loose: LooseItem[] = [];
  const ids = new Set<string>();
  /** Footprint tiles of solid props (they keep a free ring around each other). */
  const occ = new Uint8Array(n);
  /** Tiles with any prop sprite on them (keeps soft plants from piling up). */
  const deco = new Uint8Array(n);
  const P = (kind: string, tx: number, ty: number, o: Partial<PropDef> = {}) => {
    let id = o.id ?? `${kind}@${tx},${ty}`;
    for (let k = 2; ids.has(id); k++) id = `${kind}@${tx},${ty}#${k}`;
    ids.add(id);
    const p: PropDef = { kind, x: tx * TS + 8, y: ty * TS + 16, v: 0, ...o, id };
    props.push(p);
    deco[I(Math.floor(tx), Math.floor(ty))] = 1;
    const L = propDef(kind).light;
    if (L && (L.when === "always" || p.lit)) lights.push({ x: p.x + L.dx, y: p.y + L.dy, rad: L.rad, col: L.col, int: L.int, flick: L.flick, owner: id });
    return p;
  };
  /** Tile range covered by a prop's collision box at (tx, ty). */
  const footprint = (kind: string, tx: number, ty: number) => {
    const bx = propDef(kind).box!, px = tx * TS + 8, py = ty * TS + 16;
    return { x0: Math.floor((px - bx[0] / 2) / TS), x1: Math.floor((px + bx[0] / 2 - 0.01) / TS), y0: Math.floor((py - bx[1]) / TS), y1: Math.floor((py - 0.01) / TS) };
  };
  /** Sprite clear of the rune circle? (`ext`: rough sprite radius in px). */
  const offRune = (px: number, py: number, ext: number) => Math.hypot(px - rc.x, py - rc.y) - ext > RUNE_KEEP_R;
  /**
   * Can a solid prop stand here? Its footprint must be open ground outside the
   * keep-clear masks, and a one-tile ring around it must be open ground free of
   * other solid props. Every obstacle keeping such a ring means obstacles never
   * wall anything off: the open ground stays connected.
   */
  const canSolid = (kind: string, tx: number, ty: number) => {
    const f = footprint(kind, tx, ty);
    if (!offRune(tx * TS + 8, ty * TS + 8, 24)) return false;
    for (let y = f.y0 - 1; y <= f.y1 + 1; y++) for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
      if (!inb(x, y) || grid[I(x, y)] !== T.FLOOR || occ[I(x, y)]) return false;
      const inner = x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
      if (inner && clear[I(x, y)]) return false;
    }
    return true;
  };
  const solid = (kind: string, tx: number, ty: number, o: Partial<PropDef> = {}) => {
    if (!canSolid(kind, tx, ty)) return null;
    const f = footprint(kind, tx, ty);
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) occ[I(x, y)] = 1;
    return P(kind, tx, ty, o);
  };
  /** Place a solid landmark at the first valid spot spiralling out from (tx, ty). */
  const landmark = (kind: string, tx: number, ty: number, o: Partial<PropDef> = {}) => {
    for (let r = 0; r <= 4; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const p = solid(kind, tx + i, ty + j, o);
      if (p) return p;
    }
    return null;
  };
  const soft = (kind: string, tx: number, ty: number, v: number) => {
    if (!inb(tx, ty) || grid[I(tx, ty)] !== T.FLOOR || occ[I(tx, ty)] || deco[I(tx, ty)] || clear[I(tx, ty)] === 2) return null;
    if (!offRune(tx * TS + 8, ty * TS + 8, 14)) return null;
    return P(kind, tx, ty, { v });
  };
  /** Decals never touch the rune circle (`ext`: how far the decal reaches from its anchor). */
  const D = (kind: string, x: number, y: number, v = 0, w?: number, h?: number, ext = 16) => {
    if (!offRune(x, y, ext)) return;
    decals.push({ kind, x, y, v, w, h });
  };

  // ---- the rune circle (dormant until the dungeon rune wakes it). Its light
  // is dark while dormant; the host drives it (see Game.updateWorldFx).
  props.push({ id: "rune.surface", kind: "runecircle", x: rc.x, y: rc.y, v: 0 });
  lights.push({ x: rc.x, y: rc.y, rad: 84, col: [0.6, 0.38, 1], int: 1, flick: 0.06, id: "runeglow" });

  // ---- the buried SURFACE GATE (readable only if you look)
  const gx0 = G0.x0 * TS, gx1 = (G0.x1 + 1) * TS, gy0 = G0.y0 * TS, gy1 = (G0.arch.y + 1) * TS;
  for (let y = G0.y0 - 1; y <= G0.arch.y + 1; y++) for (let x = G0.x0 - 2; x <= G0.x1 + 2; x++) {
    if (!inb(x, y)) continue;
    grid[I(x, y)] = T.FLOOR; plan[I(x, y)] = T.FLOOR;
    // a different moss over the buried wall lines, plain turf over the slumped roof
    const wallCol = x === G0.x0 - 1 || x === G0.x1 + 1;
    style[I(x, y)] = wallCol && y < G0.arch.y + 1 ? FS.MOSS : hash2(x, y, 64) < 0.2 ? FS.MOSS : FS.GRASS;
  }
  D("furrow", gx0 + 3, gy0 + 2, 0, gx1 - gx0 - 6, gy1 - gy0 - 14);
  for (const wx of [gx0 - 9, gx1 + 1]) {
    for (let y = gy0 - 4; y < gy1 - 6; y += 40) D("ridge", wx, y, 1, Math.min(40, gy1 - 6 - y), 6);
    for (let y = gy0; y < gy1 - 8; y += 9 + ((rng() * 6) | 0)) D("weeds", wx + 1 + rng() * 6, y + rng() * 4, (rng() * 2) | 0);
  }
  for (let k = 0; k < 7; k++) D("sparse", gx0 + 4 + rng() * (gx1 - gx0 - 22), gy0 + 4 + rng() * (gy1 - gy0 - 26), 0, 12 + ((rng() * 8) | 0), 8 + ((rng() * 5) | 0));
  D("hump", G0.arch.x * TS + 8, G0.arch.y * TS + 6, 1, 68, 22, 36); // where the arch's top lies
  P("buriedgate", G0.arch.x, G0.arch.y);
  P("capstone", G0.x0 - 1, G0.y0 + 1, { v: 0 });
  P("capstone", G0.x1 + 1, G0.y0 + 3, { v: 1 });
  P("capstone", G0.x0, G0.arch.y, { v: 2 });
  for (let x = G0.x0 - 2; x <= G0.x1 + 2; x++) for (let y = G0.y0 - 1; y <= G0.arch.y + 1; y++) deco[I(x, y)] = 1;

  // ---- earth over the buried halls: humps over collapsed vaults, low ridges
  // and rank weeds along the wall lines, with slumped gaps
  for (let y = 3; y < SH - 3; y++) for (let x = 3; x < SW - 3; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR || clear[i] === 2 || inGateZone(x, y)) continue;
    const bx = x * TS, by = y * TS;
    if (wallLine(x, y)) {
      const run = smooth(x, y, 4, 520);
      if (run > 0.4 && hash2(x, y, 523) < 0.5) {
        D("hump", bx + 8 + (rng() - 0.5) * 6, by + 8 + (rng() - 0.5) * 6, (rng() * 2) | 0, 22 + ((rng() * 14) | 0), 10 + ((rng() * 6) | 0), 20);
        if (style[i] === FS.GRASS && run > 0.55) style[i] = hash2(x, y, 521) < 0.25 ? FS.EARTH : FS.MOSS;
      }
      if (rng() < 0.35) D("weeds", bx + 3 + rng() * 10, by + 6 + rng() * 8, (rng() * 2) | 0);
    } else if (buried[i] && smooth(x, y, 5, 522) > 0.72 && rng() < 0.12) {
      D("hump", bx + 8, by + 8, 0, 44 + ((rng() * 24) | 0), 16 + ((rng() * 10) | 0), 36);
    }
  }

  // ---- the few rocky remains that still poke through (mossy, ivy-wrapped)
  landmark("wallstub", 38, 9, { v: 0 });
  landmark("wallstub", 65, 21, { v: 2 });
  landmark("wallstub", 23, 45, { v: 1 });
  landmark("masonry", 31, 30, { v: 1 });
  landmark("masonry", 69, 53, { v: 0 });
  landmark("statue_toppled", 36, 36, { v: 0 });
  landmark("statue_toppled", 63, 11, { v: 1 });
  landmark("standingstone", 29, 15, { v: 0 });
  landmark("standingstone", 73, 46, { v: 1 });
  landmark("standingstone", 57, 50, { v: 0 });
  landmark("cairn", 78, 19);
  for (const [x, y, v] of [[57, 36, 0], [19, 31, 1], [41, 47, 0]]) if (soft("stoneslab", x, y, v)) deco[I(x, y)] = 1;

  // ---- the cart and the basket it spilled
  { // the cart stands in its own clearing (exempt from the keep-clear mask it defines)
    P("cart", CART_T.x, CART_T.y);
    const f = footprint("cart", CART_T.x, CART_T.y);
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) occ[I(x, y)] = 1;
  }
  loose.push({ id: "basket", item: "basket", x: BASKET_POS.x, y: BASKET_POS.y });
  D("leaves", BASKET_POS.x + 6, BASKET_POS.y + 2, 0);

  // ---- rocky rise: outcrops, mossy boulders and harvestable rocks in clusters
  for (let y = 4; y < SH - 4; y++) for (let x = 4; x < SW - 4; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR || clear[i]) continue;
    const b = biome[i], clump = smooth(x, y, 4, 530), h = hash2(x, y, 531);
    if (b === B.ROCKY) {
      if (clump > 0.62 && h < 0.07) solid("outcrop", x, y, { v: (h * 30) & 1 });
      else if (clump > 0.5 && h < 0.16) solid("boulder", x, y, { v: (h * 40) % 3 | 0 });
      else if (clump > 0.42 && h < 0.24) solid("rock", x, y, { v: (h * 50) & 1 });
    } else if (b === B.WOOD && clump > 0.75 && h < 0.04) solid("boulder", x, y, { v: 2 });
    else if (b === B.MEADOW && clump > 0.8 && h < 0.05) solid("rock", x, y, { v: (h * 50) & 1 });
  }

  // ---- woods: trees in noisy clusters, saplings at their margins, stumps and fallen logs
  for (let y = 3; y < SH - 3; y++) for (let x = 3; x < SW - 3; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR || clear[i]) continue;
    const b = biome[i], cl = smooth(x, y, 5, 540), r = rng();
    const dens = b === B.WOOD ? 0.26 + cl * 0.3 : b === B.HOLLOW ? 0.05 + cl * 0.08 : b === B.MEADOW ? (cl > 0.7 ? 0.08 : 0.012) : 0.02;
    if (r < dens) solid("tree", x, y, { v: (rng() * 3) | 0 });
    else if (r < dens + 0.012 && b !== B.MEADOW) solid("log", x, y, { v: (rng() * 2) | 0 });
    else if (r < dens + 0.022) solid("stump", x, y);
    else if (r < dens + 0.05 && (b === B.WOOD || cl > 0.6)) solid("sapling", x, y, { v: (rng() * 2) | 0 });
    else if (r < dens + 0.1 && b !== B.ROCKY) solid("bush", x, y, { v: (rng() * 4) | 0 });
  }

  // ---- soft overgrowth: ferns in the shade and damp, tall grass and
  // wildflowers in the open, moss, leaf litter, vines and dappled shade
  for (let y = 2; y < SH - 2; y++) for (let x = 2; x < SW - 2; x++) {
    const i = I(x, y);
    if (grid[i] !== T.FLOOR || clear[i] === 2) continue;
    const b = biome[i], s = style[i], bx = x * TS, by = y * TS, r = rng();
    const gate = inGateZone(x, y);
    if (!gate) {
      if ((b === B.WOOD || b === B.HOLLOW) && r < 0.14) soft("fern", x, y, (rng() * 3) | 0);
      else if (b === B.MEADOW && r < 0.07) soft("tallgrass", x, y, (rng() * 3) | 0);
      else if (b === B.MEADOW && r < 0.1 && smooth(x, y, 4, 550) > 0.55) soft("wildflowers", x, y, (smooth(x, y, 9, 551) * 4) | 0);
      else if (b === B.ROCKY && r < 0.05) soft("tallgrass", x, y, 2);
    }
    const q = rng();
    if (s === FS.GRASS || s === FS.MOSS) {
      if (q < 0.24) D("tuft", bx + 3 + rng() * 10, by + 6 + rng() * 9, 0);
      else if (q < 0.28 && b === B.MEADOW && !gate) D("flowers", bx + 8, by + 8, (smooth(x, y, 6, 552) * 4) | 0);
    } else if (s === FS.LEAF) { if (q < 0.3) D("leaves", bx + 8, by + 8, 0); }
    else if (s === FS.EARTH) { if (q < 0.18) D("pebbles", bx + 8, by + 8, 0); }
    else if (s === FS.MUD && q < 0.05) D("puddle", bx, by + 4, 0, 22 + ((rng() * 14) | 0), 8 + ((rng() * 6) | 0), 36);
    if (gate) continue;
    if (rng() < (b === B.WOOD ? 0.05 : 0.015)) D("mosspatch", bx + 8, by + 8, 0, 14 + ((rng() * 14) | 0), 8 + ((rng() * 8) | 0), 16);
    if (b === B.WOOD && rng() < 0.045 && x % 3 === (y * 2) % 3) D("canopy", bx + 8, by + 8, 0, 22 + ((rng() * 12) | 0), undefined, 36);
    if (rng() < 0.02) D("vines", bx + 8, by + 8, 0);
    // roots and ivy creeping out from anything solid nearby
    if (occ[i] && rng() < 0.5) D("roots", bx + 4, by + 12, 0);
    const nearSolid = [G(x - 1, y), G(x + 1, y), G(x, y - 1), G(x, y + 1)].some((t) => t === T.THICKET);
    if (nearSolid && rng() < 0.12) D("vines", bx + 8, by + 8, 1);
  }

  return {
    id: "surface", w: SW, h: SH, grid, plan, style, tvar, rooms: [], props, decals, lights, loose,
    start: { x: rc.x, y: rc.y + 4 }, exits: [], drips: [], outdoor: true, ambient: [0.33, 0.33, 0.42],
  };
}
