// Surface slice: inventory rework, rune network travel, harvesting, building,
// off-screen policy, save/load + migration, perf and save-size reports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { player, currentArea, getArea, setFlag, enterArea, makeActor, type World } from "../src/game/world/world";
import { serialize, deserialize, SAVE_VERSION } from "../src/game/world/save";
import { capacity, addItems, giveItem, countItem, hasItem, reconcileCapacity } from "../src/game/sim/inventory";
import { dropFromSlot, orderBuild, readItem } from "../src/game/sim/commands";
import { placement } from "../src/game/sim/build";
import { travel, arrivalSpot } from "../src/game/sim/runes";
import { checkRune } from "../src/game/sim/ritual";
import { schedule, enqueueTask } from "../src/game/sim/tasks";
import { stepWorld } from "../src/game/sim/step";
import { boxFree } from "../src/game/sim/collision";
import { interactables } from "../src/game/sim/interact";
import { RUNE_NODES, runeDestination } from "../src/game/content/runes";
import { HARVEST } from "../src/game/content/harvest";
import { FLAGS } from "../src/game/content/flags";
import { T, TS } from "../src/game/content/tiles";
import { AreaView } from "../src/game/view/areaView";
import { bakeRegion } from "../src/game/art";
import { computeVis, makeLight } from "../src/game/light";
import { makeCanvas } from "../src/game/util";
import type { ItemId } from "../src/game/content/items";
import { events, find, frame, frames, newWorld, useOn } from "./helpers";

const total = (w: World, id: ItemId) => countItem(player(w), id) + [...w.areas.values()].reduce((s, a) => s + a.loose.filter((l) => !l.taken && l.item === id).reduce((k, l) => k + (l.n ?? 1), 0), 0);

/** Finish the tutorial puzzle and take the first jump; ends standing on the surface. */
function toSurface(w: World) {
  const pl = player(w), dg = currentArea(w), r = dg.ritual!;
  r.core = true; r.carved = true; r.sockets = r.solution.slice();
  checkRune(w, dg);
  r.actT = 5;
  const c = dg.ritualPos;
  pl.x = c.x; pl.y = c.y + 2;
  let g = 0;
  while (pl.area !== "surface" && g++ < 1000) frame(w);
  frames(w, 5);
}

// ------------------------------------------------------------------ Part A
test("capacity is derived from tiers: 8 / 16 with the arm / 48 with the basket", () => {
  const w = newWorld(), pl = player(w);
  assert.equal(capacity(w, pl), 8);
  setFlag(w, FLAGS.golemArm); assert.equal(capacity(w, pl), 16);
  w.flags.delete(FLAGS.golemArm); setFlag(w, FLAGS.golemBasket); assert.equal(capacity(w, pl), 48, "highest satisfied tier wins");
});

test("stacking: materials stack to their max, tools take a slot each", () => {
  const w = newWorld(), pl = player(w);
  assert.equal(addItems(w, pl, "wood", 25), 0);
  assert.deepEqual(pl.inventory.filter(Boolean), [{ item: "wood", n: 20 }, { item: "wood", n: 5 }]);
  addItems(w, pl, "chisel", 1); addItems(w, pl, "key", 1);
  assert.equal(pl.inventory.filter(Boolean).length, 4);
  assert.equal(countItem(pl, "wood"), 25);
});

test("full pack: extra items land on the ground, nothing is lost", () => {
  const w = newWorld(), pl = player(w);
  currentArea(w).takeLoose("coin"); // the treasury's own coin is not part of this test
  for (const id of ["chisel", "key", "core", "glyph0", "glyph1", "glyph2", "glyph3", "crown"] as ItemId[]) addItems(w, pl, id, 1);
  events(w);
  giveItem(w, pl, "coin", 1);
  const ev = events(w);
  assert.ok(ev.some((e) => e.t === "packFull"));
  assert.ok(!hasItem(pl, "coin"));
  assert.equal(total(w, "coin"), 1, "coin is on the ground");
  // picking it up with a full pack refuses and leaves it there
  const it = find(w, (i) => i.kind === "item" && currentArea(w).looseItem(i.looseId!)?.item === "coin");
  useOn(w, it);
  assert.equal(total(w, "coin"), 1);
});

test("capacity growth reveals slots without moving items; a shrink never loses items", () => {
  const w = newWorld(), pl = player(w);
  setFlag(w, FLAGS.golemArm);
  addItems(w, pl, "chisel", 1);
  for (let i = 0; i < 15; i++) addItems(w, pl, i % 2 ? "wood" : "stone", 20);
  const before = JSON.stringify(pl.inventory.slice(0, 16));
  setFlag(w, FLAGS.golemBasket); reconcileCapacity(w, pl);
  assert.equal(pl.inventory.length, 48);
  assert.equal(JSON.stringify(pl.inventory.slice(0, 16)), before, "growth keeps slots in place");
  const wood = total(w, "wood"), stone = total(w, "stone");
  w.flags.delete(FLAGS.golemBasket); w.flags.delete(FLAGS.golemArm);
  stepWorld(w, 1 / 60);
  assert.equal(pl.inventory.length, 8);
  assert.equal(total(w, "wood"), wood); assert.equal(total(w, "stone"), stone);
  assert.ok(hasItem(pl, "chisel"));
  assert.ok(currentArea(w).loose.some((l) => l.dyn && !l.taken), "overflow dropped into the world");
});

test("drop with Q: one unit, in front of the golem, stable id, saves, and can be picked up again", () => {
  const w = newWorld(), pl = player(w);
  addItems(w, pl, "coin", 1); addItems(w, pl, "wood", 3);
  pl.facing = "down";
  const slot = pl.inventory.findIndex((s) => s?.item === "wood");
  assert.equal(dropFromSlot(w, pl, slot), "ok");
  assert.equal(countItem(pl, "wood"), 2);
  const a = currentArea(w), l = a.loose.find((x) => x.dyn)!;
  assert.equal(l.id, "drop0");
  assert.equal(Math.floor(l.y / TS), Math.floor((pl.y - 3) / TS) + 1, "landed on the tile in front");
  assert.equal(dropFromSlot(w, pl, slot), "ok");
  assert.equal(a.loose.filter((x) => x.dyn && !x.taken).length, 1, "same spot merges into one stack");
  assert.equal(a.loose.find((x) => x.dyn)!.n, 2);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.deepEqual(serialize(w2), serialize(w));
  const it = interactables(currentArea(w2)).find((i) => i.looseId === "drop0")!;
  useOn(w2, it);
  assert.equal(countItem(player(w2), "wood"), 3);
  assert.equal(getArea(w2, "dungeon").looseItem("drop0")!.taken, true);
});

test("tutorial-critical items are not droppable", () => {
  const w = newWorld(), pl = player(w);
  for (const id of ["chisel", "schematic", "core", "key", "glyph1"] as ItemId[]) {
    addItems(w, pl, id, 1);
    events(w);
    assert.equal(dropFromSlot(w, pl, pl.inventory.findIndex((s) => s?.item === id)), "undroppable", id);
    assert.ok(events(w).some((e) => e.t === "message"), "feedback");
    assert.ok(hasItem(pl, id));
  }
});

test("dropped items can't satisfy ritual sockets or the centre", () => {
  const w = newWorld(), pl = player(w), a = currentArea(w), r = a.ritual!;
  addItems(w, pl, "coin", 1); addItems(w, pl, "crown", 1);
  const sock = find(w, (i) => i.kind === "socket" && i.socket === 0);
  pl.x = sock.x; pl.y = sock.y + 9; pl.facing = "up";
  dropFromSlot(w, pl, 0);
  const c = a.ritualPos; pl.x = c.x; pl.y = c.y + 12;
  dropFromSlot(w, pl, 1);
  frames(w, 30);
  assert.deepEqual(r.sockets, [-1, -1, -1, -1]);
  assert.equal(r.core, false);
  assert.ok(!events(w).some((e) => e.t === "runeActivated" || e.t === "runeFizzled" || e.t === "glyphPlaced"));
});

test("basket on the surface grants the 48-slot tier", () => {
  const w = newWorld(), pl = player(w);
  enterArea(w, pl, "surface", 100, 100);
  const it = find(w, (i) => i.looseId === "basket");
  useOn(w, it);
  assert.ok(w.flags.has(FLAGS.golemBasket));
  assert.equal(capacity(w, pl), 48);
  assert.ok(!hasItem(pl, "basket"), "installed, not stored");
});

test("a full 48-slot inventory round-trips through save/load", () => {
  const w = newWorld(), pl = player(w);
  setFlag(w, FLAGS.golemBasket);
  const ids: ItemId[] = ["wood", "stone", "coin", "crown", "goblet", "chisel"];
  for (let i = 0; i < 48; i++) addItems(w, pl, ids[i % ids.length], ids[i % ids.length] === "wood" || ids[i % ids.length] === "stone" ? 20 : 1);
  assert.equal(pl.inventory.filter(Boolean).length, 48);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.deepEqual(player(w2).inventory, pl.inventory);
});

test("a v1 save (ItemId[] inventory, area-less schedule) migrates to the current version", () => {
  const w = newWorld(4242), pl = player(w);
  addItems(w, pl, "chisel", 1); addItems(w, pl, "coin", 1);
  schedule(w, 5, pl, { op: "grantItem", item: "goblet" });
  const s: any = serialize(w);
  const v1 = {
    ...s, version: 1,
    actors: s.actors.map((a: any) => ({ ...a, inventory: a.inventory.filter(Boolean).map((x: any) => x.item), task: null, queue: [] })),
    scheduled: s.scheduled.map(({ area: _a, ...e }: any) => e),
    areas: Object.fromEntries(Object.entries(s.areas).map(([id, d]: [string, any]) => {
      const { looseAdded: _l, looseSeq: _q, propsAdded: _p, propSeq: _s, ...rest } = d;
      return [id, rest];
    })),
  };
  const w2 = deserialize(v1);
  assert.equal(SAVE_VERSION, 4);
  assert.deepEqual(player(w2).inventory.filter(Boolean), [{ item: "chisel", n: 1 }, { item: "coin", n: 1 }]);
  assert.equal(player(w2).inventory.length, 8);
  assert.equal(w2.scheduled[0].area, "dungeon");
  for (let i = 0; i < 400; i++) stepWorld(w2, 1 / 60);
  assert.ok(hasItem(player(w2), "goblet"), "migrated schedule still fires");
});

// ------------------------------------------------------------------ Part B
test("rune links resolve both ways from one declaration", () => {
  assert.equal(runeDestination("dungeon")!.node.id, "surface");
  assert.equal(runeDestination("surface")!.node.id, "dungeon");
});

test("an inactive rune gives feedback and does nothing", () => {
  const w = newWorld(), pl = player(w);
  assert.equal(travel(w, pl, currentArea(w), "rune.dungeon"), false);
  assert.equal(pl.area, "dungeon");
  assert.ok(events(w).some((e) => e.t === "message"));
  enterArea(w, pl, "surface", 100, 100);
  const it = find(w, (i) => i.kind === "rune");
  useOn(w, it);
  assert.equal(pl.area, "surface", "dormant surface rune goes nowhere");
});

test("tutorial teleport arrives at the surface rune via the network and wakes it", () => {
  const w = newWorld(), pl = player(w);
  toSurface(w);
  assert.equal(pl.area, "surface");
  assert.ok(w.flags.has(RUNE_NODES.surface.flag) && w.flags.has(FLAGS.tutorialDone));
  const rp = getArea(w, "surface").prop("rune.surface")!;
  assert.ok(Math.hypot(pl.x - rp.x, pl.y - rp.y) < 12, "placed at the linked rune");
});

test("round trip: back to the dungeon circle without re-triggering the tutorial, and up again", () => {
  const w = newWorld(), pl = player(w);
  toSurface(w);
  const flags = [...w.flags].sort();
  const ritual = JSON.stringify(getArea(w, "dungeon").ritual);
  events(w);
  useOn(w, find(w, (i) => i.kind === "rune"));
  let g = 0; while ((pl.area as string) !== "dungeon" && g++ < 400) frame(w);
  assert.equal(pl.area, "dungeon");
  const c = getArea(w, "dungeon").ritualPos;
  assert.ok(Math.abs(pl.x - c.x) < 4 && pl.y > c.y + 20, "arrived just south of the circle");
  frames(w, 400);
  const ev = events(w);
  assert.ok(!ev.some((e) => e.t === "teleport" && e.first), "no first-jump cinematic again");
  assert.equal(pl.area, "dungeon", "standing near the circle does not bounce back");
  assert.deepEqual([...w.flags].sort(), flags);
  assert.equal(JSON.stringify(getArea(w, "dungeon").ritual).replace(/"actT":[\d.e-]+/, ""), ritual.replace(/"actT":[\d.e-]+/, ""));
  useOn(w, find(w, (i) => i.kind === "rune"));
  g = 0; while ((pl.area as string) !== "surface" && g++ < 400) frame(w);
  assert.equal(pl.area, "surface");
});

test("arrival falls back to the nearest free spot when the rune is blocked", () => {
  const w = newWorld();
  const s = getArea(w, "surface"), rp = s.prop("rune.surface")!, n = RUNE_NODES.surface;
  s.addProp("rock", rp.x + n.arrive.dx, rp.y + n.arrive.dy + 4);
  const spot = arrivalSpot(w, n);
  assert.ok(boxFree(s, spot.x, spot.y));
  assert.notDeepEqual(spot, { x: rp.x + n.arrive.dx, y: rp.y + n.arrive.dy });
  assert.deepEqual(arrivalSpot(w, n), spot, "deterministic");
});

// ------------------------------------------------------------------ Part C
function nearestTree(w: World) {
  const pl = player(w);
  return interactables(currentArea(w)).filter((i) => i.kind === "harvest" && currentArea(w).prop(i.propId!)!.kind === "tree")
    .sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y))[0];
}

test("multi-hit harvest: damage lives on the tree, yields wood, then depletes to a stump", () => {
  const w = newWorld(); toSurface(w);
  const pl = player(w), t = nearestTree(w), p = currentArea(w).prop(t.propId!)!;
  const rev = currentArea(w).revision;
  for (let i = 0; i < 3; i++) useOn(w, t);
  assert.equal(p.dmg, 3); assert.equal(p.taken, false); assert.equal(countItem(pl, "wood"), 3);
  assert.ok(currentArea(w).revision > rev);
  useOn(w, t);
  assert.equal(p.taken, true, "depleted (permanent in v1)");
  assert.equal(countItem(pl, "wood"), HARVEST.tree.hp * HARVEST.tree.perHit.n + HARVEST.tree.final!.n);
  assert.ok(!interactables(currentArea(w)).some((i) => i.propId === p.id));
});

test("harvesting with a full pack drops the yield on the ground", () => {
  const w = newWorld(); toSurface(w);
  const pl = player(w);
  setFlag(w, FLAGS.golemArm);
  for (let i = 0; i < 16; i++) addItems(w, pl, i % 2 ? "coin" : "crown", 1);
  useOn(w, nearestTree(w));
  assert.equal(countItem(pl, "wood"), 0);
  assert.equal(total(w, "wood"), 1);
});

test("regrow hook schedules into the prop's own area, even after the harvester travels", () => {
  const w = newWorld(); toSurface(w);
  const pl = player(w), t = nearestTree(w), p = currentArea(w).prop(t.propId!)!;
  HARVEST.tree.regrow = 2;
  try {
    for (let i = 0; i < 4; i++) useOn(w, t);
    assert.equal(p.taken, true);
    assert.equal(w.scheduled.at(-1)!.area, "surface");
    useOn(w, find(w, (i) => i.kind === "rune"));
    let g = 0; while ((pl.area as string) !== "dungeon" && g++ < 400) frame(w);
    frames(w, 200);
    assert.equal(p.taken, false, "regrew in the surface while the golem was below");
    assert.equal(p.dmg, 0);
  } finally { delete HARVEST.tree.regrow; }
});

test("queued work aimed at an area is dropped when its actor travels", () => {
  const w = newWorld();
  const a = makeActor("helper", "fixture", "dungeon", 100, 100);
  w.actors.push(a);
  enqueueTask(a, { kind: "reach", dur: 0.5, effect: { op: "cue", cue: "scrape" } });
  enterArea(w, a, "surface", 100, 100);
  assert.equal(a.queue.length, 0);
});

test("build placement is validated in sim and gated by know.build", () => {
  const w = newWorld(); toSurface(w);
  const pl = player(w), a = currentArea(w);
  pl.x = 20 * TS + 8; pl.y = 50 * TS + 14; pl.facing = "down";
  for (let ty = 49; ty <= 53; ty++) for (let tx = 18; tx <= 22; tx++) a.setTile(tx, ty, T.FLOOR);
  a.props = a.props.filter((p) => Math.abs(p.x - pl.x) > 64 || Math.abs(p.y - pl.y) > 64);
  const tx = 20, ty = 51;
  assert.deepEqual(placement(w, pl, a, "torch", tx, ty), { ok: false, reason: "unknown" });
  addItems(w, pl, "book_build", 1); readItem(w, pl, "book_build");
  assert.ok(w.flags.has(FLAGS.knowBuild));
  assert.deepEqual(placement(w, pl, a, "torch", tx, ty), { ok: false, reason: "cost" });
  addItems(w, pl, "wood", 4); addItems(w, pl, "stone", 2);
  assert.deepEqual(placement(w, pl, a, "torch", tx, ty), { ok: true });
  assert.deepEqual(placement(w, pl, a, "torch", tx, ty + 4), { ok: false, reason: "reach" });
  a.setTile(tx + 1, ty, T.RUBBLE);
  assert.deepEqual(placement(w, pl, a, "torch", tx + 1, ty), { ok: false, reason: "solid" });
  const rp = a.prop("rune.surface")!;
  pl.x = rp.x; pl.y = rp.y + 40;
  assert.deepEqual(placement(w, pl, a, "torch", Math.floor(rp.x / TS), Math.floor(rp.y / TS) + 1), { ok: false, reason: "occupied" });
});

test("placing a torch consumes materials, creates a lit prop and registers its light; saves", () => {
  const w = newWorld(); toSurface(w);
  const pl = player(w), a = currentArea(w);
  setFlag(w, FLAGS.knowBuild); addItems(w, pl, "wood", 3); addItems(w, pl, "stone", 1);
  const rp = a.prop("rune.surface")!;
  pl.x = rp.x + 72; pl.y = rp.y + 8; pl.facing = "right";
  const tx = Math.floor(pl.x / TS) + 1, ty = Math.floor((pl.y - 3) / TS);
  const view = new AreaView(a);
  assert.ok(orderBuild(w, pl, "torch", tx, ty));
  while (pl.task) frame(w);
  const torch = a.props.find((p) => p.kind === "torch_post")!;
  assert.ok(torch && torch.lit && torch.dyn);
  assert.equal(countItem(pl, "wood"), 1); assert.equal(countItem(pl, "stone"), 0);
  view.flush();
  assert.ok(view.lights.has("prop:" + torch.id), "light reconciled from area.revision, no manual re-bake");
  view.prepare(torch.x - 160, torch.y - 90, 320, 180);
  assert.ok(view.lights.get("prop:" + torch.id)!.n > 0, "traced once in view");
  // a partially harvested tree too
  const t = nearestTree(w); useOn(w, t);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.deepEqual(serialize(w2), serialize(w));
  const a2 = currentArea(w2);
  assert.equal(a2.prop(torch.id)!.lit, true);
  assert.equal(a2.prop(t.propId!)!.dmg, 1);
  assert.ok(new AreaView(a2).lights.has("prop:" + torch.id));
});

test("surface changes persist across travel and save/load", () => {
  const w = newWorld(); toSurface(w);
  const pl = player(w);
  useOn(w, nearestTree(w));
  addItems(w, pl, "coin", 1); pl.facing = "down"; dropFromSlot(w, pl, pl.inventory.findIndex((s) => s?.item === "coin"));
  const snap = JSON.stringify(serialize(w).areas.surface);
  useOn(w, find(w, (i) => i.kind === "rune"));
  let g = 0; while ((pl.area as string) !== "dungeon" && g++ < 400) frame(w);
  const mid = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.equal(JSON.stringify(serialize(mid).areas.surface), snap, "mid-travel save keeps the surface");
  useOn(w, find(w, (i) => i.kind === "rune"));
  g = 0; while ((pl.area as string) !== "surface" && g++ < 400) frame(w);
  assert.equal(JSON.stringify(serialize(w).areas.surface), snap);
});

// ------------------------------------------------------------------ Part D
test("perf report: surface bake and light tracing, full vs view-window", () => {
  const s = getArea(newWorld(), "surface");
  // The wild surface has a single builder light (the rune). Add one far from the
  // view so "only lights near the view get traced" is still exercised.
  s.lights.push({ x: (s.w - 4) * TS, y: (s.h - 4) * TS, rad: 40, col: [1, 1, 1], int: 0.5, flick: 0, id: "far-probe" });
  const c = makeCanvas(s.w * TS, s.h * TS);
  let t0 = performance.now();
  bakeRegion(c.ctx, s, 0, 0, s.w - 1, s.h - 1);
  const fullBake = performance.now() - t0;
  const lights = s.lights.map((l) => makeLight(l.x, l.y, l.rad, l.col, l.int, l.flick));
  t0 = performance.now();
  for (const L of lights) computeVis(L, s);
  const fullVis = performance.now() - t0;
  const v = new AreaView(s);
  const rp = s.prop("rune.surface")!;
  t0 = performance.now();
  v.prepare(rp.x - 160, rp.y - 102, 320, 180);
  const firstFrame = performance.now() - t0;
  t0 = performance.now();
  let n = 0; while (v.idle()) n++;
  const idleTotal = performance.now() - t0;
  console.log(`# PERF surface ${s.w}x${s.h}: full bake ${fullBake.toFixed(1)}ms, all ${lights.length} lights traced ${fullVis.toFixed(1)}ms | ` +
    `chunked first frame ${firstFrame.toFixed(1)}ms (${v.stats.chunksBaked - n} chunks, ${v.stats.visTraced} lights), then ${n} chunks in background (${(idleTotal / Math.max(1, n)).toFixed(1)}ms/frame)`);
  assert.ok(v.fullyBaked);
  assert.ok(v.stats.visTraced < lights.length);
});

test("save-size report: mass tile edits on the surface", () => {
  const w = newWorld(); const s = getArea(w, "surface");
  const base = JSON.stringify(serialize(w)).length;
  let n = 0;
  for (let ty = 4; ty < s.h - 4 && n < 3000; ty++) for (let tx = 4; tx < s.w - 4 && n < 3000; tx++) { s.setTile(tx, ty, s.tile(tx, ty) === T.FLOOR ? T.RUBBLE : T.FLOOR); n++; }
  const size = JSON.stringify(serialize(w)).length;
  console.log(`# SAVE baseline ${base} B; after ${n} surface tile edits ${size} B (${((size - base) / n).toFixed(1)} B/tile)`);
  assert.ok(size < 100000);
});
