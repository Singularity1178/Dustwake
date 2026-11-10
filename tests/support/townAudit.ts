// Developer tool (not a test): looks for layout mistakes in the market town and
// the rooms behind its doors, the kind that are easy to make by hand and hard
// to see at a glance. It reads the built areas the way the game does (the real
// tiles, the real collision boxes, the real sprites) and prints what is wrong:
//
//   - a prop whose collision box sits in a wall or a building, or off the map;
//   - two solid props standing in each other;
//   - something hung on a wall that is not there, a light buried in masonry;
//   - a standing place (Spot) that is blocked or cannot be walked to;
//   - open ground nobody can reach (a yard fenced all the way round);
//   - a door with something standing on its step or drawn across it;
//   - a ground decal painted over a roof;
//   - a building row that contradicts itself (a lit window that is not a window).
//
//   node scripts/townAudit.mjs                      -> the report (exit code 1 if anything is wrong)
//   node scripts/townAudit.mjs map                  -> an ASCII plan of the town's tiles
//   node scripts/townAudit.mjs shot name=area:x,y,w,h[,scale[,lit|flat[,grid]]] ...
//                                                   -> .preview/audit/name.png (tiles; grid: a line per tile, bright every 5)
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { renderArea, crop, installDom } from "./townSnapshot";
import { AREAS } from "../../src/game/world/areas";
import { Area, type PropInst } from "../../src/game/world/area";
import { propSprite } from "../../src/game/art/props";
import { propDef } from "../../src/game/content/props";
import { decalBounds } from "../../src/game/art/decals";
import { TS, T, FS, WS, isSolidT, isOpaqueT } from "../../src/game/content/tiles";
import { BUILDINGS, DOOR, ESTABLISHMENTS, TOWN_ID, doorPx, interiorId } from "../../src/game/content/town";
import { reachable, freeAt, cellFeet, type Box } from "../../src/game/sim/reach";
import { propBlocks, boxFree } from "../../src/game/sim/collision";

export const AUDIT_AREAS = [TOWN_ID, ...ESTABLISHMENTS.map(interiorId)];

/** Foliage the ground-cover pass scatters: it may brush against things. */
const SOFT = new Set(["towntree", "tree", "bush", "tallgrass", "fern", "fence", "fence_v"]);
/** Furniture that belongs pushed together. */
const TOGETHER = new Set(["bench+longtable", "longtable+bench"]);
/** Things that stand on a roof or a wall by design. */
const ON_ROOF = new Set(["chimney"]);

export interface Finding { area: string; check: string; msg: string }

const at = (x: number, y: number) => `(${(x / TS).toFixed(1)},${(y / TS).toFixed(1)})`;
const rectOverlap = (a: readonly number[], b: readonly number[]) => [Math.min(a[2], b[2]) - Math.max(a[0], b[0]), Math.min(a[3], b[3]) - Math.max(a[1], b[1])];

function spriteRect(p: PropInst): [number, number, number, number] | null {
  const def = propDef(p.kind), alt = def.alt === "lit" ? !!p.lit : def.alt === "taken" ? p.taken : p.open;
  const s = propSprite(p.kind, p.v, alt);
  return s ? [Math.round(p.x - s.ax), Math.round(p.y - s.ay), Math.round(p.x - s.ax) + s.w, Math.round(p.y - s.ay) + s.h] : null;
}

export function auditArea(id: string): Finding[] {
  const data = AREAS[id](), a = new Area(data), W = a.w, H = a.h, out: Finding[] = [];
  const say = (check: string, msg: string) => out.push({ area: id, check, msg });
  const tile = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? -1 : a.grid[ty * W + tx]);
  const blockers = a.props.filter(propBlocks), boxes: Box[] = blockers.map((p) => p.box!);

  // ---- props against tiles
  for (const p of a.props) {
    const def = propDef(p.kind), fx = Math.floor(p.x / TS), fy = Math.floor((p.y - 1) / TS);
    if (def.wallMounted) {
      const t = tile(fx, fy);
      if (t !== T.WALL && t !== T.FRONT) say("wall-mounted", `${p.id} at ${at(p.x, p.y)} hangs on nothing (tile ${fx},${fy} is not wall)`);
      continue;
    }
    if (ON_ROOF.has(p.kind) || def.rune) continue;
    if (p.box) {
      const b = p.box; let hit = "";
      for (let ty = Math.floor((b[1] + 0.01) / TS); ty <= Math.floor((b[3] - 0.01) / TS) && !hit; ty++)
        for (let tx = Math.floor((b[0] + 0.01) / TS); tx <= Math.floor((b[2] - 0.01) / TS) && !hit; tx++) {
          const t = tile(tx, ty);
          if (t < 0) hit = `off the map at ${tx},${ty}`; else if (isSolidT(t)) hit = `in solid tile ${tx},${ty}`;
        }
      if (hit) say("in-wall", `${p.id} at ${at(p.x, p.y)}: its box is ${hit}`);
    } else if (!def.flat) {
      const t = tile(fx, fy);
      if (t < 0 || isSolidT(t)) say("in-wall", `${p.id} at ${at(p.x, p.y)} stands in solid tile ${fx},${fy}`);
    }
    const r = spriteRect(p);
    if (!r) say("art", `${p.id}: no sprite for kind "${p.kind}"`);
    else if (r[0] < 0 || r[1] < 0 || r[2] > W * TS || r[3] > H * TS) say("off-map", `${p.id} at ${at(p.x, p.y)}: its sprite runs off the map`);
  }

  // ---- solid props against each other
  for (let i = 0; i < blockers.length; i++) for (let j = i + 1; j < blockers.length; j++) {
    const p = blockers[i], q = blockers[j];
    if (Math.abs(p.x - q.x) > 60 || Math.abs(p.y - q.y) > 60) continue;
    const [ox, oy] = rectOverlap(p.box!, q.box!);
    if (ox > 1 && oy > 1 && !(p.kind.startsWith("fence") && q.kind.startsWith("fence"))) say("overlap", `${p.id} ${at(p.x, p.y)} and ${q.id} ${at(q.x, q.y)}: boxes overlap ${ox.toFixed(0)}x${oy.toFixed(0)}px`);
    // a hand-placed thing mostly hidden behind (or standing in the picture of) another
    if (SOFT.has(p.kind) || SOFT.has(q.kind)) continue;
    const rp = spriteRect(p), rq = spriteRect(q);
    if (!rp || !rq) continue;
    const [sx, sy] = rectOverlap(rp, rq), small = Math.min((rp[2] - rp[0]) * (rp[3] - rp[1]), (rq[2] - rq[0]) * (rq[3] - rq[1]));
    if (sx > 0 && sy > 0 && sx * sy > small * 0.4 && !(ox > 1 && oy > 1) && !TOGETHER.has(`${p.kind}+${q.kind}`)) say("crowded", `${p.id} ${at(p.x, p.y)} and ${q.id} ${at(q.x, q.y)}: sprites overlap ${sx}x${sy}px`);
  }

  // ---- lights
  for (const l of a.lights) {
    if (l.owner && !a.prop(l.owner)) say("light", `a light at ${at(l.x, l.y)} belongs to "${l.owner}", which does not exist`);
    const t = tile(Math.floor(l.x / TS), Math.floor(l.y / TS));
    if (t < 0 || isOpaqueT(t)) say("light", `the light of ${l.owner ?? "(none)"} at ${at(l.x, l.y)} is buried in an opaque tile`);
  }

  // ---- standing places, and ground nobody can get to
  const reach = reachable(a, boxes, data.start);
  for (const s of data.spots ?? []) {
    // reachability is per tile: a place counts if it, or free ground a step away, is in a tile the golem can walk to
    let ok = false;
    for (let dy = -8; dy <= 8 && !ok; dy += 2) for (let dx = -8; dx <= 8 && !ok; dx += 2) {
      const px = s.x + dx, py = s.y + dy, tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
      ok = tx >= 0 && ty >= 0 && tx < W && ty < H && !!reach[ty * W + tx] && boxFree(a, px, py);
    }
    if (!boxFree(a, s.x, s.y)) say("spot", `${s.id} (${s.kind}) at ${at(s.x, s.y)} is blocked`);
    else if (!ok) say("spot", `${s.id} (${s.kind}) at ${at(s.x, s.y)} cannot be walked to`);
  }
  const seen = new Uint8Array(W * H);
  const standable = (k: number) => { const f = cellFeet(k % W, (k / W) | 0); return a.grid[k] === T.FLOOR && freeAt(a, boxes, f.x, f.y); };
  for (let k0 = 0; k0 < W * H; k0++) {
    if (seen[k0] || reach[k0] || !standable(k0)) continue;
    let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; const q = [k0]; seen[k0] = 1;
    while (q.length) {
      const k = q.pop()!, x = k % W, y = (k / W) | 0; n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const d of [1, -1, W, -W]) { const j = k + d; if (j < 0 || j >= W * H || (Math.abs(d) === 1 && ((j / W) | 0) !== y) || seen[j] || reach[j] || !standable(j)) continue; seen[j] = 1; q.push(j); }
    }
    if (n >= 4) say("sealed", `${n} tiles of open ground at ${x0},${y0}..${x1},${y1} cannot be walked to`);
  }

  if (id !== TOWN_ID) return out;

  // ---- the town's buildings: the table itself, their doors, and what is painted over them
  const rects = BUILDINGS.map((b) => [b.x * TS, b.y * TS, (b.x + b.w) * TS, (b.y + b.h) * TS]);
  BUILDINGS.forEach((b) => {
    const cols = (l?: number[]) => (l ?? []).filter((c) => c < 0 || c >= b.w);
    if (cols(b.win).length || cols(b.lit).length || cols(b.dormers).length) say("building", `${b.id}: a window / dormer column is outside its ${b.w} columns`);
    for (const c of b.lit ?? []) if (!b.win?.includes(c)) say("building", `${b.id}: column ${c} is lit but is not a window`);
    if (b.chimney !== undefined && (b.chimney < 0 || b.chimney >= b.w)) say("building", `${b.id}: chimney column ${b.chimney} is off the roof`);
    if (!b.door) return;
    const kind = b.door.kind ?? "plain", dc = kind === "hauler" ? [b.door.col, b.door.col + 1] : [b.door.col];
    for (const c of dc) { if (c < 0 || c >= b.w) say("building", `${b.id}: door column ${c} is outside the front`); if (b.win?.includes(c)) say("building", `${b.id}: column ${c} is both door and window`); }
    const d = doorPx(b), half = DOOR[d.kind].w / 2, leaf = [d.x - half, d.y - DOOR[d.kind].h, d.x + half, d.y], step = [d.x - half, d.y, d.x + half, d.y + 10];
    for (let x = Math.floor(step[0] / TS); x <= Math.floor((step[2] - 1) / TS); x++) if (tile(x, b.y + b.h) !== T.FLOOR) say("door", `${b.id}: no ground in front of its door at ${x},${b.y + b.h}`);
    if (!boxFree(a, d.x, d.y + 9)) say("door", `${b.id}: nobody can stand on its doorstep`);
    for (const p of a.props) {
      const def = propDef(p.kind);
      if (def.wallMounted || def.flat || ON_ROOF.has(p.kind)) continue;
      if (p.box) { const [ox, oy] = rectOverlap(p.box, step); if (ox > 0 && oy > 0) say("door", `${b.id}: ${p.id} ${at(p.x, p.y)} stands on its doorstep`); }
      const r = spriteRect(p);
      if (!r || p.y < d.y) continue;
      const [sx, sy] = rectOverlap(r, leaf);
      if (sx >= 3 && sy >= 4) say("door", `${b.id}: ${p.id} ${at(p.x, p.y)} is drawn across its door (${sx}x${sy}px)`);
    }
  });
  const db = decalBounds(data.decals);
  data.decals.forEach((dc, i) => {
    if (dc.kind === "building" || dc.kind === "doormat") return;
    const r = [db[i * 4], db[i * 4 + 1], db[i * 4 + 2], db[i * 4 + 3]];
    if (r[2] - r[0] === 160 && r[3] - r[1] === 240) return; // a kind with no declared extent: the bake's catch-all bounds, not its size
    // buildings are painted after the ground decals (town.ts), so only what comes later in the list lands on a roof
    if (i < data.decals.findIndex((x) => x.kind === "building")) return;
    rects.forEach((br, j) => { const [ox, oy] = rectOverlap(r, br); if (ox > 3 && oy > 3) say("decal", `${dc.kind} at ${at(dc.x, dc.y)} is painted ${ox.toFixed(0)}x${oy.toFixed(0)}px over ${BUILDINGS[j].id}`); });
  });
  return out;
}

/** An ASCII plan of an area's tiles, with the street furniture marked. */
export function asciiMap(id: string): string {
  const a = new Area(AREAS[id]()), rows: string[][] = [];
  const FL: Record<number, string> = { [FS.GRASS]: ".", [FS.MOSS]: ",", [FS.DIRT]: ":", [FS.EARTH]: "e", [FS.MUD]: "m", [FS.SETT]: "s", [FS.WEAVE]: "w", [FS.COBBLE]: "c" };
  for (let y = 0; y < a.h; y++) {
    const row: string[] = [];
    for (let x = 0; x < a.w; x++) {
      const t = a.grid[y * a.w + x], s = a.style[y * a.w + x];
      row.push(t === T.THICKET ? "~" : t === T.FRONT ? "F" : t === T.WALL ? (s === WS.RAMPART ? "R" : "#") : t === T.FLOOR ? FL[s] ?? "_" : "?");
    }
    rows.push(row);
  }
  const mark: Record<string, string> = { rune_lamp: "L", torch_post: "t", towntree: "T", fence: "-", fence_v: "|", bush: "b", bannerpole: "P", brazier: "B" };
  for (const p of a.props) { const c = mark[p.kind], x = Math.floor(p.x / TS), y = Math.floor((p.y - 1) / TS); if (c && rows[y]?.[x] !== undefined) rows[y][x] = c; }
  const head = "    " + Array.from({ length: a.w }, (_, x) => (x % 10 === 0 ? String((x / 10) | 0) : x % 5 === 0 ? "+" : " ")).join("");
  return [head, ...rows.map((r, y) => String(y).padStart(3) + " " + r.join(""))].join("\n");
}

/** Tile grid over a crop: a faint line per tile, brighter every fifth, brightest every tenth. */
function gridOver(c: RCanvas, px0: number, py0: number) {
  for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
    const gx = (px0 + i) % TS === 0, gy = (py0 + j) % TS === 0;
    if (!gx && !gy) continue;
    const n = gx ? (px0 + i) / TS : (py0 + j) / TS, k = (j * c.width + i) * 4;
    const [r, g, b, f] = n % 10 === 0 ? [255, 60, 60, 0.75] : n % 5 === 0 ? [255, 230, 60, 0.6] : [255, 255, 255, 0.16];
    c.data[k] += (r - c.data[k]) * f; c.data[k + 1] += (g - c.data[k + 1]) * f; c.data[k + 2] += (b - c.data[k + 2]) * f;
  }
}

export function main(argv: string[]): number {
  installDom();
  if (argv[0] === "map") { console.log(asciiMap(argv[1] ?? TOWN_ID)); return 0; }
  if (argv[0] === "shot") {
    const dir = ".preview/audit", cache = new Map<string, ReturnType<typeof renderArea>>();
    mkdirSync(dir, { recursive: true });
    for (const spec of argv.slice(1)) {
      const [name, rest] = spec.split("="), [area, nums] = rest.split(":"), f = nums.split(",");
      const r = cache.get(area) ?? renderArea(area); cache.set(area, r);
      const [x, y, w, h] = f.slice(0, 4).map(Number), scale = Number(f[4] ?? 2), src = f[5] === "flat" ? r.flat : r.lit;
      const cw = Math.min(w, r.area.w - x), ch = Math.min(h, r.area.h - y), c = crop(src, x * TS, y * TS, cw * TS, ch * TS);
      if (f[6] === "grid") gridOver(c, x * TS, y * TS);
      writeFileSync(`${dir}/${name}.png`, png(c, scale));
    }
    return 0;
  }
  let n = 0;
  for (const id of AUDIT_AREAS) {
    const found = auditArea(id);
    n += found.length;
    console.log(`== ${id}: ${found.length ? found.length + " finding(s)" : "clean"}`);
    const by = new Map<string, string[]>();
    for (const f of found) by.set(f.check, [...(by.get(f.check) ?? []), f.msg]);
    for (const [check, msgs] of by) { console.log(`  [${check}] x${msgs.length}`); for (const m of msgs.slice(0, 40)) console.log(`    ${m}`); if (msgs.length > 40) console.log(`    ... and ${msgs.length - 40} more`); }
  }
  console.log(n ? `\n${n} finding(s).` : "\nNothing wrong found.");
  return n ? 1 : 0;
}
