// Townsfolk (content/folk.ts, sim/folk.ts, folkArt.ts): the data (routines tile the day; census rows, routes and
// place queries resolve), people made from the seed, the plan by the hour, settling, duties, chat among themselves,
// talk with the golem, pathing and soft bodies, v17 -> v18 and save / load. Then the two bugs found in play: heads
// that turned round to the back of the body, and two people at one anvil (an exclusive place, held by two).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { createWorld, getArea, player, actorById, type Actor, type World } from "../src/game/world/world";
import { stepWorld } from "../src/game/sim/step";
import { teleportTo } from "../src/game/sim/debug";
import { advanceDayTo } from "../src/game/sim/daytime";
import { serialize, deserialize, migrate, MIGRATIONS } from "../src/game/world/save";
import { AREAS } from "../src/game/world/areas";
import type { AreaData } from "../src/game/map";
import { ACTIVITY_LINES, ARCHETYPES, CENSUS, EXCLUSIVE_KINDS, FOLK_INTERIORS, HABITAT_AREAS, INTERIOR_OF, ROUTES, ROUTINES, TRAITS, type RoutineBlock } from "../src/game/content/folk";
import {
  assignDuty, blocksOf, censusFlag, desiredArea, faceTo, folkPresent, folkTalk, gazeAt, isExclusive, isFolk, makePerson, naturalHead,
  planAt, populateFolk, shiftOf, spotById, type FolkPose,
} from "../src/game/sim/folk";
import { RULES } from "../src/game/content/interactions";
import { actorBox } from "../src/game/sim/collision";
import { npcInteractables } from "../src/game/sim/interact";
import { visionTargets } from "../src/game/sim/analysis";
import { folkArtPose } from "../src/game/view/actors";
import { FolkGrid, paintFolk } from "../src/game/folkArt";
import { TS, isSolidT } from "../src/game/content/tiles";
import type { Facing } from "../src/game/golem";
import { frame } from "./helpers";

const DT = 0.05;
const ROT: Facing[] = ["up", "right", "down", "left"];
const turn = (f: Facing, k: number): Facing => ROT[(ROT.indexOf(f) + k + 4) % 4];
const STEPV: Record<Facing, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const folkOf = (w: World) => w.actors.filter(isFolk);
/** A head as a neck allows: straight ahead or a quarter turn to a side, never the other way from the body. */
const natural = (facing: Facing, head: Facing | null | undefined) => !head || (head !== facing && head !== turn(facing, 2));

/** The golem standing at an area's start (that area's people are lived step by step), at an hour of the day. */
function at(hour: number, area = "town", seed = 7): World {
  const w = createWorld(seed), A = getArea(w, area);
  assert.ok(teleportTo(w, player(w), area, A.start.x, A.start.y), `room for the golem in ${area}`);
  advanceDayTo(w, hour);
  return w;
}
function run(w: World, seconds: number, each?: (w: World) => void) {
  for (let t = 0; t < seconds - 1e-9; t += DT) { stepWorld(w, DT); each?.(w); w.events = []; }
}
/** Hold someone at a place in a pose, as at a stop that never ends (a duty keeps the routine off), nothing else on their mind. */
function pin(w: World, a: Actor, x: number, y: number, facing: Facing, pose: FolkPose) {
  a.area = player(w).area; // (v19) they may have been inside a shop: the test wants them here, with the golem
  assignDuty(a, { act: "post", area: a.area, x, y, facing, until: w.day + 1 });
  a.x = x; a.y = y; a.facing = facing;
  Object.assign(a.life!, { plan: "duty", act: "post", state: "do", goal: { x, y, facing }, spot: null, path: [], wait: 1e9, pose, head: null, glance: 0, cool: 0, chat: null, attend: 0, chatCool: 1e9, seen: w.time });
}
/** Every exclusive place held right now (`area|spot` -> who holds it), the lamplighter's lamps included. */
function exclusiveHeld(w: World): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of folkOf(w)) {
    const id = a.life!.spot;
    if (!id) continue;
    if (!id.startsWith("lamp:")) { const s = spotById(getArea(w, a.area), id); if (!s || !isExclusive(s)) continue; }
    const k = `${a.area}|${id}`;
    out.set(k, [...(out.get(k) ?? []), a.id]);
  }
  return out;
}
const noneShared = (w: World, label: string) => { for (const [k, ids] of exclusiveHeld(w)) assert.equal(ids.length, 1, `${label}: ${k} held by ${ids.join(" and ")}`); };
const atGoal = (a: Actor) => !!a.life!.goal && Math.hypot(a.x - a.life!.goal.x, a.y - a.life!.goal.y) < 2;

// ------------------------------------------------------------------ data
test("every routine tiles the day, and so does every person's own day (traits stretch a block, never open a gap)", () => {
  for (const r of Object.values(ROUTINES)) {
    assert.equal(r.blocks[0].from, 0, r.id); assert.equal(r.blocks[r.blocks.length - 1].to, 24, r.id);
    r.blocks.forEach((b, i) => { assert.ok(b.to > b.from, `${r.id} ${i}`); if (i) assert.equal(b.from, r.blocks[i - 1].to, `${r.id}: block ${i} starts where ${i - 1} ends`); });
  }
  for (const arch of Object.values(ARCHETYPES)) for (const r of arch.routines) assert.ok(ROUTINES[r], `${arch.id}: ${r}`);
  const w = createWorld(7); getArea(w, "town"); getArea(w, "surface");
  for (const a of folkOf(w)) {
    const b = blocksOf(a);
    assert.equal(b[0].from, 0, a.id); assert.equal(b[b.length - 1].to, 24, a.id);
    b.forEach((x, i) => { if (i) assert.equal(x.from, b[i - 1].to, a.id); });
  }
  // a thirsty labourer's evening at the tavern runs long; the night after it is shorter, not missing
  const lab = folkOf(w).find((a) => a.person!.routine === "labourer")!;
  const as = (traits: string[]) => blocksOf({ ...lab, person: { ...lab.person!, traits } } as Actor);
  const tavern = (b: RoutineBlock[]) => b.find((x) => x.act === "tavern")!;
  assert.ok(tavern(as(["thirsty"])).to - tavern(as(["thirsty"])).from > tavern(as([])).to - tavern(as([])).from);
});

test("every census row, watch route and place query resolves in the areas its people live in", () => {
  const built: Record<string, AreaData> = {};
  const spotsOf = (id: string) => (built[id] ??= AREAS[id]()).spots ?? [];
  const ids = new Set<string>();
  for (const r of CENSUS) {
    assert.ok(!ids.has(r.id), `${r.id} is unique`); ids.add(r.id);
    const arch = ARCHETYPES[r.archetype];
    assert.ok(arch, r.id); assert.ok(HABITAT_AREAS[arch.habitat].includes(r.area), `${r.id} lives in its habitat`);
    const home = spotsOf(r.area).find((s) => s.id === r.home);
    assert.ok(home && (home.kind === "door" || home.kind === "bed"), `${r.id}: home ${r.home}`);
    if (r.routine) assert.ok(arch.routines.includes(r.routine), r.id);
    if (r.route) for (const s of ROUTES[r.area][r.route]) assert.ok(spotsOf(r.area).some((x) => x.id === s), `${r.route}: ${s}`);
  }
  for (const arch of Object.values(ARCHETYPES)) for (const rid of arch.routines) for (const b of ROUTINES[rid].blocks) {
    if (!b.at) continue;
    const inside = INTERIOR_OF[b.act], area = inside ? FOLK_INTERIORS[inside].area : HABITAT_AREAS[arch.habitat][0];
    const n = spotsOf(area).filter((s) => b.at!.kinds.includes(s.kind) && (!b.at!.prefix || b.at!.prefix.some((p) => s.id.startsWith(p)))).length;
    assert.ok(n > 0, `${rid}: ${b.act} at ${b.at.kinds} finds somewhere in ${area}`);
  }
  // the camp, by fixed positions: a bedroll each, places round the fire, blinds and patches; and the exclusive kinds are real kinds
  const camp = spotsOf("surface");
  for (const k of ["bed", "camp", "hunt", "forage"]) assert.ok(camp.some((s) => s.kind === k), k);
  assert.equal(camp.filter((s) => s.kind === "bed").length, CENSUS.filter((r) => r.area === "surface").length);
  assert.ok(EXCLUSIVE_KINDS.every((k) => Object.keys(AREAS).some((id) => spotsOf(id).some((s) => s.kind === k)) || k === "keeper"));
});

// ------------------------------------------------------------------ people and the census
test("people are made from the world seed by hash: one seed, one town; another seed, another; the story's rng untouched", () => {
  const people = (seed: number) => { const w = createWorld(seed); getArea(w, "town"); getArea(w, "surface"); return folkOf(w).map((a) => JSON.stringify(a.person)); };
  assert.deepEqual(people(7), people(7));
  const a = people(7), b = people(8);
  assert.ok(a.filter((p, i) => p !== b[i]).length >= a.length / 2, "another world, another town");
  const w = createWorld(7); getArea(w, "town");
  const given = folkOf(w).map((x) => x.person!.name.split(" ")[0]);
  assert.equal(new Set(given).size, given.length, "nobody shares a given name");
  for (const x of folkOf(w)) {
    const [t1, t2] = x.person!.traits;
    assert.ok(TRAITS[t1] && TRAITS[t2] && TRAITS[t1].group !== TRAITS[t2].group, `${x.id}: two traits of different groups`);
  }
  // making them again changes nothing the story draws on
  const s0 = w.rng.state;
  w.flags.delete(censusFlag("town")); w.actors = w.actors.filter((x) => !isFolk(x));
  populateFolk(w, "town");
  assert.equal(w.rng.state, s0);
});

test("the census makes an area's people once, keyed by its saved flag; townsfolk are soft", () => {
  const w = createWorld(7); getArea(w, "town");
  assert.ok(w.flags.has(censusFlag("town")));
  assert.equal(folkOf(w).length, CENSUS.filter((r) => r.area === "town").length);
  populateFolk(w, "town"); getArea(w, "town");
  assert.equal(folkOf(w).length, CENSUS.filter((r) => r.area === "town").length, "no second census");
  w.actors = w.actors.filter((a) => a.id !== "folk.res.1"); populateFolk(w, "town");
  assert.ok(!actorById(w, "folk.res.1"), "whatever becomes of someone is theirs: nobody is made again");
  getArea(w, "town_tavern");
  assert.ok(!w.flags.has(censusFlag("town_tavern")), "an area nobody is listed in gets no flag");
  assert.ok(serialize(w).flags.includes(censusFlag("town")));
  for (const a of folkOf(w)) assert.equal(actorBox(a), null, `${a.id} blocks nobody`);
  assert.ok(JSON.stringify(RULES.folk).includes('"op":"folkTalk"'), "E on someone is the folkTalk effect");
});

// ------------------------------------------------------------------ the day
test("the plan is the routine at the person's own hour (traits and a daily jitter shift it); drinking takes them into the tavern", () => {
  const w = createWorld(7); getArea(w, "town"); getArea(w, "surface");
  for (const a of folkOf(w)) {
    const day = Math.floor(w.day) + 1, shift = shiftOf(w, a, day);
    blocksOf(a).forEach((b, i) => {
      const mid = day + ((b.from + b.to) / 2 + shift) / 24;
      if (Math.floor(mid) !== day) return; // the shift is the day's the moment falls in: keep clear of midnight
      const p = planAt(w, a, mid);
      // (v19) the block itself, or a shop trip inside it, or the rest of the block after one (tests/shops.test.ts)
      assert.ok(p.key === `${day}:${i}` || p.key.startsWith(`${day}:${i}:s`) || p.key.startsWith(`${day}:${i}+`), `${a.id}: ${p.key}`);
      assert.equal(p.act, p.trip ? "shop" : b.act, a.id);
      assert.equal(desiredArea(w, a, p), p.trip ? FOLK_INTERIORS[p.trip.shop].area : b.act === "tavern" ? "town_tavern" : a.person!.origin, `${a.id} ${b.act}`);
    });
  }
});

test("arriving at an hour finds people where it says: at 02:00 the town is abed indoors, the night watch out, the camp asleep on its bedrolls", () => {
  const w = at(2); run(w, DT);
  let abed = 0;
  for (const a of folkOf(w).filter((x) => x.area === "town")) {
    const act = planAt(w, a).act;
    if (act !== "sleep" && act !== "indoors") continue;
    abed++;
    assert.equal(a.life!.state, "indoors", a.id); assert.ok(!folkPresent(a), a.id);
    assert.ok(!npcInteractables(w, getArea(w, "town")).some((i) => i.actorId === a.id), `${a.id}: nobody to talk to`);
    assert.ok(!visionTargets(w, getArea(w, "town")).some((t) => t.id === a.id), `${a.id}: nothing to scan`);
    assert.equal(folkTalk(w, player(w), a.id), undefined); assert.equal(w.events.length, 0, `${a.id} does not answer from indoors`);
  }
  assert.ok(abed >= 12, `the town is abed (${abed})`);
  const night = actorById(w, "folk.watch.2")!;
  assert.deepEqual([planAt(w, night).act, night.area, folkPresent(night)], ["patrol", "town", true]);
  const c = at(2, "surface"); run(c, DT);
  const campers = folkOf(c).filter((a) => a.person!.origin === "surface");
  assert.equal(campers.length, 3);
  for (const a of campers) {
    const bed = spotById(getArea(c, "surface"), a.person!.home)!;
    assert.deepEqual([planAt(c, a).act, a.life!.state, a.life!.pose, a.x, a.y], ["sleep", "do", "lie", bed.x, bed.y], `${a.id} asleep on its bedroll, in sight`);
    assert.ok(folkPresent(a));
  }
});

test("a duty outranks the routine until it lapses: they walk there over open ground, do it, then live by the hour again", () => {
  const w = at(10); run(w, DT);
  const town = getArea(w, "town"), a = actorById(w, "folk.res.2")!, s = spotById(town, "wander.sq.1")!;
  assignDuty(a, { act: "post", area: "town", x: s.x, y: s.y, facing: "left", until: w.day + 2 / 24 });
  assert.equal(planAt(w, a).key, "duty"); assert.equal(desiredArea(w, a), "town");
  let t = 0;
  while (t < 240 && !(a.life!.state === "do" && a.x === s.x && a.y === s.y)) {
    run(w, DT); t += DT;
    if (folkPresent(a)) assert.ok(!isSolidT(town.tile(Math.floor(a.x / TS), Math.floor((a.y - 1) / TS))), `${a.id} on open ground (${a.x}, ${a.y})`);
  }
  assert.deepEqual([a.x, a.y, a.facing, a.life!.state], [s.x, s.y, "left", "do"], `there in ${t.toFixed(1)} s`);
  advanceDayTo(w, 12.4); run(w, DT);
  assert.equal(a.life!.duty, null); assert.notEqual(planAt(w, a).key, "duty");
});

test("two people who meet strike up a chat: they turn to each other, talk in pictograms of their own topics, and part", () => {
  const w = at(10); run(w, DT);
  const s = spotById(getArea(w, "town"), "wander.sq.2")!, chatty = (a: Actor) => a.person!.traits.reduce((m, t) => m * (TRAITS[t].chatty ?? 1), 1);
  const [a, b] = folkOf(w).filter((x) => x.person!.origin === "town").sort((x, y) => chatty(y) - chatty(x) || (x.id < y.id ? -1 : 1));
  assignDuty(a, { act: "socialize", area: "town", x: s.x - 6, y: s.y, facing: "right", until: w.day + 0.2 });
  assignDuty(b, { act: "socialize", area: "town", x: s.x + 6, y: s.y, facing: "left", until: w.day + 0.2 });
  const icons: string[] = [];
  const listen = (x: World) => { for (const e of x.events) if (e.t === "folkChat" && (e.folk === a.id || e.folk === b.id)) icons.push(e.icon); };
  let t = 0;
  while (t < 300 && a.life!.chat?.with !== b.id) { run(w, DT, listen); t += DT; }
  assert.equal(a.life!.chat?.with, b.id, `a chat in ${t.toFixed(1)} s`); assert.equal(b.life!.chat?.with, a.id, "both sides of one talk");
  assert.equal(a.facing, faceTo(b.x - a.x, b.y - a.y)); assert.equal(b.facing, faceTo(a.x - b.x, a.y - b.y));
  while (t < 400 && (a.life!.chat || b.life!.chat)) { run(w, DT, listen); t += DT; }
  assert.ok(!a.life!.chat && !b.life!.chat && a.life!.chatCool > 0 && b.life!.chatCool > 0, "they part, and wait before the next");
  const topics = new Set<string>([...ARCHETYPES[a.person!.archetype].topics, ...ARCHETYPES[b.person!.archetype].topics, "laugh", "ask"]);
  assert.ok(icons.length > 0 && icons.every((i) => topics.has(i)), `pictograms: ${icons}`);
});

test("the golem talks to someone: they turn to it (a seated one turns its head) and answer with one of their own lines", () => {
  const w = at(10.5); run(w, DT);
  const a = folkOf(w).find((x) => x.area === "town" && folkPresent(x) && x.life!.state === "do" && x.life!.wait > 3)!;
  assert.ok(a, "someone at a stop");
  assert.ok(npcInteractables(w, getArea(w, "town")).some((i) => i.kind === "folk" && i.actorId === a.id));
  const pl = player(w);
  pl.x = a.x + 12; pl.y = a.y + 10;
  folkTalk(w, pl, a.id);
  const said = w.events.find((e) => e.t === "folkSpoke");
  assert.ok(w.events.some((e) => e.t === "talkedTo" && e.npc === a.id));
  const pool = [...ARCHETYPES[a.person!.archetype].lines, ...a.person!.traits.flatMap((t) => TRAITS[t].lines ?? []), ...(ACTIVITY_LINES[a.life!.act] ?? [])];
  assert.ok(said?.t === "folkSpoke" && pool.includes(said.line), "a line of their own");
  run(w, 0.5);
  assert.ok(a.life!.attend > 0);
  const dx = pl.x - a.x, dy = pl.y - a.y;
  if (["sit", "warm", "lie"].includes(a.life!.pose)) assert.equal(a.life!.head, gazeAt(a.facing, dx, dy));
  else assert.equal(a.facing, faceTo(dx, dy));
});

test("folk are soft: the golem walks on through, and they step aside, eyes on it, as it comes at them", () => {
  const w = at(10); run(w, DT);
  const a = actorById(w, "folk.res.3")!, pl = player(w), x = 1000, y = 516;
  assert.ok(teleportTo(w, pl, "town", x, y + 26));
  pin(w, a, x, y, "down", "lean");
  let aside = false;
  for (let i = 0; i < 90; i++) {
    frame(w, { ix: 0, iy: -1, use: false });
    aside ||= a.life!.state === "aside";
    assert.ok(natural(a.facing, a.life!.head), `head ${a.life!.head} on ${a.facing}`);
  }
  assert.ok(aside, "stepped aside"); assert.ok(pl.y < y - 4, `the golem walked on (${pl.y.toFixed(1)})`);
});

// ------------------------------------------------------------------ saves
test("a save from before townsfolk (v17) gets the people of every area it had visited, from its own seed; a v18 save is left alone", () => {
  const w = at(10); getArea(w, "surface"); run(w, 1);
  const s = serialize(w) as unknown as { version: number; flags: string[]; actors: Actor[] };
  const v17 = { ...s, version: 17, flags: s.flags.filter((f) => !f.startsWith("census.")), actors: s.actors.filter((a) => a.kind !== "folk") };
  assert.deepEqual(MIGRATIONS[17](v17), { ...v17, version: 18 }, "nothing older is rewritten: the people are made on load");
  assert.equal((migrate(v17) as { version: number }).version, 19);
  const loaded = deserialize(v17);
  const who = (x: World) => folkOf(x).map((a) => `${a.id} ${JSON.stringify(a.person)}`).sort();
  assert.deepEqual(who(loaded), who(w), "the same people as the world that saved it");
  for (const id of ["town", "surface"]) assert.ok(loaded.flags.has(censusFlag(id)), id);
  assert.equal(loaded.rng.state, w.rng.state, "made by hash: the story's rng is where it was");
  run(loaded, DT);
  for (const a of folkOf(loaded).filter((x) => x.area === "town")) assert.equal(a.life!.plan, planAt(loaded, a).key, `${a.id} set down by the hour`);
  // an area the save never visited has nobody until someone goes there
  const halls = deserialize({ ...(serialize(createWorld(7)) as object), version: 17 });
  assert.equal(folkOf(halls).filter((a) => a.person!.origin === "town").length, 0);
  getArea(halls, "town");
  assert.equal(folkOf(halls).filter((a) => a.area === "town").length, CENSUS.filter((r) => r.area === "town").length);
  // a v18 save keeps its people as they are
  const again = deserialize(serialize(loaded));
  assert.deepEqual(who(again), who(loaded));
});

test("save and load mid-stride: the loaded town carries on exactly as the one that saved it", () => {
  const w = at(17.5); run(w, 20);
  const w2 = deserialize(serialize(w));
  run(w, 30); run(w2, 30);
  assert.deepEqual(serialize(w2).actors, serialize(w).actors);
});

// ------------------------------------------------------------------ bug: heads turned round to the back of the body
test("a head turns a quarter turn at most: in every garb, pose and facing, a head asked to look behind is painted looking ahead", () => {
  const POSES: FolkPose[] = ["stand", "walk", "sit", "lie", "crouch", "hammer", "chop", "hoe", "hang", "feed", "sweep", "dig", "aim", "raise", "lean", "drink", "chat", "wave", "browse", "draw", "warm", "stretch"];
  const w0 = createWorld(1);
  for (const arch of Object.values(ARCHETYPES)) {
    const look = makePerson(w0, { id: `t.${arch.id}`, area: "town", archetype: arch.id, home: "door.watch" }).look;
    for (const pose of POSES) for (const facing of ROT) {
      const paint = (head: Facing | null) => { const g = new FolkGrid(); paintFolk(g, arch.garb, look, arch.age, { facing, head, pose, frame: 0, carry: false, lantern: false, pole: false, blink: false }); return g.c.join(","); };
      const ahead = paint(null);
      assert.equal(paint(turn(facing, 2)), ahead, `${arch.id} ${pose} facing ${facing}: never a head the other way`);
      assert.equal(paint(facing), ahead);
      if (pose !== "lie") for (const k of [1, -1]) assert.notEqual(paint(turn(facing, k)), ahead, `${arch.id} ${pose} ${facing}: a quarter turn shows`);
    }
  }
  for (const f of ROT) {
    assert.equal(naturalHead(f, turn(f, 2)), null); assert.equal(naturalHead(f, f), null);
    for (const k of [1, -1]) assert.equal(naturalHead(f, turn(f, k)), turn(f, k));
  }
  // looking at something: at it within a quarter turn; behind, over the shoulder on the side it is on
  assert.deepEqual([gazeAt("down", 0, 20), gazeAt("down", 20, 2), gazeAt("up", 3, 20), gazeAt("up", -3, 20), gazeAt("left", 20, -2), gazeAt("left", 20, 2)], [null, "right", "right", "left", "up", "down"]);
});

test("heads in play turn a quarter turn at most, whatever the golem does round them: standing, seated, working, chatting, drinking, aiming", () => {
  const POSES: FolkPose[] = ["stand", "lean", "browse", "sit", "warm", "hammer", "chop", "sweep", "chat", "drink", "crouch", "aim"];
  const w = at(10); run(w, DT);
  const a = actorById(w, "folk.res.3")!, pl = player(w), x = 1000, y = 516;
  const ok = (what: string) => {
    assert.ok(natural(a.facing, a.life!.head), `${what}: head ${a.life!.head} on a body facing ${a.facing}`);
    const art = folkArtPose(w, a, 0);
    assert.ok(natural(art.facing, art.head), `${what}: drawn head ${art.head} on ${art.facing}`);
  };
  for (const pose of POSES) for (const facing of ROT) {
    if (pose === "aim" && (facing === "up" || facing === "down")) continue; // a bow is drawn side-on (the full day checks it)
    pin(w, a, x, y, facing, pose);
    const [bx, by] = STEPV[turn(facing, 2)];
    for (let k = 0; k <= 16; k++) {
      const th = Math.atan2(by, bx) + (k * Math.PI) / 8;
      for (let i = 0; i < 6; i++) {
        pl.x = a.x + Math.cos(th) * 22; pl.y = a.y + Math.sin(th) * 22; pl.vx = 0; pl.vy = 0;
        stepWorld(w, DT); w.events = [];
        ok(`${pose} facing ${facing}, the golem at ${Math.round((th * 180) / Math.PI)} deg`);
        if (k || i) continue;
        // the first look, with the golem dead behind: standing, they turn round to it; otherwise over a shoulder
        const side = a.life!.head === turn(facing, 1) || a.life!.head === turn(facing, -1);
        if (pose === "stand" || pose === "lean" || pose === "browse") assert.ok(a.facing === turn(facing, 2) || side, `${pose} ${facing}: turned to it`);
        else assert.ok(a.facing === facing && side, `${pose} ${facing}: the body stays and the head looks over a shoulder (${a.life!.head})`);
      }
    }
    // and walked at from behind: they step aside, eyes on the golem
    pin(w, a, x, y, facing, pose);
    let gx = a.x + bx * 34, gy = a.y + by * 34;
    for (let i = 0; i < 24; i++) {
      const d = Math.hypot(a.x - gx, a.y - gy) || 1, vx = ((a.x - gx) / d) * 45, vy = ((a.y - gy) / d) * 45;
      gx += vx * DT; gy += vy * DT; pl.x = gx; pl.y = gy; pl.vx = vx; pl.vy = vy;
      stepWorld(w, DT); w.events = [];
      ok(`${pose} facing ${facing}, walked at from behind`);
    }
  }
});

test("seated people who talk keep their seats and turn their heads, even with the golem behind them", () => {
  const w = at(10); run(w, DT);
  const a = actorById(w, "folk.eld.1")!, b = actorById(w, "folk.eld.2")!, pl = player(w);
  pin(w, a, 1000, 516, "down", "sit"); pin(w, b, 1010, 516, "down", "sit");
  a.life!.chat = { with: b.id, t: 5, turn: 0.4, speaker: true }; b.life!.chat = { with: a.id, t: 5, turn: 1.6, speaker: false };
  pl.x = 1005; pl.y = 496; pl.vx = 0; pl.vy = 0;
  const looks = new Set<string>();
  run(w, 3, () => {
    for (const p of [a, b]) {
      assert.deepEqual([p.facing, p.life!.pose], ["down", "sit"], `${p.id} keeps its seat`);
      assert.ok(natural(p.facing, p.life!.head), `${p.id}: head ${p.life!.head}`);
      looks.add(`${p.id}:${p.life!.head}`);
    }
  });
  assert.ok(looks.has(`${a.id}:right`) && looks.has(`${b.id}:left`), `they looked at each other: ${[...looks]}`);
});

// ------------------------------------------------------------------ bug: two people at one anvil
test("an anvil, a stool holds one person at a time: with more people than places some wait, and never two at one", () => {
  // the whole town apprenticed for a morning: seventeen people, two anvils
  const w = at(7.5);
  for (const a of folkOf(w)) if (a.person!.origin === "town") { a.person!.routine = "apprentice"; a.person!.traits = []; }
  let both = 0, waited = 0;
  run(w, 90, (w) => {
    noneShared(w, "anvils");
    const work = folkOf(w).filter((a) => a.area === "town");
    if (work.filter((a) => a.life!.spot?.startsWith("work.hammer") && atGoal(a)).length === 2) both++;
    if (work.some((a) => a.life!.act === "work" && !a.life!.spot && a.life!.state === "do")) waited++;
    for (const a of work) if (a.life!.pose === "hammer") assert.ok(a.life!.spot?.startsWith("work.hammer") && atGoal(a), `${a.id} hammers only at an anvil of its own`);
  });
  assert.ok(both > 100 && waited > 100, `both anvils worked (${both} ticks) while the rest waited their turn (${waited})`);
  // the whole town a labourer's evening: the tavern's stools fill, and the rest stand
  const t = at(21, "town_tavern");
  getArea(t, "town"); // its people are the town's (in play the tavern is only ever entered from the town)
  for (const a of folkOf(t)) if (a.person!.origin === "town") { a.person!.routine = "labourer"; a.person!.traits = []; }
  const room = getArea(t, "town_tavern"), stools = (room.base.spots ?? []).filter((s) => s.kind === "seat").length;
  let full = 0;
  run(t, 30, (t) => {
    noneShared(t, "stools");
    const sitting = folkOf(t).filter((a) => a.area === room.id && a.life!.pose === "sit");
    for (const a of sitting) assert.ok(a.life!.spot && spotById(room, a.life!.spot)?.kind === "seat" && atGoal(a), `${a.id} sits on a stool of its own`);
    if (sitting.length === stools) full++;
  });
  assert.ok(stools >= 3 && full > 50, `all ${stools} stools taken (${full} ticks), the rest standing`);
});

test("a whole day in Westwake (saved and loaded at noon), an evening in the tavern and a day at the camp: no exclusive place is ever held or stood at by two, no head turns round", () => {
  const used = new Set<string>();
  let tick = 0;
  const check = (label: string) => (w: World) => {
    noneShared(w, label);
    const there: Actor[] = [];
    for (const a of folkOf(w)) {
      const L = a.life!;
      assert.ok(natural(a.facing, L.head), `${label}: ${a.id} head ${L.head} on a body facing ${a.facing}`);
      if (L.pose === "aim") assert.ok(a.facing === "left" || a.facing === "right", `${label}: ${a.id} draws its bow side-on`);
      const s = L.spot && !L.spot.startsWith("lamp:") ? spotById(getArea(w, a.area), L.spot) : undefined;
      if (s && isExclusive(s) && L.state === "do" && atGoal(a)) { there.push(a); used.add(s.kind); }
    }
    for (let i = 0; i < there.length; i++) for (let j = i + 1; j < there.length; j++) {
      const p = there[i], q = there[j];
      if (p.area === q.area) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 4, `${label}: ${p.id} and ${q.id} on one place`);
    }
    // every half minute the golem goes and stands just behind someone, to be looked at
    if (tick++ % 600 === 0) {
      const pl = player(w), ppl = folkOf(w).filter((a) => a.area === pl.area && folkPresent(a));
      if (ppl.length) { const p = ppl[(tick / 600 | 0) % ppl.length], [bx, by] = STEPV[turn(p.facing, 2)]; pl.x = p.x + bx * 18 + 3; pl.y = p.y + by * 18; }
    }
  };
  let w = at(6);
  run(w, 6 * 30, check("town, morning"));
  const before = folkOf(w).map((a) => [a.id, a.life!.spot]);
  w = deserialize(serialize(w));
  assert.deepEqual(folkOf(w).map((a) => [a.id, a.life!.spot]), before, "the places held are held after a load");
  run(w, 8 * 30, check("town, afternoon (loaded)"));
  const tavern = getArea(w, "town_tavern");
  assert.ok(teleportTo(w, player(w), tavern.id, tavern.start.x, tavern.start.y));
  run(w, 5 * 30, check("tavern, evening"));
  const town = getArea(w, "town");
  assert.ok(teleportTo(w, player(w), "town", town.start.x, town.start.y));
  run(w, 5 * 30, check("town, night"));
  const c = at(0, "surface");
  run(c, 24 * 30, check("camp"));
  for (const k of ["work", "chore", "gather", "bench", "seat", "bed", "camp", "hunt", "forage"]) assert.ok(used.has(k), `a ${k} place was used`);
});
