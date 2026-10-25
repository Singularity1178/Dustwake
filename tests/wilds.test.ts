// The overgrown surface, the buried gate on both sides, and the surface rune's
// dormant -> awakening -> active art.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { buildSurface, RUNE_T, RUNE_KEEP_R } from "../src/game/surface";
import { buildDungeon } from "../src/game/map";
import { reachFrom } from "../src/game/sim/reach";
import { propDef } from "../src/game/content/props";
import { T, TS, isSolidT } from "../src/game/content/tiles";
import { DUNGEON_TO_SURFACE, GATE_CORRIDOR, SURFACE_GATE, toSurface } from "../src/game/content/geo";
import { RUNE_NODES } from "../src/game/content/runes";
import { buildCircle } from "../src/game/circle";
import { SurfaceRuneArt, runeLayout, carvingShown, plantShown } from "../src/game/surfaceRune";
import { propSprite } from "../src/game/art";
import { makeCanvas } from "../src/game/util";
import { migrate, MIGRATIONS } from "../src/game/world/save";

const s = buildSurface();
const boxOf = (p: { kind: string; x: number; y: number }) => {
  const b = propDef(p.kind).box;
  return b ? [p.x - b[0] / 2, p.y - b[1], p.x + b[0] / 2, p.y] : null;
};

test("surface builder is deterministic", () => {
  const a = buildSurface();
  assert.deepEqual(Buffer.from(a.grid), Buffer.from(s.grid));
  assert.deepEqual(Buffer.from(a.style), Buffer.from(s.style));
  assert.deepEqual(a.props, s.props);
  assert.deepEqual(a.decals, s.decals);
  assert.equal(new Set(s.props.map((p) => p.id)).size, s.props.length, "prop ids are unique");
  assert.equal(s.w, 96); assert.equal(s.h, 72);
  assert.ok(s.props.some((p) => p.id === "rune.surface"));
  assert.ok(s.loose.some((l) => l.id === "basket"));
  assert.ok(s.props.some((p) => p.kind === "tree") && s.props.some((p) => p.kind === "rock"), "harvestables remain");
});

test("start, rune, cart/basket and the buried entrance are all reachable", () => {
  const r = reachFrom(s, s.start.x, s.start.y);
  const rp = s.props.find((p) => p.id === "rune.surface")!;
  assert.ok(r.at(s.start.x, s.start.y), "start is free");
  assert.ok(r.near(rp.x + RUNE_NODES.surface.arrive.dx, rp.y + RUNE_NODES.surface.arrive.dy, 6), "rune arrival");
  const basket = s.loose.find((l) => l.id === "basket")!;
  assert.ok(r.near(basket.x, basket.y, 16), "basket within reach");
  const cart = s.props.find((p) => p.kind === "cart")!;
  assert.ok(r.near(cart.x, cart.y + 8, 16), "cart within reach");
  for (let y = SURFACE_GATE.y0; y <= SURFACE_GATE.arch.y; y++) for (let x = SURFACE_GATE.x0; x <= SURFACE_GATE.x1; x++)
    assert.ok(r.near(x * TS + 8, y * TS + 12, 6), `gate tile ${x},${y}`);
  // every tree and rock can be walked up to
  for (const p of s.props.filter((q) => q.kind === "tree" || q.kind === "rock")) assert.ok(r.near(p.x, p.y + 6, 22), p.id);
  // no sealed pockets: every open tile is reachable
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.grid[y * s.w + x] === T.FLOOR) {
    const blockedByProp = s.props.some((p) => { const b = boxOf(p); return b && x * TS + 8 > b[0] && x * TS + 8 < b[2] && y * TS + 8 > b[1] && y * TS + 8 < b[3]; });
    if (!blockedByProp) assert.ok(r.near(x * TS + 8, y * TS + 12, 9), `open tile ${x},${y} reachable`);
  }
});

test("the surface gate lines up with the dungeon corridor through one shared offset", () => {
  assert.deepEqual(DUNGEON_TO_SURFACE, { dx: 12, dy: 6 });
  assert.deepEqual(toSurface(GATE_CORRIDOR.exit.x, GATE_CORRIDOR.exit.y), { x: 48, y: 61 });
  assert.deepEqual(SURFACE_GATE.arch, { x: 48, y: 61 });
  const d = buildDungeon();
  const exit = d.exits.find((e) => e.label === "SURFACE GATE")!;
  assert.deepEqual({ x: exit.x, y: exit.y }, GATE_CORRIDOR.exit, "schematic marker uses the shared corridor");
  const gate = s.props.find((p) => p.kind === "buriedgate")!;
  assert.deepEqual([Math.floor(gate.x / TS), Math.floor((gate.y - 1) / TS)], [SURFACE_GATE.arch.x, SURFACE_GATE.arch.y]);
});

test("the buried entrance zone is walkable: no solid tiles, no blocking props, no visible opening", () => {
  const x0 = SURFACE_GATE.x0 - 1, x1 = SURFACE_GATE.x1 + 1, y0 = SURFACE_GATE.y0, y1 = SURFACE_GATE.arch.y;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) assert.equal(s.grid[y * s.w + x], T.FLOOR, `${x},${y}`);
  for (const p of s.props) {
    const b = boxOf(p);
    if (!b) continue;
    assert.ok(b[2] <= x0 * TS || b[0] >= (x1 + 1) * TS || b[3] <= y0 * TS || b[1] >= (y1 + 1) * TS, `${p.id} blocks the entrance`);
  }
  const g = propDef("buriedgate");
  assert.ok(!g.box && g.flat && g.examine, "buried gate is a flat, walkable examine marker");
});

test("nothing on the surface reveals the dungeon: no grates, no pits, no light but the rune", () => {
  assert.ok(!s.props.some((p) => p.kind === "grate"));
  assert.ok(!s.grid.some((t) => t === 8), "no PIT tiles (former id 8)");
  assert.deepEqual(s.lights.map((l) => l.id), ["runeglow"]);
  assert.ok(!s.props.some((p) => propDef(p.kind).light));
  assert.ok(!s.props.some((p) => p.kind === "statue" || p.kind === "statue_fallen"), "no tidy ruins");
  assert.ok(!s.grid.some((t) => t === T.WALL || t === T.PILLAR), "no standing keep walls");
});

test("nothing from the overgrowth overlaps the rune circle's footprint", () => {
  const rc = { x: RUNE_T.x * TS + 8, y: RUNE_T.y * TS + 8 };
  for (const p of s.props) if (p.id !== "rune.surface") assert.ok(Math.hypot(p.x - rc.x, p.y - 8 - rc.y) > RUNE_KEEP_R, p.id);
  for (const d of s.decals) assert.ok(Math.hypot(d.x - rc.x, d.y - rc.y) > RUNE_KEEP_R - 4, `${d.kind}@${d.x},${d.y}`);
});

test("the dungeon's SURFACE GATE corridor is choked with rock and stays impassable", () => {
  const d = buildDungeon();
  for (let y = GATE_CORRIDOR.y0 - 1; y <= GATE_CORRIDOR.y1; y++) for (let x = GATE_CORRIDOR.x0; x <= GATE_CORRIDOR.x1; x++)
    assert.ok(isSolidT(d.grid[y * d.w + x]), `${x},${y} solid`);
  assert.ok(d.props.filter((p) => p.kind === "rockpile").length >= 5, "heaped rock piles");
  assert.ok(d.decals.some((k) => k.kind === "spill") && d.decals.some((k) => k.kind === "rootshang"));
  const r = reachFrom(d, d.start.x, d.start.y);
  assert.ok(r.near((GATE_CORRIDOR.x0 + 2) * TS, (GATE_CORRIDOR.y0 - 3) * TS + 8, 10), "Vestibule still reachable");
  assert.ok(!r.near((GATE_CORRIDOR.x0 + 2) * TS, (GATE_CORRIDOR.y0 + 2) * TS + 8, 8), "but not the corridor");
});

const circle = buildCircle();

test("dormant rune: under 30% of the carvings survive, in contiguous segments", () => {
  const L = runeLayout(circle.pixels);
  const frac = L.pixels.filter((p) => p.survive).length / L.pixels.length;
  assert.ok(frac > 0.05 && frac < 0.3, `surviving fraction ${frac.toFixed(3)}`);
  // contiguity: most survivors have a surviving neighbour (erosion, not noise)
  const set = new Set(L.pixels.filter((p) => p.survive).map((p) => `${p.x},${p.y}`));
  const lonely = [...set].filter((k) => { const [x, y] = k.split(",").map(Number); return ![[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([i, j]) => set.has(`${x + i},${y + j}`)); });
  assert.ok(lonely.length < set.size * 0.15, `${lonely.length} isolated of ${set.size}`);
  assert.deepEqual(runeLayout(circle.pixels), L, "deterministic");
  assert.ok(L.plants.length > 100, "missing carvings are overgrown");
});

test("the awakening sweep is monotonic and ends on the full carved circle with no plants on it", () => {
  const L = runeLayout(circle.pixels);
  let prev = new Set<number>(), prevPlants = Infinity;
  for (let i = 0; i <= 50; i++) {
    const p = i / 50;
    const shown = new Set(L.pixels.map((q, k) => (carvingShown(q, p) ? k : -1)).filter((k) => k >= 0));
    for (const k of prev) assert.ok(shown.has(k), `carving ${k} vanished at ${p}`);
    const plants = L.plants.filter((c) => plantShown(c, p)).length;
    assert.ok(plants <= prevPlants, "plants only ever clear");
    prev = shown; prevPlants = plants;
  }
  assert.equal(prev.size, L.pixels.length, "fully revealed == full carved circle");
  assert.equal(L.pixels.filter((q) => carvingShown(q, 0)).length, L.pixels.filter((q) => q.survive).length);
  // plants clear before (or exactly when) the carvings they cover are redrawn
  const at = new Map(L.pixels.map((q) => [`${q.x},${q.y}`, q]));
  for (const c of L.plants) for (const q of c.px) {
    const under = at.get(`${c.x + q.dx},${c.y + q.dy}`);
    if (!under) continue;
    assert.ok(!c.keep, "kept overgrowth never covers a carving");
    assert.ok(c.key <= under.key, "clump clears no later than the carving beneath it");
  }
  assert.equal(L.plants.filter((c) => plantShown(c, 1) && !c.keep).length, 0);
});

test("rune art renders at 0, 0.5 and 1, caches idle states and re-renders only on change", () => {
  const art = new SurfaceRuneArt(circle);
  const ctx = makeCanvas(160, 160).ctx;
  for (const p of [0, 0.5, 1]) { ctx.drawImage(art.scene(p), 0, 0); ctx.drawImage(art.emitSurv(), 0, 0); ctx.drawImage(art.emitRev(p), 0, 0); }
  const n = art.renders;
  for (let i = 0; i < 30; i++) { art.scene(0); art.scene(1); art.emitRev(0); art.emitRev(1); art.emitSurv(); art.scene(0.5); art.emitRev(0.5); }
  assert.equal(art.renders, n, "idle frames do not re-render");
  art.scene(0.6);
  assert.ok(art.renders > n);
  assert.ok(art.survivingFraction < 0.3);
});

test("new surface sprites render; legacy props unaffected by registration", () => {
  resetTrace();
  for (const k of ["bush", "fern", "tallgrass", "wildflowers", "sapling", "stump", "log", "boulder", "outcrop", "wallstub", "masonry", "stoneslab", "cairn", "standingstone", "statue_toppled", "capstone", "buriedgate", "rockpile"])
    for (let v = 0; v < 4; v++) assert.ok(propSprite(k, v, false), k);
  assert.ok(traceHash());
});

test("v3 saves migrate: stale surface diffs are discarded, stable ids and items kept", () => {
  const v3 = {
    version: 3, seed: 1, rng: 1, time: 0, playTime: 0, flags: ["golem.basket"], playerId: "golem",
    actors: [{ id: "golem", area: "surface", x: 5, y: 5, task: { kind: "reach" }, queue: [] }], scheduled: [],
    areas: { surface: { tiles: [[100, 2]], props: { "tree@3,4": { taken: true } }, looseTaken: ["basket"], looseAdded: [{ id: "drop0", item: "wood", n: 3, x: 1, y: 1 }], looseSeq: 1, propsAdded: [], propSeq: 2, decalsAdded: [{ kind: "x", x: 0, y: 0, v: 0 }], ritual: null } },
  };
  const m = migrate(v3, MIGRATIONS, 4) as any;
  assert.equal(m.version, 4);
  assert.deepEqual(m.areas.surface.tiles, []);
  assert.deepEqual(m.areas.surface.props, {});
  assert.deepEqual(m.areas.surface.looseTaken, ["basket"]);
  assert.equal(m.areas.surface.looseAdded[0].n, 3, "dropped stacks are kept");
  assert.equal(m.areas.surface.propSeq, 2);
  assert.equal(m.actors[0].x, 48 * 16 + 8);
});
