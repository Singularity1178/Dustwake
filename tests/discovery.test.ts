// Discovery (v22, world/discovery.ts): what the order screens may name is where the golem has been, and nothing
// else. The surface is one area holding every town; that an area is loaded, or that a worker has walked somewhere,
// tells the player nothing. Held here: what a fresh crossing offers, what walking west adds and when, doors known
// by their signs, a worker's travels revealing nothing, the save, and what a save from before v22 counts as known.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TS } from "../src/game/content/tiles";
import { OVERWORLD_ID } from "../src/game/content/places";
import { WEST_ROAD } from "../src/game/content/geography";
import { actorById, currentArea, enterArea, getArea, player, type Actor, type World } from "../src/game/world/world";
import { areaDiscovered, discover, knownAt, zoneDiscovered } from "../src/game/world/discovery";
import { spotIn, zoneById } from "../src/game/world/zones";
import { SAVE_VERSION, deserialize, migrate, serialize } from "../src/game/world/save";
import { checkRune } from "../src/game/sim/ritual";
import { stepWorld } from "../src/game/sim/step";
import { assignJob, walkOrder } from "../src/game/sim/jobs";
import { gatherSources, knownAreas, stationOptions, storageOptions, walkOptions } from "../src/game/sim/orders";
import { debugPlaces, teleportTo } from "../src/game/sim/debug";
import { events, frame, frames, newWorld } from "./helpers";

const S = OVERWORLD_ID, WORKER = "npc.worker.artificery", DT = 0.05;
/** A world past the first crossing, played: the circle lit, the golem carried up to the surface rune. The worker is cored and can follow. */
function crossed(seed = 12345) {
  const w = newWorld(seed), pl = player(w), dg = currentArea(w), r = dg.ritual!;
  r.core = true; r.carved = true; r.sockets = r.solution.slice();
  checkRune(w, dg); r.actT = 5;
  pl.x = dg.ritualPos.x; pl.y = dg.ritualPos.y + 2;
  for (let i = 0; i < 1000 && pl.area !== S; i++) frame(w);
  frames(w, 5); events(w);
  const wk = actorById(w, WORKER)!;
  wk.powerCore = "ruby_core"; wk.gear.rune0 = "rune_swift";
  return { w, pl, wk, a: getArea(w, S) };
}
const labels = (w: World, wk: Actor) => walkOptions(w, wk).map((o) => o.label);
const sources = (w: World, wk: Actor) => gatherSources(w, wk, "wood").map((s) => s.label);
const zones = (w: World) => [...(w.discovered.get(S) ?? [])].sort();
const roadY = (WEST_ROAD.surface.y0 + 1) * TS + 12;
/** Put the golem down at a point of the surface and let the world notice (as walking there would, without the walk). */
function stand(w: World, x: number, y: number) { const pl = player(w); pl.x = x; pl.y = y; pl.vx = 0; pl.vy = 0; stepWorld(w, 1 / 60); events(w); }
const TOWNISH = /WESTWAKE|OLD ROAD|GUILD HALL|BLACK ANVIL|GILDED BUCKLER|BRIGHT FACET|SILVER NEEDLE|SUNKEN CROWN/;

test("fresh from the first crossing the golem knows the halls and the ruins: no town, no road, no shop is on offer", () => {
  const fresh = newWorld();
  assert.deepEqual([...fresh.discovered.keys()], ["dungeon"], "a new world knows where it woke");
  const { w, wk, a } = crossed();
  assert.deepEqual([...w.discovered.keys()].sort(), ["dungeon", S]);
  assert.deepEqual(zones(w), ["ruins"]);
  assert.deepEqual(knownAreas(w), ["dungeon", S], "the shops' doors are Westwake's: unread until the golem is there");
  const walk = labels(w, wk);
  assert.ok(walk.includes("SURFACE START") && walk.includes("SURFACE RUNE") && walk.includes("DUNGEON START"), walk.join());
  assert.deepEqual(walk.filter((l) => TOWNISH.test(l)), [], "nothing of Westwake, its shops or the road");
  assert.deepEqual(sources(w, wk), ["THE RUINS"], "wood is offered where the golem has been");
  // things standing in a place not yet seen are not offered either, though they are in the same area as things that are
  const town = zoneById(a, "westwake")!, road = zoneById(a, "oldroad")!;
  const far = a.addProp("storage_chest", town.anchor.x, town.anchor.y + 8), bench = a.addProp("craftbench", road.anchor.x, road.anchor.y + 8), near = a.addProp("storage_chest", a.start.x + 30, a.start.y + 40);
  assert.deepEqual(storageOptions(w, wk).map((o) => o.ref.prop), [near.id]);
  assert.ok(!stationOptions(w, wk).some((o) => o.ref.prop === bench.id));
  assert.ok(!labels(w, wk).some((l) => TOWNISH.test(l)));
  assert.ok(knownAt(w, a, near.x, near.y) && !knownAt(w, a, far.x, far.y) && !knownAt(w, a, bench.x, bench.y));
  // the debug travel menu is a tool, not the golem's knowledge: it lists everything, and going somewhere with it is arriving there
  assert.ok(debugPlaces(w).some((p) => p.label === "WESTWAKE: START"));
  assert.ok(teleportTo(w, player(w), S, town.anchor.x, town.anchor.y)); stepWorld(w, 1 / 60);
  assert.ok(zoneDiscovered(w, S, "westwake") && storageOptions(w, wk).some((o) => o.ref.prop === far.id));
  assert.ok(!zoneDiscovered(w, S, "oldroad"), "the road it skipped stays unknown");
});

test("walking west: each place is known from the moment it is announced, and what stands in it comes with it", () => {
  const { w, pl, wk, a } = crossed();
  const road = zoneById(a, "oldroad")!, town = zoneById(a, "westwake")!, edge = (road.x + road.w) * TS;
  // up to the old road's edge, and a few px over it: its border is not the place (the name is not shown yet either)
  stand(w, edge + 30, roadY);
  stand(w, edge - 6, roadY);
  assert.deepEqual(zones(w), ["ruins"]);
  assert.deepEqual(sources(w, wk), ["THE RUINS"]);
  // well inside: announced, and on record
  pl.x = edge - 40; stepWorld(w, 1 / 60);
  assert.ok(events(w).some((e) => e.t === "zoneEntered" && e.zone === "oldroad"));
  assert.deepEqual(zones(w), ["oldroad", "ruins"]);
  assert.deepEqual(sources(w, wk), ["THE OLD ROAD", "THE RUINS"]);
  assert.ok(labels(w, wk).includes("THE OLD ROAD START") && !labels(w, wk).some((l) => /WESTWAKE|GUILD/.test(l)), "the road, and still not the town at its end");
  assert.deepEqual(knownAreas(w), ["dungeon", S]);
  // in through the East Gate
  stand(w, town.anchor.x, town.anchor.y);
  assert.deepEqual(zones(w), ["oldroad", "ruins", "westwake"]);
  assert.ok(labels(w, wk).includes("WESTWAKE START"));
  // the shops are known by the signs over their doors: where one comes in is offered, nothing inside is
  assert.deepEqual(knownAreas(w), ["dungeon", S, "town_armory", "town_guild", "town_jeweler", "town_smithy", "town_tailor", "town_tavern"]);
  assert.ok(labels(w, wk).includes("GUILD HALL START"));
  assert.ok(!areaDiscovered(w, "town_guild"));
  // the record is saved, sorted, and comes back as it was
  const s = serialize(w);
  assert.deepEqual(s.discovered, { dungeon: [], [S]: ["oldroad", "ruins", "westwake"] });
  const w2 = deserialize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(serialize(w2), s);
  assert.deepEqual(labels(w2, actorById(w2, WORKER)!), labels(w, wk));
});

test("only the golem discovers: a worker's travels, and areas loaded for any other reason, put nothing on offer", () => {
  const { w, wk, a } = crossed();
  // (an order given by the world, not from a menu: the menus would not offer this)
  const door = spotIn(a, "door.guild", "westwake")!;
  enterArea(w, wk, S, a.start.x + 24, a.start.y + 30);
  assert.ok(assignJob(w, wk, walkOrder("town_guild", 0, 0)));
  for (let t = 0; t < 1500 && wk.area !== "town_guild"; t += DT) { stepWorld(w, DT); w.events.length = 0; }
  assert.equal(wk.area, "town_guild", `the worker walked the road and went in at the guild's door (${door.x},${door.y}): ${JSON.stringify(wk.job)}`);
  assert.ok(w.areas.has("town_guild"), "the room is loaded");
  assert.deepEqual(zones(w), ["ruins"]);
  assert.deepEqual(knownAreas(w), ["dungeon", S]);
  assert.ok(!labels(w, wk).some((l) => TOWNISH.test(l)));
  assert.deepEqual(sources(w, wk), ["THE RUINS"]);
  // content may tell the golem of a place (a signpost, a map): that is `discover`, and it is all it takes
  assert.ok(discover(w, S, "westwake") && !discover(w, S, "westwake"));
  assert.ok(labels(w, wk).includes("WESTWAKE START") && labels(w, wk).includes("GUILD HALL START"));
  // the guild's room is loaded and known by its door, but the golem has not been in: where one comes in, and nothing inside
  getArea(w, "town_guild").addProp("storage_chest", getArea(w, "town_guild").start.x, getArea(w, "town_guild").start.y - 20);
  assert.ok(!storageOptions(w, wk).some((o) => o.area === "town_guild"));
  enterArea(w, player(w), "town_guild", getArea(w, "town_guild").start.x, getArea(w, "town_guild").start.y);
  assert.ok(storageOptions(w, wk).some((o) => o.area === "town_guild"));
});

test("save v22: a save from before discovery knows where it shows the golem has been, and what its orders already name", () => {
  assert.equal(SAVE_VERSION, 22);
  /** A world of today as v21 saved it: no record of where the golem has been. */
  const v21 = (w: World, edit: (s: any) => void = () => {}) => { const s = JSON.parse(JSON.stringify(serialize(w))); delete s.discovered; s.version = 21; edit(s); return s; };
  const found = (s: unknown) => (migrate(s) as { version: number; discovered: Record<string, string[]> }).discovered;
  // a save that never left the halls
  assert.deepEqual(found(v21(newWorld())), { dungeon: [] });
  // at the ruins, Westwake unseen (the case that showed the fault): the ruins, and no more. What was played is what comes back.
  const base = crossed();
  assert.deepEqual(found(v21(base.w)), { dungeon: [], [S]: ["ruins"] });
  assert.deepEqual(migrate(v21(base.w)), JSON.parse(JSON.stringify(serialize(base.w))), "the migrated save is the save a v22 game would have made");
  const loaded = deserialize(v21(base.w)), lw = actorById(loaded, WORKER)!;
  assert.ok(!labels(loaded, lw).some((l) => TOWNISH.test(l)), "and Westwake is no longer on offer in it");
  assert.deepEqual(sources(loaded, lw), ["THE RUINS"]);
  // back down in the halls after a visit to the surface: the ruins are still known (the rune and the stair come up there)
  const home = crossed(); enterArea(home.w, home.pl, "dungeon", home.pl.x, home.pl.y);
  assert.deepEqual(found(v21(home.w)), { dungeon: [], [S]: ["ruins"] });
  // standing in Westwake: the town, and the road that is the only way to it
  const inTown = crossed(), town = zoneById(inTown.a, "westwake")!;
  stand(inTown.w, town.anchor.x, town.anchor.y);
  assert.deepEqual(found(v21(inTown.w)), { dungeon: [], [S]: ["oldroad", "ruins", "westwake"] });
  // been to Westwake and gone home: the thought on arriving was thought
  assert.deepEqual(found(v21(base.w, (s) => { s.monologue.said.push("town.arrive"); })), { dungeon: [], [S]: ["oldroad", "ruins", "westwake"] });
  // a shop's room in the save says nothing by itself (townsfolk load rooms going about their day); the golem standing in one does
  const room = (s: any) => { s.areas.town_tavern = { ...s.areas.dungeon, props: {}, tiles: [], ritual: null, propsAdded: [] }; };
  assert.deepEqual(found(v21(base.w, room)), { dungeon: [], [S]: ["ruins"] });
  const inside = found(v21(base.w, (s) => { room(s); s.actors.find((x: any) => x.id === s.playerId).area = "town_tavern"; }));
  assert.deepEqual(inside, { dungeon: [], [S]: ["oldroad", "ruins", "westwake"], town_tavern: [] });
  // an order already given names the old road (v21 offered it unseen): the player chose it, and can choose it again
  const road = zoneById(base.a, "oldroad")!;
  assert.deepEqual(found(v21(base.w, (s) => { s.actors.find((x: any) => x.id === WORKER).job = { kind: "gatherDeposit", args: { resource: "wood", fromArea: S, fromZone: "oldroad", storage: null, amount: 5 } }; }))[S], ["oldroad", "ruins"]);
  assert.deepEqual(found(v21(base.w, (s) => { s.actors.find((x: any) => x.id === WORKER).job = { kind: "walk", args: { area: S, x: road.anchor.x, y: road.anchor.y } }; }))[S], ["oldroad", "ruins"]);
  assert.deepEqual(found(v21(base.w, (s) => { s.actors.find((x: any) => x.id === WORKER).job = { kind: "craftAt", args: { station: { area: S, prop: "westwake/some.bench" }, recipe: "planks", amount: 1 } }; }))[S], ["oldroad", "ruins", "westwake"]);
  // something the golem built stands on the old road
  const built = crossed(); built.a.addProp("storage_chest", road.anchor.x, road.anchor.y);
  assert.deepEqual(found(v21(built.w))[S], ["oldroad", "ruins"]);
  // a zone id the land never had is not taken on trust; nor is anything that is not a save of this shape
  assert.deepEqual(found(v21(base.w, (s) => { s.actors.find((x: any) => x.id === WORKER).job = { kind: "gatherDeposit", args: { fromArea: S, fromZone: "atlantis" } }; }))[S], ["ruins"]);
  assert.deepEqual(found({ version: 21, playerId: "golem", areas: {}, actors: [] }), {});
});
