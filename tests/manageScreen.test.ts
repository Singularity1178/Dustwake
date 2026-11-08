// The worker management screen (screens/manage.ts): the worker's state as the
// screen reads it, the core in and out through orderCoreSwap, orders given
// through setWorkerOrder (gather, craft, go to) and run end to end, pause /
// resume / cancel, refusals in words, saves mid-job, and a text lint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ManageUi } from "../src/game/screens/manage";
import { giveWorkerOrder, controlWorker, orderCoreSwap } from "../src/game/sim/commands";
import { JOB_HANDLERS, assignJob, pauseJob, resumeJob, craftOrder, gatherOrder, orderRefusal, setWorkerOrder, walkOrder } from "../src/game/sim/jobs";
import { storageOptions, stationOptions, gatherSources, walkOptions, blockText, BLOCK_TEXT, areaName } from "../src/game/sim/orders";
import { beginTask } from "../src/game/sim/tasks";
import { giveItem } from "../src/game/sim/inventory";
import { removePowerCore } from "../src/game/sim/power";
import { powered } from "../src/game/sim/actorStats";
import { countItem } from "../src/game/sim/inventoryOps";
import { JOB_KINDS } from "../src/game/content/jobs";
import { FONT_GLYPHS } from "../src/game/font";
import { clearFlag, getArea, player, setFlag, type Slot, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import type { JobOrder } from "../src/game/world/jobs";
import { frame, frames } from "./helpers";
import { screenHost, assertTextFits, type ScreenHost, type TextBox } from "./support/screenHost";
import { BENCH, CHEST, beside, chestCount, fixture, finishTask, until, worker } from "./support/workerFixture";

const roundTrip = (w: World) => deserialize(JSON.parse(JSON.stringify(serialize(w))));
const texts = (b: TextBox[]) => b.map((x) => x.text);
const has = (b: TextBox[], t: string) => assert.ok(texts(b).includes(t), `"${t}" not drawn; got ${texts(b).join(" | ")}`);
const last = (a: string[]) => a[a.length - 1];
const jobOf = (w: World) => JSON.stringify(worker(w).job);
const fillChest = (w: World) => getArea(w, CHEST.area).setInventory(CHEST.prop, Array.from({ length: 32 }, () => ({ item: "stone", n: 20 }) as Slot));

function open() {
  const f = fixture(), sh = screenHost(f.w), ui = new ManageUi(sh.host);
  ui.open(f.worker.id);
  return { ...f, sh, ui };
}
/** Move to the row starting `label` with W / S, as a player would. */
function goto(sh: ScreenHost, ui: ManageUi, label: string) {
  const i = ui.menu.findIndex((r) => r.label.startsWith(label));
  assert.ok(i >= 0, `no row "${label}" in ${ui.menu.map((r) => r.label).join(" | ")}`);
  for (let d = i - ui.row; d !== 0; d += d > 0 ? -1 : 1) sh.press(d > 0 ? "s" : "w");
}
const choose = (sh: ScreenHost, ui: ManageUi, label: string) => { goto(sh, ui, label); sh.press("e"); };
/** Turn a choice row until it shows `value`. */
function pickValue(sh: ScreenHost, ui: ManageUi, label: string, value: string) {
  goto(sh, ui, label);
  for (let i = 0; i < 40 && ui.menu[ui.row].value !== value; i++) sh.press("d");
  assert.equal(ui.menu[ui.row].value, value);
}
const shot = (sh: ScreenHost, name: string, w?: string) => { const b = sh.draw(); assertTextFits(name, b); sh.save(`.test-out/shots/${w ?? name}.png`); return b; };

// ------------------------------------------------------------------ state
test("shows the worker as it is: switched off, idle, working, paused, blocked on a full chest, done", () => {
  const { w, pl, worker: wk, sh, ui } = open();
  // idle and powered
  let b = shot(sh, "manage idle", "manage-idle");
  has(b, "WORKER GOLEM"); has(b, "IDLE: NO ORDER"); has(b, "POWER: RUBY GOLEM CORE"); has(b, "AT: DEBUG WORKSHOP"); has(b, "NO ORDER"); has(b, "CARRIES 0/8");
  assert.equal(ui.menu[0].label, "TAKE OUT RUBY GOLEM CORE");
  // switched off: no core in it, none carried, then one carried
  removePowerCore(w, pl, wk); giveItem(w, pl, "ruby_core"); pl.inventory = pl.inventory.map((s) => (s?.item === "ruby_core" ? null : s));
  b = shot(sh, "manage off"); has(b, "OFF: NO POWER"); has(b, "POWER: NO CORE");
  assert.equal(ui.menu[0].label, "NO CORE TO SLOT IN"); assert.ok(!ui.menu[0].ok);
  giveItem(w, pl, "ruby_core");
  assert.equal(ui.menu[0].label, "SLOT IN RUBY GOLEM CORE"); assert.ok(ui.menu[0].ok);
  wk.powerCore = "ruby_core";
  // working, with something in its hands and a rune on it
  wk.gear.rune0 = "rune_swift";
  assert.ok(assignJob(w, wk, gatherOrder("wood", "debug_yard", { ...CHEST }, 6)));
  until(w, () => countItem(wk, "wood") > 0 && wk.job!.status === "running");
  b = shot(sh, "manage working", "manage-working");
  has(b, "WORKING"); has(b, "GATHER WOOD 0/6"); has(b, "FROM DEBUG YARD"); has(b, "TO DEBUG WORKSHOP CHEST"); has(b, "RUNE 1");
  assert.ok(texts(b).some((t) => t.startsWith("PHASE: ")));
  assert.ok(texts(b).some((t) => /^CARRIES [1-8]\/8$/.test(t)));
  // paused by hand
  pauseJob(w, wk);
  b = shot(sh, "manage paused"); has(b, "PAUSED");
  resumeJob(w, wk); wk.gear = {};
  // blocked: the chest is full when it comes to store
  fillChest(w);
  until(w, () => wk.job!.status === "blocked", 20000);
  assert.equal(wk.job!.reason, "storageFull");
  b = shot(sh, "manage blocked", "manage-blocked"); has(b, "BLOCKED: STORAGE FULL");
  assert.equal(ui.menu[6].label, "RETRY ORDER");
  // done
  getArea(w, CHEST.area).setInventory(CHEST.prop, []);
  resumeJob(w, wk);
  until(w, () => wk.job!.status === "done");
  b = shot(sh, "manage done"); has(b, "DONE"); has(b, "PHASE: FINISHED");
  // unpowered with an order: waits for power
  wk.job!.status = "running"; wk.powerCore = null; frame(w);
  assert.equal(wk.job!.reason, "power");
  b = shot(sh, "manage waiting"); has(b, "WAITING FOR POWER");
});

// ------------------------------------------------------------------ the core
function twin(setup: (f: ReturnType<typeof fixture>) => void) {
  const a = open(), b = fixture();
  setup(a); setup(b);
  return { a, b };
}
for (const [name, setup, expect] of [
  ["take out", () => {}, (wk: ReturnType<typeof worker>) => !wk.powerCore],
  ["slot in", (f: ReturnType<typeof fixture>) => { removePowerCore(f.w, f.pl, f.worker); }, (wk: ReturnType<typeof worker>) => wk.powerCore === "ruby_core"],
  ["take out into a full pack: it drops", (f: ReturnType<typeof fixture>) => { f.pl.inventory = Array.from({ length: 8 }, () => ({ item: "wood", n: 20 }) as Slot); }, (wk: ReturnType<typeof worker>) => !wk.powerCore],
] as const) {
  test(`core, ${name}: the screen's row does exactly what orderCoreSwap does`, () => {
    const { a, b } = twin(setup as never);
    // the screen
    a.sh.press("e");
    assert.ok(a.ui.pending && a.sh.host.screens.is("play"), "the golem does the work with the world running; the screen steps aside");
    finishTask(a.w);
    // the command, on an identical world
    const wasOut = !!b.worker.powerCore;
    assert.ok(orderCoreSwap(b.w, b.pl, b.worker.id, wasOut ? null : "ruby_core"));
    finishTask(b.w);
    assert.ok(expect(worker(a.w)), name);
    assert.deepEqual(serialize(a.w), serialize(b.w), "identical worlds");
    if (name.includes("full pack")) {
      assert.equal(countItem(player(a.w), "ruby_core"), 0);
      assert.ok(getArea(a.w, "debug_workshop").loose.some((l) => l.item === "ruby_core" && !l.taken), "a full pack drops it on the ground");
    }
    // and the screen comes back, showing the new state
    a.ui.resume();
    assert.ok(a.sh.host.screens.is("manage"));
    const t = shot(a.sh, `manage core ${name}`);
    has(t, powered(worker(a.w)) ? "POWER: RUBY GOLEM CORE" : "POWER: NO CORE");
  });
}

test("core: from the reach that opened the screen; the guardian's C-style refusals are the same messages", () => {
  const f = fixture(), sh = screenHost(f.w), ui = new ManageUi(sh.host);
  // E on the worker as the play screen does: the reach fires its event and lingers
  let opened = false;
  for (let i = 0; i < 120 && !opened; i++) { frame(f.w, { ix: 0, iy: 0, use: true }); opened = f.w.events.some((e) => e.t === "manageActor"); }
  assert.ok(opened && f.pl.task?.fired, "the opening reach has fired and is still finishing");
  ui.open(f.worker.id);
  sh.press("e");
  assert.ok(ui.pending, "the lingering reach does not count as busy");
  finishTask(f.w);
  assert.equal(f.worker.powerCore, null);
  // nothing carried that fits: the row is greyed and says so
  f.pl.inventory = f.pl.inventory.map((x) => (x?.item === "ruby_core" ? null : x));
  ui.resume(); goto(sh, ui, "NO CORE");
  sh.press("e"); assert.equal(last(sh.notes), "YOU CARRY NO CORE THAT FITS IT");
  sh.press("c"); assert.equal(last(sh.notes), "YOU CARRY NO CORE THAT FITS IT"); assert.ok(!ui.pending);
});

// ------------------------------------------------------------------ orders
test("a gather order from the screen is the order gatherOrder builds, and runs end to end into the chest", () => {
  const a = open(), bf = fixture();
  assert.ok(setWorkerOrder(bf.w, bf.pl, bf.worker.id, gatherOrder("wood", "debug_yard", { ...CHEST }, 6)));
  choose(a.sh, a.ui, "GATHER");
  assert.equal(a.ui.view, "gather");
  const b = shot(a.sh, "manage gather form", "manage-gather"); has(b, "GATHER ORDER");
  assert.deepEqual(a.ui.menu.map((r) => r.label), ["RESOURCE", "FROM", "TO", "AMOUNT", "ISSUE ORDER"]);
  assert.deepEqual(a.ui.menu.slice(0, 4).map((r) => r.value), ["WOOD", "DEBUG YARD", "DEBUG WORKSHOP CHEST", "5"]);
  pickValue(a.sh, a.ui, "AMOUNT", "6");
  choose(a.sh, a.ui, "ISSUE ORDER");
  assert.equal(a.ui.view, "main"); assert.equal(last(a.sh.notes), "ORDER GIVEN");
  assert.equal(jobOf(a.w), jobOf(bf.w), "the same job, field for field");
  until(a.w, () => worker(a.w).job?.status === "done"); until(bf.w, () => worker(bf.w).job?.status === "done");
  assert.equal(chestCount(a.w, "wood"), 6); assert.equal(countItem(worker(a.w), "wood"), 0);
  assert.equal(a.w.events.filter((e) => e.t === "travelled").length + a.sh.seen.filter((e) => e.t === "travelled").length, 2, "to the yard and back, by rune");
  assert.deepEqual(serialize(a.w), serialize(bf.w));
  // REPEAT is the repeat flag, and the resource row follows the data (wood, stone)
  beside(a.w, worker(a.w));
  choose(a.sh, a.ui, "GATHER");
  pickValue(a.sh, a.ui, "RESOURCE", "STONE"); pickValue(a.sh, a.ui, "AMOUNT", "REPEAT");
  choose(a.sh, a.ui, "ISSUE ORDER");
  assert.equal(JSON.stringify(worker(a.w).job).includes('"repeat":true'), true);
  const j = worker(a.w).job!; assert.deepEqual([j.kind, j.args.resource, j.args.fromArea], ["gatherDeposit", "stone", "debug_yard"]);
});

test("a craft order from the screen is craftOrder's, and the worker crafts at the bench from the chest beside it", () => {
  const a = open(), bf = fixture();
  for (const w of [a.w, bf.w]) getArea(w, CHEST.area).setInventory(CHEST.prop, [{ item: "wood", n: 4 }]);
  assert.ok(setWorkerOrder(bf.w, bf.pl, bf.worker.id, craftOrder({ ...BENCH }, "planks", 2)));
  choose(a.sh, a.ui, "CRAFT");
  const b = shot(a.sh, "manage craft form", "manage-craft"); has(b, "CRAFT ORDER");
  assert.deepEqual(a.ui.menu.slice(0, 2).map((r) => r.value), ["DEBUG WORKSHOP BENCH", "PLANKS"]);
  assert.equal(a.ui.menu[1].note[1], "IT HAS WHAT IT NEEDS RIGHT NOW.");
  pickValue(a.sh, a.ui, "AMOUNT", "2");
  choose(a.sh, a.ui, "ISSUE ORDER");
  assert.equal(jobOf(a.w), jobOf(bf.w));
  until(a.w, () => worker(a.w).job?.status === "done"); until(bf.w, () => worker(bf.w).job?.status === "done");
  assert.equal(countItem(worker(a.w), "planks"), 6); assert.equal(chestCount(a.w, "wood"), 0);
  assert.deepEqual(serialize(a.w), serialize(bf.w));
  // a recipe it can't make yet is offered with the reason, and its order waits
  choose(a.sh, a.ui, "CRAFT"); pickValue(a.sh, a.ui, "RECIPE", "RUNE OF SWIFT");
  assert.equal(a.ui.menu[1].note[1], "NOW: NEED THE RUNE CHISEL. THE ORDER WAITS.");
  shot(a.sh, "manage craft waits");
});

test("a go-to order from the screen walks there and stands", () => {
  const { w, worker: wk, sh, ui } = open();
  choose(sh, ui, "GO TO");
  const b = shot(sh, "manage walk form", "manage-walk"); has(b, "GO TO ORDER");
  const spots = walkOptions(w, wk);
  assert.ok(spots.length >= 4 && spots.every((s) => s.label.length <= 24), spots.map((s) => s.label).join());
  pickValue(sh, ui, "WHERE", "DEBUG YARD RUNE");
  choose(sh, ui, "ISSUE ORDER");
  const spot = spots.find((s) => s.label === "DEBUG YARD RUNE")!;
  assert.deepEqual(wk.job!.args, walkOrder(spot.area, spot.x, spot.y).args);
  until(w, () => wk.job?.status === "done");
  assert.equal(wk.area, "debug_yard"); assert.ok(Math.hypot(wk.x - spot.x, wk.y - spot.y) < 3);
});

test("pause, resume and cancel go through the screen; a paused order holds still and loses nothing", () => {
  const { w, pl, worker: wk, sh, ui } = open();
  assert.ok(!ui.menu[6].ok && ui.menu[6].label === "PAUSE ORDER" && !ui.menu[7].ok, "nothing to pause or cancel yet");
  for (let i = 0; i < 6; i++) sh.press("s");
  sh.press("e");
  assert.equal(last(sh.notes), "IT HAS NO ORDER TO PAUSE");
  assignJob(w, wk, gatherOrder("wood", "debug_yard", { ...CHEST }, 6));
  until(w, () => wk.moving); beside(w, wk);
  choose(sh, ui, "PAUSE ORDER");
  assert.deepEqual([wk.job!.status, wk.job!.reason, last(sh.notes)], ["paused", "manual", "ORDER PAUSED"]);
  assert.equal(ui.menu[6].label, "RESUME ORDER");
  const at = [wk.x, wk.y]; frames(w, 120);
  assert.deepEqual([wk.x, wk.y], at, "it stays where it is");
  choose(sh, ui, "RESUME ORDER");
  assert.deepEqual([wk.job!.status, last(sh.notes)], ["running", "ORDER RESUMED"]);
  until(w, () => countItem(wk, "wood") > 0); beside(w, wk);
  choose(sh, ui, "CANCEL ORDER");
  assert.equal(wk.job, null); assert.equal(last(sh.notes), "ORDER CANCELLED"); assert.ok(countItem(wk, "wood") > 0, "what it carries stays with it");
  assert.equal(controlWorker(w, pl, wk.id, "cancel").text, "IT HAS NO ORDER");
  // resuming an unpowered worker says it waits
  beside(w, wk); assignJob(w, wk, walkOrder("debug_workshop", 100, 100)); controlWorker(w, pl, wk.id, "pause"); wk.powerCore = null;
  assert.equal(controlWorker(w, pl, wk.id, "resume").text, "NO POWER. IT WAITS FOR A CORE");
  wk.job!.status = "running"; wk.job!.reason = null;
  assert.equal(controlWorker(w, pl, wk.id, "resume").text, "IT IS ALREADY WORKING");
});

// ------------------------------------------------------------------ refusals
test("refusals are said in words, agree with setWorkerOrder, and change nothing", () => {
  const { w, pl, worker: wk, sh, ui } = open();
  const chest = { ...CHEST };
  const table: [string, JobOrder, string][] = [
    ["unknown kind", { kind: "dance", args: {} }, "THAT KIND OF ORDER IS UNKNOWN"],
    ["no such resource", gatherOrder("nope" as never, "debug_yard", chest, 3), "NO SUCH RESOURCE"],
    ["no such area", gatherOrder("wood", "nowhere", chest, 3), "NO SUCH SOURCE AREA"],
    ["no such storage", gatherOrder("wood", "debug_yard", { area: "nowhere", prop: "x" }, 3), "NO SUCH STORAGE"],
    ["bad amount", gatherOrder("wood", "debug_yard", chest, 0), "THE AMOUNT IS NOT VALID"],
    ["no such station", craftOrder({ area: "nowhere", prop: "x" }, "planks", 1), "NO SUCH STATION"],
    ["no such recipe", craftOrder({ ...BENCH }, "nope", 1), "NO SUCH RECIPE"],
    ["nowhere to go", { kind: "walk", args: { area: "debug_yard", x: NaN, y: 3 } }, "THERE IS NOWHERE TO GO"],
  ];
  for (const [name, order, text] of table) {
    assert.equal(orderRefusal(w, pl, wk.id, order), text, name);
    assert.equal(setWorkerOrder(w, pl, wk.id, order), false, name);
    assert.deepEqual(giveWorkerOrder(w, pl, wk.id, order), { ok: false, text }, name);
    sh.host.drainEvents(); assert.equal(last(sh.notes), text, name);
    assert.equal(wk.job, null, name);
  }
  // who can be ordered
  const good = gatherOrder("wood", "debug_yard", chest, 2);
  assert.equal(orderRefusal(w, pl, "npc.guardian", good), "THAT IS NOT A WORKER");
  assert.equal(orderRefusal(w, pl, "nobody", good), "THAT IS NOT A WORKER");
  // busy with its own task
  beginTask(wk, { kind: "reach", dur: 5 });
  assert.equal(giveWorkerOrder(w, pl, wk.id, good).text, "IT IS BUSY. TRY AGAIN IN A MOMENT"); assert.equal(wk.job, null);
  wk.task = null;
  // needs a capability it lacks
  JOB_KINDS.test_fly = { phase: "fly", capabilities: ["fly"] }; JOB_HANDLERS.test_fly = { validate: () => true, step: () => {} };
  try { assert.equal(orderRefusal(w, pl, wk.id, { kind: "test_fly", args: {} }), "IT CANNOT DO THAT WORK"); } finally { delete JOB_KINDS.test_fly; delete JOB_HANDLERS.test_fly; }
  // too far, or no way through to it: same words as the screen's
  pl.x += 120;
  assert.equal(giveWorkerOrder(w, pl, wk.id, good).text, "STEP UP TO THE WORKER"); assert.equal(setWorkerOrder(w, pl, wk.id, good), false);
  assert.equal(controlWorker(w, pl, wk.id, "pause").text, "STEP UP TO THE WORKER");
  choose(sh, ui, "GO TO"); choose(sh, ui, "ISSUE ORDER");
  assert.equal(last(sh.notes), "STEP UP TO THE WORKER"); assert.equal(wk.job, null);
  // and when it is fine, they agree
  pl.x -= 120;
  assert.equal(orderRefusal(w, pl, wk.id, good), null); assert.equal(setWorkerOrder(w, pl, wk.id, good), true);
});

test("forms only offer what exists, and a form with nothing to offer cannot be issued and says why", () => {
  const { w, worker: wk, sh, ui } = open();
  // targets: storage props and stations only, in areas it can get to
  assert.deepEqual(storageOptions(w, wk).map((o) => o.ref), [{ ...CHEST }]);
  assert.deepEqual(stationOptions(w, wk).map((o) => o.ref), [{ ...BENCH }]);
  assert.deepEqual(gatherSources(w, wk, "wood").map((s) => s.area), ["debug_yard"]);
  assert.ok(!getArea(w, "dungeon").props.length || storageOptions(w, wk).every((o) => o.area !== "dungeon"), "the dungeon's chests are not storage");
  const dungeonChest = getArea(w, "dungeon").props.find((p) => p.kind === "chest");
  assert.ok(dungeonChest, "the dungeon has a looted chest kind"); assert.ok(!storageOptions(w, wk).some((o) => o.ref.prop === dungeonChest!.id));
  // no chest: the gather form can't be issued
  getArea(w, CHEST.area).removeProp(CHEST.prop);
  choose(sh, ui, "GATHER");
  assert.deepEqual(ui.menu.map((r) => r.value ?? ""), ["WOOD", "DEBUG YARD", "NONE", "5", ""]);
  choose(sh, ui, "ISSUE ORDER");
  assert.equal(last(sh.notes), "BUILD A STORAGE CHEST FIRST"); assert.equal(wk.job, null); assert.ok(sh.host.screens.is("manage"));
  shot(sh, "manage gather no chest");
  // nothing to gather: the rune route is dark, so the yard is out of reach
  sh.press("escape"); assert.equal(ui.view, "main");
  clearFlag(w, "rune.debug_yard.active");
  assert.deepEqual(gatherSources(w, wk, "wood"), []);
  choose(sh, ui, "GATHER");
  assert.equal(ui.menu[1].value, "NONE");
  // no bench: no craft
  getArea(w, CHEST.area).removeProp(BENCH.prop);
  sh.press("escape"); choose(sh, ui, "CRAFT"); choose(sh, ui, "ISSUE ORDER");
  assert.equal(last(sh.notes), "BUILD A CRAFTING BENCH FIRST");
  // a body that can't do the work is not offered it
  sh.press("escape");
  setFlag(w, "rune.debug_yard.active");
  assert.ok(ui.menu[1].ok);
});

test("an order given to a switched-off worker is kept, and starts when a core goes in", () => {
  const { w, pl, worker: wk, sh, ui } = open();
  removePowerCore(w, pl, wk);
  choose(sh, ui, "GO TO"); pickValue(sh, ui, "WHERE", "DEBUG WORKSHOP CHEST"); choose(sh, ui, "ISSUE ORDER");
  assert.equal(last(sh.notes), "ORDER GIVEN. IT WAITS FOR A CORE");
  assert.deepEqual([wk.job!.status, wk.job!.reason], ["paused", "power"]);
  frames(w, 60); assert.equal(wk.job!.status, "paused");
  assert.ok(sh.draw().some((b) => b.text === "WAITING FOR POWER"));
  const pc = ui.menu[0]; assert.equal(pc.label, "SLOT IN RUBY GOLEM CORE");
  sh.press("e"); finishTask(w); ui.resume();
  until(w, () => wk.job?.status === "done", 3000);
  assert.ok(powered(wk));
});

// ------------------------------------------------------------------ saving
test("a save in the middle of a screen-given order continues identically, and the screen reads the loaded worker", () => {
  const { w, sh, ui } = open();
  choose(sh, ui, "GATHER"); pickValue(sh, ui, "AMOUNT", "3"); choose(sh, ui, "ISSUE ORDER");
  until(w, () => worker(w).task?.kind === "punch" && worker(w).task!.t > 0.2 && countItem(worker(w), "wood") >= 1);
  const loaded = roundTrip(w);
  assert.deepEqual(serialize(loaded), serialize(w));
  for (let i = 0; i < 8000 && worker(w).job?.status !== "done"; i++) { until(w, () => true, 0); frames(w, 1); frames(loaded, 1); }
  assert.equal(worker(w).job?.status, "done"); assert.equal(chestCount(loaded, "wood"), 3);
  assert.deepEqual(serialize(loaded), serialize(w));
  // a screen on a loaded, still-working world
  const l2 = roundTrip(open().w);
  assert.ok(assignJob(l2, worker(l2), gatherOrder("wood", "debug_yard", { ...CHEST }, 2)));
  const l3 = roundTrip(l2), sh3 = screenHost(l3), ui3 = new ManageUi(sh3.host);
  ui3.open(worker(l3).id);
  const b = sh3.draw(); assertTextFits("manage loaded", b); has(b, "WORKING"); has(b, "GATHER WOOD 0/2");
});

// ------------------------------------------------------------------ the lint
test("every state and form draws font glyphs only, inside the panel, with no text over text", () => {
  const { w, pl, worker: wk, sh, ui } = open();
  const every = (name: string) => {
    for (const view of ["main", "gather", "craft", "walk"] as const) {
      ui.view = view; ui.menu;
      for (let r = 0; r < ui.menu.length; r++) { ui.rows[view] = r; assertTextFits(`${name} ${view} row ${r}`, sh.draw()); }
    }
    ui.view = "main";
  };
  every("idle");
  assignJob(w, wk, gatherOrder("wood", "debug_yard", { ...CHEST }, 99)); every("working");
  for (const reason of Object.keys(BLOCK_TEXT)) {
    wk.job!.status = "blocked"; wk.job!.reason = reason; every(`blocked ${reason}`);
    assert.ok(blockText(reason).length <= 15, reason);
  }
  wk.job!.status = "paused"; wk.job!.reason = "power"; every("waiting");
  assignJob(w, wk, craftOrder({ ...BENCH }, "rune_swift", 99, true)); every("crafting");
  assignJob(w, wk, walkOrder("debug_yard", 20, 20)); every("walking");
  removePowerCore(w, pl, wk); wk.inventory = Array.from({ length: 8 }, (_, i) => ({ item: (["wood", "stone", "planks", "cut_stone"] as const)[i % 4], n: 1 + i * 2 }));
  wk.gear.rune0 = "rune_glow"; every("off, full");
  for (const t of [...Object.values(BLOCK_TEXT), areaName("dungeon"), areaName("debug_yard")]) assert.ok([...t].every((c) => FONT_GLYPHS.has(c)), t);
});
