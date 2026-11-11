// Routes, runes and the pack (v17): the surface rune severed while the circle below is broken (lit, carrying
// nobody, waking nothing), a worker's routes over runes and portals alike (the dug-out stair, the old road to
// Westwake, the shops' doors), gather orders that keep what they gather, and the v16 -> v17 migration. The host's
// side (the rune's refusal as it is drawn) is tests/runeHost.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNE_NODES, runeDestinations } from "../src/game/content/runes";
import { ENTRANCES } from "../src/game/content/geography";
import { AREAS } from "../src/game/world/areas";
import { actorById, currentArea, enterArea, getArea, hasFlag, makeActor, player, type World } from "../src/game/world/world";
import { serialize, deserialize, migrate, SAVE_VERSION } from "../src/game/world/save";
import { checkRune, placeGlyph } from "../src/game/sim/ritual";
import { runeRoute, runeState, travel } from "../src/game/sim/runes";
import { firstHops, meansOf } from "../src/game/sim/routes";
import { inPortal, portalOpen, portalStand, portalsOf } from "../src/game/sim/portals";
import { openEntrance } from "../src/game/sim/digging";
import { findPath, navGrid } from "../src/game/sim/navigation";
import { JOB_HANDLERS, assignJob, gatherOrder, orderRefusal, resumeJob, walkOrder } from "../src/game/sim/jobs";
import { BLOCK_TEXT, INVENTORY_LABEL, blockText, canReach, gatherRefusal, gatherTargets, jobView, knownAreas, walkOptions } from "../src/game/sim/orders";
import { stepWorld } from "../src/game/sim/step";
import { addItems, countItem } from "../src/game/sim/inventory";
import { foundationDemo, registerFoundations } from "../src/game/sim/debugFoundations";
import { events, find, frame, frames, newWorld, useOn } from "./helpers";

registerFoundations();
const DT = 0.05, WORKER = "npc.worker.artificery", GATE = "buriedgate@48,61", STAIR = ENTRANCES.surface_stair;
const S = RUNE_NODES.surface, D = RUNE_NODES.dungeon;

/** A world past the first crossing: the circle solved and lit, the surface rune restored, the golem on the surface. */
function crossed() {
  const w = newWorld(), pl = player(w), dg = currentArea(w), r = dg.ritual!;
  r.core = true; r.carved = true; r.sockets = r.solution.slice();
  checkRune(w, dg);
  r.actT = 5;
  const c = dg.ritualPos;
  pl.x = c.x; pl.y = c.y + 2;
  for (let i = 0; i < 1000 && pl.area !== "surface"; i++) frame(w);
  frames(w, 5);
  events(w);
  return { w, pl };
}
/** Down in the halls, take the glyph out of a socket, as the player does: the circle goes dark (sim/ritual.ts: deactivate). */
function breakCircle(w: World) {
  const pl = player(w), c = getArea(w, "dungeon").ritualPos;
  enterArea(w, pl, "dungeon", c.x, c.y + 70);
  useOn(w, find(w, (i) => i.kind === "socket" && i.socket === 0));
}
/** The halls' own worker golem, cored, with a Rune of Swift on it so the long walks stay short. */
function withWorker(w: World) {
  const wk = actorById(w, WORKER)!;
  wk.powerCore = "ruby_core"; wk.gear.rune0 = "rune_swift";
  return wk;
}
/** The surface stair dug out, as the last stroke leaves it (sim/digging.ts: applyDig). */
function openStair(w: World) {
  const surface = getArea(w, "surface");
  surface.setPropState(GATE, { open: true, lit: true }); surface.touch("layout");
  assert.ok(openEntrance(w, player(w), "surface_stair"));
}
function until(w: World, check: () => boolean, limit = 20000) {
  for (let i = 0; i < limit && !check(); i++) stepWorld(w, DT);
  assert.ok(check(), JSON.stringify(w.actors.filter((a) => a.job).map((a) => ({ id: a.id, x: a.x, y: a.y, area: a.area, job: a.job }))));
}
/** Step until the worker's order stops running, noting each way it took between areas, in order. */
function follow(w: World, wk: { id: string; area: string; job: { status: string } | null }, stop: () => boolean = () => false) {
  const seen: string[] = [];
  events(w);
  until(w, () => {
    for (const e of events(w)) {
      if (e.t === "portal" && e.actor === wk.id) seen.push(`${e.from}>${e.to}`);
      else if (e.t === "travelled" && e.actor === wk.id) seen.push(`rune:${e.from}>${e.to}`);
    }
    return stop() || wk.job?.status !== "running";
  });
  return seen;
}

// ------------------------------------------------------------------ the rune
test("a broken circle below severs the surface rune: it stays lit but carries nobody, wakes nothing, and E gets its refusal", () => {
  const { w, pl } = crossed();
  const surface = getArea(w, "surface"), dg = getArea(w, "dungeon"), rp = surface.prop(S.prop)!;
  assert.equal(runeState(w, S), "linked"); assert.equal(runeState(w, D), "linked");
  breakCircle(w);
  assert.ok(!dg.ritual!.active && !hasFlag(w, D.flag) && hasFlag(w, S.flag), "the circle is dark; the surface rune keeps its own restoration");
  assert.equal(runeState(w, D), "dormant"); assert.equal(runeState(w, S), "severed");
  // the awakening runs one way: the circle wakes the surface rune, never the reverse
  assert.deepEqual(runeDestinations("dungeon").map((d) => [d.node.id, d.wakes]), [["surface", true]]);
  assert.deepEqual(runeDestinations("surface").map((d) => [d.node.id, d.wakes]), [["dungeon", false]]);
  assert.equal(runeRoute(w, "surface", "dungeon"), null);
  // the sim refuses the trip itself (a worker's channel, a channel saved mid-way), and sets nothing
  enterArea(w, pl, "surface", rp.x, rp.y + 4);
  events(w);
  assert.equal(travel(w, pl, surface, S.prop), false);
  assert.ok(events(w).some((e) => e.t === "message" && e.text === "NOTHING ANSWERS ON THE OTHER SIDE"));
  assert.ok(pl.area === "surface" && !hasFlag(w, D.flag));
  // E on it: no channel and no jump; the refusal's cue at the rune (the host plays the sputter) and its words
  useOn(w, find(w, (i) => i.kind === "rune"));
  const ev = events(w);
  assert.ok(!ev.some((e) => e.t === "teleport" || e.t === "travelled" || e.t === "runeAwakened"));
  assert.deepEqual(ev.filter((e) => e.t === "cue"), [{ t: "cue", cue: "runeDud", x: rp.x, y: rp.y, actor: pl.id }]);
  assert.ok(ev.some((e) => e.t === "message" && e.text === "THE RUNE GUTTERS OUT. NOTHING ANSWERS ON THE OTHER SIDE"));
  assert.ok(pl.area === "surface" && !hasFlag(w, D.flag) && !dg.ritual!.active, "still here, and the circle below still dark");
  // the glyph back in its socket: the circle lights, and the surface rune carries again
  enterArea(w, pl, "dungeon", dg.ritualPos.x, dg.ritualPos.y + 70);
  placeGlyph(w, pl, dg, 0, dg.ritual!.solution[0]);
  frames(w, 60);
  assert.ok(dg.ritual!.active && hasFlag(w, D.flag)); assert.equal(runeState(w, S), "linked");
  enterArea(w, pl, "surface", rp.x, rp.y + 4);
  useOn(w, find(w, (i) => i.kind === "rune"));
  assert.equal(pl.area, "dungeon", "mended, it carries");
  // a rune that was never lit is dormant, not severed, and says so (the halls' circle before the ritual)
  const fresh = newWorld();
  assert.equal(runeState(fresh, D), "dormant"); assert.equal(runeState(fresh, S), "dormant");
  assert.equal(runeRoute(fresh, "dungeon", "surface"), null);
});

test("v16 -> v17: a circle the surface rune had wrongly woken goes dark again, and an order stopped for want of a route keeps its reason", () => {
  assert.equal(SAVE_VERSION, 17);
  const { w } = crossed();
  breakCircle(w);
  const wk = withWorker(w);
  assert.ok(assignJob(w, wk, walkOrder("surface", 100, 100)));
  for (let i = 0; i < 5; i++) stepWorld(w, DT);
  assert.deepEqual([wk.job!.status, wk.job!.reason], ["blocked", "noRoute"], "rune dark, stair buried: no way out of the halls");
  assert.equal(blockText("noRoute"), "NO WAY THERE"); assert.ok(!("noRuneRoute" in BLOCK_TEXT));
  const now = JSON.parse(JSON.stringify(serialize(w)));
  // that world as v16 saved it once the bug had bitten: the dark circle's flag set by a trip down, the old reason name
  const v16 = { ...now, version: 16, flags: [...now.flags, "rune.dungeon.active"], actors: now.actors.map((a: { id: string; job: object }) => (a.id === WORKER ? { ...a, job: { ...a.job, reason: "noRuneRoute" } } : a)) };
  const up = migrate(v16) as typeof now;
  assert.equal(up.version, 17);
  assert.ok(!up.flags.includes("rune.dungeon.active") && up.flags.includes("rune.surface.active"));
  assert.deepEqual(up, now, "and nothing else moved");
  const w2 = deserialize(v16);
  assert.equal(runeState(w2, S), "severed"); assert.equal(runeState(w2, D), "dormant");
  // a circle that is lit keeps its flag; a save that never reached the ritual is untouched
  const lit = JSON.parse(JSON.stringify(serialize(crossed().w)));
  assert.deepEqual(migrate({ ...lit, version: 16 }), lit);
  const early = JSON.parse(JSON.stringify(serialize(newWorld())));
  assert.deepEqual(migrate({ ...early, version: 16 }), early);
});

// ------------------------------------------------------------------ routes
test("a worker takes the dug-out stair when the rune will not carry it, and walks on along the old road into Westwake", () => {
  const { w } = crossed();
  const wk = withWorker(w), means = meansOf(wk);
  breakCircle(w);
  // rune dark, stair buried: nothing leads out of the halls, and nothing beyond them is offered
  assert.deepEqual(firstHops(w, means, "dungeon", "surface"), []);
  assert.ok(!canReach(w, wk, "surface") && !canReach(w, wk, "town"));
  assert.ok(walkOptions(w, wk).every((o) => o.area === "dungeon"));
  openStair(w);
  assert.deepEqual(firstHops(w, means, "dungeon", "surface"), [{ via: "portal", portal: STAIR.below.portal, area: "surface" }]);
  assert.deepEqual(firstHops(w, means, "surface", "dungeon"), [{ via: "portal", portal: STAIR.above.portal, area: "dungeon" }]);
  assert.deepEqual(firstHops(w, means, "dungeon", "town"), [{ via: "portal", portal: STAIR.below.portal, area: "surface" }]);
  assert.ok(canReach(w, wk, "surface") && canReach(w, wk, "town"));
  // Westwake has never been visited: it is known as the far end of the road out of the surface, and offered by its start
  assert.ok(!w.areas.has("town"));
  assert.deepEqual(knownAreas(w), ["dungeon", "surface", "town"]);
  const spot = walkOptions(w, wk).find((o) => o.label === "WESTWAKE START")!;
  assert.ok(spot && spot.area === "town");
  assert.ok(!w.areas.has("town"), "listing it instantiates nothing");
  assert.ok(assignJob(w, wk, walkOrder(spot.area, spot.x, spot.y)));
  const seen = follow(w, wk);
  assert.equal(wk.job?.status, "done", JSON.stringify(wk.job));
  assert.deepEqual(seen, ["stair_up>stair_down", "west_road>east_road"], "up the stair, then west along the road: no rune");
  assert.equal(wk.area, "town"); assert.ok(Math.hypot(wk.x - spot.x, wk.y - spot.y) < 3);
  assert.ok(w.areas.has("town"), "the town exists once someone has walked in");
  // from there the shops' doors are ways too, and the way home is the same road and stair
  assert.ok(knownAreas(w).includes("town_guild") && walkOptions(w, wk).some((o) => o.label === "GUILD HALL START"));
  assert.deepEqual(firstHops(w, means, "town", "town_smithy"), [{ via: "portal", portal: "door.smithy", area: "town_smithy" }]);
  assert.deepEqual(firstHops(w, means, "town_smithy", "dungeon"), [{ via: "portal", portal: "door", area: "town" }]);
  assert.deepEqual(firstHops(w, means, "town", "dungeon"), [{ via: "portal", portal: "east_road", area: "surface" }]);
  // a body that cannot use runes still walks; one that can only use runes has no way while the circle is dark
  assert.equal(firstHops(w, { runes: false, portals: true }, "town", "dungeon").length, 1);
  assert.deepEqual(firstHops(w, { runes: true, portals: false }, "surface", "dungeon"), []);
});

test("with the rune and the stair both open it sets out for the nearer way, and keeps to it", () => {
  const { w } = crossed();
  const wk = withWorker(w), dg = getArea(w, "dungeon"), s = getArea(w, "surface").start;
  openStair(w);
  assert.deepEqual(firstHops(w, meansOf(wk), "dungeon", "surface").map((h) => h.via), ["rune", "portal"]);
  // standing where the hall to the stair opens: the stair
  const foot = dg.base.spots!.find((p) => p.id === "stairfoot")!;
  wk.x = foot.x; wk.y = foot.y;
  assert.ok(assignJob(w, wk, walkOrder("surface", s.x, s.y)));
  const goals = new Set<string>();
  assert.deepEqual(follow(w, wk, () => { if (wk.area === "dungeon" && wk.job?.nav) goals.add(wk.job.nav.goal); return wk.area === "surface"; }), ["stair_up>stair_down"]);
  assert.equal(goals.size, 1, "one walk goal all the way: it does not change its mind");
  // standing by the circle: the rune
  const c = dg.ritualPos;
  enterArea(w, wk, "dungeon", c.x, c.y + D.arrive.dy);
  assert.ok(assignJob(w, wk, walkOrder("surface", s.x, s.y)));
  assert.deepEqual(follow(w, wk, () => wk.area === "surface"), ["rune:dungeon>surface"]);
});

test("every road, door and stair can be stood in by a worker's body and walked to from where its area is entered", () => {
  const w = newWorld(), ids = Object.keys(AREAS).filter((id) => !id.startsWith("debug_"));
  getArea(w, "surface");
  openStair(w);
  let n = 0;
  for (const id of ids) {
    const area = getArea(w, id), a = makeActor(`t.${id}`, "worker_golem", id, area.start.x, area.start.y);
    a.powerCore = "ruby_core"; w.actors.push(a);
    assert.ok(portalsOf(area).length, `${id} has a way out`);
    for (const p of portalsOf(area)) {
      n++;
      assert.ok(portalOpen(w, p), `${id}.${p.id}`);
      const at = portalStand(p, navGrid(area, a).free);
      assert.ok(at && inPortal(p, at.x, at.y), `${id}.${p.id}: a place to stand inside its box`);
      assert.ok(findPath(w, a, { x: at.x, y: at.y, range: 1 }, false), `${id}.${p.id}: walkable from the area's start`);
      assert.ok(portalsOf(getArea(w, p.to.area)).some((q) => q.id === p.to.portal), `${id}.${p.id}: its far side exists`);
    }
  }
  assert.equal(n, 16, "the stair's two ends, the road's two ends, six shop doors and the six ways back out");
  // a box that is blocked whole has nowhere to stand
  assert.equal(portalStand(portalsOf(getArea(w, "surface"))[0], () => false), null);
});

// ------------------------------------------------------------------ gathering to the pack
test("a gather order to INVENTORY: the worker keeps what it gathers, the amount counts what it gathered, and a save mid-way carries on", () => {
  const order = gatherOrder("wood", "debug_yard", null, 5);
  assert.ok(JOB_HANDLERS.gatherDeposit.validate(order.args));
  assert.equal(JOB_HANDLERS.gatherDeposit.validate({ resource: "wood", fromArea: "debug_yard", amount: 5 }), false, "no storage named at all is not an order");
  const w = foundationDemo(), a = actorById(w, "debug.worker")!;
  const chestEmpty = (x: World) => getArea(x, "debug_workshop").prop("chest.fixture")!.inventory!.every((s) => !s);
  assert.equal(orderRefusal(w, player(w), a.id, order), null);
  assert.ok(assignJob(w, a, order));
  assert.equal(a.job!.args.storage, null);
  assert.deepEqual(jobView(w, a)!.lines, ["FROM DEBUG YARD", "TO INVENTORY"]);
  until(w, () => a.task?.kind === "punch" && !!a.task.fired && countItem(a, "wood") > 0);
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(w)))), b = actorById(loaded, "debug.worker")!;
  assert.deepEqual(serialize(loaded), serialize(w));
  assert.equal(b.job!.completed, countItem(b, "wood"), "counted where the blow paid, before the swing has ended");
  for (const [x, y] of [[w, a], [loaded, b]] as const) {
    until(x, () => y.job?.status !== "running");
    assert.equal(y.job?.status, "done"); assert.equal(y.job!.completed, 5);
    assert.equal(jobView(x, y)!.progress, "5/5"); assert.equal(jobView(x, y)!.phase, "FINISHED");
    assert.ok(countItem(y, "wood") >= 5, "what a last blow paid over the amount is kept too");
    assert.equal(y.area, "debug_yard", "it stays where the work was"); assert.ok(chestEmpty(x), "and stores nothing");
  }
  assert.deepEqual(serialize(loaded), serialize(w));
  // a full pack stops it (PACK FULL) until room is made, as for any gather; on repeat it goes on while there is room
  const f = foundationDemo(), c = actorById(f, "debug.worker")!;
  addItems(f, c, "coin", 8);
  assert.ok(assignJob(f, c, gatherOrder("wood", "debug_yard", null, 1, true)));
  until(f, () => c.job?.status === "blocked");
  assert.equal(c.job!.reason, "packFull"); assert.equal(c.area, "debug_yard"); assert.equal(countItem(c, "wood"), 0);
  c.inventory[0] = null; resumeJob(f, c);
  until(f, () => countItem(c, "wood") >= 3);
  assert.equal(c.job!.completed, countItem(c, "wood")); assert.equal(jobView(f, c)!.progress, `${c.job!.completed} DONE (REPEAT)`);
  // the order screen's TO list: every chest it can get to, then INVENTORY, which is always there
  const g = foundationDemo(), d = actorById(g, "debug.worker")!;
  assert.deepEqual(gatherTargets(g, d).map((t) => t.label), ["DEBUG WORKSHOP CHEST", INVENTORY_LABEL]);
  getArea(g, "debug_workshop").removeProp("chest.fixture");
  assert.deepEqual(gatherTargets(g, d), [{ label: "INVENTORY", ref: null }]);
  assert.equal(gatherRefusal(g, d, "wood", "debug_yard", null), null);
  assert.equal(orderRefusal(g, player(g), d.id, gatherOrder("wood", "debug_yard", { area: "nowhere", prop: "x" }, 3)), "NO SUCH STORAGE");
});
