// The wild surface: builder determinism and reachability, the buried entrance
// (walkable, non-solid, readable), the dungeon's rock-choked SURFACE GATE, the
// overgrown rune's erosion / awakening model, and the v3 -> v4 save migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { buildSurface, RUNE_T, RUNE_ART_R, RUNE_CLEAR_PROPS } from "../src/game/surface";
import { buildDungeon } from "../src/game/map";
import { T, TS } from "../src/game/content/tiles";
import { PROPS, propDef } from "../src/game/content/props";
import { HARVEST } from "../src/game/content/harvest";
import { DUNGEON_TO_SURFACE, GATE_CORRIDOR, GATE_EXIT, SURFACE_GATE, SURFACE_GATE_ZONE, dungeonToSurface } from "../src/game/content/geography";
import { reachable, nearReached, cellFeet, type Box } from "../src/game/sim/reach";
import { propBlocks, boxFree } from "../src/game/sim/collision";
import { getArea, enterArea, player, currentArea, type World } from "../src/game/world/world";
import type { Area } from "../src/game/world/area";
import { serialize, deserialize } from "../src/game/world/save";
import { circlePixels } from "../src/game/circle";
import { runeModel, carvingVisible, plantVisible, clumpCleared, RUNE_SURVIVE } from "../src/game/runeReveal";
import { SurfaceRuneArt } from "../src/game/surfaceRune";
import { propSprite } from "../src/game/art/props";
import { events, find, frames, newWorld, useOn } from "./helpers";

const surfaceOf = (w: World = newWorld()) => getArea(w, "surface");
const boxesOf = (a: Area): Box[] => a.props.filter(propBlocks).map((p) => p.box!);
const reachOf = (a: Area) => reachable(a, boxesOf(a), a.base.start);

// ------------------------------------------------------------------ builder
test("surface builder is deterministic", () => {
  const a = buildSurface(), b = buildSurface();
  assert.deepEqual([...a.grid], [...b.grid]);
  assert.deepEqual([...a.style], [...b.style]);
  assert.deepEqual(JSON.stringify([a.props, a.decals, a.lights, a.loose]), JSON.stringify([b.props, b.decals, b.lights, b.loose]));
  assert.equal(new Set(a.props.map((p) => p.id)).size, a.props.length, "prop ids are unique");
});

test("surface keeps its size, rune, start, ids and closing thicket edge", () => {
  const s = buildSurface();
  assert.equal(s.id, "surface"); assert.equal(s.w, 96); assert.equal(s.h, 72);
  const rune = s.props.find((p) => p.id === "rune.surface")!;
  assert.deepEqual([rune.x, rune.y], [RUNE_T.x * TS + 8, RUNE_T.y * TS + 8]);
  assert.ok(Math.hypot(s.start.x - rune.x, s.start.y - rune.y) < 12, "start beside the rune");
  assert.ok(s.loose.some((l) => l.id === "basket" && l.item === "basket"));
  assert.ok(s.props.some((p) => p.kind === "cart"));
  assert.ok(s.props.filter((p) => p.kind === "tree").length > 60 && s.props.some((p) => p.kind === "rock"), "harvestable trees and rocks");
  for (let x = 0; x < s.w; x++) { assert.equal(s.grid[x], T.THICKET); assert.equal(s.grid[(s.h - 1) * s.w + x], T.THICKET); }
  for (let y = 0; y < s.h; y++) { assert.equal(s.grid[y * s.w], T.THICKET); assert.equal(s.grid[y * s.w + s.w - 1], T.THICKET); }
});

test("the dungeon is hidden: no grates, no sinkholes, nothing glows but the rune", () => {
  const s = buildSurface();
  assert.ok(!("grate" in PROPS), "grate kind removed");
  assert.ok(!s.props.some((p) => p.kind === "grate"));
  assert.ok(s.grid.every((t) => t === T.FLOOR || t === T.THICKET), "only open ground and thicket (no PIT / wall / rubble tiles)");
  assert.deepEqual(s.lights.map((l) => l.id), ["runeglow"]);
  assert.ok(!s.props.some((p) => propDef(p.kind).light), "no glowing props");
});

test("the wild has variety: several ground styles, overgrowth and a handful of remains", () => {
  const s = buildSurface();
  const styles = new Set<number>(); for (let i = 0; i < s.grid.length; i++) if (s.grid[i] === T.FLOOR) styles.add(s.style[i]);
  assert.ok(styles.size >= 5, `ground styles: ${[...styles]}`);
  const kinds = new Set(s.props.map((p) => p.kind));
  for (const k of ["bush", "fern", "tallgrass", "sapling", "stump", "log", "boulder", "outcrop"]) assert.ok(kinds.has(k), k);
  const remains = s.props.filter((p) => ["wallstub", "masonry", "stoneslab", "cairn", "standingstone", "statue_toppled"].includes(p.kind));
  assert.ok(remains.length >= 6 && remains.length <= 14, `remains: ${remains.length}`);
  const dk = new Set(s.decals.map((d) => d.kind));
  for (const k of ["hump", "mosspatch", "leaves", "ivy", "shade", "wildflowers", "weeds"]) assert.ok(dk.has(k), k);
});

test("everything meaningful is reachable on foot, with no sealed pockets", () => {
  const a = surfaceOf(), r = reachOf(a);
  const rp = a.prop("rune.surface")!;
  assert.ok(nearReached(a, r, rp.x, rp.y + 4, 0), "rune");
  const basket = a.loose.find((l) => l.id === "basket")!;
  assert.ok(nearReached(a, r, basket.x, basket.y), "basket");
  const cart = a.props.find((p) => p.kind === "cart")!;
  assert.ok(nearReached(a, r, cart.x, cart.y + 8), "cart");
  for (let y = SURFACE_GATE_ZONE.y0; y <= SURFACE_GATE_ZONE.y1; y++) for (let x = SURFACE_GATE_ZONE.x0; x <= SURFACE_GATE_ZONE.x1; x++)
    assert.equal(r[y * a.w + x], 1, `entrance cell ${x},${y}`);
  for (const p of a.props) if (HARVEST[p.kind] || propDef(p.kind).examine) assert.ok(nearReached(a, r, p.x, p.y - 4), `${p.id} can be walked up to`);
  // no sealed pockets: every cell the golem could stand in is connected
  let pockets = 0;
  for (let ty = 0; ty < a.h; ty++) for (let tx = 0; tx < a.w; tx++) {
    const f = cellFeet(tx, ty);
    if (!r[ty * a.w + tx] && boxFree(a, f.x, f.y)) pockets++;
  }
  assert.equal(pockets, 0);
});

test("nothing from the wild overlaps the rune circle's footprint", () => {
  const s = buildSurface(), rc = { x: RUNE_T.x * TS + 8, y: RUNE_T.y * TS + 8 };
  for (const p of s.props) if (p.id !== "rune.surface") assert.ok(Math.hypot(p.x - rc.x, p.y - rc.y) >= RUNE_CLEAR_PROPS * TS, p.id);
  for (const d of s.decals) assert.ok(Math.hypot(d.x - rc.x, d.y - rc.y) > RUNE_ART_R + 6, `${d.kind} at ${d.x},${d.y}`);
});

// ------------------------------------------------------------------ entrance
test("one shared offset maps the dungeon's SURFACE GATE onto the surface", () => {
  assert.deepEqual(DUNGEON_TO_SURFACE, { dx: 12, dy: 6 });
  const d = buildDungeon();
  const ex = d.exits.find((e) => e.label === "SURFACE GATE")!;
  assert.deepEqual({ x: ex.x, y: ex.y }, GATE_EXIT, "schematic exit marker");
  assert.deepEqual(dungeonToSurface(GATE_EXIT.x, GATE_EXIT.y), { x: 48, y: 61 });
  assert.deepEqual(SURFACE_GATE, { x: 48, y: 61 });
  // the corridor's walls (x-1 and x+w) bound the surface entrance zone
  assert.equal(SURFACE_GATE_ZONE.x0, GATE_CORRIDOR.x - 1 + DUNGEON_TO_SURFACE.dx);
  assert.equal(SURFACE_GATE_ZONE.x1, GATE_CORRIDOR.x + GATE_CORRIDOR.w + DUNGEON_TO_SURFACE.dx);
  const s = buildSurface();
  const gate = s.props.find((p) => p.kind === "buriedgate")!;
  assert.deepEqual([Math.floor(gate.x / TS), Math.floor((gate.y - 1) / TS)], [SURFACE_GATE.x, SURFACE_GATE.y]);
});

test("the buried entrance is plain floor with no solid prop on it", () => {
  const a = surfaceOf();
  const z = SURFACE_GATE_ZONE, x0 = z.x0 * TS, x1 = (z.x1 + 1) * TS, y0 = z.y0 * TS, y1 = (z.y1 + 1) * TS;
  for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) assert.equal(a.tile(x, y), T.FLOOR);
  for (const p of a.props) {
    const b = p.box;
    if (b && propBlocks(p)) assert.ok(b[2] <= x0 || b[0] >= x1 || b[3] <= y0 || b[1] >= y1, `${p.id} blocks the entrance`);
  }
  assert.equal(propDef("buriedgate").box, undefined);
  assert.equal(propDef("buriedgate").flat, true);
  assert.equal(propDef("capstone").box, undefined);
});

test("the golem walks straight across the buried gate, and the ground sounds hollow", () => {
  const w = newWorld(), pl = player(w);
  enterArea(w, pl, "surface", SURFACE_GATE.x * TS + 8, SURFACE_GATE_ZONE.y0 * TS - 6);
  pl.facing = "down";
  const y0 = pl.y;
  frames(w, 60 * 14, { ix: 0, iy: 1, use: false });
  assert.ok(pl.y > (SURFACE_GATE.y + 1) * TS, `walked from ${y0} to ${pl.y}`);
  events(w);
  useOn(w, find(w, (i) => i.kind === "examine" && currentArea(w).prop(i.propId!)!.kind === "buriedgate"));
  assert.ok(events(w).some((e) => e.t === "message" && /HOLLOW/.test(e.text)));
});

test("in the dungeon, the SURFACE GATE corridor is solid rock and can't be entered", () => {
  const w = newWorld(), d = getArea(w, "dungeon");
  const C = GATE_CORRIDOR;
  for (let y = C.y; y < C.y + C.h; y++) for (let x = C.x; x < C.x + C.w; x++) assert.notEqual(d.tile(x, y), T.FLOOR, `${x},${y}`);
  assert.ok(d.props.filter((p) => p.kind === "rockpile").length >= 8, "heaped rock piles");
  assert.ok(d.decals.some((dc) => dc.kind === "earthspill") && d.decals.some((dc) => dc.kind === "rootfall"));
  const r = reachable(d, boxesOf(d), d.base.start);
  // Nothing from the corridor's first row down (walls included) is reachable.
  // Row C.y - 1 is the Vestibule's own bottom floor row: the builder heaps
  // rubble on its outer tiles but leaves the corridor mouth open, so the golem
  // can walk up to the rock face (pinned below), just not into the corridor.
  for (let y = C.y; y < d.h; y++) for (let x = C.x - 1; x <= C.x + C.w; x++) assert.equal(r[y * d.w + x], 0, `reached ${x},${y}`);
  for (const x of [C.x - 1, C.x, C.x + C.w - 1, C.x + C.w]) assert.equal(d.tile(x, C.y - 1), T.RUBBLE, `rubble at ${x},${C.y - 1}`);
  assert.equal(r[(C.y - 1) * d.w + C.x + 1], 1, "the corridor mouth in the Vestibule is reachable");
  // the Vestibule itself is still walkable
  assert.equal(r[46 * d.w + 33], 1);
});

// ------------------------------------------------------------------ rune
const model = runeModel(circlePixels());
const visibleSet = (t: number) => new Set(model.pixels.flatMap((p, i) => (carvingVisible(p, t) ? [i] : [])));

test("dormant rune: only a low fraction of carvings survive, in worn contiguous stretches", () => {
  const surv = model.pixels.filter((p) => p.survives);
  const f = surv.length / model.pixels.length;
  assert.ok(f > 0.05 && f < 0.3, `surviving fraction ${f.toFixed(3)} (target ${RUNE_SURVIVE})`);
  const at = new Set(surv.map((p) => `${p.x},${p.y}`));
  const lonely = surv.filter((p) => ![-1, 0, 1].some((j) => [-1, 0, 1].some((i) => (i || j) && at.has(`${p.x + i},${p.y + j}`)))).length;
  assert.ok(lonely / surv.length < 0.1, `isolated survivors ${lonely}/${surv.length}`);
  assert.equal(visibleSet(0).size, surv.length);
  assert.deepEqual(model, runeModel(circlePixels()), "deterministic");
});

test("plants grow where the carvings are missing", () => {
  const plantAt = new Set<string>();
  for (const c of model.clumps) for (const px of c.px) if (plantVisible(model, c, px, 0)) plantAt.add(`${px.x},${px.y}`);
  const missing = model.pixels.filter((p) => !p.survives);
  const covered = missing.filter((p) => [-1, 0, 1].some((j) => [-1, 0, 1].some((i) => plantAt.has(`${p.x + i},${p.y + j}`)))).length;
  assert.ok(covered / missing.length > 0.95, `covered ${covered}/${missing.length}`);
});

test("awakening sweep is monotonic and ends on the full carved circle", () => {
  let prev = visibleSet(0), prevPlants = Infinity;
  for (let k = 1; k <= 50; k++) {
    const t = k / 50, cur = visibleSet(t);
    for (const i of prev) assert.ok(cur.has(i), `carving ${i} vanished at ${t}`);
    let plants = 0;
    for (const c of model.clumps) for (const px of c.px) {
      if (!plantVisible(model, c, px, t)) continue;
      plants++;
      const kk = model.carvedAt[(px.y + 64) * 128 + px.x + 64];
      assert.ok(!(kk < 2 && (kk < 0 || kk <= t)), "no plant drawn over a visible carving");
    }
    assert.ok(plants <= prevPlants, "plants only ever clear");
    for (const c of model.clumps) if (clumpCleared(c, t - 1 / 50) && t - 1 / 50 > 0) assert.ok(clumpCleared(c, t));
    prev = cur; prevPlants = plants;
  }
  assert.equal(visibleSet(1).size, model.pixels.length, "fully redrawn");
  assert.ok(model.clumps.every((c) => c.persist || clumpCleared(c, 1)), "only rim growth outside the circle remains");
  assert.ok(model.clumps.some((c) => c.persist));
});

test("rune layers smoke-render at 0, 0.5 and 1 through the fake canvas, ends cached", () => {
  const art = new SurfaceRuneArt(circlePixels());
  for (const t of [0, 0.5, 1]) { const l = art.layers(t); assert.ok(l.scene && l.emit); }
  assert.equal(art.layers(0), art.layers(0));
  assert.equal(art.layers(1), art.layers(1));
  resetTrace(); art.layers(0); art.layers(1);
  assert.equal(traceHash(), "811c9dc5", "cached ends issue no draw calls");
  resetTrace(); art.layers(0.25); const h = traceHash(); art.layers(0.25);
  assert.equal(traceHash(), h, "same progress is not re-rasterised");
});

test("new surface and gate sprites all render (additive art)", () => {
  const kinds = ["buriedgate", "bush", "fern", "tallgrass", "sapling", "stump", "log", "boulder", "outcrop", "wallstub", "masonry",
    "stoneslab", "cairn", "standingstone", "statue_toppled", "capstone", "rockpile"];
  for (const k of kinds) for (let v = 0; v < 4; v++) for (const alt of [false, true]) assert.ok(propSprite(k, v, alt), `${k} v${v}`);
  for (const v of [2, 3]) assert.ok(propSprite("rock", v, false), "mossy rock");
});

// ------------------------------------------------------------------ saves
test("a v3 save's stale surface diff is discarded; the player's things survive", () => {
  const w = newWorld(), pl = player(w);
  getArea(w, "surface");
  const s: any = serialize(w);
  enterArea(w, pl, "surface", 30 * TS, 40 * TS);
  const v3 = {
    ...JSON.parse(JSON.stringify(s)), version: 3,
    actors: s.actors.map((a: any) => ({ ...a, area: "surface", x: 30 * TS, y: 40 * TS, task: { kind: "reach", t: 0, dur: 1, effect: { op: "cue", cue: "scrape" }, area: "surface" } })),
    scheduled: [...s.scheduled, { at: 99, actor: pl.id, area: "surface", effect: { op: "regrow", prop: "tree@31,40" } }],
  };
  v3.areas.surface = {
    tiles: [[40 * 96 + 30, T.RUBBLE]], props: { "tree@31,40": { dmg: 2 }, "grate@44,34": { taken: true } },
    looseTaken: ["basket"], looseAdded: [{ id: "drop0", item: "coin", x: 30 * TS, y: 41 * TS }], looseSeq: 1,
    propsAdded: [{ id: "torch_post#b0", kind: "torch_post", x: 30 * TS, y: 42 * TS, v: 0, lit: true }], propSeq: 1, decalsAdded: [{ kind: "debris", x: 1, y: 1, v: 0 }], ritual: null,
  };
  const w2 = deserialize(v3), a = getArea(w2, "surface"), p2 = player(w2);
  assert.deepEqual([...a.grid], [...a.base.grid], "old tile edits dropped");
  assert.equal(a.decals.length, a.base.decals.length);
  assert.ok(a.looseItem("basket")!.taken, "basket stays picked up");
  const onGround = a.loose.filter((l) => !l.taken && l.dyn).map((l) => `${l.item}x${l.n ?? 1}`).sort();
  assert.deepEqual(onGround, ["coinx1", "stonex1", "woodx2"], "dropped coin kept, torch refunded");
  const rp = a.prop("rune.surface")!;
  assert.ok(Math.hypot(p2.x - rp.x, p2.y - rp.y) < 12 && boxFree(a, p2.x, p2.y) && !p2.task, "player moved to the rune");
  assert.ok(!w2.scheduled.some((e) => e.area === "surface"));
  assert.ok(nearReached(a, reachOf(a), a.loose.find((l) => l.item === "coin")!.x, a.loose.find((l) => l.item === "coin")!.y), "refunds reachable");
  // and it round-trips at the current version
  assert.deepEqual(serialize(deserialize(JSON.parse(JSON.stringify(serialize(w2))))), serialize(w2));
});
