// The overworld (v21): the surface as one continuous area put together from sites, zones as the way the game refers
// to places in it, navigation that holds up over long distances, and simulation by distance: a settlement nobody is
// near sleeps, and a worker far away walks and works abstractly. Docs: docs/world/overworld.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { T, TS, isSolidT } from "../src/game/content/tiles";
import { OVERWORLD_H, OVERWORLD_ID, OVERWORLD_W, SITE_AT, ZONE } from "../src/game/content/places";
import { WEST_ROAD } from "../src/game/content/geography";
import { HARVEST } from "../src/game/content/harvest";
import { buildOverworld, OVERWORLD, SITES } from "../src/game/overworld";
import { composeArea } from "../src/game/world/compose";
import { WOOD_GAP } from "../src/game/woodGap";
import { buildTown } from "../src/game/town";
import { buildSurface } from "../src/game/surface";
import { buildOldRoad } from "../src/game/oldRoad";
import { buildThroneRoad } from "../src/game/throneRoad";
import { buildWestRoad } from "../src/game/westRoad";
import { Area, SECTOR } from "../src/game/world/area";
import { AREAS } from "../src/game/world/areas";
import { actorById, createWorld, enterArea, getArea, player, type Actor, type World } from "../src/game/world/world";
import { inZone, spotIn, spotsIn, tendedAt, zoneAt, zoneById, zonesOf } from "../src/game/world/zones";
import { SAVE_VERSION, deserialize, migrate, serialize } from "../src/game/world/save";
import { boxFree, nearestFree, propBlocks } from "../src/game/sim/collision";
import { reachable as flood, nearReached, type Box } from "../src/game/sim/reach";
import { findPath, navGrid, navStats, planPath, reachable, LEG } from "../src/game/sim/navigation";
import { enableLod, lodTier } from "../src/game/sim/lod";
import { stepWorld } from "../src/game/sim/step";
import { assignJob, gatherOrder, walkOrder } from "../src/game/sim/jobs";
import { gatherSources, jobView, walkOptions } from "../src/game/sim/orders";
import { countItem } from "../src/game/sim/inventory";
import { isFolk, planAt, STALE } from "../src/game/sim/folk";
import { preOverworld } from "./support/preOverworld";
import { discover } from "../src/game/world/discovery";

const DT = 0.05, WORKER = "npc.worker.artificery";
const over = (w: World) => getArea(w, OVERWORLD_ID);
/** The halls' worker golem, cored and quick, set down on the overworld. */
function workerAt(w: World, x: number, y: number): Actor {
  const wk = actorById(w, WORKER)!;
  wk.powerCore = "ruby_core"; wk.gear.rune0 = "rune_swift";
  enterArea(w, wk, OVERWORLD_ID, x, y);
  return wk;
}
const run = (w: World, seconds: number, until: () => boolean = () => false) => { for (let t = 0; t < seconds && !until(); t += DT) { stepWorld(w, DT); w.events.length = 0; } };
const roadY = (WEST_ROAD.surface.y0 + 1) * TS + 12;

// ------------------------------------------------------------------ the compositor
test("the overworld is one area made of sites: each set down whole at its place, a zone each, nothing overlapping", () => {
  // the compositor on its own: the finished overworld also opens the band between the old road and the ruins (below)
  const o = composeArea(OVERWORLD), town = buildTown(), wild = buildSurface(), road = buildOldRoad(), west = buildWestRoad(), cross = buildThroneRoad();
  assert.deepEqual([o.id, o.w, o.h], [OVERWORLD_ID, OVERWORLD_W, OVERWORLD_H]);
  assert.equal(AREAS.town, undefined, "Westwake is not an area");
  assert.deepEqual(zonesOf(o).map((z) => [z.id, z.kind, z.x, z.y, z.w, z.h]), [
    ["westroad", "road", 0, 0, west.w, west.h], ["westwake", "settlement", west.w, 3, town.w, town.h],
    ["throneroad", "road", west.w + town.w, 0, cross.w, cross.h], ["oldroad", "road", west.w + town.w + cross.w, 0, road.w, road.h],
    ["ruins", "wild", west.w + town.w + cross.w + road.w, 0, wild.w, wild.h],
  ]);
  assert.deepEqual(SITES.map((s) => s.zone), [ZONE.westroad, ZONE.westwake, ZONE.throneroad, ZONE.oldroad, ZONE.ruins]);
  assert.equal(o.w, west.w + town.w + cross.w + road.w + wild.w, "the overworld is exactly its sites, side by side");
  // every tile, prop, light, decal and spot of a site is there, moved by the site's origin and by nothing else
  for (const [d, site] of [[town, "westwake"], [wild, "ruins"], [road, "oldroad"], [west, "westroad"], [cross, "throneroad"]] as const) {
    const at = SITE_AT[site], z = zoneById(o, site)!, pre = z.ids ?? "";
    let tiles = 0;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (o.grid[(y + at.y) * o.w + x + at.x] !== d.grid[y * d.w + x]) tiles++;
    assert.ok(tiles <= 3, `${site}: its ground as its builder laid it (but for the seam where the road runs on: ${tiles})`);
    const byId = new Map(o.props.map((p) => [p.id, p]));
    const moved = d.props.filter((p) => { const q = byId.get(pre + p.id); return q && q.x === p.x + at.x * TS && q.y === p.y + at.y * TS && q.kind === p.kind; }).length;
    assert.ok(d.props.length - moved <= 2, `${site}: ${moved} of ${d.props.length} props`);
    assert.equal(spotsIn(o, site).length, (d.spots ?? []).length, `${site}: its standing places, tagged with its zone`);
    assert.deepEqual([z.ox, z.oy], [at.x * TS, at.y * TS]);
  }
  assert.equal(new Set(o.props.map((p) => p.id)).size, o.props.length, "prop ids are unique across sites");
  assert.equal(o.props.length, town.props.length + wild.props.length + road.props.length + west.props.length + cross.props.length);
  assert.equal(o.decals.length, town.decals.length + wild.decals.length + road.decals.length + west.decals.length + cross.decals.length);
  // the ruins keep the ids every save and rune names; Westwake's carry its zone
  assert.ok(o.props.some((p) => p.id === "rune.surface") && o.props.some((p) => p.kind === "marketcross" && p.id.startsWith("westwake/marketcross@")) && o.lights.some((l) => l.id === "runeglow"));
  // the same builders give the same overworld
  const again = composeArea(OVERWORLD);
  assert.deepEqual(again.props, o.props); assert.deepEqual(Array.from(again.grid), Array.from(o.grid)); assert.deepEqual(again.zones, o.zones);
});

test("the old road and the ruins are one country: no band of thicket between them, and nothing else is changed", () => {
  const base = composeArea(OVERWORLD), o = buildOverworld(), a = new Area(o);
  // only thicket in the band's columns became ground; every other tile is as the sites laid it
  let opened = 0;
  for (let i = 0; i < o.grid.length; i++) {
    const x = i % o.w;
    if (o.grid[i] === base.grid[i]) { assert.equal(o.style[i], base.style[i]); continue; }
    assert.ok(x >= WOOD_GAP.x0 && x < WOOD_GAP.x1 && isSolidT(base.grid[i]) && !isSolidT(o.grid[i]), `tile ${x},${(i / o.w) | 0}`);
    opened++;
  }
  assert.ok(opened > 300, `${opened} tiles opened`);
  // what stood before still stands, in the same order; what is new is added after it, all in the band
  assert.deepEqual(o.props.slice(0, base.props.length), base.props);
  assert.deepEqual(o.decals.slice(0, base.decals.length), base.decals);
  const added = o.props.slice(base.props.length);
  assert.ok(added.some((p) => p.kind === "tree"), "it has trees of its own");
  assert.ok(added.every((p) => p.x >= (WOOD_GAP.x0 - 1) * TS && p.x < (WOOD_GAP.x1 + 1) * TS));
  assert.equal(new Set(o.props.map((p) => p.id)).size, o.props.length);
  // one can cross well north and well south of the road, without using it
  const boxes: Box[] = a.props.filter(propBlocks).map((p) => p.box as Box);
  const { y0, y1 } = WEST_ROAD.surface;
  for (const [from, to] of [[0, y0 - 2], [y1 + 3, o.h]]) {
    const half = { w: o.w, h: o.h, grid: o.grid.map((t, i) => { const y = (i / o.w) | 0; return y >= from && y < to ? t : T.THICKET; }) };
    let y = (from + to) >> 1;
    while (!nearReached(a, flood(half, boxes, { x: (WOOD_GAP.x0 - 2) * TS + 8, y: y * TS + 12 }), (WOOD_GAP.x0 - 2) * TS + 8, y * TS + 12, 0)) y++;
    const r = flood(half, boxes, { x: (WOOD_GAP.x0 - 2) * TS + 8, y: y * TS + 12 });
    assert.ok(nearReached(a, r, (WOOD_GAP.x1 + 2) * TS + 8, y * TS + 12, 4), `crossing in rows ${from}..${to}`);
  }
  // no pocket in the opened ground: everywhere a body fits there can be walked to
  const r = flood(a, boxes, o.start);
  for (let y = 0; y < o.h; y++) for (let x = WOOD_GAP.x0; x < WOOD_GAP.x1; x++)
    if (boxFree(a, x * TS + 8, y * TS + 12)) assert.ok(r[y * o.w + x], `${x},${y}`);
});

test("nothing is crossed between the ruins and Westwake: no portal, one road, every door and place on foot from the rune", () => {
  const o = buildOverworld(), a = new Area(o);
  assert.deepEqual(o.portals!.map((p) => p.id).sort(), ["stair_down", ...["armory", "guild", "jeweler", "smithy", "tailor", "tavern"].map((e) => `westwake/door.${e}`)].sort());
  assert.ok(o.portals!.every((p) => p.to.area !== OVERWORLD_ID), "every portal left leads somewhere else: a room, the halls");
  for (const id of Object.keys(AREAS)) for (const p of AREAS[id]().portals ?? []) if (p.to.area === OVERWORLD_ID) assert.ok(o.portals!.some((q) => q.id === p.to.portal), `${id}.${p.id} comes out at ${p.to.portal}`);
  // the road: open ground on its rows from the East Gate to the ruins' clearing
  const town = zoneById(o, "westwake")!, mid = WEST_ROAD.surface.y0 + 1;
  for (let x = Math.floor(town.anchor.x / TS); x < SITE_AT.ruins.x + 8; x++) assert.ok(!isSolidT(o.grid[mid * o.w + x]), `road tile ${x},${mid}`);
  // on foot from the rune: every zone's arrival place, every door, every standing place of the town and the camp
  const boxes: Box[] = a.props.filter(propBlocks).map((p) => p.box as Box);
  const r = flood(a, boxes, o.start);
  for (const z of zonesOf(o)) assert.ok(nearReached(a, r, z.anchor.x, z.anchor.y), `${z.id}: where one arrives`);
  for (const p of o.portals!) assert.ok(nearReached(a, r, p.x + p.w / 2, p.y + p.h / 2, 2), `${p.id}`);
  for (const s of o.spots!) assert.ok(nearReached(a, r, s.x, s.y, 2), `${s.zone}: ${s.id}`);
});

test("zones: which place a point is in, a zone's own places, where lamps are kept, all without walking a list", () => {
  const o = buildOverworld();
  const town = zoneById(o, "westwake")!, ruins = zoneById(o, "ruins")!, road = zoneById(o, "oldroad")!;
  assert.equal(zoneAt(o, town.anchor.x, town.anchor.y), town); assert.equal(zoneAt(o, o.start.x, o.start.y), ruins);
  assert.equal(zoneAt(o, road.anchor.x, road.anchor.y), road);
  assert.equal(zoneAt(o, (town.x + 40) * TS, 8), null, "the meadow north of the town's own map belongs to no site");
  assert.equal(zoneAt(o, -5, 20), null); assert.equal(zoneAt(o, o.w * TS + 5, 20), null);
  // every tile of the map agrees with the zones' rects (the index is exact, also where a cell straddles a border)
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    const want = zonesOf(o).find((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) ?? null;
    assert.equal(zoneAt(o, x * TS + 8, y * TS + 8), want, `${x},${y}`);
  }
  // spot ids are a zone's own
  const door = spotIn(o, "door.tavern", "westwake")!, bed = spotIn(o, "bed.1", "ruins")!;
  assert.ok(door && inZone(town, door.x, door.y) && bed && inZone(ruins, bed.x, bed.y));
  assert.equal(spotIn(o, "door.tavern", "ruins"), undefined); assert.equal(spotIn(o, "door.tavern"), door, "unqualified: the first of that id");
  assert.ok(spotsIn(o, "westwake").every((s) => s.zone === "westwake" && inZone(town, s.x, s.y)));
  assert.equal(spotsIn(o, "oldroad").length, 0);
  // tended: Westwake's ground only; and how each wakes (a town as a whole; open country only where the player is)
  assert.ok(tendedAt(o, door.x, door.y) && !tendedAt(o, o.start.x, o.start.y) && !tendedAt(o, road.anchor.x, road.anchor.y));
  assert.deepEqual(zonesOf(o).map((z) => z.wake), ["bubble", "whole", "bubble", "bubble", "whole"]);
  assert.deepEqual(zonesOf(o).map((z) => z.name), ["THE WEST ROAD", "WESTWAKE", "THE THRONE ROAD", "THE OLD ROAD", "THE RUINS"]);
});

// ------------------------------------------------------------------ performance: collision and navigation
test("collision asks only what stands near: the bucketed answer is the brute-force answer, everywhere", () => {
  const w = createWorld(3), a = over(w);
  const brute = (x: number, y: number) => {
    const x0 = x - 5, x1 = x + 5, y0 = y - 5, y1 = y;
    for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++) for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++)
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h || isSolidT(a.grid[ty * a.w + tx])) return false;
    return !a.props.some((p) => propBlocks(p) && x1 > p.box![0] && x0 < p.box![2] && y1 > p.box![1] && y0 < p.box![3]);
  };
  let s = 12345, free = 0;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * a.w * TS, y = rnd() * a.h * TS, f = boxFree(a, x, y);
    assert.equal(f, brute(x, y), `${x.toFixed(1)},${y.toFixed(1)}`);
    if (f) free++;
  }
  assert.ok(free > 1500 && free < 5500, `a real mix of free and blocked (${free})`);
  // and it follows the world: fell a tree and its ground frees; build on it and it blocks again
  const tree = a.props.find((p) => p.kind === "tree" && !p.taken && HARVEST.tree?.clearBox)!;
  if (tree) {
    assert.ok(!boxFree(a, tree.x, tree.y - 1));
    a.setPropState(tree.id, { taken: true }); assert.ok(boxFree(a, tree.x, tree.y - 1));
    const post = a.addProp("torch_post", tree.x, tree.y, { lit: true }); assert.ok(!boxFree(a, tree.x, tree.y - 1));
    a.removeProp(post.id); assert.ok(boxFree(a, tree.x, tree.y - 1));
  }
});

test("a layout change costs the sectors it touches: the navigation grid is kept and stays right", () => {
  const w = createWorld(3), a = over(w), pl = player(w);
  enterArea(w, pl, OVERWORLD_ID, a.start.x, a.start.y);
  const grid = navGrid(a, pl);
  // work the whole area out once (a path across it), then change one thing
  assert.ok(findPath(w, pl, { ...zoneById(a, "westwake")!.anchor, range: 1 }, false));
  const before = Array.from(a.sectorRev), known = navStats(a, pl).regionsKnown;
  assert.equal(a.sectorRev.length, Math.ceil(a.w / SECTOR) * Math.ceil(a.h / SECTOR));
  const tree = a.props.find((p) => p.kind === "tree" && inZone(zoneById(a, "oldroad")!, p.x, p.y))!;
  const cell = Math.floor((tree.y - 3) / TS) * a.w + Math.floor(tree.x / TS);
  assert.ok(!grid.stand(cell), "a tree stands there");
  a.removeProp(tree.id);
  const touched = before.filter((v, i) => a.sectorRev[i] !== v).length;
  assert.ok(touched >= 1 && touched <= 4, `only the sectors round the tree (${touched} of ${before.length})`);
  assert.equal(navGrid(a, pl), grid, "the same grid");
  assert.ok(grid.stand(cell), "and it knows the tree is gone");
  assert.ok(navStats(a, pl).regionsKnown <= known, "nothing else was worked out again");
  assert.ok(findPath(w, pl, { x: tree.x, y: tree.y - 2, range: 1 }, false), "and a path leads onto the freed ground");
});

test("long ways are planned coarse first: a corridor of regions, the fine search inside it, in legs", () => {
  const w = createWorld(3), a = over(w), pl = player(w), town = zoneById(a, "westwake")!, ruins = zoneById(a, "ruins")!;
  // from the cart in the east of the ruins to the old well in the west of the town: most of the overworld's width
  const from = nearestFree(a, ruins.ox + 73 * TS + 8, ruins.oy + 36 * TS + 12)!, well = spotIn(a, "idle.well", "westwake")!;
  enterArea(w, pl, OVERWORLD_ID, from.x, from.y);
  const goal = { x: well.x, y: well.y, range: 1 };
  // the whole way exists, and is long
  const whole = findPath(w, pl, goal, false)!;
  assert.ok(whole && whole.length > 180, `cart to well: ${whole?.length} cells`);
  const full = navStats(a, pl);
  assert.ok(full.regions < 80, `the corridor search looked at ${full.regions} regions`);
  assert.ok(full.tiles < a.w * a.h * 0.4, `the fine search stayed in the corridor (${full.tiles} of ${a.w * a.h} cells)`);
  // a walker asks only for the next leg: a few regions' worth, however far the goal
  const leg = planPath(w, pl, goal, false)!;
  assert.ok(leg.partial && leg.path.length < whole.length * 0.8, `a leg of ${leg.path.length} cells`);
  assert.ok(navStats(a, pl).tiles <= (LEG + 1) * SECTOR * SECTOR, "bounded by the leg, not by the map");
  // legs join up: walking them in turn gets there, by about the same length as the whole way
  const at = { x: pl.x, y: pl.y };
  let cells = 0, legs = 0;
  for (; legs < 60; legs++) {
    const p = planPath(w, pl, goal, false)!;
    assert.ok(p && p.path.length, `leg ${legs}`);
    cells += p.path.length;
    const end = p.path[p.path.length - 1]; pl.x = end.x; pl.y = end.y;
    if (!p.partial) break;
  }
  assert.ok(Math.hypot(pl.x - goal.x, pl.y - goal.y) <= TS, "the last leg ends there");
  assert.ok(legs >= 1 && cells < whole.length * 1.5, `${legs + 1} legs, ${cells} cells`);
  pl.x = at.x; pl.y = at.y;
  // somewhere that cannot be reached is refused on the region graph, without a tile search: inside the town's wall, a sealed room's worth of thicket
  const t0 = navStats(a, pl).tiles;
  assert.equal(reachable(w, pl, { x: town.ox + 4 * TS + 8, y: town.oy + 10 * TS + 8, range: 1 }), false, "inside the wall's masonry");
  assert.equal(reachable(w, pl, { x: a.w * TS - 8, y: 8, range: 1 }), false, "in the thicket at the world's edge");
  assert.equal(reachable(w, pl, goal), true);
  assert.equal(navStats(a, pl).tiles, t0, "no tile search was run to find that out");
  assert.equal(findPath(w, pl, { x: a.w * TS - 8, y: 8, range: 1 }), null);
});

// ------------------------------------------------------------------ simulation by distance
test("a settlement nobody is near sleeps: its people cost nothing, and are where the hour says when someone comes", () => {
  const w = createWorld(7), a = over(w), pl = player(w), town = zoneById(a, "westwake")!;
  enableLod(w);
  enterArea(w, pl, OVERWORLD_ID, a.start.x, a.start.y);
  const folk = w.actors.filter((x) => isFolk(x) && x.person!.zone === "westwake");
  assert.equal(folk.length, 17);
  run(w, 3);
  assert.deepEqual([...w.lod!.awake], ["ruins"], "at the rune only the ruins are awake");
  assert.ok(folk.every((x) => lodTier(w, x, pl) === "far"), "Westwake's people are far: abstract");
  assert.ok(folk.every((x) => w.time - x.life!.seen > STALE), "none of them was stepped");
  assert.ok(w.lod!.counts.far >= folk.length);
  const was = folk.map((x) => [x.x, x.y]);
  run(w, 5);
  assert.deepEqual(folk.map((x) => [x.x, x.y]), was, "nobody moved: nothing was simulated");
  // the camp, in the ruins with the golem, is lived step by step
  const camp = w.actors.filter((x) => isFolk(x) && x.person!.zone === "ruins");
  assert.ok(camp.length === 3 && camp.every((x) => lodTier(w, x, pl) !== "far" && w.time - x.life!.seen < 1));
  // walk up the road: the town wakes whole while still well out of sight, and everyone is set down by the hour
  enterArea(w, pl, OVERWORLD_ID, town.ox + town.w * TS + 600, roadY);
  run(w, DT);
  assert.ok(w.lod!.awake.has("westwake"), "awake as soon as the bubble touches it");
  assert.ok(folk.every((x) => x.area !== OVERWORLD_ID || lodTier(w, x, pl) !== "far"), "the whole town, also its far side");
  assert.ok(folk.every((x) => w.time - x.life!.seen < 1e-6 && x.life!.plan === planAt(w, x).key), "set down where the hour says, on the first tick");
  run(w, 4);
  assert.ok(folk.some((x, i) => x.x !== was[i][0] || x.y !== was[i][1]), "and they go about their day");
});

test("a worker far away still does the job: it walks abstractly and works by the clock, and stands on real ground", () => {
  const order = (lod: boolean) => {
    const w = createWorld(9), a = over(w), road = zoneById(a, "oldroad")!;
    if (lod) enableLod(w);
    // the golem stays down in the halls; the worker is on the old road, a whole area away
    const wk = workerAt(w, road.anchor.x, road.anchor.y);
    // (orders name the places the golem has been, world/discovery.ts: it has never been up, so nothing up here is on
    // offer; then it has been to the ruins and along the road, and gone back down)
    assert.deepEqual(gatherSources(w, wk, "wood"), []);
    discover(w, OVERWORLD_ID, "ruins"); discover(w, OVERWORLD_ID, "oldroad");
    const src = gatherSources(w, wk, "wood");
    assert.deepEqual(src.map((s) => [s.area, s.zone, s.label]), [[OVERWORLD_ID, "oldroad", "THE OLD ROAD"], [OVERWORLD_ID, "ruins", "THE RUINS"]], "the surface is offered place by place");
    assert.ok(assignJob(w, wk, gatherOrder("wood", OVERWORLD_ID, null, 6, false, "oldroad")));
    assert.deepEqual(jobView(w, wk)!.lines, ["FROM THE OLD ROAD", "TO INVENTORY"]);
    const steps = { n: 0 };
    run(w, 600, () => { steps.n++; return wk.job?.status !== "running"; });
    return { w, a, wk, road, t: w.time };
  };
  const far = order(true), near = order(false);
  for (const [name, r] of [["abstract", far], ["stepped", near]] as const) {
    assert.equal(r.wk.job?.status, "done", `${name}: ${JSON.stringify(r.wk.job)}`);
    assert.ok(countItem(r.wk, "wood") >= 6, `${name}: carries what it was sent for`);
    assert.ok(inZone(r.road, r.wk.x, r.wk.y), `${name}: it kept to the place it was sent to`);
    assert.ok(navGrid(r.a, r.wk).free(r.wk.x, r.wk.y), `${name}: standing on free ground`);
  }
  assert.equal(lodTier(far.w, far.wk, player(far.w)), "far");
  assert.ok(far.t < near.t * 1.6 + 5, `far away it takes about as long as it would in sight (${far.t.toFixed(1)} s against ${near.t.toFixed(1)} s)`);
  // the trees it felled are felled, in the world, for whoever comes by later
  assert.ok(far.a.props.some((p) => p.kind === "tree" && p.dmg > 0 && inZone(far.road, p.x, p.y)) || far.a.props.some((p) => p.taken && inZone(far.road, p.x, p.y)));
});

test("sent across the overworld with nobody watching, a worker gets there; when the golem turns up it is simply there", () => {
  const w = createWorld(11), a = over(w), pl = player(w), town = zoneById(a, "westwake")!;
  enableLod(w);
  const wk = workerAt(w, a.start.x + 24, a.start.y + 30);
  // the golem has walked the road to Westwake before, and is back down in the halls (tests/discovery.test.ts holds what is offered before that)
  for (const z of ["ruins", "oldroad", "westwake"]) discover(w, OVERWORLD_ID, z);
  const opts = walkOptions(w, wk).filter((o) => o.area === OVERWORLD_ID).map((o) => o.label);
  for (const l of ["SURFACE START", "WESTWAKE START", "THE OLD ROAD START"]) assert.ok(opts.includes(l), `${l} in ${opts}`);
  const spot = walkOptions(w, wk).find((o) => o.label === "WESTWAKE START")!;
  assert.ok(assignJob(w, wk, walkOrder(spot.area, spot.x, spot.y)));
  assert.equal(jobView(w, wk)!.title, "GO TO WESTWAKE");
  const d0 = Math.hypot(wk.x - spot.x, wk.y - spot.y);
  w.events.length = 0;
  let portals = 0, moved = 0, last = { x: wk.x, y: wk.y };
  for (let t = 0; t < 900 && wk.job?.status === "running"; t += DT) {
    stepWorld(w, DT);
    portals += w.events.filter((e) => e.t === "portal" || e.t === "areaEntered").length; w.events.length = 0;
    moved += Math.hypot(wk.x - last.x, wk.y - last.y); last = { x: wk.x, y: wk.y };
  }
  assert.equal(wk.job?.status, "done", JSON.stringify(wk.job));
  assert.ok(Math.hypot(wk.x - spot.x, wk.y - spot.y) < 3 && wk.area === OVERWORLD_ID && inZone(town, wk.x, wk.y));
  assert.equal(portals, 0, "one area: nothing to cross");
  assert.ok(d0 > 1500 && moved > d0 && moved < d0 * 1.8, `it walked the road (${moved.toFixed(0)} px for ${d0.toFixed(0)} as the crow flies), it was not set down there`);
  // the golem comes up out of the halls beside it: it is where it stopped, on real ground, and takes its next order in sight
  enterArea(w, pl, OVERWORLD_ID, wk.x + 40, wk.y + 4);
  run(w, 0.5);
  assert.equal(lodTier(w, wk, pl), "active");
  assert.ok(navGrid(a, wk).free(wk.x, wk.y));
  const door = spotIn(a, "door.smithy", "westwake")!;
  assert.ok(assignJob(w, wk, walkOrder(OVERWORLD_ID, door.x, door.y + 6)));
  run(w, 240, () => wk.job?.status !== "running");
  assert.equal(wk.job?.status, "done", JSON.stringify(wk.job));
});

// ------------------------------------------------------------------ saves
test("save v21: a save from before the overworld loads with Westwake folded into the surface, everything where that ground now lies", () => {
  assert.equal(SAVE_VERSION, 23);
  const w = createWorld(21), a = over(w), pl = player(w), town = zoneById(a, "westwake")!, ruins = zoneById(a, "ruins")!;
  enterArea(w, pl, OVERWORLD_ID, town.anchor.x, town.anchor.y);
  // (it came up at the ruins and walked the road, as anyone standing in Westwake has: what a save from before v22 is taken to know)
  discover(w, OVERWORLD_ID, "ruins"); discover(w, OVERWORLD_ID, "oldroad");
  // things only play makes, on both old maps: a stack dropped and a torch built in the ruins, a stack dropped in the square
  // (with the id a town-made stack carries after the migration), a worker sent to gather in the ruins and store in the halls
  a.addLoose("wood", 3, ruins.ox + 600, ruins.oy + 500);
  a.addProp("torch_post", ruins.ox + 640, ruins.oy + 500, { lit: true });
  a.addLoose("stone", 2, town.ox + 47 * TS, town.oy + 34 * TS, "westwake/drop90");
  const well = a.props.find((p) => p.kind === "well")!, wellWas = well.id.slice("westwake/".length);
  assert.ok(well.id.startsWith("westwake/"));
  a.setPropState(well.id, { dmg: 1 });
  const wk = workerAt(w, ruins.ox + 700, ruins.oy + 420);
  assert.ok(assignJob(w, wk, gatherOrder("wood", OVERWORLD_ID, null, 3, false, "ruins")));
  run(w, 6);
  const now = JSON.parse(JSON.stringify(serialize(w)));
  // the same world as v20 held it
  const old = preOverworld(now);
  assert.equal(old.version, 20);
  assert.ok(["dungeon", "surface", "town"].every((k) => k in old.areas), `the town an area again (${Object.keys(old.areas)})`);
  const oldPl = old.actors.find((x: Actor) => x.id === pl.id), oldWk = old.actors.find((x: Actor) => x.id === WORKER);
  assert.deepEqual([oldPl.area, oldPl.x, oldPl.y], ["town", pl.x - town.ox, pl.y - 3 * TS], "the golem was in the town area, in the town's own coordinates");
  assert.deepEqual([oldWk.area, oldWk.x, oldWk.job.args.fromArea, oldWk.job.args.fromZone], ["surface", wk.x - ruins.ox, "surface", undefined]);
  assert.ok(old.flags.includes("census.town") && old.flags.includes("census.surface") && !old.flags.includes("census.westwake"));
  assert.ok(old.actors.filter((x: Actor) => x.area === "town" && x.kind === "folk").length > 5);
  assert.deepEqual(old.areas.town.looseAdded.map((l: { id: string }) => l.id), ["drop90"]); assert.deepEqual(old.areas.town.props[wellWas], { dmg: 1 }, "under the id the town's own map gave it");
  // migrating it gives today's save back, exactly; loading it gives today's world
  const up = migrate(old) as typeof now;
  assert.deepEqual(up, now);
  const back = deserialize(old);
  assert.deepEqual(serialize(back), serialize(w));
  assert.equal(back.areas.has("town"), false);
  assert.equal(over(back).prop(well.id)!.dmg, 1);
  // and it plays on: the worker finishes the order it was given before the world was rearranged
  const wk2 = actorById(back, WORKER)!;
  run(back, 300, () => wk2.job?.status !== "running");
  assert.equal(wk2.job?.status, "done", JSON.stringify(wk2.job));
  assert.ok(countItem(wk2, "wood") >= 3);
  // an older save runs the whole chain
  assert.equal((migrate({ ...old, version: 19 }) as { version: number }).version, 23);
});
