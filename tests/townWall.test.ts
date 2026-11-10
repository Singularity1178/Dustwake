// Westwake's edge and its wall: the map simply ends (no thicket: the ground
// runs to the last tile and stops), the town wall is a closed ring with a gate
// at each end of the High Street, and the layout audit
// (tests/support/townAudit.ts) finds nothing wrong in the town or its rooms.
// Headless: builders, sim and the recording fake canvas only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { AREAS } from "../src/game/world/areas";
import { Area } from "../src/game/world/area";
import { buildTown } from "../src/game/town";
import { BUILDINGS, STREETS, TOWN_ID, building } from "../src/game/content/town";
import { T, TS, WS, isSolidT } from "../src/game/content/tiles";
import { reachable, type Box } from "../src/game/sim/reach";
import { propBlocks, boxFree } from "../src/game/sim/collision";
import { player, enterArea, getArea } from "../src/game/world/world";
import { saveToStorage, loadFromStorage, serialize, deserialize } from "../src/game/world/save";
import { rampartTopPix, RAMPART_OPEN } from "../src/game/art/tilesTown";
import { AUDIT_AREAS, auditArea } from "./support/townAudit";
import { frame, newWorld } from "./helpers";

const Wl = STREETS.wall;
const onRing = (x: number, y: number) =>
  x >= Wl.westX0 && x <= Wl.x1 && y >= Wl.northY0 && y <= Wl.southY1 && (x <= Wl.westX1 || x >= Wl.x0 || y <= Wl.northY1 || y >= Wl.southY0);
const inGate = (x: number, y: number) => onRing(x, y) && y >= Wl.gateY0 && y <= Wl.gateY1;
const outside = (x: number, y: number) => x < Wl.westX0 || x > Wl.x1 || y < Wl.northY0 || y > Wl.southY1;
const TOWERS = ["gate_n", "gate_s", "bar_n", "bar_s"].map(building);

test("the map just ends: no thicket anywhere, and plain ground runs to all four edges", () => {
  const t = buildTown();
  assert.ok(!t.grid.includes(T.THICKET), "no thicket is left in the town");
  for (let x = 0; x < t.w; x++) { assert.equal(t.grid[x], T.FLOOR, `top edge ${x}`); assert.equal(t.grid[(t.h - 1) * t.w + x], T.FLOOR, `bottom edge ${x}`); }
  for (let y = 0; y < t.h; y++) { assert.equal(t.grid[y * t.w], T.FLOOR, `left edge ${y}`); assert.equal(t.grid[y * t.w + t.w - 1], T.FLOOR, `right edge ${y}`); }
  // the old road still runs out through the east gate to the last column, and the west road out past the bar
  const mid = STREETS.high.y0 + 1;
  for (const x of [0, 1, 2, t.w - 3, t.w - 2, t.w - 1]) assert.equal(t.grid[mid * t.w + x], T.FLOOR, `road at ${x}`);
  // nothing scattered stands on the outermost ring of tiles, where its picture would be cut off
  for (const p of t.props) assert.ok(p.x >= TS && p.x < (t.w - 1) * TS && p.y > TS, `${p.id} keeps off the edge`);
});

test("the town wall is a closed ring of rampart, open only where the High Street passes through it", () => {
  const t = buildTown(), I = (x: number, y: number) => y * t.w + x;
  const tower = (x: number, y: number) => TOWERS.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  assert.ok(Wl.westX0 > 0 && Wl.northY0 > 0 && Wl.x1 < t.w - 1 && Wl.southY1 < t.h - 1, "there is ground outside every side of the wall");
  let gates = 0;
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (!onRing(x, y)) continue;
    if (inGate(x, y)) { gates++; assert.equal(t.grid[I(x, y)], T.FLOOR, `the gate is open at ${x},${y}`); continue; }
    assert.ok(isSolidT(t.grid[I(x, y)]), `the wall is solid at ${x},${y}`);
    assert.ok(tower(x, y) || (t.grid[I(x, y)] === T.WALL && t.style[I(x, y)] === WS.RAMPART), `${x},${y} is rampart or a gate tower`);
  }
  assert.equal(gates, 2 * (Wl.gateY1 - Wl.gateY0 + 1) * 2, "two gates, each the width of the street and the depth of the wall");
  // every building stands inside it (the towers stand astride it)
  for (const b of BUILDINGS) if (!TOWERS.includes(b)) assert.ok(b.x > Wl.westX1 && b.x + b.w <= Wl.x0 && b.y > Wl.northY1 && b.y + b.h <= Wl.southY0, `${b.id} is inside the wall`);
  // tile by tile, with the gates shut, nothing inside connects to anything outside
  const seen = new Uint8Array(t.w * t.h), q = [I(47, 30)];
  seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!, x = k % t.w, y = (k / t.w) | 0;
    assert.ok(!outside(x, y), `the wall leaks: ${x},${y} is outside it`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= t.w || ny >= t.h || seen[I(nx, ny)] || isSolidT(t.grid[I(nx, ny)]) || inGate(nx, ny)) continue;
      seen[I(nx, ny)] = 1; q.push(I(nx, ny));
    }
  }
});

test("the West Bar is shut: the bar spans its passage, so the east gate is the only way through the wall", () => {
  const a = new Area(AREAS[TOWN_ID]());
  const boxes: Box[] = a.props.filter(propBlocks).map((p) => p.box!);
  const bar = a.props.find((p) => p.kind === "tollbar")!;
  assert.ok(bar.box, "the bar is solid");
  assert.ok(bar.box![1] <= Wl.gateY0 * TS && bar.box![3] >= (Wl.gateY1 + 1) * TS, "it reaches from tower to tower");
  assert.ok(bar.box![0] >= Wl.westX0 * TS && bar.box![2] <= (Wl.westX1 + 1) * TS, "and lies within the thickness of the wall");
  // as built, the golem can get out (by the east gate)...
  const open = reachable(a, boxes, a.base.start);
  assert.ok(open[(Wl.gateY0 + 1) * a.w + Wl.x1 + 2], "the road outside the east gate can be walked to");
  // ...but with the east gate blocked as well, nowhere outside the wall can be reached: the bar cannot be passed or walked round
  const shut: Box = [Wl.x0 * TS, Wl.gateY0 * TS, (Wl.x1 + 1) * TS, (Wl.gateY1 + 1) * TS];
  const closed = reachable(a, [...boxes, shut], a.base.start);
  assert.ok(closed[(Wl.gateY0 + 1) * a.w + Wl.westX1 + 2], "the street just inside the bar can still be walked to");
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (outside(x, y)) assert.equal(closed[y * a.w + x], 0, `${x},${y} is outside the wall`);
});

test("walking into the edge of the map: the golem stops where the tiles end, in every direction", () => {
  const t = buildTown(), W = t.w * TS, H = t.h * TS;
  const w = newWorld(), pl = player(w);
  const walk = (ix: number, iy: number, n = 240) => { for (let i = 0; i < n; i++) frame(w, { ix, iy, use: false }); };
  // the north-west corner of the land outside the wall
  enterArea(w, pl, TOWN_ID, 24, 24);
  walk(-1, 0); walk(0, -1); walk(-1, -1);
  assert.equal(pl.area, TOWN_ID);
  assert.ok(pl.x >= 5 - 0.01 && pl.x < 12 && pl.y >= 5 - 0.01 && pl.y < 12, `stopped in the corner (${pl.x.toFixed(1)}, ${pl.y.toFixed(1)})`);
  // the south-east corner
  pl.x = W - 24; pl.y = H - 24; pl.vx = pl.vy = 0;
  walk(1, 0); walk(0, 1); walk(1, 1);
  assert.equal(pl.area, TOWN_ID);
  assert.ok(pl.x <= W - 5 + 0.01 && pl.x > W - 12 && pl.y <= H + 0.01 && pl.y > H - 7, `stopped in the corner (${pl.x.toFixed(1)}, ${pl.y.toFixed(1)})`);
  // the west road beyond the bar is a road that goes nowhere yet: pushing along it off the map changes nothing
  pl.x = 40; pl.y = (STREETS.high.y0 + 1) * TS + 12; pl.vx = pl.vy = 0;
  walk(-1, 0, 400);
  assert.equal(pl.area, TOWN_ID);
  assert.ok(pl.x >= 5 - 0.01 && pl.x < 12);
});

test("layout audit: nothing in the town or its rooms stands in a wall, in something else, on a doorstep or out of reach", () => {
  for (const id of AUDIT_AREAS) assert.deepEqual(auditArea(id).map((f) => `[${f.check}] ${f.msg}`), [], id);
});

test("houses are painted over the ground decals round them, and the wall-walk has a parapet wherever it drops away", () => {
  const t = buildTown(), first = t.decals.findIndex((d) => d.kind === "building");
  assert.ok(first > 0, "ground decals come first");
  assert.ok(t.decals.slice(first).every((d) => d.kind === "building"), "then every building, last");
  assert.equal(t.decals.length - first, BUILDINGS.length);
  const O = RAMPART_OPEN, px = (lx: number, ly: number, open: number) => rampartTopPix(3, 3, lx, ly, open).join();
  const cases: [number, number, number][] = [[O.L, 1, 8], [O.R, 14, 8], [O.U, 8, 1], [O.D, 8, 14], [O.UL, 1, 1], [O.UR, 14, 1], [O.DL, 1, 14], [O.DR, 14, 14]];
  for (const [bit, lx, ly] of cases) {
    assert.notEqual(px(lx, ly, bit), px(lx, ly, 0), `open side ${bit}: a parapet at ${lx},${ly}`);
    assert.equal(px(8, 8, bit), px(8, 8, 0), `open side ${bit}: the middle of the walk is still paving`);
  }
  // an inner corner's post fills only its own corner of the tile
  assert.equal(px(1, 14, O.DR), px(1, 14, 0));
  assert.equal(px(14, 1, O.DR), px(14, 1, 0));
});

test("a save from before the wall: a golem saved where masonry now stands is set down on free ground beside it", () => {
  const roundTrip = (x: number, y: number) => {
    const w = newWorld(), pl = player(w);
    enterArea(w, pl, TOWN_ID, x, y);
    pl.x = x; pl.y = y; pl.vx = pl.vy = 0;
    const kept = new Map<string, string>(), storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
    saveToStorage(w, storage);
    const back = loadFromStorage(storage)!;
    // (deserialize alone stays the exact inverse of serialize: the guard is on the way in from storage)
    assert.deepEqual(serialize(deserialize(serialize(w))), serialize(w));
    return { p: player(back), a: getArea(back, TOWN_ID) };
  };
  // inside the north wall, inside the West Bar's tower, inside the south wall (all open meadow, once)
  for (const [x, y] of [[40 * TS + 8, Wl.northY0 * TS + 20], [4 * TS + 8, 27 * TS], [60 * TS + 8, Wl.southY0 * TS + 24]]) {
    const { p, a } = roundTrip(x, y);
    assert.equal(p.area, TOWN_ID);
    assert.ok(boxFree(a, p.x, p.y), `(${x}, ${y}) loads onto free ground`);
    assert.ok(Math.hypot(p.x - x, p.y - y) <= 80, `(${x}, ${y}) loads close to where it was saved`);
  }
  // somewhere sensible is left exactly as it was saved
  const { p } = roundTrip(47 * TS + 8, 34 * TS + 8);
  assert.deepEqual([p.x, p.y], [47 * TS + 8, 34 * TS + 8]);
});
