// The entrance: digging the buried stair head out with a shovel head and a
// pickaxe head, the stair it opens between the surface and the halls, how both
// ends read before and after, and the v13 -> v14 save migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, hasFlag, getArea, enterArea, actorById, type World } from "../src/game/world/world";
import { DIG_SITES, DIG_MATERIALS, GROUND_COLUMN, digLayerAt, digStage, digTotal, propLook } from "../src/game/content/digging";
import { ENTRANCES, GATE_CORRIDOR, GATE_STAIR, SURFACE_GATE, SURFACE_GATE_ZONE } from "../src/game/content/geography";
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
import { serialize, deserialize, migrate, settle, saveToStorage, loadFromStorage, SAVE_VERSION } from "../src/game/world/save";
import { buildDungeon } from "../src/game/map";
import { buildSurface } from "../src/game/surface";
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
  // before: the stair below is choked solid, its fall lies on the foot steps, and no light burns in it
  const S = GATE_STAIR, stair = (fn: (x: number, y: number) => void) => { for (let y = S.y; y < S.y + S.h; y++) for (let x = S.x; x < S.x + S.w; x++) fn(x, y); };
  stair((x, y) => assert.equal(dungeon.tile(x, y), T.RUBBLE));
  assert.ok(dungeon.prop("stairfall") && dungeon.prop("stairfoot") && !dungeon.prop("stairlight")!.lit);
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
  stair((x, y) => { assert.equal(dungeon.tile(x, y), T.FLOOR); assert.equal(dungeon.style[y * dungeon.w + x], FS.STAIR); });
  assert.ok(!dungeon.prop("stairfall"), "the fall is gone");
  assert.ok(dungeon.prop("stairfoot"), "the foot steps stay");
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
test("both ends read as a stair: below, steps climbing south into a fall with no air through it; above, a square stair head, not a round dent", () => {
  const d = buildDungeon(), s = buildSurface();
  // below: the halls are the first cellar floor and this is the stair up
  assert.ok(d.exits.some((e) => e.label === "SURFACE STAIR" && e.dir === "s"));
  for (let y = GATE_STAIR.y; y < GATE_STAIR.y + GATE_STAIR.h; y++) for (let x = GATE_STAIR.x; x < GATE_STAIR.x + GATE_STAIR.w; x++) {
    assert.equal(d.style[y * d.w + x], FS.STAIR, "steps under the fall");
    assert.equal(d.plan[y * d.w + x], T.FLOOR, "as built, an open flight");
  }
  const foot = d.props.find((p) => p.id === "stairfoot")!;
  assert.ok(foot.y <= GATE_CORRIDOR.y * TS && foot.y > (GATE_CORRIDOR.y - 1) * TS, "its lowest steps stand clear in the Vestibule");
  const leak = d.lights.find((l) => l.id === "gateleak")!;
  assert.equal(leak.owner, "stairlight"); assert.ok(leak.sky, "daylight, when there is any");
  assert.equal(propDef("stairlight").light!.when, "lit");
  assert.ok(!d.props.find((p) => p.id === "stairlight")!.lit, "no night air comes through the fall: the stair is dark until it is dug out");
  assert.match(propDef("stairfall").examine!, /STAIR CLIMBS SOUTH.*SURFACE.*FROM ABOVE/);
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

// ------------------------------------------------------------------ saves
test("save v14: a v13 save loads; a body saved where the new furniture or an iron vein stands is set down beside it; nothing else moves", () => {
  assert.equal(SAVE_VERSION, 14);
  const old = (edit: (s: any) => void = () => {}) => { const s = JSON.parse(JSON.stringify(serialize(newWorld()))); s.version = 13; edit(s); return s; };
  const plain = old(), m = migrate(plain) as any;
  assert.equal(m.version, 14);
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
