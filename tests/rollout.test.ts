// The production rollout of the foundations: analysis-gated build plans (and
// the taken-prop scan fix), the storage chest, the ruby chain at the bench, the
// dormant worker golem in the artificery with the C-key core seam (in and out,
// golem and guardian), both power thoughts, the v11 -> v12 migration, and the
// host's seams (storage note, management note, core feedback). Plus the
// guarantees: the tutorial never touches a gate, the one core is never
// consumed, stranded or duplicated, and a fresh game reaches all of it with no
// debug tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { RECIPES, AUTHORED_SALVAGE, scanHint } from "../src/game/content/build";
import { CRAFT_RECIPES, STATION_REQUIRES } from "../src/game/content/crafting";
import { ITEMS, isCritical } from "../src/game/content/items";
import { RULES, SLAM_RULES } from "../src/game/content/interactions";
import { DIALOGUE } from "../src/game/content/dialogue";
import { THOUGHTS } from "../src/game/content/monologue";
import { ACTORS } from "../src/game/content/actors";
import { NPCS, npcDef } from "../src/game/content/npcs";
import { PROPS } from "../src/game/content/props";
import { FLAGS } from "../src/game/content/flags";
import { TS, T } from "../src/game/content/tiles";
import { FONT_GLYPHS } from "../src/game/font";
import { ARTIFICERY_WORKER, buildDungeon } from "../src/game/map";
import { buildSurface } from "../src/game/surface";
import { actorById, createWorld, currentArea, enterArea, getArea, player, setFlag, type Actor, type SimEvent, type World } from "../src/game/world/world";
import { serialize, deserialize, migrate, SAVE_VERSION } from "../src/game/world/save";
import { addItems, countItem, hasItem } from "../src/game/sim/inventory";
import { readItem, orderBuild, orderDeconstruct, orderCoreSwap } from "../src/game/sim/commands";
import { canBuild, suggestTile } from "../src/game/sim/build";
import { entryFor, entryReason } from "../src/game/sim/catalog";
import { orderCraft } from "../src/game/sim/crafting";
import { scanTargets, npcInteractables, interactables } from "../src/game/sim/interact";
import { visionTargets, planLock } from "../src/game/sim/analysis";
import { powered } from "../src/game/sim/actorStats";
import { relicCount } from "../src/game/sim/discovery";
import { talkTo, playSegment, scriptOf, npcActor } from "../src/game/sim/dialogue";
import { placeGlyph } from "../src/game/sim/ritual";
import { storageNote } from "../src/game/sim/storage";
import { propBlocks, actorBoxes, actorBox } from "../src/game/sim/collision";
import { reachable, nearReached, type Box } from "../src/game/sim/reach";
import { actorActive } from "../src/game/view/actors";
import { workerState, BODY_ART } from "../src/game/workerArt";
import { Game } from "../src/game/game";
import { events, find, frame, frames, newWorld, propItem, slamAt, standAt, useOn, guardianIt, talkThrough, GUARDIAN } from "./helpers";

const WORKER = ARTIFICERY_WORKER.id;
const GATED = ["brazier", "chair", "craftbench", "storage_chest", "table", "wall_banner", "wall_torch"];
const thoughts = (evs: SimEvent[]) => evs.filter((e) => e.t === "thought").map((e) => (e as { line: string }).line);
const finish = (w: World) => { let g = 0; while (player(w).task && g++ < 900) frame(w); };

/** Every Ruby Golem Core in the world: packs, gear, power sockets, the ground, props and their storage. */
function coreCount(w: World) {
  let n = 0;
  for (const a of w.actors) {
    n += countItem(a, "ruby_core") + (a.powerCore === "ruby_core" ? 1 : 0);
    n += Object.values(a.gear).filter((g) => g === "ruby_core").length;
  }
  for (const area of w.areas.values()) {
    for (const l of area.loose) if (!l.taken && l.item === "ruby_core") n += l.n ?? 1;
    for (const p of area.props) { if (p.item === "ruby_core" && !p.taken) n++; for (const s of p.inventory ?? []) if (s?.item === "ruby_core") n += s.n; }
  }
  return n;
}

/** Stand in front of a body the way the player would, press C, and let the reach play out. */
function coreKeyAt(w: World, target: Actor) {
  const pl = player(w);
  if (pl.area !== target.area) enterArea(w, pl, target.area, target.x, target.y + 11);
  pl.x = target.x; pl.y = target.y + 11; pl.vx = pl.vy = 0; pl.facing = "up";
  frame(w, { ix: 0, iy: 0, use: false, core: true });
  finish(w); frames(w, 5);
}

/** Golem vision on (Z), E at a buildable prop, the scan plays out. */
function scanProp(w: World, propId: string) {
  const pl = player(w), p = currentArea(w).prop(propId)!;
  pl.x = p.x; pl.y = p.y + 11; pl.vx = pl.vy = 0; pl.facing = "up";
  frame(w, { ix: 0, iy: 0, use: true, toggleScan: pl.mode !== "scan" });
  finish(w);
}

const boxes = (w: World, area: string, except?: string): Box[] =>
  [...getArea(w, area).props.filter(propBlocks).map((p) => p.box!), ...actorBoxes(w, area, w.playerId).filter((b) => !except || b.join() !== actorBox(actorById(w, except)!)!.join())];

// ------------------------------------------------------------------ the catalog
test("gating data: which plans need analysis, and every gate has an example to read in a production area", () => {
  assert.deepEqual(Object.keys(RECIPES).filter((id) => RECIPES[id].analysis).sort(), GATED);
  assert.ok(!RECIPES.torch_post.analysis && !RECIPES.barricade.analysis, "the torch post and the barricade stay free");
  const kinds = new Set([...buildDungeon().props, ...buildSurface().props].map((p) => p.kind));
  for (const free of ["torch_post", "barricade"]) assert.ok(!kinds.has(RECIPES[free].prop), `${free}: no example stands anywhere, so a gate would lock it forever`);
  for (const id of GATED) {
    const r = RECIPES[id], sources = [r.prop, ...(r.learnFrom ?? []).map((l) => l.kind)];
    assert.equal(r.analysis, id, `${id}: its flag is analysis.${id}`);
    assert.ok(sources.some((k) => kinds.has(k)), `${id}: something to scan for it in a production area`);
  }
  // the storage chest: its own 1-tile, 32-slot kind on planks; the looted dungeon chests stay out of AUTHORED_SALVAGE
  const chest = RECIPES.storage_chest;
  assert.equal(chest.prop, "storage_chest"); assert.equal(PROPS.storage_chest.storage!.slots, 32);
  assert.ok(PROPS.storage_chest.box![0] <= TS, "one tile");
  assert.deepEqual(chest.cost, [{ item: "planks", n: 4 }]);
  assert.ok(!("chest" in AUTHORED_SALVAGE) && AUTHORED_SALVAGE.storage_chest);
  assert.deepEqual(chest.learnFrom, [{ kind: "chest", name: "OLD CHEST" }]);
  // the promoted bench rows: distinct names that fit the crafting list (20 characters), the ruby chain on the chisel
  const names = CRAFT_RECIPES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length, "no two rows share a name");
  for (const r of CRAFT_RECIPES) assert.ok(r.name.length <= 20 && [...r.name].every((c) => FONT_GLYPHS.has(c)), r.name);
  const by = Object.fromEntries(CRAFT_RECIPES.map((r) => [r.id, r]));
  assert.deepEqual([by.unmake_rune_swift.name, by.unmake_rune_glow.name, by.unmake_crown.name], ["UNMAKE RUNE OF SWIFT", "UNMAKE RUNE OF GLOW", "UNMAKE BROKEN CROWN"]);
  assert.deepEqual([by.unmake_crown.output, by.unmake_rune_swift.output, by.unmake_rune_glow.output], [{ item: "large_ruby", n: 1 }, { item: "stone", n: 1 }, { item: "stone", n: 1 }]);
  assert.deepEqual([by.ruby_core.inputs, by.ruby_core.tools, by.ruby_core.output], [[{ item: "large_ruby", n: 1 }], ["chisel"], { item: "ruby_core", n: 1 }]);
  assert.ok(CRAFT_RECIPES.every((r) => !r.requires), "station knowledge (know.build) only: nothing at a bench is analysis-gated");
  assert.deepEqual([ITEMS.large_ruby.name, ITEMS.ruby_core.name], ["HIGH-GRADE RUBY", "RUBY GOLEM CORE"]);
  assert.ok(!ITEMS.large_ruby.desc!.join(" ").includes("UNCUT"));
});

test("the build menu says what to scan and that vision is Z, distinct from missing knowledge, within the panel", () => {
  const w = newWorld(), pl = player(w);
  for (const id of GATED) assert.equal(entryReason(entryFor(w, pl, id)!), "UNKNOWN RECIPE - NOT YET LEARNED", `${id} before the Primer`);
  setFlag(w, FLAGS.knowBuild);
  for (const id of GATED.filter((x) => x !== "brazier")) {
    const e = entryFor(w, pl, id)!, why = entryReason(e);
    assert.equal(e.status, "unknown"); assert.equal(e.lock, "analysis");
    assert.equal(why, `SCAN ${scanHint(RECIPES[id])} IN VISION (Z)`);
    assert.ok(why.length <= 36 && [...why].every((c) => FONT_GLYPHS.has(c)), `${id}: "${why}" fits the status line`);
  }
  assert.equal(entryReason(entryFor(w, pl, "storage_chest")!), "SCAN AN OLD CHEST IN VISION (Z)");
  assert.equal(entryReason(entryFor(w, pl, "table")!), "SCAN A TABLE IN VISION (Z)");
  // the brazier still needs masonry, which no book grants yet: that is a knowledge lock, said as before
  assert.equal(entryFor(w, pl, "brazier")!.lock, "knowledge");
  assert.equal(entryReason(entryFor(w, pl, "brazier")!), "UNKNOWN RECIPE - NOT YET LEARNED");
  assert.equal(entryFor(w, pl, "torch_post")!.lock, undefined);
});

// ------------------------------------------------------------------ the taken-prop scan fix
test("taking the chisel or the Primer leaves the workbench and the library table scannable; scanning never steals", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  setFlag(w, FLAGS.knowBuild);
  // scanning the occupied workbench reads it and leaves the chisel where it is
  scanProp(w, "workbench@13.5,37");
  assert.ok(w.flags.has("analysis.craftbench")); assert.equal(countItem(pl, "chisel"), 0);
  w.flags.delete("analysis.craftbench");
  frame(w, { ix: 0, iy: 0, use: false, toggleScan: true }); // vision off: E picks the chisel up
  useOn(w, propItem(w, "workbench@13.5,37"));
  assert.equal(countItem(pl, "chisel"), 1); assert.ok(area.prop("workbench@13.5,37")!.taken);
  assert.ok(scanTargets(area).some((t) => t.propId === "workbench@13.5,37"), "still a scan target once taken");
  scanProp(w, "workbench@13.5,37");
  assert.ok(w.flags.has("analysis.craftbench"), "and scanning it after the chisel is gone reads the bench");
  frame(w, { ix: 0, iy: 0, use: false, toggleScan: true });
  useOn(w, propItem(w, "table@11,29"));
  assert.ok(hasItem(pl, "book_build") && area.prop("table@11,29")!.taken);
  scanProp(w, "table@11,29");
  assert.ok(w.flags.has("analysis.table"), "the library table reads after the Primer is taken");
  const vt = visionTargets(w, area).find((t) => t.id === "table@11,29")!;
  assert.deepEqual([vt.category, vt.analysis], ["buildable", "done"]);
});

test("taking a buildable apart reads its plan too, so the only workbench can go and crafting is never lost", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  setFlag(w, FLAGS.knowBuild);
  useOn(w, propItem(w, "workbench@13.5,37")); // the chisel first: the bench refuses while it holds it
  const bench = area.prop("workbench@13.5,37")!;
  pl.x = bench.x; pl.y = bench.y + 14; pl.facing = "up";
  events(w);
  assert.ok(orderDeconstruct(w, pl, bench.id)); finish(w);
  assert.equal(area.prop(bench.id), undefined);
  const evs = events(w);
  assert.ok(w.flags.has("analysis.craftbench"));
  assert.ok(evs.some((e) => e.t === "message" && e.text === "PLAN LEARNED: CRAFTING BENCH"));
  assert.ok(evs.some((e) => e.t === "analyzed"));
  assert.deepEqual(canBuild(w, pl, "craftbench"), { ok: true }, "its own refund rebuilds it");
});

test("the treasury's looted chests teach the storage chest, and stay what they are", () => {
  const w = newWorld(), pl = player(w), area = currentArea(w);
  setFlag(w, FLAGS.knowBuild);
  area.setTile(51, 5, T.FLOOR);
  enterArea(w, pl, "dungeon", 54 * TS + 8, 6 * TS);
  assert.equal(visionTargets(w, area).find((t) => t.id === "chest@54,4")!.analysis, "pending");
  scanProp(w, "chest@54,4");
  assert.ok(w.flags.has("analysis.storage_chest"));
  assert.equal(planLock(w, pl, RECIPES.storage_chest), null);
  assert.ok(!interactables(area).some((i) => i.propId === "chest@54,4"), "not a container, not storage");
  assert.equal(area.prop("chest@54,4")!.kind, "chest");
});

// ------------------------------------------------------------------ the tutorial never touches a gate
test("the tutorial's critical path needs no building, crafting or analysis, and no rule or story step reads a gate", () => {
  const reqs = [...Object.values(RULES).flat().map((r) => r.when), ...Object.values(SLAM_RULES).flat().map((r) => r.when),
    ...Object.values(DIALOGUE).flatMap((d) => d.segments.flatMap((s) => [s.when, ...s.pages.map((p) => p.when)]))];
  for (const q of reqs) assert.ok(!(q?.flags ?? []).some((f) => f.startsWith("analysis.") || f === FLAGS.knowBuild), JSON.stringify(q));
  const made = new Set([...CRAFT_RECIPES.map((r) => r.output.item)]);
  for (const id of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) if (isCritical(id) && ITEMS[id].tags.includes("glyph")) assert.ok(!made.has(id));
  for (const id of ["chisel", "key", "core", "schematic", "glyph0", "glyph1", "glyph2", "glyph3", "arm"] as const) assert.ok(!made.has(id), `${id} is never made at a bench`);

  const w = newWorld(77), pl = player(w), area = currentArea(w), r = area.ritual!;
  const seen: SimEvent[] = [];
  const step = (f: () => void) => { f(); seen.push(...events(w)); };
  step(() => useOn(w, propItem(w, "limbrack@65.5,3")));
  step(() => slamAt(w, find(w, (i) => i.kind === "cracked")));
  step(() => useOn(w, propItem(w, "skeleton@66,32")));
  step(() => useOn(w, find(w, (i) => i.kind === "door")));
  step(() => talkThrough(w, guardianIt(w)));
  for (const id of ["workbench@13.5,37", "maptable@39.5,5", "hearth@60.5,43", "lectern@5,29", "footlocker@63,21", "altar@26,48"]) step(() => useOn(w, propItem(w, id)));
  setFlag(w, FLAGS.knowSchematic); // the schematic screen sets this on opening
  step(() => useOn(w, find(w, (i) => i.kind === "gap")));
  step(() => useOn(w, find(w, (i) => i.kind === "center")));
  r.solution.forEach((g, s) => step(() => { placeGlyph(w, pl, area, s, g); while (pl.task) frame(w); }));
  assert.ok(r.active);
  pl.x = area.ritualPos.x; pl.y = area.ritualPos.y + 2;
  step(() => frames(w, 220));
  assert.ok(seen.some((e) => e.t === "teleport"), "the circle carries the golem out");
  assert.ok(!seen.some((e) => e.t === "built" || e.t === "crafted" || e.t === "analyzed"), "nothing built, crafted or analyzed");
  assert.ok(![...w.flags].some((f) => f.startsWith("analysis.")), "and no plan was ever read");
});

// ------------------------------------------------------------------ the dormant worker golem
test("the dormant worker golem: placed by the builder with a stable id, a worker not an NPC, no dialogue, violet in vision", () => {
  const w = newWorld(), area = currentArea(w), wk = actorById(w, WORKER)!;
  assert.deepEqual([wk.definition, wk.kind, wk.npc, wk.area, wk.x, wk.y, wk.facing, wk.powerCore], ["worker_golem", "npc", "worker_golem", "dungeon", ARTIFICERY_WORKER.x, ARTIFICERY_WORKER.y, "down", null]);
  assert.equal(npcDef(wk.npc), undefined, "no NPCS row");
  assert.deepEqual(actorById(createWorld(999), WORKER), wk, "deterministic, whatever the seed");
  assert.equal(npcInteractables(w, area).find((i) => i.actorId === WORKER)!.kind, "worker");
  assert.equal(npcActor(w, WORKER), undefined);
  assert.equal(talkTo(w, player(w), WORKER), null); assert.deepEqual(events(w), [], "talking to it says nothing");
  const vt = visionTargets(w, area).find((t) => t.id === WORKER)!;
  assert.deepEqual([vt.category, vt.kind, vt.source], ["npc", "actor:worker_golem", "actor"]);
  assert.deepEqual(ACTORS.worker_golem.art, { key: "worker" }); assert.ok(BODY_ART.worker);
  // the human stand-in is fixture-only: nothing in production resolves to npc_worker
  const spawns = [...(buildDungeon().npcs ?? []), ...(buildSurface().npcs ?? [])];
  assert.ok(spawns.every((s) => (NPCS[s.npc]?.actor ?? s.npc) !== "npc_worker"));
  assert.ok(Object.values(NPCS).every((n) => n.actor !== "npc_worker"));
});

test("the worker keeps every route open: cradle, forge, workbench, start and the exit, from both of its spots", () => {
  for (const spot of [ARTIFICERY_WORKER, { x: 5 * TS + 8, y: 43 * TS + 12 }]) {
    const w = newWorld(), a = getArea(w, "dungeon"), wk = actorById(w, WORKER)!;
    wk.x = spot.x; wk.y = spot.y;
    const withW = reachable(a, boxes(w, "dungeon"), a.base.start), without = reachable(a, boxes(w, "dungeon", WORKER), a.base.start);
    const wb = actorBox(wk)!;
    for (let ty = 0; ty < a.h; ty++) for (let tx = 0; tx < a.w; tx++) {
      if (!without[ty * a.w + tx] || withW[ty * a.w + tx]) continue;
      const fx = tx * TS + 8, fy = ty * TS + 11;
      assert.ok(fx + 5 > wb[0] && fx - 5 < wb[2] && fy > wb[1] && fy - 5 < wb[3], `the worker at ${spot.x},${spot.y} cuts off ${tx},${ty}`);
    }
    for (const [tx, ty, what] of [[9, 38, "start / cradle"], [5, 38, "forge"], [13, 38, "workbench"], [17, 40, "exit"], [21, 40, "corridor"]] as const)
      assert.equal(withW[ty * a.w + tx], 1, `${what} reachable`);
    const it = npcInteractables(w, a).find((i) => i.actorId === WORKER)!;
    assert.ok(nearReached(a, withW, it.x, it.y + it.r / 2, 0), "somewhere to stand to reach it");
    const s = a.base.start;
    assert.ok(!(s.x + 5 > wb[0] && s.x - 5 < wb[2] && s.y > wb[1] && s.y - 5 < wb[3]), "the start is clear of it");
  }
});

// ------------------------------------------------------------------ slotting and removing: the C key
test("C slots the core into the dormant golem and takes it out again; powered with no task it stays dormant and still", () => {
  const w = newWorld(), pl = player(w), wk = actorById(w, WORKER)!;
  addItems(w, pl, "ruby_core", 1);
  const at = { x: wk.x, y: wk.y, facing: wk.facing };
  events(w);
  coreKeyAt(w, wk);
  let evs = events(w);
  assert.equal(wk.powerCore, "ruby_core"); assert.ok(powered(wk)); assert.equal(countItem(pl, "ruby_core"), 0);
  assert.deepEqual(evs.filter((e) => e.t === "coreSlotted"), [{ t: "coreSlotted", actor: pl.id, target: WORKER, item: "ruby_core", inserted: true, powered: true }]);
  assert.ok(evs.some((e) => e.t === "powerChanged" && e.actor === WORKER && e.powered));
  assert.deepEqual(thoughts(evs), [], "nothing to think about a body that runs");
  frames(w, 600); // ten seconds: powered, idle, untouched
  assert.deepEqual({ x: wk.x, y: wk.y, facing: wk.facing }, at, "it does not wander or turn");
  assert.ok(!wk.task && !wk.job && !wk.moving && wk.queue.length === 0);
  assert.equal(workerState(powered(wk), actorActive(wk)), "idle", "drawn in its dormant posture with a faint core");
  coreKeyAt(w, wk);
  evs = events(w);
  assert.equal(wk.powerCore, null); assert.ok(!powered(wk)); assert.equal(countItem(pl, "ruby_core"), 1);
  assert.deepEqual(evs.filter((e) => e.t === "coreSlotted"), [{ t: "coreSlotted", actor: pl.id, target: WORKER, item: "ruby_core", inserted: false, powered: false }]);
  assert.equal(workerState(powered(wk), actorActive(wk)), "off");
  // E never slots anything, and C facing nothing does nothing
  useOn(w, npcInteractables(w, currentArea(w)).find((i) => i.actorId === WORKER)!);
  assert.equal(wk.powerCore, null);
  pl.x = 300; pl.y = 660; frame(w, { ix: 0, iy: 0, use: false, core: true });
  assert.equal(pl.task, null);
});

test("the guardian takes the core with C (it fits, too weak to run it) and gives it back; E always talks", () => {
  const w = newWorld(), pl = player(w), g = actorById(w, GUARDIAN)!;
  currentArea(w).setTile(51, 5, T.FLOOR);
  addItems(w, pl, "ruby_core", 1);
  // carrying the core, E still opens the guardian's dialogue and slots nothing
  events(w); useOn(w, guardianIt(w));
  assert.ok(events(w).some((e) => e.t === "dialogue")); assert.equal(g.powerCore, null); assert.equal(countItem(pl, "ruby_core"), 1);
  coreKeyAt(w, g);
  const evs = events(w);
  assert.equal(g.powerCore, "ruby_core"); assert.equal(powered(g), false);
  assert.ok(evs.some((e) => e.t === "coreSlotted" && e.inserted && !e.powered));
  assert.deepEqual(thoughts(evs), ["golem.underpowered"], "it knows at once");
  frames(w, 150);
  coreKeyAt(w, g);
  assert.equal(g.powerCore, null); assert.equal(countItem(pl, "ruby_core"), 1);
});

test("one core moves freely: pack -> golem -> pack -> guardian -> pack -> golem, exactly one throughout, across a save/load", () => {
  let w = newWorld(31);
  currentArea(w).setTile(51, 5, T.FLOOR);
  addItems(w, player(w), "ruby_core", 1);
  const check = (where: string) => assert.equal(coreCount(w), 1, `one core (${where})`);
  check("pack");
  coreKeyAt(w, actorById(w, WORKER)!); check("golem"); assert.equal(actorById(w, WORKER)!.powerCore, "ruby_core");
  coreKeyAt(w, actorById(w, WORKER)!); check("pack"); assert.equal(countItem(player(w), "ruby_core"), 1);
  coreKeyAt(w, actorById(w, GUARDIAN)!); check("guardian"); assert.equal(actorById(w, GUARDIAN)!.powerCore, "ruby_core");
  // mid-cycle save and load: the core is still in the guardian, and only there
  w = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  check("guardian, after loading"); assert.equal(actorById(w, GUARDIAN)!.powerCore, "ruby_core");
  coreKeyAt(w, actorById(w, GUARDIAN)!); check("pack"); assert.equal(countItem(player(w), "ruby_core"), 1);
  coreKeyAt(w, actorById(w, WORKER)!); check("golem");
  assert.ok(powered(actorById(w, WORKER)!)); assert.equal(countItem(player(w), "ruby_core"), 0);
});

test("a full pack: taking the core out lands it on the ground, never deletes it, and it can be picked up", () => {
  const w = newWorld(), pl = player(w), wk = actorById(w, WORKER)!;
  addItems(w, pl, "ruby_core", 1);
  coreKeyAt(w, wk);
  addItems(w, pl, "stone", 20 * pl.inventory.length);
  assert.ok(pl.inventory.every((s) => s && s.item === "stone"), "pack full");
  coreKeyAt(w, wk);
  assert.equal(wk.powerCore, null); assert.equal(coreCount(w), 1);
  const loose = currentArea(w).loose.find((l) => l.item === "ruby_core" && !l.taken)!;
  assert.ok(loose, "on the ground");
  // a refusal changes nothing: no core carried, nothing to slot
  assert.equal(orderCoreSwap(w, pl, WORKER, "ruby_core"), false); assert.equal(coreCount(w), 1);
  pl.inventory[0] = null; // make room, then pick it up like anything else
  useOn(w, find(w, (i) => i.looseId === loose.id));
  assert.equal(countItem(pl, "ruby_core"), 1); assert.equal(coreCount(w), 1);
});

// ------------------------------------------------------------------ the two thoughts
test("the dormant line: E on the unpowered golem only, never about the guardian, never once it runs", () => {
  assert.equal(THOUGHTS["golem.dormant"].text, "INTEGRITY INTACT, MISSING POWER SOURCE.");
  assert.equal(THOUGHTS["golem.underpowered"].text, "INSUFFICIENT POWER SOURCE.");
  const w = newWorld(), pl = player(w), it = () => npcInteractables(w, currentArea(w)).find((i) => i.actorId === WORKER)!;
  events(w); useOn(w, it());
  let evs = events(w);
  assert.ok(evs.some((e) => e.t === "manageActor" && e.target === WORKER));
  assert.deepEqual(thoughts(evs), ["golem.dormant"]);
  // the unpowered guardian also has no core, but talking to it is not managing a worker
  currentArea(w).setTile(51, 5, T.FLOOR);
  frames(w, 150); useOn(w, guardianIt(w));
  assert.deepEqual(thoughts(events(w)), []);
  addItems(w, pl, "ruby_core", 1);
  coreKeyAt(w, actorById(w, WORKER)!); events(w); frames(w, 150);
  useOn(w, it());
  evs = events(w);
  assert.ok(evs.some((e) => e.t === "manageActor")); assert.deepEqual(thoughts(evs), [], "powered: nothing to diagnose");
});

test("with the core in the guardian, every interaction thinks INSUFFICIENT POWER SOURCE., and the story plays unchanged", () => {
  const w = newWorld(), pl = player(w), g = actorById(w, GUARDIAN)!;
  currentArea(w).setTile(51, 5, T.FLOOR);
  addItems(w, pl, "ruby_core", 1);
  coreKeyAt(w, g); events(w);
  const played: string[] = [];
  for (let talk = 0; talk < 5; talk++) {
    frames(w, 150); // past the 2 s cooldown
    useOn(w, guardianIt(w));
    const evs = events(w), d = evs.find((e) => e.t === "dialogue");
    assert.ok(evs.some((e) => e.t === "talkedTo" && e.npc === GUARDIAN));
    assert.deepEqual(thoughts(evs), ["golem.underpowered"], `talk ${talk + 1} (${d && d.t === "dialogue" ? d.segment : "idle"})`);
    if (d && d.t === "dialogue") { played.push(d.segment); playSegment(w, pl, GUARDIAN, scriptOf(w, GUARDIAN)!.segments.find((s) => s.id === d.segment)!); }
    else assert.ok(evs.some((e) => e.t === "message" && e.text === DIALOGUE.guardian.idle), "the idle line, once the story is done");
  }
  assert.deepEqual(played, ["intro", "repair", "core", "farewell"], "the same segments, in order");
  assert.ok(w.flags.has(FLAGS.golemEye)); assert.equal(countItem(pl, "core"), 1, "the aether core, given once");
  assert.equal(g.powerCore, "ruby_core");
});

// ------------------------------------------------------------------ the whole route, no debug tools
test("a fresh game reaches it all with no debug tools: Primer, scans, a storage chest, the crown, the ruby, the core, the golem", () => {
  const w = newWorld(4242), pl = player(w), area = currentArea(w);
  const start = area.base.start, crown = area.looseItem("crown")!;
  const canReach = (x: number, y: number) => nearReached(area, reachable(area, boxes(w, "dungeon"), { x: pl.x, y: pl.y }), x, y);
  // The Primer (library) and the chisel (artificery) are reachable from the start; the crown only past the cracked wall.
  assert.ok(nearReached(area, reachable(area, boxes(w, "dungeon"), start), area.prop("table@11,29")!.x, area.prop("table@11,29")!.y + 12));
  assert.ok(!nearReached(area, reachable(area, boxes(w, "dungeon"), start), crown.x, crown.y), "the throne hall is sealed by the cracked wall");
  useOn(w, propItem(w, "table@11,29")); readItem(w, pl, "book_build");
  assert.ok(w.flags.has(FLAGS.knowBuild));
  useOn(w, propItem(w, "workbench@13.5,37"));
  useOn(w, propItem(w, "limbrack@65.5,3"));
  slamAt(w, find(w, (i) => i.kind === "cracked"));
  pl.x = start.x; pl.y = start.y;
  assert.ok(canReach(crown.x, crown.y), "walkable from the start once the wall is down");
  useOn(w, find(w, (i) => i.looseId === "crown"));
  assert.equal(countItem(pl, "crown"), 1); assert.equal(relicCount(w, pl), 1);
  // scan the dungeon furniture: the bench (chisel gone), the library table (Primer gone), a chair, the treasury's old chest
  assert.equal(entryFor(w, pl, "table")!.lock, "analysis");
  scanProp(w, "workbench@13.5,37"); scanProp(w, "table@11,29"); scanProp(w, "chair@58.6,18");
  useOn(w, propItem(w, "skeleton@66,32"));
  frame(w, { ix: 0, iy: 0, use: false, toggleScan: true });
  useOn(w, find(w, (i) => i.kind === "door"));
  scanProp(w, "chest@54,4");
  frame(w, { ix: 0, iy: 0, use: false, toggleScan: true });
  for (const id of ["craftbench", "table", "chair", "storage_chest"]) assert.ok(w.flags.has(`analysis.${id}`), id);
  // planks from the barracks table, then a storage chest; E on it gives an honest note (no storage screen yet)
  const t = area.prop("table@60.5,18")!;
  pl.x = t.x; pl.y = t.y + 14; pl.facing = "up";
  assert.ok(orderDeconstruct(w, pl, t.id)); finish(w);
  assert.equal(countItem(pl, "planks"), 4);
  const site = suggestTile(w, pl, area, "storage_chest")!;
  assert.ok(site && orderBuild(w, pl, "storage_chest", site.tx, site.ty)); finish(w);
  const chest = area.props.find((p) => p.dyn && p.kind === "storage_chest")!;
  assert.ok(chest && chest.inventory?.length === 32 && countItem(pl, "planks") === 0);
  events(w); useOn(w, find(w, (i) => i.propId === chest.id));
  assert.ok(events(w).some((e) => e.t === "openStorage" && e.prop === chest.id));
  assert.equal(storageNote(area, chest.id), "STORAGE CHEST: EMPTY, 32 SLOTS");
  // the bench: unmake the crown into the High-Grade Ruby, carve the Ruby Golem Core (station knowledge only)
  const flagsBefore = [...w.flags].filter((f) => f.startsWith("analysis.")).sort();
  const bench = area.prop("workbench@13.5,37")!;
  pl.x = bench.x; pl.y = bench.y + 12; pl.facing = "up";
  assert.deepEqual(STATION_REQUIRES.crafting, { flags: [FLAGS.knowBuild] });
  assert.ok(orderCraft(w, pl, "crafting", "unmake_crown", bench.id)); finish(w);
  assert.equal(countItem(pl, "large_ruby"), 1); assert.equal(ITEMS.large_ruby.name, "HIGH-GRADE RUBY");
  assert.equal(relicCount(w, pl), 1, "the relics display doesn't drop: credit is discovery");
  assert.ok(orderCraft(w, pl, "crafting", "ruby_core", bench.id)); finish(w);
  assert.deepEqual([countItem(pl, "ruby_core"), countItem(pl, "large_ruby"), countItem(pl, "chisel")], [1, 0, 1]);
  assert.deepEqual([...w.flags].filter((f) => f.startsWith("analysis.")).sort(), flagsBefore, "the chain read no plan");
  // the golem: E (the dormant thought), C in (on, faint, still dormant), out, in, then to the guardian and back
  const wk = actorById(w, WORKER)!;
  events(w); useOn(w, npcInteractables(w, area).find((i) => i.actorId === WORKER)!);
  assert.deepEqual(thoughts(events(w)), ["golem.dormant"]);
  coreKeyAt(w, wk); assert.ok(powered(wk)); assert.equal(workerState(powered(wk), actorActive(wk)), "idle");
  coreKeyAt(w, wk); assert.ok(!powered(wk));
  coreKeyAt(w, wk); assert.ok(powered(wk));
  coreKeyAt(w, wk);
  events(w); coreKeyAt(w, actorById(w, GUARDIAN)!);
  assert.deepEqual(thoughts(events(w)), ["golem.underpowered"]);
  frames(w, 150); useOn(w, guardianIt(w));
  assert.deepEqual(thoughts(events(w)), ["golem.underpowered"]);
  coreKeyAt(w, actorById(w, GUARDIAN)!);
  coreKeyAt(w, wk);
  assert.ok(powered(wk)); assert.equal(coreCount(w), 1);
  frames(w, 300);
  assert.deepEqual([wk.x, wk.y], [ARTIFICERY_WORKER.x, ARTIFICERY_WORKER.y], "powered with no task, it stays idle");
});

// ------------------------------------------------------------------ v11 -> v12
/** A pre-rollout save of `version`, made the way it would have been: no worker golem, the shapes of the time. */
function preRollout(version: 4 | 9 | 10 | 11, knowBuild: boolean, extraFlags: string[] = []) {
  const s: any = serialize(newWorld(5));
  s.version = version;
  s.actors = s.actors.filter((a: any) => a.id !== WORKER && (version > 4 || a.kind !== "npc"));
  s.flags = [...(knowBuild ? ["know.build"] : []), ...extraFlags];
  if (version <= 10) delete s.monologue;
  if (version <= 9) for (const a of s.actors) for (const k of ["definition", "upgrades", "powerCore", "mode", "job", "jobSeq"]) delete a[k];
  return s;
}

test("v9, v10 and v11 saves load with no lost plans and no free ones; storage stays locked; one worker is added", () => {
  assert.equal(SAVE_VERSION, 12);
  const LEGACY = ["wall_torch", "brazier", "craftbench", "table", "chair", "wall_banner"];
  for (const v of [9, 10, 11] as const) for (const knows of [true, false]) {
    const raw = preRollout(v, knows, ["analysis.surprise"]), w = deserialize(raw), pl = player(w);
    assert.equal((migrate(raw) as { version: number }).version, 12);
    for (const id of LEGACY) assert.equal(w.flags.has(`analysis.${id}`), knows, `v${v} ${knows ? "with" : "without"} know.build: ${id}`);
    assert.equal(w.flags.has("analysis.storage_chest"), false, `v${v}: the storage chest is not grandfathered`);
    assert.ok(w.flags.has("analysis.surprise"), "flags it had are kept");
    if (knows) {
      for (const id of ["torch_post", "wall_torch", "craftbench", "barricade", "table", "chair", "wall_banner"]) assert.equal(planLock(w, pl, RECIPES[id]), null, `v${v}: still knows ${id}`);
      assert.equal(planLock(w, pl, RECIPES.storage_chest), "analysis");
    }
    const workers = w.actors.filter((a) => a.id === WORKER);
    assert.equal(workers.length, 1);
    assert.deepEqual([workers[0].definition, workers[0].x, workers[0].y, workers[0].powerCore], ["worker_golem", ARTIFICERY_WORKER.x, ARTIFICERY_WORKER.y, null]);
    assert.deepEqual(serialize(deserialize(serialize(w))), serialize(w), "round trip");
  }
});

test("v4 saves pass both worker migrations (MIGRATIONS[4] loops the live spawns) and still get one worker, one guardian", () => {
  const w = deserialize(preRollout(4, false));
  assert.equal(w.actors.filter((a) => a.id === WORKER).length, 1);
  assert.equal(w.actors.filter((a) => a.id === GUARDIAN).length, 1);
  assert.equal(actorById(w, WORKER)!.definition, "worker_golem");
});

test("a migrated player standing where the worker goes: the worker takes its second spot, never overlapping a body", () => {
  const raw = preRollout(11, true);
  const p = raw.actors.find((a: any) => a.id === raw.playerId);
  p.x = ARTIFICERY_WORKER.x + 2; p.y = ARTIFICERY_WORKER.y + 1;
  const w = deserialize(raw), wk = actorById(w, WORKER)!, pl = player(w);
  assert.deepEqual([wk.x, wk.y], [5 * TS + 8, 43 * TS + 12]);
  const a = actorBox(wk)!, b = actorBox(pl)!;
  assert.ok(!(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]), "no overlap");
  frames(w, 30, { ix: 1, iy: 0, use: false });
  assert.ok(pl.x > ARTIFICERY_WORKER.x + 2, "the player walks freely");
  // a fresh v12 world is untouched by the migration
  const fresh = serialize(newWorld(8)); const again: any = JSON.parse(JSON.stringify(fresh)); again.version = 11;
  assert.deepEqual(migrate(again), fresh);
});

// ------------------------------------------------------------------ the host's seams
test("the opening with a second golem in the room: the worker is in frame, clear of the diagnostic log and the bars", () => {
  const g = new Game(canvas(), canvas());
  g.keyDown("x"); tick(g); g.keyUp("x");
  assert.ok(g.screens.is("intro"));
  const wk = actorById(g.world, WORKER)!;
  for (let t = 0; t < 11; t += 0.5) {
    tick(g, 30);
    const x0 = wk.x - g.cam.x - 7, x1 = x0 + 14, y1 = wk.y - g.cam.y, y0 = y1 - 22;
    assert.ok(x0 >= 0 && x1 <= 320 && y0 >= 14 && y1 <= 180 - 14, `in view, inside the letterbox (${x0},${y0})`);
    assert.ok(x0 > 6 + 6 + 4 * 24 || y0 > 7 + 12 + 9 * 5, "not under the monologue's lines");
  }
});

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.update(1 / 60); };
const press = (g: Game, key: string) => { g.keyDown(key); tick(g); g.keyUp(key); };

test("host: C on the golem gives matching in/out feedback, E on it says what C does, E on a chest says what it holds", () => {
  const g = new Game(canvas(), canvas()), w = newWorld();
  g.resume(w);
  const pl = player(w), wk = actorById(w, WORKER)!;
  addItems(w, pl, "ruby_core", 1);
  standAt(w, npcInteractables(w, currentArea(w)).find((i) => i.actorId === WORKER)!);
  tick(g); press(g, "e"); tick(g, 30);
  assert.equal(g.note?.text, "C TO SLOT THE RUBY GOLEM CORE");
  press(g, "c"); tick(g, 60);
  assert.ok(powered(wk)); assert.equal(g.note?.text, "RUBY GOLEM CORE SLOTTED - IT POWERS ON");
  press(g, "e"); tick(g, 30);
  assert.equal(g.note?.text, "IDLE: NO TASK GIVEN. C TAKES ITS CORE");
  press(g, "c"); tick(g, 60);
  assert.ok(!powered(wk)); assert.equal(g.note?.text, "RUBY GOLEM CORE TAKEN OUT - IT POWERS DOWN");
  assert.equal(countItem(pl, "ruby_core"), 1);
  // a storage chest standing in the artificery: E gives the note, the seam the storage screen will replace
  const area = currentArea(w), chest = area.addProp("storage_chest", 11 * TS + 8, 42 * TS + 16);
  standAt(w, find(w, (i) => i.propId === chest.id)); tick(g);
  press(g, "e"); tick(g, 30);
  assert.ok(g.screens.is("play")); assert.equal(g.note?.text, "STORAGE CHEST: EMPTY, 32 SLOTS");
});
