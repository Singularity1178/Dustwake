// Westwake, the market town west of the surface: the road to it, the town, the
// six rooms behind its shop doors, and the walk-through portals that join them.
// Headless: builders, sim and the recording fake canvas only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { AREAS } from "../src/game/world/areas";
import { Area } from "../src/game/world/area";
import { buildTown } from "../src/game/town";
import { buildInterior } from "../src/game/townInteriors";
import { buildSurface } from "../src/game/surface";
import { BUILDINGS, ESTABLISHMENTS, HIGH_END, SIGNS, TOWN_H, TOWN_ID, TOWN_W, building, doorPx, interiorId } from "../src/game/content/town";
import { propDef, propReach } from "../src/game/content/props";
import { HARVEST } from "../src/game/content/harvest";
import { DIALOGUE } from "../src/game/content/dialogue";
import { THOUGHTS } from "../src/game/content/monologue";
import { AREA_NAMES, WEST_ROAD } from "../src/game/content/geography";
import { T, TS, FS, isOpaqueT, isSolidT } from "../src/game/content/tiles";
import { FONT_GLYPHS } from "../src/game/font";
import { reachable, type Box } from "../src/game/sim/reach";
import { propBlocks, boxFree } from "../src/game/sim/collision";
import { portalArrival, portalById, portalsOf } from "../src/game/sim/portals";
import { createWorld, getArea, player, enterArea, type World } from "../src/game/world/world";
import { CENSUS } from "../src/game/content/folk";
import { isFolk } from "../src/game/sim/folk";
import { actorDef, capable } from "../src/game/content/actors";
import { serialize, deserialize } from "../src/game/world/save";
import { debugPlaces } from "../src/game/sim/debug";
import { TOWN_PROP_ART } from "../src/game/art/propsTown";
import { propSprite } from "../src/game/art/props";
import { bakeRegion } from "../src/game/art/tiles";
import { computeVis, makeLight } from "../src/game/light";
import { makeCanvas } from "../src/game/util";
import { viewSize, ZOOM_STEPS } from "../src/game/view/zoom";
import { events, frame, newWorld } from "./helpers";

const TOWN_AREAS = [TOWN_ID, ...ESTABLISHMENTS.map(interiorId)];
const areaOf = (id: string) => new Area(AREAS[id]());
const boxesOf = (a: Area): Box[] => a.props.filter(propBlocks).map((p) => p.box!);
const reachOf = (a: Area) => reachable(a, boxesOf(a), a.base.start);
/** Can the golem stand somewhere it can walk to, within `rad` px of (x, y)? */
function standNear(a: Area, r: ArrayLike<number>, x: number, y: number, rad: number): boolean {
  for (let dy = -rad; dy <= rad; dy += 2) for (let dx = -rad; dx <= rad; dx += 2) {
    if (dx * dx + dy * dy > rad * rad) continue;
    const px = x + dx, py = y + dy, tx = Math.floor(px / TS), ty = Math.floor((py - 1) / TS);
    if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) continue;
    if (r[ty * a.w + tx] && boxFree(a, px, py)) return true;
  }
  return false;
}
/** Hold a direction until `done`, as the play screen would. */
function push(w: World, ix: number, iy: number, done: () => boolean, max = 900): boolean {
  for (let i = 0; i < max && !done(); i++) frame(w, { ix, iy, use: false });
  return done();
}
const lint = (s: string, what: string) => { for (const ch of s) assert.ok(FONT_GLYPHS.has(ch), `${what}: "${ch}" is not in the bitmap font (${s})`); };

// ------------------------------------------------------------------ lore and the way there
test("the Guardian's village is where it said: a road leaves the surface westward and ends at Westwake", () => {
  const core = DIALOGUE.guardian.segments.find((s) => s.id === "core")!;
  assert.ok(core.pages.some((p) => /VILLAGE WEST OF HERE/.test(p.text)), "the guardian still points west");
  const s = buildSurface(), road = s.portals!.find((p) => p.id === WEST_ROAD.portal)!;
  assert.deepEqual(road.to, { area: TOWN_ID, portal: "east_road" });
  assert.equal(road.dir, "left");
  assert.ok(s.exits.some((e) => e.dir === "w" && e.label === "WESTWAKE"));
  for (let y = WEST_ROAD.surface.y0; y <= WEST_ROAD.surface.y1; y++) { assert.equal(s.grid[y * s.w], T.THICKET, "the edge column stays closed"); assert.equal(s.grid[y * s.w + 1], T.FLOOR, "the road reaches it"); }
  assert.ok(s.props.some((p) => p.kind === "waymark"), "a waymark stands at its mouth");
  const wild = buildSurface({ westRoad: false });
  assert.ok(!wild.portals!.some((p) => p.id === WEST_ROAD.portal), "(the stair head's own portal is not a road: tests/entrance.test.ts)"); assert.equal(wild.exits.length, 0);
  assert.equal(wild.grid[WEST_ROAD.surface.y0 * wild.w + 1], T.THICKET, "without the road the wild is as it was");
  assert.equal(AREA_NAMES[TOWN_ID], "WESTWAKE");
});

// ------------------------------------------------------------------ builders
test("town and interiors: deterministic, unique ids, big enough for the widest zoom, registered and named", () => {
  const a = buildTown(), b = buildTown();
  assert.deepEqual([...a.grid], [...b.grid]); assert.deepEqual([...a.style], [...b.style]);
  assert.equal(JSON.stringify([a.props, a.decals, a.lights, a.portals, a.spots]), JSON.stringify([b.props, b.decals, b.lights, b.portals, b.spots]));
  assert.equal(a.w, TOWN_W); assert.equal(a.h, TOWN_H);
  for (const e of ESTABLISHMENTS) assert.equal(JSON.stringify(buildInterior(e).props), JSON.stringify(buildInterior(e).props), e);
  const big = viewSize(Math.max(...ZOOM_STEPS));
  for (const id of TOWN_AREAS) {
    const d = AREAS[id]();
    assert.equal(d.id, id);
    assert.equal(new Set(d.props.map((p) => p.id)).size, d.props.length, `${id}: prop ids unique`);
    assert.ok(d.w * TS >= big.w && d.h * TS >= big.h, `${id} fills the 2x view`);
    assert.ok(AREA_NAMES[id], `${id} has a name`);
  }
});

test("buildings: inside the map, never overlapping, solid, with a street-level row that lets lamp light onto the front", () => {
  const t = buildTown();
  BUILDINGS.forEach((b, i) => {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= t.w && b.y + b.h <= t.h, b.id);
    for (const c of BUILDINGS.slice(i + 1)) assert.ok(b.x + b.w <= c.x || c.x + c.w <= b.x || b.y + b.h <= c.y || c.y + c.h <= b.y, `${b.id} overlaps ${c.id}`);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const tile = t.grid[y * t.w + x];
      assert.ok(isSolidT(tile), `${b.id} is solid`);
      assert.equal(isOpaqueT(tile), y < b.y + b.h - 1, `${b.id}: only the street-level row passes light`);
    }
    assert.ok(t.decals.some((d) => d.kind === "building" && d.v === i && d.x === b.x * TS && d.y === b.y * TS), `${b.id} is painted`);
  });
  for (const e of ESTABLISHMENTS) { assert.equal(building(e).interior, interiorId(e)); assert.ok(AREAS[interiorId(e)], `${e} can be entered`); }
  // a lamp in the street lights both storeys of a front, and the roof behind stays dark
  const b = building("armory"), d = doorPx(b), area = new Area(t), tx = Math.floor(d.x / TS);
  const L = makeLight(d.x, d.y + 20, 110, [1, 1, 1], 1, 0);
  computeVis(L, area);
  const vis = (x: number, y: number) => L.vis[(y - L.oy) * L.n + (x - L.ox)];
  assert.ok(vis(tx, b.y + b.h - 1) > 0 && vis(tx, b.y + b.h - 2) > 0, "both rows of the front are lit");
  assert.equal(vis(tx, b.y + b.h - 3), 0, "the roof is not");
});

// ------------------------------------------------------------------ portals
test("portals pair up both ways and let out onto free, reachable ground", () => {
  for (const id of ["surface", ...TOWN_AREAS]) {
    const a = areaOf(id), r = reachOf(a);
    for (const p of portalsOf(a)) {
      const dest = areaOf(p.to.area), q = portalById(dest, p.to.portal);
      assert.ok(q, `${id}.${p.id} leads to a portal that exists`);
      assert.deepEqual(q!.to, { area: id, portal: p.id }, `${id}.${p.id} is paired`);
      const at = portalArrival(p);
      assert.ok(boxFree(a, at.x, at.y), `${id}.${p.id}: arrival is free`);
      assert.ok(standNear(a, r, at.x, at.y, 0), `${id}.${p.id}: arrival can be walked from`);
      assert.ok(standNear(a, r, p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h) / 2), `${id}.${p.id}: its box can be walked into`);
    }
  }
  assert.equal(portalsOf(areaOf(TOWN_ID)).length, ESTABLISHMENTS.length + 1, "six doors and the road");
});

test("walking: down the old road into Westwake, in and out of all six doors, and back to the ruins", () => {
  const w = newWorld(), pl = player(w);
  const surface = areaOf("surface"), out = portalArrival(portalById(surface, WEST_ROAD.portal)!);
  enterArea(w, pl, "surface", out.x + 40, out.y);
  events(w);
  assert.ok(push(w, -1, 0, () => pl.area === TOWN_ID), "pushing west along the road arrives in the town");
  assert.equal(pl.facing, "left");
  const ev = events(w).find((e) => e.t === "portal");
  assert.ok(ev && ev.t === "portal" && ev.fromArea === "surface" && ev.toArea === TOWN_ID && ev.actor === pl.id);
  assert.ok(w.monologue.said.includes("town.arrive"), "the golem notes that the village became a town");
  const town = areaOf(TOWN_ID);
  for (const e of ESTABLISHMENTS) {
    const door = portalArrival(portalById(town, `door.${e}`)!);
    pl.x = door.x; pl.y = door.y; pl.vx = pl.vy = 0;
    assert.ok(push(w, 0, -1, () => pl.area === interiorId(e), 240), `${e}: pushing on the door goes in`);
    assert.equal(pl.facing, "up");
    for (let i = 0; i < 40; i++) frame(w, { ix: 0, iy: -1, use: false });
    assert.equal(pl.area, interiorId(e), `${e}: still inside after walking in`);
    assert.ok(push(w, 0, 1, () => pl.area === TOWN_ID, 600), `${e}: walking back down to the sill goes out`);
    assert.equal(pl.facing, "down");
    assert.ok(Math.hypot(pl.x - door.x, pl.y - door.y) < 10, `${e}: out by its own door`);
    for (let i = 0; i < 40; i++) frame(w, { ix: 0, iy: 1, use: false });
    assert.equal(pl.area, TOWN_ID, `${e}: stepping away from the door does not go back in`);
  }
  const east = portalArrival(portalById(town, "east_road")!);
  pl.x = east.x; pl.y = east.y; pl.vx = pl.vy = 0;
  assert.ok(push(w, 1, 0, () => pl.area === "surface", 600), "east through the gate leads back to the wild");
  assert.equal(pl.facing, "right");
  assert.equal(w.monologue.said.filter((s) => s === "town.arrive").length, 1);
});

test("a save made inside a shop loads back inside it, and the door still works", () => {
  const w = newWorld(), pl = player(w), room = areaOf("town_tavern");
  enterArea(w, pl, "town_tavern", room.base.start.x, room.base.start.y);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w)))), p2 = player(w2);
  assert.equal(p2.area, "town_tavern");
  assert.ok(push(w2, 0, 1, () => p2.area === TOWN_ID, 600));
  assert.ok(debugPlaces(w2).some((d) => d.group === "WESTWAKE"), "the debug teleport lists the town");
});

// ------------------------------------------------------------------ laid out for later
test("every standing place is free and can be walked to; every sign and landmark can be read", () => {
  for (const id of TOWN_AREAS) {
    const a = areaOf(id), r = reachOf(a), spots = a.base.spots ?? [];
    assert.ok(spots.length > 0, `${id} has standing places`);
    assert.equal(new Set(spots.map((s) => s.id)).size, spots.length, `${id}: spot ids unique`);
    for (const s of spots) {
      assert.ok(boxFree(a, s.x, s.y), `${id}: spot ${s.id} is free`);
      assert.ok(standNear(a, r, s.x, s.y, 8), `${id}: spot ${s.id} can be walked to`);
    }
    for (const p of a.props) if (propDef(p.kind).examine) assert.ok(standNear(a, r, p.x, p.y + 2, propReach(p.kind) + 4), `${id}: ${p.id} can be walked up to`);
    if (id !== TOWN_ID) {
      const kinds = spots.map((s) => s.kind);
      assert.ok(kinds.includes("keeper") && kinds.includes("customer") && kinds.includes("door"), `${id}: a keeper, a customer and the door`);
    }
  }
  const t = areaOf(TOWN_ID), spots = t.base.spots!;
  for (const b of BUILDINGS) if (b.door) assert.ok(spots.some((s) => s.id === `door.${b.id}`), `${b.id} has a doorstep`);
  assert.ok(spots.filter((s) => s.kind === "stall").length >= 6, "a pitch behind every market stall");
  assert.ok(areaOf("town_tavern").base.spots!.filter((s) => s.kind === "seat").length >= 10, "the tavern seats a crowd");
});

// ------------------------------------------------------------------ light
test("light is the town's map of itself: runes for the bright side, fire for everyone else", () => {
  const RUNE = ["rune_lamp", "rune_sconce", "runestand", "winglow_rune", "marketcross"], FIRE = ["torch", "torch_post", "lantern", "candlestand", "brazier", "smithforge"];
  for (const k of RUNE) assert.equal(propDef(k).light!.flick, 0, `${k}: rune light is perfectly steady`);
  for (const k of ["lantern", "candlestand", "fireplace", "smithforge", "winglow", "torch"]) assert.ok(propDef(k).light!.flick > 0, `${k}: fire flickers`);
  for (const e of ESTABLISHMENTS) {
    const d = buildInterior(e), kinds = d.props.map((p) => p.kind);
    const runes = kinds.filter((k) => RUNE.includes(k)).length, fires = kinds.filter((k) => FIRE.includes(k)).length;
    if (HIGH_END[e]) { assert.ok(runes >= 3, `${e} is lit by runes`); assert.equal(fires, 0, `${e} burns no torches`); }
    else { assert.equal(runes, 0, `${e} has no light runes`); assert.ok(fires >= 3, `${e} is lit by fire`); }
    assert.ok(d.interior && !d.outdoor, `${e} is a room`);
  }
  const t = buildTown(), near = (kind: string, x: number, y: number) => t.props.some((p) => p.kind === kind && Math.abs(p.x - x) < 24 && Math.abs(p.y - y) < 40);
  for (const e of ESTABLISHMENTS) { const d = doorPx(building(e)); assert.ok(near(HIGH_END[e] ? "rune_sconce" : "lantern", d.x, d.y), `${e}: the right lamp by the door`); }
  for (const p of t.props) {
    if (p.kind === "rune_lamp") {
      assert.ok(p.y <= 37 * TS, `${p.id}: no light rune south of the square`);
      const tx = Math.floor(p.x / TS), ty = Math.floor((p.y - 1) / TS);
      let paved = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const s = t.style[(ty + dy) * t.w + tx + dx]; if (t.grid[(ty + dy) * t.w + tx + dx] === T.FLOOR && (s === FS.SETT || s === FS.WEAVE)) paved = true; }
      assert.ok(paved, `${p.id} stands by dressed paving`);
    }
    if (p.kind === "torch_post") assert.ok(!(p.y > 26 * TS && p.y < 34 * TS && p.x > 33 * TS), `${p.id}: no torches on the square or the High Street`);
  }
  assert.ok(t.props.filter((p) => p.kind === "rune_lamp").length >= 20 && t.props.filter((p) => p.kind === "torch_post" && p.lit).length >= 10);
});

// ------------------------------------------------------------------ scope
test("lived in, but no shops yet: the census's townsfolk are the only people, and nothing can be bought, stored, crafted, taken or cut down", () => {
  for (const id of TOWN_AREAS) {
    const d = AREAS[id]();
    assert.equal((d.npcs ?? []).length, 0, `${id}: the builder places nobody (no shopkeeper, golem or special NPC); townsfolk come from the census`);
    assert.equal(d.loose.length, 0, `${id}: nothing to pick up`);
    assert.equal(d.ritual, undefined);
    for (const p of d.props) {
      const def = propDef(p.kind);
      assert.ok(!def.station && !def.storage && !def.rune, `${id}: ${p.id} has no function`);
      assert.ok(!HARVEST[p.kind], `${id}: ${p.id} is not harvestable`);
      assert.ok(!p.item && !p.container, `${id}: ${p.id} holds nothing`);
    }
  }
  // who does live here: exactly the census's Westwake rows, all townsfolk (sim/folk.ts), none of them a golem, a
  // shopkeeper or anyone with a dialogue script or a pack (talking to one is a line in a bubble, not a shop)
  const w = createWorld(7);
  for (const id of TOWN_AREAS) getArea(w, id);
  const here = w.actors.filter((a) => TOWN_AREAS.includes(a.area));
  const rows = CENSUS.filter((r) => TOWN_AREAS.includes(r.area));
  assert.ok(rows.length >= 10, "people live in Westwake");
  assert.deepEqual(here.map((a) => a.id).sort(), rows.map((r) => r.id).sort(), "everyone in Westwake is a census row, and every row is there");
  for (const a of here) {
    assert.ok(isFolk(a), `${a.id} is a townsperson`); assert.equal(a.npc, undefined, `${a.id}: no dialogue script`);
    assert.ok(!capable(a, "worker") && !capable(a, "craft") && !actorDef(a).power, `${a.id}: not a golem, makes nothing`);
    assert.equal(actorDef(a).inventory.slots, 0, `${a.id}: carries nothing to sell or store`);
  }
});

// ------------------------------------------------------------------ text and art
test("every line of the town's text fits the bitmap font", () => {
  for (const [kind, text] of SIGNS) { lint(text, kind); assert.equal(propDef(kind).examine, text); }
  for (const id of TOWN_AREAS) {
    const d = AREAS[id]();
    lint(AREA_NAMES[id], id);
    for (const r of d.rooms) lint(r.name, `${id} room`);
    for (const p of d.portals ?? []) if (p.label) lint(p.label, `${id}.${p.id}`);
    for (const p of d.props) { const t = propDef(p.kind).examine; if (t) lint(t, p.kind); }
  }
  for (const p of buildSurface().props) { const t = propDef(p.kind).examine; if (t) lint(t, p.kind); }
  lint(THOUGHTS["town.arrive"].text, "town.arrive");
});

test("town art: every sprite draws and fits the renderer's culling margin; the town and its rooms bake", () => {
  for (const k of Object.keys(TOWN_PROP_ART)) for (let v = 0; v < 4; v++) for (const alt of [false, true]) {
    const s = propSprite(k, v, alt);
    assert.ok(s, `${k} v${v}`);
    assert.ok(s!.w <= 96 && s!.h <= 60, `${k}: ${s!.w}x${s!.h} stays inside the cull margin`);
  }
  for (const id of TOWN_AREAS) for (const p of AREAS[id]().props) assert.ok(propSprite(p.kind, p.v, false), `${id}: ${p.kind} has art`);
  for (const id of TOWN_AREAS) {
    const d = AREAS[id](), c = makeCanvas(d.w * TS, d.h * TS);
    bakeRegion(c.ctx, d, 0, 0, d.w - 1, d.h - 1);
  }
});
