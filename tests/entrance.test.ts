// The entrance: digging the buried stair head out with a shovel head and a
// pickaxe head, the stair it opens between the surface and the halls, how both
// ends read before and after, and the save migrations (v13 -> v14, v14 -> v15
// for the stair's cheek walls, and v15 -> v16 for raising its newel posts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, hasFlag, getArea, enterArea, actorById, type World } from "../src/game/world/world";
import { DIG_SITES, DIG_MATERIALS, GROUND_COLUMN, digLayerAt, digStage, digTotal, propLook } from "../src/game/content/digging";
import { ENTRANCES, GATE_CORRIDOR, GATE_HALL, GATE_PASSAGE, GATE_STAIR, STAIR_CHEEK, STAIR_CHEEK_TOP, SURFACE_GATE, SURFACE_GATE_ZONE } from "../src/game/content/geography";
import { FS, T, TS } from "../src/game/content/tiles";
import { propDef } from "../src/game/content/props";
import { PROP_ART, propSprite } from "../src/game/art/props";
import { installFakeCanvas } from "./support/fakeCanvas";
import type { ItemId } from "../src/game/content/items";
import { addItems, countItem } from "../src/game/sim/inventory";
import { wearFromSlot } from "../src/game/sim/commands";
import { boxFree, propBlocks } from "../src/game/sim/collision";
import { entranceOpen, openEntrance, digSpot } from "../src/game/sim/digging";
import { portalById, portalOpen } from "../src/game/sim/portals";
import { interactables } from "../src/game/sim/interact";
import { visionTargets } from "../src/game/sim/analysis";
import { serialize, deserialize, migrate, settle, saveToStorage, loadFromStorage, SAVE_VERSION, MIGRATIONS } from "../src/game/world/save";
import { buildDungeon } from "../src/game/map";
import { buildSurface } from "../src/game/surface";
import { flightSteps, flightStepAt } from "../src/game/art/stairs";
import { newWorld, frame, frames, events, find, useOn } from "./helpers";

const GATE = "buriedgate@48,61", SITE = DIG_SITES.buriedgate;
const wear = (w: World, id: ItemId) => { const pl = player(w); addItems(w, pl, id, 1); return wearFromSlot(w, pl, pl.inventory.findIndex((s) => s?.item === id)); };
const digIt = (w: World) => find(w, (i) => i.kind === "dig");
/** A world with the golem standing on the surface by the buried stair head. */
function atGate() {
  const w = newWorld(), pl = player(w);
  frame(w);
  const gate = getArea(w, "surface").prop(GATE)!;
  enterArea(w, pl, "surface", gate.x, gate.y + 8);
  return { w, pl, gate, surface: getArea(w, "surface"), dungeon: getArea(w, "dungeon") };
}
/** E on the dig site `n` times, each stroke played out. */
const dig = (w: World, n: number) => { for (let i = 0; i < n; i++) useOn(w, digIt(w)); };
/** Dig the stair out with a shovel head, then a pickaxe head. */
function digOut(w: World) {
  assert.equal(wear(w, "head_shovel"), "ok"); dig(w, SITE.layers[0].work);
  assert.equal(wear(w, "head_pickaxe"), "ok"); dig(w, SITE.layers[1].work);
}

// ------------------------------------------------------------------ data
test("dig data: earth over stone, the shovel for one and the pickaxe for the other; stages run 0 to open", () => {
  assert.deepEqual(SITE.layers.map((l) => l.material), ["dirt", "stone"]);
  assert.equal(SITE.opens, "surface_stair");
  assert.deepEqual([DIG_MATERIALS.dirt.tool, DIG_MATERIALS.dirt.yields], ["shovel", "dirt"]);
  assert.deepEqual([DIG_MATERIALS.stone.tool, DIG_MATERIALS.stone.yields], ["pickaxe", "stone"]);
  assert.deepEqual(GROUND_COLUMN.map((l) => l.material), ["dirt", "stone"], "what open ground would be, for digging anywhere later");
  const total = digTotal(SITE), d = SITE.layers[0].work;
  assert.deepEqual(digLayerAt(SITE, 0), { index: 0, material: "dirt", into: 0, left: d });
  assert.equal(digLayerAt(SITE, d - 0.5)!.material, "dirt");
  assert.deepEqual(digLayerAt(SITE, d), { index: 1, material: "stone", into: 0, left: total - d });
  assert.equal(digLayerAt(SITE, total), null);
  const stages = Array.from({ length: total + 1 }, (_, i) => digStage(SITE, i, false));
  assert.equal(stages[0], 0); assert.deepEqual([...stages].sort((a, b) => a - b), stages, "never goes back");
  assert.deepEqual([...new Set(stages)], [0, 1, 2, 3, 4]);
  assert.equal(digStage(SITE, total, true), 5);
  assert.equal(propLook({ kind: "buriedgate", v: 0, dmg: d, open: false }), 3, "the stone shows once the earth is out");
  assert.equal(propLook({ kind: "tree", v: 2, dmg: 3 }), 2, "anything else keeps its authored variant");
  // every stage is drawn (and differs from the one before)
  installFakeCanvas();
  assert.ok(PROP_ART.buriedgate);
  for (let v = 0; v <= 5; v++) assert.ok(propSprite("buriedgate", v, v === 5), `stage ${v}`);
});

// ------------------------------------------------------------------ digging
test("no shovel, no digging; with a shovel head the earth comes out as dirt, a unit a stroke, and stops at the stone", () => {
  const { w, pl, gate } = atGate();
  assert.equal(digIt(w).propId, GATE);
  assert.ok(visionTargets(w, currentArea(w)).some((v) => v.id === GATE && v.category === "interactable"), "golem vision marks it");
  events(w);
  dig(w, 1);
  assert.ok(events(w).some((e) => e.t === "message" && /SHOVEL HEAD/.test(e.text)));
  assert.equal(gate.dmg, 0); assert.equal(countItem(pl, "dirt"), 0);
  // a hafted shovel in the pack is no use to the maintainer: the head has to be on the arm
  addItems(w, pl, "shovel", 1); dig(w, 1);
  assert.equal(gate.dmg, 0);
  assert.equal(wear(w, "head_shovel"), "ok");
  events(w);
  dig(w, 1);
  assert.equal(gate.dmg, 1); assert.equal(countItem(pl, "dirt"), 1);
  assert.deepEqual(events(w).filter((e) => e.t === "dug"), [{ t: "dug", actor: pl.id, prop: GATE, x: gate.x, y: gate.y + SITE.dy, material: "dirt", n: 1, next: undefined, opened: false }]);
  assert.equal(propLook(gate), 1);
  dig(w, SITE.layers[0].work - 2);
  events(w);
  dig(w, 1);
  const last = events(w).find((e) => e.t === "dug")!;
  assert.ok(last.t === "dug" && last.next === "stone" && !last.opened, "the last of the earth: stone under it");
  assert.equal(countItem(pl, "dirt"), SITE.layers[0].work); assert.equal(gate.dmg, SITE.layers[0].work);
  // the shovel does nothing to the stone
  events(w);
  dig(w, 2);
  assert.ok(events(w).some((e) => e.t === "message" && /PICKAXE HEAD/.test(e.text)));
  assert.equal(gate.dmg, SITE.layers[0].work); assert.equal(countItem(pl, "stone"), 0);
  assert.ok(!gate.open && !hasFlag(w, ENTRANCES.surface_stair.flag));
  // still flat ground: the golem can stand on it
  assert.ok(!propBlocks(gate) && boxFree(currentArea(w), gate.x, gate.y - 20));
});

test("the stone takes a pickaxe head and comes out as stone; a fine head works twice as fast; a save mid-dig carries on", () => {
  const { w, pl } = atGate();
  assert.equal(wear(w, "head_shovel_fine"), "ok");
  dig(w, SITE.layers[0].work / 2);
  assert.equal(countItem(pl, "dirt"), SITE.layers[0].work, "two units a stroke");
  assert.equal(wear(w, "head_pickaxe"), "ok");
  assert.equal(pl.gear.armR, "head_pickaxe"); assert.equal(countItem(pl, "head_shovel_fine"), 1, "one arm: the shovel head comes off for the pick");
  dig(w, 3);
  assert.equal(countItem(pl, "stone"), 3);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w)))), pl2 = player(w2), gate2 = getArea(w2, "surface").prop(GATE)!;
  assert.equal(gate2.dmg, SITE.layers[0].work + 3); assert.ok(!gate2.open);
  assert.equal(propLook(gate2), 3);
  dig(w2, SITE.layers[1].work - 3);
  assert.equal(countItem(pl2, "stone"), SITE.layers[1].work);
  assert.ok(gate2.open && entranceOpen(w2, "surface_stair"));
});

test("dug through, the stair is open: the stair head is a hole with a lip, the fall is gone from the stair below, and daylight comes down it", () => {
  const { w, pl, gate, surface, dungeon } = atGate();
  // before: the way up is choked solid, hall and flight; the toe of its fall lies in the Vestibule, and no light burns in it
  const S = GATE_PASSAGE, stair = (fn: (x: number, y: number) => void) => { for (let y = S.y; y < S.y + S.h; y++) for (let x = S.x; x < S.x + S.w; x++) fn(x, y); };
  stair((x, y) => assert.equal(dungeon.tile(x, y), T.RUBBLE));
  assert.ok(dungeon.prop("stairfall") && !dungeon.prop("stairlight")!.lit);
  const piles = dungeon.props.filter((p) => p.kind === "rockpile").length;
  events(w);
  digOut(w);
  const ev = events(w);
  assert.ok(ev.some((e) => e.t === "dug" && e.opened) && ev.some((e) => e.t === "entranceOpened" && e.entrance === "surface_stair"));
  assert.equal(countItem(pl, "dirt"), SITE.layers[0].work); assert.equal(countItem(pl, "stone"), SITE.layers[1].work);
  // the surface end
  assert.ok(gate.open && gate.lit, "open, and the ward glyph on its lintel awake");
  assert.equal(propLook(gate), 5);
  assert.ok(propBlocks(gate) && !boxFree(surface, gate.x, gate.y - 20), "a hole now: nobody walks across it");
  assert.ok(boxFree(surface, pl.x, pl.y), "the golem was set down clear of it");
  assert.ok(pl.y > gate.y && Math.abs(pl.x - gate.x) < 26, "on its south lip");
  assert.ok(!interactables(surface).some((i) => i.kind === "dig" || i.propId === GATE), "nothing left to dig");
  assert.equal(digSpot(surface, GATE), null);
  // the lower end
  assert.ok(hasFlag(w, ENTRANCES.surface_stair.flag));
  stair((x, y) => { assert.equal(dungeon.tile(x, y), T.FLOOR); assert.equal(dungeon.style[y * dungeon.w + x], y < GATE_STAIR.y ? FS.FLAG : FS.STAIR, "a flagged hall, then the steps"); });
  assert.ok(!dungeon.prop("stairfall"), "the fall is gone");
  for (const id of ["stairpost.w", "stairpost.e", "staircheek.w", "staircheek.e"]) assert.ok(dungeon.prop(id), `${id}: the stair's own stonework stays`);
  assert.ok(dungeon.prop("stairlight")!.lit, "the sky comes down the stair");
  assert.equal(dungeon.props.filter((p) => p.kind === "rockpile").length, 2, `of ${piles} rock piles only the two in the Vestibule are left`);
  // once only
  assert.equal(openEntrance(w, pl, "surface_stair"), false);
  // and it all survives a save
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w)))), d2 = getArea(w2, "dungeon"), g2 = getArea(w2, "surface").prop(GATE)!;
  assert.ok(g2.open && g2.lit && propBlocks(g2) && entranceOpen(w2, "surface_stair"));
  stair((x, y) => assert.equal(d2.tile(x, y), T.FLOOR));
  assert.ok(!d2.prop("stairfall") && d2.prop("stairlight")!.lit && d2.props.filter((p) => p.kind === "rockpile").length === 2);
  assert.deepEqual(serialize(w2), serialize(w));
});

// ------------------------------------------------------------------ walking it
test("the open stair is walked both ways: down from the stair head's south lip into the halls, and south off the top of the flight back out", () => {
  const { w, pl, gate, surface, dungeon } = atGate();
  const down = portalById(surface, "stair_down")!, up = portalById(dungeon, "stair_up")!;
  assert.deepEqual(down.to, { area: "dungeon", portal: "stair_up" }); assert.deepEqual(up.to, { area: "surface", portal: "stair_down" });
  assert.equal(down.dir, "up"); assert.equal(up.dir, "down");
  assert.equal(down.flag, ENTRANCES.surface_stair.flag); assert.equal(up.flag, down.flag);
  // shut while it is buried: pushing north over the patch is just walking
  assert.ok(!portalOpen(w, down));
  pl.x = gate.x; pl.y = gate.y + 6;
  frames(w, 60, { ix: 0, iy: -1, use: false });
  assert.equal(pl.area, "surface"); assert.ok(pl.y < gate.y, "walked on across the buried stair");
  digOut(w);
  assert.ok(portalOpen(w, down) && portalOpen(w, up));
  // down
  events(w);
  pl.x = gate.x; pl.y = gate.y + 6;
  frames(w, 4, { ix: 0, iy: -1, use: false });
  assert.equal(pl.area, "dungeon");
  assert.ok(events(w).some((e) => e.t === "portal" && e.from === "stair_down" && e.to === "stair_up"));
  assert.equal(pl.facing, "up");
  assert.ok(pl.y > (GATE_STAIR.y + GATE_STAIR.h - 1) * TS && pl.x > GATE_STAIR.x * TS && pl.x < (GATE_STAIR.x + GATE_STAIR.w) * TS, "at the top of the flight");
  assert.ok(boxFree(dungeon, pl.x, pl.y));
  // keep going: north down the steps into the Vestibule, with no trip back
  frames(w, 60 * 4, { ix: 0, iy: -1, use: false });
  assert.equal(pl.area, "dungeon"); assert.ok(pl.y < GATE_CORRIDOR.y * TS, `down the stair into the Vestibule (y ${pl.y})`);
  // and back: south up the steps, off the top
  events(w);
  frames(w, 60 * 6, { ix: 0, iy: 1, use: false });
  assert.equal(pl.area, "surface", "out on the surface again");
  assert.ok(events(w).some((e) => e.t === "portal" && e.from === "stair_up" && e.to === "stair_down"));
  assert.ok(pl.y > gate.y && Math.abs(pl.x - gate.x) < 30, "south of the stair head");
  assert.equal(pl.facing, "down");
  assert.ok(boxFree(surface, pl.x, pl.y));
  // the hole is only entered from its south lip: pushing into it from the side goes nowhere
  pl.x = gate.x - 40; pl.y = gate.y - 20;
  frames(w, 60, { ix: 1, iy: 0, use: false });
  assert.equal(pl.area, "surface"); assert.ok(pl.x < gate.x - 30, "stopped at the kerb");
  // the standing places laid out for whoever comes looking for the way in
  assert.deepEqual(buildSurface().spots!.map((s) => s.id), ["stairhead"]);
  assert.ok(buildDungeon().spots!.some((s) => s.id === "stairfoot"));
});

// ------------------------------------------------------------------ how it reads
test("both ends read as a stair: below, a hall to steps climbing south, under a fall with no air through it; above, a square stair head, not a round dent", () => {
  const d = buildDungeon(), s = buildSurface();
  // below: the halls are the first cellar floor and this is the stair up
  assert.ok(d.exits.some((e) => e.label === "SURFACE STAIR" && e.dir === "s"));
  for (let y = GATE_STAIR.y; y < GATE_STAIR.y + GATE_STAIR.h; y++) for (let x = GATE_STAIR.x; x < GATE_STAIR.x + GATE_STAIR.w; x++) {
    assert.equal(d.style[y * d.w + x], FS.STAIR, "steps under the fall");
    assert.equal(d.plan[y * d.w + x], T.FLOOR, "as built, an open flight");
  }
  // the passage is a hall, then the flight: together they are what the fall filled, and nothing else is a step
  assert.deepEqual([GATE_HALL.y, GATE_HALL.h, GATE_STAIR.y, GATE_STAIR.h], [GATE_PASSAGE.y, 2, GATE_PASSAGE.y + 2, GATE_PASSAGE.h - 2]);
  assert.equal(ENTRANCES.surface_stair.below.clear, GATE_PASSAGE);
  for (let y = GATE_HALL.y; y < GATE_HALL.y + GATE_HALL.h; y++) for (let x = GATE_HALL.x; x < GATE_HALL.x + GATE_HALL.w; x++) {
    assert.equal(d.style[y * d.w + x], FS.FLAG, "flags under the fall"); assert.equal(d.plan[y * d.w + x], T.FLOOR); assert.equal(d.grid[y * d.w + x], T.RUBBLE);
  }
  assert.equal(d.style.filter((st) => st === FS.STAIR).length, GATE_STAIR.w * GATE_STAIR.h, "no step anywhere but in the flight");
  // no steps stand out in the Vestibule any more: where the hall opens there is earth, and it runs on along the hall
  assert.ok(!d.props.some((p) => p.kind === "stairfoot") && !("stairfoot" in PROP_ART));
  const mouth = { x: (GATE_PASSAGE.x + GATE_PASSAGE.w / 2) * TS, y: GATE_PASSAGE.y * TS }, earth = d.decals.filter((dc) => dc.kind === "earthspill");
  assert.ok(earth.some((dc) => Math.abs(dc.x - mouth.x) < 8 && dc.y < mouth.y && dc.y > mouth.y - TS && dc.w! >= 36), "earth where the foot used to stand");
  assert.ok(earth.some((dc) => dc.y > mouth.y && dc.y < GATE_STAIR.y * TS), "and in the hall, between the Vestibule and the first step");
  assert.ok(!earth.some((dc) => dc.y - (dc.h! >> 1) > GATE_STAIR.y * TS), "none of it out on the flight");
  // the flight stands between two cheek walls, each ending in a newel post at its foot, against the passage's walls
  const sy = GATE_STAIR.y * TS, x0 = GATE_STAIR.x * TS, x1 = (GATE_STAIR.x + GATE_STAIR.w) * TS, at = (id: string) => { const q = d.props.find((p) => p.id === id)!; return [q.kind, q.x, q.y]; };
  assert.deepEqual(at("stairpost.w"), ["stairpost", x0 + STAIR_CHEEK.post.w / 2, sy + STAIR_CHEEK_TOP]);
  assert.deepEqual(at("stairpost.e"), ["stairpost", x1 - STAIR_CHEEK.post.w / 2, sy + STAIR_CHEEK_TOP]);
  // a post's feet stand on the flight's north edge or north of it, in the hall: its base never clips into the first step
  // (it once stood `post.d` px down, with its lowest rows drawn over the step)
  assert.equal(STAIR_CHEEK_TOP, STAIR_CHEEK.post.d - STAIR_CHEEK.post.lift);
  for (const id of ["stairpost.w", "stairpost.e"]) assert.ok(at(id)[2] as number <= sy, `${id}: feet off the first step`);
  assert.ok(STAIR_CHEEK.post.lift >= 5 && STAIR_CHEEK.post.lift <= 10, "raised by a few pixels, not moved away");
  assert.deepEqual(at("staircheek.w"), ["staircheek", x0 + STAIR_CHEEK.wall.w / 2, (GATE_STAIR.y + GATE_STAIR.h) * TS]);
  assert.deepEqual(at("staircheek.e"), ["staircheek", x1 - STAIR_CHEEK.wall.w / 2, (GATE_STAIR.y + GATE_STAIR.h) * TS]);
  assert.deepEqual(propDef("staircheek").box, [STAIR_CHEEK.wall.w, GATE_STAIR.h * TS - STAIR_CHEEK_TOP]);
  assert.ok(propDef("staircheek").flat && !propDef("staircheek").examine && !propDef("stairpost").examine, "masonry, not things to use");
  const leak = d.lights.find((l) => l.id === "gateleak")!;
  assert.equal(leak.owner, "stairlight"); assert.ok(leak.sky, "daylight, when there is any");
  assert.equal(propDef("stairlight").light!.when, "lit");
  assert.ok(!d.props.find((p) => p.id === "stairlight")!.lit, "no night air comes through the fall: the stair is dark until it is dug out");
  assert.match(propDef("stairfall").examine!, /HALL RUNS SOUTH.*SURFACE STAIR.*FROM ABOVE/);
  const w = newWorld(); frame(w); events(w);
  useOn(w, find(w, (i) => i.kind === "examine" && i.propId === "stairfall"));
  assert.ok(events(w).some((e) => e.t === "message" && /CLEARED FROM ABOVE/.test(e.text)));
  // above: no round hollow or hump is painted over it any more; the stair head is centred on the stair and lies in its zone
  const z = SURFACE_GATE_ZONE, inZone = (x: number, y: number) => x >= z.x0 * TS && x <= (z.x1 + 1) * TS && y >= z.y0 * TS && y <= (z.y1 + 1) * TS;
  assert.ok(!s.decals.some((dc) => (dc.kind === "hollow" || dc.kind === "hump") && inZone(dc.x, dc.y)));
  assert.equal(s.decals.filter((dc) => dc.kind === "ridge" && inZone(dc.x, dc.y)).length, 2, "the two straight banks over its side walls stay");
  const head = s.props.find((p) => p.kind === "buriedgate")!;
  assert.equal(head.id, GATE);
  assert.equal(head.x, (GATE_STAIR.x + GATE_STAIR.w / 2 + 12) * TS, "over the middle of the flight");
  assert.equal(Math.floor((head.y - 1) / TS), SURFACE_GATE.y);
  assert.deepEqual(propDef("buriedgate").openBox, [60, 44]);
});

test("the flight stands between its cheek walls: a body keeps off the wall faces and the newel posts, the hall is its full width, and the way through is open", () => {
  const { w, pl, dungeon } = atGate();
  digOut(w);
  const S = GATE_STAIR, K = STAIR_CHEEK, x0 = S.x * TS, x1 = (S.x + S.w) * TS, sy = S.y * TS, mid = sy + (S.h * TS) / 2;
  // the hall: wall to wall
  for (const x of [x0 + 5, x1 - 5]) assert.ok(boxFree(dungeon, x, GATE_HALL.y * TS + 12), `hall at ${x}`);
  // the posts stand in the corners at the foot of the flight (their feet on its north edge), and between them the way is open
  const py = sy + STAIR_CHEEK_TOP;
  for (const x of [x0 + 5, x1 - 5]) assert.ok(!boxFree(dungeon, x, py - 1), `post at ${x}`);
  for (let x = x0 + K.post.w + 5; x <= x1 - K.post.w - 5; x++) assert.ok(boxFree(dungeon, x, py - 1), `between the posts at ${x}`);
  // each cheek wall's footprint begins exactly where its post's ends: no gap to stand in between them, nothing overlapping
  for (const side of ["w", "e"]) {
    const post = dungeon.prop("stairpost." + side)!.box!, cheek = dungeon.prop("staircheek." + side)!.box!;
    assert.equal(post[3], cheek[1], `${side}: the wall starts where the post ends`);
    assert.ok(post[3] <= sy, `${side}: the post's footprint is in the hall`);
    assert.equal(cheek[3], (S.y + S.h) * TS, `${side}: the wall runs to the top of the flight`);
  }
  assert.ok(x1 - x0 - 2 * K.post.w >= 30, "room for three golems abreast");
  // up the flight: the wall's footprint down each side, the treads between
  for (let y = py + 5; y <= (S.y + S.h) * TS; y += 4) {
    for (const x of [x0 + 5, x0 + K.wall.w + 4, x1 - 5, x1 - K.wall.w - 4]) assert.ok(!boxFree(dungeon, x, y), `in the wall at ${x},${y}`);
    for (const x of [x0 + K.wall.w + 5, x1 - K.wall.w - 5]) assert.ok(boxFree(dungeon, x, y), `on the tread at ${x},${y}`);
  }
  // the footprint never reaches past the face that is drawn beside the lowest step it runs along (art/stairs.ts)
  assert.ok(K.wall.w <= flightStepAt(STAIR_CHEEK_TOP, S.h * TS).inset && K.post.w >= flightSteps(S.h * TS)[0].inset);
  // walked: pushing west half-way up stops at the cheek; the portal's arrival and the whole middle are clear
  enterArea(w, pl, "dungeon", x0 + 30, mid);
  frames(w, 90, { ix: -1, iy: 0, use: false });
  assert.ok(Math.abs(pl.x - (x0 + K.wall.w + 5)) < 0.05, `against the west cheek (${pl.x})`);
  frames(w, 120, { ix: 1, iy: 0, use: false });
  assert.ok(Math.abs(pl.x - (x1 - K.wall.w - 5)) < 0.05, `against the east cheek (${pl.x})`);
  const up = portalById(dungeon, "stair_up")!;
  assert.ok(boxFree(dungeon, up.arrive!.x, up.arrive!.y));
  // from the Vestibule straight up the hall's west side: the post turns nobody back for good, the flight is reached round it
  enterArea(w, pl, "dungeon", x0 + 20, GATE_PASSAGE.y * TS - 6);
  frames(w, 60 * 8, { ix: 0, iy: 1, use: false });
  assert.equal(pl.area, "surface", "south from the Vestibule, along the hall, up the flight and out");
});

// ------------------------------------------------------------------ saves
test("save v15: a v14 save loads with the stair as it is now laid; a body saved in a cheek wall or a newel post is set down beside it, in the passage", () => {
  assert.equal(SAVE_VERSION, 18);
  const base = () => { const { w } = atGate(); digOut(w); return w; };
  const old = (edit: (s: any, pl: any) => void = () => {}) => { const s = JSON.parse(JSON.stringify(serialize(base()))); s.version = 14; edit(s, s.actors.find((a: any) => a.id === s.playerId)); return s; };
  // v15 only: a body standing clear is not touched, nor is anything else in the save
  const to15 = (raw: unknown) => migrate(raw, MIGRATIONS, 15) as any;
  const plain = old(), m = to15(plain);
  assert.equal(m.version, 15);
  assert.deepEqual(m.actors, plain.actors); assert.deepEqual(m.areas, plain.areas); assert.deepEqual(m.flags, plain.flags);
  // the stair dug out before v15: hall and flight open, the fall gone, the new stonework standing
  const w0 = deserialize(plain), d0 = getArea(w0, "dungeon");
  for (let y = GATE_PASSAGE.y; y < GATE_PASSAGE.y + GATE_PASSAGE.h; y++) for (let x = GATE_PASSAGE.x; x < GATE_PASSAGE.x + GATE_PASSAGE.w; x++) {
    assert.equal(d0.tile(x, y), T.FLOOR); assert.equal(d0.style[y * d0.w + x], y < GATE_STAIR.y ? FS.FLAG : FS.STAIR);
  }
  assert.ok(!d0.prop("stairfall") && !d0.prop("stairfoot") && d0.prop("stairlight")!.lit && entranceOpen(w0, "surface_stair"));
  assert.equal(d0.props.filter((p) => p.kind === "rockpile").length, 2, "no rock pile came back onto the stair");
  // a save that still names the old foot (nothing ever did, but a hand-edited one might) loads all the same
  assert.doesNotThrow(() => deserialize(old((s) => { s.areas.dungeon.props.stairfoot = { open: true }; s.areas.dungeon.propsRemoved.push("stairfoot"); })));
  // every footprint v15 added, as v15 placed them (frozen here: the posts have moved since, in v16): a golem saved on the
  // old stair's edge, inside one, ends beside it
  const S = GATE_STAIR, passage = [GATE_PASSAGE.x * TS, GATE_PASSAGE.y * TS, (GATE_PASSAGE.x + GATE_PASSAGE.w) * TS, (GATE_PASSAGE.y + GATE_PASSAGE.h) * TS];
  const V15 = [[544, 833, 556, 839], [596, 833, 608, 839], [544, 839, 552, 896], [600, 839, 608, 896]];
  const inV15 = (x: number, y: number) => V15.some((b) => x + 5 > b[0] && x - 5 < b[2] && y > b[1] && y - 5 < b[3]);
  for (const [n, b] of V15.entries()) for (const fy of [0.1, 0.5, 1]) {
    const x = b[0] < S.x * TS + 20 ? b[0] + 5 : b[2] - 5, y = b[1] + (b[3] - b[1]) * fy;
    const s = old((_s, pl) => { pl.area = "dungeon"; pl.x = x; pl.y = y; });
    const g = to15(s).actors.find((a: any) => a.id === s.playerId);
    assert.ok(inV15(x, y), `footprint ${n}: the old spot is inside it`);
    assert.ok(!inV15(g.x, g.y), `footprint ${n} ${fy}: set down clear of all four (${g.x},${g.y})`);
    assert.ok(g.x - 5 >= passage[0] && g.x + 5 <= passage[2] && g.y - 5 >= passage[1] && g.y <= passage[3], `footprint ${n}: still in the passage`);
    assert.ok(Math.hypot(g.x - x, g.y - y) <= 17, `footprint ${n}: a step aside, no further`);
    assert.equal(g.area, "dungeon");
  }
  // a body in another area at the same coordinates is left alone
  const far = old((_s, pl) => { pl.area = "surface"; pl.x = S.x * TS + 4; pl.y = S.y * TS + 40; });
  assert.deepEqual((migrate(far) as any).actors, far.actors);
  // v13 saves run every step
  const v13 = old((s) => { s.version = 13; });
  assert.equal((migrate(v13) as any).version, SAVE_VERSION);
});

test("save v16: a v15 save loads with the newel posts raised off the first step; a body saved where a post now stands is set down beside it, in the passage; nobody else moves", () => {
  assert.equal(SAVE_VERSION, 18);
  const base = () => { const { w } = atGate(); digOut(w); return w; };
  const old = (edit: (s: any, pl: any) => void = () => {}) => { const s = JSON.parse(JSON.stringify(serialize(base()))); s.version = 15; edit(s, s.actors.find((a: any) => a.id === s.playerId)); return s; };
  // a body standing clear is not touched, nor is anything else in the save
  const plain = old(), m = migrate(plain) as any;
  assert.equal(m.version, 18);
  assert.deepEqual(m.actors, plain.actors); assert.deepEqual(m.areas, plain.areas); assert.deepEqual(m.flags, plain.flags);
  // the dug-out stair loads as it is laid now: the posts' feet on the flight's north edge, the cheek walls running on from them
  const S = GATE_STAIR, sy = S.y * TS, w0 = deserialize(plain), d0 = getArea(w0, "dungeon");
  for (const side of ["w", "e"]) {
    const post = d0.prop("stairpost." + side)!, cheek = d0.prop("staircheek." + side)!;
    assert.equal(post.y, sy + STAIR_CHEEK_TOP, `${side}: post's feet`);
    assert.ok(post.y <= sy, `${side}: off the first step`);
    assert.equal(post.box![3], cheek.box![1], `${side}: the wall begins where the post ends`);
  }
  assert.ok(entranceOpen(w0, "surface_stair") && !d0.prop("stairfall"), "the stair is still dug out");
  // every footprint, live: a golem saved inside one ends beside it, clear of all four, still in the passage
  const passage = [GATE_PASSAGE.x * TS, GATE_PASSAGE.y * TS, (GATE_PASSAGE.x + GATE_PASSAGE.w) * TS, (GATE_PASSAGE.y + GATE_PASSAGE.h) * TS];
  const fresh = getArea(newWorld(), "dungeon"), solid = ["stairpost.w", "stairpost.e", "staircheek.w", "staircheek.e"].map((id) => fresh.prop(id)!);
  assert.deepEqual(fresh.props.filter((p) => p.kind === "stairpost" || p.kind === "staircheek").map((p) => p.id).sort(), solid.map((p) => p.id).sort(), "the frozen list is all of them");
  for (const p of solid) for (const fy of [0.1, 0.5, 1]) {
    const b = p.box!, x = b[0] < S.x * TS + 20 ? b[0] + 5 : b[2] - 5, y = b[1] + (b[3] - b[1]) * fy;
    const s = old((_s, pl) => { pl.area = "dungeon"; pl.x = x; pl.y = y; });
    const v = deserialize(s), g = player(v), a = getArea(v, "dungeon");
    assert.ok(!boxFree(a, x, y), `${p.id}: the old spot is inside it`);
    assert.ok(boxFree(a, g.x, g.y), `${p.id} ${fy}: set down on open floor (${g.x},${g.y})`);
    assert.ok(g.x - 5 >= passage[0] && g.x + 5 <= passage[2] && g.y - 5 >= passage[1] && g.y <= passage[3], `${p.id}: still in the passage`);
    assert.ok(Math.hypot(g.x - x, g.y - y) <= 17, `${p.id}: a step aside, no further`);
    assert.equal(g.area, "dungeon");
  }
  // the case the move is for: standing in the hall's last rows against the passage wall, where a post now is, a body
  // steps back up the hall
  const inHall = old((_s, pl) => { pl.area = "dungeon"; pl.x = S.x * TS + 6; pl.y = sy - 3; });
  const hall = (migrate(inHall) as any).actors.find((a: any) => a.id === inHall.playerId);
  assert.ok(hall.y < sy - 3 && hall.y - 5 >= GATE_HALL.y * TS, `stepped up the hall (${hall.y})`);
  // and nobody is moved who need not be: the east half of a v15 post's base is open floor now (the post stands in the hall
  // and the wall is narrower than it was), as is the whole of the hall's middle and every tread
  for (const [x, y] of [[558, 838], [578, sy - 3], [578, sy + 30], [S.x * TS + 20, sy + 4]]) {
    const s = old((_s, pl) => { pl.area = "dungeon"; pl.x = x; pl.y = y; });
    const a = getArea(deserialize(s), "dungeon");
    assert.ok(boxFree(a, x, y), `${x},${y} is open floor in v16`);
    assert.deepEqual((migrate(s) as any).actors, s.actors, `${x},${y}: left where it stood`);
  }
  // a body in another area at the same coordinates is left alone
  const far = old((_s, pl) => { pl.area = "surface"; pl.x = S.x * TS + 6; pl.y = sy - 3; });
  assert.deepEqual((migrate(far) as any).actors, far.actors);
  // older saves run every step
  const v14 = old((s) => { s.version = 14; });
  assert.equal((migrate(v14) as any).version, 18);
});

test("save v14: a v13 save loads; a body saved where the new furniture or an iron vein stands is set down beside it; nothing else moves", () => {
  assert.equal(SAVE_VERSION, 18);
  const old = (edit: (s: any) => void = () => {}) => { const s = JSON.parse(JSON.stringify(serialize(newWorld()))); s.version = 13; edit(s); return s; };
  const plain = old(), m = migrate(plain) as any;
  assert.equal(m.version, 18);
  assert.deepEqual(m.actors, plain.actors, "a body standing clear is not touched");
  assert.deepEqual(m.areas, plain.areas); assert.deepEqual(m.flags, plain.flags);
  // the player on the spot the rune-cutter's table now takes, the worker where the slip vat stands
  const stuck = old((s) => {
    const pl = s.actors.find((a: any) => a.id === s.playerId), worker = s.actors.find((a: any) => a.id === "npc.worker.artificery");
    pl.x = 128; pl.y = 733; worker.x = 76; worker.y = 734;
  });
  const w = deserialize(stuck), a = getArea(w, "dungeon"), pl = player(w), worker = actorById(w, "npc.worker.artificery")!;
  assert.ok(a.prop("runetable@7.5,45") && a.prop("clayvat@4.25,45"), "the new furniture is there in an old save");
  assert.ok(pl.x !== 128 || pl.y !== 733);
  for (const body of [pl, worker]) for (const p of a.props) if (propBlocks(p)) { const b = p.box!; assert.ok(!(body.x + 5 > b[0] && body.x - 5 < b[2] && body.y > b[1] && body.y - 5 < b[3]), `${body.id} is clear of ${p.id}`); }
  assert.ok(boxFree(a, pl.x, pl.y), "and on open floor");
  // the frozen list is every solid prop v14 added to the two rooms, and every vein
  const added = ["coalbin@4,37", "quench@4.5,40", "runetable@7.5,45", "clayvat@4.25,45", "husk@4.5,42", "weaponrack@67.25,4.25", "staffrack@62.75,5.5", "armorstand@62.5,9.5", "armorpile@66.75,8"];
  for (const id of added) {
    const p = getArea(newWorld(), "dungeon").prop(id)!, b = p.box!;
    const s = old((x) => { const g = x.actors.find((q: any) => q.id === x.playerId); g.x = (b[0] + b[2]) / 2; g.y = b[3]; });
    const g = (migrate(s) as any).actors.find((q: any) => q.id === s.playerId);
    assert.ok(g.x !== (b[0] + b[2]) / 2 || g.y !== b[3], `${id}: moved off it`);
  }
  const veins = buildSurface().props.filter((p) => p.kind === "ironore");
  for (const p of veins) {
    const s = old((x) => { const g = x.actors.find((q: any) => q.id === x.playerId); g.area = "surface"; g.x = p.x; g.y = p.y; x.areas.surface = serialize((() => { const v = newWorld(); getArea(v, "surface"); return v; })()).areas.surface; });
    const v = deserialize(s), g = player(v);
    assert.ok(boxFree(getArea(v, "surface"), g.x, g.y), `${p.id}: the golem is beside it, not in it`);
  }
  // the dig, the stair and the tools all work in a migrated world
  const world = deserialize(old()), golem = player(world);
  frame(world);
  const gate = getArea(world, "surface").prop(GATE)!;
  enterArea(world, golem, "surface", gate.x, gate.y + 8);
  digOut(world);
  assert.ok(gate.open && entranceOpen(world, "surface_stair"));
  // loading from storage also never leaves the player inside a solid prop (settle), and leaves a sound save alone
  const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const fresh = newWorld(); frame(fresh);
  const at = { x: player(fresh).x, y: player(fresh).y };
  saveToStorage(fresh, storage);
  const same = loadFromStorage(storage)!;
  assert.deepEqual({ x: player(same).x, y: player(same).y }, at);
  const bin = getArea(fresh, "dungeon").prop("coalbin@4,37")!;
  player(fresh).x = bin.x; player(fresh).y = bin.y - 1;
  saveToStorage(fresh, storage);
  const moved = loadFromStorage(storage)!;
  assert.ok(boxFree(getArea(moved, "dungeon"), player(moved).x, player(moved).y));
  // the open stair head counts as solid for it, the buried one does not
  const on = newWorld(); frame(on);
  const head = getArea(on, "surface").prop(GATE)!;
  enterArea(on, player(on), "surface", head.x, head.y - 20);
  assert.deepEqual({ x: player(settle(on)).x, y: player(on).y }, { x: head.x, y: head.y - 20 }, "standing on the buried stair is standing on ground");
});
